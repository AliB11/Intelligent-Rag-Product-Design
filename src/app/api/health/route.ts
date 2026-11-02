import { ensureSeeded } from "@/lib/db/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The generator remains ready without PostgreSQL; report persistence separately
 * so container/orchestrator health checks reflect application availability.
 */
export async function GET() {
  const corpus = await ensureSeeded();
  return Response.json({
    ok: true,
    persistence: corpus.persisted ? "available" : "unavailable",
    corpus: {
      documents: corpus.kb,
      benchmarks: corpus.benchmarks,
    },
  });
}
