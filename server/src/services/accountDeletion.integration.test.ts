// ─────────────────────────────────────────────────────────────────────────────
// ACCOUNT DELETION — REAL POSTGRES INTEGRATION SUITE.
//
// The mocked suite cannot prove this: whether the FK-safe delete ORDER is
// right. A driver with rides, ratings, payments, earnings, a payout and saved
// banking used to make `DELETE FROM users` fail with 23503 — a store-compliance
// blocker. This suite seeds exactly that graph and asserts every row is gone.
//
// GATING: skipped unless VURA_TEST_DB_PORT is set, e.g.
//   $env:VURA_TEST_DB_PORT='55432'; npx vitest run src/services/accountDeletion.integration.test.ts
// It creates tables and deletes rows, so the shared guard only accepts the
// local scratch database (127.0.0.1:55432/vura_test).
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";

import { query, execute } from "../config/database";
import { assertScratchDatabase, useScratchDatabaseEnv } from "./integrationGuard";
import { deleteAccountData } from "./accountDeletion";

const enabled = !!process.env.VURA_TEST_DB_PORT;

const TABLES = [
  "future_audit",
  "deletion_guard",
  "support_tickets",
  "notifications_log",
  "sos_alerts",
  "community_places",
  "vehicle_images",
  "driver_metrics",
  "driver_tiers",
  "admin_riders",
  "driver_blocks",
  "pay_later_ledger",
  "pay_later_accounts",
  "referrals",
  "affiliates",
  "driver_cells",
  "driver_preferences",
  "wallet_ledger",
  "driver_wallets",
  "device_tokens",
  "driver_documents",
  "emergency_contacts",
  "recent_searches",
  "ride_offers",
  "chat_messages",
  "ride_events",
  "face_verifications",
  "safety_events",
  "split_fares",
  "lost_item_reports",
  "disputes",
  "payments",
  "ratings",
  "saved_cards",
  "driver_banking",
  "driver_earnings_paid",
  "payouts",
  "driver_earnings",
  "driver_profiles",
  "rides",
  "users",
];

