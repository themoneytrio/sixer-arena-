import { config } from "../config.js";

/**
 * All day-boundary logic runs in the venue timezone (Asia/Kolkata by default),
 * not server-local/UTC — a naive new Date() on a UTC server shifts the day by
 * 5.5 hours and breaks "today", the 7-day strip, and hold-expiry.
 */
const fmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: config.venueTz,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Current date in the venue tz as YYYY-MM-DD. */
export function todayIso(): string {
  return fmt.format(new Date());
}

/** Add whole days to an ISO date string (tz-agnostic calendar math). */
export function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The next `count` ISO dates starting today (venue tz). */
export function upcomingDates(count: number): string[] {
  const start = todayIso();
  return Array.from({ length: count }, (_, i) => addDaysIso(start, i));
}

export function isWeekend(iso: string): boolean {
  const dow = new Date(iso + "T00:00:00Z").getUTCDay();
  return dow === 0 || dow === 6;
}

/** Venue-tz wall-clock hour "now" (0-23), for deciding if a slot has passed. */
export function currentHour(): number {
  const h = new Intl.DateTimeFormat("en-GB", {
    timeZone: config.venueTz,
    hour: "2-digit",
    hour12: false,
  }).format(new Date());
  return Number(h) % 24;
}

/** Whole-hour distance from "now" (venue tz) to a slot's start. Negative = past. */
export function hoursUntil(date: string, hour: number): number {
  const today = todayIso();
  const dayDiff = Math.round(
    (new Date(date + "T00:00:00Z").getTime() - new Date(today + "T00:00:00Z").getTime()) / 86400000
  );
  return dayDiff * 24 + (hour - currentHour());
}

export const OPEN_HOUR = 6;
export const CLOSE_HOUR = 23; // last bookable start hour (23–24 = 11 PM–midnight)
