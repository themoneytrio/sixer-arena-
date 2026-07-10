import { humanDate, slotLabel } from "@sixer/shared/format";
import type { BookingView } from "@sixer/shared/types";
import { todayIso, currentHour } from "./dates.js";
import type { LoadedVenue } from "./venueView.js";

type BookingWithSlots = {
  id: string;
  code: string;
  entryCode: string;
  status: "PENDING_PAYMENT" | "CONFIRMED" | "CANCELLED" | "COMPLETED";
  source: "ONLINE" | "WALKIN";
  customerName: string;
  teamName: string | null;
  subtotalPaise: number;
  feePaise: number;
  discountPaise: number;
  couponCode: string | null;
  totalPaise: number;
  depositPaise: number;
  amountPaidPaise: number;
  amountDuePaise: number;
  createdAt: Date;
  slots: {
    turfId: string;
    date: string;
    hour: number;
    pricePaise: number;
    isPeak: boolean;
    status: "ACTIVE" | "CANCELLED";
  }[];
};

/** A booking is "past" (My Bookings → Past tab) if cancelled/completed, or its
 *  latest slot has already started. */
export function isPast(b: BookingWithSlots): boolean {
  if (b.status === "CANCELLED" || b.status === "COMPLETED") return true;
  const today = todayIso();
  const nowH = currentHour();
  const latest = b.slots.reduce(
    (acc, s) => (s.date > acc.date || (s.date === acc.date && s.hour > acc.hour) ? s : acc),
    b.slots[0]
  );
  if (!latest) return true;
  return latest.date < today || (latest.date === today && latest.hour < nowH);
}

export function buildBookingView(b: BookingWithSlots, venue: LoadedVenue): BookingView {
  const today = todayIso();
  const turfName = (id: string) => venue.turfs.find((t) => t.id === id)?.name ?? "Turf";
  const sportFor = (turfId: string) => {
    const t = venue.turfs.find((x) => x.id === turfId);
    return venue.sports.find((s) => s.id === t?.sportId) ?? venue.sports[0];
  };
  return {
    id: b.id,
    code: b.code,
    entryCode: b.entryCode,
    status: b.status,
    source: b.source,
    past: isPast(b),
    court: turfName(b.slots[0]?.turfId ?? ""),
    customerName: b.customerName,
    teamName: b.teamName ?? undefined,
    subtotalPaise: b.subtotalPaise,
    feePaise: b.feePaise,
    discountPaise: b.discountPaise,
    couponCode: b.couponCode ?? undefined,
    totalPaise: b.totalPaise,
    depositPaise: b.depositPaise,
    amountPaidPaise: b.amountPaidPaise,
    amountDuePaise: b.amountDuePaise,
    createdAt: b.createdAt.toISOString(),
    slots: b.slots.map((s) => {
      const sp = sportFor(s.turfId);
      return {
        icon: sp.icon,
        title: `${sp.name} · ${sp.sub}`,
        subtitle: `${humanDate(s.date, today)} · ${slotLabel(s.hour)} · ${turfName(s.turfId)}`,
        pricePaise: s.pricePaise,
        date: s.date,
        hour: s.hour,
        turfId: s.turfId,
        turfName: turfName(s.turfId),
      };
    }),
  };
}
