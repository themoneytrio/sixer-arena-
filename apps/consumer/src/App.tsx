import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { api } from "./api";
import { paiseToMoney, humanDate, DOW, MO } from "@sixer/shared/format";
import type { VenueConfig, AvailabilitySlot, BookingView, RecurringPreview } from "@sixer/shared/types";

// ---- palette (mirrors packages/shared tokens; inlined for pixel parity) ----
const INK = "#14130E", YELLOW = "#FFD400", PANEL = "#201E15", LINE = "#E6E6DE", APP = "#F4F4EE", MUTED = "#6C6C61";

// ---- booking actions (share / calendar / directions) ----
function bookingShareText(b: BookingView, venueName: string, locality: string): string {
  const s = b.slots[0];
  const extra = b.slots.length > 1 ? ` (+${b.slots.length - 1} more)` : "";
  return `My booking at ${venueName}, ${locality}\n${s.title}\n${s.subtitle}${extra}\nBooking #${b.code} · Gate code ${b.entryCode}`;
}

async function shareBooking(b: BookingView, venueName: string, locality: string): Promise<"shared" | "copied" | "fail"> {
  const text = bookingShareText(b, venueName, locality);
  const nav = navigator as any;
  if (nav.share) {
    try { await nav.share({ title: "Sixer Arena booking", text }); return "shared"; }
    catch (e: any) { if (e?.name === "AbortError") return "shared"; /* user cancelled — no error toast */ }
  }
  try { await navigator.clipboard.writeText(text); return "copied"; } catch { return "fail"; }
}

function openDirections(venueName: string, locality: string) {
  const q = encodeURIComponent(`${venueName}, ${locality}`);
  window.open(`https://www.google.com/maps/search/?api=1&query=${q}`, "_blank", "noopener");
}

