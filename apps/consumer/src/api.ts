import type {
  VenueConfig,
  AvailabilityResponse,
  CheckoutRequest,
  CheckoutResponse,
  PayBalanceResponse,
  BookingView,
  RecurringPreview,
  SlotTakenError,
} from "@sixer/shared/types";

// Dev: same-origin "/api" is proxied to the backend by Vite (see vite.config.ts).
// Prod: VITE_API_BASE points at the deployed backend. Render's `fromService`
// gives a bare hostname, so prepend https:// when no scheme/leading-slash present.
const RAW_BASE = import.meta.env.VITE_API_BASE ?? "/api";
const BASE = RAW_BASE.startsWith("/") || /^https?:\/\//.test(RAW_BASE) ? RAW_BASE : `https://${RAW_BASE}`;
let VENUE_ID = import.meta.env.VITE_VENUE_ID ?? "";

async function ensureVenueId(): Promise<string> {
  if (VENUE_ID) return VENUE_ID;
  const r = await fetch(BASE + "/bootstrap");
  VENUE_ID = (await r.json()).venueId;
  return VENUE_ID;
}

const TOK = "sixer_tokens";
type Tokens = { accessToken: string; refreshToken: string };

function loadTokens(): Tokens | null {
  try {
    return JSON.parse(localStorage.getItem(TOK) || "null");
  } catch {
    return null;
  }
}
function saveTokens(t: Tokens | null) {
  if (t) localStorage.setItem(TOK, JSON.stringify(t));
  else localStorage.removeItem(TOK);
}
export function isAuthed() {
  return !!loadTokens();
}

async function raw(path: string, opts: RequestInit = {}, retry = true): Promise<Response> {
  const t = loadTokens();
  const headers: Record<string, string> = { "content-type": "application/json", ...(opts.headers as any) };
  if (t) headers.authorization = `Bearer ${t.accessToken}`;
  const res = await fetch(BASE + path, { ...opts, headers });
  if (res.status === 401 && retry && t?.refreshToken) {
    const r = await fetch(BASE + "/auth/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken: t.refreshToken }),
    });
    if (r.ok) {
      saveTokens(await r.json());
      return raw(path, opts, false);
    }
    saveTokens(null);
  }
  return res;
}

async function json<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await raw(path, opts);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw Object.assign(new Error(body.error || res.statusText), { status: res.status, body });
  }
  return res.json();
}

export const api = {
  isAuthed,

  async venue(): Promise<VenueConfig> {
    const id = await ensureVenueId();
    return json(`/venues/${id}`);
  },
  async dates(): Promise<string[]> {
    const id = await ensureVenueId();
    return json<{ dates: string[] }>(`/venues/${id}/dates`).then((r) => r.dates);
  },
  async availability(turfId: string, date: string): Promise<AvailabilityResponse> {
    const id = await ensureVenueId();
    return json(`/venues/${id}/availability?turfId=${turfId}&date=${date}`);
  },
  async recurringPreview(turfId: string, date: string, hour: number, weeks = 4): Promise<RecurringPreview> {
    const id = await ensureVenueId();
    return json(`/venues/${id}/recurring-preview?turfId=${turfId}&date=${date}&hour=${hour}&weeks=${weeks}`);
  },
  async validateCoupon(code: string, subtotalPaise: number): Promise<import("@sixer/shared/types").CouponValidation> {
    const id = await ensureVenueId();
    return json(`/bookings/validate-coupon`, { method: "POST", body: JSON.stringify({ venueId: id, code, subtotalPaise }) });
  },

  // Auth
  async requestOtp(phone: string) {
    return json<{ sent: boolean; mock: boolean }>(`/auth/otp/request`, { method: "POST", body: JSON.stringify({ phone }) });
  },
  async verifyOtp(phone: string, code: string) {
    const r = await json<Tokens & { isNewUser: boolean; name: string | null }>(`/auth/otp/verify`, {
      method: "POST",
      body: JSON.stringify({ phone, code }),
    });
    saveTokens({ accessToken: r.accessToken, refreshToken: r.refreshToken });
    return r;
  },
  // Email OTP (temporary/alternative auth). `dev` + `devCode` are only present
  // when no SMTP account is configured, so the app can show the code.
  async requestEmailOtp(email: string) {
    return json<{ sent: boolean; dev: boolean; devCode?: string }>(`/auth/email/request`, {
      method: "POST",
      body: JSON.stringify({ email }),
    });
  },
  async verifyEmailOtp(email: string, code: string) {
    const r = await json<Tokens & { isNewUser: boolean; name: string | null }>(`/auth/email/verify`, {
      method: "POST",
      body: JSON.stringify({ email, code }),
    });
    saveTokens({ accessToken: r.accessToken, refreshToken: r.refreshToken });
    return r;
  },
  async setName(name: string) {
    return json(`/me`, { method: "PATCH", body: JSON.stringify({ name }) });
  },
  async me() {
    return json<{ id: string; phone: string | null; email: string | null; name: string | null }>(`/me`);
  },
  logout() {
    raw(`/auth/logout`, { method: "POST" }).catch(() => {});
    saveTokens(null);
  },

  // Bookings
  async checkout(req: Omit<CheckoutRequest, "venueId">): Promise<CheckoutResponse> {
    const id = await ensureVenueId();
    return json(`/bookings/checkout`, { method: "POST", body: JSON.stringify({ ...req, venueId: id }) });
  },
  async completeMockPayment(bookingId: string) {
    return json(`/dev/mock-payment/${bookingId}/complete`, { method: "POST" });
  },
  async verifyPayment(bookingId: string, p: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) {
    return json(`/bookings/${bookingId}/verify-payment`, { method: "POST", body: JSON.stringify(p) });
  },
  async abandonBooking(bookingId: string) {
    return json(`/bookings/${bookingId}/abandon`, { method: "POST" }).catch(() => ({}));
  },
  async payBalance(bookingId: string): Promise<PayBalanceResponse> {
    return json(`/bookings/${bookingId}/pay-balance`, { method: "POST" });
  },
  async bookings(tab: "upcoming" | "past"): Promise<BookingView[]> {
    return json<{ bookings: BookingView[] }>(`/bookings?tab=${tab}`).then((r) => r.bookings);
  },
  async booking(id: string): Promise<BookingView> {
    return json(`/bookings/${id}`);
  },
  async cancel(id: string) {
    return json<{ refundPaise: number; refundPercent: number }>(`/bookings/${id}/cancel`, { method: "POST" });
  },
  async reschedule(id: string, date: string, hour: number) {
    return json<{ ok: boolean }>(`/bookings/${id}/reschedule`, { method: "POST", body: JSON.stringify({ date, hour }) });
  },
};

export type { SlotTakenError };
