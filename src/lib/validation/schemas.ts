/**
 * Zod validation schemas — the single source of truth for every boundary
 * crossing of the platform:
 *
 *   UI ⇄ API routes (generate / recommend / runs / regulations / benchmarks)
 *   API ⇄ RAG pipeline (prompt + retrieval inputs)
 *   API ⇄ financial-engine (pipeline options, intent overrides)
 *
 * All schemas are strict (unknown keys are rejected, no silent coercion of
 * mistyped payloads) and every failure message carries its field path so
 * callers can react to the exact offending key.
 */

import { z } from "zod";
import {
  MAX_MONTE_CARLO_RUNS,
  MAX_OPTIMIZER_CANDIDATES,
  MAX_PROMPT_LENGTH,
  MC_RUNS,
  MIN_MONTE_CARLO_RUNS,
  MIN_OPTIMIZER_CANDIDATES,
  REGULATORY,
} from "../domain/constants";
import type { IntentOverrides } from "../domain/intentParser";
import type { GuaranteeType } from "../domain/types";

/** Render a ZodError as "path: message; path: message". */
export function formatZodIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) =>
      issue.path.length > 0
        ? `${issue.path.join(".")}: ${issue.message}`
        : issue.message,
    )
    .join("; ");
}

/** Safe-parse helper: returns data or a formatted Error (never throws raw). */
export function parseOrThrow<T extends z.ZodType>(
  schema: T,
  value: unknown,
  ErrorClass: new (message: string) => Error = Error,
): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ErrorClass(formatZodIssues(result.error));
  }
  return result.data;
}

/* ---------------------------------------------------------------------------
 * Intent overrides — the composer's numeric steering knobs. The ranges below
 * are shared by the API route and the engine's own validation.
 * ------------------------------------------------------------------------- */
export const INTENT_OVERRIDE_RANGES = {
  targetDepositsHemmat: [0.01, 1_000],
  targetIrr: [0.01, 1],
  ldrCeiling: [0.4, 0.95],
  lcrFloor: [1, 2],
  maxOverturningShock: [0.01, 0.25],
} as const satisfies Record<keyof IntentOverrides, readonly [number, number]>;

export const intentOverridesSchema = z
  .record(z.string(), z.number())
  .superRefine((value, ctx) => {
    for (const [key, raw] of Object.entries(value)) {
      const range = INTENT_OVERRIDE_RANGES[key as keyof IntentOverrides];
      if (!range) {
        ctx.addIssue({
          code: "custom",
          message: `Unsupported intent override: ${key}`,
          path: [key],
        });
        continue;
      }
      if (!Number.isFinite(raw) || raw < range[0] || raw > range[1]) {
        ctx.addIssue({
          code: "custom",
          message: `${key} must be between ${range[0]} and ${range[1]}`,
          path: [key],
        });
      }
    }
  });

/* ---------------------------------------------------------------------------
 * POST /api/generate — SSE product-generation request body.
 * ------------------------------------------------------------------------- */
export const generateRequestSchema = z
  .object({
    prompt: z
      .string()
      .trim()
      .min(1, "prompt is required")
      .max(MAX_PROMPT_LENGTH, `prompt must be at most ${MAX_PROMPT_LENGTH} characters`),
    runs: z
      .number()
      .int()
      .min(MIN_MONTE_CARLO_RUNS, `runs must be at least ${MIN_MONTE_CARLO_RUNS}`)
      .max(MAX_MONTE_CARLO_RUNS, `runs must be at most ${MAX_MONTE_CARLO_RUNS}; no silent reduction is applied`)
      .default(MC_RUNS),
    candidates: z
      .number()
      .int()
      .min(MIN_OPTIMIZER_CANDIDATES, `candidates must be at least ${MIN_OPTIMIZER_CANDIDATES}`)
      .max(MAX_OPTIMIZER_CANDIDATES, `candidates must be at most ${MAX_OPTIMIZER_CANDIDATES}`)
      .default(26),
    maxIterations: z
      .number()
      .int()
      .min(1, "maxIterations must be at least 1")
      .max(REGULATORY.maxCriticIterations, `maxIterations must be at most ${REGULATORY.maxCriticIterations}`)
      .default(REGULATORY.maxCriticIterations),
    withSensitivity: z.boolean().default(true),
    seed: z.string().max(128, "seed must be at most 128 characters").optional(),
    intentOverrides: intentOverridesSchema.optional(),
  })
  .strict();

export type GenerateRequest = z.output<typeof generateRequestSchema>;

/* ---------------------------------------------------------------------------
 * POST /api/recommend — customer product-recommendation request body.
 * ------------------------------------------------------------------------- */
export const GUARANTEE_TYPES = [
  "none",
  "sana-safteh",
  "sayad-cheque",
  "payroll-deduction",
  "official-guarantor",
  "deposit-block",
  "wealth-collateral",
  "property-deed",
  "vehicle-pledge",
  "pos-turnover",
] as const satisfies readonly GuaranteeType[];

const guaranteeEnum = z.enum(GUARANTEE_TYPES);

const nonNegativeAmount = (key: string) =>
  z
    .number(`مقدار ${key} معتبر نیست.`)
    .min(0, `مقدار ${key} معتبر نیست.`)
    .max(1e15, `مقدار ${key} معتبر نیست.`);

