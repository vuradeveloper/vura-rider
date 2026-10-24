/**
 * Real-Postgres concurrency check for the card preauthorization + driver wallet
 * flow. It is intentionally NOT a unit test: it creates 5 drivers and 5 riders,
 * runs their holds/completions/captures/webhooks at the same time, then repeats
 * the booking path with 500 riders on 5 drivers to look for reference mix-ups,
 * lost credits or double credits.
 *
 * Safety: the scratch-database guard refuses anything except
 * 127.0.0.1:55432/vura_test. Start that database first, then run:
 *
 *   $env:DB_HOST='127.0.0.1'; $env:DB_PORT='55432'; $env:DB_NAME='vura_test'
 *   $env:DB_USER='postgres'; $env:DB_PASSWORD='postgres'; $env:DB_SSL='false'
 *   $env:PAYMENTS_MODE='mock'
 *   npx tsx scripts/preauth-concurrency-check.ts
 */
import assert from "node:assert/strict";
import { query, execute, queryOne } from "../src/config/database";
import { assertScratchDatabase } from "../src/services/integrationGuard";
import {
  ensurePreauthSchema,
  createRideHold,
  captureRideHold,
  releaseRideHold,
  handlePreauthorizationEvent,
} from "../src/services/preauthorization";
import {
  ensureWalletTables,
  recordRideCompletion,
} from "../src/services/walletService";

const HOST = process.env.DB_HOST || "127.0.0.1";
const PORT = process.env.DB_PORT || "55432";
const DB = process.env.DB_NAME || "vura_test";
assertScratchDatabase(HOST, PORT, DB);

type Pair = {
  riderId: string;
  riderEmail: string;
  driverId: string;
  driverEmail: string;
  rideId: string;
  reference?: string;
};

function log(message: string): void {
  console.log(`[preauth-check] ${message}`);
}

function fulfilled<T>(results: PromiseSettledResult<T>[], label: string): T[] {
  const failures = results.filter((r) => r.status === "rejected");
  if (failures.length > 0) {
    console.error(
      `[preauth-check] ${failures.length}/${results.length} ${label} failed; first:`,
      (failures[0] as PromiseRejectedResult).reason
    );
    throw new Error(`${label} failed`);
  }
  return results.map((r) => (r as PromiseFulfilledResult<T>).value);
}

function suffix(email: string): number {
  const m = email.match(/-(\d+)(?:@|$)/);
  return m ? Number(m[1]) : 0;
}

async function reset(): Promise<void> {
  await ensurePreauthSchema();
  await ensureWalletTables();
  await execute(
    `TRUNCATE TABLE paystack_webhook_events, wallet_ledger, driver_wallets,
                    wallet_config, driver_earnings, payments, saved_cards,
                    rides, users CASCADE`
  );
}

/**
 * Creates `riders` riders and five drivers. Driver assignment is round-robin so
 * a 500-rider run gives each of the five drivers exactly 100 rides.
 */
async function seedPairs(prefix: string, riders: number): Promise<Pair[]> {
  const drivers = await query<{ id: string; email: string }>(
    `INSERT INTO users (email, role, full_name)
     SELECT $1::text || '-driver-' || g, 'driver', $1::text || ' Driver ' || g
       FROM generate_series(1, 5) g
     RETURNING id, email`,
    [prefix]
  );
  const riderRows = await query<{ id: string; email: string }>(
    `INSERT INTO users (email, role, full_name)
     SELECT $1::text || '-rider-' || g, 'rider', $1::text || ' Rider ' || g
       FROM generate_series(1, $2::int) g
     RETURNING id, email`,
    [prefix, riders]
  );

  await execute(
    `INSERT INTO saved_cards (user_id, transaction_index, last4, is_default)
     SELECT id, 'AUTH_' || id, '4242', true
       FROM users WHERE email LIKE $1`,
    [`${prefix}-rider-%`]
  );

  const driverBySuffix = new Map(drivers.map((d) => [suffix(d.email), d]));
  const riderBySuffix = new Map(riderRows.map((r) => [suffix(r.email), r]));
  const pairs: Pair[] = [];

  // Sequential seed inserts keep the test deterministic and put no load on the
  // booking path itself; every hold/capture/webhook below is concurrent.
  for (let i = 1; i <= riders; i++) {
    const driver = driverBySuffix.get(((i - 1) % 5) + 1);
    const rider = riderBySuffix.get(i);
    assert.ok(driver && rider, `seed mapping failed for ${prefix} rider ${i}`);
    const ride = await queryOne<{ id: string }>(
      `INSERT INTO rides
         (passenger_id, driver_id, status, estimated_fare, actual_fare,
          payment_method, payment_status, tier)
       VALUES ($1, $2, 'in_progress', 5.00, 5.00, 'card', 'NONE', 'go')
       RETURNING id`,
      [rider.id, driver.id]
    );
    assert.ok(ride);
    pairs.push({
      riderId: rider.id,
      riderEmail: rider.email,
      driverId: driver.id,
      driverEmail: driver.email,
      rideId: ride.id,
    });
  }
  return pairs;
}

