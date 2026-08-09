import { Pool } from "pg";

let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    const ssl = process.env.NODE_ENV === "production" || process.env.DB_SSL === "true"
      ? { rejectUnauthorized: false }
      : false;

    pool = new Pool({
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT || "5432", 10),
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      ssl,
    });

    pool.on("error", (err) => {
      console.error("Unexpected PostgreSQL pool error:", err);
    });
  }
  return pool;
}

export async function query<T = any>(text: string, params?: any[]): Promise<T[]> {
  const result = await getPool().query(text, params);
  return result.rows as T[];
}

export async function queryOne<T = any>(text: string, params?: any[]): Promise<T | null> {
  const result = await getPool().query(text, params);
  return (result.rows[0] as T) ?? null;
}

export async function execute(text: string, params?: any[]) {
  const result = await getPool().query(text, params);
  return { rowCount: result.rowCount, rows: result.rows };
}

export async function testConnection(): Promise<boolean> {
  try {
    const p = getPool();
    const start = Date.now();
    await p.query("SELECT 1");
    console.log(`✓ PostgreSQL connected successfully (${Date.now() - start}ms)`);
    return true;
  } catch (err) {
    console.error("✗ PostgreSQL connection failed:", err);
    return false;
  }
}

export default getPool;