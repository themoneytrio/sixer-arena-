import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { api } from "./api";
import { paiseToMoney, DOW } from "@sixer/shared/format";
import type { VenueConfig, DashboardResponse, AnalyticsResponse, OwnerBookingRow, Coupon, CustomerRow, PaymentsResponse } from "@sixer/shared/types";

const INK = "#14130E", YELLOW = "#FFD400", PANEL = "#201E15", LINE = "#E6E6DE", APP = "#F4F4EE", MUTED = "#6C6C61", ORANGE = "#FF5A2C";

function moneyShort(paise: number): string {
  const r = paise / 100;
  if (r >= 100000) return "₹" + (r / 100000).toFixed(1).replace(/\.0$/, "") + "L";
  if (r >= 1000) return "₹" + (r / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  return "₹" + Math.round(r);
}

type Section = "dashboard" | "bookings" | "calendar" | "analytics" | "customers" | "payments" | "pricing" | "venue";

export function App() {
  const [authed, setAuthed] = useState(api.isAuthed());
  if (!authed) return <Login onDone={() => setAuthed(true)} />;
  return <Console onLogout={() => setAuthed(false)} />;
}

// ================= Login =================
function Login({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [phone, setPhone] = useState("9000000001");
  const [otp, setOtp] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function next() {
    setErr(null);
    if (step === "phone") {
      if (phone.length < 10) return setErr("Enter a 10-digit number");
      setBusy(true);
      try { await api.requestOtp(phone); setStep("otp"); } catch (e: any) { setErr(e.status === 429 ? "Too many tries — wait a bit" : "Couldn't send code"); } finally { setBusy(false); }
    } else {
      if (otp.length < 4) return setErr("Enter the 4-digit code");
      setBusy(true);
      try { await api.verifyOtp(phone, otp); onDone(); } catch (e: any) { setErr(e.status === 403 ? "This number isn't an owner/manager." : "Wrong code, try again"); } finally { setBusy(false); }
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 28 }}>
      <div style={{ width: 400, background: INK, borderRadius: 22, overflow: "hidden", boxShadow: "0 40px 90px -30px rgba(20,19,14,.5)" }}>
        <div style={{ padding: "36px 32px 8px", display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 46, height: 46, borderRadius: 13, background: YELLOW, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Anton", fontSize: 26, color: INK }}>6</div>
          <div><div style={{ fontFamily: "Anton", fontSize: 20, color: "#fff", lineHeight: 1 }}>SIXER ARENA</div><div style={{ fontSize: 10, fontWeight: 600, color: "#8f8d80", letterSpacing: 0.5 }}>OWNER CONSOLE</div></div>
        </div>
        <div style={{ padding: "18px 32px 34px" }}>
          <div style={{ fontFamily: "Anton", fontSize: 26, color: "#fff" }}>{step === "phone" ? "Owner sign in" : "Verify OTP"}</div>
          <div style={{ fontSize: 12.5, color: "#9a988a", marginTop: 6, marginBottom: 20 }}>{step === "phone" ? "Phone + OTP. Seeded owner: 9000000001" : `Sent to +91 ${phone} · any 4 digits`}</div>
          {step === "phone" ? (
            <div style={{ display: "flex", alignItems: "center", gap: 10, background: PANEL, border: "1.5px solid #34321f", borderRadius: 13, padding: "0 14px", height: 54 }}>
              <span style={{ fontSize: 15, fontWeight: 800, color: "#fff" }}>+91</span>
              <div style={{ width: 1, height: 24, background: "#3a3826" }} />
              <input autoFocus value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))} onKeyDown={(e) => e.key === "Enter" && next()} inputMode="numeric" style={{ flex: 1, background: "none", border: "none", outline: "none", fontSize: 16, fontWeight: 700, letterSpacing: 1, color: "#fff" }} />
            </div>
          ) : (
            <input autoFocus value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 4))} onKeyDown={(e) => e.key === "Enter" && next()} inputMode="numeric" placeholder="1234" style={{ width: "100%", background: PANEL, border: "1.5px solid #34321f", borderRadius: 13, padding: "0 14px", height: 54, fontFamily: "Anton", fontSize: 22, letterSpacing: 8, color: "#fff", outline: "none", textAlign: "center" }} />
          )}
          {err && <div style={{ marginTop: 10, fontSize: 12, fontWeight: 700, color: "#ff9b86" }}>{err}</div>}
          <button onClick={next} disabled={busy} style={{ width: "100%", height: 52, marginTop: 18, borderRadius: 13, background: YELLOW, color: INK, fontSize: 15, fontWeight: 900, opacity: busy ? 0.7 : 1 }}>{busy ? "…" : step === "phone" ? "Send OTP" : "Enter console"}</button>
        </div>
      </div>
    </div>
  );
}