async function runFlow(pairs: Pair[], label: string): Promise<void> {
  const rideIds = pairs.map((p) => p.rideId);
  const driverCounts = new Map<string, number>();
  for (const p of pairs) driverCounts.set(p.driverId, (driverCounts.get(p.driverId) ?? 0) + 1);

  log(`${label}: placing ${pairs.length} holds at the same time`);
  const holds = fulfilled(
    await Promise.allSettled(
      pairs.map((p) =>
        createRideHold({
          rideId: p.rideId,
          userId: p.riderId,
          amountRands: 5,
          email: p.riderEmail,
        })
      )
    ),
    `${label} holds`
  );
  const refs = new Set<string>();
  holds.forEach((h, i) => {
    assert.equal(h.paymentStatus, "HOLD_ACTIVE", `${label} hold ${i} not active`);
    assert.ok(h.reference, `${label} hold ${i} has no reference`);
    refs.add(String(h.reference));
    pairs[i].reference = String(h.reference);
  });
  assert.equal(refs.size, pairs.length, `${label} references collided`);
  const heldRows = await query<{
    id: string;
    preauth_reference: string;
    hold_amount_cents: string;
    payment_status: string;
  }>(
    `SELECT id, preauth_reference, hold_amount_cents, payment_status
       FROM rides WHERE id = ANY($1::uuid[])`,
    [rideIds]
  );
  assert.equal(heldRows.length, pairs.length);
  for (const row of heldRows) {
    assert.equal(row.payment_status, "HOLD_ACTIVE");
    assert.equal(Number(row.hold_amount_cents), 500);
    assert.ok(row.preauth_reference);
  }
  assert.equal(
    new Set(heldRows.map((r) => r.preauth_reference)).size,
    pairs.length,
    `${label} DB references collided`
  );

  // Re-reporting the same ride must return the same hold, never a second one.
  const repeat = await createRideHold({
    rideId: pairs[0].rideId,
    userId: pairs[0].riderId,
    amountRands: 5,
    email: pairs[0].riderEmail,
  });
  assert.equal(repeat.alreadyHeld, true);
  assert.equal(repeat.reference, pairs[0].reference);

  log(`${label}: recording ${pairs.length} completions at the same time`);
  fulfilled(
    await Promise.allSettled(
      pairs.map((p) => recordRideCompletion(p.driverId, p.rideId, 5, "card"))
    ),
    `${label} completions`
  );
  const pending = await query<{
    ride_id: string;
    amount_cents: string;
    status: string;
    commission_cents: string;
    vat_cents: string;
    paystack_fee_cents: string;
    margin_cents: string;
  }>(
    `SELECT ride_id, amount_cents, status, commission_cents, vat_cents,
            paystack_fee_cents, margin_cents
       FROM wallet_ledger
      WHERE ride_id = ANY($1::uuid[]) AND type = 'card_credit_pending'`,
    [rideIds]
  );
  assert.equal(pending.length, pairs.length, `${label} pending credit count`);
  for (const row of pending) {
    assert.equal(row.status, "pending");
    assert.equal(Number(row.amount_cents), 450, "driver net must be R4.50");
    assert.equal(Number(row.commission_cents), 50, "commission must be R0.50");
    assert.equal(Number(row.vat_cents), 7, "VAT slice must be R0.07");
    // Before the webhook the fallback is 1.5% of R5 = 7.5c, rounded to 8c.
    assert.equal(Number(row.paystack_fee_cents), 8, "fallback fee must be R0.08");
    assert.equal(Number(row.margin_cents), 35, "fallback margin must be R0.35");
  }

  log(`${label}: capturing ${pairs.length} fares at the same time`);
  const captures = fulfilled(
    await Promise.allSettled(pairs.map((p) => captureRideHold(p.rideId))),
    `${label} captures`
  );
  for (const c of captures) {
    assert.equal(c.paymentStatus, "CAPTURE_PENDING");
    assert.equal(c.captured, true);
  }
  const duplicateCapture = await captureRideHold(pairs[0].rideId);
  assert.equal(duplicateCapture.alreadyProcessed, true);

  log(`${label}: delivering ${pairs.length} capture.success webhooks at the same time`);
  const events = fulfilled(
    await Promise.allSettled(
      pairs.map((p, i) =>
        handlePreauthorizationEvent("preauthorization.capture.success", {
          data: {
            id: `${label}-tx-${i}`,
            reference: p.reference,
            captured_amount: 500,
            amount: 500,
            fee: 13,
            authorization: { authorization_code: `AUTH_${label}_${i}` },
          },
        })
      )
    ),
    `${label} capture webhooks`
  );
  for (const e of events) {
    assert.equal(e.handled, true);
    assert.equal(e.duplicate, false);
  }

  const paid = await query<{
    id: string;
    payment_status: string;
    captured_amount: string;
    driver_id: string;
    preauth_reference: string;
  }>(
    `SELECT id, payment_status, captured_amount, driver_id, preauth_reference
       FROM rides WHERE id = ANY($1::uuid[])`,
    [rideIds]
  );
  assert.equal(paid.length, pairs.length);
  for (const row of paid) {
    assert.equal(row.payment_status, "PAID");
    assert.equal(Number(row.captured_amount), 5);
    assert.ok(row.preauth_reference);
  }

  const credits = await query<{
    ride_id: string;
    driver_id: string;
    amount_cents: string;
    status: string;
    type: string;
    commission_cents: string;
    vat_cents: string;
    paystack_fee_cents: string;
    margin_cents: string;
  }>(
    `SELECT ride_id, driver_id, amount_cents, status, type,
            commission_cents, vat_cents, paystack_fee_cents, margin_cents
       FROM wallet_ledger
      WHERE ride_id = ANY($1::uuid[]) AND type = 'card_credit'`,
    [rideIds]
  );
  assert.equal(credits.length, pairs.length, `${label} posted credit count`);
  for (const row of credits) {
    assert.equal(row.status, "posted");
    assert.equal(Number(row.amount_cents), 450);
    assert.equal(Number(row.commission_cents), 50);
    assert.equal(Number(row.vat_cents), 7);
    // The capture webhook's real Paystack fee (13c) replaces the fallback.
    assert.equal(Number(row.paystack_fee_cents), 13);
    assert.equal(Number(row.margin_cents), 30);
  }

  const earnings = await query<{
    ride_id: string;
    driver_id: string;
    gross_amount: string;
    fee: string;
    net_amount: string;
  }>(
    `SELECT ride_id, driver_id, gross_amount, fee, net_amount
       FROM driver_earnings WHERE ride_id = ANY($1::uuid[])`,
    [rideIds]
  );
  assert.equal(earnings.length, pairs.length, `${label} earnings count`);
  for (const row of earnings) {
    assert.equal(Number(row.gross_amount), 5);
    assert.equal(Number(row.fee), 0.5);
    assert.equal(Number(row.net_amount), 4.5);
  }

  const wallets = await query<{ driver_id: string; balance_cents: string }>(
    `SELECT driver_id, balance_cents FROM driver_wallets
      WHERE driver_id = ANY($1::uuid[])`,
    [[...driverCounts.keys()]]
  );
  assert.equal(wallets.length, driverCounts.size);
  for (const w of wallets) {
    const expected = (driverCounts.get(w.driver_id) ?? 0) * 450;
    assert.equal(
      Number(w.balance_cents),
      expected,
      `${label} driver ${w.driver_id} balance`
    );
  }

  // A replayed webhook must not move a second cent.
  const replay = await Promise.all(
    pairs.map((p, i) =>
      handlePreauthorizationEvent("preauthorization.capture.success", {
        data: {
          id: `${label}-tx-${i}`,
          reference: p.reference,
          captured_amount: 500,
          amount: 500,
          fee: 13,
          authorization: { authorization_code: `AUTH_${label}_${i}` },
        },
      })
    )
  );
  for (const e of replay) assert.equal(e.duplicate, true);
  const afterReplay = await query<{ driver_id: string; balance_cents: string }>(
    `SELECT driver_id, balance_cents FROM driver_wallets
      WHERE driver_id = ANY($1::uuid[])`,
    [[...driverCounts.keys()]]
  );
  for (const w of afterReplay) {
    const expected = (driverCounts.get(w.driver_id) ?? 0) * 450;
    assert.equal(Number(w.balance_cents), expected, `${label} replay changed balance`);
  }

  const perDriver = [...driverCounts.values()];
  log(
    `${label}: PASS - ${pairs.length} unique holds, ${pairs.length} PAID, ` +
      `${pairs.length} posted credits of R4.50; drivers had ${perDriver.join(",")} rides`
  );
}

