import { runPipeline } from "@/lib/agents/graph";
import { buildProductDossier } from "@/lib/dossier/productDossier";
import type { IntentOverrides } from "@/lib/domain/intentParser";
import { ensureSeeded, saveRun } from "@/lib/db/repository";
import {
  formatZodIssues,
  generateRequestSchema,
} from "@/lib/validation/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function badRequest(error: string) {
  return Response.json({ error }, { status: 400 });
}

/** Dossier build is strict; a failure degrades to null, never to a 500. */
function safeDossier(state: Parameters<typeof buildProductDossier>[0]) {
  try {
    return buildProductDossier(state);
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return badRequest("Request body must be valid JSON");
  }

  const parsed = generateRequestSchema.safeParse(payload);
  if (!parsed.success) {
    const error = formatZodIssues(parsed.error);
    // formatZodIssues prefixes the issue path ("prompt: …"), so match on the
    // substring — a strict === never fires for either missing or empty input.
    if (error.includes("prompt")) {
      return Response.json(
        { error, errorFa: "متن درخواست راهبردی الزامی است" },
        { status: 400 },
      );
    }
    return badRequest(error);
  }

  const { prompt, runs, candidates, maxIterations, withSensitivity, seed } =
    parsed.data;
  const intentOverrides: IntentOverrides =
    (parsed.data.intentOverrides as IntentOverrides | undefined) ?? {};

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          /* client disconnected */
        }
      };

      try {
        const seeded = await ensureSeeded();
        const corpusStatus = seeded.persisted
          ? `PostgreSQL-backed corpus ready (${seeded.kb} documents, ${seeded.benchmarks} benchmarks)`
          : `Local in-memory corpus ready (${seeded.kb} documents, ${seeded.benchmarks} benchmarks); PostgreSQL persistence is unavailable`;
        const corpusStatusFa = seeded.persisted
          ? `پایگاه دانش و بنچمارک PostgreSQL آماده است (${seeded.kb} سند، ${seeded.benchmarks} بنچمارک)`
          : `پایگاه دانش محلی آماده است (${seeded.kb} سند، ${seeded.benchmarks} بنچمارک)؛ ذخیره‌سازی PostgreSQL در دسترس نیست`;
        send("status", {
          stage: "bootstrap",
          titleFa: corpusStatusFa,
          titleEn: corpusStatus,
          persisted: seeded.persisted,
        });

        const { state } = await runPipeline({
          prompt,
          options: {
            runs,
            candidates,
            maxIterations,
            withSensitivity,
            seed,
            intentOverrides,
            signal: request.signal,
          },
          onEvent: (event) => send("trace", event),
        });

        if (state.status !== "complete") {
          send("error", {
            message: state.error ?? "Pipeline did not complete",
            status: state.status,
          });
          send("done", { ok: false });
          return;
        }

        const runId = await saveRun(state);

        send("result", {
          runId,
          prompt: state.prompt,
          status: state.status,
          validationStatus: state.validationStatus,
          error: state.error ?? null,
          elapsedMs: state.elapsedMs,
          iterations: state.iterations,
          iterationCount: state.iteration,
          request: state.request,
          warnings: state.warnings,
          constraints: state.constraints,
          marketIntel: state.marketIntel,
          simorgh: state.simorgh,
          persona: state.persona,
          ecosystem: state.ecosystem,
          product: state.product,
          alm: state.alm,
          findings: state.findings,
          sensitivity: state.sensitivity,
          accountingEntries: state.accountingEntries,
          complianceDraft: state.complianceDraft,
          benchmarks: state.benchmarks,
          reportFa: state.reportFa,
          reportEn: state.reportEn,
          dossier: safeDossier(state),
        });
        send("done", { ok: true, runId });
      } catch (error) {
        send("error", {
          message: error instanceof Error ? error.message : String(error),
        });
        send("done", { ok: false });
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
