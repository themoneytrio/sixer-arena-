import { isWeekend } from "./dates.js";

/**
 * SINGLE SOURCE OF TRUTH for peak windows + pricing + deposit.
 * Ported from the consumer prototype's renderVals()/slotState()/slotPrice().
 * The prototype had two DIFFERENT peak windows (consumer 17–21 vs owner walk-in
 * 17–22); this consolidates on the consumer definition and every surface
 * (availability, checkout, walk-in, analytics) imports from here so they cannot
 * drift again. Clients only display prices; they never compute them.
 */

/** Peak = weekday 17:00–21:00, OR weekend widened to 15:00–21:00. */
export function isPeakHour(iso: string, hour: number): boolean {
  const weekend = isWeekend(iso);
  return (hour >= 17 && hour <= 21) || (weekend && hour >= 15 && hour <= 21);
}

/** Peak surcharge +35%, rounded to the nearest ₹10 (1000 paise). */
export function slotPricePaise(basePaise: number, peak: boolean): number {
  const raw = peak ? basePaise * 1.35 : basePaise;
  return Math.round(raw / 1000) * 1000;
}

/** Convenience fee is flat per booking (prototype: ₹30) when the cart is non-empty. */
export function feePaise(itemCount: number, venueFeePaise: number): number {
  return itemCount > 0 ? venueFeePaise : 0;
}

/** Deposit to lock the slot online: depositPercent of the grand total, nearest ₹10. */
export function depositPaise(grandPaise: number, depositPercent: number): number {
  return Math.round((grandPaise * depositPercent) / 100 / 1000) * 1000;
}