// Build a minimal RFC-5545 .ics and hand it to the OS (opens the calendar app
// on mobile, downloads on desktop). Floating local time — no timezone drift.
function icsStamp(date: string, hour: number): string {
  return `${date.replace(/-/g, "")}T${String(hour).padStart(2, "0")}0000`;
}
function addToCalendar(b: BookingView, venueName: string, locality: string) {
  const s = b.slots[0];
  const body = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Sixer Arena//Booking//EN",
    "BEGIN:VEVENT",
    `UID:${b.code}@sixerarena`,
    `DTSTAMP:${icsStamp(s.date, s.hour)}`,
    `DTSTART:${icsStamp(s.date, s.hour)}`,
    `DTEND:${icsStamp(s.date, s.hour + 1)}`,
    `SUMMARY:${s.title} at ${venueName}`,
    `LOCATION:${venueName}, ${locality}`,
    `DESCRIPTION:Booking #${b.code} · Gate entry code ${b.entryCode}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  const url = URL.createObjectURL(new Blob([body], { type: "text/calendar;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `sixer-${b.code}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// Razorpay Checkout is loaded on demand (only when a real order is created).
const RZP_SRC = "https://checkout.razorpay.com/v1/checkout.js";
let rzpLoader: Promise<boolean> | null = null;
function loadRazorpay(): Promise<boolean> {
  if ((window as any).Razorpay) return Promise.resolve(true);
  if (rzpLoader) return rzpLoader;
  rzpLoader = new Promise((resolve) => {
    const s = document.createElement("script");
    s.src = RZP_SRC;
    s.onload = () => resolve(true);
    s.onerror = () => { rzpLoader = null; resolve(false); };
    document.head.appendChild(s);
  });
  return rzpLoader;
}

// On a real phone (or an installed PWA) the decorative bezel would render a
// "phone inside a phone", so we drop it and fill the viewport edge-to-edge.
// On desktop / tablets we keep the phone mockup frame.
function useFullScreenApp() {
  const query = "(max-width: 560px), (display-mode: standalone)";
  const get = () => typeof window !== "undefined" && window.matchMedia(query).matches;
  const [full, setFull] = useState(get);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setFull(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return full;
}

type CartItem = {
  key: string;
  turfId: string;
  turfName: string;
  date: string;
  hour: number;
  label: string;
  pricePaise: number;
  isPeak: boolean;
  sportName: string;
  sub: string;
  icon: string;
  recurring?: boolean; // added by the weekly-repeat toggle
};

type Screen = "splash" | "login" | "app" | "checkout" | "paying" | "confirm" | "detail";
type Tab = "home" | "bookings" | "profile";
type LoginStep = "phone" | "otp" | "name";

export function App() {
  const [screen, setScreen] = useState<Screen>("splash");
  const [tab, setTab] = useState<Tab>("home");
  const [venue, setVenue] = useState<VenueConfig | null>(null);
  const [dates, setDates] = useState<string[]>([]);
  const [sportFilter, setSportFilter] = useState<string | null>(null);
  const [turfId, setTurfId] = useState<string | null>(null);
  const [dateIdx, setDateIdx] = useState(0);
  const [slots, setSlots] = useState<AvailabilitySlot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [cart, setCart] = useState<CartItem[]>([]);

  const [loginStep, setLoginStep] = useState<LoginStep>("phone");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [otpDev, setOtpDev] = useState(false); // "any 4 digits" hint on the OTP screen (mock SMS)
  const [name, setName] = useState("");
  const [team, setTeam] = useState("");
  const [pay, setPay] = useState<"upi" | "card" | "net">("upi");
  const [payMode, setPayMode] = useState<"deposit" | "full">("deposit");

  const [recurringPreview, setRecurringPreview] = useState<RecurringPreview | null>(null);
  const [recurringOn, setRecurringOn] = useState(false);

  const [lastBooking, setLastBooking] = useState<BookingView | null>(null);
  const [bTab, setBTab] = useState<"upcoming" | "past">("upcoming");
  const [bookingRows, setBookingRows] = useState<BookingView[]>([]);
  const [active, setActive] = useState<BookingView | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastT = useRef<number>();

  function toast(m: string) {
    setToastMsg(m);
    clearTimeout(toastT.current);
    toastT.current = window.setTimeout(() => setToastMsg(null), 2400);
  }

  // ---- boot: splash → load config → login or app ----
  useEffect(() => {
    (async () => {
      try {
        const [v, ds] = await Promise.all([api.venue(), api.dates()]);
        setVenue(v);
        setDates(ds);
        setSportFilter(v.multiSport ? v.sports[0].id : null);
      } catch {
        /* backend down — splash will still advance */
      }
    })();
    const t = setTimeout(async () => {
      if (api.isAuthed()) {
        try {
          const me = await api.me();
          if (me.name) {
            setName(me.name);
            if (me.phone) setPhone(me.phone);
            setScreen("app");
            return;
          }
        } catch { /* fall through to login */ }
      }
      setScreen("login");
    }, 1300);
    return () => clearTimeout(t);
  }, []);

  const curSport = useMemo(() => {
    if (!venue) return null;
    const id = venue.multiSport ? sportFilter ?? venue.sports[0].id : venue.sports[0].id;
    return venue.sports.find((s) => s.id === id) ?? venue.sports[0];
  }, [venue, sportFilter]);

  const visTurfs = useMemo(() => {
    if (!venue) return [];
    return venue.multiSport ? venue.turfs.filter((t) => t.sportId === curSport?.id) : venue.turfs;
  }, [venue, curSport]);

  const curTurf = useMemo(() => visTurfs.find((t) => t.id === turfId) ?? visTurfs[0] ?? null, [visTurfs, turfId]);
  const curDate = dates[dateIdx];

  async function loadSlots() {
    if (!curTurf || !curDate) return;
    setLoadingSlots(true);
    try {
      const r = await api.availability(curTurf.id, curDate);
      setSlots(r.slots);
    } catch {
      setSlots([]);
    } finally {
      setLoadingSlots(false);
    }
  }
  useEffect(() => {
    loadSlots();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curTurf?.id, curDate]);

  // ---- login ----
  const activeField = loginStep === "otp" ? "otp" : "phone";
  function pushDigit(d: string) {
    if (activeField === "phone") setPhone((p) => (p.length < 10 ? p + d : p));
    else setOtp((o) => (o.length < 4 ? o + d : o));
  }
  function backspace() {
    if (activeField === "phone") setPhone((p) => p.slice(0, -1));
    else setOtp((o) => o.slice(0, -1));
  }
  async function loginNext() {
    if (loginStep === "phone") {
      if (phone.length < 10) return toast("Enter a 10-digit number");
      try {
        const r = await api.requestOtp(phone);
        setOtpDev(r.mock);
        setOtp("");
        setLoginStep("otp");
      } catch (e: any) {
        toast(e.status === 429 ? "Too many tries — wait a bit" : "Couldn't send code");
      }
    } else if (loginStep === "otp") {
      if (otp.length < 4) return toast("Enter the 4-digit code");
      try {
        const r = await api.verifyOtp(phone, otp);
        if (r.isNewUser) setLoginStep("name");
        else {
          setName(r.name || "");
          setScreen("app");
          setTab("home");
        }
      } catch {
        toast("Wrong code, try again");
      }
    } else {
      if (!name.trim()) return toast("Add your name");
      try {
        await api.setName(name.trim());
      } catch { /* ignore */ }
      setScreen("app");
      setTab("home");
    }
  }

  // ---- cart ----
  function toggleSlot(s: AvailabilitySlot) {
    if (!curTurf || !curSport || !curDate) return;
    const key = `${curTurf.id}|${curDate}|${s.hour}`;
    setCart((c) => {
      const i = c.findIndex((x) => x.key === key);
      if (i >= 0) return c.filter((x) => x.key !== key);
      return [
        ...c,
        {
          key,
          turfId: curTurf.id,
          turfName: curTurf.name,
          date: curDate,
          hour: s.hour,
          label: s.label,
          pricePaise: s.pricePaise,
          isPeak: s.isPeak,
          sportName: curSport.name,
          sub: curSport.sub,
          icon: curSport.icon,
        },
      ];
    });
  }
  const [couponInput, setCouponInput] = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState<{ code: string; discountPaise: number; percentOff: number } | null>(null);
  const [couponMsg, setCouponMsg] = useState<string | null>(null);

  const subtotal = cart.reduce((a, c) => a + c.pricePaise, 0);
  const fee = cart.length ? (venue?.convenienceFeePaise ?? 3000) : 0;
  const discount = appliedCoupon?.discountPaise ?? 0;
  const grand = Math.max(0, subtotal + fee - discount);
  const deposit = Math.round((grand * (venue?.depositPercent ?? 40)) / 100 / 1000) * 1000;

  async function applyCoupon() {
    const code = couponInput.trim();
    if (!code) return;
    setCouponMsg(null);
    try {
      const r = await api.validateCoupon(code, subtotal);
      if (r.valid) {
        setAppliedCoupon({ code: r.code!, discountPaise: r.discountPaise!, percentOff: r.percentOff! });
        setCouponMsg(null);
      } else {
        setAppliedCoupon(null);
        setCouponMsg(couponReason(r.reason));
      }
    } catch {
      setCouponMsg("Couldn't check that code");
    }
  }
  function removeCoupon() { setAppliedCoupon(null); setCouponInput(""); setCouponMsg(null); }
  // Keep the discount honest if the cart total changes after applying.
  useEffect(() => {
    if (!appliedCoupon) return;
    api.validateCoupon(appliedCoupon.code, subtotal).then((r) => {
      if (r.valid) setAppliedCoupon({ code: r.code!, discountPaise: r.discountPaise!, percentOff: r.percentOff! });
      else { setAppliedCoupon(null); setCouponMsg(couponReason(r.reason)); }
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subtotal]);

  // ---- recurring (weekly repeat) ----
  const baseItems = cart.filter((c) => !c.recurring);
  const canRecur = baseItems.length === 1;
  useEffect(() => {
    if (screen === "checkout" && canRecur) {
      const b = baseItems[0];
      api.recurringPreview(b.turfId, b.date, b.hour, 4).then(setRecurringPreview).catch(() => setRecurringPreview(null));
    } else if (screen !== "checkout") {
      setRecurringPreview(null);
      setRecurringOn(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen]);

  function toggleRecurring(on: boolean) {
    const b = cart.find((c) => !c.recurring);
    if (!b || !recurringPreview) return;
    if (on) {
      const adds: CartItem[] = recurringPreview.weeks
        .filter((w) => w.week > 1 && w.available)
        .map((w) => ({ ...b, key: `${b.turfId}|${w.date}|${b.hour}`, date: w.date, pricePaise: w.pricePaise, recurring: true }));
      setCart((c) => [...c.filter((x) => !x.recurring), ...adds]);
      setRecurringOn(true);
    } else {
      setCart((c) => c.filter((x) => !x.recurring));
      setRecurringOn(false);
    }
  }

  // ---- pay ----
  function onCheckoutError(e: any) {
    if (e?.status === 409) {
      // The slot-taken race (README §5): drop the losers, bounce to the grid.
      const conflicts: { turfId: string; date: string; hour: number }[] = e.body?.conflicts ?? [];
      const isConflict = (c: CartItem) => conflicts.some((k) => k.turfId === c.turfId && k.date === c.date && k.hour === c.hour);
      setCart((c) => c.filter((x) => !isConflict(x)));
      setScreen("app");
      setTab("home");
      toast("Ah — that slot was just taken. Pick another.");
      loadSlots();
    } else {
      setScreen("checkout");
      toast("Payment couldn't go through. Try again.");
    }
  }

  async function finishToConfirm(bookingId: string) {
    const bk = await api.booking(bookingId);
    setLastBooking(bk);
    setCart([]);
    setScreen("confirm");
  }

  // Shared Razorpay sheet opener — used by checkout (deposit/full) and by the
  // pay-balance flow on the detail screen. Caller decides what dismissal means.
  async function openRazorpaySheet(opts: {
    keyId?: string;
    orderId: string;
    amountPaise: number;
    bookingId: string;
    code: string;
    onSuccess: () => void | Promise<void>;
    onVerifyError: () => void;
    onDismiss: () => void;
    onLoadFail: () => void | Promise<void>;
  }) {
    const ready = await loadRazorpay();
    if (!ready || !(window as any).Razorpay) {
      await opts.onLoadFail();
      return;
    }
    let settled = false; // guard so dismiss can't fire after success
    const rzp = new (window as any).Razorpay({
      key: opts.keyId,
      order_id: opts.orderId,
      amount: opts.amountPaise,
      currency: "INR",
      name: "Sixer Arena",
      description: `Booking ${opts.code}`,
      image: "/icon.svg",
      prefill: {
        name: name || undefined,
        contact: phone || undefined,
      },
      theme: { color: YELLOW },
      handler: async (resp: any) => {
        settled = true;
        setScreen("paying");
        try {
          await api.verifyPayment(opts.bookingId, {
            razorpay_order_id: resp.razorpay_order_id,
            razorpay_payment_id: resp.razorpay_payment_id,
            razorpay_signature: resp.razorpay_signature,
          });
          await opts.onSuccess();
        } catch {
          opts.onVerifyError();
        }
      },
      modal: {
        ondismiss: () => {
          if (settled) return;
          opts.onDismiss();
        },
      },
    });
    rzp.open();
  }

  async function payNow() {
    if (!cart.length) return;
    setScreen("paying");

    let co: Awaited<ReturnType<typeof api.checkout>>;
    try {
      co = await api.checkout({
        items: cart.map((c) => ({ turfId: c.turfId, date: c.date, hour: c.hour })),
        name: name || "Guest",
        teamName: team || undefined,
        paymentMethod: pay,
        payMode,
        couponCode: appliedCoupon?.code,
        idempotencyKey: crypto.randomUUID(),
      });
    } catch (e) {
      onCheckoutError(e);
      return;
    }

    const payable = co.payablePaise ?? co.depositPaise;

    // Fully discounted (₹0): the backend already confirmed the booking.
    if (payable <= 0) {
      await finishToConfirm(co.bookingId);
      return;
    }

    // Mock provider (no keys configured): confirm in-process.
    if (co.provider === "mock") {
      try {
        await api.completeMockPayment(co.bookingId);
        await finishToConfirm(co.bookingId);
      } catch {
        setScreen("checkout");
        toast("Payment couldn't go through. Try again.");
      }
      return;
    }

    // Real Razorpay: open the hosted checkout sheet.
    // Show the checkout screen behind the sheet rather than the spinner.
    setScreen("checkout");
    await openRazorpaySheet({
      keyId: co.keyId,
      orderId: co.orderId,
      amountPaise: payable,
      bookingId: co.bookingId,
      code: co.code,
      onSuccess: () => finishToConfirm(co.bookingId),
      onVerifyError: () => {
        setScreen("checkout");
        toast("Couldn't confirm payment. If you were charged, it'll reconcile shortly.");
      },
      onDismiss: () => {
        api.abandonBooking(co.bookingId);
        setScreen("checkout");
        toast("Payment cancelled — your slot was released.");
      },
      onLoadFail: async () => {
        await api.abandonBooking(co.bookingId);
        setScreen("checkout");
        toast("Couldn't open payment. Check your connection.");
      },
    });
  }

  async function openBookings(t: "upcoming" | "past" = "upcoming") {
    setScreen("app");
    setTab("bookings");
    setBTab(t);
    try {
      setBookingRows(await api.bookings(t));
    } catch {
      setBookingRows([]);
    }
  }
  useEffect(() => {
    if (screen === "app" && tab === "bookings") api.bookings(bTab).then(setBookingRows).catch(() => setBookingRows([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bTab, tab, screen]);

  async function openDetail(id: string) {
    try {
      const b = await api.booking(id);
      setActive(b);
      setScreen("detail");
    } catch {
      toast("Couldn't open booking");
    }
  }
  async function refreshActive() {
    if (!active) return;
    try { setActive(await api.booking(active.id)); } catch { /* keep current */ }
  }
  async function cancelBooking() {
    if (!active) return;
    try {
      const r = await api.cancel(active.id);
      toast(`Cancelled · ${paiseToMoney(r.refundPaise)} refund initiated`);
      setScreen("app");
      setTab("bookings");
      setBTab("upcoming");
      setBookingRows(await api.bookings("upcoming"));
    } catch {
      toast("Couldn't cancel");
    }
  }
  async function payBalance() {
    if (!active) return;
    let r: Awaited<ReturnType<typeof api.payBalance>>;
    try {
      r = await api.payBalance(active.id);
    } catch (e: any) {
      if (e?.body?.error === "nothing_due") {
        await refreshActive();
        toast("Already settled");
      } else {
        toast("Couldn't start payment. Try again.");
      }
      return;
    }
    if (r.provider === "mock") {
      try {
        await api.completeMockPayment(active.id);
        await refreshActive();
        toast("Balance paid ✓");
      } catch {
        toast("Payment couldn't go through. Try again.");
      }
      return;
    }
    await openRazorpaySheet({
      keyId: r.keyId,
      orderId: r.orderId,
      amountPaise: r.amountPaise,
      bookingId: active.id,
      code: active.code,
      onSuccess: async () => {
        await refreshActive();
        setScreen("detail");
        toast("Balance paid ✓");
      },
      onVerifyError: () => {
        setScreen("detail");
        toast("Couldn't confirm payment. If you were charged, it'll reconcile shortly.");
      },
      // Booking is already confirmed — dismissing just leaves the balance due.
      onDismiss: () => toast("Payment cancelled"),
      onLoadFail: () => toast("Couldn't open payment. Check your connection."),
    });
  }

  const initial = (name || "G").trim().charAt(0).toUpperCase();
  const phoneStr = phone || "98765 43210";
  // What we show as the account's contact.
  const contact = `+91 ${phoneStr}`;
  const showNav = screen === "app";
  const fullScreen = useFullScreenApp();

  return (
    <div style={fullScreen ? outerFull : outer}>
      <div style={fullScreen ? frameFull : frame}>
        {!fullScreen && <div style={notch} />}
        <div className="sx-scroll" style={fullScreen ? screenWrapFull : screenWrap}>
          {screen === "splash" && <Splash />}
          {screen === "login" && (
            <Login
              step={loginStep}
              phone={phone}
              otp={otp}
              name={name}
              otpDev={otpDev}
              onPhone={setPhone}
              onName={setName}
              pushDigit={pushDigit}
              backspace={backspace}
              next={loginNext}
            />
          )}

          {screen === "app" && tab === "home" && venue && curSport && (
            <Home
              venue={venue}
              curSportId={curSport.id}
              onSport={(id) => { setSportFilter(id); setTurfId(null); }}
              turfs={visTurfs}
              curTurfId={curTurf?.id ?? null}
              onTurf={setTurfId}
              dates={dates}
              dateIdx={dateIdx}
              onDate={setDateIdx}
              slots={slots}
              loading={loadingSlots}
              cart={cart}
              basePaise={curSport.basePaise}
              onToggle={toggleSlot}
              initial={initial}
              goProfile={() => { setTab("profile"); }}
              cartCount={cart.length}
              cartTotal={grand}
              goCheckout={() => cart.length && setScreen("checkout")}
            />
          )}

          {screen === "checkout" && (
            <Checkout
              cart={cart}
              name={name}
              contact={contact}
              team={team}
              onName={setName}
              onTeam={setTeam}
              onRemove={(k) => setCart((c) => c.filter((x) => x.key !== k))}
              subtotal={subtotal}
              fee={fee}
              grand={grand}
              deposit={deposit}
              pay={pay}
              setPay={setPay}
              payMode={payMode}
              setPayMode={setPayMode}
              recurringPreview={canRecur ? recurringPreview : null}
              recurringOn={recurringOn}
              onToggleRecurring={toggleRecurring}
              couponInput={couponInput}
              setCouponInput={setCouponInput}
              applyCoupon={applyCoupon}
              appliedCoupon={appliedCoupon}
              couponMsg={couponMsg}
              removeCoupon={removeCoupon}
              discount={discount}
              back={() => { setScreen("app"); setTab("home"); }}
              payNow={payNow}
            />
          )}

          {screen === "paying" && <Paying />}

          {screen === "confirm" && lastBooking && (
            <Confirm booking={lastBooking} contact={contact} venueName={venue?.name ?? "Sixer Arena"} locality={venue?.locality ?? ""} toast={toast} goBookings={() => openBookings("upcoming")} />
          )}

          {screen === "app" && tab === "bookings" && (
            <Bookings
              rows={bookingRows}
              bTab={bTab}
              setTab={setBTab}
              openDetail={openDetail}
              goHome={() => setTab("home")}
            />
          )}

          {screen === "detail" && active && (
            <Detail
              booking={active}
              dates={dates}
              venueName={venue?.name ?? "Sixer Arena"}
              locality={venue?.locality ?? ""}
              toast={toast}
              refresh={refreshActive}
              back={() => { setScreen("app"); setTab("bookings"); }}
              cancel={cancelBooking}
              payBalance={payBalance}
              rebook={() => { setScreen("app"); setTab("home"); }}
            />
          )}

          {screen === "app" && tab === "profile" && (
            <Profile
              name={name}
              contact={contact}
              initial={initial}
              logout={() => { api.logout(); setName(""); setPhone(""); setOtp(""); setOtpDev(false); setLoginStep("phone"); setScreen("login"); }}
            />
          )}

          {showNav && <Nav tab={tab} setTab={setTab} />}
          {toastMsg && <Toast msg={toastMsg} />}
        </div>
      </div>
    </div>
  );
}

// ================= screens =================

function Splash() {
  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 50, background: "radial-gradient(120% 90% at 50% 15%,#201E14 0%,#14130E 55%,#0b0b08 100%)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 22 }}>
      <div style={{ width: 118, height: 118, borderRadius: 30, background: YELLOW, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 0 60px -6px rgba(255,212,0,.7)", animation: "sxpop .5s ease both" }}>
        <span style={{ fontFamily: "Anton", fontSize: 62, color: "#14130E", lineHeight: 1 }}>6</span>
      </div>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontFamily: "Anton", fontSize: 40, letterSpacing: 2, color: "#fff", lineHeight: 0.95 }}>SIXER ARENA</div>
        <div style={{ marginTop: 10, fontSize: 12, fontWeight: 700, letterSpacing: 4, color: YELLOW, textTransform: "uppercase" }}>Box Cricket · Turf Booking</div>
      </div>
      <div style={{ position: "absolute", bottom: 44, display: "flex", gap: 6 }}>
        {[0, 0.2, 0.4].map((d) => (
          <div key={d} style={{ width: 7, height: 7, borderRadius: "50%", background: YELLOW, animation: `sxpulse 1s infinite ${d}s` }} />
        ))}
      </div>
    </div>
  );
}

function Login(props: {
  step: LoginStep;
  phone: string; otp: string; name: string;
  otpDev: boolean;
  onPhone: (v: string) => void; onName: (v: string) => void;
  pushDigit: (d: string) => void; backspace: () => void; next: () => void;
}) {
  const { step, phone, otp, name, otpDev } = props;
  const title = step === "phone" ? "Enter your number" : step === "otp" ? "Verify OTP" : "What's your name?";
  const sub = step === "phone" ? "One tap and the ground is yours." : step === "otp" ? `Sent to +91 ${phone}` : "Almost there.";
  const btn = step === "phone" ? "Send OTP" : step === "otp" ? "Verify & continue" : "Start booking";
  const showPad = step !== "name";
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"];

  const otpHint = otpDev
    ? <>Enter <b style={{ color: YELLOW }}>any 4 digits</b> to continue</>
    : <>Enter the 4-digit code we sent by SMS.</>;

  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 40, background: INK, display: "flex", flexDirection: "column" }}>
      <div style={{ flex: 1, padding: "66px 30px 0", display: "flex", flexDirection: "column", overflowY: "auto" }}>
        <div style={{ width: 60, height: 60, borderRadius: 17, background: YELLOW, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "auto" }}>
          <span style={{ fontFamily: "Anton", fontSize: 34, color: INK }}>6</span>
        </div>
        <div style={{ marginBottom: 22 }}>
          <div style={{ fontFamily: "Anton", fontSize: 34, color: "#fff", lineHeight: 1.02 }}>{title}</div>
          <div style={{ marginTop: 8, fontSize: 13.5, color: "#9a988a", lineHeight: 1.4 }}>{sub}</div>
        </div>

        {step === "phone" && (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, background: PANEL, border: "1.5px solid #34321f", borderRadius: 15, padding: "0 16px", height: 60 }}>
              <span style={{ fontSize: 17, fontWeight: 800, color: "#fff" }}>+91</span>
              <div style={{ width: 1, height: 26, background: "#3a3826" }} />
              <input value={phone} onChange={(e) => props.onPhone(e.target.value.replace(/\D/g, "").slice(0, 10))} inputMode="numeric" maxLength={10} placeholder="98765 43210" style={{ flex: 1, background: "none", border: "none", outline: "none", fontFamily: "Archivo", fontSize: 18, fontWeight: 700, letterSpacing: 1, color: "#fff" }} />
            </div>
            <div style={{ marginTop: 8, fontSize: 11.5, color: "#75736a" }}>We'll send a one-time code by SMS.</div>
          </div>
        )}

        {step === "otp" && (
          <div>
            <div style={{ display: "flex", gap: 9 }}>
              {[0, 1, 2, 3].map((i) => (
                <div key={i} style={{ flex: 1, height: 62, borderRadius: 15, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Anton", fontSize: 26, color: "#fff", background: PANEL, border: otp.length === i ? "1.5px solid #FFD400" : "1.5px solid #34321f" }}>{otp[i] || ""}</div>
              ))}
            </div>
            <div style={{ marginTop: 14, fontSize: 12, color: "#9a988a" }}>{otpHint}</div>
          </div>
        )}

        {step === "name" && (
          <div>
            <div style={{ background: PANEL, border: "1.5px solid #34321f", borderRadius: 15, padding: "0 16px", height: 60, display: "flex", alignItems: "center" }}>
              <input value={name} onChange={(e) => props.onName(e.target.value)} placeholder="Your name" style={{ flex: 1, background: "none", border: "none", outline: "none", fontFamily: "Archivo", fontSize: 18, fontWeight: 700, color: "#fff" }} />
            </div>
            <div style={{ marginTop: 8, fontSize: 11.5, color: "#75736a" }}>So the turf knows who booked.</div>
          </div>
        )}
      </div>

      <div style={{ padding: "14px 22px 22px", background: INK }}>
        {showPad && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 9, marginBottom: 12 }}>
            {keys.map((k, i) => (
              <button key={i} onClick={() => (k === "" ? undefined : k === "⌫" ? props.backspace() : props.pushDigit(k))} style={{ height: 52, borderRadius: 14, fontFamily: "Archivo", fontSize: 22, fontWeight: 800, color: k === "" ? "transparent" : "#fff", background: k === "" ? "transparent" : PANEL, border: k === "" ? "none" : "1px solid #2c2a1c" }}>{k}</button>
            ))}
          </div>
        )}
        <button onClick={props.next} style={{ width: "100%", height: 56, borderRadius: 15, background: YELLOW, color: INK, fontSize: 16, fontWeight: 900 }}>{btn}</button>
      </div>
    </div>
  );
}

function Home(props: {
  venue: VenueConfig; curSportId: string; onSport: (id: string) => void;
  turfs: VenueConfig["turfs"]; curTurfId: string | null; onTurf: (id: string) => void;
  dates: string[]; dateIdx: number; onDate: (i: number) => void;
  slots: AvailabilitySlot[]; loading: boolean; cart: CartItem[]; basePaise: number;
  onToggle: (s: AvailabilitySlot) => void; initial: string; goProfile: () => void;
  cartCount: number; cartTotal: number; goCheckout: () => void;
}) {
  const { venue, turfs } = props;
  const singleTurf = turfs.length === 1;
  const sportOf = (tSportId: string) => venue.sports.find((s) => s.id === tSportId) ?? venue.sports[0];
  const inCart = (hour: number) => props.cart.some((c) => c.turfId === props.curTurfId && c.date === props.dates[props.dateIdx] && c.hour === hour);

  return (
    <>
      <div className="sx-scroll" style={{ flex: 1, overflowY: "auto", paddingBottom: 150 }}>
        <div style={{ background: "linear-gradient(160deg,#201E14,#14130E)", padding: "56px 22px 20px", borderRadius: "0 0 26px 26px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, color: YELLOW, fontSize: 11, fontWeight: 700, letterSpacing: 0.5 }}><span style={{ fontSize: 12 }}>◉</span> {venue.locality}</div>
              <div style={{ fontFamily: "Anton", fontSize: 28, color: "#fff", marginTop: 4, lineHeight: 1 }}>Grab your ground</div>
              <div style={{ fontSize: 11.5, color: "#9a988a", marginTop: 4 }}>Real-time availability · instant WhatsApp confirmation</div>
            </div>
            <button onClick={props.goProfile} style={{ width: 44, height: 44, borderRadius: 14, background: YELLOW, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Anton", fontSize: 20, color: INK }}>{props.initial}</button>
          </div>
        </div>

        {venue.multiSport && (
          <div style={{ padding: "18px 0 0" }}>
            <SectionLabel>Pick a sport</SectionLabel>
            <div className="sx-scroll" style={{ display: "flex", gap: 9, overflowX: "auto", padding: "0 22px 4px" }}>
              {venue.sports.map((sp) => {
                const sel = sp.id === props.curSportId;
                return (
                  <button key={sp.id} onClick={() => props.onSport(sp.id)} style={{ flex: "0 0 auto", display: "flex", alignItems: "center", gap: 7, padding: "10px 14px", borderRadius: 13, fontSize: 13, fontWeight: 800, whiteSpace: "nowrap", background: sel ? INK : "#fff", color: sel ? "#fff" : INK, border: sel ? `1px solid ${INK}` : `1px solid ${LINE}` }}>
                    <span style={{ fontSize: 17 }}>{sp.icon}</span><span>{sp.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div style={{ padding: "16px 0 4px" }}>
          <SectionLabel>{singleTurf ? "Your turf" : "Choose your turf"}</SectionLabel>
          <div className="sx-scroll" style={{ display: "flex", gap: 11, overflowX: "auto", padding: "0 22px 6px" }}>
            {turfs.map((t) => {
              const sp = sportOf(t.sportId);
              const sel = t.id === props.curTurfId;
              return (
                <button key={t.id} onClick={() => props.onTurf(t.id)} style={{ flex: "0 0 auto", width: singleTurf ? "100%" : 232, display: "flex", alignItems: "center", gap: 12, padding: "14px 15px", borderRadius: 16, textAlign: "left", background: sel ? INK : "#fff", border: sel ? `1px solid ${INK}` : `1px solid ${LINE}`, boxShadow: sel ? "0 12px 22px -12px rgba(20,19,14,.5)" : "none" }}>
                  <div style={{ width: 46, height: 46, flex: "none", borderRadius: 13, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, background: sel ? PANEL : APP }}>{sp.icon}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: sel ? "#fff" : INK }}>{t.name}</div>
                    <div style={{ fontSize: 11, fontWeight: 600, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: sel ? YELLOW : MUTED }}>{sp.name} · {sp.sub} · {t.surface}</div>
                  </div>
                  <div style={{ flex: "none", fontSize: 12, fontWeight: 800, textAlign: "right", color: sel ? YELLOW : INK }}>from {paiseToMoney(sp.basePaise)}</div>
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ padding: "10px 0 2px" }}>
          <SectionLabel>When</SectionLabel>
          <div className="sx-scroll" style={{ display: "flex", gap: 9, overflowX: "auto", padding: "0 22px 4px" }}>
            {props.dates.map((iso, i) => {
              const sel = i === props.dateIdx;
              const d = new Date(iso + "T00:00:00");
              const dow = i === 0 ? "Today" : DOW[d.getDay()];
              return (
                <button key={iso} onClick={() => props.onDate(i)} style={{ flex: "0 0 auto", width: 58, display: "flex", flexDirection: "column", alignItems: "center", gap: 2, padding: "11px 0", borderRadius: 15, background: sel ? INK : "#fff", border: sel ? `1px solid ${INK}` : `1px solid ${LINE}` }}>
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: sel ? YELLOW : MUTED }}>{dow}</span>
                  <span style={{ fontFamily: "Anton", fontSize: 20, color: sel ? "#fff" : INK }}>{d.getDate()}</span>
                  <span style={{ fontSize: 10, fontWeight: 600, color: "#9a988a" }}>{MO[d.getMonth()]}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ display: "flex", gap: 16, padding: "14px 22px 6px" }}>
          <Legend color={YELLOW} label="Open" />
          <Legend color="#FF5A2C" label="Peak" />
          <Legend color="#D8D8D0" label="Full" />
        </div>

        {props.loading ? (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, padding: "6px 22px 4px" }}>
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} style={{ height: 62, borderRadius: 13, background: "#EDEDE6", animation: "sxpulse 1.2s infinite" }} />
            ))}
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, padding: "6px 22px 4px" }}>
            {props.slots.map((s) => {
              const picked = inCart(s.hour);
              const st = slotStyle(s, picked);
              return (
                <button key={s.hour} disabled={s.status === "full" || s.status === "blocked"} onClick={() => props.onToggle(s)} style={st.tile}>
                  <div style={st.bar} />
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 3 }}>
                    <span style={{ fontSize: 15, fontWeight: 800, letterSpacing: 0.2 }}>{s.label}</span>
                    <span style={{ fontSize: 13, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{paiseToMoney(s.pricePaise)}</span>
                  </div>
                  <span style={st.badge}>{st.badgeText}</span>
                </button>
              );
            })}
          </div>
        )}
        {!props.loading && props.slots.every((s) => s.status === "full" || s.status === "blocked") && (
          <div style={{ textAlign: "center", padding: "24px 20px" }}>
            <div style={{ fontSize: 34 }}>🌧️</div>
            <div style={{ fontFamily: "Anton", fontSize: 18, color: INK, marginTop: 8 }}>Fully booked</div>
            <div style={{ fontSize: 12, color: MUTED, marginTop: 4 }}>Try tomorrow — evenings go fast.</div>
          </div>
        )}
      </div>

      {props.cartCount > 0 && (
        <div style={{ position: "absolute", left: 14, right: 14, bottom: 78, zIndex: 30, animation: "sxrise .25s ease both" }}>
          <button onClick={props.goCheckout} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", background: INK, borderRadius: 18, padding: "14px 16px 14px 18px", boxShadow: "0 18px 34px -12px rgba(20,19,14,.6)" }}>
            <div style={{ textAlign: "left" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: YELLOW }}>{props.cartCount} slot{props.cartCount === 1 ? "" : "s"} selected</div>
              <div style={{ fontFamily: "Anton", fontSize: 22, color: "#fff", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{paiseToMoney(props.cartTotal)}</div>
            </div>
            <span style={{ display: "flex", alignItems: "center", gap: 8, background: YELLOW, color: INK, fontWeight: 800, fontSize: 14, padding: "11px 18px", borderRadius: 13 }}>Book now →</span>
          </button>
        </div>
      )}
    </>
  );
}

function Checkout(props: {
  cart: CartItem[]; name: string; contact: string; team: string;
  onName: (v: string) => void; onTeam: (v: string) => void; onRemove: (k: string) => void;
  subtotal: number; fee: number; grand: number; deposit: number;
  pay: "upi" | "card" | "net"; setPay: (p: "upi" | "card" | "net") => void;
  payMode: "deposit" | "full"; setPayMode: (m: "deposit" | "full") => void;
  recurringPreview: RecurringPreview | null; recurringOn: boolean; onToggleRecurring: (on: boolean) => void;
  couponInput: string; setCouponInput: (v: string) => void; applyCoupon: () => void;
  appliedCoupon: { code: string; discountPaise: number; percentOff: number } | null; couponMsg: string | null; removeCoupon: () => void; discount: number;
  back: () => void; payNow: () => void;
}) {
  const methods = [{ id: "upi", name: "UPI", icon: "🟣" }, { id: "card", name: "Card", icon: "💳" }, { id: "net", name: "Netbank", icon: "🏦" }] as const;
  const cartCountStr = `${props.cart.length} slot${props.cart.length === 1 ? "" : "s"} selected`;
  const today = props.cart[0]?.date;
  const payingNow = props.payMode === "full" ? props.grand : props.deposit;
  return (
    <>
      <div className="sx-scroll" style={{ flex: 1, overflowY: "auto", background: APP, paddingBottom: 120 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "56px 20px 16px" }}>
          <button onClick={props.back} style={{ width: 40, height: 40, borderRadius: 12, background: "#fff", border: `1px solid ${LINE}`, fontSize: 18, color: INK }}>←</button>
          <div style={{ fontFamily: "Anton", fontSize: 26, color: INK }}>Checkout</div>
        </div>
        <div style={{ padding: "0 18px" }}>
          <MiniLabel>Your slots</MiniLabel>
          <div style={{ background: "#fff", border: `1px solid ${LINE}`, borderRadius: 16, overflow: "hidden" }}>
            {props.cart.map((c) => (
              <div key={c.key} style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 15px", borderBottom: "1px solid #F0F0EA" }}>
                <div style={{ width: 40, height: 40, borderRadius: 12, background: APP, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>{c.icon}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: INK }}>{c.sportName} · {c.sub}{c.recurring ? " · weekly" : ""}</div>
                  <div style={{ fontSize: 11.5, color: MUTED }}>{humanDate(c.date, today)} · {c.label}</div>
                </div>
                <div style={{ fontSize: 14, fontWeight: 800, color: INK, fontVariantNumeric: "tabular-nums" }}>{paiseToMoney(c.pricePaise)}</div>
                <button onClick={() => props.onRemove(c.key)} style={{ width: 26, height: 26, borderRadius: 8, background: APP, color: "#E5533C", fontSize: 15, fontWeight: 800 }}>×</button>
              </div>
            ))}
          </div>

          {props.recurringPreview && props.recurringPreview.weeks.some((w) => w.week > 1 && w.available) && (
            <RecurringCard preview={props.recurringPreview} on={props.recurringOn} onToggle={props.onToggleRecurring} />
          )}

          <MiniLabel style={{ marginTop: 20 }}>Your details</MiniLabel>
          <div style={{ background: "#fff", border: `1px solid ${LINE}`, borderRadius: 16, padding: "6px 14px" }}>
            <Field label="Name"><input value={props.name} onChange={(e) => props.onName(e.target.value)} placeholder="Your name" style={fieldInput} /></Field>
            <Field label="Contact"><span style={{ flex: 1, fontSize: 14.5, fontWeight: 700, color: INK }}>{props.contact}</span></Field>
            <Field label="Team" last><input value={props.team} onChange={(e) => props.onTeam(e.target.value)} placeholder="Optional" style={fieldInput} /></Field>
          </div>

          <MiniLabel style={{ marginTop: 20 }}>Coupon</MiniLabel>
          {props.appliedCoupon ? (
            <div style={{ display: "flex", alignItems: "center", gap: 10, background: "#EAF7E2", border: "1px solid #BFE4AC", borderRadius: 14, padding: "12px 14px" }}>
              <span style={{ fontSize: 18 }}>🎟️</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13.5, fontWeight: 800, color: "#2F6B1E" }}>{props.appliedCoupon.code} applied</div>
                <div style={{ fontSize: 11.5, color: "#3B7A22" }}>{props.appliedCoupon.percentOff}% off · you save {paiseToMoney(props.discount)}</div>
              </div>
              <button onClick={props.removeCoupon} style={{ fontSize: 12, fontWeight: 800, color: "#E5533C", padding: "6px 10px", borderRadius: 9, background: "#fff", border: "1px solid #E6E6DE" }}>Remove</button>
            </div>
          ) : (
            <div style={{ display: "flex", gap: 8 }}>
              <input value={props.couponInput} onChange={(e) => props.setCouponInput(e.target.value.toUpperCase())} onKeyDown={(e) => e.key === "Enter" && props.applyCoupon()} placeholder="Have a code? e.g. FIRST20" style={{ flex: 1, background: "#fff", border: `1px solid ${LINE}`, borderRadius: 14, padding: "0 14px", height: 48, fontFamily: "Archivo", fontSize: 14, fontWeight: 700, letterSpacing: 0.5, color: INK, outline: "none" }} />
              <button onClick={props.applyCoupon} style={{ width: 88, height: 48, borderRadius: 14, background: INK, color: "#fff", fontSize: 13.5, fontWeight: 800 }}>Apply</button>
            </div>
          )}
          {props.couponMsg && <div style={{ marginTop: 7, fontSize: 11.5, fontWeight: 700, color: "#E5533C" }}>{props.couponMsg}</div>}

          <MiniLabel style={{ marginTop: 20 }}>Bill</MiniLabel>
          <div style={{ background: "#fff", border: `1px solid ${LINE}`, borderRadius: 16, padding: "14px 15px" }}>
            <BillRow label={`Slot total (${cartCountStr})`} value={paiseToMoney(props.subtotal)} />
            <BillRow label="Convenience fee" value={paiseToMoney(props.fee)} dashed={props.discount === 0} />
            {props.discount > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5, color: "#2F6B1E", marginBottom: 11, paddingBottom: 11, borderBottom: "1px dashed #E6E6DE" }}>
                <span>Coupon {props.appliedCoupon?.code}</span>
                <span style={{ fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>− {paiseToMoney(props.discount)}</span>
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: INK }}>Total</span>
              <span style={{ fontFamily: "Anton", fontSize: 24, color: INK, fontVariantNumeric: "tabular-nums" }}>{paiseToMoney(props.grand)}</span>
            </div>
          </div>

          <MiniLabel style={{ marginTop: 20 }}>Paying now</MiniLabel>
          <div style={{ display: "flex", gap: 9 }}>
            {([
              { id: "deposit", title: "Pay deposit", amount: props.deposit, note: "rest at the ground" },
              { id: "full", title: "Pay full", amount: props.grand, note: "nothing due later" },
            ] as const).map((m) => {
              const sel = m.id === props.payMode;
              return (
                <button key={m.id} onClick={() => props.setPayMode(m.id)} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 3, padding: "13px 14px", borderRadius: 14, background: sel ? INK : "#fff", border: sel ? `1px solid ${INK}` : `1px solid ${LINE}`, color: sel ? "#fff" : INK, textAlign: "left" }}>
                  <span style={{ fontSize: 12, fontWeight: 800 }}>{m.title}</span>
                  <span style={{ fontFamily: "Anton", fontSize: 20, fontVariantNumeric: "tabular-nums" }}>{paiseToMoney(m.amount)}</span>
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: sel ? "#9a988a" : MUTED }}>{m.note}</span>
                </button>
              );
            })}
          </div>
          {props.payMode === "deposit" && (
            <div style={{ marginTop: 8, fontSize: 11, color: MUTED, background: "#FFF9D6", border: "1px solid #F2E7A0", borderRadius: 9, padding: "7px 9px" }}>Pay <b style={{ color: INK }}>{paiseToMoney(props.deposit)}</b> now to lock the slot · balance of <b style={{ color: INK }}>{paiseToMoney(props.grand - props.deposit)}</b> in cash at the ground or later in the app.</div>
          )}

          <MiniLabel style={{ marginTop: 20 }}>Pay with</MiniLabel>
          <div style={{ display: "flex", gap: 9 }}>
            {methods.map((m) => {
              const sel = m.id === props.pay;
              return (
                <button key={m.id} onClick={() => props.setPay(m.id)} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 5, padding: "13px 0", borderRadius: 14, background: sel ? INK : "#fff", border: sel ? `1px solid ${INK}` : `1px solid ${LINE}`, color: sel ? "#fff" : INK }}>
                  <span style={{ fontSize: 19 }}>{m.icon}</span><span style={{ fontSize: 11.5, fontWeight: 700 }}>{m.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, zIndex: 30, padding: "14px 18px 22px", background: "linear-gradient(#F4F4EE00,#F4F4EE 26%)" }}>
        <button onClick={props.payNow} style={{ width: "100%", height: 56, borderRadius: 15, background: YELLOW, color: INK, fontSize: 16, fontWeight: 900, boxShadow: "0 14px 26px -10px rgba(255,212,0,.7)" }}>Pay {paiseToMoney(payingNow)} →</button>
      </div>
    </>
  );
}

function RecurringCard(props: { preview: RecurringPreview; on: boolean; onToggle: (on: boolean) => void }) {
  const freeFuture = props.preview.weeks.filter((w) => w.week > 1 && w.available);
  const addCount = freeFuture.length;
  const addTotal = freeFuture.reduce((a, w) => a + w.pricePaise, 0);
  return (
    <div style={{ marginTop: 20, background: INK, borderRadius: 16, padding: "16px 16px 14px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 800, color: "#fff" }}>↻ Make it weekly</div>
          <div style={{ fontSize: 11.5, color: "#9a988a", marginTop: 2 }}>Same slot, {props.preview.label}, every week — lock your team's spot.</div>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 7, margin: "14px 0" }}>
        {props.preview.weeks.map((w) => (
          <div key={w.date} style={{ display: "flex", alignItems: "center", gap: 10, background: "#201E15", border: "1px solid #2c2a1c", borderRadius: 11, padding: "9px 12px" }}>
            <span style={{ fontSize: 11, fontWeight: 800, color: YELLOW, width: 20 }}>W{w.week}</span>
            <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: "#fff" }}>{w.human}</span>
            {w.week === 1 ? (
              <span style={{ fontSize: 10.5, fontWeight: 800, color: "#14130E", background: YELLOW, padding: "3px 8px", borderRadius: 7 }}>In cart</span>
            ) : w.available ? (
              <span style={{ fontSize: 10.5, fontWeight: 800, color: "#8fe07a" }}>Free · {paiseToMoney(w.pricePaise)}</span>
            ) : (
              <span style={{ fontSize: 10.5, fontWeight: 800, color: "#e07a7a" }}>Taken</span>
            )}
          </div>
        ))}
      </div>
      <button onClick={() => props.onToggle(!props.on)} style={{ width: "100%", height: 46, borderRadius: 12, fontSize: 13.5, fontWeight: 800, background: props.on ? "#201E15" : YELLOW, color: props.on ? "#fff" : INK, border: props.on ? "1px solid #34321f" : "none" }}>
        {props.on ? `✓ Added ${addCount} weekly slot${addCount === 1 ? "" : "s"} · tap to remove` : `Add ${addCount} free week${addCount === 1 ? "" : "s"} · +${paiseToMoney(addTotal)}`}
      </button>
    </div>
  );
}

function Paying() {
  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 45, background: INK, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 22 }}>
      <div style={{ width: 60, height: 60, borderRadius: "50%", border: "5px solid #34321f", borderTopColor: YELLOW, animation: "sxspin .8s linear infinite" }} />
      <div style={{ textAlign: "center" }}>
        <div style={{ fontFamily: "Anton", fontSize: 22, color: "#fff" }}>Processing payment</div>
        <div style={{ marginTop: 6, fontSize: 12.5, color: "#9a988a" }}>Securing your slot · don't close this</div>
      </div>
    </div>
  );
}

