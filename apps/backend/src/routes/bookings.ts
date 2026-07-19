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
import { confirmPayment, failBooking, failPayment } from "../domain/confirm.js";
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
  payMode: z.enum(["deposit", "full"]).default("deposit"),
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
      const pay = existing.payments.find((p) => p.status === "CREATED") ?? existing.payments[0];
      return {
        bookingId: existing.id,
        code: existing.code,
        provider: payments.kind,
        orderId: pay?.orderId ?? "",
        keyId: config.razorpay.keyId || undefined,
        depositPaise: existing.depositPaise,
        payablePaise: pay?.amountPaise ?? existing.depositPaise,
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
    // Server-authoritative amount charged now — the client only picks the mode.
    const payable = body.payMode === "full" ? total : deposit;
    // Razorpay's minimum order is ₹1. A 100% coupon can shrink below that.
    if (payable < 100 && body.payMode === "deposit") return reply.code(400).send({ error: "amount_too_small" });
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
      // Fully-discounted full payment (below Razorpay's ₹1 minimum): nothing to
      // charge — confirm the booking directly without an order.
      if (payable < 100) {
        const orderId = "order_free_" + bookingId;
        await prisma.payment.create({
          data: { bookingId, provider: payments.kind === "razorpay" ? "RAZORPAY" : "MOCK", orderId, amountPaise: 0, status: "CREATED" },
        });
        await confirmPayment(orderId, "free_" + bookingId);
        return {
          bookingId,
          code,
          provider: payments.kind,
          orderId,
          keyId: config.razorpay.keyId || undefined,
          depositPaise: deposit,
          payablePaise: 0,
          totalPaise: total,
        };
      }
      const order = await payments.createOrder(payable, code, { bookingId });
      await prisma.payment.create({
        data: { bookingId, provider: payments.kind === "razorpay" ? "RAZORPAY" : "MOCK", orderId: order.orderId, amountPaise: payable },
      });
      return {
        bookingId,
        code,
        provider: order.provider,
        orderId: order.orderId,
        keyId: order.keyId,
        depositPaise: deposit,
        payablePaise: payable,
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
      // A garbled callback on a confirmed booking (balance payment) must never
      // cancel the booking — only void that payment attempt.
      if (booking.status === "PENDING_PAYMENT") await failBooking(id);
      else await failPayment(razorpay_order_id);
      return reply.code(400).send({ error: "bad_signature" });
    }
    await confirmPayment(razorpay_order_id, razorpay_payment_id, {
      signature: razorpay_signature,
      raw: parse.data,
    });
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

  // Pay the remaining balance online (the deposit flow only collects part of
  // the total; the rest is normally cash at the turf). Creates a fresh order +
  // Payment row; verification reuses /verify-payment and the webhook.
  app.post("/bookings/:id/pay-balance", { preHandler: app.authenticate }, async (req, reply) => {
    const id = (req.params as any).id;
    const booking = await prisma.booking.findFirst({ where: { id, userId: req.userId! } });
    if (!booking) return reply.code(404).send({ error: "not_found" });
    if (booking.status !== "CONFIRMED") return reply.code(400).send({ error: "not_payable" });
    // Also the answer to the owner-cash race: once the owner marks the balance
    // collected in cash, starting an online payment 400s and the client refreshes.
    if (booking.amountDuePaise <= 0) return reply.code(400).send({ error: "nothing_due" });

    const due = booking.amountDuePaise;
    // Reuse-or-supersede: a double-tap must not create duplicate Razorpay orders.
    const open = await prisma.payment.findFirst({
      where: { bookingId: id, status: "CREATED" },
      orderBy: { createdAt: "desc" },
    });
    if (open) {
      if (open.amountPaise === due) {
        return {
          bookingId: id,
          provider: payments.kind,
          orderId: open.orderId,
          keyId: config.razorpay.keyId || undefined,
          amountPaise: due,
        };
      }
      // Stale amount (due changed since the order was created) — void it.
      await prisma.payment.update({ where: { id: open.id }, data: { status: "FAILED" } });
    }

    try {
      const order = await payments.createOrder(due, booking.code + "-BAL", { bookingId: id });
      await prisma.payment.create({
        data: { bookingId: id, provider: payments.kind === "razorpay" ? "RAZORPAY" : "MOCK", orderId: order.orderId, amountPaise: due },
      });
      return {
        bookingId: id,
        provider: order.provider,
        orderId: order.orderId,
        keyId: order.keyId,
        amountPaise: due,
      };
    } catch {
      // Booking is confirmed and must survive a failed order creation.
      return reply.code(502).send({ error: "payment_init_failed" });
    }
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

    // Issue refunds BEFORE mutating anything, and never inside the transaction
    // (no network calls in a DB transaction). If any refund call fails we abort
    // with nothing changed — the booking stays CONFIRMED and cancel is retried.
    // Split newest-first across all PAID payments (deposit + balance), capped
    // at what each payment has left to refund.
    const issued: { paymentDbId: string; refundId: string; part: number }[] = [];
    if (refund > 0) {
      const paid = await prisma.payment.findMany({
        where: { bookingId: id, status: "PAID" },
        orderBy: { createdAt: "desc" },
      });
      let remaining = refund;
      for (const p of paid) {
        if (remaining <= 0) break;
        const part = Math.min(remaining, p.amountPaise - p.refundedPaise);
        if (part <= 0 || !p.paymentId) continue;
        try {
          const { refundId } = await payments.refund(p.paymentId, part);
          issued.push({ paymentDbId: p.id, refundId, part });
          remaining -= part;
        } catch {
          return reply.code(502).send({ error: "refund_failed" });
        }
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.slotHold.deleteMany({ where: { bookingId: id } });
      await tx.bookingSlot.updateMany({ where: { bookingId: id }, data: { status: "CANCELLED", refundedPaise: refund } });
      await tx.booking.update({ where: { id }, data: { status: "CANCELLED", cancelledAt: new Date(), amountDuePaise: 0 } });
      for (const r of issued) {
        await tx.payment.update({
          where: { id: r.paymentDbId },
          data: { status: "REFUNDED", refundId: r.refundId, refundedPaise: r.part },
        });
      }
      // If this tx fails after refunds went through, the refund.processed
      // webhook stamps the payment rows anyway (self-healing).
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
      const order = booking.payments.find((p) => p.status === "CREATED");
      if (!order) return reply.code(400).send({ error: "no_order" });
      const paymentId = "pay_mock_" + Date.now();
      const signature = mockSign(order.orderId, paymentId);
      if (!payments.verifySignature(order.orderId, paymentId, signature)) return reply.code(500).send({ error: "sign_failed" });
      await confirmPayment(order.orderId, paymentId, { signature });
      return { ok: true };
    });
  }
}
