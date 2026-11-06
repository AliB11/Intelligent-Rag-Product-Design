/**
 * simorgh/metrics.ts — advanced performance metrics (Simorgh adaptation).
 * ---------------------------------------------------------------------------
 * APR of the representative schedule, NPL ratio, historical VaR95 of the
 * monthly net-income path, Basel IRB capital, inflation-adjusted real return,
 * financial-inclusion score and the income-decile access gap. Deterministic.
 */

import { INFLATION_RATE } from "../domain/constants";
import type { AlmResult } from "../domain/types";
import type { Customer } from "./population";
import { decileAccessGap } from "./population";
import { effectiveAprPct, irbRetailK, unitSchedule } from "./quant";

export interface SimorghMetrics {
  /** Effective APR (%) of the blended representative mode. */
  aprPct: number;
  /** Non-performing-loan ratio implied by blended PD×seasoning (fraction). */
  nplRatio: number;
  /** Historical 95% VaR of cumulative net income as a share of peak loans (negative = loss). */
  var95NetIncomeRial: number;
  /** Basel IRB capital requirement of the blended book (fraction of EAD). */
  irbCapitalRate: number;
  /** Real annual return after inflation: (1+IRR)/(1+π) − 1 (fraction). */
  realReturnAnnual: number;
  /** Inclusion score 0..1 — approval reach across low-income deciles. */
  inclusionScore: number;
  /** Access gap top-decile minus bottom-40% approval rates (0..1). */
  decileGap: number;
}

export interface SimorghMetricsInput {
  alm: AlmResult;
  /** Blended annual customer cost (rate or commission), fraction. */
  blendedAnnualRate: number;
  /** Blended tenor of the modes, months. */
  blendedTenorMonths: number;
  blendedPd: number;
  blendedLgd: number;
  population: Customer[];
  approvedIds: Set<number>;
  upfrontFeePct?: number;
}

export function computeSimorghMetrics(input: SimorghMetricsInput): SimorghMetrics {
  const { alm } = input;
  const schedule = unitSchedule(input.blendedAnnualRate * 100, input.blendedTenorMonths, "annuity");
  const aprPct = effectiveAprPct(schedule, input.upfrontFeePct ?? 0);

  // NPL: PD seasoned ~month 9 of the book (seasoning peak) as an illustrative stock ratio
  const seasoning = 0.45 + 1.1 * (1 - Math.exp(-9 / 4)) * Math.exp(-9 / 40);
  const nplRatio = Math.min(0.5, input.blendedPd * seasoning * 1.35);

  // VaR95 on the cumulative net-income path
  const monthly = alm.monthly.map((r) => r.netIncome);
  const cum: number[] = [];
  let acc = 0;
  for (const v of monthly) {
    acc += v;
    cum.push(acc);
  }
  const sorted = [...cum].sort((a, b) => a - b);
  const var95 = sorted.length ? sorted[Math.max(0, Math.floor(0.05 * sorted.length))] : 0;

  const irbCapitalRate = irbRetailK(input.blendedPd, input.blendedLgd, "other");
  const realReturnAnnual = (1 + alm.metrics.irrBankAnnual) / (1 + INFLATION_RATE) - 1;

  const { bottomShare, gap } = decileAccessGap(input.population, input.approvedIds);
  const inclusionScore = Math.max(0, Math.min(1, bottomShare / Math.max(0.2, 0.55)));

  return {
    aprPct,
    nplRatio,
    var95NetIncomeRial: var95,
    irbCapitalRate,
    realReturnAnnual,
    inclusionScore,
    decileGap: gap,
  };
}