export const recommendRequestSchema = z
  .object({
    query: z
      .string("شرح نیاز باید بین ۱ تا ۲۰۰۰ نویسه باشد.")
      .trim()
      .min(1, "شرح نیاز باید بین ۱ تا ۲۰۰۰ نویسه باشد.")
      .max(2000, "شرح نیاز باید بین ۱ تا ۲۰۰۰ نویسه باشد."),
    amountToman: nonNegativeAmount("amountToman").optional(),
    monthlyIncomeToman: nonNegativeAmount("monthlyIncomeToman").optional(),
    existingInstallmentToman: nonNegativeAmount("existingInstallmentToman").optional(),
    availableDepositToman: nonNegativeAmount("availableDepositToman").optional(),
    maxSleepMonths: z
      .number("مقدار maxSleepMonths معتبر نیست.")
      .min(0, "مقدار maxSleepMonths معتبر نیست.")
      .max(600, "مقدار maxSleepMonths معتبر نیست.")
      .optional(),
    alternativeYield: z
      .number("مقدار alternativeYield معتبر نیست.")
      .min(0, "مقدار alternativeYield معتبر نیست.")
      .max(1, "مقدار alternativeYield معتبر نیست.")
      .optional(),
    availableGuarantees: z
      .array(guaranteeEnum, "نوع ضمانت معتبر نیست.")
      .max(GUARANTEE_TYPES.length, "نوع ضمانت معتبر نیست.")
      .optional(),
  })
  .strict();

export type RecommendRequest = z.output<typeof recommendRequestSchema>;

/* ---------------------------------------------------------------------------
 * GET /api/runs — audit-trail query string.
 * ------------------------------------------------------------------------- */
export const runsQuerySchema = z
  .object({
    id: z.string().min(1).max(64).optional(),
    limit: z.coerce.number().int().min(1, "limit must be between 1 and 100").max(100, "limit must be between 1 and 100").optional(),
  })
  .strict();

/* ---------------------------------------------------------------------------
 * PUT /api/regulations — patch of the configurable rulebook.
 * ------------------------------------------------------------------------- */
const regulationKey = (key: string) =>
  z.number(`${key} must be a non-negative number`).min(0, `${key} must be a non-negative number`);

export const regulationsPatchSchema = z
  .object({
    loanRateCap: regulationKey("loanRateCap").optional(),
    qardFeeCap: regulationKey("qardFeeCap").optional(),
    absoluteCap: regulationKey("absoluteCap").optional(),
    gamCap: regulationKey("gamCap").optional(),
    ldrCeiling: regulationKey("ldrCeiling").optional(),
    lcrFloor: regulationKey("lcrFloor").optional(),
    dtiCap: regulationKey("dtiCap").optional(),
    microLoanCap: regulationKey("microLoanCap").optional(),
    inflation: regulationKey("inflation").optional(),
  })
  .strict();

/* ---------------------------------------------------------------------------
 * GET /api/benchmarks — corpus query string.
 * ------------------------------------------------------------------------- */
export const benchmarksQuerySchema = z
  .object({
    q: z.string().max(500, "q must be at most 500 characters").optional(),
    source: z.enum(["db", "memory"]).optional(),
  })
  .strict();

/* ---------------------------------------------------------------------------
 * Financial-engine boundary — what runPipeline() accepts. The engine
 * re-validates even when the API route already did (defence in depth), and
 * direct engine callers (verification suite) are held to the same contract.
 * ------------------------------------------------------------------------- */
export const pipelinePromptSchema = z
  .string("A non-empty strategic prompt is required")
  .trim()
  .min(1, "A non-empty strategic prompt is required")
  .max(MAX_PROMPT_LENGTH, `Prompt exceeds the ${MAX_PROMPT_LENGTH}-character limit`);

export const pipelineOptionsSchema = z
  .object({
    runs: z
      .number()
      .int()
      .min(1, "runs must be an integer between 1 and " + MAX_MONTE_CARLO_RUNS)
      .max(MAX_MONTE_CARLO_RUNS, "runs must be an integer between 1 and " + MAX_MONTE_CARLO_RUNS),
    candidates: z
      .number()
      .int()
      .min(MIN_OPTIMIZER_CANDIDATES, "candidates must be an integer between " + MIN_OPTIMIZER_CANDIDATES + " and " + MAX_OPTIMIZER_CANDIDATES)
      .max(MAX_OPTIMIZER_CANDIDATES, "candidates must be an integer between " + MIN_OPTIMIZER_CANDIDATES + " and " + MAX_OPTIMIZER_CANDIDATES),
    maxIterations: z
      .number()
      .int()
      .min(1, "maxIterations must be an integer between 1 and " + REGULATORY.maxCriticIterations)
      .max(REGULATORY.maxCriticIterations, "maxIterations must be an integer between 1 and " + REGULATORY.maxCriticIterations),
    withSensitivity: z.boolean("withSensitivity must be a boolean"),
    seed: z.string("seed must be a string").max(128, "seed must be at most 128 characters"),
    intentOverrides: intentOverridesSchema,
    // Not JSON-serialisable: structurally checked as an AbortSignal instance.
    signal: z.custom<AbortSignal | undefined>(
      (value) =>
        value === undefined ||
        (typeof AbortSignal !== "undefined" && value instanceof AbortSignal),
      { message: "signal must be an AbortSignal" },
    ),
  })
  .partial()
  .strict();

export type PipelineOptionsInput = z.output<typeof pipelineOptionsSchema>;

/* ---------------------------------------------------------------------------
 * RAG boundary — retrieval inputs shared by the knowledge base and the
 * benchmark registry.
 * ------------------------------------------------------------------------- */
export const retrievalQuerySchema = z
  .string("query must be a string")
  .max(2_000, "query must be at most 2000 characters");

export const retrievalLimitSchema = z
  .number("limit must be a finite number")
  .int("limit must be an integer")
  .min(1, "limit must be >= 1")
  .max(100, "limit must be <= 100");
