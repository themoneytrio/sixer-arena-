import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();

/** Prisma unique-constraint violation. */
export function isUniqueViolation(e: unknown): e is { code: "P2002"; meta?: any } {
  return typeof e === "object" && e !== null && (e as any).code === "P2002";
}
