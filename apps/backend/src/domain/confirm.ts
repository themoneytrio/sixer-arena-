import { prisma } from "../db.js";

/**
 * Idempotent payment confirmation, shared by the client verify-payment call and
 * the Razorpay webhook. Either path can arrive first (or the client can crash
 * after capture but before verify) — whichever runs flips the booking to
 * CONFIRMED and promotes its HELD holds to BOOKED exactly once.
 */
export async function confirmPayment(bookingId: string, paymentId: string): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({ where: { id: bookingId } });
    if (!booking) return false;
    if (booking.status === "CONFIRMED") return true; // already done

    await tx.payment.updateMany({
      where: { bookingId, status: "CREATED" },
      data: { status: "PAID", paymentId },
    });
    await tx.booking.update({
      where: { id: bookingId },
      data: {
        status: "CONFIRMED",
        amountPaidPaise: booking.depositPaise,
        amountDuePaise: booking.totalPaise - booking.depositPaise,
      },
    });
    await tx.slotHold.updateMany({
      where: { bookingId, status: "HELD" },
      data: { status: "BOOKED", holdExpiresAt: null },
    });
    return true;
  });
}

/** Payment failed / signature bad — release the held slots and void the booking. */
export async function failBooking(bookingId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.slotHold.deleteMany({ where: { bookingId, status: "HELD" } });
    await tx.payment.updateMany({ where: { bookingId, status: "CREATED" }, data: { status: "FAILED" } });
    await tx.booking.updateMany({
      where: { id: bookingId, status: "PENDING_PAYMENT" },
      data: { status: "CANCELLED", cancelledAt: new Date() },
    });
  });
}
