import cron from "node-cron";
import { prisma } from "../db.js";

/**
 * Every 60s, release HELD slots whose checkout window lapsed and void the
 * abandoned booking. Without this an unfinished checkout would squat on a slot
 * forever — a real gap in the prototype, whose "Full" state was faked.
 */
export async function sweepExpiredHolds(): Promise<number> {
  const now = new Date();
  const expired = await prisma.slotHold.findMany({
    where: { status: "HELD", holdExpiresAt: { lt: now } },
    select: { bookingId: true },
  });
  const bookingIds = [...new Set(expired.map((h) => h.bookingId).filter(Boolean))] as string[];
  await prisma.slotHold.deleteMany({ where: { status: "HELD", holdExpiresAt: { lt: now } } });
  if (bookingIds.length) {
    await prisma.booking.updateMany({
      where: { id: { in: bookingIds }, status: "PENDING_PAYMENT" },
      data: { status: "CANCELLED", cancelledAt: now },
    });
  }
  return bookingIds.length;
}

export function startHoldSweep() {
  cron.schedule("* * * * *", () => {
    sweepExpiredHolds().catch((e) => console.error("[sweep]", e));
  });
}
