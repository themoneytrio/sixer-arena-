import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import authPlugin from "./plugins/auth.js";
import { authRoutes } from "./routes/auth.js";
import { venueRoutes } from "./routes/venue.js";
import { bookingRoutes } from "./routes/bookings.js";
import { ownerRoutes } from "./routes/owner.js";
import { webhookRoutes } from "./routes/webhook.js";
import { startHoldSweep } from "./jobs/holdSweep.js";
import { config, usingRealPayments, usingRealSms } from "./config.js";

export async function buildServer() {
  const app = Fastify({ logger: { level: "warn" } });

  await app.register(cors, { origin: true });
  await app.register(rateLimit, { global: false });
  await app.register(authPlugin);

  // Capture raw body for webhook signature verification.
  app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body: string, done) => {
    (req as any).rawBody = body;
    try {
      done(null, body ? JSON.parse(body) : {});
    } catch (e) {
      done(e as Error, undefined);
    }
  });

  app.get("/health", async () => ({
    ok: true,
    payments: usingRealPayments ? "razorpay" : "mock",
    sms: usingRealSms ? config.sms.provider : "mock",
  }));

  await app.register(authRoutes);
  await app.register(venueRoutes);
  await app.register(bookingRoutes);
  await app.register(ownerRoutes);
  await app.register(webhookRoutes);

  return app;
}

buildServer()
  .then((app) => {
    startHoldSweep();
    return app.listen({ port: config.port, host: "0.0.0.0" });
  })
  .then((addr) => console.log(`Sixer backend listening on ${addr}`))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
