import { runPipeline } from "@/lib/agents/graph";
import type { IntentOverrides } from "@/lib/domain/intentParser";
import {
  MAX_MONTE_CARLO_RUNS,
  MAX_OPTIMIZER_CANDIDATES,
  MAX_PROMPT_LENGTH,
  MC_RUNS,
  MIN_MONTE_CARLO_RUNS,
  MIN_OPTIMIZER_CANDIDATES,
  REGULATORY,
} from "@/lib/domain/constants";
import { ensureSeeded, saveRun } from "@/lib/db/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const INTENT_OVERRIDE_RANGES: Record<keyof IntentOverrides, readonly [number, number]> = {
  targetDepositsHemmat: [0.01, 1_000],
  targetIrr: [0.01, 1],
  ldrCeiling: [0.4, 0.95],
  lcrFloor: [1, 2],
  maxOverturningShock: [0.01, 0.25],
};

function badRequest(error: string) {
  return Response.json({ error }, { status: 400 });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return badRequest("Request body must be valid JSON");
  }
  if (!isRecord(payload)) return badRequest("Request body must be a JSON object");

  if (typeof payload.prompt !== "string") return badRequest("prompt must be a string");
  const prompt = payload.prompt.trim();
  if (!prompt) {
    return Response.json(
      { error: "prompt is required", errorFa: "متن درخواست راهبردی الزامی است" },
      { status: 400 },
    );
  }
  if (prompt.length > MAX_PROMPT_LENGTH) {
    return badRequest(`prompt must be at most ${MAX_PROMPT_LENGTH} characters`);
  }

  const runs = payload.runs === undefined ? MC_RUNS : payload.runs;
  if (typeof runs !== "number" || !Number.isSafeInteger(runs) || runs < MIN_MONTE_CARLO_RUNS || runs > MAX_MONTE_CARLO_RUNS) {
    return badRequest(`runs must be an integer between ${MIN_MONTE_CARLO_RUNS} and ${MAX_MONTE_CARLO_RUNS}; no silent reduction is applied`);
  }

  const candidates = payload.candidates === undefined ? 26 : payload.candidates;
  if (typeof candidates !== "number" || !Number.isSafeInteger(candidates) || candidates < MIN_OPTIMIZER_CANDIDATES || candidates > MAX_OPTIMIZER_CANDIDATES) {
    return badRequest(`candidates must be an integer between ${MIN_OPTIMIZER_CANDIDATES} and ${MAX_OPTIMIZER_CANDIDATES}`);
  }

  const maxIterations = payload.maxIterations === undefined
    ? REGULATORY.maxCriticIterations
    : payload.maxIterations;
  if (typeof maxIterations !== "number" || !Number.isSafeInteger(maxIterations) || maxIterations < 1 || maxIterations > REGULATORY.maxCriticIterations) {
    return badRequest(`maxIterations must be an integer between 1 and ${REGULATORY.maxCriticIterations}`);
  }

  const withSensitivity = payload.withSensitivity === undefined ? true : payload.withSensitivity;
  if (typeof withSensitivity !== "boolean") return badRequest("withSensitivity must be a boolean");

  const seed = payload.seed;
  if (seed !== undefined && (typeof seed !== "string" || seed.length > 128)) {
    return badRequest("seed must be a string of at most 128 characters");
  }

  let intentOverrides: IntentOverrides = {};
  if (payload.intentOverrides !== undefined) {
    if (!isRecord(payload.intentOverrides)) return badRequest("intentOverrides must be a JSON object");
    for (const [key, value] of Object.entries(payload.intentOverrides)) {
      const range = INTENT_OVERRIDE_RANGES[key as keyof IntentOverrides];
      if (!range) return badRequest(`Unsupported intent override: ${key}`);
      if (typeof value !== "number" || !Number.isFinite(value) || value < range[0] || value > range[1]) {
        return badRequest(`${key} must be between ${range[0]} and ${range[1]}`);
      }
    }
    intentOverrides = payload.intentOverrides as IntentOverrides;
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