async function runRaces(): Promise<void> {
  const pairs = await seedPairs("race", 2);

  const hold = async (p: Pair): Promise<void> => {
    const h = await createRideHold({
      rideId: p.rideId,
      userId: p.riderId,
      amountRands: 5,
      email: p.riderEmail,
    });
    assert.equal(h.paymentStatus, "HOLD_ACTIVE");
    assert.ok(h.reference);
    p.reference = String(h.reference);
  };

  // Two completion paths capturing at once: exactly one Paystack call.
  const capPair = pairs[0];
  await hold(capPair);
  await recordRideCompletion(capPair.driverId, capPair.rideId, 5, "card");
  const capResults = await Promise.all([
    captureRideHold(capPair.rideId),
    captureRideHold(capPair.rideId),
  ]);
  assert.equal(capResults.filter((r) => r.captured).length, 1);
  assert.equal(capResults.filter((r) => r.alreadyProcessed).length, 1);
  const capState = await queryOne<{ payment_status: string }>(
    "SELECT payment_status FROM rides WHERE id = $1",
    [capPair.rideId]
  );
  assert.equal(capState?.payment_status, "CAPTURE_PENDING");
  await handlePreauthorizationEvent("preauthorization.capture.success", {
    data: {
      id: "race-cap-tx",
      reference: capPair.reference,
      captured_amount: 500,
      amount: 500,
      fee: 13,
      authorization: { authorization_code: "AUTH_RACE_CAP" },
    },
  });
  const capWallet = await queryOne<{ balance_cents: string }>(
    "SELECT balance_cents FROM driver_wallets WHERE driver_id = $1",
    [capPair.driverId]
  );
  assert.equal(Number(capWallet?.balance_cents), 450);

  // Two cancel taps releasing at once: exactly one Paystack call.
  const relPair = pairs[1];
  await hold(relPair);
  const relResults = await Promise.all([
    releaseRideHold(relPair.rideId, "race"),
    releaseRideHold(relPair.rideId, "race"),
  ]);
  assert.equal(relResults.filter((r) => r.released).length, 1);
  assert.equal(relResults.filter((r) => r.alreadyReleased).length, 1);
  const relState = await queryOne<{ payment_status: string }>(
    "SELECT payment_status FROM rides WHERE id = $1",
    [relPair.rideId]
  );
  assert.equal(relState?.payment_status, "RELEASED");
  const relLedger = await queryOne<{ id: string }>(
    "SELECT id FROM wallet_ledger WHERE ride_id = $1 LIMIT 1",
    [relPair.rideId]
  );
  assert.equal(relLedger, null);

  log("race checks: PASS - duplicate capture/release each made one external call");
}

