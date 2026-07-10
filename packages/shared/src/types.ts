/** Shared API contract types used by backend + both frontends. Money is in paise. */

export type Role = "OWNER" | "MANAGER";
export type BookingSource = "ONLINE" | "WALKIN";
export type BookingStatus = "PENDING_PAYMENT" | "CONFIRMED" | "CANCELLED" | "COMPLETED";
export type SlotStatus = "open" | "peak" | "full" | "blocked";
export type PaymentMethod = "upi" | "card" | "net";

export interface Sport {
  id: string;
  name: string;
  sub: string;
  icon: string;
  basePaise: number;
  sortOrder: number;
}

export interface Turf {
  id: string;
  name: string;
  sportId: string;
  surface: string;
  icon: string;
}

export interface VenueConfig {
  id: string;
  name: string;
  locality: string;
  sports: Sport[];
  turfs: Turf[];
  multiSport: boolean;
  depositPercent: number; // e.g. 40
  convenienceFeePaise: number;
  cancellationFreeHours: number;
  cancellationRefundPercent: number;
}

export interface AvailabilitySlot {
  hour: number; // 6..23
  label: string; // "8 – 9 PM"
  pricePaise: number;
  status: SlotStatus;
  isPeak: boolean;
}

export interface AvailabilityResponse {
  turfId: string;
  date: string; // YYYY-MM-DD
  slots: AvailabilitySlot[];
}

export interface CartItemInput {
  turfId: string;
  date: string;
  hour: number;
}

export interface RecurringPreview {
  turfId: string;
  hour: number;
  label: string;
  weeks: { week: number; date: string; human: string; available: boolean; pricePaise: number }[];
}

export interface CheckoutRequest {
  venueId: string;
  items: CartItemInput[];
  name: string;
  teamName?: string;
  paymentMethod: PaymentMethod;
  couponCode?: string;
  idempotencyKey: string;
}

export interface CouponValidation {
  valid: boolean;
  code?: string;
  percentOff?: number;
  discountPaise?: number;
  reason?: string;
}

export interface Coupon {
  id: string;
  code: string;
  percentOff: number;
  maxDiscountPaise: number | null;
  minSubtotalPaise: number;
  usageCap: number | null;
  usedCount: number;
  active: boolean;
  validUntil: string | null;
}

export interface CheckoutResponse {
  bookingId: string;
  code: string;
  provider: "razorpay" | "mock";
  orderId: string;
  keyId?: string;
  depositPaise: number;
  totalPaise: number;
}

export interface SlotConflict {
  turfId: string;
  date: string;
  hour: number;
}

export interface SlotTakenError {
  code: "SLOT_TAKEN";
  conflicts: SlotConflict[];
}

export interface BookingSlotView {
  icon: string;
  title: string; // "Box Cricket · 6-a-side"
  subtitle: string; // "Sat 28 Jun · 9 – 10 PM · Cricket Turf"
  pricePaise: number;
  date: string;
  hour: number;
  turfId: string;
  turfName: string;
}

export interface BookingView {
  id: string;
  code: string;
  entryCode: string;
  status: BookingStatus;
  source: BookingSource;
  past: boolean;
  court: string;
  customerName: string;
  teamName?: string;
  subtotalPaise: number;
  feePaise: number;
  discountPaise: number;
  couponCode?: string;
  totalPaise: number;
  depositPaise: number;
  amountPaidPaise: number;
  amountDuePaise: number;
  slots: BookingSlotView[];
  createdAt: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface MeResponse {
  id: string;
  phone: string;
  name: string | null;
  memberships: { venueId: string; role: Role }[];
}

// ---- Owner console ----

export interface OwnerBookingRow {
  id: string;
  customerName: string;
  customerPhone: string;
  sportIcon: string;
  title: string; // "Box Cricket · 8–9 PM"
  date: string;
  totalPaise: number;
  amountDuePaise: number;
  status: BookingStatus;
  source: BookingSource;
  createdAt: string;
}

export interface DashboardResponse {
  date: string;
  revenueTodayPaise: number;
  revenueDeltaPct: number;
  revenueMonthPaise: number;
  occupancyPct: number;
  bookingsToday: number;
  peakHourLabel: string;
  last7Days: { date: string; label: string; revenuePaise: number; isToday: boolean }[];
  todaysBookings: OwnerBookingRow[];
  slotControl: {
    turfId: string;
    turfName: string;
    slots: { hour: number; label: string; status: "open" | "booked" | "blocked" }[];
  }[];
}

export interface AnalyticsResponse {
  range: "day" | "week" | "month";
  revenuePaise: number;
  bookings: number;
  avgBookingValuePaise: number;
  onlinePct: number;
  walkinPct: number;
  heatmap: { day: string; hours: { hour: number; occupancy: number }[] }[];
  bySport: { sportId: string; name: string; icon: string; revenuePaise: number }[];
}

export interface CustomerRow {
  name: string;
  phone: string;
  bookings: number;
  spentPaise: number;
  duePaise: number;
  lastVisit: string; // YYYY-MM-DD of their latest slot
  online: number;
  walkin: number;
  regular: boolean;
}

export interface PaymentsResponse {
  summary: {
    onlineCollectedPaise: number;
    cashCollectedPaise: number;
    pendingDuesPaise: number;
    refundedPaise: number;
  };
  transactions: {
    id: string;
    orderId: string;
    provider: "RAZORPAY" | "MOCK";
    status: "CREATED" | "PAID" | "FAILED" | "REFUNDED";
    amountPaise: number;
    createdAt: string;
    bookingCode: string;
    customerName: string;
  }[];
  dues: {
    bookingId: string;
    code: string;
    customerName: string;
    source: BookingSource;
    totalPaise: number;
    duePaise: number;
  }[];
}

export interface WalkinRequest {
  venueId: string;
  turfId: string;
  date: string;
  hour: number;
  customerName: string;
  customerPhone: string;
  paid: boolean; // cash paid now vs pay-later
}
