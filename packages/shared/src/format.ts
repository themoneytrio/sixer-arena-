/** Formatting helpers ported verbatim from the prototype so display matches. */

/** Rupees → "₹1,540" (Indian digit grouping). Money is stored server-side in paise. */
export function money(rupees: number): string {
  return "₹" + Math.round(rupees).toLocaleString("en-IN");
}

/** Paise → "₹1,540". */
export function paiseToMoney(paise: number): string {
  return money(paise / 100);
}

function h12(h: number): { hr: number; ap: "AM" | "PM" } {
  const p = ((h % 24) + 24) % 24;
  const ap = p < 12 ? "AM" : "PM";
  let hr = p % 12;
  if (hr === 0) hr = 12;
  return { hr, ap: ap as "AM" | "PM" };
}

/** Hour 20 → "8 – 9 PM"; hour 11 → "11AM – 12PM". */
export function slotLabel(h: number): string {
  const a = h12(h);
  const b = h12(h + 1);
  return a.ap === b.ap ? `${a.hr} – ${b.hr} ${b.ap}` : `${a.hr}${a.ap} – ${b.hr}${b.ap}`;
}

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** ISO date (YYYY-MM-DD) → "Sat 28 Jun". */
export function humanDate(iso: string, todayIso?: string): string {
  const d = new Date(iso + "T00:00:00");
  const dow = iso === todayIso ? "Today" : DOW[d.getDay()];
  return `${dow} ${d.getDate()} ${MO[d.getMonth()]}`;
}

export { DOW, MO };
