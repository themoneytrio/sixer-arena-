import { prisma } from "../db.js";
import { slotLabel } from "@sixer/shared/format";
import type { AvailabilitySlot } from "@sixer/shared/types";
import { OPEN_HOUR, CLOSE_HOUR, todayIso, currentHour } from "./dates.js";
import { isPeakHour, slotPricePaise } from "./pricing.js";

/**
 * Real availability derived from SlotHold presence — never randomly seeded like
 * the prototype. A slot is "full" if a HELD/BOOKED row exists, "blocked" if a
 * BLOCKED row exists, "peak"/"open" otherwise. Past hours today are disabled.
 */
export async function availabilityFor(turfId: string, basePaise: number, date: string): Promise<AvailabilitySlot[]> {
  const holds = await prisma.slotHold.findMany({ where: { turfId, date } });
  const byHour = new Map(holds.map((h) => [h.hour, h.status]));
  const now = todayIso();
  const nowHour = currentHour();

  const out: AvailabilitySlot[] = [];
  for (let hour = OPEN_HOUR; hour <= CLOSE_HOUR; hour++) {
    const peak = isPeakHour(date, hour);
    const pricePaise = slotPricePaise(basePaise, peak);
    const held = byHour.get(hour);
    const isPast = date === now && hour <= nowHour;

    let status: AvailabilitySlot["status"];
    if (held === "BLOCKED") status = "blocked";
    else if (held === "HELD" || held === "BOOKED" || isPast) status = "full";
    else status = peak ? "peak" : "open";

    out.push({ hour, label: slotLabel(hour), pricePaise, status, isPeak: peak });
  }
  return out;
}
