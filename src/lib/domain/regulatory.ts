/**
 * Executable regulatory constraint envelope.
 * ---------------------------------------------------------------------------
 * Produced by `rag/regulatoryConstraintExtractor` from top-ranked ACTIVE
 * knowledge chunks and passed directly into the financial-engine (optimizer
 * synthesis, inverse solver, ALM committee) as HARD boundary constraints:
 *
 *   max_loan_interest_rate        hard ceiling on contract profit rates
 *   max_fee_rate                  hard ceiling on commission / service fees
 *   min_reserve_ratio             hard floor on the modeled statutory reserve
 *   allow_blocked_deposit_collateral
 *                                 when false, blocked deposits may not
 *                                 collateralise loans (blockedRatio := 0)
 *   effective_rate_cap            all-in effective-rate ceiling (fees +
 *                                 blocking + sleep drag included)
 *   citations                     grounding ledger: doc_id / clause / summary
 *
 * The envelope is validated with Zod at every boundary and every helper below
 * is total: finite in, finite out, never NaN/Infinity.
 */

import { z } from "zod";
import { REGULATORY } from "./constants";

export interface ConstraintCitation {
  doc_id: string;
  clause: string;
  summary: string;
}

export interface RegulatoryConstraints {
  max_loan_interest_rate: number;
  max_fee_rate: number;
  min_reserve_ratio: number;
  allow_blocked_deposit_collateral: boolean;
  effective_rate_cap: number;
  citations: ConstraintCitation[];
}

export const constraintCitationSchema = z
  .object({
    doc_id: z.string().min(1),
    clause: z.string().min(1),
    summary: z.string().min(1),
  })
  .strict();

/** Strict schema for the executable envelope (all fractions in [0, 1]). */
export const regulatoryConstraintsSchema = z
  .object({
    max_loan_interest_rate: z.number().min(0).max(1),
    max_fee_rate: z.number().min(0).max(1),
    min_reserve_ratio: z.number().min(0).max(1),
    allow_blocked_deposit_collateral: z.boolean(),
    effective_rate_cap: z.number().min(0).max(1),
    citations: z.array(constraintCitationSchema),
  })
  .strict();

/**
 * Statutory fallback envelope used when retrieval yields no governing caps:
 * the general CBI lending ceiling (23%), the QH commission ceiling (4%),
 * the short-term statutory reserve floor (10%) and collateral allowed.
 */
export function defaultRegulatoryConstraints(): RegulatoryConstraints {
  return {
    max_loan_interest_rate: REGULATORY.morabahaMaxRate,
    max_fee_rate: REGULATORY.qarzHasanehMaxCommission,
    min_reserve_ratio: 0.1,
    allow_blocked_deposit_collateral: true,
    effective_rate_cap: REGULATORY.morabahaMaxRate,
    citations: [],
  };
}

/** Validate + normalise an envelope (throws on malformed input). */
export function parseRegulatoryConstraints(value: unknown): RegulatoryConstraints {
  return regulatoryConstraintsSchema.parse(value);
}

/** Hard ceiling for a contract profit rate under the envelope. */
export function clampLoanRateToConstraints(
  loanRate: number,
  constraints: RegulatoryConstraints,
): number {
  if (!Number.isFinite(loanRate)) return 0;
  return Math.max(
    0,
    Math.min(loanRate, constraints.max_loan_interest_rate, constraints.effective_rate_cap),
  );
}

/** Hard ceiling for a commission / fee rate under the envelope. */
export function clampFeeRateToConstraints(
  feeRate: number,
  constraints: RegulatoryConstraints,
): number {
  if (!Number.isFinite(feeRate)) return 0;
  return Math.max(0, Math.min(feeRate, constraints.max_fee_rate));
}

/** Hard floor for the modeled statutory reserve under the envelope. */
export function applyReserveFloor(
  statutoryReserve: number,
  constraints: RegulatoryConstraints,
): number {
  if (!Number.isFinite(statutoryReserve)) return constraints.min_reserve_ratio;
  return Math.max(statutoryReserve, constraints.min_reserve_ratio);
}

/** Blocked-deposit collateralisation: 0 when the envelope forbids it. */
export function clampBlockedRatioToConstraints(
  blockedRatio: number,
  constraints: RegulatoryConstraints,
): number {
  if (!Number.isFinite(blockedRatio)) return 0;
  const bounded = Math.max(0, Math.min(1, blockedRatio));
  return constraints.allow_blocked_deposit_collateral ? bounded : 0;
}

/** One-line audit description used in traces and the product dossier. */
export function describeRegulatoryConstraints(constraints: RegulatoryConstraints): string {
  return (
    `r_loan ≤ ${(constraints.max_loan_interest_rate * 100).toFixed(1)}%, ` +
    `fee ≤ ${(constraints.max_fee_rate * 100).toFixed(1)}%, ` +
    `reserve ≥ ${(constraints.min_reserve_ratio * 100).toFixed(1)}%, ` +
    `effective ≤ ${(constraints.effective_rate_cap * 100).toFixed(1)}%, ` +
    `blocked collateral ${constraints.allow_blocked_deposit_collateral ? "allowed" : "forbidden"}, ` +
    `${constraints.citations.length} citation(s)`
  );
}
