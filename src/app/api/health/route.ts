import { db } from "@/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  const started = Date.now();
  let dbOk = false;
  try {
    await db.execute(sql`select 1`);
    dbOk = true;
  } catch {
    /* database unavailable — report degraded but stay up */
  }
  return Response.json(
    { ok: dbOk, db: dbOk, dbLatencyMs: Date.now() - started },
    { status: dbOk ? 200 : 500 },
  );
}
