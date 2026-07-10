import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../db.js";
import { sms, smsIsMock } from "../providers/sms.js";
import { email as emailProvider, emailIsDev } from "../providers/email.js";
import { issueTokens, rotateRefresh, revokeAll } from "../auth/tokens.js";

const phoneSchema = z.object({ phone: z.string().regex(/^\d{10}$/) });
const emailSchema = z.object({ email: z.string().email().max(120).transform((e) => e.toLowerCase()) });

const OTP_RATE = { max: Number(process.env.OTP_RATE_MAX ?? 20), timeWindow: "10 minutes" };

export async function authRoutes(app: FastifyInstance) {
  // Request an OTP. Rate-limited per IP — this endpoint spends real SMS money.
  app.post("/auth/otp/request", { config: { rateLimit: { max: Number(process.env.OTP_RATE_MAX ?? 20), timeWindow: "10 minutes" } } }, async (req, reply) => {
    const parse = phoneSchema.safeParse(req.body);
    if (!parse.success) return reply.code(400).send({ error: "bad_phone" });
    const { phone } = parse.data;

    const code = smsIsMock ? "0000" : String(Math.floor(1000 + Math.random() * 9000));
    const codeHash = await bcrypt.hash(code, 8);
    await prisma.otpChallenge.create({
      data: {
        phone,
        codeHash,
        code: smsIsMock ? code : null,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      },
    });
    await sms.send(`+91${phone}`, `Your Sixer Arena code is ${code}. Valid 5 min.`);
    // In mock mode we tell the client any 4 digits work (matches the prototype).
    return { sent: true, mock: smsIsMock };
  });

  // Verify OTP → upsert user, issue tokens.
  app.post("/auth/otp/verify", async (req, reply) => {
    const schema = phoneSchema.extend({ code: z.string().min(4).max(6) });
    const parse = schema.safeParse(req.body);
    if (!parse.success) return reply.code(400).send({ error: "bad_input" });
    const { phone, code } = parse.data;

    const challenge = await prisma.otpChallenge.findFirst({
      where: { phone, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    });
    if (!challenge) return reply.code(400).send({ error: "no_active_otp" });
    if (challenge.attempts >= 5) return reply.code(429).send({ error: "too_many_attempts" });

    // Mock mode accepts any 4-digit code (prototype behaviour); real mode checks hash.
    const ok = smsIsMock ? /^\d{4,6}$/.test(code) : await bcrypt.compare(code, challenge.codeHash);
    if (!ok) {
      await prisma.otpChallenge.update({ where: { id: challenge.id }, data: { attempts: { increment: 1 } } });
      return reply.code(400).send({ error: "wrong_code" });
    }
    await prisma.otpChallenge.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } });

    const existing = await prisma.user.findUnique({ where: { phone } });
    const user = existing ?? (await prisma.user.create({ data: { phone } }));
    const tokens = await issueTokens(app, user.id);
    return { ...tokens, isNewUser: !existing || !user.name, name: user.name };
  });

  // ---- Email OTP (temporary/alternative auth) ----
  // Same generate/hash/verify path as phone; delivered by email instead of SMS.
  app.post("/auth/email/request", { config: { rateLimit: OTP_RATE } }, async (req, reply) => {
    const parse = emailSchema.safeParse(req.body);
    if (!parse.success) return reply.code(400).send({ error: "bad_email" });
    const { email } = parse.data;

    const code = String(Math.floor(1000 + Math.random() * 9000));
    const codeHash = await bcrypt.hash(code, 8);
    await prisma.otpChallenge.create({
      data: {
        email,
        codeHash,
        code: emailIsDev ? code : null, // dev-mode only, so the app can surface it
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      },
    });
    try {
      await emailProvider.send(email, code);
    } catch (e) {
      req.log.error(e, "email send failed");
      return reply.code(502).send({ error: "email_send_failed" });
    }
    // In dev mode we echo the code so login works without an SMTP account.
    return { sent: true, dev: emailIsDev, ...(emailIsDev ? { devCode: code } : {}) };
  });

  app.post("/auth/email/verify", async (req, reply) => {
    const schema = emailSchema.extend({ code: z.string().regex(/^\d{4}$/) });
    const parse = schema.safeParse(req.body);
    if (!parse.success) return reply.code(400).send({ error: "bad_input" });
    const { email, code } = parse.data;

    const challenge = await prisma.otpChallenge.findFirst({
      where: { email, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    });
    if (!challenge) return reply.code(400).send({ error: "no_active_otp" });
    if (challenge.attempts >= 5) return reply.code(429).send({ error: "too_many_attempts" });

    const ok = await bcrypt.compare(code, challenge.codeHash);
    if (!ok) {
      await prisma.otpChallenge.update({ where: { id: challenge.id }, data: { attempts: { increment: 1 } } });
      return reply.code(400).send({ error: "wrong_code" });
    }
    await prisma.otpChallenge.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } });

    const existing = await prisma.user.findUnique({ where: { email } });
    const user = existing ?? (await prisma.user.create({ data: { email } }));
    const tokens = await issueTokens(app, user.id);
    return { ...tokens, isNewUser: !existing || !user.name, name: user.name };
  });

  app.post("/auth/refresh", async (req, reply) => {
    const parse = z.object({ refreshToken: z.string() }).safeParse(req.body);
    if (!parse.success) return reply.code(400).send({ error: "bad_input" });
    try {
      return await rotateRefresh(app, parse.data.refreshToken);
    } catch {
      return reply.code(401).send({ error: "invalid_refresh" });
    }
  });

  app.post("/auth/logout", { preHandler: app.authenticate }, async (req) => {
    await revokeAll(req.userId!);
    return { ok: true };
  });

  app.get("/me", { preHandler: app.authenticate }, async (req, reply) => {
    const user = await prisma.user.findUnique({
      where: { id: req.userId! },
      include: { memberships: true },
    });
    if (!user) return reply.code(404).send({ error: "not_found" });
    return {
      id: user.id,
      phone: user.phone,
      email: user.email,
      name: user.name,
      memberships: user.memberships.map((m) => ({ venueId: m.venueId, role: m.role })),
    };
  });

  app.patch("/me", { preHandler: app.authenticate }, async (req, reply) => {
    const parse = z.object({ name: z.string().min(1).max(60) }).safeParse(req.body);
    if (!parse.success) return reply.code(400).send({ error: "bad_input" });
    const user = await prisma.user.update({ where: { id: req.userId! }, data: { name: parse.data.name } });
    return { id: user.id, phone: user.phone, name: user.name };
  });

  // Dev-only convenience: fetch the latest mock OTP so dev clients auto-fill.
  if (smsIsMock) {
    app.get("/dev/last-otp", async (req) => {
      const phone = (req.query as any).phone as string;
      const c = await prisma.otpChallenge.findFirst({
        where: { phone, consumedAt: null },
        orderBy: { createdAt: "desc" },
      });
      return { code: c?.code ?? "0000" };
    });
  }
}