function Confirm(props: { booking: BookingView; contact: string; venueName: string; locality: string; toast: (m: string) => void; goBookings: () => void }) {
  const b = props.booking;
  return (
    <div className="sx-scroll" style={{ flex: 1, overflowY: "auto", background: INK, paddingBottom: 30 }}>
      <div style={{ padding: "70px 24px 26px", textAlign: "center" }}>
        <div style={{ width: 92, height: 92, borderRadius: "50%", background: YELLOW, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto", boxShadow: "0 0 50px -6px rgba(255,212,0,.7)", animation: "sxpop .5s ease both" }}>
          <span style={{ fontSize: 46, color: INK }}>✓</span>
        </div>
        <div style={{ fontFamily: "Anton", fontSize: 32, color: "#fff", marginTop: 20, lineHeight: 1 }}>Slot locked in</div>
        <div style={{ marginTop: 8, fontSize: 13, color: "#9a988a" }}>Booking <b style={{ color: YELLOW }}>#{b.code}</b></div>
      </div>
      <div style={{ margin: "0 20px", background: "#fff", borderRadius: 18, padding: "16px 16px 6px" }}>
        {b.slots.map((c, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 0", borderBottom: "1px solid #F0F0EA" }}>
            <div style={{ width: 38, height: 38, borderRadius: 11, background: APP, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 19 }}>{c.icon}</div>
            <div style={{ flex: 1 }}><div style={{ fontSize: 13.5, fontWeight: 800, color: INK }}>{c.title}</div><div style={{ fontSize: 11, color: MUTED }}>{c.subtitle}</div></div>
            <div style={{ fontSize: 13.5, fontWeight: 800, color: INK, fontVariantNumeric: "tabular-nums" }}>{paiseToMoney(c.pricePaise)}</div>
          </div>
        ))}
        {b.discountPaise > 0 && (
          <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0 0", fontSize: 12, color: "#2F6B1E" }}><span>Coupon {b.couponCode}</span><span style={{ fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>− {paiseToMoney(b.discountPaise)}</span></div>
        )}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "13px 0 12px" }}><span style={{ fontSize: 12, fontWeight: 800, color: MUTED }}>TOTAL PAID</span><span style={{ fontFamily: "Anton", fontSize: 22, color: INK, fontVariantNumeric: "tabular-nums" }}>{paiseToMoney(b.amountPaidPaise)}</span></div>
      </div>
      <div style={{ margin: "14px 20px 0", display: "flex", alignItems: "center", gap: 9, background: "#1e3b18", border: "1px solid #2e5a24", borderRadius: 13, padding: "12px 14px" }}>
        <span style={{ fontSize: 19 }}>✅</span>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: "#c7f0b8" }}>Confirmation sent to {props.contact}</span>
      </div>
      <div style={{ display: "flex", gap: 9, padding: "16px 20px 4px" }}>
        {[
          { t: "📅 Calendar", onClick: () => { addToCalendar(props.booking, props.venueName, props.locality); props.toast("Calendar file ready"); } },
          { t: "↗ Share", onClick: async () => { const r = await shareBooking(props.booking, props.venueName, props.locality); if (r === "copied") props.toast("Booking details copied"); else if (r === "fail") props.toast("Couldn't share"); } },
          { t: "◉ Directions", onClick: () => openDirections(props.venueName, props.locality) },
        ].map((b) => (
          <button key={b.t} onClick={b.onClick} style={{ flex: 1, height: 48, borderRadius: 13, background: PANEL, color: "#fff", fontSize: 12.5, fontWeight: 700, border: "1px solid #34321f" }}>{b.t}</button>
        ))}
      </div>
      <div style={{ padding: "8px 20px 0" }}>
        <button onClick={props.goBookings} style={{ width: "100%", height: 54, borderRadius: 15, background: YELLOW, color: INK, fontSize: 15, fontWeight: 900 }}>View my bookings</button>
      </div>
    </div>
  );
}

