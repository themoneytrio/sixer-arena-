import type {
  VenueConfig,
  DashboardResponse,
  AnalyticsResponse,
  OwnerBookingRow,
  Sport,
  Turf,
  Coupon,
  CustomerRow,
  PaymentsResponse,
} from "@sixer/shared/types";

// Dev: same-origin "/api" is proxied to the backend by Vite (see vite.config.ts).
// Prod: VITE_API_BASE points at the deployed backend. Render's `fromService`
// gives a bare hostname, so prepend https:// when no scheme/leading-slash present.
const RAW_BASE = import.meta.env.VITE_API_BASE ?? "/api";
const BASE = RAW_BASE.startsWith("/") || /^https?:\/\//.test(RAW_BASE) ? RAW_BASE : `https://${RAW_BASE}`;
const TOK = "sixer_owner_tokens";
const VID = "sixer_owner_venue";
type Tokens = { accessToken: string; refreshToken: string };

function loadTokens(): Tokens | null {
  try { return JSON.parse(localStorage.getItem(TOK) || "null"); } catch { return null; }
}
function saveTokens(t: Tokens | null) {
  if (t) localStorage.setItem(TOK, JSON.stringify(t)); else localStorage.removeItem(TOK);
}
let venueId = localStorage.getItem(VID) || "";

