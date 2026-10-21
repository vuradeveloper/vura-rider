import 'dotenv/config';
import pg from 'pg';

const pool = new pg.Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
});

const cols = await pool.query(
  "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'driver_documents' ORDER BY ordinal_position"
);
console.log('driver_documents columns:');
for (const c of cols.rows) console.log('  ', c.column_name, '|', c.data_type);

const fk = await pool.query(
  "SELECT kcu.column_name, ccu.table_name AS ref_table, ccu.column_name AS ref_col FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name = 'driver_documents'"
);
console.log('driver_documents FKs:');
for (const r of fk.rows) console.log('  ', r.column_name, '->', r.ref_table + '.' + r.ref_col);

const fv = await pool.query(
  "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'face_verifications' ORDER BY ordinal_position"
);
console.log('face_verifications columns (what the migration created):');
for (const c of fv.rows) console.log('  ', c.column_name, '|', c.data_type);

const u = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'users' AND column_name IN ('id','firebase_uid')");
console.log('users id columns:', u.rows.map((r) => r.column_name).join(', '));

await pool.end();