function Bookings(props: { rows: BookingView[]; bTab: "upcoming" | "past"; setTab: (t: "upcoming" | "past") => void; openDetail: (id: string) => void; goHome: () => void }) {
  const tabStyle = (a: boolean): CSSProperties => ({ flex: 1, height: 42, borderRadius: 12, fontSize: 13.5, fontWeight: 800, background: a ? INK : "#fff", color: a ? "#fff" : MUTED, border: a ? `1px solid ${INK}` : `1px solid ${LINE}` });
  return (
    <div className="sx-scroll" style={{ flex: 1, overflowY: "auto", paddingBottom: 100 }}>
      <div style={{ padding: "56px 22px 14px" }}><div style={{ fontFamily: "Anton", fontSize: 28, color: INK }}>My bookings</div></div>
      <div style={{ display: "flex", gap: 8, padding: "0 22px 14px" }}>
        <button onClick={() => props.setTab("upcoming")} style={tabStyle(props.bTab === "upcoming")}>Upcoming</button>
        <button onClick={() => props.setTab("past")} style={tabStyle(props.bTab === "past")}>Past</button>
      </div>
      <div style={{ padding: "0 18px", display: "flex", flexDirection: "column", gap: 11 }}>
        {props.rows.map((b) => {
          const first = b.slots[0];
          const extra = b.slots.length > 1 ? ` · +${b.slots.length - 1} more` : "";
          return (
            <button key={b.id} onClick={() => props.openDetail(b.id)} style={{ display: "flex", alignItems: "center", gap: 13, background: "#fff", border: `1px solid ${LINE}`, borderRadius: 16, padding: "14px 15px", textAlign: "left" }}>
              <div style={{ width: 46, height: 46, borderRadius: 13, background: INK, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>{first.icon}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14.5, fontWeight: 800, color: INK }}>{first.title}</div>
                <div style={{ fontSize: 11.5, color: MUTED, marginTop: 2 }}>{first.subtitle}{extra}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: INK, fontVariantNumeric: "tabular-nums" }}>{paiseToMoney(b.totalPaise)}</div>
                <div style={statusChip(b.status)}>{prettyStatus(b.status)}</div>
              </div>
            </button>
          );
        })}
        {props.rows.length === 0 && (
          <div style={{ textAlign: "center", padding: "50px 20px" }}>
            <div style={{ fontSize: 44 }}>🥅</div>
            <div style={{ fontFamily: "Anton", fontSize: 20, color: INK, marginTop: 10 }}>Nothing here yet</div>
            <div style={{ fontSize: 12.5, color: MUTED, marginTop: 4 }}>Your booked slots will show up here.</div>
            <button onClick={props.goHome} style={{ marginTop: 16, height: 46, padding: "0 22px", borderRadius: 13, background: YELLOW, color: INK, fontSize: 14, fontWeight: 800 }}>Grab a ground →</button>
          </div>
        )}
      </div>
    </div>
  );
}

