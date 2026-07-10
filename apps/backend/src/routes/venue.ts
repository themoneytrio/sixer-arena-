import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { loadVenue, buildVenueConfig, sportForTurf } from "../domain/venueView.js";
import { availabilityFor } from "../domain/availability.js";
import { upcomingDates, addDaysIso, hoursUntil } from "../domain/dates.js";
import { isPeakHour, slotPricePaise } from "../domain/pricing.js";
import { slotLabel, humanDate } from "@sixer/shared/format";

export async function venueRoutes(app: FastifyInstance) {
  // Single-venue bootstrap: the frontends resolve the default venue id here so
  // it never has to be hardcoded (it changes on each seed).
  app.get("/bootstrap", async (_req, reply) => {
    const v = await prisma.venue.findFirst({ orderBy: { createdAt: "asc" } });
    if (!v) return reply.code(404).send({ error: "no_venue" });
    return { venueId: v.id, name: v.name };
  });

  app.get("/venues/:id", async (req, reply) => {
    const v = await loadVenue((req.params as any).id);
    if (!v) return reply.code(404).send({ error: "not_found" });
    return buildVenueConfig(v);
  });

  // 7-day date strip (venue-tz) so the client doesn't compute dates itself.
  app.get("/venues/:id/dates", async () => {
    return { dates: upcomingDates(7) };
  });

  app.get("/venues/:id/availability", async (req, reply) => {
    const q = z
      .object({ turfId: z.string(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })
      .safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: "bad_query" });
    const v = await loadVenue((req.params as any).id);
    if (!v) return reply.code(404).send({ error: "not_found" });
    const { sport, turf } = sportForTurf(v, q.data.turfId);
    if (!turf) return reply.code(404).send({ error: "turf_not_found" });
    const slots = await availabilityFor(turf.id, sport.basePaise, q.data.date);
    return { turfId: turf.id, date: q.data.date, slots };
  });

  // Recurring preview: same weekday/hour across the next `weeks`, each marked
  // free or already-taken so the customer can confirm the set (blueprint §3.9).
  app.get("/venues/:id/recurring-preview", async (req, reply) => {
    const q = z
      .object({
        turfId: z.string(),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        hour: z.coerce.number().int(),
        weeks: z.coerce.number().int().min(2).max(12).default(4),
      })
      .safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: "bad_query" });
    const v = await loadVenue((req.params as any).id);
    if (!v) return reply.code(404).send({ error: "not_found" });
    const { sport, turf } = sportForTurf(v, q.data.turfId);
    if (!turf) return reply.code(404).send({ error: "turf_not_found" });

    const dates = Array.from({ length: q.data.weeks }, (_, i) => addDaysIso(q.data.date, i * 7));
    const holds = await prisma.slotHold.findMany({
      where: { turfId: turf.id, hour: q.data.hour, date: { in: dates } },
      select: { date: true },
    });
    const taken = new Set(holds.map((h) => h.date));
    const peak = isPeakHour(q.data.date, q.data.hour);
    const pricePaise = slotPricePaise(sport.basePaise, peak);

    return {
      turfId: turf.id,
      hour: q.data.hour,
      label: slotLabel(q.data.hour),
      weeks: dates.map((d, i) => ({
        week: i + 1,
        date: d,
        human: humanDate(d, q.data.date),
        available: !taken.has(d) && hoursUntil(d, q.data.hour) >= 0,
        pricePaise,
      })),
    };
  });
}
