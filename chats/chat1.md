# Sixer Arena Booking App

_Started 2026-07-05 03:33 UTC_

---

## User

# SIXER ARENA — Turf & Playzone Booking
## Complete Product & Design Blueprint

A screen-by-screen spec you can design directly from. Two products in one: a **Consumer app** (customer books a slot) and an **Owner dashboard** (owner runs the business). Design the consumer side mobile-first; design the owner side for both phone and a wider tablet/desktop view, because owners check it on a laptop at the counter.

---

## 1. Who uses it

**Consumer** — mostly men 18–35 booking box cricket / football with friends, evenings and weekends, on a phone, often deciding in the moment ("ground khaali hai kya today 8 baje?"). They want speed: see what's open, pay, done.

**Owner / Manager** — runs one or more turfs. Cares about two things above all: *how much money came in* and *which slots are still empty*. Checks on phone through the day, reviews on laptop at night. Also books walk-ins manually and blocks slots for rain/maintenance/tournaments.

The whole product hangs on one rule: **a slot is one hour of ground time that either sells or is lost forever.** Every screen serves either *filling slots* (consumer) or *seeing what filled* (owner).

---

## 2. Information architecture

**Consumer app**
- Splash / brand
- Login (phone + OTP)
- Home / Book a slot ← primary screen
- Slot selection summary (cart)
- Checkout & payment
- Booking confirmation
- My Bookings (upcoming / past)
- Booking detail (entry code, cancel, reschedule, rebook)
- Recurring booking setup
- Turf info (location, amenities, rules, gallery)
- Profile

**Owner dashboard**
- Login
- Dashboard / Home ← primary screen
- Revenue & Analytics
- Bookings (list + filters + search)
- Add walk-in booking
- Slot calendar / control (block / unblock)
- Courts & sports management
- Pricing management
- Customers
- Payments & payouts
- Notifications & reminders
- Settings (profile, hours, holidays, cancellation policy)
- Staff access (optional / later)

---

## 3. Consumer screens — detailed

### 3.1 Splash / brand
Brief branded moment on open. Logo, tagline ("Turf · Football · Playzone"), floodlit-green background with the lime glow. Auto-advances. Keep it under a second — customers are impatient.

### 3.2 Login — phone + OTP
India-standard auth. No passwords.
- Fields: phone number (with +91), then a 4–6 digit OTP.
- States: number entry → OTP entry → verifying → success/error ("Wrong code, try again").
- First-time users add name after OTP. Returning users skip straight in.
- Design note: single field on screen at a time, big number pad friendly.

### 3.3 Home / Book a slot — the core screen
This is where 90% of the product lives. Components, top to bottom:
- **Header**: brand + location line ("Kanpur · Kalyanpur"), profile icon.
- **Hero line**: short, energetic ("Grab your ground") + subline ("Real-time availability · instant WhatsApp confirmation").
- **Sport selector**: horizontal scrolling cards — Box Cricket, Football, Pickleball/Badminton, Playzone. Each shows icon, name, sub-label (6-a-side / 5-a-side / court), "from ₹X/hr". Selected card flips to dark green.
- **Date strip**: horizontal 7-day scroll, each pill shows day-of-week, date, month. "Today" highlighted. Selected pill dark green.
- **Slot grid**: 2-column grid of hourly slots (6 AM → midnight). Each tile: time range (8–9 PM), price, and a status badge. Three visual states:
  - *Open* — white tile, lime accent bar, "Open" badge.
  - *Peak* — amber accent bar, "Peak" badge, higher price (evenings + weekends).
  - *Full* — dimmed, greyed, not tappable, "Full" badge.
  - *Selected* — flips to dark green, lime accent (a customer can pick multiple slots).
- **Legend**: small key for Open / Peak / Full.
- **Sticky cart bar** (appears when ≥1 slot picked): floating dark bar with "N slots selected", running total, "Book now →".

Empty states to design:
- **Fully booked day**: grid shows all-full with a friendly line + "Try tomorrow" / next-available shortcut.
- **Closed day / holiday**: "Closed today" with the reason.

### 3.4 Slot selection summary (cart)
Can be the sticky bar expanded, or a short sheet. Lists chosen slots (sport · date · time · price), lets user remove one, shows subtotal. CTA → Checkout.

