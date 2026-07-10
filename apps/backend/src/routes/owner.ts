import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { loadVenue, buildVenueConfig, sportForTurf } from "../domain/venueView.js";
import { buildDashboard, buildAnalytics } from "../domain/ownerStats.js";
import { claimSlots, findConflicts, SlotTakenError } from "../domain/claim.js";
import { isPeakHour, slotPricePaise } from "../domain/pricing.js";
import { OPEN_HOUR, CLOSE_HOUR, todayIso, hoursUntil } from "../domain/dates.js";
import { generateBookingCode, generateEntryCode } from "../domain/codes.js";
import { slotLabel } from "@sixer/shared/format";

export async function ownerRoutes(app: FastifyInstance) {
  const guard = { preHandler: app.requireVenueMember };

  app.get("/owner/venues/:venueId/config", guard, async (req, reply) => {
    const v = await loadVenue((req.params as any).venueId);
    if (!v) return reply.code(404).send({ error: "not_found" });
    return buildVenueConfig(v);
  });

  app.get("/owner/venues/:venueId/dashboard", guard, async (req) => {
    const date = ((req.query as any).date as string) || todayIso();
    return buildDashboard((req.params as any).venueId, date);
  });

  app.get("/owner/venues/:venueId/analytics", guard, async (req) => {
    const range = (["day", "week", "month"].includes((req.query as any).range) ? (req.query as any).range : "week") as any;
    return buildAnalytics((req.params as any).venueId, range, todayIso());
  });

  // Bookings list with filters + search.
  app.get("/owner/venues/:venueId/bookings", guard, async (req) => {
    const q = req.query as any;
    const venueId = (req.params as any).venueId;
    const where: any = { venueId, status: { not: "PENDING_PAYMENT" } };
    if (q.source === "online") where.source = "ONLINE";
    if (q.source === "walkin") where.source = "WALKIN";
    if (q.status && ["CONFIRMED", "CANCELLED", "COMPLETED"].includes(q.status)) where.status = q.status;
    if (q.due === "1") where.amountDuePaise = { gt: 0 };
    if (q.search) where.OR = [
      { customerName: { contains: q.search, mode: "insensitive" } },
      { customerPhone: { contains: q.search } },
    ];
    const venue = (await loadVenue(venueId))!;
    const rows = await prisma.booking.findMany({ where, include: { slots: true }, orderBy: { createdAt: "desc" }, take: 200 });
    return {
      bookings: rows.map((b) => {
        const first = b.slots[0];
        const sp = venue.sports.find((s) => s.id === venue.turfs.find((t) => t.id === first?.turfId)?.sportId) ?? venue.sports[0];
        return {
          id: b.id,
          customerName: b.customerName,
          customerPhone: b.customerPhone,
          sportIcon: sp.icon,
          title: `${sp.name} · ${first ? slotLabel(first.hour) : ""}`,
          date: first?.date ?? "",
          totalPaise: b.totalPaise,
          amountDuePaise: b.amountDuePaise,
          status: b.status,
          source: b.source,
          createdAt: b.createdAt.toISOString(),
        };
      }),
    };
  });

  // Mark a due booking as paid (walk-in cash collected, or online deposit balance).
  app.post("/owner/venues/:venueId/bookings/:id/mark-paid", guard, async (req, reply) => {
    const { venueId, id } = req.params as any;
    const b = await prisma.booking.findFirst({ where: { id, venueId } });
    if (!b) return reply.code(404).send({ error: "not_found" });
    await prisma.booking.update({ where: { id }, data: { amountPaidPaise: b.totalPaise, amountDuePaise: 0 } });
    return { ok: true };
  });

  // Calendar for ANY date (the prototype hardcoded today).
  app.get("/owner/venues/:venueId/calendar", guard, async (req, reply) => {
    const venueId = (req.params as any).venueId;
    const date = ((req.query as any).date as string) || todayIso();
    const venue = await loadVenue(venueId);
    if (!venue) return reply.code(404).send({ error: "not_found" });
    const holds = await prisma.slotHold.findMany({ where: { turf: { venueId }, date }, include: { booking: { select: { customerName: true } } } });
    const map = new Map(holds.map((h) => [`${h.turfId}|${h.hour}`, h]));
    const hours = Array.from({ length: CLOSE_HOUR - OPEN_HOUR + 1 }, (_, i) => OPEN_HOUR + i);
    return {
      date,
      turfs: venue.turfs.map((t) => ({
        turfId: t.id,
        turfName: t.name,
        cells: hours.map((h) => {
          const held = map.get(`${t.id}|${h}`);
          return {
            hour: h,
            label: slotLabel(h),
            status: held ? (held.status === "BLOCKED" ? "blocked" : "booked") : "open",
            customer: held?.booking?.customerName ?? null,
          };
        }),
      })),
    };
  });

  const cellSchema = z.object({ turfId: z.string(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), hour: z.number().int() });

  app.post("/owner/venues/:venueId/slots/block", guard, async (req, reply) => {
    const p = cellSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "bad_input" });
    try {
      await prisma.$transaction((tx) => claimSlots(tx, [p.data], "BLOCKED"));
    } catch (e) {
      if (e instanceof SlotTakenError) return reply.code(409).send({ error: "slot_taken" });
      throw e;
    }
    return { ok: true };
  });

  app.post("/owner/venues/:venueId/slots/unblock", guard, async (req, reply) => {
    const p = cellSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "bad_input" });
    await prisma.slotHold.deleteMany({ where: { turfId: p.data.turfId, date: p.data.date, hour: p.data.hour, status: "BLOCKED" } });
    return { ok: true };
  });

  // Walk-in — SAME claim path as consumer checkout, so online + offline never clash.
  const walkinSchema = z.object({
    turfId: z.string(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    hour: z.number().int(),
    customerName: z.string().min(1).max(60),
    customerPhone: z.string().max(15).optional().default(""),
    paid: z.boolean(),
  });
  app.post("/owner/venues/:venueId/walkins", guard, async (req, reply) => {
    const p = walkinSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "bad_input" });
    const venueId = (req.params as any).venueId;
    const venue = await loadVenue(venueId);
    if (!venue) return reply.code(404).send({ error: "not_found" });
    const { sport, turf } = sportForTurf(venue, p.data.turfId);
    if (!turf) return reply.code(400).send({ error: "bad_turf" });
    if (hoursUntil(p.data.date, p.data.hour) < 0) return reply.code(400).send({ error: "slot_in_past" });
    const peak = isPeakHour(p.data.date, p.data.hour);
    const price = slotPricePaise(sport.basePaise, peak);
    const code = await generateBookingCode();

    try {
      const booking = await prisma.$transaction(async (tx) => {
        const bk = await tx.booking.create({
          data: {
            code,
            entryCode: generateEntryCode(),
            venueId,
            source: "WALKIN",
            status: "CONFIRMED",
            customerName: p.data.customerName,
            customerPhone: p.data.customerPhone,
            subtotalPaise: price,
            feePaise: 0,
            totalPaise: price,
            depositPaise: 0,
            amountPaidPaise: p.data.paid ? price : 0,
            amountDuePaise: p.data.paid ? 0 : price,
            slots: { create: [{ turfId: turf.id, date: p.data.date, hour: p.data.hour, pricePaise: price, isPeak: peak }] },
          },
        });
        await claimSlots(tx, [{ turfId: turf.id, date: p.data.date, hour: p.data.hour }], "BOOKED", { bookingId: bk.id });
        return bk;
      });
      return { ok: true, bookingId: booking.id, code, pricePaise: price };
    } catch (e) {
      if (e instanceof SlotTakenError) {
        const conflicts = await findConflicts([p.data]);
        return reply.code(409).send({ code: "SLOT_TAKEN", conflicts });
      }
      throw e;
    }
  });

  // ---- Venue setup CRUD (config-driven; keeps at least one sport & turf) ----
  const sportBody = z.object({ name: z.string().min(1), sub: z.string().default(""), icon: z.string().default("🏏"), basePaise: z.number().int().positive() });
  app.post("/owner/venues/:venueId/sports", guard, async (req, reply) => {
    const p = sportBody.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "bad_input" });
    const venueId = (req.params as any).venueId;
    const count = await prisma.sport.count({ where: { venueId } });
    const s = await prisma.sport.create({ data: { venueId, ...p.data, sortOrder: count } });
    return s;
  });
  app.patch("/owner/venues/:venueId/sports/:sportId", guard, async (req, reply) => {
    const p = sportBody.partial().safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "bad_input" });
    const s = await prisma.sport.update({ where: { id: (req.params as any).sportId }, data: p.data });
    return s;
  });
  app.delete("/owner/venues/:venueId/sports/:sportId", guard, async (req, reply) => {
    const venueId = (req.params as any).venueId;
    if ((await prisma.sport.count({ where: { venueId, active: true } })) <= 1) return reply.code(409).send({ error: "last_sport" });
    const sportId = (req.params as any).sportId;
    await prisma.turf.updateMany({ where: { sportId }, data: { active: false } });
    await prisma.sport.update({ where: { id: sportId }, data: { active: false } });
    return { ok: true };
  });

  const turfBody = z.object({ name: z.string().min(1), sportId: z.string(), surface: z.string().default("Astro · floodlit"), icon: z.string().default("🏏") });
  app.post("/owner/venues/:venueId/turfs", guard, async (req, reply) => {
    const p = turfBody.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "bad_input" });
    const t = await prisma.turf.create({ data: { venueId: (req.params as any).venueId, ...p.data } });
    return t;
  });
  app.patch("/owner/venues/:venueId/turfs/:turfId", guard, async (req, reply) => {
    const p = turfBody.partial().safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "bad_input" });
    const t = await prisma.turf.update({ where: { id: (req.params as any).turfId }, data: p.data });
    return t;
  });
  app.delete("/owner/venues/:venueId/turfs/:turfId", guard, async (req, reply) => {
    const venueId = (req.params as any).venueId;
    if ((await prisma.turf.count({ where: { venueId, active: true } })) <= 1) return reply.code(409).send({ error: "last_turf" });
    await prisma.turf.update({ where: { id: (req.params as any).turfId }, data: { active: false } });
    return { ok: true };
  });

  // ---- Payments & payouts (§4.10): transactions, dues, refunds ----
  app.get("/owner/venues/:venueId/payments", guard, async (req) => {
    const venueId = (req.params as any).venueId;
    const [payments, bookings] = await Promise.all([
      prisma.payment.findMany({
        where: { booking: { venueId } },
        include: { booking: { select: { code: true, customerName: true, totalPaise: true, status: true } } },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
      prisma.booking.findMany({
        where: { venueId, status: { in: ["CONFIRMED", "COMPLETED", "CANCELLED"] } },
        include: { slots: { select: { refundedPaise: true } } },
      }),
    ]);

    // Summary: online deposits captured, walk-in cash, outstanding dues, refunds.
    let onlineCollected = 0, cashCollected = 0, pendingDues = 0, refunded = 0;
    for (const b of bookings) {
      if (b.status === "CANCELLED") {
        refunded += b.slots.reduce((a, s) => Math.max(a, s.refundedPaise), 0); // refund stored per booking
        continue;
      }
      if (b.source === "ONLINE") onlineCollected += b.amountPaidPaise;
      else cashCollected += b.amountPaidPaise;
      pendingDues += b.amountDuePaise;
    }

    const dues = bookings
      .filter((b) => b.status !== "CANCELLED" && b.amountDuePaise > 0)
      .sort((a, b) => b.amountDuePaise - a.amountDuePaise)
      .slice(0, 50)
      .map((b) => ({
        bookingId: b.id,
        code: b.code,
        customerName: b.customerName,
        source: b.source,
        totalPaise: b.totalPaise,
        duePaise: b.amountDuePaise,
      }));

    return {
      summary: { onlineCollectedPaise: onlineCollected, cashCollectedPaise: cashCollected, pendingDuesPaise: pendingDues, refundedPaise: refunded },
      transactions: payments.map((p) => ({
        id: p.id,
        orderId: p.orderId,
        provider: p.provider,
        status: p.status,
        amountPaise: p.amountPaise,
        createdAt: p.createdAt.toISOString(),
        bookingCode: p.booking.code,
        customerName: p.booking.customerName,
      })),
      dues,
    };
  });

  // ---- Customers: everyone who's booked, keyed by phone (§4.9) ----
  app.get("/owner/venues/:venueId/customers", guard, async (req) => {
    const venueId = (req.params as any).venueId;
    const search = ((req.query as any).search as string | undefined)?.trim();
    const bookings = await prisma.booking.findMany({
      where: { venueId, status: { in: ["CONFIRMED", "COMPLETED"] } },
      include: { slots: { select: { date: true } } },
      orderBy: { createdAt: "desc" },
    });
    const tags = new Set(
      (await prisma.regularTag.findMany({ where: { venueId }, select: { phone: true } })).map((t) => t.phone)
    );
    const byPhone = new Map<
      string,
      { name: string; phone: string; bookings: number; spentPaise: number; duePaise: number; lastVisit: string; online: number; walkin: number }
    >();
    for (const b of bookings) {
      const key = b.customerPhone || `anon-${b.customerName}`;
      const latestSlot = b.slots.reduce((a, s) => (s.date > a ? s.date : a), b.slots[0]?.date ?? "");
      const cur = byPhone.get(key) ?? {
        name: b.customerName, // newest booking wins the display name (list is desc)
        phone: b.customerPhone,
        bookings: 0,
        spentPaise: 0,
        duePaise: 0,
        lastVisit: "",
        online: 0,
        walkin: 0,
      };
      cur.bookings += 1;
      cur.spentPaise += b.totalPaise;
      cur.duePaise += b.amountDuePaise;
      if (latestSlot > cur.lastVisit) cur.lastVisit = latestSlot;
      if (b.source === "ONLINE") cur.online += 1;
      else cur.walkin += 1;
      byPhone.set(key, cur);
    }
    let customers = [...byPhone.values()].map((c) => ({ ...c, regular: tags.has(c.phone) }));
    if (search) {
      const s = search.toLowerCase();
      customers = customers.filter((c) => c.name.toLowerCase().includes(s) || c.phone.includes(s));
    }
    // Most recently active first (so a customer who just booked shows at the
    // top), with total spent as the tie-breaker.
    customers.sort((a, b) => b.lastVisit.localeCompare(a.lastVisit) || b.spentPaise - a.spentPaise);
    return { customers };
  });

  app.post("/owner/venues/:venueId/customers/:phone/tag", guard, async (req, reply) => {
    const p = z.object({ regular: z.boolean() }).safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "bad_input" });
    const venueId = (req.params as any).venueId;
    const phone = (req.params as any).phone;
    if (p.data.regular) {
      await prisma.regularTag.upsert({
        where: { venueId_phone: { venueId, phone } },
        update: {},
        create: { venueId, phone },
      });
    } else {
      await prisma.regularTag.deleteMany({ where: { venueId, phone } });
    }
    return { ok: true };
  });

  // ---- Pricing: deposit %, convenience fee, and coupons ----
  app.patch("/owner/venues/:venueId/settings", guard, async (req, reply) => {
    const p = z.object({ depositPercent: z.number().int().min(0).max(100).optional(), convenienceFeePaise: z.number().int().min(0).max(100000).optional() }).safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "bad_input" });
    const v = await prisma.venue.update({ where: { id: (req.params as any).venueId }, data: p.data });
    return { depositPercent: v.depositPercent, convenienceFeePaise: v.convenienceFeePaise };
  });

  app.get("/owner/venues/:venueId/coupons", guard, async (req) => {
    const coupons = await prisma.coupon.findMany({ where: { venueId: (req.params as any).venueId }, orderBy: { createdAt: "desc" } });
    return { coupons: coupons.map((c) => ({ ...c, validUntil: c.validUntil?.toISOString() ?? null })) };
  });

  const couponBody = z.object({
    code: z.string().min(3).max(20),
    percentOff: z.number().int().min(1).max(100),
    maxDiscountPaise: z.number().int().positive().nullable().optional(),
    minSubtotalPaise: z.number().int().min(0).optional(),
    usageCap: z.number().int().positive().nullable().optional(),
  });
  app.post("/owner/venues/:venueId/coupons", guard, async (req, reply) => {
    const p = couponBody.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "bad_input" });
    const venueId = (req.params as any).venueId;
    const code = p.data.code.trim().toUpperCase();
    const exists = await prisma.coupon.findUnique({ where: { venueId_code: { venueId, code } } });
    if (exists) return reply.code(409).send({ error: "duplicate_code" });
    const c = await prisma.coupon.create({ data: { venueId, ...p.data, code } });
    return c;
  });
  app.patch("/owner/venues/:venueId/coupons/:couponId", guard, async (req, reply) => {
    const p = z.object({ active: z.boolean() }).safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "bad_input" });
    const c = await prisma.coupon.update({ where: { id: (req.params as any).couponId }, data: { active: p.data.active } });
    return c;
  });
  app.delete("/owner/venues/:venueId/coupons/:couponId", guard, async (req) => {
    await prisma.coupon.delete({ where: { id: (req.params as any).couponId } });
    return { ok: true };
  });
}
