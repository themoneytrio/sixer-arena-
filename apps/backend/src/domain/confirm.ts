import { prisma } from "../db.js";
import type { Prisma } from "@prisma/client";

/**
 * Idempotent payment confirmation, shared by the client verify-payment call and
 * the Razorpay webhook. Either path can arrive first (or the client can crash
 * after capture but before verify) — whichever runs applies the payment exactly
 * once. Scoped to a single Payment row (looked up by orderId) so a booking can
 * carry several payments: the checkout deposit or full payment, and a later
 * balance payment. Amounts are additive; the first successful payment on a
 * PENDING_PAYMENT booking also flips it to CONFIRMED and promotes its holds.
 */
export async function confirmPayment(
  orderId: string,
  paymentId: string,
  extras?: { signature?: string; raw?: unknown }
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findFirst({ where: { orderId } });
    if (!payment) return false;
    if (payment.status === "PAID") return true; // replay (webhook + verify both fire)

    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: "PAID",
        paymentId,
        signature: extras?.signature,
        raw: extras?.raw === undefined ? undefined : (extras.raw as Prisma.InputJsonValue),
      },
    });

    const booking = await tx.booking.findUnique({ where: { id: payment.bookingId } });
    if (!booking) return false;
    const paid = booking.amountPaidPaise + payment.amountPaise;
    await tx.booking.update({
      where: { id: booking.id },
      data: {
        amountPaidPaise: paid,
        // Clamp at 0: if the owner recorded a cash payment while an online
        // balance payment was in flight, we record the overpayment truthfully
        // in amountPaid without going negative on due.
        amountDuePaise: Math.max(0, booking.totalPaise - paid),
        ...(booking.status === "PENDING_PAYMENT" ? { status: "CONFIRMED" as const } : {}),
      },
    });
    if (booking.status === "PENDING_PAYMENT") {
      await tx.slotHold.updateMany({
        where: { bookingId: booking.id, status: "HELD" },
        data: { status: "BOOKED", holdExpiresAt: null },
      });
    }
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

/**
 * A single payment attempt failed on an already-CONFIRMED booking (balance
 * payment declined / signature bad). Marks just that Payment row FAILED —
 * never touches the booking or its holds.
 */
export async function failPayment(orderId: string): Promise<void> {
  await prisma.payment.updateMany({
    where: { orderId, status: "CREATED" },
    data: { status: "FAILED" },
  });
}
