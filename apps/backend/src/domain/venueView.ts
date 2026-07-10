import { prisma } from "../db.js";
import type { VenueConfig } from "@sixer/shared/types";

export async function loadVenue(venueId: string) {
  return prisma.venue.findUnique({
    where: { id: venueId },
    include: {
      sports: { where: { active: true }, orderBy: { sortOrder: "asc" } },
      turfs: { where: { active: true } },
    },
  });
}

export type LoadedVenue = NonNullable<Awaited<ReturnType<typeof loadVenue>>>;

/** The public venue config the consumer app renders from. `multiSport` is
 *  decided server-side — the client never guesses whether to show the sport row. */
export function buildVenueConfig(v: LoadedVenue): VenueConfig {
  return {
    id: v.id,
    name: v.name,
    locality: v.locality,
    depositPercent: v.depositPercent,
    convenienceFeePaise: v.convenienceFeePaise,
    cancellationFreeHours: v.cancellationFreeHours,
    cancellationRefundPercent: v.cancellationRefundPercent,
    multiSport: v.sports.length > 1,
    sports: v.sports.map((s) => ({
      id: s.id,
      name: s.name,
      sub: s.sub,
      icon: s.icon,
      basePaise: s.basePaise,
      sortOrder: s.sortOrder,
    })),
    turfs: v.turfs.map((t) => ({
      id: t.id,
      name: t.name,
      sportId: t.sportId,
      surface: t.surface,
      icon: t.icon,
    })),
  };
}

export function sportForTurf(v: LoadedVenue, turfId: string) {
  const turf = v.turfs.find((t) => t.id === turfId);
  const sport = v.sports.find((s) => s.id === turf?.sportId) ?? v.sports[0];
  return { turf, sport };
}
