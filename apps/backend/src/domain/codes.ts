import { prisma } from "../db.js";

/** Public booking reference SX#### — collision-safe (retries on unique clash). */
export async function generateBookingCode(): Promise<string> {
  for (let i = 0; i < 12; i++) {
    const code = "SX" + Math.floor(1000 + Math.random() * 9000);
    const exists = await prisma.booking.findUnique({ where: { code } });
    if (!exists) return code;
  }
  // Extremely unlikely fallback: widen the space.
  return "SX" + Date.now().toString().slice(-6);
}

/** Gate PIN — distinct from the shareable public code so a screenshot of the
 *  booking reference can't be used to walk through the gate. */
export function generateEntryCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}