// ================= Console =================
function Console({ onLogout }: { onLogout: () => void }) {
  const [section, setSection] = useState<Section>("dashboard");
  const [config, setConfig] = useState<VenueConfig | null>(null);
  const [walkinOpen, setWalkinOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const bump = () => setReloadKey((k) => k + 1);

  const [todayIso, setTodayIso] = useState<string>("");

  function flash(m: string) { setToast(m); setTimeout(() => setToast(null), 2400); }

  async function loadConfig() { try { setConfig(await api.config()); } catch { /* ignore */ } }
  useEffect(() => { loadConfig(); }, [reloadKey]);
  useEffect(() => { api.dates().then((d) => setTodayIso(d[0])).catch(() => {}); }, []);

  const nav: { id: Section; icon: string; label: string }[] = [
    { id: "dashboard", icon: "▤", label: "Dashboard" },
    { id: "bookings", icon: "🎟", label: "Bookings" },
    { id: "calendar", icon: "🗓", label: "Slot calendar" },
    { id: "analytics", icon: "📈", label: "Analytics" },
    { id: "customers", icon: "👥", label: "Customers" },
    { id: "payments", icon: "₹", label: "Payments" },
    { id: "pricing", icon: "🏷", label: "Pricing" },
    { id: "venue", icon: "⚙", label: "Venue setup" },
  ];
  const titles: Record<Section, { t: string; s: string }> = {
    dashboard: { t: "Dashboard", s: "How's business right now" },
    bookings: { t: "Bookings", s: "Every booking, online and walk-in" },
    calendar: { t: "Slot calendar", s: "Block, unblock and inspect any day" },
    analytics: { t: "Revenue & analytics", s: "Occupancy, peaks and splits" },
    customers: { t: "Customers", s: "Everyone who's booked — tag your regulars" },
    payments: { t: "Payments & payouts", s: "What came in, what's due, what went back" },
    pricing: { t: "Pricing", s: "Deposit, fees and coupons" },
    venue: { t: "Venue setup", s: "Sports and turfs — flows to the customer app" },
  };
  // Use the venue-tz "today" (from the API) so the topbar matches the data.
  const today = todayIso ? new Date(todayIso + "T00:00:00") : new Date();
  const dateLabel = `${DOW[today.getDay()]} · ${today.getDate()} ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][today.getMonth()]} ${today.getFullYear()}`;

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 28, overflow: "auto" }}>
      <div style={{ position: "relative", width: 1340, height: 846, flex: "none", background: APP, borderRadius: 22, overflow: "hidden", display: "flex", boxShadow: "0 40px 90px -30px rgba(20,19,14,.5),0 0 0 1px rgba(20,19,14,.06)" }}>
        {/* Sidebar */}
        <div style={{ width: 236, flex: "none", background: INK, display: "flex", flexDirection: "column", padding: "22px 16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "4px 8px 22px" }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: YELLOW, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Anton", fontSize: 24, color: INK }}>6</div>
            <div><div style={{ fontFamily: "Anton", fontSize: 17, color: "#fff", lineHeight: 1 }}>SIXER ARENA</div><div style={{ fontSize: 10, fontWeight: 600, color: "#8f8d80", letterSpacing: 0.5 }}>OWNER CONSOLE</div></div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
            {nav.map((n) => {
              const sel = section === n.id;
              return (
                <button key={n.id} onClick={() => setSection(n.id)} style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 12px", borderRadius: 11, fontSize: 13.5, fontWeight: 700, textAlign: "left", color: sel ? INK : "#c9c7ba", background: sel ? YELLOW : "transparent" }}>
                  <span style={{ fontSize: 16, width: 22, textAlign: "center" }}>{n.icon}</span><span>{n.label}</span>
                </button>
              );
            })}
          </div>
          <div style={{ marginTop: "auto", background: PANEL, border: "1px solid #2c2a1c", borderRadius: 14, padding: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#8f8d80", letterSpacing: 0.4, textTransform: "uppercase" }}>Signed in</div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
              <div style={{ width: 34, height: 34, borderRadius: 10, background: YELLOW, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Anton", fontSize: 17, color: INK }}>A</div>
              <div style={{ flex: 1 }}><div style={{ fontSize: 13, fontWeight: 800, color: "#fff", lineHeight: 1.1 }}>Owner</div><div style={{ fontSize: 10.5, color: "#8f8d80" }}>{config?.locality ?? "Kalyanpur"}</div></div>
              <button onClick={() => { api.logout(); onLogout(); }} title="Log out" style={{ color: "#8f8d80", fontSize: 16 }}>⎋</button>
            </div>
          </div>
        </div>

        {/* Main */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          <div style={{ height: 66, flex: "none", background: "#fff", borderBottom: `1px solid ${LINE}`, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 26px" }}>
            <div>
              <div style={{ fontFamily: "Anton", fontSize: 22, color: INK, lineHeight: 1 }}>{titles[section].t}</div>
              <div style={{ fontSize: 11.5, color: MUTED, marginTop: 1 }}>{titles[section].s}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, background: APP, border: `1px solid ${LINE}`, borderRadius: 11, padding: "8px 13px", fontSize: 12.5, fontWeight: 700, color: INK }}>◉ {dateLabel}</div>
              <button onClick={() => setWalkinOpen(true)} style={{ display: "flex", alignItems: "center", gap: 7, background: YELLOW, color: INK, fontSize: 13, fontWeight: 800, padding: "10px 16px", borderRadius: 11 }}>+ Add walk-in</button>
            </div>
          </div>

          <div className="ov" style={{ flex: 1, overflowY: "auto", padding: "22px 26px 30px" }}>
            {section === "dashboard" && <Dashboard key={reloadKey} openWalkin={() => setWalkinOpen(true)} goCalendar={() => setSection("calendar")} goAnalytics={() => setSection("analytics")} flash={flash} />}
            {section === "bookings" && <Bookings key={reloadKey} flash={flash} />}
            {section === "calendar" && <Calendar key={reloadKey} flash={flash} />}
            {section === "analytics" && <Analytics key={reloadKey} />}
            {section === "customers" && <Customers key={reloadKey} flash={flash} />}
            {section === "payments" && <Payments key={reloadKey} flash={flash} />}
            {section === "pricing" && config && <Pricing key={reloadKey} config={config} reload={() => bump()} flash={flash} />}
            {section === "venue" && config && <Venue config={config} reload={() => { bump(); }} flash={flash} />}
          </div>
        </div>

        {walkinOpen && config && (
          <Walkin config={config} onClose={() => setWalkinOpen(false)} onDone={(msg) => { setWalkinOpen(false); flash(msg); bump(); }} />
        )}
        {toast && (
          <div style={{ position: "absolute", left: "50%", transform: "translateX(-50%)", bottom: 24, zIndex: 80, animation: "ovrise .25s ease both" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, background: INK, borderRadius: 13, padding: "12px 18px", boxShadow: "0 16px 30px -12px rgba(0,0,0,.5)" }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: YELLOW }} />
              <span style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>{toast}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ================= Dashboard =================
function Dashboard({ openWalkin, goCalendar, goAnalytics, flash }: { openWalkin: () => void; goCalendar: () => void; goAnalytics: () => void; flash: (m: string) => void }) {
  const [d, setD] = useState<DashboardResponse | null>(null);
  async function load() { try { setD(await api.dashboard()); } catch { /* ignore */ } }
  useEffect(() => { load(); }, []);
  if (!d) return <Skeleton />;

  const maxRev = Math.max(1, ...d.last7Days.map((x) => x.revenuePaise));
  const weekTotal = d.last7Days.reduce((a, x) => a + x.revenuePaise, 0);
  const board = [
    { label: "This month", value: moneyShort(d.revenueMonthPaise), color: YELLOW },
    { label: "Occupancy", value: d.occupancyPct + "%", color: ORANGE },
    { label: "Bookings today", value: String(d.bookingsToday), color: "#fff" },
    { label: "Peak hour", value: d.peakHourLabel.replace(/ – .*/, ""), color: "#fff" },
  ];

  async function toggleBlock(turfId: string, hour: number, status: string, date: string) {
    try {
      if (status === "open") await api.block(turfId, date, hour);
      else if (status === "blocked") await api.unblock(turfId, date, hour);
      else return; // booked cells are protected
      await load();
      flash(status === "open" ? "Slot blocked" : "Slot unblocked");
    } catch { flash("Couldn't update slot"); }
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: 18 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 18, minWidth: 0 }}>
        {/* revenue board */}
        <div style={{ background: "linear-gradient(150deg,#201E14,#14130E)", borderRadius: 20, padding: "22px 24px", color: "#fff" }}>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: YELLOW, textTransform: "uppercase" }}>Revenue · Today</div>
              <div style={{ fontFamily: "Anton", fontSize: 56, lineHeight: 0.95, marginTop: 6, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{paiseToMoney(d.revenueTodayPaise)}</div>
            </div>
            {d.revenueDeltaPct !== 0 && (
              <div style={{ display: "inline-flex", alignItems: "center", gap: 6, flex: "none", marginBottom: 8, background: d.revenueDeltaPct >= 0 ? "#1e3b18" : "#3b1e18", border: `1px solid ${d.revenueDeltaPct >= 0 ? "#2e5a24" : "#5a2e24"}`, borderRadius: 9, padding: "5px 11px", fontSize: 12, fontWeight: 700, color: d.revenueDeltaPct >= 0 ? "#8fe07a" : "#e07a7a", whiteSpace: "nowrap" }}>{d.revenueDeltaPct >= 0 ? "▲" : "▼"} {Math.abs(d.revenueDeltaPct)}% vs last wk</div>
            )}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 11, marginTop: 18 }}>
            {board.map((b) => (
              <div key={b.label} style={{ background: PANEL, border: "1px solid #2c2a1c", borderRadius: 13, padding: "12px 13px" }}>
                <div style={{ fontSize: 10.5, fontWeight: 600, color: "#8f8d80" }}>{b.label}</div>
                <div style={{ fontFamily: "Anton", fontSize: 23, marginTop: 4, fontVariantNumeric: "tabular-nums", color: b.color }}>{b.value}</div>
              </div>
            ))}
          </div>
        </div>

        {/* chart */}
        <div style={{ background: "#fff", border: `1px solid ${LINE}`, borderRadius: 20, padding: "20px 22px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: INK }}>Last 7 days</div>
            <div style={{ fontSize: 12, color: MUTED }}>Total <b style={{ color: INK }}>{paiseToMoney(weekTotal)}</b></div>
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 14, height: 150 }}>
            {d.last7Days.map((c) => (
              <div key={c.date} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 8, height: "100%", justifyContent: "flex-end" }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: INK, fontVariantNumeric: "tabular-nums" }}>{moneyShort(c.revenuePaise)}</div>
                <div style={{ width: "100%", height: `${Math.max(4, (c.revenuePaise / maxRev) * 110)}px`, borderRadius: "7px 7px 3px 3px", background: c.isToday ? ORANGE : "#EDEDE4", transformOrigin: "bottom", animation: "ovgrow .5s ease both" }} />
                <div style={{ fontSize: 10.5, fontWeight: 700, color: c.isToday ? INK : "#9a988a" }}>{DOW[new Date(c.date + "T00:00:00").getDay()]}</div>
              </div>
            ))}
          </div>
        </div>

        {/* slot control */}
        <div style={{ background: "#fff", border: `1px solid ${LINE}`, borderRadius: 20, padding: "20px 22px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: INK }}>Slot control · Today</div>
            <div style={{ display: "flex", gap: 13, fontSize: 11, fontWeight: 600, color: MUTED }}>
              <Key c="#EEEEE8" b label="Open" /><Key c={INK} label="Booked" /><Key c={ORANGE} label="Blocked" />
            </div>
          </div>
          <div style={{ fontSize: 11, color: "#9a988a", marginBottom: 12 }}>Tap an open slot to block it for rain / maintenance.</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            {d.slotControl.map((row) => (
              <div key={row.turfId} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 84, flex: "none", fontSize: 12, fontWeight: 800, color: INK, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{row.turfName}</div>
                <div className="ov" style={{ display: "flex", gap: 6, flex: 1, overflowX: "auto" }}>
                  {row.slots.map((c) => {
                    const bg = c.status === "booked" ? INK : c.status === "blocked" ? ORANGE : "#EEEEE8";
                    const color = c.status === "open" ? "#9a988a" : "#fff";
                    return (
                      <button key={c.hour} onClick={() => toggleBlock(row.turfId, c.hour, c.status, d.date)} title={c.label} style={{ flex: "0 0 auto", minWidth: 34, height: 34, borderRadius: 9, background: bg, color, fontSize: 10.5, fontWeight: 700, border: c.status === "open" ? "1px solid #E0E0D8" : "none" }}>{c.hour > 12 ? c.hour - 12 : c.hour}{c.hour >= 12 ? "p" : "a"}</button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* right column */}
      <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
        <div style={{ background: "#fff", border: `1px solid ${LINE}`, borderRadius: 20, padding: "18px 18px 14px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: INK }}>Today's bookings</div>
            <span style={{ fontSize: 11, fontWeight: 800, color: INK, background: YELLOW, padding: "3px 9px", borderRadius: 8 }}>{d.todaysBookings.length}</span>
          </div>
          <div style={{ fontSize: 11, color: "#9a988a", marginBottom: 10 }}>Live · new online bookings appear here</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 9, maxHeight: 320, overflowY: "auto" }} className="ov">
            {d.todaysBookings.map((t) => (
              <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 11, padding: "10px 11px", border: "1px solid #EEEEE8", borderRadius: 13, background: t.source === "WALKIN" ? "#FFFDF0" : "#fff" }}>
                <div style={{ width: 36, height: 36, flex: "none", borderRadius: 10, background: APP, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>{t.sportIcon}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: INK, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.customerName}</div>
                  <div style={{ fontSize: 11, color: MUTED }}>{t.title} · {t.source === "WALKIN" ? "Walk-in" : "Online"}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: INK, fontVariantNumeric: "tabular-nums" }}>{paiseToMoney(t.totalPaise)}</div>
                  <div style={dueChip(t.amountDuePaise > 0)}>{t.amountDuePaise > 0 ? "Due" : "Paid"}</div>
                </div>
              </div>
            ))}
            {d.todaysBookings.length === 0 && <div style={{ padding: 24, textAlign: "center", color: "#9a988a", fontSize: 12.5 }}>No bookings yet today.</div>}
          </div>
        </div>
        <div style={{ background: "#fff", border: `1px solid ${LINE}`, borderRadius: 20, padding: "16px 18px" }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: INK, marginBottom: 11 }}>Quick actions</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            <button onClick={openWalkin} style={{ display: "flex", alignItems: "center", gap: 10, background: INK, color: "#fff", borderRadius: 12, padding: "12px 14px", fontSize: 13, fontWeight: 700, textAlign: "left" }}>➕ Add walk-in booking</button>
            <button onClick={goCalendar} style={{ display: "flex", alignItems: "center", gap: 10, background: APP, border: `1px solid ${LINE}`, color: INK, borderRadius: 12, padding: "12px 14px", fontSize: 13, fontWeight: 700, textAlign: "left" }}>🗓️ Open slot calendar</button>
            <button onClick={goAnalytics} style={{ display: "flex", alignItems: "center", gap: 10, background: APP, border: `1px solid ${LINE}`, color: INK, borderRadius: 12, padding: "12px 14px", fontSize: 13, fontWeight: 700, textAlign: "left" }}>📈 View analytics</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ================= Bookings =================
function Bookings({ flash }: { flash: (m: string) => void }) {
  const [rows, setRows] = useState<OwnerBookingRow[]>([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "online" | "walkin" | "due">("all");
  async function load() {
    const q: any = {};
    if (search) q.search = search;
    if (filter === "online" || filter === "walkin") q.source = filter;
    if (filter === "due") q.due = "1";
    try { setRows(await api.bookings(q)); } catch { setRows([]); }
  }
  useEffect(() => { const t = setTimeout(load, 180); return () => clearTimeout(t); /* eslint-disable-next-line */ }, [search, filter]);

  const chips = [{ id: "all", label: "All" }, { id: "online", label: "Online" }, { id: "walkin", label: "Walk-in" }, { id: "due", label: "Due" }] as const;
  async function markPaid(id: string) { try { await api.markPaid(id); flash("Marked paid"); load(); } catch { flash("Couldn't update"); } }

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#fff", border: `1px solid ${LINE}`, borderRadius: 11, padding: "9px 13px", flex: 1, maxWidth: 320 }}>
          <span style={{ color: "#9a988a" }}>⌕</span>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or phone" style={{ border: "none", outline: "none", background: "none", fontSize: 13, fontWeight: 600, color: INK, flex: 1 }} />
        </div>
        {chips.map((f) => {
          const sel = filter === f.id;
          return <button key={f.id} onClick={() => setFilter(f.id)} style={{ padding: "9px 15px", borderRadius: 11, fontSize: 12.5, fontWeight: 700, background: sel ? INK : "#fff", color: sel ? "#fff" : INK, border: sel ? `1px solid ${INK}` : `1px solid ${LINE}` }}>{f.label}</button>;
        })}
      </div>
      <div style={{ background: "#fff", border: `1px solid ${LINE}`, borderRadius: 18, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1.4fr 1fr .9fr 1fr", gap: 12, padding: "13px 20px", background: "#FAFAF6", borderBottom: `1px solid ${LINE}`, fontSize: 10.5, fontWeight: 800, letterSpacing: 0.4, color: "#9a988a", textTransform: "uppercase" }}>
          <div>Customer</div><div>Sport · Time</div><div>Amount</div><div>Status</div><div>Action</div>
        </div>
        {rows.map((b) => (
          <div key={b.id} style={{ display: "grid", gridTemplateColumns: "1.5fr 1.4fr 1fr .9fr 1fr", gap: 12, padding: "14px 20px", borderBottom: "1px solid #F0F0EA", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 11, minWidth: 0 }}>
              <div style={{ width: 34, height: 34, flex: "none", borderRadius: 10, background: INK, color: YELLOW, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Anton", fontSize: 15 }}>{b.customerName.charAt(0).toUpperCase()}</div>
              <div style={{ minWidth: 0 }}><div style={{ fontSize: 13, fontWeight: 800, color: INK, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{b.customerName}</div><div style={{ fontSize: 10.5, fontWeight: 700, color: b.source === "WALKIN" ? "#C25A16" : "#2F6B1E" }}>{b.source === "WALKIN" ? "Walk-in" : "Online"}</div></div>
            </div>
            <div style={{ fontSize: 12.5, color: INK }}><b>{b.title}</b><div style={{ fontSize: 11, color: MUTED }}>{b.date}</div></div>
            <div style={{ fontSize: 13, fontWeight: 800, color: INK, fontVariantNumeric: "tabular-nums" }}>{paiseToMoney(b.totalPaise)}</div>
            <div><span style={statusChip(b.status, b.amountDuePaise)}>{b.amountDuePaise > 0 ? "Due" : b.status === "CANCELLED" ? "Cancelled" : "Paid"}</span></div>
            <div>{b.amountDuePaise > 0 && b.status !== "CANCELLED" ? <button onClick={() => markPaid(b.id)} style={{ padding: "7px 12px", borderRadius: 9, background: YELLOW, color: INK, fontSize: 12, fontWeight: 800 }}>Mark paid</button> : <span style={{ color: "#B8B8AE", fontSize: 12 }}>—</span>}</div>
          </div>
        ))}
        {rows.length === 0 && <div style={{ padding: 44, textAlign: "center", color: "#9a988a", fontSize: 13 }}>No bookings for this filter.</div>}
      </div>
    </>
  );
}

// ================= Calendar =================
function Calendar({ flash }: { flash: (m: string) => void }) {
  const [dates, setDates] = useState<string[]>([]);
  const [idx, setIdx] = useState(0);
  const [cal, setCal] = useState<Awaited<ReturnType<typeof api.calendar>> | null>(null);
  useEffect(() => { api.dates().then(setDates).catch(() => setDates([])); }, []);
  async function load(date: string) { try { setCal(await api.calendar(date)); } catch { setCal(null); } }
  useEffect(() => { if (dates[idx]) load(dates[idx]); }, [dates, idx]);

  const hours = Array.from({ length: 18 }, (_, i) => 6 + i);
  async function toggle(turfId: string, hour: number, status: string) {
    const date = dates[idx];
    try {
      if (status === "open") await api.block(turfId, date, hour);
      else if (status === "blocked") await api.unblock(turfId, date, hour);
      else return;
      await load(date);
      flash(status === "open" ? "Slot blocked" : "Slot unblocked");
    } catch { flash("Couldn't update"); }
  }
  const cols = cal ? `70px repeat(${cal.turfs.length}, 1fr)` : "70px 1fr";

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 7 }}>
          {dates.map((iso, i) => {
            const dd = new Date(iso + "T00:00:00");
            const sel = i === idx;
            return (
              <button key={iso} onClick={() => setIdx(i)} style={{ width: 52, padding: "8px 0", borderRadius: 12, textAlign: "center", background: sel ? INK : "#fff", color: sel ? "#fff" : INK, border: sel ? `1px solid ${INK}` : `1px solid ${LINE}` }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: sel ? YELLOW : MUTED }}>{i === 0 ? "Today" : DOW[dd.getDay()]}</div>
                <div style={{ fontFamily: "Anton", fontSize: 18, lineHeight: 1, marginTop: 2 }}>{dd.getDate()}</div>
              </button>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 13, fontSize: 11, fontWeight: 600, color: MUTED }}>
          <Key c="#EEEEE8" b label="Open" /><Key c={INK} label="Booked" /><Key c={ORANGE} label="Blocked" />
        </div>
      </div>
      <div style={{ background: "#fff", border: `1px solid ${LINE}`, borderRadius: 18, padding: "18px 20px" }}>
        <div style={{ display: "grid", gridTemplateColumns: cols, gap: 8, marginBottom: 8 }}>
          <div />
          {cal?.turfs.map((t) => <div key={t.turfId} style={{ textAlign: "center", fontSize: 12, fontWeight: 800, color: INK }}>{t.turfName}</div>)}
        </div>
        <div className="ov" style={{ maxHeight: 560, overflowY: "auto", display: "flex", flexDirection: "column", gap: 7 }}>
          {hours.map((h) => (
            <div key={h} style={{ display: "grid", gridTemplateColumns: cols, gap: 8 }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: MUTED, display: "flex", alignItems: "center" }}>{h > 12 ? h - 12 : h}{h >= 12 ? " PM" : " AM"}</div>
              {cal?.turfs.map((t) => {
                const cell = t.cells.find((c) => c.hour === h)!;
                const booked = cell.status === "booked", blocked = cell.status === "blocked";
                const bg = booked ? INK : blocked ? "#FFEDE7" : "#FAFAF6";
                const color = booked ? "#fff" : blocked ? ORANGE : "#9a988a";
                return (
                  <button key={t.turfId} onClick={() => toggle(t.turfId, h, cell.status)} style={{ height: 40, borderRadius: 10, background: bg, color, fontSize: 11.5, fontWeight: 700, border: booked ? "none" : blocked ? `1px solid #F4C9BF` : `1px solid #EEEEE8` }}>
                    {booked ? cell.customer ?? "Booked" : blocked ? "Blocked" : "Open"}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// ================= Analytics =================
function Analytics() {
  const [range, setRange] = useState<"day" | "week" | "month">("week");
  const [a, setA] = useState<AnalyticsResponse | null>(null);
  useEffect(() => { api.analytics(range).then(setA).catch(() => setA(null)); }, [range]);
  if (!a) return <Skeleton />;

  const heatHours = Array.from({ length: 18 }, (_, i) => 6 + i);
  const ramp = ["#EEEEE8", "#FFF1A8", "#FFD400", "#FF9E2C", "#FF5A2C"];
  const heatColor = (o: number) => (o <= 0 ? ramp[0] : o < 0.25 ? ramp[1] : o < 0.5 ? ramp[2] : o < 0.75 ? ramp[3] : ramp[4]);
  const maxSport = Math.max(1, ...a.bySport.map((s) => s.revenuePaise));
  const stats = [
    { label: "Revenue", value: moneyShort(a.revenuePaise) },
    { label: "Bookings", value: String(a.bookings) },
    { label: "Avg booking", value: moneyShort(a.avgBookingValuePaise) },
    { label: "Online share", value: a.onlinePct + "%" },
  ];

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
        <div style={{ display: "flex", gap: 6, background: "#fff", border: `1px solid ${LINE}`, borderRadius: 12, padding: 4 }}>
          {(["day", "week", "month"] as const).map((r) => (
            <button key={r} onClick={() => setRange(r)} style={{ padding: "8px 16px", borderRadius: 9, fontSize: 12.5, fontWeight: 700, textTransform: "capitalize", background: range === r ? INK : "transparent", color: range === r ? "#fff" : MUTED }}>{r}</button>
          ))}
        </div>
        <button style={{ display: "flex", alignItems: "center", gap: 7, background: INK, color: "#fff", fontSize: 12.5, fontWeight: 700, padding: "9px 15px", borderRadius: 11 }}>⬇ Export report</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, marginBottom: 16 }}>
        {stats.map((s) => (
          <div key={s.label} style={{ background: "#fff", border: `1px solid ${LINE}`, borderRadius: 16, padding: "16px 17px" }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: MUTED }}>{s.label}</div>
            <div style={{ fontFamily: "Anton", fontSize: 28, color: INK, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>{s.value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: 16 }}>
        <div style={{ background: "#fff", border: `1px solid ${LINE}`, borderRadius: 18, padding: "20px 22px" }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: INK }}>Occupancy heatmap</div>
          <div style={{ fontSize: 11.5, color: "#9a988a", margin: "2px 0 16px" }}>Darker = busier. Spot dead hours worth discounting.</div>
          <div style={{ display: "flex", gap: 4, marginBottom: 6, paddingLeft: 42 }}>
            {heatHours.map((h) => <div key={h} style={{ flex: 1, textAlign: "center", fontSize: 8.5, fontWeight: 700, color: "#9a988a" }}>{h > 12 ? h - 12 : h}</div>)}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {a.heatmap.map((row) => (
              <div key={row.day} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ width: 36, flex: "none", fontSize: 10.5, fontWeight: 800, color: MUTED }}>{row.day}</div>
                {row.hours.map((c) => <div key={c.hour} style={{ flex: 1, height: 20, borderRadius: 3, background: heatColor(c.occupancy) }} title={`${row.day} ${c.hour}:00 · ${Math.round(c.occupancy * 100)}%`} />)}
              </div>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 16, fontSize: 10.5, fontWeight: 600, color: MUTED }}>Less
            <div style={{ display: "flex", gap: 3 }}>{ramp.map((c) => <span key={c} style={{ width: 16, height: 12, borderRadius: 3, background: c }} />)}</div>More
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ background: "#fff", border: `1px solid ${LINE}`, borderRadius: 18, padding: "18px 20px" }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: INK, marginBottom: 14 }}>Revenue by sport</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
              {a.bySport.map((s) => (
                <div key={s.sportId}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 5 }}><span style={{ fontWeight: 700, color: INK }}>{s.icon} {s.name}</span><span style={{ fontWeight: 800, color: INK, fontVariantNumeric: "tabular-nums" }}>{moneyShort(s.revenuePaise)}</span></div>
                  <div style={{ height: 9, borderRadius: 6, background: "#F0F0EA", overflow: "hidden" }}><div style={{ width: `${(s.revenuePaise / maxSport) * 100}%`, height: "100%", background: YELLOW }} /></div>
                </div>
              ))}
            </div>
          </div>
          <div style={{ background: "linear-gradient(150deg,#201E14,#14130E)", borderRadius: 18, padding: "18px 20px", color: "#fff" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: YELLOW, textTransform: "uppercase", letterSpacing: 0.5 }}>Online vs walk-in</div>
            <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
              <div style={{ flex: 1 }}><div style={{ fontFamily: "Anton", fontSize: 30, color: YELLOW }}>{a.onlinePct}%</div><div style={{ fontSize: 11, color: "#8f8d80" }}>Online · app</div></div>
              <div style={{ flex: 1 }}><div style={{ fontFamily: "Anton", fontSize: 30, color: "#fff" }}>{a.walkinPct}%</div><div style={{ fontSize: 11, color: "#8f8d80" }}>Walk-in · counter</div></div>
            </div>
            <div style={{ height: 9, borderRadius: 6, background: "#2c2a1c", overflow: "hidden", marginTop: 14, display: "flex" }}><div style={{ width: `${a.onlinePct}%`, background: YELLOW }} /></div>
          </div>
        </div>
      </div>
    </>
  );
}

// ================= Payments & payouts =================
function Payments({ flash }: { flash: (m: string) => void }) {
  const [data, setData] = useState<PaymentsResponse | null>(null);
  async function load() { try { setData(await api.payments()); } catch { setData(null); } }
  useEffect(() => { load(); }, []);
  if (!data) return <Skeleton />;

  const s = data.summary;
  const cards = [
    { label: "Collected online", value: paiseToMoney(s.onlineCollectedPaise), color: YELLOW, dark: true },
    { label: "Collected in cash", value: paiseToMoney(s.cashCollectedPaise), color: INK, dark: false },
    { label: "Pending dues", value: paiseToMoney(s.pendingDuesPaise), color: "#C25A16", dark: false },
    { label: "Refunded", value: paiseToMoney(s.refundedPaise), color: "#E5533C", dark: false },
  ];
  async function markPaid(bookingId: string, name: string) {
    try { await api.markPaid(bookingId); flash(`${name} marked paid`); load(); } catch { flash("Couldn't update"); }
  }
  const txChip = (st: string): CSSProperties => {
    let bg = "#EEEEE8", c = "#6C6C61";
    if (st === "PAID") { bg = "#E4F7DC"; c = "#3B7A22"; }
    if (st === "FAILED") { bg = "#FCE9E5"; c = "#E5533C"; }
    if (st === "REFUNDED") { bg = "#FFEEDF"; c = "#C25A16"; }
    return { fontSize: 10, fontWeight: 800, padding: "3px 8px", borderRadius: 7, background: bg, color: c, display: "inline-block", letterSpacing: 0.3 };
  };

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, marginBottom: 16 }}>
        {cards.map((c) => (
          <div key={c.label} style={{ background: c.dark ? `linear-gradient(150deg,#201E14,#14130E)` : "#fff", border: c.dark ? "none" : `1px solid ${LINE}`, borderRadius: 16, padding: "16px 17px" }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: c.dark ? "#8f8d80" : MUTED }}>{c.label}</div>
            <div style={{ fontFamily: "Anton", fontSize: 28, marginTop: 4, fontVariantNumeric: "tabular-nums", color: c.dark ? YELLOW : c.color }}>{c.value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: 16, alignItems: "start" }}>
        {/* transactions */}
        <div style={{ background: "#fff", border: `1px solid ${LINE}`, borderRadius: 18, overflow: "hidden" }}>
          <div style={{ padding: "16px 20px 0" }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: INK }}>Transactions</div>
            <div style={{ fontSize: 11.5, color: "#9a988a", margin: "2px 0 12px" }}>Every online payment through the gateway.</div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr .9fr .8fr .9fr", gap: 12, padding: "11px 20px", background: "#FAFAF6", borderTop: `1px solid ${LINE}`, borderBottom: `1px solid ${LINE}`, fontSize: 10.5, fontWeight: 800, letterSpacing: 0.4, color: "#9a988a", textTransform: "uppercase" }}>
            <div>Customer</div><div>Booking</div><div>Amount</div><div>Status</div><div>When</div>
          </div>
          <div className="ov" style={{ maxHeight: 480, overflowY: "auto" }}>
            {data.transactions.map((t) => (
              <div key={t.id} style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr .9fr .8fr .9fr", gap: 12, padding: "12px 20px", borderBottom: "1px solid #F0F0EA", alignItems: "center" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: INK, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.customerName}</div>
                  <div style={{ fontSize: 10.5, color: "#9a988a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.orderId}</div>
                </div>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: INK }}>#{t.bookingCode}</div>
                <div style={{ fontSize: 13, fontWeight: 800, color: INK, fontVariantNumeric: "tabular-nums" }}>{paiseToMoney(t.amountPaise)}</div>
                <div><span style={txChip(t.status)}>{t.status}</span></div>
                <div style={{ fontSize: 11.5, fontWeight: 600, color: MUTED }}>{t.createdAt.slice(0, 10)}</div>
              </div>
            ))}
            {data.transactions.length === 0 && <div style={{ padding: 36, textAlign: "center", color: "#9a988a", fontSize: 13 }}>No transactions yet.</div>}
          </div>
        </div>

        {/* dues */}
        <div style={{ background: "#fff", border: `1px solid ${LINE}`, borderRadius: 18, padding: "18px 18px 14px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: INK }}>Pending dues</div>
            <span style={{ fontSize: 11, fontWeight: 800, color: "#C25A16", background: "#FFEEDF", padding: "3px 9px", borderRadius: 8 }}>{data.dues.length}</span>
          </div>
          <div style={{ fontSize: 11, color: "#9a988a", marginBottom: 12 }}>Deposit balances + pay-later walk-ins. Collect at the ground.</div>
          <div className="ov" style={{ display: "flex", flexDirection: "column", gap: 9, maxHeight: 460, overflowY: "auto" }}>
            {data.dues.map((d) => (
              <div key={d.bookingId} style={{ display: "flex", alignItems: "center", gap: 10, border: "1px solid #EEEEE8", borderRadius: 13, padding: "10px 12px", background: "#FFFDF7" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: INK, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{d.customerName}</div>
                  <div style={{ fontSize: 10.5, color: MUTED }}>#{d.code} · {d.source === "WALKIN" ? "Walk-in" : "Online"} · of {paiseToMoney(d.totalPaise)}</div>
                </div>
                <div style={{ fontSize: 13.5, fontWeight: 800, color: "#C25A16", fontVariantNumeric: "tabular-nums" }}>{paiseToMoney(d.duePaise)}</div>
                <button onClick={() => markPaid(d.bookingId, d.customerName)} style={{ padding: "7px 11px", borderRadius: 9, background: YELLOW, color: INK, fontSize: 11.5, fontWeight: 800 }}>Mark paid</button>
              </div>
            ))}
            {data.dues.length === 0 && <div style={{ padding: 24, textAlign: "center", color: "#9a988a", fontSize: 12.5 }}>Nothing due — all settled. 🎉</div>}
          </div>
        </div>
      </div>
    </>
  );
}

// ================= Customers =================
function Customers({ flash }: { flash: (m: string) => void }) {
  const [rows, setRows] = useState<CustomerRow[]>([]);
  const [search, setSearch] = useState("");
  async function load() { try { setRows(await api.customers(search || undefined)); } catch { setRows([]); } }
  useEffect(() => { const t = setTimeout(load, 180); return () => clearTimeout(t); /* eslint-disable-next-line */ }, [search]);

  async function toggleTag(c: CustomerRow) {
    try {
      await api.tagCustomer(c.phone, !c.regular);
      setRows((rs) => rs.map((r) => (r.phone === c.phone ? { ...r, regular: !c.regular } : r)));
      flash(!c.regular ? `${c.name} tagged as regular ⭐` : `${c.name} untagged`);
    } catch { flash("Couldn't update tag"); }
  }
  const regulars = rows.filter((r) => r.regular).length;

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#fff", border: `1px solid ${LINE}`, borderRadius: 11, padding: "9px 13px", flex: 1, maxWidth: 320 }}>
          <span style={{ color: "#9a988a" }}>⌕</span>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or phone" style={{ border: "none", outline: "none", background: "none", fontSize: 13, fontWeight: 600, color: INK, flex: 1 }} />
        </div>
        <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: MUTED, background: "#fff", border: `1px solid ${LINE}`, borderRadius: 10, padding: "8px 13px" }}>{rows.length} customers</span>
          <span style={{ fontSize: 12, fontWeight: 800, color: INK, background: YELLOW, borderRadius: 10, padding: "8px 13px" }}>⭐ {regulars} regular{regulars === 1 ? "" : "s"}</span>
        </div>
      </div>
      <div style={{ background: "#fff", border: `1px solid ${LINE}`, borderRadius: 18, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr 1fr .9fr 1fr .9fr", gap: 12, padding: "13px 20px", background: "#FAFAF6", borderBottom: `1px solid ${LINE}`, fontSize: 10.5, fontWeight: 800, letterSpacing: 0.4, color: "#9a988a", textTransform: "uppercase" }}>
          <div>Customer</div><div>Bookings</div><div>Total spent</div><div>Due</div><div>Last visit</div><div>Tag</div>
        </div>
        {rows.map((c) => (
          <div key={c.phone || c.name} style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr 1fr .9fr 1fr .9fr", gap: 12, padding: "14px 20px", borderBottom: "1px solid #F0F0EA", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 11, minWidth: 0 }}>
              <div style={{ width: 34, height: 34, flex: "none", borderRadius: 10, background: c.regular ? YELLOW : INK, color: c.regular ? INK : YELLOW, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Anton", fontSize: 15 }}>{c.name.charAt(0).toUpperCase()}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: INK, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}{c.regular ? " ⭐" : ""}</div>
                <div style={{ fontSize: 11, color: MUTED }}>{c.phone ? `+91 ${c.phone}` : "no phone"}</div>
              </div>
            </div>
            <div style={{ fontSize: 13, color: INK }}><b>{c.bookings}</b><div style={{ fontSize: 10.5, color: MUTED }}>{c.online} online · {c.walkin} walk-in</div></div>
            <div style={{ fontSize: 13, fontWeight: 800, color: INK, fontVariantNumeric: "tabular-nums" }}>{paiseToMoney(c.spentPaise)}</div>
            <div style={{ fontSize: 12.5, fontWeight: 800, color: c.duePaise > 0 ? "#C25A16" : "#B8B8AE", fontVariantNumeric: "tabular-nums" }}>{c.duePaise > 0 ? paiseToMoney(c.duePaise) : "—"}</div>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: MUTED }}>{c.lastVisit || "—"}</div>
            <div>
              <button onClick={() => toggleTag(c)} style={{ fontSize: 11.5, fontWeight: 800, padding: "7px 12px", borderRadius: 9, background: c.regular ? YELLOW : "#F4F4EE", color: INK, border: c.regular ? `1px solid ${INK}` : `1px solid ${LINE}` }}>
                {c.regular ? "⭐ Regular" : "Tag regular"}
              </button>
            </div>
          </div>
        ))}
        {rows.length === 0 && <div style={{ padding: 44, textAlign: "center", color: "#9a988a", fontSize: 13 }}>No customers match.</div>}
      </div>
    </>
  );
}

// ================= Pricing =================
function Pricing({ config, reload, flash }: { config: VenueConfig; reload: () => void; flash: (m: string) => void }) {
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [code, setCode] = useState("");
  const [pct, setPct] = useState("15");
  const [cap, setCap] = useState("");
  const [min, setMin] = useState("");
  const [uses, setUses] = useState("");
  async function loadCoupons() { try { setCoupons(await api.coupons()); } catch { setCoupons([]); } }
  useEffect(() => { loadCoupons(); }, []);

  async function saveSetting(patch: any) { try { await api.updateSettings(patch); reload(); flash("Saved"); } catch { flash("Couldn't save"); } }
  async function addCoupon() {
    const c = code.trim().toUpperCase();
    if (c.length < 3) return flash("Code too short");
    const percentOff = Math.max(1, Math.min(100, Number(pct) || 0));
    try {
      await api.addCoupon({
        code: c,
        percentOff,
        maxDiscountPaise: cap ? Number(cap) * 100 : null,
        minSubtotalPaise: min ? Number(min) * 100 : 0,
        usageCap: uses ? Number(uses) : null,
      });
      setCode(""); setCap(""); setMin(""); setUses(""); setPct("15");
      loadCoupons();
      flash("Coupon created");
    } catch (e: any) { flash(e.status === 409 ? "That code already exists" : "Couldn't create"); }
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "360px 1fr", gap: 18, alignItems: "start" }}>
      {/* deposit + fee */}
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <div style={{ background: "#fff", border: `1px solid ${LINE}`, borderRadius: 20, padding: "20px 22px" }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: INK, marginBottom: 4 }}>Deposit & fees</div>
          <div style={{ fontSize: 11.5, color: "#9a988a", marginBottom: 16 }}>What the customer pays online to lock a slot.</div>
          <label style={{ fontSize: 11, fontWeight: 800, color: MUTED, textTransform: "uppercase", letterSpacing: 0.4 }}>Deposit to pay online</label>
          <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "8px 0 16px" }}>
            <input defaultValue={config.depositPercent} inputMode="numeric" onBlur={(e) => { const v = Number(e.target.value); if (v >= 0 && v <= 100 && v !== config.depositPercent) saveSetting({ depositPercent: v }); }} style={{ ...editInput, width: 70, flex: "none", textAlign: "center" }} />
            <span style={{ fontSize: 14, fontWeight: 700, color: INK }}>% of the total · balance at the ground</span>
          </div>
          <label style={{ fontSize: 11, fontWeight: 800, color: MUTED, textTransform: "uppercase", letterSpacing: 0.4 }}>Convenience fee</label>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: INK }}>₹</span>
            <input defaultValue={Math.round(config.convenienceFeePaise / 100)} inputMode="numeric" onBlur={(e) => { const v = Number(e.target.value) * 100; if (v >= 0 && v !== config.convenienceFeePaise) saveSetting({ convenienceFeePaise: v }); }} style={{ ...editInput, width: 90, flex: "none" }} />
            <span style={{ fontSize: 14, fontWeight: 700, color: INK }}>per booking</span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 11, background: "#FFF9D6", border: "1px solid #F2E7A0", borderRadius: 14, padding: "13px 16px" }}>
          <span style={{ fontSize: 18 }}>💡</span>
          <div style={{ fontSize: 12, color: MUTED, lineHeight: 1.45 }}>Peak evenings (5–9 PM) and weekends auto-price at +35%. Deposit and fee changes apply to the next booking in the customer app.</div>
        </div>
      </div>

      {/* coupons */}
      <div style={{ background: "#fff", border: `1px solid ${LINE}`, borderRadius: 20, padding: "20px 22px" }}>
        <SetupHead title="Coupons" count={coupons.length} sub="Codes customers enter at checkout. Toggle off to pause." />
        <div style={{ display: "flex", flexDirection: "column", gap: 9, marginBottom: 16 }}>
          {coupons.map((c) => (
            <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 12, border: "1px solid #EEEEE8", borderRadius: 13, padding: "11px 13px", background: c.active ? "#FAFAF6" : "#F4F4F0", opacity: c.active ? 1 : 0.6 }}>
              <div style={{ fontFamily: "Anton", fontSize: 16, color: INK, letterSpacing: 1, background: YELLOW, padding: "4px 10px", borderRadius: 8 }}>{c.code}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: INK }}>{c.percentOff}% off{c.maxDiscountPaise ? ` · max ${paiseToMoney(c.maxDiscountPaise)}` : ""}</div>
                <div style={{ fontSize: 11, color: MUTED }}>{c.minSubtotalPaise ? `min ${paiseToMoney(c.minSubtotalPaise)} · ` : ""}{c.usageCap != null ? `${c.usedCount}/${c.usageCap} used` : `${c.usedCount} used`}</div>
              </div>
              <button onClick={async () => { await api.toggleCoupon(c.id, !c.active); loadCoupons(); }} style={{ fontSize: 11.5, fontWeight: 800, padding: "6px 11px", borderRadius: 9, background: c.active ? "#E4F7DC" : "#EEEEE8", color: c.active ? "#2F6B1E" : "#6C6C61" }}>{c.active ? "Active" : "Paused"}</button>
              <button onClick={async () => { await api.deleteCoupon(c.id); loadCoupons(); flash("Coupon removed"); }} style={removeBtn}>×</button>
            </div>
          ))}
          {coupons.length === 0 && <div style={{ padding: 18, textAlign: "center", color: "#9a988a", fontSize: 12.5 }}>No coupons yet.</div>}
        </div>
        <div style={{ borderTop: "1px dashed #E6E6DE", paddingTop: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: INK, marginBottom: 10 }}>New coupon</div>
          <div style={{ display: "grid", gridTemplateColumns: "1.3fr .8fr .9fr .9fr .8fr", gap: 8, alignItems: "end" }}>
            <Labeled label="Code"><input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="SUMMER15" style={couponInputS} /></Labeled>
            <Labeled label="% off"><input value={pct} onChange={(e) => setPct(e.target.value.replace(/\D/g, ""))} inputMode="numeric" style={couponInputS} /></Labeled>
            <Labeled label="Max ₹"><input value={cap} onChange={(e) => setCap(e.target.value.replace(/\D/g, ""))} placeholder="—" inputMode="numeric" style={couponInputS} /></Labeled>
            <Labeled label="Min ₹"><input value={min} onChange={(e) => setMin(e.target.value.replace(/\D/g, ""))} placeholder="—" inputMode="numeric" style={couponInputS} /></Labeled>
            <Labeled label="Uses"><input value={uses} onChange={(e) => setUses(e.target.value.replace(/\D/g, ""))} placeholder="∞" inputMode="numeric" style={couponInputS} /></Labeled>
          </div>
          <button onClick={addCoupon} style={{ ...dashedBtn, marginTop: 12 }}>+ Create coupon</button>
        </div>
      </div>
    </div>
  );
}

