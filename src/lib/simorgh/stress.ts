/**
 * simorgh/stress.ts — seven-scenario macro stress suite (Simorgh adaptation).
 * ---------------------------------------------------------------------------
 * base, stagflation, recession, boom, fx_shock, liquidity_crunch, disinflation
 * — each mapped onto the ALM digital twin's factor multipliers (outflow,
 * adoption, delta, rate) and run deterministically with reduced paths.
 */

import type { ProductSpec, ProductGenerationRequest } from "../domain/types";
import { runAlmSimulation, type StressScenario } from "../domain/almSimulator";
import { effectiveRiskLimits } from "../domain/optimizer";

export interface MacroScenario {
  id: ScenarioId;
  labelFa: string;
  /** ALM twin factors. */
  factors: { outflow: number; adoption: number; delta: number; rate: number };
  /** Systematic Vasicek factor for conditional PD (z>0 = bad state). */
  z: number;
}

export type ScenarioId =
  | "base"
  | "stagflation"
  | "recession"
  | "boom"
  | "fx_shock"
  | "liquidity_crunch"
  | "disinflation";

export const SCENARIOS: MacroScenario[] = [
  { id: "base", labelFa: "پایه", factors: { outflow: 1, adoption: 1, delta: 1, rate: 1 }, z: 0 },
  { id: "stagflation", labelFa: "رکود تورمی", factors: { outflow: 1.35, adoption: 0.9, delta: 1.2, rate: 1.15 }, z: 1.5 },
  { id: "recession", labelFa: "رکود", factors: { outflow: 1.2, adoption: 0.78, delta: 1.25, rate: 1.05 }, z: 2 },
  { id: "boom", labelFa: "رونق", factors: { outflow: 0.85, adoption: 1.12, delta: 0.9, rate: 0.95 }, z: -1 },
  { id: "fx_shock", labelFa: "شوک ارزی", factors: { outflow: 1.45, adoption: 0.92, delta: 1.3, rate: 1.2 }, z: 1.8 },
  { id: "liquidity_crunch", labelFa: "تنگنای نقدینگی", factors: { outflow: 1.6, adoption: 0.85, delta: 1.35, rate: 1.25 }, z: 2.2 },
  { id: "disinflation", labelFa: "تورم‌زدایی", factors: { outflow: 0.95, adoption: 1.05, delta: 0.95, rate: 0.85 }, z: -0.5 },
];

export interface StressRunResult {
  scenario: MacroScenario;
  irrBankAnnual: number;
  p95Ldr: number;
  p5Lcr: number;
  overturningShock: number;
  monthsInBreachLdr: number;
  monthsInBreachLcr: number;
  feasible: boolean;
}

export interface StressSuiteResult {
  runs: StressRunResult[];
  worstScenario: string;
  feasibleInAll: boolean;
  seed: number;
  pathsPerScenario: number;
}

/** Run the full 7-scenario suite deterministically at reduced Monte Carlo depth. */
export function runStressSuite(
  product: ProductSpec,
  request: ProductGenerationRequest,
  seed: number,
  pathsPerScenario = 120,
  horizonMonths?: number,
): StressSuiteResult {
  const limits = effectiveRiskLimits(request);
  const runs: StressRunResult[] = SCENARIOS.map((scenario, i) => {
    const alm = runAlmSimulation({
      product,
      runs: Math.max(30, pathsPerScenario),
      seed: seed + i * 7919,
      horizonMonths: horizonMonths ?? request.horizonMonths,
      limits,
      scenario: factorScenario(scenario.factors),
    });
    const m = alm.metrics;
    return {
      scenario,
      irrBankAnnual: m.irrBankAnnual,
      p95Ldr: m.p95Ldr,
      p5Lcr: m.p5Lcr,
      overturningShock: m.overturningShock,
      monthsInBreachLdr: m.monthsInBreachLdr,
      monthsInBreachLcr: m.monthsInBreachLcr,
      feasible: m.p95Ldr <= limits.ldrCeiling && m.p5Lcr >= limits.lcrFloor,
    };
  });
  const worst = runs.reduce((worst, r) =>
    (r.p95Ldr - limits.ldrCeiling) + (limits.lcrFloor - r.p5Lcr) >
    (worst.p95Ldr - limits.ldrCeiling) + (limits.lcrFloor - worst.p5Lcr)
      ? r
      : worst,
  );
  return {
    runs,
    worstScenario: worst.scenario.id,
    feasibleInAll: runs.every((r) => r.feasible),
    seed,
    pathsPerScenario: Math.max(30, pathsPerScenario),
  };
}

/** Map macro factors to the nearest ALM twin stress scenario. */
function factorScenario(f: MacroScenario["factors"]): StressScenario {
  if (f.outflow >= 1.5) return "severe-run";
  if (f.outflow >= 1.15 || f.rate >= 1.1) return "mild-rate-shock";
  return "base";
}