function RescheduleSheet(props: { booking: BookingView; dates: string[]; toast: (m: string) => void; onClose: () => void; onDone: (m: string) => void }) {
  const slot = props.booking.slots[0];
  const [dateIdx, setDateIdx] = useState(0);
  const [slots, setSlots] = useState<AvailabilitySlot[]>([]);
  const [hour, setHour] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const date = props.dates[dateIdx];

  useEffect(() => {
    if (!date) return;
    setHour(null);
    api.availability(slot.turfId, date).then((r) => setSlots(r.slots)).catch(() => setSlots([]));
  }, [date, slot.turfId]);

  const open = slots.filter((s) => s.status === "open" || s.status === "peak");

  async function confirm() {
    if (hour == null || !date) return;
    setBusy(true);
    try {
      await api.reschedule(props.booking.id, date, hour);
      props.onDone("Rescheduled · new time locked");
    } catch (e: any) {
      if (e.status === 409) {
        props.toast("That slot was just taken");
        api.availability(slot.turfId, date).then((r) => setSlots(r.slots)).catch(() => {});
      } else props.toast("Couldn't reschedule");
    } finally { setBusy(false); }
  }

  return (
    <div onClick={props.onClose} style={{ position: "absolute", inset: 0, zIndex: 60, background: "rgba(20,19,14,.55)", display: "flex", alignItems: "flex-end" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", background: "#fff", borderRadius: "22px 22px 0 0", maxHeight: "88%", display: "flex", flexDirection: "column", animation: "sxrise .25s ease both" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 20px 8px" }}>
          <div><div style={{ fontFamily: "Anton", fontSize: 22, color: INK }}>Reschedule</div><div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>Same turf · pick a new time</div></div>
          <button onClick={props.onClose} style={{ width: 34, height: 34, borderRadius: 11, background: APP, color: INK, fontSize: 17, fontWeight: 800 }}>×</button>
        </div>
        <div className="sx-scroll" style={{ overflowY: "auto", padding: "6px 18px 0" }}>
          <MiniLabel>When</MiniLabel>
          <div className="sx-scroll" style={{ display: "flex", gap: 9, overflowX: "auto", paddingBottom: 6 }}>
            {props.dates.map((iso, i) => {
              const sel = i === dateIdx;
              const d = new Date(iso + "T00:00:00");
              const dow = i === 0 ? "Today" : DOW[d.getDay()];
              return (
                <button key={iso} onClick={() => setDateIdx(i)} style={{ flex: "0 0 auto", width: 58, display: "flex", flexDirection: "column", alignItems: "center", gap: 2, padding: "11px 0", borderRadius: 15, background: sel ? INK : "#fff", border: sel ? `1px solid ${INK}` : `1px solid ${LINE}` }}>
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: sel ? YELLOW : MUTED }}>{dow}</span>
                  <span style={{ fontFamily: "Anton", fontSize: 20, color: sel ? "#fff" : INK }}>{d.getDate()}</span>
                  <span style={{ fontSize: 10, fontWeight: 600, color: "#9a988a" }}>{MO[d.getMonth()]}</span>
                </button>
              );
            })}
          </div>
          <MiniLabel style={{ marginTop: 16 }}>Open slots</MiniLabel>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9, paddingBottom: 12 }}>
            {open.map((s) => {
              const sel = s.hour === hour;
              return (
                <button key={s.hour} onClick={() => setHour(s.hour)} style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 3, padding: "12px 14px", borderRadius: 13, background: sel ? INK : "#fff", border: sel ? `1px solid ${INK}` : `1px solid ${LINE}`, color: sel ? "#fff" : INK }}>
                  <span style={{ fontSize: 14, fontWeight: 800 }}>{s.label}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: sel ? YELLOW : MUTED }}>{paiseToMoney(s.pricePaise)}{s.status === "peak" ? " · peak" : ""}</span>
                </button>
              );
            })}
            {open.length === 0 && <div style={{ gridColumn: "1/3", textAlign: "center", padding: "20px 8px", fontSize: 12.5, color: MUTED }}>No open slots that day.</div>}
          </div>
        </div>
        <div style={{ padding: "10px 18px 22px", borderTop: `1px solid ${LINE}` }}>
          <button onClick={confirm} disabled={hour == null || busy} style={{ width: "100%", height: 54, borderRadius: 15, background: YELLOW, color: INK, fontSize: 15, fontWeight: 900, opacity: hour == null || busy ? 0.55 : 1 }}>{busy ? "Moving…" : "Confirm new time"}</button>
        </div>
      </div>
    </div>
  );
}

