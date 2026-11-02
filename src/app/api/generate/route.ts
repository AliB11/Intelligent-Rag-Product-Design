import { runPipeline } from "@/lib/agents/graph";
import { ensureSeeded, saveRun } from "@/lib/db/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface GenerateBody {
  prompt?: string;
  runs?: number;
  candidates?: number;
  withSensitivity?: boolean;
  maxIterations?: number;
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as GenerateBody;
  const prompt = String(body.prompt ?? "").trim();

  if (!prompt) {
    return Response.json(
      { error: "prompt is required", errorFa: "متن درخواست راهبردی الزامی است" },
      { status: 400 },
    );
  }

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
        send("status", {
          stage: "bootstrap",
          titleFa: `پایگاه دانش مقرراتی آماده است (${seeded.kb} سند، ${seeded.benchmarks} بنچمارک)`,
          titleEn: `Knowledge base ready (${seeded.kb} documents, ${seeded.benchmarks} benchmarks)`,
        });

        const { state } = await runPipeline({
          prompt,
          options: {
            runs: body.runs,
            candidates: body.candidates,
            maxIterations: body.maxIterations,
            withSensitivity: body.withSensitivity !== false,
          },
          onEvent: (event) => send("trace", event),
        });

        const runId = await saveRun(state);

        send("result", {
          runId,
          prompt: state.prompt,
          status: state.status,
          error: state.error ?? null,
          elapsedMs: state.elapsedMs,
          iterations: state.iterations,
          iterationCount: state.iteration,
          request: state.request,
          warnings: state.warnings,
          constraints: state.constraints,
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
        });
        send("done", { ok: true, runId });
      } catch (error) {
        send("error", {
          message: error instanceof Error ? error.message : String(error),
        });
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
