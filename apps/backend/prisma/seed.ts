import { PrismaClient } from "@prisma/client";
import { isPeakHour, slotPricePaise } from "../src/domain/pricing.js";
import { upcomingDates, addDaysIso } from "../src/domain/dates.js";
import { generateEntryCode } from "../src/domain/codes.js";

const prisma = new PrismaClient();

async function main() {
  console.log("Resetting…");
  await prisma.slotHold.deleteMany();
  await prisma.bookingSlot.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.booking.deleteMany();
  await prisma.turf.deleteMany();
  await prisma.sport.deleteMany();
  await prisma.coupon.deleteMany();
  await prisma.venueMembership.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.otpChallenge.deleteMany();
  await prisma.venue.deleteMany();
  await prisma.user.deleteMany();

  // Default single-cricket-turf config (matches the chat2 pivot).
  const venue = await prisma.venue.create({
    data: {
      name: "Sixer Arena",
      locality: "Kanpur · Kalyanpur",
      convenienceFeePaise: 3000,
      depositPercent: 40,
      sports: { create: [{ name: "Box Cricket", sub: "6-a-side", icon: "🏏", basePaise: 90000, sortOrder: 0 }] },
    },
    include: { sports: true },
  });
  const cricket = venue.sports[0];
  const turf = await prisma.turf.create({
    data: { venueId: venue.id, sportId: cricket.id, name: "Cricket Turf", surface: "Astro · floodlit", icon: "🏏" },
  });

  // A couple of demo coupons the owner can hand out.
  await prisma.coupon.createMany({
    data: [
      { venueId: venue.id, code: "FIRST20", percentOff: 20, maxDiscountPaise: 30000, minSubtotalPaise: 50000, usageCap: 100 },
      { venueId: venue.id, code: "WEEKDAY10", percentOff: 10 },
    ],
  });

  // Owner account (phone-login into the console via the same OTP flow).
  const owner = await prisma.user.create({ data: { phone: "9000000001", name: "Owner" } });
  await prisma.venueMembership.create({ data: { userId: owner.id, venueId: venue.id, role: "OWNER" } });

  // A demo customer whose past bookings show in My Bookings.
  const cust = await prisma.user.create({ data: { phone: "9876543210", name: "Rohit" } });

  const dates = upcomingDates(7);

  // Helper to create a confirmed booking on a set of (turf,date,hour) cells.
  async function makeBooking(opts: {
    user?: string;
    name: string;
    phone: string;
    source: "ONLINE" | "WALKIN";
    cells: { date: string; hour: number }[];
    past?: boolean;
    paid?: boolean;
  }) {
    let subtotal = 0;
    const slots = opts.cells.map((c) => {
      const peak = isPeakHour(c.date, c.hour);
      const price = slotPricePaise(cricket.basePaise, peak);
      subtotal += price;
      return { turfId: turf.id, date: c.date, hour: c.hour, pricePaise: price, isPeak: peak };
    });
    const fee = opts.source === "ONLINE" ? venue.convenienceFeePaise : 0;
    const total = subtotal + fee;
    const deposit = opts.source === "ONLINE" ? Math.round((total * 40) / 100 / 1000) * 1000 : 0;
    const paid = opts.paid ?? true;
    const b = await prisma.booking.create({
      data: {
        code: "SX" + Math.floor(1000 + Math.random() * 9000),
        entryCode: generateEntryCode(),
        venueId: venue.id,
        userId: opts.user ?? null,
        source: opts.source,
        status: opts.past ? "COMPLETED" : "CONFIRMED",
        customerName: opts.name,
        customerPhone: opts.phone,
        subtotalPaise: subtotal,
        feePaise: fee,
        totalPaise: total,
        depositPaise: deposit,
        amountPaidPaise: opts.source === "ONLINE" ? deposit : paid ? total : 0,
        amountDuePaise: opts.source === "ONLINE" ? total - deposit : paid ? 0 : total,
        slots: { create: slots },
      },
    });
    // Online bookings paid a deposit through the (mock) gateway — record it so
    // the Payments screen's transactions table reflects reality.
    if (opts.source === "ONLINE" && deposit > 0) {
      await prisma.payment.create({
        data: {
          bookingId: b.id,
          provider: "MOCK",
          orderId: "order_mock_seed_" + b.code,
          paymentId: "pay_mock_seed_" + b.code,
          amountPaise: deposit,
          status: "PAID",
          createdAt: b.createdAt,
        },
      });
    }
    // Past bookings don't occupy live holds; future ones do.
    if (!opts.past) {
      for (const c of opts.cells) {
        await prisma.slotHold.create({ data: { turfId: turf.id, date: c.date, hour: c.hour, status: "BOOKED", bookingId: b.id } });
      }
    }
    return b;
  }

  // Seed live bookings across the next few days so the grid shows real Full slots.
  await makeBooking({ name: "Aman", phone: "9812300011", source: "ONLINE", cells: [{ date: dates[0], hour: 20 }] });
  await makeBooking({ name: "Vikram", phone: "9812300022", source: "WALKIN", cells: [{ date: dates[0], hour: 18 }], paid: true });
  await makeBooking({ name: "Suresh", phone: "9812300033", source: "ONLINE", cells: [{ date: dates[0], hour: 9 }] });
  await makeBooking({ name: "Team Titans", phone: "9812300044", source: "WALKIN", cells: [{ date: dates[0], hour: 21 }], paid: false });
  await makeBooking({ name: "Nikhil", phone: "9812300055", source: "ONLINE", cells: [{ date: dates[1], hour: 19 }] });
  await makeBooking({ name: "Rahul", phone: "9812300066", source: "ONLINE", cells: [{ date: dates[2], hour: 20 }] });

  // Spread completed bookings across the past week so the dashboard 7-day chart
  // and the analytics occupancy heatmap look alive (not one lonely day).
  const names = ["Kabir", "Ishaan", "Dev", "Arnav", "Zaid", "Neel", "Ayaan", "Reyansh", "Kunal", "Manav"];
  let ni = 0;
  for (let back = 1; back <= 6; back++) {
    const d = addDaysIso(dates[0], -back);
    const allPlan: Array<[number, "ONLINE" | "WALKIN"]> = [
      [19, "ONLINE"], [20, "ONLINE"], [18, "WALKIN"], [17, "ONLINE"], [9, "WALKIN"], [21, "ONLINE"],
    ];
    const plan = allPlan.slice(0, 3 + (back % 3)); // 3–5 bookings per day
    for (const [h, src] of plan) {
      await makeBooking({ name: names[ni++ % names.length], phone: "981200" + String(1000 + ni), source: src, cells: [{ date: d, hour: h }], past: true, paid: true });
    }
  }

  // A maintenance block today.
  await prisma.slotHold.create({ data: { turfId: turf.id, date: dates[0], hour: 14, status: "BLOCKED" } });

  // Demo customer history (past, for the "Past" tab).
  await makeBooking({ user: cust.id, name: "Rohit", phone: "9876543210", source: "ONLINE", cells: [{ date: addDaysIso(dates[0], -11), hour: 21 }], past: true });
  await makeBooking({ user: cust.id, name: "Rohit", phone: "9876543210", source: "ONLINE", cells: [{ date: addDaysIso(dates[0], -17), hour: 19 }], past: true });

  console.log(`Seeded venue ${venue.id} (turf ${turf.id}). Owner phone 9000000001, customer 9876543210.`);
  console.log(`VENUE_ID=${venue.id}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
