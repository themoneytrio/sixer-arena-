# Sixer Arena — Turf & Playzone Booking

A complete, full-stack booking product for a box-cricket turf, built from the
[Claude Design handoff](docs/DESIGN-HANDOFF.md). Two front-ends share one backend:

- **Consumer app** (`apps/consumer`) — mobile-first React app in a phone frame:
  splash → phone/OTP login → book a slot → checkout → pay → confirmation →
  my bookings → booking detail → profile.
- **Owner console** (`apps/owner`) — wide desktop React app: revenue dashboard,
  bookings, slot calendar, analytics (occupancy heatmap), add walk-in, venue setup.
- **Backend** (`apps/backend`) — Fastify + Prisma + PostgreSQL: OTP auth, real
  availability, an atomic slot-claim that prevents double-booking, a
  Razorpay-shaped payment flow, and owner aggregation queries.
- **Shared** (`packages/shared`) — design tokens, API contract types and
  formatting helpers, so the two front-ends can't drift.

The palette is **yellow `#FFD400` on warm near-black `#14130E`**, fonts
**Anton** (scoreboard/display) + **Archivo** (UI) — the identity the user landed
on in the design chats.

## Quick start

Prereqs: Node 22+, pnpm 10+, and PostgreSQL 16 (server binaries). In this
container Postgres is started in-process by `scripts/dev-db.sh`; elsewhere point
`DATABASE_URL` at any Postgres.

```bash
pnpm install
bash scripts/dev.sh        # Postgres → migrate → seed → run all three apps
```

Then open:

| App | URL |
|---|---|
| Consumer | http://localhost:5173 |
| Owner console | http://localhost:5174 |
| Backend API | http://localhost:4000 |

**Demo logins** (mock SMS — any 4-digit OTP works, or use `0000`):

- Customer: `9876543210` (has past bookings)
- Owner: `9000000001` (lands in the console)

The mock OTP is also printed in the backend log and served at
`GET /dev/last-otp?phone=…`.

### Run pieces individually

```bash
pnpm --filter @sixer/backend dev      # API on :4000 (tsx watch)
pnpm --filter @sixer/consumer dev     # Vite on :5173
pnpm --filter @sixer/owner dev        # Vite on :5174
pnpm --filter @sixer/backend seed     # reset demo data
pnpm --filter @sixer/backend test     # concurrency / double-booking test
```

## How the money flow really works

1. `GET /venues/:id/availability` returns each hour with a server-computed price
   and a real status (`open`/`peak`/`full`/`blocked`) derived from the
   `SlotHold` table — never randomly faked.
2. `POST /bookings/checkout` recomputes every price server-side, then in **one
   transaction** creates the booking and claims a `SlotHold` row per slot. The
   `@@unique(turfId, date, hour)` index makes a multi-slot cart atomic: if any
   slot is already taken, Postgres throws and the whole thing rolls back with
   `409 SLOT_TAKEN` — the loser bounces back to the grid (README §5 race).
3. A payment order is created via the `PaymentProvider` (mock by default, real
   Razorpay when keys are present). `verify-payment` + the webhook both
   idempotently confirm and promote the holds `HELD → BOOKED`.
4. A 60-second sweep releases holds from abandoned checkouts.

**Owner walk-ins and blocks go through the same `claimSlots()` code path**, so
online and offline can never double-book the same slot.

### The double-booking guarantee, tested

```bash
VENUE_ID=$(curl -s localhost:4000/bootstrap | python3 -c 'import sys,json;print(json.load(sys.stdin)["venueId"])') \
  pnpm --filter @sixer/backend test
# → statuses: [200,409,409,409,409,409] → 1 won, 5 bounced ✅
```

## Real integrations (optional)

Everything runs fully offline with deterministic mocks. To exercise the real
SDKs, set env in `apps/backend/.env`:

- **Razorpay** (test mode, free/no-KYC): `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`,
  `RAZORPAY_WEBHOOK_SECRET`. The consumer app then opens real checkout instead
  of the mock "processing" screen.
- **SMS OTP** (Twilio trial): `SMS_PROVIDER=twilio`, `TWILIO_SID`, `TWILIO_TOKEN`,
  `TWILIO_FROM`. The same OTP generate/hash/verify path runs regardless of transport.

## Layout

```
apps/
  backend/    Fastify + Prisma + Postgres API
  consumer/   React (Vite) mobile booking app
  owner/      React (Vite) desktop owner console
packages/
  shared/     design tokens + API types + formatters
docs/
  DESIGN-HANDOFF.md   the original Claude Design brief + chats
project/      the original HTML prototypes (reference)
scripts/      dev-db.sh, dev.sh
```

## Notes & deferred scope

Config-driven from one cricket turf (the owner can add sports/turfs, adjust
deposit %/fee, and manage coupons — all of which flow to the customer app).
Built beyond the prototype: **recurring weekly team bookings** (checkout → "Make
it weekly", §3.9), **coupons + pricing management** (§4.8), the **customers
screen** with tag-as-regular (§4.9), and **payments & dues** (transactions,
pending-due collection, refunds — §4.10). Deliberately deferred, matching the
design chats: staff-permission UI (the membership row already models it),
turf-info gallery, WhatsApp Business templates (SMS-only for now), and
bank settlement/payout schedules.
