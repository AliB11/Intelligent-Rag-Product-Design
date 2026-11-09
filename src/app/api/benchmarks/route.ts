import { BENCHMARK_SCHEMES, searchBenchmarks } from "@/lib/rag/benchmarks";
import { KB_DOCUMENTS, retrieveKnowledge } from "@/lib/rag/knowledgeBase";
import { ensureSeeded, kbSearch } from "@/lib/db/repository";
import { REGULATORY, STATUTORY_RESERVE } from "@/lib/domain/constants";
import { benchmarksQuerySchema, formatZodIssues } from "@/lib/validation/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/benchmarks?q=...&source=db|memory
 * Iranian banking benchmark registry + CBI regulatory knowledge base.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = benchmarksQuerySchema.safeParse({
    ...(url.searchParams.get("q") !== null ? { q: url.searchParams.get("q") ?? undefined } : {}),
    ...(url.searchParams.get("source") !== null ? { source: url.searchParams.get("source") ?? undefined } : {}),
  });
  if (!parsed.success) {
    return Response.json({ error: formatZodIssues(parsed.error) }, { status: 400 });
  }
  const q = parsed.data.q ?? "";
  const source = parsed.data.source ?? "memory";

  const corpus = await ensureSeeded();

  const schemes = q ? searchBenchmarks(q, 24) : BENCHMARK_SCHEMES;
  const documents = q ? retrieveKnowledge(q, 10) : KB_DOCUMENTS.slice(0, 12);
  const persisted = source === "db" && corpus.persisted
    ? await kbSearch(q || "قرض‌الحسنه میانگین حساب", 10)
    : [];

  return Response.json({
    benchmarks: schemes,
    knowledge: documents,
    persistedKnowledge: persisted,
    persistence: corpus.persisted ? "available" : "unavailable",
    regulatory: {
      ...REGULATORY,
      statutoryReserve: STATUTORY_RESERVE,
    },
    totals: {
      benchmarks: BENCHMARK_SCHEMES.length,
      kbDocuments: KB_DOCUMENTS.length,
    },
  });
}