const SCHEMA = `
CREATE TABLE users (
  id UUID PRIMARY KEY,
  firebase_uid TEXT UNIQUE,
  full_name TEXT
);

CREATE TABLE rides (
  id UUID PRIMARY KEY,
  passenger_id UUID REFERENCES users(id),
  driver_id UUID,
  status TEXT
);

CREATE TABLE driver_profiles (user_id UUID PRIMARY KEY REFERENCES users(id));
CREATE TABLE driver_earnings (
  id UUID PRIMARY KEY,
  driver_id UUID NOT NULL REFERENCES users(id)
);
CREATE TABLE payouts (
  id UUID PRIMARY KEY,
  driver_id UUID NOT NULL REFERENCES users(id)
);
CREATE TABLE driver_earnings_paid (
  id UUID PRIMARY KEY,
  earning_id UUID NOT NULL REFERENCES driver_earnings(id),
  payout_id UUID REFERENCES payouts(id)
);
CREATE TABLE driver_banking (
  id UUID PRIMARY KEY,
  driver_id UUID NOT NULL UNIQUE REFERENCES users(id)
);
CREATE TABLE saved_cards (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id)
);
CREATE TABLE ratings (
  id UUID PRIMARY KEY,
  ride_id UUID NOT NULL REFERENCES rides(id),
  passenger_id UUID NOT NULL REFERENCES users(id),
  driver_id UUID NOT NULL REFERENCES users(id)
);
CREATE TABLE payments (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  ride_id UUID REFERENCES rides(id)
);
CREATE TABLE disputes (
  id UUID PRIMARY KEY,
  ride_id UUID REFERENCES rides(id),
  user_id UUID NOT NULL REFERENCES users(id)
);
CREATE TABLE lost_item_reports (
  id UUID PRIMARY KEY,
  ride_id UUID REFERENCES rides(id),
  user_id UUID NOT NULL REFERENCES users(id)
);
CREATE TABLE split_fares (
  id UUID PRIMARY KEY,
  ride_id UUID REFERENCES rides(id),
  inviter_id UUID NOT NULL REFERENCES users(id),
  invitee_id UUID REFERENCES users(id)
);
CREATE TABLE safety_events (
  id UUID PRIMARY KEY,
  ride_id UUID REFERENCES rides(id)
);
CREATE TABLE face_verifications (
  id UUID PRIMARY KEY,
  driver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ride_id UUID REFERENCES rides(id)
);
CREATE TABLE ride_events (
  id BIGSERIAL PRIMARY KEY,
  ride_id UUID,
  driver_id UUID
);
CREATE TABLE chat_messages (
  id UUID PRIMARY KEY,
  ride_id UUID,
  sender_id UUID
);
CREATE TABLE ride_offers (
  id UUID PRIMARY KEY,
  ride_id UUID NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  driver_id UUID NOT NULL REFERENCES users(id)
);
CREATE TABLE recent_searches (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id)
);
CREATE TABLE emergency_contacts (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id)
);
CREATE TABLE community_places (
  id UUID PRIMARY KEY,
  created_by UUID REFERENCES users(id)
);
CREATE TABLE sos_alerts (
  id UUID PRIMARY KEY,
  ride_id UUID REFERENCES rides(id) ON DELETE SET NULL,
  triggered_by UUID REFERENCES users(id)
);
CREATE TABLE notifications_log (
  id UUID PRIMARY KEY,
  user_id UUID
);
CREATE TABLE support_tickets (
  id UUID PRIMARY KEY,
  rider_id UUID REFERENCES users(id) ON DELETE SET NULL,
  driver_id UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE driver_documents (
  id UUID PRIMARY KEY,
  driver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE device_tokens (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE driver_wallets (
  driver_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE wallet_ledger (
  id UUID PRIMARY KEY,
  driver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ride_id UUID REFERENCES rides(id) ON DELETE SET NULL
);
CREATE TABLE driver_preferences (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE driver_cells (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE affiliates (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE referrals (
  id UUID PRIMARY KEY,
  affiliate_id UUID NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
  referred_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE pay_later_accounts (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE pay_later_ledger (
  id UUID PRIMARY KEY,
  rider_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ride_id UUID REFERENCES rides(id) ON DELETE SET NULL
);
CREATE TABLE driver_blocks (
  rider_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  driver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (rider_id, driver_id)
);
CREATE TABLE admin_riders (
  rider_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE driver_tiers (
  driver_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE driver_metrics (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE vehicle_images (
  id UUID PRIMARY KEY,
  driver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE
);

-- Simulates a table added by a LATER migration with a plain FK. The explicit
-- delete list cannot know about it; the pg_catalog sweep must remove it or the
-- final DELETE FROM users fails.
CREATE TABLE future_audit (
  id UUID PRIMARY KEY,
  actor_id UUID NOT NULL REFERENCES users(id)
);

-- Used by the rollback test: the sweep tries to delete this row and the
-- trigger aborts the transaction, proving nothing is half-deleted.
CREATE TABLE deletion_guard (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id)
);
CREATE FUNCTION block_deletion() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'deletion blocked for test';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER deletion_guard_block
  BEFORE DELETE ON deletion_guard
  FOR EACH ROW EXECUTE FUNCTION block_deletion();
`;

async function count(sql: string, params: any[] = []): Promise<number> {
  const [row] = await query<{ n: number }>(sql, params);
  return row.n;
}