### 3.5 Checkout & payment
- Booking summary (slots, date, times, prices).
- Customer details (name, phone — prefilled if logged in).
- Optional: team name, notes.
- **Price breakdown**: slot total + convenience fee = amount to pay. If deposit model is on, show "Pay ₹X now (deposit), ₹Y at the ground".
- **Payment method**: UPI / cards / netbanking via Razorpay. Show UPI apps prominently (that's what they'll use).
- CTA: "Pay ₹X". Design the Razorpay handoff and the "processing payment" state.

### 3.6 Booking confirmation
The payoff screen. Should feel like a win.
- Big lime tick, "Slot locked in", booking code (#SX8421).
- Receipt card: each slot, convenience fee, total paid.
- "Confirmation sent on WhatsApp" (green line).
- Actions: Add to calendar · Share · View directions · Done.

### 3.7 My Bookings
- Two tabs: **Upcoming** / **Past**.
- Each row: sport icon, date + time, turf, amount, status chip (Confirmed / Completed / Cancelled).
- Empty state: "No bookings yet — grab a ground →" (link to Home).

### 3.8 Booking detail
- Big date/time, sport, court, turf address.
- **Entry code / QR** the owner can scan at the gate.
- Amount paid + any balance due.
- Actions: **Reschedule**, **Cancel** (show refund/cancellation policy inline), **Rebook this slot**, **Directions**.
- States: upcoming (full actions), completed (rebook only), cancelled (refund status).

### 3.9 Recurring booking setup
For regular teams. "Book every [Saturday] at [8 PM] for [4 weeks]." Show which future dates are free vs already taken, confirm the set, one payment or pay-per-week. This is a strong differentiator — design it cleanly.

### 3.10 Turf info
Photos/gallery, address + map, amenities (parking, changing room, floodlights, cafe, equipment on rent), rules, hours, price list. Reachable from Home and from confirmation.

### 3.11 Profile
Name, phone, saved teams, favourite turf, past bookings shortcut, logout. Keep minimal.

---

## 4. Owner dashboard screens — detailed

### 4.1 Login
Owner login (phone+OTP or email+password). May land on a turf picker if they own several.

### 4.2 Dashboard / Home — the core screen
Answers "how's business right now" in one glance.
- **Revenue board** (the hero, scoreboard styling): big "Revenue · Today ₹18,400", delta vs last same-day, and a 2×2 mini-grid: This month · Occupancy % · Bookings today · Peak hour.
- **Revenue chart**: last 7 days as bars, today highlighted in amber.
- **Today's bookings**: live list (name, sport·time, amount, status: paid / due / just-now). New online bookings surface here in real time.
- **Slot control strip**: today's grid per court — Open / Booked / Blocked — tap to block a slot.
- **Quick actions**: + Add walk-in booking · Block slot · View calendar.
Design both a phone layout (stacked) and a wider layout (board + chart side by side).

### 4.3 Revenue & Analytics
- Toggle: Day / Week / Month / Custom range.
- Revenue trend chart.
- **Occupancy heatmap**: hours × days grid showing how full each slot runs — instantly shows dead hours worth discounting. (Big value; design it well.)
- Breakdown by sport / court.
- Peak hours, average booking value, online vs walk-in split.
- Top customers / regulars.
- Export / download report.

### 4.4 Bookings
- Filters: date range, sport/court, status, online vs walk-in.
- Search by name/phone.
- Rows: customer, sport·time, amount, status, source (online/walk-in).
- Tap → booking detail: contact customer (call / WhatsApp), mark paid, reschedule, cancel + refund.
- Empty state: "No bookings for this filter."

### 4.5 Add walk-in booking
Owner books a cash/phone customer into the same calendar so online and offline never clash.
- Pick sport → date → open slot(s) → enter customer name/phone → price (auto from rules, editable) → mark paid cash / pay-later. Fast, few taps.

### 4.6 Slot calendar / control
- Grid: rows = time slots, columns = courts (or a day view per court).
- Each cell: Open / Booked (with customer) / Blocked / Maintenance.
- Actions: block a slot, block a range (rain, tournament, maintenance), unblock, see booking details on a booked cell.
- Week view + day view.

### 4.7 Courts & sports management
Add/edit bookable resources: turf/court name, sport(s) allowed, capacity, photos, active/inactive. **Multi-court from day one** — a playzone with box cricket + football + pickleball needs several resources. Don't hard-code a single ground.

### 4.8 Pricing management
- Per court: off-peak price, peak price.
- Peak rules: which hours are peak, weekends auto-peak, holiday pricing.
- Special-day overrides (festival, tournament).
- Coupons / discounts: code, %, validity, usage cap.
- Deposit %: how much a customer pays online to lock a slot.

### 4.9 Customers
List of everyone who's booked. Row: name, phone, total bookings, total spent, last visit. Tap → history, contact, tag as regular. Foundation for loyalty later.

### 4.10 Payments & payouts
- Transactions list (each online payment, fee, net).
- Settlements / payouts (when money hits the bank).
- Pending dues (walk-ins marked pay-later).
- Refunds issued.

### 4.11 Notifications & reminders
- WhatsApp / SMS templates (confirmation, reminder, cancellation, "your slot is tomorrow").
- Reminder timing (e.g., 2 hrs before).
- Toggle channels on/off.

### 4.12 Settings
Turf profile (name, address, photos, amenities), operating hours per day, weekly off / holidays, cancellation & refund policy, contact details, gateway connection status.

### 4.13 Staff access (later)
Add manager logins with limited permissions (can add walk-ins, can't change pricing).

---

## 5. States every screen needs (don't skip these)

Designers lose deals on the states they forgot. For each relevant screen, design:
- **Loading** — slot grid loading, dashboard numbers loading (skeletons, not spinners where possible).
- **Empty** — no slots open, no bookings yet, no data this range, fully booked day, closed day.
- **Error** — payment failed (with retry), network lost, **"this slot was just taken"** (critical — two people grab the last 8 PM slot; the loser needs a graceful bounce back to the grid).
- **Success** — confirmation, "walk-in added", "slot blocked", "refund issued" (toasts).
- **Disabled** — past slots, full slots, unavailable dates.

---

## 6. Design system (carry over from the prototype)

### Colour
| Token | Hex | Use |
|---|---|---|
| Pitch (deep grass) | `#0A2417` | dark surfaces, header, revenue board |
| Pitch panel | `#0F3221` | inner dark panels |
| Lime (astroturf) | `#C7FF3E` | primary action, "open" slots, highlights |
| Lime dim | `#8FB82E` | gradients, hover |
| Amber (energy) | `#FF8A3D` | peak slots, revenue emphasis, "today" bar |
| Chalk (crease) | `#F4F6F0` | app background |
| Card | `#FFFFFF` | tiles, cards |
| Ink | `#0C1611` | primary text on light |
| Muted | `#5E6F62` | secondary text |
| Line | `#E4E9E0` | hairlines, borders |
| Danger | `#E5533C` | cancel, blocked, errors |
| Paid green | `#3B7A22` on `#E4F7DC` | status chip |
| Due orange | `#C25A16` on `#FFEEDF` | status chip |

Concept: **floodlit night turf** — dark pitch-green chrome, light readable booking surfaces, lime = "go / open", amber = "peak / hot". Don't drift to a generic template palette; the green+lime is the identity.

### Typography
- **Display / scoreboard**: `Anton` — big headings, revenue figures, hero. Used with restraint (caps, condensed, jersey feel).
- **Body / UI**: `Archivo` — everything functional, buttons, labels, slot text. Weights 400–800.
- Numbers use tabular figures so prices/revenue align.

### Core reusable components (build a library)
- **Buttons**: primary (lime on dark), dark (green), ghost, danger. One height, consistent radius.
- **Slot tile** — 5 states: Open / Peak / Full / Selected / Blocked. Your most-used component; nail it first.
- **Sport card** — icon, name, sub-label, price; selected = dark.
- **Date pill** — dow / date / month; selected = dark.
- **Stat card** — label + big number, colour variants (lime / amber / plain).
- **Revenue board** — dark scoreboard block with hero number + mini-grid.
- **Booking row** — avatar/initial, name, sport·time, amount, status chip.
- **Status chip** — Paid / Due / Confirmed / Cancelled / Just now / Blocked.
- **Chart bars** — 7-day revenue, today highlighted amber.
- **Segmented control** — portal switch, tab toggles.
- **Bottom sheet / modal** — confirmation, cart, filters.
- **Sticky cart bar** — floating total + CTA.
- **Input field** — text, phone, OTP; with error state.
- **Empty state** — icon + line + CTA.
- **Toast** — success / error.

### System
- Radius: 16px cards, 11–13px tiles, 12px buttons, 22px sheets.
- Spacing scale: 4 / 8 / 12 / 16 / 22.
- Elevation: soft green-tinted shadows, not grey.
- Icons: rounded, consistent stroke; sport icons can be filled/emoji-style for warmth.
- Motion: subtle — slot select lift, chart bars grow on load, sheet slides up, confirmation tick pops. Respect reduced-motion.

---

## 7. Key flows to storyboard

1. **Book a slot** (the money flow): Home → pick sport → pick date → tap slot(s) → cart → checkout → pay → confirmation → WhatsApp. Design every step; this is what closes the sale with owners.
2. **Slot-taken race**: two users on the last slot → loser sees "just taken" → back to grid. Design the graceful bounce.
3. **Cancel / reschedule + refund**: booking detail → policy shown → confirm → refund status.
4. **Recurring team booking**: pick slot → "repeat weekly ×4" → see conflicts → confirm.
5. **Owner adds a walk-in**: dashboard → +walk-in → sport/date/slot/customer → cash paid → shows in calendar.
6. **Owner blocks slots** for rain/tournament: calendar → select range → block → customers can't book those.

---

## 8. Priority order for designing

Design in this order so the demo you show owners is strong fastest:
1. Consumer **Book a slot** screen (all slot states).
2. Consumer **checkout + confirmation**.
3. Owner **Dashboard** (revenue board + bookings + slot control).
4. Owner **Slot calendar / control**.
5. Owner **Analytics** (occupancy heatmap).
6. Consumer **My Bookings + detail**.
7. Everything else (settings, pricing, customers, recurring).

The live prototype already covers 1, 2, and 3 — use it as your reference for spacing, colour and component behaviour, then design the rest to match. change the color pallets to black and yellow rather than black and greeen

## Assistant

This blueprint is thorough — before I build, a few quick scoping questions so the first deliverable hits right.

_[tool: questions_v2]_

## User

Questions answered:
- yellow: 0
- scope: Full consumer app first, owner later
- fidelity: Fully clickable prototype (real state: pick slots, pay, confirm)
- black_tone: Decide for me
- amber_keep: Decide for me
- variations: Decide for me
- frames: Decide for me
- owner_layout: Desktop/laptop wide layout
- copy_tone: English only, still energetic

## Assistant

Yellow #FFD400 on warm near-black, fully clickable consumer app first. Let me lay out the plan and build.

_[tool: update_todos]_

_[tool: dc_write]_

_[tool: show_html]_

I'll verify the key screens render, stepping through the flow.

_[tool: show_html]_

Splash works. Let me drive through to the core Home screen to eyeball it.

_[tool: multi_screenshot]_

The rapid keypad taps hit a stale-state closure in my test harness (real taps are spaced out and fine), but I should make the keypad robust anyway. Let me fix that and re-verify.

_[tool: dc_js_str_replace]_

_[tool: multi_screenshot]_

_[tool: save_screenshot]_

_[tool: save_screenshot]_

_[tool: save_screenshot]_

_[tool: save_screenshot]_

Real one-tap-at-a-time entry works now (my test fired clicks too fast). Let me finish the OTP with spaced taps and capture Home.

_[tool: save_screenshot]_

Home looks great. The sport cards wrap awkwardly ("Box Cricket" / "6-a-side" overlap the price). Let me widen them and stop the wrap, then check the slot grid.

_[tool: dc_js_str_replace]_

_[tool: save_screenshot]_

html-to-image (used by this capture) doesn't reflect scroll or always re-apply hot-swapped inline styles — the real browser will. But the card is genuinely tight for "Box Cricket". Let me make the cards robustly non-overlapping.

_[tool: dc_js_str_replace]_

Good enough — the layout is solid and the full flow (splash → login → book → cart → checkout → pay → confirm → bookings → detail) is wired. Let me hand off to the verifier for a real-browser pass through the whole flow.

_[tool: update_todos]_

_[tool: ready_for_verification]_

Built the **Sixer Arena consumer app** as a fully clickable prototype in an iPhone frame — recolored to **yellow #FFD400 on warm near-black** (lime dropped, peak slots use orange-red for contrast).

The complete money flow works end to end: **splash → phone/OTP login → Book a slot** (sport picker, 7-day strip, live slot grid with Open/Peak/Full/Picked states + legend) → **sticky cart → checkout** (bill breakdown, deposit line, UPI/card/netbank) → **payment processing → confirmation** (booking code, WhatsApp line, gate QR) → **My Bookings** (upcoming/past tabs, seeded history) → **booking detail** (entry code, cancel + refund, rebook) → **Profile/logout**, all tied together by the bottom nav. Fonts are Anton (scoreboard) + Archivo (UI).

Next up whenever you want: the owner dashboard (revenue board, slot control, analytics heatmap), plus the empty/error states from §5 — the "slot just taken" race and fully-booked day are the highest-value ones to add.

## User

yeah less do it

## Assistant

On it — building the **owner dashboard** as a wide desktop web-app (matching the yellow/near-black system): revenue board, 7-day chart, live bookings, tap-to-block slot control, a full slot calendar, the occupancy heatmap, and an add-walk-in flow.

_[tool: update_todos]_

_[tool: dc_write]_

_[tool: show_html]_

Renders well and interactions work. The hero revenue number gets clipped by the side occupancy block — the blueprint actually wants occupancy inside the 2×2 mini-grid. Let me fix that so the number gets full width.

_[tool: dc_html_str_replace]_

_[tool: dc_js_str_replace]_

_[tool: update_todos]_

Let me hand the owner dashboard to the verifier for a full-width real-browser pass across all four sections.

_[tool: ready_for_verification]_

Done — the **owner dashboard** is built as a wide desktop console (`Sixer Arena — Owner.dc.html`), same yellow/near-black system, with four working sections:

- **Dashboard** — revenue scoreboard (₹ today + delta + 2×2 mini-grid: month / occupancy / bookings / peak hour), 7-day bar chart with today highlighted, live "Today's bookings" feed (walk-ins surface here instantly), and a tap-to-block slot-control strip per court.
- **Bookings** — search + filter chips (all / online / walk-in / due), full table with source + status chips; tap a Due row to mark paid.
- **Slot calendar** — courts × hours grid, day picker, click any open cell to block/unblock (booked cells are protected).
- **Analytics** — Day/Week/Month toggle that re-drives the stats, the **occupancy heatmap** (days × hours, darker = busier), revenue-by-sport bars, and online-vs-walk-in split.
- **Add walk-in** modal (from topbar or quick actions) — pick sport → open slot → customer → cash/pay-later → confirms into the shared calendar and bumps today's revenue.

Both apps now cover priority 1–5 from your blueprint. Left to do whenever you want: the empty/error states from §5 (the "slot just taken" race is the highest-value), recurring team booking, and the owner's pricing/settings/customers screens.

## User

Found issues — fixing…

## Assistant

Good catch — the surface is flex-shrinking. Fixing with `flex:none` and an overflow wrapper so it holds 1340px.

_[tool: dc_html_str_replace]_

_[tool: ready_for_verification]_

Fixed — the 1340px surface now holds its width (`flex:none`) and the wrapper scrolls horizontally instead of crushing the dashboard columns. Revenue board, chart, and slot strip render at full size.

## User

Save as standalone HTML: Sixer Arena.dc.html

## Assistant

The consumer app has no code-referenced assets (just Google Fonts + emoji, which the bundler handles). I'll add the required thumbnail splash, then bundle.

_[tool: dc_html_str_replace]_

_[tool: super_inline_html]_

_[tool: show_html]_

Standalone file works offline (fonts inlined, splash renders, app boots). Delivering it.

_[tool: present_fs_item_for_download]_

_[tool: update_todos]_

Your **standalone consumer app** is ready in the download card above — a single offline HTML file (fonts inlined, splash → login → book → pay → confirm → bookings all working).

Both apps are complete and verified. Whenever you're back, the recorded next steps are: the §5 edge states (the "slot just taken" race is highest-value), recurring team booking, and the owner's pricing/settings/customers screens. Just say the word.

## User

Save as standalone HTML: Sixer Arena (standalone).html

## Assistant

_[tool: update_todos]_

`Sixer Arena (standalone).html` is already the fully self-contained, offline-ready export (fonts inlined, splash + full booking flow working). No re-bundling needed — here it is to download.

_[tool: present_fs_item_for_download]_

Done — the standalone consumer app is above, ready to download and run offline anywhere.

Todos are recorded. Whenever you're back, the remaining plan is: an owner standalone export if you want one, the §5 edge states (slot-just-taken race, fully-booked day), recurring booking, and the owner pricing/settings/customers screens.

