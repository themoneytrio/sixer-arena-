import crypto from "node:crypto";
import { config, usingRealPayments } from "../config.js";

export interface CreatedOrder {
  orderId: string;
  provider: "razorpay" | "mock";
  keyId?: string;
}

export interface PaymentProvider {
  readonly kind: "razorpay" | "mock";
  createOrder(amountPaise: number, receipt: string, notes?: Record<string, string>): Promise<CreatedOrder>;
  verifySignature(orderId: string, paymentId: string, signature: string): boolean;
  refund(paymentId: string, amountPaise: number): Promise<{ refundId: string }>;
}

/**
 * Deterministic in-process mock — the CI/offline fallback. It mirrors Razorpay's
 * HMAC-SHA256(order_id|payment_id) signature scheme with a fixed secret so the
 * SAME verify code path exercises both providers; only the transport differs.
 */
class MockPayments implements PaymentProvider {
  readonly kind = "mock" as const;
  private secret = "mock_secret";

  async createOrder(amountPaise: number, receipt: string) {
    return { orderId: "order_mock_" + crypto.randomBytes(8).toString("hex"), provider: "mock" as const };
  }
  verifySignature(orderId: string, paymentId: string, signature: string): boolean {
    const expected = crypto.createHmac("sha256", this.secret).update(`${orderId}|${paymentId}`).digest("hex");
    try {
      return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature || ""));
    } catch {
      return false; // length mismatch on garbled input
    }
  }
  async refund(paymentId: string) {
    return { refundId: "rfnd_mock_" + crypto.randomBytes(6).toString("hex") };
  }
  /** Mock-only helper: the client computes this to simulate a captured payment. */
  sign(orderId: string, paymentId: string): string {
    return crypto.createHmac("sha256", this.secret).update(`${orderId}|${paymentId}`).digest("hex");
  }
}

/** Real Razorpay adapter — uses test-mode keys when provided (free, no KYC). */
class RazorpayPayments implements PaymentProvider {
  readonly kind = "razorpay" as const;
  private auth = Buffer.from(`${config.razorpay.keyId}:${config.razorpay.keySecret}`).toString("base64");

  async createOrder(amountPaise: number, receipt: string, notes?: Record<string, string>) {
    const res = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: { Authorization: `Basic ${this.auth}`, "Content-Type": "application/json" },
      body: JSON.stringify({ amount: amountPaise, currency: "INR", receipt, notes }),
    });
    const json: any = await res.json();
    if (!res.ok) throw new Error(`razorpay: ${json.error?.description ?? res.status}`);
    return { orderId: json.id, provider: "razorpay" as const, keyId: config.razorpay.keyId };
  }
  verifySignature(orderId: string, paymentId: string, signature: string): boolean {
    const expected = crypto
      .createHmac("sha256", config.razorpay.keySecret)
      .update(`${orderId}|${paymentId}`)
      .digest("hex");
    try {
      return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature || ""));
    } catch {
      return false;
    }
  }
  async refund(paymentId: string, amountPaise: number) {
    const res = await fetch(`https://api.razorpay.com/v1/payments/${paymentId}/refund`, {
      method: "POST",
      headers: { Authorization: `Basic ${this.auth}`, "Content-Type": "application/json" },
      body: JSON.stringify({ amount: amountPaise }),
    });
    const json: any = await res.json();
    if (!res.ok) throw new Error(`razorpay refund: ${json.error?.description ?? res.status}`);
    return { refundId: json.id };
  }
}

export const payments: PaymentProvider = usingRealPayments ? new RazorpayPayments() : new MockPayments();

/** Exposed so the /dev mock-payment endpoint can fabricate a valid signature. */
export function mockSign(orderId: string, paymentId: string): string {
  if (payments instanceof MockPayments) return (payments as MockPayments).sign(orderId, paymentId);
  return "";
}
