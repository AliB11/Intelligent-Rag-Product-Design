/**
 * simorgh/creditPolicy.ts — credit policy, DTI gate and tiered pricing
 * (Simorgh adaptation onto the deterministic engine of this repo).
 */

import { clamp } from "../domain/financial";
import { REGULATORY } from "../domain/constants";
import type { Customer, ScoreTier } from "./population";
import { scoreTiers, tierIndexOf } from "./population";
import { irbRetailK, vasicekPd } from "./quant";

export interface CreditPolicyInput {
  /** Annual rate/commission of the product (fraction). */
  annualRate: number;
  tenorMonths: number;
  /** Facility amount per customer, million toman. */
  amountMillionToman: number;
  /** Configured caps (fractions) — falls back to regulatory defaults. */
  dtiCap?: number;
  minScore?: number;
}

export interface CreditDecision {
  approved: boolean;
  reasonsFa: string[];
  dti: number;
  score: number;
  tierIndex: number;
  pd: number;
  pricedRate: number;
  expectedLossRate: number;
  capitalRate: number;
}

/** Underwrite one synthetic customer against a product mode. */
export function underwrite(
  customer: Customer,
  input: CreditPolicyInput,
  tiers: ScoreTier[] = scoreTiers(),
  lgd = 0.25,
  shockZ = 0,
): CreditDecision {
  const dtiCap = input.dtiCap ?? REGULATORY.installmentToIncomeCeiling;
  const minScore = input.minScore ?? 450;
  const reasonsFa: string[] = [];
  const tierIndex = tierIndexOf(customer.score, tiers);
  const tier = tiers[tierIndex];
  const monthlyPayment = annuityPayment(input.annualRate, input.tenorMonths, input.amountMillionToman);
  const income = Math.max(1, customer.income);
  const dti = (monthlyPayment + customer.existingDebt) / income;
  let approved = true;
  if (customer.score < minScore) {
    approved = false;
    reasonsFa.push(`رتبه اعتباری ${customer.score} کمتر از کف ${minScore}`);
  }
  if (dti > dtiCap + 1e-9) {
    approved = false;
    reasonsFa.push(`نسبت قسط به درآمد ${(dti * 100).toFixed(0)}٪ از سقف ${(dtiCap * 100).toFixed(0)}٪ بیشتر است`);
  }
  const basePd = tier.pd * (customer.thinFile ? 1.25 : 1);
  const pd = vasicekPd(basePd, shockZ);
  // tiered pricing: par rate scaled by the tier index, clamped to the offer
  const pricedRate = clamp(input.annualRate * tier.pricingIndex, 0, input.annualRate * 1.6);
  return {
    approved,
    reasonsFa,
    dti,
    score: customer.score,
    tierIndex,
    pd,
    pricedRate,
    expectedLossRate: pd * lgd,
    capitalRate: irbRetailK(pd, lgd, "other"),
  };
}

export function annuityPayment(annualRate: number, tenorMonths: number, principalMillionToman: number): number {
  const r = clamp(annualRate, 0, 2) / 12;
  const n = Math.max(1, Math.round(tenorMonths));
  if (r < 1e-9) return principalMillionToman / n;
  const f = Math.pow(1 + r, n);
  return (principalMillionToman * r * f) / (f - 1);
}

/** Portfolio roll-up of underwriting the whole population against one mode. */
export function portfolioUnderwriting(
  population: Customer[],
  input: CreditPolicyInput,
  tiers: ScoreTier[] = scoreTiers(),
  lgd = 0.25,
  shockZ = 0,
): {
  approvalRate: number;
  approvedCount: number;
  weightedPd: number;
  weightedRate: number;
  expectedLossRate: number;
  capitalRate: number;
  tierApproval: number[];
  decisions: Map<number, CreditDecision>;
} {
  const decisions = new Map<number, CreditDecision>();
  let approvedCount = 0;
  let pdAcc = 0;
  let rateAcc = 0;
  let elAcc = 0;
  let kAcc = 0;
  const tierApproval = new Array(tiers.length).fill(0) as number[];
  const tierTotal = new Array(tiers.length).fill(0) as number[];
  for (const customer of population) {
    const d = underwrite(customer, input, tiers, lgd, shockZ);
    decisions.set(customer.id, d);
    const ti = tierIndexOf(customer.score, tiers);
    tierTotal[ti] += 1;
    if (d.approved) {
      approvedCount += 1;
      tierApproval[ti] += 1;
      pdAcc += d.pd;
      rateAcc += d.pricedRate;
      elAcc += d.expectedLossRate;
      kAcc += d.capitalRate;
    }
  }
  const n = Math.max(1, approvedCount);
  return {
    approvalRate: approvedCount / Math.max(1, population.length),
    approvedCount,
    weightedPd: pdAcc / n,
    weightedRate: rateAcc / n,
    expectedLossRate: elAcc / n,
    capitalRate: kAcc / n,
    tierApproval: tierApproval.map((a, i) => (tierTotal[i] ? a / tierTotal[i] : 0)),
    decisions,
  };
}
