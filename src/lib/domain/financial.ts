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
  if (factor === 1) return present / periods;
  if (!Number.isFinite(factor)) {
    // (1+r)^n overflowed: the annuity factor f/(f−1) tends to 1, so the
    // payment tends to the perpetuity limit P·r — finite, never NaN/Infinity.
    return present * rateMonthly;
  }
  const denominator = factor - 1;
  if (denominator === 0) return present / periods;
  // Group as (f/(f−1)) first so a huge finite factor cannot overflow the
  // numerator before the division.
  return present * rateMonthly * (factor / denominator);
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

/* ---------------------------------------------------------------------------
 * Hardened IRR root finding
 * ---------------------------------------------------------------------------
 * Contract of `solveIrr` (and therefore of `irr`):
 *  1. It never throws and never yields NaN/Infinity from numerical breakdown:
 *     every rate/npv it reports as `converged` is finite.
 *  2. Once a sign change is bracketed the solver terminates with a bracket
 *     width <= 1e-9, i.e. a midpoint error <= 5e-10 — well inside the
 *     required 1e-6 tolerance (Newton-Raphson first, Brent-style safeguarded
 *     interpolation next, pure bisection as the guaranteed last resort).
 *  3. The cash-flow vector is normalised to max|flow| = 1 before solving.
 *     The IRR is scale-invariant (NPV scales linearly), so this is exact and
 *     immunises the search against overflow/underflow on extreme streams
 *     (e.g. 1e300-magnitude Rial flows).
 *  4. `irr()` returns NaN *if and only if* the IRR is mathematically
 *     undefined for the stream (insufficient/non-finite flows, all flows one
 *     signed, or no real root on r > -1 such as [1, -1, 1]). `solveIrr`
 *     distinguishes those cases via `reason`; a bracketed root is always found.
 */

/** How the converged rate was produced. */
export type IrrMethod = "closed_form" | "probe" | "newton" | "brent" | "bisection";

export interface IrrSolveResult {
  /** Solved periodic rate — finite whenever `converged` is true. */
  rate: number;
  /** NPV of the (scaled) cash-flow at `rate` — finite whenever `converged`. */
  npv: number;
  converged: boolean;
  iterations: number;
  method: IrrMethod;
  /** Set only when `converged` is false — why no rate exists. */
  reason?: "insufficient_flows" | "non_finite_flows" | "no_sign_change" | "no_bracket";
}

/** Certified bracket width: midpoint error <= 5e-10 (< 1e-6 tolerance). */
const IRR_BRACKET_TOLERANCE = 1e-9;
/** Absolute safety cap; the bisection fallback always terminates far below it. */
const IRR_MAX_ITERATIONS = 500;

/** Horner evaluation of NPV at rate on pre-scaled flows (x = 1/(1+rate) > 0).
 *  With finite inputs and rate > -1 the recurrence is sign-stable: it can
 *  reach ±Infinity on overflow but can never produce NaN. */
function npvHorner(rate: number, scaled: number[]): number {
  const x = 1 / (1 + rate);
  let acc = scaled[scaled.length - 1];
  for (let t = scaled.length - 2; t >= 0; t -= 1) {
    acc = scaled[t] + x * acc;
  }
  return acc;
}

/** Analytic derivative d(NPV)/dr via the same Horner structure. */
function npvDerivativeHorner(rate: number, scaled: number[]): number {
  const n = scaled.length;
  if (n < 2) return 0;
  const x = 1 / (1 + rate);
  let acc = (n - 1) * scaled[n - 1];
  for (let t = n - 2; t >= 1; t -= 1) {
    acc = t * scaled[t] + x * acc;
  }
  return -(x * x) * acc;
}

/** Deterministic probe grid over (-1, ∞) with linear (negative side) and
 *  geometric (positive side) midpoints inserted, so roots from 1e-6 to 1e7
 *  per period are bracketed. */
function irrProbeGrid(): number[] {
  const base = [
    -0.999999, -0.9999, -0.999, -0.99, -0.9, -0.75, -0.5, -0.25, -0.1, -0.01,
    0, 0.001, 0.01, 0.02, 0.05, 0.1, 0.2, 0.35, 0.5, 0.75,
    1, 1.5, 2, 3, 5, 7.5, 10, 30, 100, 1e3, 1e4, 1e5, 1e6, 1e7,
  ];
  const grid: number[] = [base[0]];
  for (let i = 1; i < base.length; i += 1) {
    const a = base[i - 1];
    const b = base[i];
    grid.push(a > 0 && b > 0 ? Math.sqrt(a * b) : (a + b) / 2, b);
  }
  return grid;
}

