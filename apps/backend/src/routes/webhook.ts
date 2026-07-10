import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { confirmPayment, failBooking } from "../domain/confirm.js";

/**
 * Authoritative payment source of truth. The client verify-payment call is a
 * fast-path UX optimisation; if the client crashes after capture but before
 * verify, this reconciles. Handler is idempotent (keyed off the payment id).
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
    const entity = body?.payload?.payment?.entity;
    const orderId = entity?.order_id;
    const paymentId = entity?.id;
    if (!orderId) return { ok: true };

    const payment = await prisma.payment.findFirst({ where: { orderId } });
    if (!payment) return { ok: true };

    if (event === "payment.captured" || event === "order.paid") {
      await confirmPayment(payment.bookingId, paymentId ?? payment.paymentId ?? "webhook");
    } else if (event === "payment.failed") {
      await failBooking(payment.bookingId);
    }
    return { ok: true };
  });
}
