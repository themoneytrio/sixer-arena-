import crypto from "node:crypto";
import { prisma } from "../db.js";
import { config } from "../config.js";
import type { FastifyInstance } from "fastify";

function sha256(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
}

/** Short-lived access JWT + opaque, hashed, rotating refresh token (with a
 *  familyId so reuse of a rotated token can revoke the whole family). */
export async function issueTokens(app: FastifyInstance, userId: string, familyId?: string): Promise<IssuedTokens> {
  const accessToken = app.jwt.sign({ sub: userId }, { expiresIn: config.accessTtlSec });
  const raw = crypto.randomBytes(32).toString("hex");
  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: sha256(raw),
      familyId: familyId ?? crypto.randomUUID(),
      expiresAt: new Date(Date.now() + config.refreshTtlSec * 1000),
    },
  });
  return { accessToken, refreshToken: raw };
}

/** Rotate on use; detect reuse (a consumed/revoked token) and kill the family. */
export async function rotateRefresh(app: FastifyInstance, raw: string): Promise<IssuedTokens> {
  const tokenHash = sha256(raw);
  const row = await prisma.refreshToken.findUnique({ where: { tokenHash } });
  if (!row) throw new Error("invalid_refresh");
  if (row.revokedAt || row.expiresAt < new Date()) {
    // Reuse of an already-rotated token → revoke the whole family.
    await prisma.refreshToken.updateMany({
      where: { familyId: row.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    throw new Error("refresh_reuse");
  }
  await prisma.refreshToken.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
  return issueTokens(app, row.userId, row.familyId);
}

export async function revokeAll(userId: string): Promise<void> {
  await prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
}
