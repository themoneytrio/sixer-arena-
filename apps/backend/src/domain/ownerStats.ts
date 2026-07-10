import { prisma } from "../db.js";
import { slotLabel, humanDate, DOW } from "@sixer/shared/format";
import type { DashboardResponse, AnalyticsResponse, OwnerBookingRow } from "@sixer/shared/types";
import { OPEN_HOUR, CLOSE_HOUR, addDaysIso, todayIso } from "./dates.js";
import { loadVenue, type LoadedVenue } from "./venueView.js";

const HOURS = Array.from({ length: CLOSE_HOUR - OPEN_HOUR + 1 }, (_, i) => OPEN_HOUR + i);

/** Gross ground revenue = sum of ACTIVE (non-cancelled) booking-slot prices on
 *  the given dates. Kept separate from "amount collected" so occupancy and
 *  revenue read consistently. */
async function slotsOnDates(venueId: string, dates: string[]) {
  const turfIds = (await prisma.turf.findMany({ where: { venueId }, select: { id: true } })).map((t) => t.id);
  return prisma.bookingSlot.findMany({
    where: { turfId: { in: turfIds }, date: { in: dates }, status: "ACTIVE", booking: { status: { not: "CANCELLED" } } },
    include: { booking: { select: { id: true, source: true, customerName: true, customerPhone: true, status: true, createdAt: true, totalPaise: true, amountDuePaise: true } } },
  });
}

export async function buildDashboard(venueId: string, date: string): Promise<DashboardResponse> {
  const venue = (await loadVenue(venueId))!;
  const last7 = Array.from({ length: 7 }, (_, i) => addDaysIso(date, -(6 - i)));
  const slots = await slotsOnDates(venueId, [...new Set([...last7, addDaysIso(date, -7)])]);

  const revBy = (d: string) => slots.filter((s) => s.date === d).reduce((a, s) => a + s.pricePaise, 0);
  const revenueToday = revBy(date);
  const prevWeek = revBy(addDaysIso(date, -7));
  const monthStart = date.slice(0, 8) + "01";
  const monthSlots = await slotsOnDates(venueId, monthDates(date));
  const revenueMonth = monthSlots.reduce((a, s) => a + s.pricePaise, 0);

  const todaySlots = slots.filter((s) => s.date === date);
  const totalCapacity = venue.turfs.length * HOURS.length;
  const occupancy = totalCapacity ? Math.round((todaySlots.length / totalCapacity) * 100) : 0;
  const bookingIds = new Set(todaySlots.map((s) => s.booking.id));

  // Busiest hour today.
  const hourCounts = new Map<number, number>();
  for (const s of todaySlots) hourCounts.set(s.hour, (hourCounts.get(s.hour) ?? 0) + 1);
  let peakHour = 19;
  let peakMax = -1;
  for (const [h, c] of hourCounts) if (c > peakMax) { peakMax = c; peakHour = h; }

  // Today's bookings feed (dedup by booking, most recent first).
  const seen = new Set<string>();
  const todaysBookings: OwnerBookingRow[] = [];
  for (const s of [...todaySlots].sort((a, b) => b.booking.createdAt.getTime() - a.booking.createdAt.getTime())) {
    if (seen.has(s.booking.id)) continue;
    seen.add(s.booking.id);
    const sport = sportForTurfId(venue, s.turfId);
    todaysBookings.push({
      id: s.booking.id,
      customerName: s.booking.customerName,
      customerPhone: s.booking.customerPhone,
      sportIcon: sport.icon,
      title: `${sport.name} · ${slotLabel(s.hour)}`,
      date: s.date,
      totalPaise: s.booking.totalPaise,
      amountDuePaise: s.booking.amountDuePaise,
      status: s.booking.status as any,
      source: s.booking.source as any,
      createdAt: s.booking.createdAt.toISOString(),
    });
  }

  // Slot-control strip per turf.
  const holds = await prisma.slotHold.findMany({ where: { turf: { venueId }, date } });
  const holdMap = new Map(holds.map((h) => [`${h.turfId}|${h.hour}`, h.status]));
  const slotControl = venue.turfs.map((t) => ({
    turfId: t.id,
    turfName: t.name,
    slots: HOURS.map((h) => {
      const st = holdMap.get(`${t.id}|${h}`);
      return { hour: h, label: slotLabel(h), status: (st === "BLOCKED" ? "blocked" : st ? "booked" : "open") as "open" | "booked" | "blocked" };
    }),
  }));

  return {
    date,
    revenueTodayPaise: revenueToday,
    revenueDeltaPct: prevWeek ? Math.round(((revenueToday - prevWeek) / prevWeek) * 100) : 0,
    revenueMonthPaise: revenueMonth,
    occupancyPct: occupancy,
    bookingsToday: bookingIds.size,
    peakHourLabel: slotLabel(peakHour),
    last7Days: last7.map((d) => ({ date: d, label: humanDate(d, todayIso()).replace(/^Today /, ""), revenuePaise: revBy(d), isToday: d === date })),
    todaysBookings,
    slotControl,
  };
}

