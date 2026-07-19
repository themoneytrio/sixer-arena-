import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { confirmPayment, failBooking, failPayment } from "../domain/confirm.js";

/**
 * Authoritative payment source of truth. The client verify-payment call is a
 * fast-path UX optimisation; if the client crashes after capture but before
 * verify, this reconciles. Handler is idempotent (keyed off the payment id),
 * with delivery-level dedupe on x-razorpay-event-id (Razorpay retries).
 */
export async function webhookRoutes(app: FastifyInstance) {
  app.post("/webhooks/razorpay", { config: { rawBody: true } }, async (req, reply) => {
    const signature = req.headers["x-razorpay-signature"] as string | undefined;
    const raw = (req as any).rawBody ?? JSON.stringify(req.body);
    if (config.razorpay.webhookSecret) {
      const expected = crypto.createHmac("sha256", config.razorpay.webhookSecret).update(raw).digest("hex");
      if (expected !== signature) return reply.code(400).send({ error: "bad_signature" });
    }
    const body = req.body as any;
    const event = body?.event as string;

    // Delivery dedupe. Header may be absent on dashboard test-fires — the
    // handlers below are idempotent anyway, so we just skip dedupe then.
    const eventId = req.headers["x-razorpay-event-id"] as string | undefined;
    if (eventId) {
      try {
        await prisma.webhookEvent.create({ data: { id: eventId, event } });
      } catch {
        return { ok: true, duplicate: true }; // P2002 → already processed
      }
    }

    // Refund events carry no payload.payment — handle before the orderId guard.
    // Covers refunds we initiated *and* refunds issued from the dashboard, and
    // heals the crack where our refund API call succeeded but the DB write died.
    if (event === "refund.processed") {
      const refund = body?.payload?.refund?.entity;
      if (refund?.payment_id) {
        await prisma.payment.updateMany({
          where: { paymentId: refund.payment_id },
          data: { refundId: refund.id, refundedPaise: refund.amount, status: "REFUNDED" },
        });
      }
      return { ok: true };
    }

    const entity = body?.payload?.payment?.entity;
    const orderId = entity?.order_id;
    const paymentId = entity?.id;
    if (!orderId) return { ok: true };

    const payment = await prisma.payment.findFirst({ where: { orderId } });
    if (!payment) return { ok: true };

    if (event === "payment.captured" || event === "order.paid") {
      await confirmPayment(orderId, paymentId ?? payment.paymentId ?? "webhook", { raw: entity });
    } else if (event === "payment.failed") {
      const booking = await prisma.booking.findUnique({ where: { id: payment.bookingId } });
      // A failed balance payment must not cancel a confirmed booking.
      if (booking?.status === "PENDING_PAYMENT") await failBooking(payment.bookingId);
      else await failPayment(orderId);
    }
    return { ok: true };
  });
}