function Detail(props: { booking: BookingView; dates: string[]; venueName: string; locality: string; toast: (m: string) => void; refresh: () => void; back: () => void; cancel: () => void; payBalance: () => void; rebook: () => void }) {
  const b = props.booking;
  const first = b.slots[0];
  const upcoming = !b.past && b.status !== "CANCELLED";
  const [reschedOpen, setReschedOpen] = useState(false);
  function onReschedClick() {
    if (b.slots.length > 1) return props.toast("Multi-slot bookings — cancel & rebook to change");
    setReschedOpen(true);
  }
  const qr = Array.from({ length: 49 }).map((_, i) => {
    const on = (i * 7 + 3) % 3 !== 0 && i % 5 !== 2;
    const corner = i < 2 || (i >= 7 && i < 9) || i === 14 || i === 4 || i === 5 || (i >= 11 && i < 13);
    return on || corner;
  });
  return (
    <div className="sx-scroll" style={{ flex: 1, overflowY: "auto", background: APP, paddingBottom: 30 }}>
      <div style={{ background: "linear-gradient(160deg,#201E14,#14130E)", padding: "56px 22px 24px", borderRadius: "0 0 24px 24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
          <button onClick={props.back} style={{ width: 40, height: 40, borderRadius: 12, background: PANEL, border: "1px solid #34321f", fontSize: 18, color: "#fff" }}>←</button>
          <div style={{ ...statusChip(b.status), fontSize: 11 }}>{prettyStatus(b.status)}</div>
        </div>
        <div style={{ fontSize: 28 }}>{first.icon}</div>
        <div style={{ fontFamily: "Anton", fontSize: 30, color: "#fff", marginTop: 6, lineHeight: 1.02 }}>{first.title}</div>
        <div style={{ fontSize: 13, color: "#9a988a", marginTop: 6 }}>{first.subtitle}</div>
      </div>

      {upcoming && (
        <div style={{ margin: "16px 20px 0", background: INK, borderRadius: 18, padding: 20, display: "flex", alignItems: "center", gap: 18 }}>
          <div style={{ width: 96, height: 96, borderRadius: 12, background: "#fff", padding: 8, display: "grid", gridTemplateColumns: "repeat(7,1fr)", gridTemplateRows: "repeat(7,1fr)", gap: 2 }}>
            {qr.map((on, i) => (<div key={i} style={{ background: on ? INK : "#fff", borderRadius: 1 }} />))}
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: YELLOW, letterSpacing: 0.5, textTransform: "uppercase" }}>Gate entry code</div>
            <div style={{ fontFamily: "Anton", fontSize: 30, color: "#fff", letterSpacing: 3, marginTop: 4 }}>{b.entryCode}</div>
            <div style={{ fontSize: 11, color: "#9a988a", marginTop: 4 }}>Show at the gate to enter.</div>
          </div>
        </div>
      )}

      <div style={{ margin: "16px 20px 0", background: "#fff", border: `1px solid ${LINE}`, borderRadius: 16, padding: 15 }}>
        <DetailRow label="Turf" value={`Sixer Arena · ${b.court}`} />
        <DetailRow label="Court" value={b.court} />
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: MUTED, paddingTop: 9, borderTop: "1px dashed #E6E6DE" }}><span>Amount paid</span><span style={{ fontWeight: 800, color: INK, fontVariantNumeric: "tabular-nums" }}>{paiseToMoney(b.amountPaidPaise)}</span></div>
        {b.amountDuePaise > 0 && (
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: MUTED, marginTop: 9 }}><span>Balance at ground</span><span style={{ fontWeight: 800, color: "#C25A16", fontVariantNumeric: "tabular-nums" }}>{paiseToMoney(b.amountDuePaise)}</span></div>
        )}
      </div>

      {upcoming && (
        <div style={{ display: "flex", gap: 9, padding: "16px 20px 0" }}>
          {[
            { t: "📅 Calendar", onClick: () => { addToCalendar(b, props.venueName, props.locality); props.toast("Calendar file ready"); } },
            { t: "↗ Share", onClick: async () => { const r = await shareBooking(b, props.venueName, props.locality); if (r === "copied") props.toast("Booking details copied"); else if (r === "fail") props.toast("Couldn't share"); } },
            { t: "◉ Directions", onClick: () => openDirections(props.venueName, props.locality) },
          ].map((a) => (
            <button key={a.t} onClick={a.onClick} style={{ flex: 1, height: 46, borderRadius: 13, background: "#fff", color: INK, fontSize: 12.5, fontWeight: 800, border: `1px solid ${LINE}` }}>{a.t}</button>
          ))}
        </div>
      )}

      <div style={{ padding: "12px 20px 0", display: "flex", flexDirection: "column", gap: 9 }}>
        {upcoming && (
          <>
            {b.status === "CONFIRMED" && b.amountDuePaise > 0 && (
              <button onClick={props.payBalance} style={{ height: 52, borderRadius: 14, background: YELLOW, color: INK, fontSize: 14.5, fontWeight: 900, boxShadow: "0 14px 26px -10px rgba(255,212,0,.7)" }}>Pay balance {paiseToMoney(b.amountDuePaise)} →</button>
            )}
            <div style={{ display: "flex", gap: 9 }}>
              <button onClick={onReschedClick} style={{ flex: 1, height: 50, borderRadius: 14, background: INK, color: "#fff", fontSize: 13.5, fontWeight: 800 }}>↻ Reschedule</button>
              <button onClick={props.cancel} style={{ flex: 1, height: 50, borderRadius: 14, background: "#FCE9E5", color: "#E5533C", fontSize: 13.5, fontWeight: 800, border: "1px solid #F4C9BF" }}>Cancel booking</button>
            </div>
            <div style={{ fontSize: 11, color: MUTED, textAlign: "center" }}>Free cancellation up to 6 hrs before · 50% refund after.</div>
          </>
        )}
        {b.past && (
          <button onClick={props.rebook} style={{ height: 52, borderRadius: 14, background: YELLOW, color: INK, fontSize: 14.5, fontWeight: 900 }}>Rebook this slot</button>
        )}
      </div>

      {reschedOpen && (
        <RescheduleSheet
          booking={b}
          dates={props.dates}
          toast={props.toast}
          onClose={() => setReschedOpen(false)}
          onDone={(m) => { setReschedOpen(false); props.toast(m); props.refresh(); }}
        />
      )}
    </div>
  );
}