export async function buildAnalytics(venueId: string, range: "day" | "week" | "month", anchor: string): Promise<AnalyticsResponse> {
  const venue = (await loadVenue(venueId))!;
  const dates = range === "day" ? [anchor] : range === "week" ? week(anchor) : monthDates(anchor);
  const slots = await slotsOnDates(venueId, dates);

  const revenue = slots.reduce((a, s) => a + s.pricePaise, 0);
  const bookingIds = new Set(slots.map((s) => s.booking.id));
  const online = new Set(slots.filter((s) => s.booking.source === "ONLINE").map((s) => s.booking.id)).size;
  const walkin = new Set(slots.filter((s) => s.booking.source === "WALKIN").map((s) => s.booking.id)).size;
  const totalBk = bookingIds.size || 1;

  // Heatmap: day-of-week × hour occupancy over the range.
  const capacityPerDay = venue.turfs.length;
  const heatCells = new Map<string, number>();
  for (const s of slots) {
    const dow = DOW[new Date(s.date + "T00:00:00Z").getUTCDay()];
    heatCells.set(`${dow}|${s.hour}`, (heatCells.get(`${dow}|${s.hour}`) ?? 0) + 1);
  }
  const daysInRange = new Map<string, number>();
  for (const d of dates) {
    const dow = DOW[new Date(d + "T00:00:00Z").getUTCDay()];
    daysInRange.set(dow, (daysInRange.get(dow) ?? 0) + 1);
  }
  const heatmap = DOW.map((day) => ({
    day,
    hours: HOURS.map((hour) => {
      const cnt = heatCells.get(`${day}|${hour}`) ?? 0;
      const cap = (daysInRange.get(day) ?? 0) * capacityPerDay || 1;
      return { hour, occupancy: Math.min(1, cnt / cap) };
    }),
  }));

  const bySportMap = new Map<string, number>();
  for (const s of slots) {
    const sp = sportForTurfId(venue, s.turfId);
    bySportMap.set(sp.id, (bySportMap.get(sp.id) ?? 0) + s.pricePaise);
  }
  const bySport = venue.sports.map((sp) => ({ sportId: sp.id, name: sp.name, icon: sp.icon, revenuePaise: bySportMap.get(sp.id) ?? 0 }));

  return {
    range,
    revenuePaise: revenue,
    bookings: bookingIds.size,
    avgBookingValuePaise: Math.round(revenue / totalBk),
    onlinePct: Math.round((online / totalBk) * 100),
    walkinPct: Math.round((walkin / totalBk) * 100),
    heatmap,
    bySport,
  };
}

function sportForTurfId(venue: LoadedVenue, turfId: string) {
  const t = venue.turfs.find((x) => x.id === turfId);
  return venue.sports.find((s) => s.id === t?.sportId) ?? venue.sports[0];
}
function week(anchor: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDaysIso(anchor, -(6 - i)));
}
function monthDates(anchor: string): string[] {
  const [y, m] = anchor.split("-").map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: days }, (_, i) => `${anchor.slice(0, 8)}${String(i + 1).padStart(2, "0")}`);
}