async function raw(path: string, opts: RequestInit = {}, retry = true): Promise<Response> {
  const t = loadTokens();
  const headers: Record<string, string> = { "content-type": "application/json", ...(opts.headers as any) };
  if (t) headers.authorization = `Bearer ${t.accessToken}`;
  const res = await fetch(BASE + path, { ...opts, headers });
  if (res.status === 401 && retry && t?.refreshToken) {
    const r = await fetch(BASE + "/auth/refresh", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ refreshToken: t.refreshToken }) });
    if (r.ok) { saveTokens(await r.json()); return raw(path, opts, false); }
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
  isAuthed: () => !!loadTokens() && !!venueId,
  venueId: () => venueId,

  async requestOtp(phone: string) {
    return json<{ sent: boolean }>(`/auth/otp/request`, { method: "POST", body: JSON.stringify({ phone }) });
  },
  async verifyOtp(phone: string, code: string) {
    const r = await json<Tokens & { name: string | null }>(`/auth/otp/verify`, { method: "POST", body: JSON.stringify({ phone, code }) });
    saveTokens({ accessToken: r.accessToken, refreshToken: r.refreshToken });
    // Resolve the venue this owner manages.
    const me = await json<{ name: string | null; memberships: { venueId: string; role: string }[] }>(`/me`);
    if (!me.memberships.length) { saveTokens(null); throw Object.assign(new Error("not_owner"), { status: 403 }); }
    venueId = me.memberships[0].venueId;
    localStorage.setItem(VID, venueId);
    return { name: me.name };
  },
  async me() { return json<{ name: string | null; phone: string }>(`/me`); },
  logout() { raw(`/auth/logout`, { method: "POST" }).catch(() => {}); saveTokens(null); localStorage.removeItem(VID); venueId = ""; },

  config: () => json<VenueConfig>(`/owner/venues/${venueId}/config`),
  dashboard: (date?: string) => json<DashboardResponse>(`/owner/venues/${venueId}/dashboard${date ? `?date=${date}` : ""}`),
  analytics: (range: "day" | "week" | "month") => json<AnalyticsResponse>(`/owner/venues/${venueId}/analytics?range=${range}`),
  bookings: (q: { search?: string; source?: string; due?: string }) => {
    const p = new URLSearchParams();
    if (q.search) p.set("search", q.search);
    if (q.source) p.set("source", q.source);
    if (q.due) p.set("due", q.due);
    return json<{ bookings: OwnerBookingRow[] }>(`/owner/venues/${venueId}/bookings?${p}`).then((r) => r.bookings);
  },
  markPaid: (id: string) => json(`/owner/venues/${venueId}/bookings/${id}/mark-paid`, { method: "POST" }),
  calendar: (date: string) => json<{ date: string; turfs: { turfId: string; turfName: string; cells: { hour: number; label: string; status: string; customer: string | null }[] }[] }>(`/owner/venues/${venueId}/calendar?date=${date}`),
  block: (turfId: string, date: string, hour: number) => json(`/owner/venues/${venueId}/slots/block`, { method: "POST", body: JSON.stringify({ turfId, date, hour }) }),
  unblock: (turfId: string, date: string, hour: number) => json(`/owner/venues/${venueId}/slots/unblock`, { method: "POST", body: JSON.stringify({ turfId, date, hour }) }),
  availability: (turfId: string, date: string) => json<{ slots: { hour: number; label: string; pricePaise: number; status: string }[] }>(`/venues/${venueId}/availability?turfId=${turfId}&date=${date}`),
  dates: () => json<{ dates: string[] }>(`/venues/${venueId}/dates`).then((r) => r.dates),
  addWalkin: (b: { turfId: string; date: string; hour: number; customerName: string; customerPhone: string; paid: boolean }) =>
    json<{ ok: boolean; code: string; pricePaise: number }>(`/owner/venues/${venueId}/walkins`, { method: "POST", body: JSON.stringify(b) }),

  addSport: (b: { name: string; sub: string; icon: string; basePaise: number }) => json<Sport>(`/owner/venues/${venueId}/sports`, { method: "POST", body: JSON.stringify(b) }),
  updateSport: (id: string, b: Partial<{ name: string; sub: string; icon: string; basePaise: number }>) => json<Sport>(`/owner/venues/${venueId}/sports/${id}`, { method: "PATCH", body: JSON.stringify(b) }),
  deleteSport: (id: string) => json(`/owner/venues/${venueId}/sports/${id}`, { method: "DELETE" }),
  addTurf: (b: { name: string; sportId: string; surface: string; icon: string }) => json<Turf>(`/owner/venues/${venueId}/turfs`, { method: "POST", body: JSON.stringify(b) }),
  updateTurf: (id: string, b: Partial<{ name: string; sportId: string; surface: string; icon: string }>) => json<Turf>(`/owner/venues/${venueId}/turfs/${id}`, { method: "PATCH", body: JSON.stringify(b) }),
  deleteTurf: (id: string) => json(`/owner/venues/${venueId}/turfs/${id}`, { method: "DELETE" }),

  payments: () => json<PaymentsResponse>(`/owner/venues/${venueId}/payments`),

  customers: (search?: string) =>
    json<{ customers: CustomerRow[] }>(`/owner/venues/${venueId}/customers${search ? `?search=${encodeURIComponent(search)}` : ""}`).then((r) => r.customers),
  tagCustomer: (phone: string, regular: boolean) =>
    json(`/owner/venues/${venueId}/customers/${encodeURIComponent(phone)}/tag`, { method: "POST", body: JSON.stringify({ regular }) }),

  updateSettings: (b: Partial<{ depositPercent: number; convenienceFeePaise: number }>) =>
    json<{ depositPercent: number; convenienceFeePaise: number }>(`/owner/venues/${venueId}/settings`, { method: "PATCH", body: JSON.stringify(b) }),
  coupons: () => json<{ coupons: Coupon[] }>(`/owner/venues/${venueId}/coupons`).then((r) => r.coupons),
  addCoupon: (b: { code: string; percentOff: number; maxDiscountPaise?: number | null; minSubtotalPaise?: number; usageCap?: number | null }) =>
    json<Coupon>(`/owner/venues/${venueId}/coupons`, { method: "POST", body: JSON.stringify(b) }),
  toggleCoupon: (id: string, active: boolean) => json<Coupon>(`/owner/venues/${venueId}/coupons/${id}`, { method: "PATCH", body: JSON.stringify({ active }) }),
  deleteCoupon: (id: string) => json(`/owner/venues/${venueId}/coupons/${id}`, { method: "DELETE" }),
};
