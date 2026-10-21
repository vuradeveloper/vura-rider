// ─────────────────────────────────────────────────────────────────────────────
// Proves the `waypoints` fix works against the REAL database — safely.
//
//   1. Runs the same idempotent migration the server now runs
//      (ALTER TABLE rides ADD COLUMN IF NOT EXISTS waypoints JSONB).
//   2. Replays the EXACT INSERT the patched socket handler performs, with the
//      same 11 parameters, inside a transaction.
//   3. Reads the row back and asserts the stops survived the round-trip.
//   4. ROLLBACKS — nothing is persisted, no driver receives a ride request.
//
// Usage:  node _wp_verify.mjs
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import pg from "pg";

// Mirrors src/config/database.ts — the project uses discrete DB_* vars, not a URL.
const { DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD, DB_SSL } = process.env;
if (!DB_HOST || !DB_NAME || !DB_USER) {
  console.error("FAIL: DB_HOST/DB_NAME/DB_USER missing from server/.env");
  process.exit(1);
}

const stops = [
  { address: "Rosebank Mall, Johannesburg", lat: -26.1459, lng: 28.0421 },
  { address: "Melrose Arch, Johannesburg", lat: -26.1333, lng: 28.0672 },
];

const client = new pg.Client({
  host: DB_HOST,
  port: parseInt(DB_PORT || "5432", 10),
  database: DB_NAME,
  user: DB_USER,
  password: DB_PASSWORD,
  ssl: DB_SSL === "true" ? { rejectUnauthorized: false } : undefined,
});

try {
  await client.connect();
  const { rows: who } = await client.query("SELECT current_database() AS db");
  console.log("connected to database:", who[0].db, "on", DB_HOST);

  // 1 — the migration (idempotent; no-op if the column already exists)
  await client.query(`ALTER TABLE rides ADD COLUMN IF NOT EXISTS waypoints JSONB`).catch((e) => {
    console.error("MIGRATION FAILED:", e.code, e.message);
    throw e;
  });
  const { rows: col } = await client.query(
    `SELECT data_type FROM information_schema.columns WHERE table_name = 'rides' AND column_name = 'waypoints'`
  );
  console.log("column rides.waypoints:", col[0]?.data_type || "MISSING");

  // Any existing user satisfies the FK; on an empty dev database we create one
  // INSIDE the transaction so it disappears with the rollback.
  let passengerId = (await client.query("SELECT id FROM users LIMIT 1")).rows[0]?.id;
  await client.query("BEGIN");
  if (!passengerId) {
    const made = await client.query(
      `INSERT INTO users (firebase_uid, email, full_name, role)
       VALUES ($1, $2, $3, 'passenger') RETURNING id`,
      ["wp-verify-" + Date.now(), "wp-verify@example.com", "WP Verify"]
    );
    passengerId = made.rows[0].id;
    console.log("created a temp user inside the transaction to satisfy the FK");
  }

  // 2 — the patched INSERT, byte-for-byte the same SQL + parameter order
  const { rows: ins } = await client.query(
    `INSERT INTO rides (passenger_id, pickup_address, pickup_lat, pickup_lng, destination_address, destination_lat, destination_lng, status, estimated_fare, payment_method, device_id, waypoints)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'searching', $8, $9, $10, $11)
     RETURNING id, waypoints`,
    [passengerId, "WP Verify Pickup, Sandton", -26.1076, 28.0567, "WP Verify Dropoff, Midrand", -26.0, 28.13, 42.5, "cash", "wp-verify-" + Date.now(), JSON.stringify(stops)]
  );
  const wrote = ins[0].waypoints;
  console.log("INSERT returned waypoints:", JSON.stringify(wrote));

  // 3 — read it back through the same SELECT shape the API uses (SELECT r.*)
  const { rows: back } = await client.query("SELECT r.* FROM rides r WHERE r.id = $1", [ins[0].id]);
  const got = back[0].waypoints;
  const ok = Array.isArray(got) && got.length === 2 && Math.abs(got[0].lat - stops[0].lat) < 1e-9;
  console.log("SELECT r.* returned:", JSON.stringify(got));

  // 4 — undo
  await client.query("ROLLBACK");

  const { rows: after } = await client.query("SELECT COUNT(*)::int AS n FROM rides WHERE device_id LIKE 'wp-verify-%'");
  console.log("rows persisted after rollback:", after[0].n);
  console.log(ok ? "PASS: stops survive the booking round-trip" : "FAIL: stops lost");
  process.exit(ok && after[0].n === 0 ? 0 : 1);
} catch (e) {
  console.error("ERROR:", e.code || "", e.message);
  try { await client.query("ROLLBACK"); } catch {}
  process.exit(1);
} finally {
  await client.end().catch(() => {});
}
