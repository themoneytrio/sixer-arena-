import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { loadVenue, sportForTurf } from "../domain/venueView.js";
import { buildBookingView } from "../domain/bookingView.js";
import { claimSlots, findConflicts, SlotTakenError } from "../domain/claim.js";
import { isPeakHour, slotPricePaise, feePaise, depositPaise } from "../domain/pricing.js";
import { OPEN_HOUR, CLOSE_HOUR, hoursUntil } from "../domain/dates.js";
import { generateBookingCode, generateEntryCode } from "../domain/codes.js";
import { payments, mockSign } from "../providers/payment.js";
import { confirmPayment, failBooking } from "../domain/confirm.js";
import { resolveCoupon, redeemCoupon, CouponError } from "../domain/coupons.js";

const checkoutSchema = z.object({
  venueId: z.string(),
  items: z
    .array(z.object({ turfId: z.string(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), hour: z.number().int() }))
    .min(1)
    .max(12),
  name: z.string().min(1).max(60),
  teamName: z.string().max(60).optional(),
  paymentMethod: z.enum(["upi", "card", "net"]),
  couponCode: z.string().max(30).optional(),
  idempotencyKey: z.string().min(6).max(80),
});

export async function bookingRoutes(app: FastifyInstance) {
  app.post("/bookings/checkout", { preHandler: app.authenticate }, async (req, reply) => {
    const parse = checkoutSchema.safeParse(req.body);
    if (!parse.success) return reply.code(400).send({ error: "bad_input" });
    const body = parse.data;

    // Idempotent retries (flaky network) must not create a second order.
    const existing = await prisma.booking.findUnique({
      where: { idempotencyKey: body.idempotencyKey },
      include: { payments: true },
    });
    if (existing) {
      const pay = existing.payments[0];
      return {
        bookingId: existing.id,
        code: existing.code,
        provider: payments.kind,
        orderId: pay?.orderId ?? "",
        keyId: config.razorpay.keyId || undefined,
        depositPaise: existing.depositPaise,
        totalPaise: existing.totalPaise,
      };
    }

    const venue = await loadVenue(body.venueId);
    if (!venue) return reply.code(404).send({ error: "venue_not_found" });

    // Server is the source of truth for price. Validate + recompute every item.
    let subtotal = 0;
    const priced: { turfId: string; date: string; hour: number; pricePaise: number; isPeak: boolean }[] = [];
    for (const it of body.items) {
      const { turf, sport } = sportForTurf(venue, it.turfId);
      if (!turf) return reply.code(400).send({ error: "bad_turf" });
      if (it.hour < OPEN_HOUR || it.hour > CLOSE_HOUR) return reply.code(400).send({ error: "bad_hour" });
      if (hoursUntil(it.date, it.hour) < 0) return reply.code(400).send({ error: "slot_in_past" });
      const peak = isPeakHour(it.date, it.hour);
      const price = slotPricePaise(sport.basePaise, peak);
      subtotal += price;
      priced.push({ turfId: turf.id, date: it.date, hour: it.hour, pricePaise: price, isPeak: peak });
    }
    const fee = feePaise(priced.length, venue.convenienceFeePaise);

    // Coupon (authoritative — re-resolved here regardless of client preview).
    let discount = 0;
    let couponId: string | null = null;
    let couponCode: string | null = null;
    if (body.couponCode) {
      try {
        const r = await resolveCoupon(venue.id, body.couponCode, subtotal);
        discount = r.discountPaise;
        couponId = r.couponId;
        couponCode = r.code;
      } catch (e) {
        if (e instanceof CouponError) return reply.code(400).send({ error: "coupon_" + e.reason });
        throw e;
      }
    }

    const total = Math.max(0, subtotal + fee - discount);
    const deposit = depositPaise(total, venue.depositPercent);
    const code = await generateBookingCode();

    // Reserve slots atomically (HELD) + create the pending booking.
    let bookingId: string;
    try {
      bookingId = await prisma.$transaction(async (tx) => {
        const booking = await tx.booking.create({
          data: {
            code,
            entryCode: generateEntryCode(),
            venueId: venue.id,
            userId: req.userId!,
            source: "ONLINE",
            status: "PENDING_PAYMENT",
            customerName: body.name,
            customerPhone: (await tx.user.findUnique({ where: { id: req.userId! } }))?.phone ?? "",
            teamName: body.teamName,
            subtotalPaise: subtotal,
            feePaise: fee,
            discountPaise: discount,
            couponCode,
            totalPaise: total,
            depositPaise: deposit,
            amountDuePaise: total,
            idempotencyKey: body.idempotencyKey,
            slots: { create: priced.map((p) => ({ ...p })) },
          },
        });
        await claimSlots(tx, priced, "HELD", {
          bookingId: booking.id,
          holdExpiresAt: new Date(Date.now() + config.holdTtlMs),
        });
        if (couponId) await redeemCoupon(tx, couponId);
        return booking.id;
      });
    } catch (e) {
      if (e instanceof SlotTakenError) {
        const conflicts = await findConflicts(priced);
        return reply.code(409).send({ code: "SLOT_TAKEN", conflicts });
      }
      throw e;
    }

    // Create the payment order (network for real Razorpay) after the slots are
    // safely held. If it fails, release the hold so the slot isn't stuck.
    try {
      const order = await payments.createOrder(deposit, code, { bookingId });
      await prisma.payment.create({
        data: { bookingId, provider: payments.kind === "razorpay" ? "RAZORPAY" : "MOCK", orderId: order.orderId, amountPaise: deposit },
      });
      return {
        bookingId,
        code,
        provider: order.provider,
        orderId: order.orderId,
        keyId: order.keyId,
        depositPaise: deposit,
        totalPaise: total,
      };
    } catch (e) {
      await failBooking(bookingId);
      return reply.code(502).send({ error: "payment_init_failed" });
    }
  });

  // Preview a coupon before paying (checkout re-resolves it authoritatively).
  app.post("/bookings/validate-coupon", { preHandler: app.authenticate }, async (req, reply) => {
    const parse = z.object({ venueId: z.string(), code: z.string().max(30), subtotalPaise: z.number().int().nonnegative() }).safeParse(req.body);
    if (!parse.success) return reply.code(400).send({ error: "bad_input" });
    try {
      const r = await resolveCoupon(parse.data.venueId, parse.data.code, parse.data.subtotalPaise);
      return { valid: true, code: r.code, percentOff: r.percentOff, discountPaise: r.discountPaise };
    } catch (e) {
      if (e instanceof CouponError) return { valid: false, reason: e.reason };
      throw e;
    }
  });

  // Client-side capture callback (fast path; webhook is the authoritative one).
  app.post("/bookings/:id/verify-payment", { preHandler: app.authenticate }, async (req, reply) => {
    const parse = z
      .object({ razorpay_order_id: z.string(), razorpay_payment_id: z.string(), razorpay_signature: z.string() })
      .safeParse(req.body);
    if (!parse.success) return reply.code(400).send({ error: "bad_input" });
    const id = (req.params as any).id;
    const booking = await prisma.booking.findFirst({ where: { id, userId: req.userId! } });
    if (!booking) return reply.code(404).send({ error: "not_found" });
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = parse.data;
    if (!payments.verifySignature(razorpay_order_id, razorpay_payment_id, razorpay_signature)) {
      await failBooking(id);
      return reply.code(400).send({ error: "bad_signature" });
    }
    await confirmPayment(id, razorpay_payment_id);
    return { ok: true };
  });

  // User dismissed the payment sheet — release the HELD slots immediately so
  // they (and everyone else) can grab them again without waiting for the sweep.
  app.post("/bookings/:id/abandon", { preHandler: app.authenticate }, async (req) => {
    const id = (req.params as any).id;
    const booking = await prisma.booking.findFirst({ where: { id, userId: req.userId!, status: "PENDING_PAYMENT" } });
    if (booking) await failBooking(id);
    return { ok: true };
  });

  // Move a (single-slot) confirmed booking to a new time on the same turf.
  // Atomic: claim the new slot first (unique index guards against a race), then
  // release the old one. Price/payment are unchanged — it's a courtesy move.
  app.post("/bookings/:id/reschedule", { preHandler: app.authenticate }, async (req, reply) => {
    const parse = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), hour: z.number().int() }).safeParse(req.body);
    if (!parse.success) return reply.code(400).send({ error: "bad_input" });
    const id = (req.params as any).id;
    const { date, hour } = parse.data;

    const booking = await prisma.booking.findFirst({
      where: { id, userId: req.userId! },
      include: { slots: { where: { status: "ACTIVE" } } },
    });
    if (!booking) return reply.code(404).send({ error: "not_found" });
    if (booking.status !== "CONFIRMED") return reply.code(400).send({ error: "not_reschedulable" });
    if (booking.slots.length !== 1) return reply.code(400).send({ error: "multi_slot" });
    if (hour < OPEN_HOUR || hour > CLOSE_HOUR) return reply.code(400).send({ error: "bad_hour" });
    if (hoursUntil(date, hour) < 0) return reply.code(400).send({ error: "slot_in_past" });

    const slot = booking.slots[0];
    if (slot.date === date && slot.hour === hour) return { ok: true }; // no-op

    try {
      await prisma.$transaction(async (tx) => {
        // Claim the new slot as BOOKED (throws SlotTakenError if already held).
        await claimSlots(tx, [{ turfId: slot.turfId, date, hour }], "BOOKED", { bookingId: booking.id });
        // Release the old hold and move the booking's slot.
        await tx.slotHold.deleteMany({ where: { bookingId: booking.id, turfId: slot.turfId, date: slot.date, hour: slot.hour } });
        await tx.bookingSlot.update({ where: { id: slot.id }, data: { date, hour, isPeak: isPeakHour(date, hour) } });
      });
    } catch (e) {
      if (e instanceof SlotTakenError) return reply.code(409).send({ code: "SLOT_TAKEN" });
      throw e;
    }
    return { ok: true };
  });

  app.get("/bookings", { preHandler: app.authenticate }, async (req) => {
    const tab = (req.query as any).tab === "past" ? "past" : "upcoming";
    const rows = await prisma.booking.findMany({
      where: { userId: req.userId!, status: { not: "PENDING_PAYMENT" } },
      include: { slots: true },
      orderBy: { createdAt: "desc" },
    });
    // Views need venue context for sport icons; group by venue.
    const venues = new Map<string, Awaited<ReturnType<typeof loadVenue>>>();
    const views = [];
    for (const b of rows) {
      if (!venues.has(b.venueId)) venues.set(b.venueId, await loadVenue(b.venueId));
      const v = venues.get(b.venueId);
      if (v) views.push(buildBookingView(b as any, v));
    }
    return { bookings: views.filter((v) => (tab === "past" ? v.past : !v.past)) };
  });

  app.get("/bookings/:id", { preHandler: app.authenticate }, async (req, reply) => {
    const b = await prisma.booking.findFirst({
      where: { id: (req.params as any).id, userId: req.userId! },
      include: { slots: true },
    });
    if (!b) return reply.code(404).send({ error: "not_found" });
    const v = await loadVenue(b.venueId);
    if (!v) return reply.code(404).send({ error: "not_found" });
    return buildBookingView(b as any, v);
  });

  app.post("/bookings/:id/cancel", { preHandler: app.authenticate }, async (req, reply) => {
    const id = (req.params as any).id;
    const b = await prisma.booking.findFirst({ where: { id, userId: req.userId! }, include: { slots: true } });
    if (!b) return reply.code(404).send({ error: "not_found" });
    if (b.status === "CANCELLED") return reply.code(400).send({ error: "already_cancelled" });

    // Refund per policy, using the earliest slot's start time.
    const venue = await loadVenue(b.venueId);
    const earliest = b.slots.reduce((a, s) => (hoursUntil(s.date, s.hour) < hoursUntil(a.date, a.hour) ? s : a), b.slots[0]);
    const freeHours = venue?.cancellationFreeHours ?? 6;
    const refundPct = earliest && hoursUntil(earliest.date, earliest.hour) >= freeHours ? 100 : (venue?.cancellationRefundPercent ?? 50);
    const refund = Math.round((b.amountPaidPaise * refundPct) / 100);

    await prisma.$transaction(async (tx) => {
      await tx.slotHold.deleteMany({ where: { bookingId: id } });
      await tx.bookingSlot.updateMany({ where: { bookingId: id }, data: { status: "CANCELLED", refundedPaise: refund } });
      await tx.booking.update({ where: { id }, data: { status: "CANCELLED", cancelledAt: new Date(), amountDuePaise: 0 } });
      if (refund > 0) {
        const pay = await tx.payment.findFirst({ where: { bookingId: id, status: "PAID" } });
        if (pay?.paymentId) {
          try { await payments.refund(pay.paymentId, refund); } catch { /* mock/no-op */ }
          await tx.payment.update({ where: { id: pay.id }, data: { status: "REFUNDED" } });
        }
      }
    });
    return { ok: true, refundPaise: refund, refundPercent: refundPct };
  });

  // Dev-only: simulate a captured mock payment (client calls this instead of the
  // real Razorpay widget when provider === "mock").
  if (payments.kind === "mock") {
    app.post("/dev/mock-payment/:bookingId/complete", { preHandler: app.authenticate }, async (req, reply) => {
      const bookingId = (req.params as any).bookingId;
      const booking = await prisma.booking.findFirst({ where: { id: bookingId, userId: req.userId! }, include: { payments: true } });
      if (!booking) return reply.code(404).send({ error: "not_found" });
      const order = booking.payments[0];
      if (!order) return reply.code(400).send({ error: "no_order" });
      const paymentId = "pay_mock_" + Date.now();
      const signature = mockSign(order.orderId, paymentId);
      if (!payments.verifySignature(order.orderId, paymentId, signature)) return reply.code(500).send({ error: "sign_failed" });
      await confirmPayment(bookingId, paymentId);
      return { ok: true };
    });
  }
}
