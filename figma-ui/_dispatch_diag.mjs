// READ-ONLY dispatch diagnostic against the LIVE RDS (creds from deploy/production.env).
// Answers ONE question: why the driver is not receiving a waiting ride —
// online flag? status? coordinates? location freshness? same-account
// self-exclusion? tier fit? offers table? Never writes anything.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "../server/node_modules/pg/lib/index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = {};
for (const line of readFileSync(join(root, "deploy", "production.env"), "utf8").split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)=(.*)$/.exec(line);
  if (m) env[m[1]] = m[2].trim();
}

const pool = new pg.Pool({
  host: env.DB_HOST,
  port: Number(env.DB_PORT || 5432),
  database: env.DB_NAME,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 8000,
  statement_timeout: 15000,
});

const q = async (label, sql, params = []) => {
  try {
    const { rows } = await pool.query(sql, params);
    console.log(`\n=== ${label} (${rows.length}) ===`);
    if (rows.length === 0) { console.log("  (none)"); return []; }
    console.table(rows);
    return rows;
  } catch (e) {
    console.log(`\n=== ${label} === FAILED: ${e.message}`);
    return [];
  }
};

try {
  await pool.query("SELECT 1");
  console.log("Connected to", env.DB_HOST);
} catch (e) {
  console.log("DB unreachable from here:", e.message);
  process.exit(0);
}

// 1 — every driver profile: online? available? coords? how fresh?
await q("driver_profiles (dispatch visibility)", `
  SELECT dp.user_id,
         u.role,
         dp.is_online,
         COALESCE(dp.status,'?') AS status,
         dp.lifecycle_status,
         dp.current_lat, dp.current_lng,
         ROUND(EXTRACT(EPOCH FROM (NOW() - GREATEST(dp.last_location_at, dp.last_heartbeat_at)))::numeric,1) AS loc_age_s
    FROM driver_profiles dp JOIN users u ON u.id = dp.user_id
   ORDER BY dp.updated_at DESC LIMIT 10`);

// 2 — is the H3 index populated at all (flag-on path reads ONLY this)?
await q("driver_cells (H3 index)", `
  SELECT COUNT(*) AS cells, COUNT(DISTINCT user_id) AS drivers,
         MAX(last_seen_at) AS newest_ping
    FROM driver_cells`);

// 3 — recent rides: still waiting? parked? who is the passenger?
await q("rides (last 3h)", `
  SELECT id, status, passenger_id, driver_id,
         payment_method, tier, offer_round,
         ROUND(pickup_lat::numeric,5) AS pickup_lat, ROUND(pickup_lng::numeric,5) AS pickup_lng,
         ROUND(EXTRACT(EPOCH FROM (NOW() - created_at))::numeric) AS age_s,
         no_drivers_at IS NOT NULL AS was_parked
    FROM rides WHERE created_at > NOW() - INTERVAL '3 hours'
   ORDER BY created_at DESC LIMIT 10`);

// 4 — offers: did ANY round ever fire for those rides?
await q("ride_offers (last 3h)", `
  SELECT ro.ride_id, ro.driver_id, ro.status, ro.created_at, ro.expires_at
    FROM ride_offers ro JOIN rides r ON r.id = ro.ride_id
   WHERE r.created_at > NOW() - INTERVAL '3 hours'
   ORDER BY ro.created_at DESC LIMIT 15`);

// 5 — matching config: radius ladder + H3 flag
await q("app_config matching", `
  SELECT key, value::text AS value FROM app_config WHERE key = 'matching'`);

// 6 — the booked tier vs the driver's eligible categories (class-fit filter)
await q("driver vehicles + eligible categories", `
  SELECT ds.user_id, ds.vehicle_make, ds.vehicle_model, ds.eligible_categories
    FROM driver_survey ds LIMIT 5`).catch(() => null);
await q("car_scans / vehicles", `
  SELECT table_name FROM information_schema.tables
   WHERE table_schema='public' AND (table_name ILIKE '%vehicle%' OR table_name ILIKE '%car%')`);

await pool.end();
