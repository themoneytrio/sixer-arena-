/**
 * The double-booking race (README §5, highest-value edge). Fires N concurrent
 * checkouts at the SAME slot and asserts exactly one 200 and N-1 409 SLOT_TAKEN.
 * Run against a live server: `pnpm test` (server must be on :4000).
 */
const B = process.env.API ?? "http://localhost:4000";

async function token(phone: string): Promise<string> {
  await fetch(`${B}/auth/otp/request`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone }) });
  const res = await fetch(`${B}/auth/otp/verify`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone, code: "1234" }) });
  return (await res.json()).accessToken;
}

async function main() {
  const venueId = process.env.VENUE_ID;
  if (!venueId) throw new Error("set VENUE_ID env");
  const venue = await (await fetch(`${B}/venues/${venueId}`)).json();
  const turfId = venue.turfs[0].id;
  const dates = await (await fetch(`${B}/venues/${venueId}/dates`)).json();
  const date = dates.dates[3]; // a few days out, unlikely to be seeded
  const hour = 12; // midday, off-peak, open

  const N = 6;
  const tokens = await Promise.all(Array.from({ length: N }, (_, i) => token(`98000000${10 + i}`)));
  const results = await Promise.all(
    tokens.map((t, i) =>
      fetch(`${B}/bookings/checkout`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${t}` },
        body: JSON.stringify({ venueId, items: [{ turfId, date, hour }], name: `Racer${i}`, paymentMethod: "upi", idempotencyKey: `race-${date}-${hour}-${i}-${Date.now()}` }),
      }).then((r) => r.status)
    )
  );
  const ok = results.filter((s) => s === 200).length;
  const taken = results.filter((s) => s === 409).length;
  console.log("statuses:", results.sort(), `→ ${ok} won, ${taken} bounced`);
  if (ok === 1 && taken === N - 1) {
    console.log("✅ PASS: exactly one winner, rest got 409 SLOT_TAKEN");
    process.exit(0);
  } else {
    console.error("❌ FAIL: expected 1 winner + " + (N - 1) + " bounced");
    process.exit(1);
  }
}
main();
