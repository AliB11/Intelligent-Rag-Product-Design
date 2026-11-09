/**
 * simorgh/quant.ts — quantitative primitives adapted from the Simorgh engine
 * (intelligent-banking-product-simulator, src/lib/engine/math.ts) onto the
 * deterministic PRNG of this repository.
 * ---------------------------------------------------------------------------
 * Basel IRB retail capital (K), Vasicek single-factor conditional PD, default
 * seasoning curve, Bass diffusion of adoption, closed-form APR of a schedule.
 * Deterministic, LLM-free, fully unit-testable.
 */

import { clamp, createRng, pmt, sampleNormal, solveIrr, type Rng } from "../domain/financial";

// ---------- Normal distribution ----------
export function normCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp((-x * x) / 2);
  const p =
    d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x > 0 ? 1 - p : p;
}

export function normInv(p: number): number {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  if (p <= 0) return -8;
  if (p >= 1) return 8;
  const pl = 0.02425;
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p <= 1 - pl) {
    const q = p - 0.5;
    const r = q * q;
    return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  const q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}

// ---------- Credit risk models ----------
export type IrbExposure = "other" | "qrre" | "mortgage";

/** Basel II/III IRB capital requirement K for retail exposures (fraction of EAD). */
export function irbRetailK(pd: number, lgd: number, type: IrbExposure = "other"): number {
  const PD = clamp(pd, 0.0003, 0.9999);
  let R: number;
  if (type === "qrre") R = 0.04;
  else if (type === "mortgage") R = 0.15;
  else {
    const f = (1 - Math.exp(-35 * PD)) / (1 - Math.exp(-35));
    R = 0.03 * f + 0.16 * (1 - f);
  }
  const k = lgd * normCdf((normInv(PD) + Math.sqrt(R) * normInv(0.999)) / Math.sqrt(1 - R)) - PD * lgd;
  return Math.max(0, k);
}

/** Vasicek single-factor conditional PD given systematic factor z (z>0 = bad state). */
export function vasicekPd(pd: number, z: number, rho = 0.04): number {
  return normCdf((normInv(clamp(pd, 1e-5, 0.9999)) + Math.sqrt(rho) * z) / Math.sqrt(1 - rho));
}

/** Seasoning curve — default intensity multiplier by month-on-book (peaks ~6–15). */
const SEASON_CACHE: number[] = [];
export function seasoning(mob: number): number {
  if (mob < 512) {
    const hit = SEASON_CACHE[mob];
    if (hit !== undefined) return hit;
  }
  const v = 0.45 + 1.1 * (1 - Math.exp(-mob / 4)) * Math.exp(-mob / 40);
  if (mob < 512) SEASON_CACHE[mob] = v;
  return v;
}

// ---------- Bass diffusion (adoption timing) ----------
export function bassCdf(t: number, p: number, q: number): number {
  const e = Math.exp(-(p + q) * t);
  return (1 - e) / (1 + (q / p) * e);
}

export function sampleBass(u: number, p: number, q: number, T: number): number {
  const U = u * bassCdf(T, p, q);
  const E = (1 - U) / (1 + (U * q) / p);
  return Math.min(T - 1e-9, Math.max(0, -Math.log(E) / (p + q)));
}

// ---------- Amortization & APR ----------
export interface ScheduleRow {
  month: number;
  payment: number;
  interest: number;
  principal: number;
  balance: number;
}

/**
 * Annuity or equal-principal schedule for a principal of 1 (unit) so APR is
 * scale-free. `annualRatePct` is in percent (e.g. 23 for 23%).
 */
export function unitSchedule(annualRatePct: number, tenorMonths: number, kind: "annuity" | "equal_principal" = "annuity"): ScheduleRow[] {
  const n = clamp(Math.round(tenorMonths), 1, 360);
  const r = clamp(annualRatePct, 0, 200) / 100 / 12;
  const rows: ScheduleRow[] = [];
  let balance = 1;
  const pay = kind === "annuity" ? pmt(r, n, 1) : 1 / n + r;
  for (let m = 1; m <= n; m += 1) {
    const interest = balance * r;
    const principal = kind === "annuity" ? Math.min(balance, pay - interest) : 1 / n;
    balance = Math.max(0, balance - principal);
    rows.push({ month: m, payment: interest + principal, interest, principal, balance });
  }
  return rows;
}

/** Effective APR (%) of a unit schedule plus one-off upfront fee (% of principal). */
export function effectiveAprPct(schedule: ScheduleRow[], upfrontFeePct = 0): number {
  const fee = clamp(upfrontFeePct, 0, 50) / 100;
  // cash-flow IRR of: +1 - fee at t0, -payment each month
  const flows = [1 - fee, ...schedule.map((row) => -row.payment)];
  const monthlyIrr = irrOfFlows(flows);
  if (!Number.isFinite(monthlyIrr)) return 999;
  return clamp((Math.pow(1 + monthlyIrr, 12) - 1) * 100, -50, 999);
}

/** Bracketed IRR for a short cash-flow vector (monthly periods).
 *  Delegates to the hardened Newton/Brent/bisection solver in
 *  `domain/financial` so both IRR entry points share one certified
 *  implementation (1e-6 tolerance, no NaN from numerical breakdown). */
export function irrOfFlows(flows: number[]): number {
  const solved = solveIrr(flows, 0.02);
  return solved.converged ? solved.rate : NaN;
}

/** Convenience: deterministic normal sample via this repo's PRNG. */
export function makeNormal(seed: number): Rng & { normal: () => number } {
  const rng = createRng(seed);
  const normalFn = () => sampleNormal(rng);
  return Object.assign(rng, { normal: normalFn });
}
