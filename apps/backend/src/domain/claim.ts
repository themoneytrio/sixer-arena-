import { prisma, isUniqueViolation } from "../db.js";
import type { HoldStatus, Prisma } from "@prisma/client";
import type { SlotConflict } from "@sixer/shared/types";

export class SlotTakenError extends Error {
  constructor(public conflicts: SlotConflict[]) {
    super("SLOT_TAKEN");
    this.name = "SlotTakenError";
  }
}

export interface ClaimItem {
  turfId: string;
  date: string;
  hour: number;
}

/**
 * Atomically claim every requested slot, all-or-nothing. Consumer checkout
 * (status HELD) and owner walk-ins/blocks (status BOOKED/BLOCKED) both funnel
 * through here — that shared CODE PATH, not just a shared table, is what makes
 * online and offline never double-book. Runs inside an interactive transaction:
 * if any slot is already taken, Postgres throws P2002 on the @@unique index and
 * the whole transaction rolls back, so a multi-slot cart is genuinely atomic.
 */
export async function claimSlots(
  tx: Prisma.TransactionClient,
  items: ClaimItem[],
  status: HoldStatus,
  opts: { bookingId?: string; holdExpiresAt?: Date | null } = {}
): Promise<void> {
  try {
    for (const it of items) {
      await tx.slotHold.create({
        data: {
          turfId: it.turfId,
          date: it.date,
          hour: it.hour,
          status,
          bookingId: opts.bookingId ?? null,
          holdExpiresAt: opts.holdExpiresAt ?? null,
        },
      });
    }
  } catch (e) {
    if (isUniqueViolation(e)) {
      // The transaction is now aborted; identify which requested tuples collided
      // by re-reading committed rows (done outside via prisma below).
      throw new SlotTakenError([]);
    }
    throw e;
  }
}

/** Which of these requested slots currently have a hold (for the friendly bounce). */
export async function findConflicts(items: ClaimItem[]): Promise<SlotConflict[]> {
  const rows = await prisma.slotHold.findMany({
    where: { OR: items.map((i) => ({ turfId: i.turfId, date: i.date, hour: i.hour })) },
    select: { turfId: true, date: true, hour: true },
  });
  return rows;
}