function Profile(props: { name: string; contact: string; initial: string; logout: () => void }) {
  const rows = [{ icon: "👥", label: "Saved teams" }, { icon: "⭐", label: "Favourite turf" }, { icon: "🧾", label: "Payment history" }, { icon: "🔔", label: "Notifications" }];
  return (
    <div className="sx-scroll" style={{ flex: 1, overflowY: "auto", paddingBottom: 100 }}>
      <div style={{ background: "linear-gradient(160deg,#201E14,#14130E)", padding: "60px 22px 26px", borderRadius: "0 0 24px 24px", display: "flex", alignItems: "center", gap: 15 }}>
        <div style={{ width: 64, height: 64, borderRadius: 20, background: YELLOW, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Anton", fontSize: 30, color: INK }}>{props.initial}</div>
        <div><div style={{ fontFamily: "Anton", fontSize: 24, color: "#fff" }}>{props.name || "Guest"}</div><div style={{ fontSize: 12.5, color: "#9a988a" }}>{props.contact}</div></div>
      </div>
      <div style={{ padding: "16px 20px 0", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ background: "#fff", border: `1px solid ${LINE}`, borderRadius: 16, overflow: "hidden" }}>
          {rows.map((r) => (
            <div key={r.label} style={{ display: "flex", alignItems: "center", gap: 13, padding: "15px 16px", borderBottom: "1px solid #F0F0EA" }}><span style={{ fontSize: 19, width: 24 }}>{r.icon}</span><span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: INK }}>{r.label}</span><span style={{ color: "#B8B8AE", fontSize: 16 }}>›</span></div>
          ))}
        </div>
        <button onClick={props.logout} style={{ height: 52, borderRadius: 15, background: "#fff", border: `1px solid ${LINE}`, color: "#E5533C", fontSize: 14, fontWeight: 800 }}>Log out</button>
        <div style={{ textAlign: "center", fontSize: 11, color: "#B8B8AE", marginTop: 4 }}>Sixer Arena · v1.0</div>
      </div>
    </div>
  );
}