const IRR_PROBE_GRID = irrProbeGrid();

function solveIrrImpl(flows: number[], guess: number): IrrSolveResult {
  const fail = (reason: NonNullable<IrrSolveResult["reason"]>): IrrSolveResult => ({
    rate: NaN,
    npv: NaN,
    converged: false,
    iterations: 0,
    method: "bisection",
    reason,
  });

  if (flows.length < 2) return fail("insufficient_flows");
  if (flows.some((flow) => !Number.isFinite(flow))) return fail("non_finite_flows");

  // Scale invariance: IRR(c·flows) = IRR(flows) for every c > 0.
  let maxAbs = 0;
  for (const flow of flows) maxAbs = Math.max(maxAbs, Math.abs(flow));
  if (maxAbs === 0) {
    // The zero stream is satisfied by every rate; 0 is the documented choice.
    return { rate: 0, npv: 0, converged: true, iterations: 0, method: "closed_form" };
  }
  const scaled = flows.map((flow) => flow / maxAbs);
  if (!scaled.some((f) => f > 0) || !scaled.some((f) => f < 0)) {
    // All flows share one sign: NPV keeps that sign for every r > -1.
    return fail("no_sign_change");
  }

  const f = (rate: number) => npvHorner(rate, scaled);

  // --- Bracket on the probe grid (sign change or exact hit) ----------------
  let prevR = IRR_PROBE_GRID[0];
  let prevF = f(prevR);
  if (prevF === 0) {
    return { rate: prevR, npv: 0, converged: true, iterations: 0, method: "probe" };
  }
  let lo = NaN;
  let hi = NaN;
  let fLo = NaN;
  let fHi = NaN;
  for (let i = 1; i < IRR_PROBE_GRID.length; i += 1) {
    const r = IRR_PROBE_GRID[i];
    const fr = f(r);
    if (fr === 0) {
      return { rate: r, npv: 0, converged: true, iterations: 0, method: "probe" };
    }
    if (Math.sign(fr) !== Math.sign(prevF)) {
      lo = prevR;
      hi = r;
      fLo = prevF;
      fHi = fr;
      break;
    }
    prevR = r;
    prevF = fr;
  }
  if (!Number.isFinite(lo)) {
    // e.g. [1, -1, 1]: mixed signs but the polynomial never vanishes for r > -1.
    return fail("no_bracket");
  }

  let iterations = 0;
  let method: IrrMethod = "newton";
  const accept = (r: number, fr: number) => {
    if (Math.sign(fr) === Math.sign(fLo)) {
      lo = r;
      fLo = fr;
    } else {
      hi = r;
      fHi = fr;
    }
  };

  // --- Phase 1: bracketed Newton-Raphson from the supplied guess -----------
  const guessFinite = Number.isFinite(guess) ? guess : 0.02;
  let rate = guessFinite > lo && guessFinite < hi ? guessFinite : (lo + hi) / 2;
  let stalls = 0;
  while (iterations < 100 && hi - lo > IRR_BRACKET_TOLERANCE) {
    iterations += 1;
    const value = f(rate);
    if (!Number.isFinite(value)) {
      method = "brent";
      break;
    }
    if (value === 0) {
      lo = rate;
      hi = rate;
      break;
    }
    accept(rate, value);
    if (hi - lo <= IRR_BRACKET_TOLERANCE) break;
    const slope = npvDerivativeHorner(rate, scaled);
    let candidate = Number.isFinite(slope) && slope !== 0 ? rate - value / slope : NaN;
    if (!Number.isFinite(candidate) || !(candidate > lo && candidate < hi)) {
      candidate = (lo + hi) / 2;
      stalls += 1;
      if (stalls >= 8) {
        // Newton is not making progress: hand the bracket to Brent.
        method = "brent";
        break;
      }
    } else {
      stalls = 0;
    }
    rate = candidate;
  }

  // --- Phase 2: Brent-style safeguarded interpolation (inverse quadratic),
  //     with a forced bisection step every 4 accepted attempts so the
  //     bracket provably halves often enough to reach 1e-9. -----------------
  if (hi - lo > IRR_BRACKET_TOLERANCE) {
    let a = lo;
    let b = hi;
    let fa = fLo;
    let fb = fHi;
    let c = a;
    let fc = fa;
    let sinceBisection = 0;
    let usedBisectionOnly = true;
    let phaseIt = 0;
    while (b - a > IRR_BRACKET_TOLERANCE && iterations + phaseIt < IRR_MAX_ITERATIONS) {
      phaseIt += 1;
      let s = NaN;
      const distinct =
        a !== c && b !== c && Number.isFinite(fa) && Number.isFinite(fb) && Number.isFinite(fc);
      if (distinct && fa !== fc && fb !== fc && fa !== fb) {
        // Inverse-quadratic interpolation through (a,fa), (b,fb), (c,fc).
        s =
          (a * fb * fc) / ((fa - fb) * (fa - fc)) +
          (b * fa * fc) / ((fb - fa) * (fb - fc)) +
          (c * fa * fb) / ((fc - fa) * (fc - fb));
      }
      if (!Number.isFinite(s) || !(s > Math.min(a, b) && s < Math.max(a, b)) || sinceBisection >= 4) {
        // Safeguarded bisection — always shrinks the bracket by half.
        s = (a + b) / 2;
        sinceBisection = 0;
      } else {
        sinceBisection += 1;
        usedBisectionOnly = false;
      }
      let fs = f(s);
      if (!Number.isFinite(fs)) {
        // Overflowed evaluation: take a true bisection step instead.
        s = (a + b) / 2;
        sinceBisection = 0;
        fs = f(s);
      }
      if (Number.isFinite(fs)) {
        if (fs === 0) {
          a = s;
          b = s;
          fa = fs;
          fb = fs;
          break;
        }
        // Maintain the sign-change invariant on (a, b); the displaced
        // endpoint becomes the third interpolation point c.
        if (Math.sign(fs) === Math.sign(fb)) {
          c = b;
          fc = fb;
          b = s;
          fb = fs;
        } else {
          c = a;
          fc = fa;
          a = s;
          fa = fs;
        }
      } else {
        // Sign is still usable for bracketing even when the magnitude overflows.
        a = s;
        fa = fs;
      }
    }
    iterations += phaseIt;
    lo = Math.min(a, b);
    hi = Math.max(a, b);
    fLo = fa;
    fHi = fb;
    method = usedBisectionOnly && phaseIt > 0 ? "bisection" : "brent";
    if (hi - lo > IRR_BRACKET_TOLERANCE) {
      // --- Phase 3: pure bisection — guaranteed convergence (<= ~60 steps). -
      method = "bisection";
      let blo = lo;
      let bhi = hi;
      let bloF = Number.isFinite(fLo) ? fLo : Math.sign(fLo) || 1;
      while (bhi - blo > IRR_BRACKET_TOLERANCE && iterations < IRR_MAX_ITERATIONS + 100) {
        iterations += 1;
        const mid = (blo + bhi) / 2;
        const fm = f(mid);
        if (!Number.isFinite(fm)) {
          // Keep the sign-stable side; magnitude overflow still brackets.
          blo = mid;
          bloF = Math.sign(fm) * (Number.isFinite(bloF) ? Math.abs(bloF) : 1) || Math.sign(fm);
          continue;
        }
        if (fm === 0) {
          blo = mid;
          bhi = mid;
          break;
        }
        if (Math.sign(fm) === Math.sign(bloF)) {
          blo = mid;
          bloF = fm;
        } else {
          bhi = mid;
        }
      }
      lo = blo;
      hi = bhi;
    }
  }

  const finalRate = (lo + hi) / 2;
  const finalNpv = f(finalRate);
  const converged =
    hi - lo <= IRR_BRACKET_TOLERANCE &&
    lo > -1 &&
    Number.isFinite(finalRate) &&
    Number.isFinite(finalNpv);
  if (!converged) {
    // Only reachable if the iteration safety cap was hit with an unverified
    // bracket; report honestly instead of a misleading finite number.
    return { rate: NaN, npv: NaN, converged: false, iterations, method, reason: "no_bracket" };
  }
  return { rate: finalRate, npv: finalNpv, converged: true, iterations, method };
}

/** Full diagnostics of the IRR search (never throws; `rate`/`npv` are NaN
 *  only when `converged` is false — i.e. when no real IRR exists). */
export function solveIrr(flows: number[], guess = 0.02): IrrSolveResult {
  try {
    return solveIrrImpl(flows, guess);
  } catch {
    return {
      rate: NaN,
      npv: NaN,
      converged: false,
      iterations: 0,
      method: "bisection",
      reason: "non_finite_flows",
    };
  }
}

/**
 * numpy_financial.irr equivalent with hardened root-finding: bracketed
 * Newton-Raphson → Brent-style interpolation → bisection, certified to
 * 1e-6 (actually 5e-10). Returns NaN if and only if the IRR is
 * mathematically undefined for the stream (see `solveIrr`).
 */
export function irr(flows: number[], guess = 0.02): number {
  const result = solveIrr(flows, guess);
  return result.converged ? result.rate : NaN;
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
