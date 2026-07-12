import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config();

function getSslCa(): string | undefined {
  if (process.env.DB_SSL_CA_BASE64) {
    return Buffer.from(process.env.DB_SSL_CA_BASE64, "base64").toString("utf8");
  }

  return process.env.DB_SSL_CA_CERT?.replace(/\\n/g, "\n");
}

const useSsl =
  process.env.DB_SSL === "true" ||
  process.env.NODE_ENV === "production" ||
  process.env.DATABASE_URL?.includes("sslmode=require");

const sslCa = getSslCa();
const ssl = useSsl
  ? {
      rejectUnauthorized:
        process.env.NODE_ENV === "production"
          ? true
          : process.env.DB_SSL_REJECT_UNAUTHORIZED !== "false",
      ...(sslCa ? { ca: sslCa } : {}),
    }
  : false;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on("error", (err) => {
  console.error("PostgreSQL pool error:", err.message);
});

export async function query<T = any>(text: string, params?: any[]): Promise<T[]> {
  const result = await pool.query(text, params);
  return result.rows;
}

export async function queryOne<T = any>(text: string, params?: any[]): Promise<T | null> {
  const result = await pool.query(text, params);
  return result.rows[0] ?? null;
}

export default pool;