function Nav(props: { tab: Tab; setTab: (t: Tab) => void }) {
  const items = [{ id: "home", icon: "⚡", label: "Book" }, { id: "bookings", icon: "🎟️", label: "Bookings" }, { id: "profile", icon: "👤", label: "Profile" }] as const;
  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, zIndex: 35, background: "rgba(255,255,255,.92)", backdropFilter: "blur(12px)", borderTop: `1px solid ${LINE}`, padding: "9px 26px 24px", display: "flex", justifyContent: "space-between" }}>
      {items.map((n) => {
        const sel = props.tab === n.id;
        return (
          <button key={n.id} onClick={() => props.setTab(n.id)} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, background: "none", flex: 1 }}>
            <span style={{ fontSize: 19, opacity: sel ? 1 : 0.4, filter: sel ? "none" : "grayscale(1)" }}>{n.icon}</span>
            <span style={{ fontSize: 10.5, fontWeight: 700, color: sel ? INK : "#B8B8AE" }}>{n.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function Toast(props: { msg: string }) {
  return (
    <div style={{ position: "absolute", left: 20, right: 20, top: 56, zIndex: 70, animation: "sxrise .25s ease both" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, background: INK, borderRadius: 14, padding: "13px 16px", boxShadow: "0 16px 30px -12px rgba(0,0,0,.5)" }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: YELLOW }} />
        <span style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>{props.msg}</span>
      </div>
    </div>
  );
}

// ================= small helpers =================

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: "0 22px 10px", fontSize: 12, fontWeight: 800, letterSpacing: 0.4, color: INK, textTransform: "uppercase" }}>{children}</div>;
}
function MiniLabel({ children, style }: { children: React.ReactNode; style?: CSSProperties }) {
  return <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 0.4, color: MUTED, textTransform: "uppercase", marginBottom: 8, ...style }}>{children}</div>;
}
function Legend({ color, label }: { color: string; label: string }) {
  return <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 600, color: "#6C6C61" }}><span style={{ width: 9, height: 9, borderRadius: 3, background: color }} />{label}</div>;
}
function Field({ label, children, last }: { label: string; children: React.ReactNode; last?: boolean }) {
  return <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 0", borderBottom: last ? "none" : "1px solid #F0F0EA" }}><span style={{ fontSize: 12, fontWeight: 700, color: MUTED, width: 64 }}>{label}</span>{children}</div>;
}
function BillRow({ label, value, dashed }: { label: string; value: string; dashed?: boolean }) {
  return <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5, color: MUTED, marginBottom: dashed ? 11 : 9, paddingBottom: dashed ? 11 : 0, borderBottom: dashed ? "1px dashed #E6E6DE" : "none" }}><span>{label}</span><span style={{ fontWeight: 700, color: INK, fontVariantNumeric: "tabular-nums" }}>{value}</span></div>;
}
function DetailRow({ label, value }: { label: string; value: string }) {
  return <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: MUTED, marginBottom: 9 }}><span>{label}</span><span style={{ fontWeight: 700, color: INK }}>{value}</span></div>;
}
const fieldInput: CSSProperties = { flex: 1, border: "none", outline: "none", fontFamily: "Archivo", fontSize: 14.5, fontWeight: 700, color: INK, background: "none" };

function couponReason(reason?: string): string {
  switch (reason) {
    case "invalid": return "That code isn't valid.";
    case "expired": return "That code has expired.";
    case "used_up": return "That code has been fully used.";
    case "min_not_met": return "Add more slots to use this code.";
    default: return "Couldn't apply that code.";
  }
}

function prettyStatus(s: BookingView["status"]) {
  return s === "CONFIRMED" ? "Confirmed" : s === "COMPLETED" ? "Completed" : s === "CANCELLED" ? "Cancelled" : "Pending";
}
function statusChip(s: BookingView["status"]): CSSProperties {
  let bg = "#FFF6C2", c = "#8A7400";
  if (s === "CONFIRMED") { bg = "#E4F7DC"; c = "#2F6B1E"; }
  if (s === "COMPLETED") { bg = "#EEEEE8"; c = "#6C6C61"; }
  if (s === "CANCELLED") { bg = "#FCE9E5"; c = "#E5533C"; }
  return { marginTop: 5, fontSize: 10, fontWeight: 800, letterSpacing: 0.3, padding: "3px 8px", borderRadius: 8, background: bg, color: c, display: "inline-block" };
}
function slotStyle(s: AvailabilitySlot, picked: boolean) {
  let bg = "#fff", border = `1px solid ${LINE}`, color = INK, opacity = 1, bar = YELLOW, badgeText = "Open", badgeBg = "#FFF6C2", badgeColor = "#8A7400";
  if (s.status === "peak") { bar = "#FF5A2C"; badgeText = "Peak"; badgeBg = "#FFE6DD"; badgeColor = "#C63C14"; }
  if (s.status === "full") { bg = "#F1F1EC"; border = "1px solid #E9E9E1"; color = "#A8A89E"; opacity = 0.75; bar = "#DDDDD4"; badgeText = "Full"; badgeBg = "#E9E9E1"; badgeColor = "#A8A89E"; }
  if (s.status === "blocked") { bg = "#F1F1EC"; border = "1px solid #E9E9E1"; color = "#A8A89E"; opacity = 0.75; bar = "#DDDDD4"; badgeText = "Blocked"; badgeBg = "#E9E9E1"; badgeColor = "#A8A89E"; }
  if (picked) { bg = INK; border = `1px solid ${INK}`; color = "#fff"; bar = YELLOW; badgeText = "Picked"; badgeBg = YELLOW; badgeColor = INK; }
  return {
    tile: { position: "relative", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 12px 12px 18px", borderRadius: 13, background: bg, border, color, opacity, overflow: "hidden", minHeight: 62, boxShadow: picked ? "0 10px 20px -10px rgba(20,19,14,.5)" : "none" } as CSSProperties,
    bar: { position: "absolute", left: 0, top: 0, bottom: 0, width: 4, background: bar } as CSSProperties,
    badge: { fontSize: 9.5, fontWeight: 800, letterSpacing: 0.3, textTransform: "uppercase", padding: "3px 7px", borderRadius: 7, background: badgeBg, color: badgeColor } as CSSProperties,
    badgeText,
  };
}

// Desktop: centered phone mockup on the dotted backdrop.
const outer: CSSProperties = { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 20px" };
const frame: CSSProperties = { position: "relative", width: 404, height: 850, background: "#0b0b08", borderRadius: 54, padding: 13, boxShadow: "0 40px 90px -20px rgba(20,19,14,.55),0 0 0 2px #232219,inset 0 0 0 2px #000" };
const notch: CSSProperties = { position: "absolute", top: 22, left: "50%", transform: "translateX(-50%)", width: 118, height: 30, background: "#000", borderRadius: "0 0 18px 18px", zIndex: 60 };
const screenWrap: CSSProperties = { position: "relative", width: "100%", height: "100%", background: APP, borderRadius: 42, overflow: "hidden", display: "flex", flexDirection: "column" };

// Real phone / installed PWA: fill the viewport, no bezel. `100dvh` tracks the
// dynamic viewport so the mobile browser's URL bar doesn't clip the layout.
const outerFull: CSSProperties = { minHeight: "100dvh", background: INK };
const frameFull: CSSProperties = { position: "relative", width: "100%", height: "100dvh", background: INK };
const screenWrapFull: CSSProperties = { position: "relative", width: "100%", height: "100dvh", background: APP, overflow: "hidden", display: "flex", flexDirection: "column" };