// ================= Venue setup =================
function Venue({ config, reload, flash }: { config: VenueConfig; reload: () => void; flash: (m: string) => void }) {
  const emojiOpts = ["🏏", "⚽", "🏸", "🎾", "🏓", "🥅"];
  async function saveSport(id: string, patch: any) { try { await api.updateSport(id, patch); reload(); } catch { flash("Couldn't save"); } }
  async function saveTurf(id: string, patch: any) { try { await api.updateTurf(id, patch); reload(); } catch { flash("Couldn't save"); } }
  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, alignItems: "start" }}>
        {/* Sports */}
        <div style={{ background: "#fff", border: `1px solid ${LINE}`, borderRadius: 20, padding: "20px 22px" }}>
          <SetupHead title="Sports" count={config.sports.length} sub="What customers can book. Rename, re-price or remove." />
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {config.sports.map((sp) => (
              <div key={sp.id} style={{ border: "1px solid #EEEEE8", borderRadius: 14, padding: "12px 13px", background: "#FAFAF6" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 40, height: 40, flex: "none", borderRadius: 11, background: "#fff", border: `1px solid ${LINE}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>{sp.icon}</div>
                  <input defaultValue={sp.name} onBlur={(e) => e.target.value !== sp.name && saveSport(sp.id, { name: e.target.value })} style={editInput} />
                  <button onClick={async () => { try { await api.deleteSport(sp.id); reload(); flash("Sport removed"); } catch (e: any) { flash(e.status === 409 ? "Keep at least one sport" : "Couldn't remove"); } }} style={removeBtn}>×</button>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 9 }}>
                  <input defaultValue={sp.sub} placeholder="Format" onBlur={(e) => e.target.value !== sp.sub && saveSport(sp.id, { sub: e.target.value })} style={{ ...editInput, fontWeight: 600, fontSize: 12, color: MUTED }} />
                  <div style={{ display: "flex", alignItems: "center", gap: 6, border: `1px solid ${LINE}`, borderRadius: 10, padding: "0 11px", background: "#fff" }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: "#9a988a" }}>₹</span>
                    <input defaultValue={Math.round(sp.basePaise / 100)} inputMode="numeric" onBlur={(e) => { const v = Number(e.target.value) * 100; if (v && v !== sp.basePaise) saveSport(sp.id, { basePaise: v }); }} style={{ width: 60, border: "none", outline: "none", padding: "8px 0", fontSize: 12.5, fontWeight: 800, color: INK, background: "none" }} />
                    <span style={{ fontSize: 11, color: "#9a988a", fontWeight: 600 }}>/hr</span>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, marginTop: 9, flexWrap: "wrap" }}>
                  {emojiOpts.map((e) => (
                    <button key={e} onClick={() => saveSport(sp.id, { icon: e })} style={{ width: 32, height: 32, borderRadius: 9, fontSize: 16, background: sp.icon === e ? YELLOW : "#fff", border: sp.icon === e ? `1px solid ${INK}` : `1px solid ${LINE}` }}>{e}</button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <button onClick={async () => { try { await api.addSport({ name: "New sport", sub: "5-a-side", icon: "⚽", basePaise: 80000 }); reload(); } catch { flash("Couldn't add"); } }} style={dashedBtn}>+ Add a sport</button>
        </div>

        {/* Turfs */}
        <div style={{ background: "#fff", border: `1px solid ${LINE}`, borderRadius: 20, padding: "20px 22px" }}>
          <SetupHead title="Turfs & courts" count={config.turfs.length} sub="Each turf becomes a bookable column in the calendar." />
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {config.turfs.map((tf) => (
              <div key={tf.id} style={{ border: "1px solid #EEEEE8", borderRadius: 14, padding: "12px 13px", background: "#FAFAF6" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 40, height: 40, flex: "none", borderRadius: 11, background: INK, color: YELLOW, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>{tf.icon}</div>
                  <input defaultValue={tf.name} onBlur={(e) => e.target.value !== tf.name && saveTurf(tf.id, { name: e.target.value })} style={editInput} />
                  <button onClick={async () => { try { await api.deleteTurf(tf.id); reload(); flash("Turf removed"); } catch (e: any) { flash(e.status === 409 ? "Keep at least one turf" : "Couldn't remove"); } }} style={removeBtn}>×</button>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 9 }}>
                  <select defaultValue={tf.sportId} onChange={(e) => saveTurf(tf.id, { sportId: e.target.value })} style={{ flex: "none", border: `1px solid ${LINE}`, borderRadius: 10, padding: "8px 10px", fontSize: 12, fontWeight: 700, color: INK, outline: "none", background: "#fff" }}>
                    {config.sports.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                  <input defaultValue={tf.surface} placeholder="Surface / notes" onBlur={(e) => e.target.value !== tf.surface && saveTurf(tf.id, { surface: e.target.value })} style={{ ...editInput, fontWeight: 600, fontSize: 12, color: MUTED }} />
                </div>
              </div>
            ))}
          </div>
          <button onClick={async () => { try { await api.addTurf({ name: "New turf", sportId: config.sports[0].id, surface: "Astro · floodlit", icon: config.sports[0].icon }); reload(); } catch { flash("Couldn't add"); } }} style={dashedBtn}>+ Add a turf</button>
        </div>
      </div>
      <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 11, background: "#FFF9D6", border: "1px solid #F2E7A0", borderRadius: 14, padding: "13px 16px" }}>
        <span style={{ fontSize: 18 }}>💡</span>
        <div style={{ fontSize: 12, color: MUTED, lineHeight: 1.45 }}>Changes save to the backend and flow to the <b style={{ color: INK }}>customer app</b>, dashboard slot control and calendar. Start lean with one cricket turf — add more when you grow.</div>
      </div>
    </>
  );
}

// ================= Walk-in modal =================
function Walkin({ config, onClose, onDone }: { config: VenueConfig; onClose: () => void; onDone: (m: string) => void }) {
  const [sportId, setSportId] = useState(config.sports[0].id);
  const turfs = config.turfs.filter((t) => t.sportId === sportId);
  const [turfId, setTurfId] = useState(turfs[0]?.id ?? config.turfs[0].id);
  const [slots, setSlots] = useState<{ hour: number; label: string; pricePaise: number; status: string }[]>([]);
  const [hour, setHour] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [paid, setPaid] = useState(true);
  const [date, setDate] = useState<string>("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.dates().then((d) => setDate(d[0])).catch(() => {}); }, []);
  useEffect(() => { const t = turfs.find((x) => x.id === turfId) ? turfId : turfs[0]?.id; if (t) setTurfId(t); /* eslint-disable-next-line */ }, [sportId]);
  useEffect(() => { if (turfId && date) api.availability(turfId, date).then((r) => setSlots(r.slots)).catch(() => setSlots([])); }, [turfId, date]);

  const price = slots.find((s) => s.hour === hour)?.pricePaise ?? 0;
  const open = slots.filter((s) => s.status === "open" || s.status === "peak");

  async function confirm() {
    if (hour == null) return;
    if (!name.trim()) return;
    setBusy(true);
    try {
      await api.addWalkin({ turfId, date, hour, customerName: name.trim(), customerPhone: phone, paid });
      onDone("Walk-in added · shows in the calendar");
    } catch (e: any) {
      onDone(e.status === 409 ? "That slot was just taken" : "Couldn't add walk-in");
    } finally { setBusy(false); }
  }

  return (
    <div onClick={onClose} style={{ position: "absolute", inset: 0, zIndex: 60, background: "rgba(20,19,14,.55)", display: "flex", alignItems: "center", justifyContent: "center", animation: "ovfade .2s ease" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 460, background: "#fff", borderRadius: 22, overflow: "hidden", animation: "ovsheet .25s ease both", boxShadow: "0 30px 70px -20px rgba(0,0,0,.5)" }}>
        <div style={{ background: INK, padding: "18px 22px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div><div style={{ fontFamily: "Anton", fontSize: 20, color: "#fff", lineHeight: 1 }}>Add walk-in</div><div style={{ fontSize: 11.5, color: "#8f8d80", marginTop: 2 }}>Books into the same calendar — no clashes.</div></div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 10, background: PANEL, color: "#fff", fontSize: 16 }}>×</button>
        </div>
        <div style={{ padding: "20px 22px", maxHeight: 620, overflowY: "auto" }} className="ov">
          {config.multiSport && (
            <>
              <ModalLabel>Sport</ModalLabel>
              <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                {config.sports.map((s) => {
                  const sel = s.id === sportId;
                  return <button key={s.id} onClick={() => setSportId(s.id)} style={{ display: "flex", alignItems: "center", gap: 7, padding: "10px 14px", borderRadius: 12, background: sel ? INK : "#fff", color: sel ? "#fff" : INK, border: sel ? `1px solid ${INK}` : `1px solid ${LINE}` }}><span style={{ fontSize: 18 }}>{s.icon}</span><span style={{ fontSize: 11, fontWeight: 700 }}>{s.name}</span></button>;
                })}
              </div>
            </>
          )}
          {turfs.length > 1 && (
            <>
              <ModalLabel>Turf</ModalLabel>
              <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
                {turfs.map((t) => { const sel = t.id === turfId; return <button key={t.id} onClick={() => setTurfId(t.id)} style={{ padding: "9px 14px", borderRadius: 11, fontSize: 12.5, fontWeight: 700, background: sel ? INK : "#fff", color: sel ? "#fff" : INK, border: sel ? `1px solid ${INK}` : `1px solid ${LINE}` }}>{t.name}</button>; })}
              </div>
            </>
          )}
          <ModalLabel>Open slot · today</ModalLabel>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 7, marginBottom: 16 }}>
            {open.map((s) => { const sel = s.hour === hour; return <button key={s.hour} onClick={() => setHour(s.hour)} style={{ padding: "9px 0", borderRadius: 10, fontSize: 11.5, fontWeight: 700, background: sel ? INK : "#F4F4EE", color: sel ? "#fff" : INK, border: sel ? `1px solid ${INK}` : `1px solid #EEEEE8` }}>{s.label}</button>; })}
            {open.length === 0 && <div style={{ gridColumn: "1/5", fontSize: 12, color: "#9a988a", padding: 8 }}>No open slots today.</div>}
          </div>
          <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
            <div style={{ flex: 1 }}><ModalLabel>Customer</ModalLabel><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" style={modalInput} /></div>
            <div style={{ flex: 1 }}><ModalLabel>Phone</ModalLabel><input value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))} placeholder="Optional" style={modalInput} /></div>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: APP, borderRadius: 13, padding: "12px 15px", marginBottom: 14 }}>
            <div><div style={{ fontSize: 11, color: MUTED, fontWeight: 600 }}>Amount</div><div style={{ fontFamily: "Anton", fontSize: 24, color: INK, fontVariantNumeric: "tabular-nums" }}>{price ? paiseToMoney(price) : "—"}</div></div>
            <div style={{ display: "flex", gap: 7 }}>
              {[{ id: true, label: "Cash paid" }, { id: false, label: "Pay later" }].map((p) => { const sel = paid === p.id; return <button key={String(p.id)} onClick={() => setPaid(p.id)} style={{ padding: "9px 13px", borderRadius: 10, fontSize: 12, fontWeight: 700, background: sel ? INK : "#fff", color: sel ? "#fff" : INK, border: sel ? `1px solid ${INK}` : `1px solid ${LINE}` }}>{p.label}</button>; })}
            </div>
          </div>
          <button onClick={confirm} disabled={hour == null || !name.trim() || busy} style={{ width: "100%", height: 50, borderRadius: 13, background: YELLOW, color: INK, fontSize: 15, fontWeight: 900, opacity: hour == null || !name.trim() || busy ? 0.55 : 1 }}>{busy ? "Adding…" : "Add booking"}</button>
        </div>
      </div>
    </div>
  );
}

