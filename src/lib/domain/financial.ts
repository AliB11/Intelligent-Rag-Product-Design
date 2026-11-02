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
export function sampleGamma(rng: Rng, shape: number, scale = 1): number {
  if (!Number.isFinite(shape) || shape <= 0 || !Number.isFinite(scale) || scale < 0) {
    throw new RangeError("Gamma shape must be positive and scale must be non-negative");
  }
  if (scale === 0) return 0;
  if (shape < 1) {
    const u = Math.max(Number.MIN_VALUE, rng());
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
    if (Math.log(Math.max(Number.MIN_VALUE, u)) < 0.5 * x * x + d * (1 - v + Math.log(v)))
      return d * v * scale;
  }
}

/** Draw a probability vector from a Dirichlet distribution. */
export function sampleDirichlet(rng: Rng, concentrations: number[]): number[] {
  if (!concentrations.length || concentrations.some((a) => !Number.isFinite(a) || a <= 0)) {
    throw new RangeError("Dirichlet concentrations must be a non-empty array of positive values");
  }
  const draws = concentrations.map((a) => sampleGamma(rng, a));
  const total = sum(draws);
  return total > 0 && Number.isFinite(total)
    ? draws.map((value) => value / total)
    : concentrations.map((value) => value / sum(concentrations));
}

/** Beta(alpha, beta) variate — used for the unblocked withdrawal fraction delta_m. */
export function sampleBeta(rng: Rng, a: number, b: number): number {
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) {
    throw new RangeError("Beta parameters must be positive finite numbers");
  }
  const x = sampleGamma(rng, a);
  const y = sampleGamma(rng, b);
  const total = x + y;
  return total === 0 ? a / (a + b) : x / total;
}

export const clamp = (v: number, lo: number, hi: number) =>
  Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo;

export const sum = (xs: number[]) => xs.reduce((acc, x) => acc + x, 0);

export const mean = (xs: number[]) => (xs.length ? sum(xs) / xs.length : 0);

/** numpy.percentile equivalent (linear interpolation), ignoring non-finite samples. */
export function percentile(values: number[], p: number): number {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return 0;
  const sorted = finite.sort((a, b) => a - b);
  const idx = clamp(p, 0, 100) / 100 * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/** numpy_financial.pmt — annuity installment for a monthly rate. */
export function pmt(rateMonthly: number, periods: number, present: number): number {
  if (![rateMonthly, periods, present].every(Number.isFinite)) {
    throw new RangeError("PMT inputs must be finite");
  }
  if (periods <= 0) return 0;
  if (rateMonthly <= -1) throw new RangeError("Monthly rate must be greater than -100%");
  if (Math.abs(rateMonthly) < 1e-12) return present / periods;
  const factor = Math.pow(1 + rateMonthly, periods);
  const denominator = factor - 1;
  if (denominator === 0 || !Number.isFinite(factor)) return NaN;
  return (present * rateMonthly * factor) / denominator;
}

/** numpy_financial.npv — flows[0] occurs at t = 0 when `firstAtZero` is true. */
export function npv(rate: number, flows: number[], firstAtZero = true): number {
  if (!Number.isFinite(rate) || rate <= -1 || flows.some((flow) => !Number.isFinite(flow))) {
    return NaN;
  }
  let acc = 0;
  for (let i = 0; i < flows.length; i += 1) {
    const t = firstAtZero ? i : i + 1;
    acc += flows[i] / Math.pow(1 + rate, t);
  }
  return acc;
}

/**
 * numpy_financial.irr — monthly internal rate of return solved inside a
 * bracketed interval. Returns NaN when no sign change exists in that interval.
 */
export function irr(flows: number[], guess = 0.02): number {
  if (flows.length < 2 || flows.some((flow) => !Number.isFinite(flow))) return NaN;
  if (!flows.some((flow) => flow > 0) || !flows.some((flow) => flow < 0)) return NaN;

  const f = (rate: number) => npv(rate, flows, true);
  let lo = -0.9;
  let hi = 10;
  let fLo = f(lo);
  let fHi = f(hi);
  if (!Number.isFinite(fLo) || !Number.isFinite(fHi) || Math.sign(fLo) === Math.sign(fHi)) return NaN;
  if (fLo === 0) return lo;
  if (fHi === 0) return hi;

  // Newton steps accelerate convergence, but every step remains bracketed.
  let rate = clamp(guess, lo + 1e-8, hi - 1e-8);
  for (let i = 0; i < 80; i += 1) {
    const value = f(rate);
    if (!Number.isFinite(value)) break;
    if (Math.abs(value) <= Math.max(1e-7, Math.abs(flows[0]) * 1e-12)) return rate;
    if (Math.sign(value) === Math.sign(fLo)) {
      lo = rate;
      fLo = value;
    } else {
      hi = rate;
      fHi = value;
    }
    let slope = 0;
    for (let t = 1; t < flows.length; t += 1) {
      slope -= (t * flows[t]) / Math.pow(1 + rate, t + 1);
    }
    const candidate = rate - value / slope;
    rate = Number.isFinite(candidate) && candidate > lo && candidate < hi
      ? candidate
      : (lo + hi) / 2;
    if (hi - lo < 1e-12) return (lo + hi) / 2;
  }

  for (let i = 0; i < 200; i += 1) {
    const mid = (lo + hi) / 2;
    const value = f(mid);
    if (!Number.isFinite(value)) return NaN;
    if (Math.abs(value) <= Math.max(1e-7, Math.abs(flows[0]) * 1e-12) || hi - lo < 1e-12) return mid;
    if (Math.sign(value) === Math.sign(fLo)) {
      lo = mid;
      fLo = value;
    } else {
      hi = mid;
      fHi = value;
    }
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
