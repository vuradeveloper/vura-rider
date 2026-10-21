// One-off: check (and with --apply, create) the DB objects the ported face-scan
// and vehicle-tier code needs. ADDITIVE ONLY - it never drops a table or a column.
//   node _face_tier_migrate.mjs          -> report only (read-only)
//   node _face_tier_migrate.mjs --apply  -> apply the additive DDL
import 'dotenv/config';
import pg from 'pg';

const APPLY = process.argv.includes('--apply');
const pool = new pg.Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
});

const say = (...a) => console.log(...a);

async function main() {
  const who = await pool.query('SELECT current_database() AS db, current_user AS usr, version() AS v');
  say('connected to:', who.rows[0].db, '| user:', who.rows[0].usr);
  say('server:', String(who.rows[0].v).split(',')[0]);

  const ext = await pool.query('SELECT extname FROM pg_extension ORDER BY 1');
  say('extensions:', ext.rows.map((r) => r.extname).join(', '));

  const t = await pool.query("SELECT to_regclass('public.face_verifications') AS fv, to_regclass('public.driver_profiles') AS dp, to_regclass('public.driver_documents') AS dd, to_regclass('public.users') AS u, to_regclass('public.rides') AS r");
  say('');
  say('tables:', JSON.stringify(t.rows[0]));
  say('face_verifications exists :', t.rows[0].fv ? 'YES' : 'NO');

  const cols = await pool.query(
    "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'driver_profiles' AND column_name LIKE 'vehicle%' ORDER BY column_name"
  );
  say('');
  say('driver_profiles vehicle* columns currently present:');
  for (const c of cols.rows) say('   ', c.column_name, '|', c.data_type);

  const need = ['vehicle_body_type', 'vehicle_fuel_type', 'vehicle_doors', 'vehicle_seats', 'vehicle_derivative', 'vehicle_tier', 'vehicle_tiers'];
  const have = cols.rows.map((c) => c.column_name);
  const missing = need.filter((n) => !have.includes(n));
  say('missing columns:', missing.length ? missing.join(', ') : '(none)');

  const con = await pool.query(
    "SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = 'driver_documents'::regclass AND contype = 'c'"
  );
  say('');
  say('driver_documents CHECK constraints:');
  for (const c of con.rows) say('   ', c.conname, '=>', c.def);
  const docCon = con.rows.find((c) => /doc_type/i.test(c.def));
  if (docCon) {
    say('   needs face_scan    :', /face_scan/.test(docCon.def) ? 'already there' : 'MISSING');
    say('   needs profile_photo:', /profile_photo/.test(docCon.def) ? 'already there' : 'MISSING');
  }

  const n = await pool.query('SELECT count(*)::int AS c FROM driver_documents');
  say('');
  say('driver_documents rows:', n.rows[0].c);

  if (!APPLY) {
    say('');
    say('REPORT ONLY. Re-run with --apply to create what is missing.');
    await pool.end();
    return;
  }

  // ── additive DDL ─────────────────────────────────────────────────────────
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS face_verifications (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        driver_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        ride_id          UUID REFERENCES rides(id),
        score            DOUBLE PRECISION,
        hamming_distance INTEGER,
        verified         BOOLEAN NOT NULL DEFAULT FALSE,
        method           VARCHAR(40) NOT NULL DEFAULT 'phash',
        status           VARCHAR(30) NOT NULL DEFAULT 'attempted',
        note             TEXT,
        created_at       TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_face_verifications_driver ON face_verifications(driver_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_face_verifications_created ON face_verifications(created_at DESC)');
    say('face_verifications: ensured');

    const adds = [
      ['vehicle_body_type', 'VARCHAR(30)'],
      ['vehicle_fuel_type', 'VARCHAR(20)'],
      ['vehicle_doors', 'INTEGER'],
      ['vehicle_seats', 'INTEGER'],
      ['vehicle_derivative', 'VARCHAR(100)'],
      ['vehicle_tier', 'VARCHAR(20)'],
      ['vehicle_tiers', "JSONB DEFAULT '[]'::jsonb"],
    ];
    for (const [col, type] of adds) {
      await client.query('ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS ' + col + ' ' + type);
      say('driver_profiles.' + col + ': ensured');
    }

    // widen the doc_type CHECK so face_scan / profile_photo can be stored
    const cur = await client.query(
      "SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = 'driver_documents'::regclass AND contype = 'c'"
    );
    const dc = cur.rows.find((c) => /doc_type/i.test(c.def));
    if (dc && (!/face_scan/.test(dc.def) || !/profile_photo/.test(dc.def))) {
      // the definition can be either `IN ('a','b')` or `= ANY (ARRAY['a','b'])`,
      // so take the quoted literals out of it instead of guessing the syntax
      const quoted = [...dc.def.matchAll(/'([^']*)'/g)].map((m) => m[1]);
      if (quoted.length === 0) throw new Error('could not read the doc_type values from: ' + dc.def);
      const values = [...new Set(quoted)];
      for (const extra of ['profile_photo', 'face_scan']) {
        if (!values.includes(extra)) values.push(extra);
      }
      const newDef = 'CHECK (doc_type IN (' + values.map((v) => "'" + v + "'").join(', ') + '))';
      await client.query('ALTER TABLE driver_documents DROP CONSTRAINT ' + dc.conname);
      await client.query('ALTER TABLE driver_documents ADD CONSTRAINT ' + dc.conname + ' ' + newDef);
      say('driver_documents.' + dc.conname + ': widened -> ' + newDef);
    } else {
      say('driver_documents doc_type constraint: already accepts face_scan/profile_photo');
    }

    await client.query('COMMIT');
    say('');
    say('MIGRATION APPLIED (additive only - nothing dropped, no rows touched).');
  } catch (e) {
    await client.query('ROLLBACK');
    say('ROLLED BACK:', e.message);
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
