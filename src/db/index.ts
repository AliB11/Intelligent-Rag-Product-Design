import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

type DbInstance = ReturnType<typeof drizzle>;

const databaseUrl = process.env.DATABASE_URL;

let cached: { pool: Pool; db: DbInstance } | null = null;

function resolveDb(): { pool: Pool; db: DbInstance } {
  if (cached) return cached;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }
  const pool = new Pool({ connectionString: databaseUrl });

  const globalForDb = globalThis as typeof globalThis & {
    __arenaNextJsPostgresqlPool?: Pool;
  };
  if (!globalForDb.__arenaNextJsPostgresqlPool) {
    globalForDb.__arenaNextJsPostgresqlPool = pool;
  } else {
    pool.end(); // avoid leaking a duplicate pool in long-running dev processes
  }

  cached = { pool, db: drizzle(pool) };
  return cached;
}

/**
 * Lazily-initialised Drizzle client + pool.
 *
 * The connection is established on first use, not at module import time. This keeps
 * `next build` and type-checking hermetic (no DATABASE_URL required to compile route
 * modules) while still failing fast with a clear error at request time when the
 * database is genuinely unavailable.
 */
export const db = new Proxy({} as DbInstance, {
  get(_target, prop: keyof DbInstance) {
    return resolveDb().db[prop];
  },
});

export const pool = new Proxy({} as Pool, {
  get(_target, prop: keyof Pool) {
    return resolveDb().pool[prop];
  },
});