// ================= small helpers =================
function Skeleton() {
  return <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: 18 }}>{[0, 1].map((i) => <div key={i} style={{ height: 300, borderRadius: 20, background: "#EDEDE4", animation: "ovfade 1s infinite alternate" }} />)}</div>;
}
function Key({ c, label, b }: { c: string; label: string; b?: boolean }) {
  return <span style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 9, height: 9, borderRadius: 3, background: c, border: b ? "1px solid #E0E0D8" : "none" }} />{label}</span>;
}
function SetupHead({ title, count, sub }: { title: string; count: number; sub: string }) {
  return (<><div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}><div style={{ fontSize: 14, fontWeight: 800, color: INK }}>{title}</div><span style={{ fontSize: 11, fontWeight: 800, color: INK, background: YELLOW, padding: "3px 9px", borderRadius: 8 }}>{count}</span></div><div style={{ fontSize: 11.5, color: "#9a988a", marginBottom: 14 }}>{sub}</div></>);
}
function ModalLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 11, fontWeight: 800, color: MUTED, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8 }}>{children}</div>;
}
function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><div style={{ fontSize: 10, fontWeight: 800, color: MUTED, textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 5 }}>{label}</div>{children}</div>;
}
const couponInputS: CSSProperties = { width: "100%", border: `1px solid ${LINE}`, borderRadius: 10, padding: "9px 10px", fontSize: 13, fontWeight: 700, color: INK, outline: "none", background: "#fff" };
function dueChip(due: boolean): CSSProperties {
  return { marginTop: 4, fontSize: 9.5, fontWeight: 800, padding: "2px 7px", borderRadius: 7, display: "inline-block", background: due ? "#FFEEDF" : "#E4F7DC", color: due ? "#C25A16" : "#3B7A22" };
}
function statusChip(status: string, due: number): CSSProperties {
  let bg = "#E4F7DC", c = "#2F6B1E", txt = "Paid";
  if (due > 0) { bg = "#FFEEDF"; c = "#C25A16"; txt = "Due"; }
  if (status === "CANCELLED") { bg = "#FCE9E5"; c = "#E5533C"; txt = "Cancelled"; }
  return { fontSize: 10.5, fontWeight: 800, padding: "4px 10px", borderRadius: 8, background: bg, color: c, display: "inline-block" };
}
const editInput: CSSProperties = { flex: 1, minWidth: 0, border: `1px solid ${LINE}`, borderRadius: 10, padding: "9px 11px", fontSize: 13.5, fontWeight: 800, color: INK, outline: "none", background: "#fff" };
const removeBtn: CSSProperties = { width: 34, height: 34, flex: "none", borderRadius: 10, background: "#FCE9E5", color: "#E5533C", fontSize: 16, fontWeight: 800 };
const dashedBtn: CSSProperties = { width: "100%", marginTop: 12, height: 44, borderRadius: 12, border: "1.5px dashed #CFCFC6", background: "#fff", color: INK, fontSize: 13, fontWeight: 800 };
const modalInput: CSSProperties = { width: "100%", border: `1px solid ${LINE}`, borderRadius: 11, padding: "11px 12px", fontSize: 13, fontWeight: 600, outline: "none", color: INK };
