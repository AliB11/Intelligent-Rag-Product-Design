/**
 * Regulatory Constraint Extractor
 * ---------------------------------------------------------------------------
 * Turns top-ranked, pre-filtered knowledge chunks into the executable
 * `RegulatoryConstraints` envelope that is passed directly into the
 * financial-engine as hard boundary constraints.
 *
 * Merge algebra (conservative — retrieved caps can only TIGHTEN the
 * statutory fallback, never loosen it):
 *
 *   max_loan_interest_rate  = min over chunk caps and the statutory fallback
 *   max_fee_rate            = min over chunk caps and the statutory fallback
 *   min_reserve_ratio       = max over chunk caps and the statutory fallback
 *   allow_blocked_…         = AND over chunk caps (false wins), fallback true
 *   effective_rate_cap      = min(merged cap, max_loan_interest_rate)
 *
 * Only chunks whose governance says ACTIVE *and* whose effective/expiration
 * window contains `at` contribute caps or citations — a superseded or
 * expired directive injected directly into the extractor is ignored exactly
 * as the retriever would have dropped it. The final object is re-validated
 * with Zod so a malformed envelope can never reach the engine.
 */

import type { RegulatoryConstraint } from "../domain/types";
import {
  defaultRegulatoryConstraints,
  parseRegulatoryConstraints,
  type RegulatoryConstraints,
} from "../domain/regulatory";
import { isChunkActiveAt } from "./governance";

export interface ExtractRegulatoryConstraintsOptions {
  /** Evaluation instant for temporal validity; defaults to now. */
  at?: Date;
}

export function extractRegulatoryConstraints(
  hits: RegulatoryConstraint[],
  options: ExtractRegulatoryConstraintsOptions = {},
): RegulatoryConstraints {
  const at = options.at ?? new Date();
  const envelope = defaultRegulatoryConstraints();

  let maxLoan = envelope.max_loan_interest_rate;
  let maxFee = envelope.max_fee_rate;
  let minReserve = envelope.min_reserve_ratio;
  let collateral = envelope.allow_blocked_deposit_collateral;
  let effective = envelope.effective_rate_cap;
  const citations: RegulatoryConstraints["citations"] = [];
  const seenDocs = new Set<string>();

  for (const hit of hits) {
    if (!hit || typeof hit !== "object") continue;
    const meta = hit.governance;
    // Defensive second gate: even a directly-injected non-ACTIVE hit is
    // rejected here (the retriever already pre-filters before scoring).
    if (!meta || !isChunkActiveAt(meta, at)) continue;
    if (seenDocs.has(hit.id)) continue;
    seenDocs.add(hit.id);

    const caps = meta.regulatory_caps;
    if (caps) {
      if (typeof caps.maxLoanInterestRate === "number" && Number.isFinite(caps.maxLoanInterestRate)) {
        maxLoan = Math.min(maxLoan, caps.maxLoanInterestRate);
      }
      if (typeof caps.maxFeeRate === "number" && Number.isFinite(caps.maxFeeRate)) {
        maxFee = Math.min(maxFee, caps.maxFeeRate);
      }
      if (typeof caps.minReserveRatio === "number" && Number.isFinite(caps.minReserveRatio)) {
        minReserve = Math.max(minReserve, caps.minReserveRatio);
      }
      if (caps.allowBlockedDepositCollateral === false) {
        collateral = false;
      }
      if (typeof caps.effectiveRateCap === "number" && Number.isFinite(caps.effectiveRateCap)) {
        effective = Math.min(effective, caps.effectiveRateCap);
      }
    }

    citations.push({
      doc_id: hit.id,
      clause: hit.citation || hit.code,
      summary: hit.titleEn || hit.titleFa,
    });
  }

  // The all-in effective cap can never exceed the contract rate ceiling.
  effective = Math.min(effective, maxLoan);

  return parseRegulatoryConstraints({
    max_loan_interest_rate: maxLoan,
    max_fee_rate: maxFee,
    min_reserve_ratio: minReserve,
    allow_blocked_deposit_collateral: collateral,
    effective_rate_cap: effective,
    citations,
  });
}