describe.skipIf(!enabled)("deleteAccountData against real Postgres", () => {
  const driver = randomUUID();
  const rider = randomUUID();
  const other = randomUUID();
  const ride1 = randomUUID(); // rider + driver  → must go
  const ride2 = randomUUID(); // other + driver  → must go
  const ride3 = randomUUID(); // other only      → must stay
  const earningDriver = randomUUID();
  const earningOther = randomUUID();
  const payoutDriver = randomUUID();
  const payoutOther = randomUUID();
  const affiliateDriver = randomUUID();
  const placeDriver = randomUUID();
  const placeOther = randomUUID();
  const alertDriver = randomUUID();
  const alertOther = randomUUID();
  const ticketDriver = randomUUID();
  const ticketOther = randomUUID();
  const notifDriver = randomUUID();
  const notifOther = randomUUID();

  beforeAll(async () => {
    useScratchDatabaseEnv();
    assertScratchDatabase(
      process.env.DB_HOST!,
      process.env.DB_PORT!,
      process.env.DB_NAME!
    );

    await execute("DROP FUNCTION IF EXISTS block_deletion() CASCADE");
    for (const t of TABLES) {
      await execute(`DROP TABLE IF EXISTS ${t} CASCADE`);
    }
    await execute(SCHEMA);

    await execute(
      `INSERT INTO users (id, firebase_uid, full_name) VALUES
         ($1, 'uid-driver', 'Driver'),
         ($2, 'uid-rider', 'Rider'),
         ($3, 'uid-other', 'Other')`,
      [driver, rider, other]
    );
    await execute(
      `INSERT INTO rides (id, passenger_id, driver_id, status) VALUES
         ($1, $2, $3, 'completed'),
         ($4, $5, $3, 'completed'),
         ($6, $5, $5, 'completed')`,
      [ride1, rider, driver, ride2, other, ride3]
    );

    // Ride children.
    await execute(
      `INSERT INTO ratings (id, ride_id, passenger_id, driver_id) VALUES
         (gen_random_uuid(), $1, $2, $3),
         (gen_random_uuid(), $4, $5, $3),
         (gen_random_uuid(), $6, $5, $5)`,
      [ride1, rider, driver, ride2, other, ride3]
    );
    await execute(
      `INSERT INTO payments (id, user_id, ride_id) VALUES
         (gen_random_uuid(), $1, $2),
         (gen_random_uuid(), $3, $2),
         (gen_random_uuid(), $4, $5)`,
      [driver, ride1, rider, other, ride3]
    );
    await execute(
      `INSERT INTO disputes (id, ride_id, user_id) VALUES
         (gen_random_uuid(), $1, $2),
         (gen_random_uuid(), $3, $4)`,
      [ride1, rider, ride3, other]
    );
    await execute(
      `INSERT INTO lost_item_reports (id, ride_id, user_id) VALUES (gen_random_uuid(), $1, $2)`,
      [ride1, rider]
    );
    await execute(
      `INSERT INTO split_fares (id, ride_id, inviter_id, invitee_id) VALUES
         (gen_random_uuid(), $1, $2, $3),
         (gen_random_uuid(), $4, $5, $5)`,
      [ride1, driver, rider, ride3, other]
    );
    await execute(
      `INSERT INTO safety_events (id, ride_id) VALUES (gen_random_uuid(), $1), (gen_random_uuid(), $2)`,
      [ride1, ride3]
    );
    await execute(
      `INSERT INTO face_verifications (id, driver_id, ride_id) VALUES
         (gen_random_uuid(), $1, $2),
         (gen_random_uuid(), $3, $4)`,
      [driver, ride1, other, ride3]
    );
    await execute(
      `INSERT INTO ride_events (ride_id, driver_id) VALUES ($1, $2), ($3, $4)`,
      [ride1, driver, ride3, other]
    );
    await execute(
      `INSERT INTO chat_messages (id, ride_id, sender_id) VALUES
         (gen_random_uuid(), $1, $2),
         (gen_random_uuid(), $1, $3),
         (gen_random_uuid(), $4, $5)`,
      [ride1, rider, driver, ride3, other]
    );
    await execute(
      `INSERT INTO ride_offers (id, ride_id, driver_id) VALUES
         (gen_random_uuid(), $1, $2),
         (gen_random_uuid(), $3, $4)`,
      [ride1, driver, ride3, other]
    );

    // Money.
    await execute(
      `INSERT INTO driver_earnings (id, driver_id) VALUES ($1, $2), ($3, $4)`,
      [earningDriver, driver, earningOther, other]
    );
    await execute(
      `INSERT INTO payouts (id, driver_id) VALUES ($1, $2), ($3, $4)`,
      [payoutDriver, driver, payoutOther, other]
    );
    await execute(
      `INSERT INTO driver_earnings_paid (id, earning_id, payout_id) VALUES
         (gen_random_uuid(), $1, $2),
         (gen_random_uuid(), $3, $4)`,
      [earningDriver, payoutDriver, earningOther, payoutOther]
    );
    await execute(
      `INSERT INTO driver_banking (id, driver_id) VALUES (gen_random_uuid(), $1), (gen_random_uuid(), $2)`,
      [driver, other]
    );
    await execute(
      `INSERT INTO saved_cards (id, user_id) VALUES (gen_random_uuid(), $1), (gen_random_uuid(), $2)`,
      [driver, other]
    );

    // Profile / device.
    await execute(`INSERT INTO driver_profiles (user_id) VALUES ($1), ($2)`, [driver, other]);
    await execute(`INSERT INTO recent_searches (id, user_id) VALUES (gen_random_uuid(), $1), (gen_random_uuid(), $2)`, [driver, other]);
    await execute(`INSERT INTO emergency_contacts (id, user_id) VALUES (gen_random_uuid(), $1), (gen_random_uuid(), $2)`, [driver, other]);

    // Shared records that must survive, unlinked.
    await execute(
      `INSERT INTO community_places (id, created_by) VALUES ($1, $2), ($3, $4)`,
      [placeDriver, driver, placeOther, other]
    );
    await execute(
      `INSERT INTO sos_alerts (id, ride_id, triggered_by) VALUES ($1, $2, $3), ($4, $5, $6)`,
      [alertDriver, ride1, driver, alertOther, ride3, other]
    );
    await execute(
      `INSERT INTO notifications_log (id, user_id) VALUES ($1, $2), ($3, $4)`,
      [notifDriver, driver, notifOther, other]
    );
    await execute(
      `INSERT INTO support_tickets (id, driver_id) VALUES ($1, $2), ($3, $4)`,
      [ticketDriver, driver, ticketOther, other]
    );

    // Cascading tables.
    await execute(`INSERT INTO driver_documents (id, driver_id) VALUES (gen_random_uuid(), $1)`, [driver]);
    await execute(`INSERT INTO device_tokens (id, user_id) VALUES (gen_random_uuid(), $1)`, [driver]);
    await execute(`INSERT INTO driver_wallets (driver_id) VALUES ($1)`, [driver]);
    await execute(`INSERT INTO wallet_ledger (id, driver_id, ride_id) VALUES (gen_random_uuid(), $1, $2)`, [driver, ride1]);
    await execute(`INSERT INTO driver_preferences (user_id) VALUES ($1)`, [driver]);
    await execute(`INSERT INTO driver_cells (user_id) VALUES ($1)`, [driver]);
    await execute(`INSERT INTO affiliates (id, user_id) VALUES ($1, $2)`, [affiliateDriver, driver]);
    await execute(`INSERT INTO referrals (id, affiliate_id, referred_user_id) VALUES (gen_random_uuid(), $1, $2)`, [affiliateDriver, other]);
    await execute(`INSERT INTO pay_later_accounts (user_id) VALUES ($1)`, [driver]);
    await execute(`INSERT INTO pay_later_ledger (id, rider_id, ride_id) VALUES (gen_random_uuid(), $1, $2)`, [driver, ride1]);
    await execute(`INSERT INTO driver_blocks (rider_id, driver_id) VALUES ($1, $2)`, [rider, driver]);
    await execute(`INSERT INTO admin_riders (rider_id) VALUES ($1)`, [driver]);
    await execute(`INSERT INTO driver_tiers (driver_id) VALUES ($1)`, [driver]);
    await execute(`INSERT INTO driver_metrics (user_id) VALUES ($1)`, [driver]);
    await execute(`INSERT INTO vehicle_images (id, driver_id) VALUES (gen_random_uuid(), $1)`, [driver]);

    // Unknown-future-table rows.
    await execute(`INSERT INTO future_audit (id, actor_id) VALUES (gen_random_uuid(), $1), (gen_random_uuid(), $2)`, [driver, other]);
  });

  afterAll(async () => {
    if (!enabled) return;
    for (const t of TABLES) {
      await execute(`DROP TABLE IF EXISTS ${t} CASCADE`);
    }
    await execute("DROP FUNCTION IF EXISTS block_deletion() CASCADE");
  });

  it("deletes the driver's whole graph and keeps the other party's data", async () => {
    await deleteAccountData(driver);

    expect(await count("SELECT COUNT(*)::int AS n FROM users WHERE id = $1", [driver])).toBe(0);
    expect(await count("SELECT COUNT(*)::int AS n FROM users WHERE id IN ($1, $2)", [rider, other])).toBe(2);

    // Trips: the driver's two rides are gone; the unrelated ride survives.
    expect(await count("SELECT COUNT(*)::int AS n FROM rides WHERE id IN ($1, $2)", [ride1, ride2])).toBe(0);
    expect(await count("SELECT COUNT(*)::int AS n FROM rides WHERE id = $1", [ride3])).toBe(1);

    // Ride children: only the unrelated ride's rows remain.
    expect(await count("SELECT COUNT(*)::int AS n FROM ratings")).toBe(1);
    expect(await count("SELECT COUNT(*)::int AS n FROM ratings WHERE ride_id = $1", [ride3])).toBe(1);
    expect(await count("SELECT COUNT(*)::int AS n FROM payments")).toBe(1);
    expect(await count("SELECT COUNT(*)::int AS n FROM payments WHERE ride_id = $1", [ride3])).toBe(1);
    expect(await count("SELECT COUNT(*)::int AS n FROM disputes")).toBe(1);
    expect(await count("SELECT COUNT(*)::int AS n FROM disputes WHERE ride_id = $1", [ride3])).toBe(1);
    expect(await count("SELECT COUNT(*)::int AS n FROM lost_item_reports")).toBe(0);
    expect(await count("SELECT COUNT(*)::int AS n FROM split_fares")).toBe(1);
    expect(await count("SELECT COUNT(*)::int AS n FROM split_fares WHERE ride_id = $1", [ride3])).toBe(1);
    expect(await count("SELECT COUNT(*)::int AS n FROM safety_events")).toBe(1);
    expect(await count("SELECT COUNT(*)::int AS n FROM safety_events WHERE ride_id = $1", [ride3])).toBe(1);
    expect(await count("SELECT COUNT(*)::int AS n FROM face_verifications")).toBe(1);
    expect(await count("SELECT COUNT(*)::int AS n FROM face_verifications WHERE driver_id = $1", [other])).toBe(1);
    expect(await count("SELECT COUNT(*)::int AS n FROM ride_events")).toBe(1);
    expect(await count("SELECT COUNT(*)::int AS n FROM ride_events WHERE ride_id = $1", [ride3])).toBe(1);
    expect(await count("SELECT COUNT(*)::int AS n FROM chat_messages")).toBe(1);
    expect(await count("SELECT COUNT(*)::int AS n FROM chat_messages WHERE ride_id = $1", [ride3])).toBe(1);
    expect(await count("SELECT COUNT(*)::int AS n FROM ride_offers")).toBe(1);
    expect(await count("SELECT COUNT(*)::int AS n FROM ride_offers WHERE driver_id = $1", [other])).toBe(1);

    // Money: the driver's earnings/payout/banking/cards are gone, the other
    // driver's are untouched. driver_earnings_paid is the join that used to
    // make the order matter.
    expect(await count("SELECT COUNT(*)::int AS n FROM driver_earnings")).toBe(1);
    expect(await count("SELECT COUNT(*)::int AS n FROM driver_earnings WHERE driver_id = $1", [other])).toBe(1);
    expect(await count("SELECT COUNT(*)::int AS n FROM payouts")).toBe(1);
    expect(await count("SELECT COUNT(*)::int AS n FROM payouts WHERE driver_id = $1", [other])).toBe(1);
    expect(await count("SELECT COUNT(*)::int AS n FROM driver_earnings_paid")).toBe(1);
    expect(await count("SELECT COUNT(*)::int AS n FROM driver_earnings_paid WHERE earning_id = $1", [earningOther])).toBe(1);
    expect(await count("SELECT COUNT(*)::int AS n FROM driver_banking")).toBe(1);
    expect(await count("SELECT COUNT(*)::int AS n FROM driver_banking WHERE driver_id = $1", [other])).toBe(1);
    expect(await count("SELECT COUNT(*)::int AS n FROM saved_cards")).toBe(1);
    expect(await count("SELECT COUNT(*)::int AS n FROM saved_cards WHERE user_id = $1", [other])).toBe(1);

    // Profile / device.
    expect(await count("SELECT COUNT(*)::int AS n FROM driver_profiles")).toBe(1);
    expect(await count("SELECT COUNT(*)::int AS n FROM recent_searches")).toBe(1);
    expect(await count("SELECT COUNT(*)::int AS n FROM emergency_contacts")).toBe(1);

    // Shared records survive but are unlinked from the deleted person.
    expect(await count("SELECT COUNT(*)::int AS n FROM community_places")).toBe(2);
    expect(await count("SELECT COUNT(*)::int AS n FROM community_places WHERE id = $1 AND created_by IS NULL", [placeDriver])).toBe(1);
    expect(await count("SELECT COUNT(*)::int AS n FROM community_places WHERE id = $1 AND created_by = $2", [placeOther, other])).toBe(1);

    expect(await count("SELECT COUNT(*)::int AS n FROM sos_alerts")).toBe(2);
    expect(await count("SELECT COUNT(*)::int AS n FROM sos_alerts WHERE id = $1 AND triggered_by IS NULL AND ride_id IS NULL", [alertDriver])).toBe(1);
    expect(await count("SELECT COUNT(*)::int AS n FROM sos_alerts WHERE id = $1 AND triggered_by = $2 AND ride_id = $3", [alertOther, other, ride3])).toBe(1);

    expect(await count("SELECT COUNT(*)::int AS n FROM notifications_log")).toBe(2);
    expect(await count("SELECT COUNT(*)::int AS n FROM notifications_log WHERE id = $1 AND user_id IS NULL", [notifDriver])).toBe(1);
    expect(await count("SELECT COUNT(*)::int AS n FROM notifications_log WHERE id = $1 AND user_id = $2", [notifOther, other])).toBe(1);

    expect(await count("SELECT COUNT(*)::int AS n FROM support_tickets")).toBe(2);
    expect(await count("SELECT COUNT(*)::int AS n FROM support_tickets WHERE id = $1 AND driver_id IS NULL", [ticketDriver])).toBe(1);
    expect(await count("SELECT COUNT(*)::int AS n FROM support_tickets WHERE id = $1 AND driver_id = $2", [ticketOther, other])).toBe(1);

    // Cascading tables.
    for (const table of [
      "driver_documents",
      "device_tokens",
      "driver_wallets",
      "wallet_ledger",
      "driver_preferences",
      "driver_cells",
      "affiliates",
      "pay_later_accounts",
      "pay_later_ledger",
      "driver_tiers",
      "driver_metrics",
      "vehicle_images",
    ]) {
      expect(await count(`SELECT COUNT(*)::int AS n FROM ${table}`)).toBe(0);
    }
    expect(await count("SELECT COUNT(*)::int AS n FROM referrals")).toBe(0);
    expect(await count("SELECT COUNT(*)::int AS n FROM driver_blocks")).toBe(0);
    expect(await count("SELECT COUNT(*)::int AS n FROM admin_riders")).toBe(0);

    // The sweep found a table this service never names.
    expect(await count("SELECT COUNT(*)::int AS n FROM future_audit")).toBe(1);
    expect(await count("SELECT COUNT(*)::int AS n FROM future_audit WHERE actor_id = $1", [other])).toBe(1);
  });

  it("is idempotent — a second call is a no-op, not an error", async () => {
    await expect(deleteAccountData(driver)).resolves.toBeUndefined();
  });

  it("tolerates tables that do not exist on an older deployment", async () => {
    await execute("DROP TABLE IF EXISTS lost_item_reports CASCADE");
    await execute("DROP TABLE IF EXISTS driver_earnings_paid CASCADE");
    await execute("DROP TABLE IF EXISTS community_places CASCADE");

    const late = randomUUID();
    const lateRide = randomUUID();
    await execute(`INSERT INTO users (id, firebase_uid, full_name) VALUES ($1, 'uid-late', 'Late')`, [late]);
    await execute(`INSERT INTO rides (id, passenger_id, driver_id) VALUES ($1, $2, $2)`, [lateRide, late]);

    await expect(deleteAccountData(late)).resolves.toBeUndefined();
    expect(await count("SELECT COUNT(*)::int AS n FROM users WHERE id = $1", [late])).toBe(0);
    expect(await count("SELECT COUNT(*)::int AS n FROM rides WHERE id = $1", [lateRide])).toBe(0);
  });

  it("rolls the whole deletion back when a real error occurs", async () => {
    const guarded = randomUUID();
    const guardedRide = randomUUID();
    await execute(`INSERT INTO users (id, firebase_uid, full_name) VALUES ($1, 'uid-guarded', 'Guarded')`, [guarded]);
    await execute(`INSERT INTO rides (id, passenger_id, driver_id) VALUES ($1, $2, $2)`, [guardedRide, guarded]);
    await execute(`INSERT INTO deletion_guard (id, user_id) VALUES (gen_random_uuid(), $1)`, [guarded]);

    // The sweep reaches deletion_guard late; its trigger aborts the transaction.
    await expect(deleteAccountData(guarded)).rejects.toThrow(/deletion blocked/);

    // Nothing was half-deleted: the earlier ride delete was rolled back too.
    expect(await count("SELECT COUNT(*)::int AS n FROM users WHERE id = $1", [guarded])).toBe(1);
    expect(await count("SELECT COUNT(*)::int AS n FROM rides WHERE id = $1", [guardedRide])).toBe(1);
    expect(await count("SELECT COUNT(*)::int AS n FROM deletion_guard WHERE user_id = $1", [guarded])).toBe(1);

    // Clear the guard and the same call now succeeds end to end. The trigger
    // blocks any delete, so disable it just for this cleanup.
    await execute("ALTER TABLE deletion_guard DISABLE TRIGGER deletion_guard_block");
    await execute("DELETE FROM deletion_guard WHERE user_id = $1", [guarded]);
    await execute("ALTER TABLE deletion_guard ENABLE TRIGGER deletion_guard_block");
    await expect(deleteAccountData(guarded)).resolves.toBeUndefined();
    expect(await count("SELECT COUNT(*)::int AS n FROM users WHERE id = $1", [guarded])).toBe(0);
  });
});
