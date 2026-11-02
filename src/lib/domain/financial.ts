/**
 * app/domain/financial.ts (TypeScript twin)
 * ---------------------------------------------------------------------------
 * Pure numerical primitives: deterministic PRNG, distribution sampling,
 * IRR / NPV / PMT (numpy-financial equivalents), percentiles.
 * 100% deterministic given a seed -> unit-testable, no LLM involvement.
 */

/** mulberry32 — small, fast, fully deterministic PRNG. */
export function createRng(seed: number) {
  let a = seed >>> 0;
  return function rng(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Rng = () => number;

/** Box–Muller standard normal. */
export function sampleNormal(rng: Rng, mean = 0, sd = 1): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Marsaglia–Tsang gamma variate (shape > 0). */
function sampleGamma(rng: Rng, shape: number, scale = 1): number {
  if (shape < 1) {
    const u = rng();
    return sampleGamma(rng, shape + 1, scale) * Math.pow(u, 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      x = sampleNormal(rng);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rng();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v * scale;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v * scale;
  }
}

/** Beta(alpha, beta) variate — used for the unblocked withdrawal fraction delta_m. */
export function sampleBeta(rng: Rng, a: number, b: number): number {
  const x = sampleGamma(rng, a);
  const y = sampleGamma(rng, b);
  const s = x + y;
  return s === 0 ? a / (a + b) : x / s;
}

export const clamp = (v: number, lo: number, hi: number) =>
  Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo;

export const sum = (xs: number[]) => xs.reduce((acc, x) => acc + x, 0);

export const mean = (xs: number[]) => (xs.length ? sum(xs) / xs.length : 0);

/** numpy.percentile equivalent (linear interpolation). */
export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = clamp(p, 0, 100) / 100 * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/** numpy_financial.pmt — annuity installment for a monthly rate. */
export function pmt(rateMonthly: number, periods: number, present: number): number {
  if (periods <= 0) return 0;
  if (Math.abs(rateMonthly) < 1e-12) return present / periods;
  const factor = Math.pow(1 + rateMonthly, periods);
  return (present * rateMonthly * factor) / (factor - 1);
}

/** numpy_financial.npv — flows[0] occurs at t = 0 when `firstAtZero` is true. */
export function npv(rate: number, flows: number[], firstAtZero = true): number {
  let acc = 0;
  for (let i = 0; i < flows.length; i += 1) {
    const t = firstAtZero ? i : i + 1;
    acc += flows[i] / Math.pow(1 + rate, t);
  }
  return acc;
}

/**
 * numpy_financial.irr — monthly internal rate of return solved with a
 * bracketed bisection + Newton polish. Returns NaN when no sign change exists.
 */
export function irr(flows: number[], guess = 0.02): number {
  if (flows.length < 2) return NaN;
  const hasPositive = flows.some((f) => f > 0);
  const hasNegative = flows.some((f) => f < 0);
  if (!hasPositive || !hasNegative) return NaN;

  const f = (r: number) => npv(r, flows, true);

  let lo = -0.9;
  let hi = 10;
  if (f(lo) * f(hi) > 0) return NaN;
  // Newton polish seeded from the guess, falls back to bisection.
  let r = clamp(guess, lo + 1e-6, hi - 1e-6);
  for (let i = 0; i < 60; i += 1) {
    const value = f(r);
    const dr = 1e-6;
    const slope = (f(r + dr) - value) / dr;
    if (!Number.isFinite(slope) || Math.abs(slope) < 1e-14) break;
    const next = r - value / slope;
    if (!Number.isFinite(next) || next <= lo || next >= hi) break;
    if (Math.abs(next - r) < 1e-10) return next;
    r = next;
  }
  for (let i = 0; i < 200; i += 1) {
    const mid = (lo + hi) / 2;
    const value = f(mid);
    if (Math.abs(value) < 1e-7 || hi - lo < 1e-10) return mid;
    if (f(lo) * value < 0) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

/** Annualised effective rate from a monthly rate. */
export const annualise = (monthly: number) => Math.pow(1 + monthly, 12) - 1;

/** Deterministic string hash -> 32-bit seed. */
export function seedFromString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
