/**
 * simorgh/population.ts — synthetic customer population (Simorgh adaptation).
 * ---------------------------------------------------------------------------
 * Employment/region/income distributions, latent risk factor, bureau score on
 * the Iranian 0..900 scale, DTI inputs, collateral/gold/shares holdings and
 * digital affinity — all deterministic under this repo's PRNG (same seed =>
 * same population). Powers tiered pricing, inclusion and decile-gap metrics.
 */

import { clamp, createRng } from "../domain/financial";
import { normCdf, normInv } from "./quant";

export type Employment = "gov" | "private" | "self" | "retired" | "student" | "unemployed";
export type Region = "tehran" | "metro" | "city" | "rural";

export interface Customer {
  id: number;
  age: number;
  employment: Employment;
  region: Region;
  married: boolean;
  /** Monthly net income, million toman. */
  income: number;
  /** Existing monthly installments, million toman. */
  existingDebt: number;
  latent: number;
  /** Bureau score on the 0..900 scale (observed, with noise). */
  score: number;
  thinFile: boolean;
  hasProperty: boolean;
  propertyValue: number;
  /** Average deposit balance, million toman. */
  balance: number;
  monthlySpend: number;
  digital: number;
  needFactor: number;
  priceSens: number;
  patienceMonths: number;
}

const EMP_DIST: [Employment, number][] = [
  ["gov", 0.16],
  ["private", 0.3],
  ["self", 0.24],
  ["retired", 0.12],
  ["student", 0.08],
  ["unemployed", 0.1],
];
const REGION_DIST: [Region, number][] = [
  ["tehran", 0.22],
  ["metro", 0.28],
  ["city", 0.35],
  ["rural", 0.15],
];
const INCOME_MEDIAN: Record<Employment, number> = { gov: 28, private: 24, self: 30, retired: 18, student: 6, unemployed: 5 };
const REGION_INC: Record<Region, number> = { tehran: 1.3, metro: 1.05, city: 0.9, rural: 0.72 };

function pick<T>(rng: () => number, dist: [T, number][]): T {
  let u = rng();
  for (const [v, p] of dist) {
    if (u < p) return v;
    u -= p;
  }
  return dist[dist.length - 1][0];
}

function lognormal(rng: () => number, median: number, sigma: number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  const normal = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return median * Math.exp(sigma * normal);
}

export function scoreFromLatent(latent: number, income: number, age: number): number {
  return clamp(650 - 82 * latent + 18 * Math.log(Math.max(1, income) / 25) + Math.min(Math.max(age - 22, 0), 20) * 1.2, 250, 900);
}

const cache = new Map<string, Customer[]>();