async function main(): Promise<void> {
  log(`scratch DB ${HOST}:${PORT}/${DB}, PAYMENTS_MODE=${process.env.PAYMENTS_MODE || "mock"}`);
  await reset();

  const five = await seedPairs("five", 5);
  await runFlow(five, "five-by-five");

  const load = await seedPairs("load", 500);
  await runFlow(load, "five-drivers-500-riders");

  const totals = await query<{
    rides_paid: string;
    credits: string;
    total_cents: string;
    drivers: string;
  }>(
    `SELECT
       (SELECT COUNT(*) FROM rides WHERE payment_status = 'PAID')::text AS rides_paid,
       (SELECT COUNT(*) FROM wallet_ledger WHERE type = 'card_credit' AND status = 'posted')::text AS credits,
       (SELECT COALESCE(SUM(balance_cents), 0) FROM driver_wallets)::text AS total_cents,
       (SELECT COUNT(*) FROM driver_wallets WHERE balance_cents > 0)::text AS drivers`
  );
  const t = totals[0];
  assert.equal(Number(t.rides_paid), 505);
  assert.equal(Number(t.credits), 505);
  assert.equal(Number(t.total_cents), 505 * 450);
  assert.equal(Number(t.drivers), 10);

  log(
    `core totals PASS - rides=${t.rides_paid} postedCredits=${t.credits} ` +
      `driverBalanceTotal=R${(Number(t.total_cents) / 100).toFixed(2)} wallets=${t.drivers}`
  );

  await runRaces();
  log("ALL PASS");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[preauth-check] FAILED", err);
    process.exit(1);
  });
