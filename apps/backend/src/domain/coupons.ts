import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";

export class CouponError extends Error {
  constructor(public reason: string) {
    super(reason);
    this.name = "CouponError";
  }
}

export interface ResolvedCoupon {
  code: string;
  couponId: string;
  percentOff: number;
  discountPaise: number;
}

/**
 * Validate a coupon against a subtotal and compute the rupee discount.
 * Authoritative — the client only previews; checkout re-resolves server-side.
 */
export async function resolveCoupon(venueId: string, rawCode: string, subtotalPaise: number): Promise<ResolvedCoupon> {
  const code = rawCode.trim().toUpperCase();
  const c = await prisma.coupon.findUnique({ where: { venueId_code: { venueId, code } } });
  if (!c || !c.active) throw new CouponError("invalid");
  if (c.validUntil && c.validUntil < new Date()) throw new CouponError("expired");
  if (c.usageCap != null && c.usedCount >= c.usageCap) throw new CouponError("used_up");
  if (subtotalPaise < c.minSubtotalPaise) throw new CouponError("min_not_met");

  let discountPaise = Math.round((subtotalPaise * c.percentOff) / 100);
  if (c.maxDiscountPaise != null) discountPaise = Math.min(discountPaise, c.maxDiscountPaise);
  return { code, couponId: c.id, percentOff: c.percentOff, discountPaise };
}

/** Record a redemption inside the checkout transaction. */
export async function redeemCoupon(tx: Prisma.TransactionClient, couponId: string): Promise<void> {
  await tx.coupon.update({ where: { id: couponId }, data: { usedCount: { increment: 1 } } });
}