/** Deterministic synthetic population; n capped for request safety. */
export function generatePopulation(n: number, seed: number): Customer[] {
  const count = clamp(Math.round(n), 1, 5_000);
  const key = `${count}:${seed}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const rng = createRng(seed * 31 + 7);
  const out: Customer[] = [];
  for (let i = 0; i < count; i += 1) {
    const employment = pick(rng, EMP_DIST);
    const region = pick(rng, REGION_DIST);
    let age: number;
    if (employment === "student") age = 18 + Math.floor(rng() * 9);
    else if (employment === "retired") age = 55 + Math.floor(rng() * 21);
    else age = 22 + Math.floor(Math.pow(rng(), 1.15) * 40);
    const sigma = employment === "self" ? 0.8 : 0.55;
    const ageBoost = 1 + clamp((age - 25) * 0.012, -0.1, 0.35);
    const income = clamp(lognormal(rng, INCOME_MEDIAN[employment] * REGION_INC[region] * ageBoost, sigma), 2, 600);
    const existingDebt = rng() < 0.45 ? income * (0.05 + rng() * 0.3) : 0;
    const latent = (rng() + rng() + rng() - 1.5) / 1.5;
    const thinFile = rng() < 0.22;
    const noise = thinFile ? 60 : 25;
    const scoreTrue = scoreFromLatent(latent, income, age);
    const score = clamp(scoreTrue + (rng() - 0.5) * 2 * noise, 250, 900);
    const hasProperty = rng() < (employment === "gov" || employment === "retired" ? 0.45 : 0.28);
    out.push({
      id: i + 1,
      age,
      employment,
      region,
      married: rng() < (age < 26 ? 0.25 : 0.62),
      income,
      existingDebt,
      latent,
      score: Math.round(score),
      thinFile,
      hasProperty,
      propertyValue: hasProperty ? income * (30 + rng() * 60) : 0,
      balance: rng() < 0.4 ? income * (1 + rng() * 8) : income * rng() * 0.6,
      monthlySpend: income * (0.35 + rng() * 0.5),
      digital: clamp(0.25 + (age < 35 ? 0.3 : 0.1) + rng() * 0.4, 0, 1),
      needFactor: rng(),
      priceSens: clamp(rng() * 0.8 + (income < 20 ? 0.2 : 0), 0, 1),
      patienceMonths: Math.round(1 + rng() * 11),
    });
  }
  cache.set(key, out);
  return out;
}

// ---------- Score tiers (TierTable) ----------
export interface ScoreTier {
  label: string;
  minScore: number;
  maxScore: number;
  /** Base annual PD of the tier (fraction). */
  pd: number;
  /** Relative pricing index (1 = par). */
  pricingIndex: number;
  share: number;
}

/** Canonical 6-tier Iranian retail ladder; shares follow a bell over scores. */
export function scoreTiers(): ScoreTier[] {
  return [
    { label: "A+ ممتاز", minScore: 800, maxScore: 900, pd: 0.008, pricingIndex: 0.7, share: 0.08 },
    { label: "A", minScore: 720, maxScore: 799, pd: 0.014, pricingIndex: 0.85, share: 0.17 },
    { label: "B", minScore: 640, maxScore: 719, pd: 0.022, pricingIndex: 1.0, share: 0.28 },
    { label: "C", minScore: 560, maxScore: 639, pd: 0.035, pricingIndex: 1.15, share: 0.25 },
    { label: "D", minScore: 450, maxScore: 559, pd: 0.055, pricingIndex: 1.3, share: 0.15 },
    { label: "E پرریسک", minScore: 250, maxScore: 449, pd: 0.09, pricingIndex: 1.45, share: 0.07 },
  ];
}

/** Assign each customer to its tier index. */
export function tierIndexOf(score: number, tiers: ScoreTier[]): number {
  for (let i = 0; i < tiers.length; i += 1) {
    if (score <= tiers[i].maxScore) return i;
  }
  return tiers.length - 1;
}

/** Empirical tier shares from a population (normalised). */
export function empiricalShares(population: Customer[], tiers: ScoreTier[]): number[] {
  const counts = new Array(tiers.length).fill(0) as number[];
  for (const c of population) counts[tierIndexOf(c.score, tiers)] += 1;
  const total = population.length || 1;
  return counts.map((c) => c / total);
}

/** Observed PD of the population implied by latent risk under a Vasicek shock z. */
export function populationPd(population: Customer[], z = 0, rho = 0.04): number {
  if (!population.length) return 0;
  const sum = population.reduce((acc, c) => acc + normCdf((normInv(clamp(0.004 + 0.12 * (c.latent + 1.5) / 3, 0.001, 0.6)) + Math.sqrt(rho) * z) / Math.sqrt(1 - rho)), 0);
  return sum / population.length;
}

/** Decile access gap: share of approved capacity reaching the bottom-4 deciles. */
export function decileAccessGap(population: Customer[], approvedIds: Set<number>): {
  bottomShare: number;
  topShare: number;
  gap: number;
} {
  if (!population.length) return { bottomShare: 0, topShare: 0, gap: 0 };
  const incomes = population.map((c) => c.income).sort((a, b) => a - b);
  const decile = (q: number) => incomes[Math.min(incomes.length - 1, Math.floor(q * incomes.length))];
  const d40 = decile(0.4);
  const d90 = decile(0.9);
  let bottom = 0;
  let top = 0;
  let bottomN = 0;
  let topN = 0;
  for (const c of population) {
    const isApproved = approvedIds.has(c.id);
    if (c.income <= d40) {
      bottomN += 1;
      if (isApproved) bottom += 1;
    }
    if (c.income >= d90) {
      topN += 1;
      if (isApproved) top += 1;
    }
  }
  const bottomShare = bottomN ? bottom / bottomN : 0;
  const topShare = topN ? top / topN : 0;
  return { bottomShare, topShare, gap: topShare - bottomShare };
}
