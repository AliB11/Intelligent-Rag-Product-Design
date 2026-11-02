import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

// Keep the in-memory product experience usable when persistence is not configured.
// Database-facing repository calls fail closed and fall back to local sample data.
const databaseUrl =
  process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:5432/app_db";

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
};

export const pool =
  globalForDb.__arenaNextJsPostgresqlPool ??
  new Pool({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 2_500,
    idleTimeoutMillis: 30_000,
    max: 10,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__arenaNextJsPostgresqlPool = pool;
}

export const db = drizzle(pool);
