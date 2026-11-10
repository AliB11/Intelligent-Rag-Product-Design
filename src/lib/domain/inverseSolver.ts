/**
 * Deterministic Inverse Product Solver
 * ---------------------------------------------------------------------------
 * Solves the INVERSE DESIGN PROBLEM: given profitability, competitiveness and
 * liquidity targets plus the executable `RegulatoryConstraints` envelope from
 * Phase 2, find the seven decision variables
 *
 *   deposit_retention_months   T_wait   (Phase A length)
 *   loan_to_deposit_multiplier M
 *   blocked_deposit_pct        B
 *   loan_interest_rate         r_loan
 *   deposit_interest_rate      r_dep
 *   fee_rate                   fee
 *   repayment_months           N
 *
 * that MAXIMIZE risk-adjusted bank NII (post-cannibalization) subject to
 *
 *   (C1) bank IRR (annualised, cohort cash-flows) ≥ target_bank_irr_min
 *   (C2) customer deposit yield r_dep ≥ target_customer_irr_min
 *        (opportunity-cost competitiveness floor — the deposit rate solves
 *         exactly onto this floor because it is a pure cost otherwise)
 *   (C3) borrower nominal-equivalent rate (compensating-balance IRR that
 *        inflates with fees AND blocked collateral — the hidden-usury
 *        metric) ≤ effective_rate_cap of the envelope
 *   (C4) peak cumulative liquidity deficit ≥ −max_liquidity_gap_limit
 *        (the worst financing need, which for T_wait = 3 occurs at the
 *         month-4 origination surge)
 *   (C5) hard envelope bounds: r_loan ≤ min(max_loan_interest_rate,
 *        effective_rate_cap), fee ≤ max_fee_rate, blocked = 0 when
 *        collateral is forbidden, reserve ≥ min_reserve_ratio
 *
 * Algorithm — Smart Grid + Local Refinement (fully deterministic, no RNG):
 *   Stage 1  coarse structural grid (T_wait × N × M × B) × fee ladder, with
 *            r_loan placed at its LARGEST value still satisfying C3 via a
 *            monotone bisection (the objective is increasing in r_loan, so
 *            the optimum always sits on the C3 boundary for each fee level).
 *   Stage 2  coordinate pattern search around the top candidates with
 *            halving steps until no improvement or the evaluation budget
 *            (6000) is exhausted.
 *
 * Typical runtime < 150 ms for a 60–73 month horizon — well inside the
 * 500 ms serverless budget. Total, NaN-free and replay-identical.
 */

import { z } from "zod";
import { CAPITAL, REGULATORY } from "./constants";
import { ALM_CALIBRATION } from "./almSimulator";
import { annualise, irr, pmt } from "./financial";
import {
  applyReserveFloor,
  clampBlockedRatioToConstraints,
  clampFeeRateToConstraints,
  clampLoanRateToConstraints,
  regulatoryConstraintsSchema,
  type RegulatoryConstraints,
} from "./regulatory";
import { computeCannibalization } from "./cannibalization";
import { projectCohortLiquidity, type CohortInput } from "./cohortModel";

export interface InverseSolverBounds {
  depositRetentionMonths: [number, number];
  loanToDepositMultiplier: [number, number];
  blockedDepositPct: [number, number];
  loanInterestRate: [number, number];
  depositInterestRate: [number, number];
  feeRate: [number, number];
  repaymentMonths: [number, number];
}

export const inverseSolverInputSchema = z
  .object({
    targetBankIrrMin: z.number().finite().min(0).max(1),
    targetCustomerIrrMin: z.number().finite().min(0).max(1),
    /** Peak cumulative financing deficit may not exceed this magnitude (Rial). */
    maxLiquidityGapLimit: z.number().finite().min(0),
    regulatoryConstraints: regulatoryConstraintsSchema,
    depositVolumeRial: z.number().finite().min(1),
    cannibalizationRate: z.number().min(0).max(1),
    sourceDepositCost: z.number().finite().min(0).max(1),
    unblockedRunoffRate: z.number().min(0).max(1),
    statutoryReserveBase: z.number().finite().min(0).max(0.95),
    pd: z.number().finite().min(0).max(1),
    lgd: z.number().finite().min(0).max(1),
    liquidityDeduction: z.number().finite().min(0).max(0.95).optional(),
    opexRatio: z.number().finite().min(0).max(1).optional(),
    treasuryRate: z.number().finite().min(0).max(1).optional(),
    bounds: z
      .object({
        depositRetentionMonths: z.tuple([z.number().int().min(1), z.number().int().min(1)]),
        loanToDepositMultiplier: z.tuple([z.number().min(0), z.number().min(0)]),
        blockedDepositPct: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]),
        loanInterestRate: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]),
        depositInterestRate: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]),
        feeRate: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]),
        repaymentMonths: z.tuple([z.number().int().min(1), z.number().int().min(1)]),
      })
      .partial()
      .optional(),
  })
  .strict();

export type InverseSolverInput = z.output<typeof inverseSolverInputSchema>;

export interface DecisionVector {
  depositRetentionMonths: number;
  loanToDepositMultiplier: number;
  blockedDepositPct: number;
  loanInterestRate: number;
  depositInterestRate: number;
  feeRate: number;
  repaymentMonths: number;
}

export interface InverseSolverMetrics {
  /** Annualised IRR of the cohort bank cash-flows. */
  bankIrrAnnual: number;
  /** 12 × monthly IRR of the borrower's net position (cap-compared rate). */
  borrowerNominalEquivalent: number;
  /** True effective annual cost of the borrower: (1+m)^12 − 1 (disclosure). */
  borrowerEffectiveAnnual: number;
  customerDepositYield: number;
  worstMonthlyGapRial: number;
  worstCumulativeGapRial: number;
  breakevenMonth: number | null;
  riskAdjustedNiiRial: number;
  netInterestIncomeRial: number;
  marginalCostOfFunds: number;
  lostSpreadOnCannibalizedRial: number;
}

export interface InverseSolverResult {
  solution: DecisionVector;
  metrics: InverseSolverMetrics;
  feasible: boolean;
  violations: string[];
  /** Risk-adjusted NII (minus constraint penalties when infeasible). */
  objective: number;
  evaluations: number;
  elapsedMs: number;
}

const MAX_EVALUATIONS = 6000;
const BISECTION_STEPS = 12;

interface SolverContext {
  env: RegulatoryConstraints;
  D: number;
  alpha: number;
  rSrc: number;
  runoff: number;
  reserveBase: number;
  pd: number;
  lgd: number;
  liquidityDeduction?: number;
  opexRatio?: number;
  treasuryRate?: number;
  targetBankIrrMin: number;
  targetCustomerIrrMin: number;
  gapLimit: number;
  rateCapMax: number;
  feeCap: number;
  blockedMax: number;
  rDepFloor: number;
  rDepCeil: number;
}

interface EvalResult {
  solution: DecisionVector;
  metrics: InverseSolverMetrics;
  feasible: boolean;
  violations: string[];
  objective: number;
  /** Constraint penalty in Rial (0 when feasible). */
  penalty: number;
}

function clampInt(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Math.round(value)));
}

function clampNum(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/** Borrower's net flows: usable proceeds (loan − fee − locked collateral)
 *  against the annuity instalments. The locked collateral acts as a
 *  compensating balance and INFLATES the effective rate — the hidden-usury
 *  mechanism the committee audits. */
function borrowerFlows(x: {
  loanBookRial: number;
  feeRate: number;
  blockedAmountRial: number;
  repaymentMonths: number;
  loanInterestRate: number;
}): number[] {
  const proceeds =
    x.loanBookRial * (1 - x.feeRate) - Math.min(x.blockedAmountRial, x.loanBookRial);
  const instalment =
    x.loanBookRial > 0
      ? pmt(x.loanInterestRate / 12, x.repaymentMonths, x.loanBookRial)
      : 0;
  const flows = new Array<number>(x.repaymentMonths + 1);
  flows[0] = proceeds;
  for (let i = 1; i <= x.repaymentMonths; i += 1) flows[i] = -instalment;
  return flows;
}

/** Evaluate one decision vector: cohort + cannibalization + IRRs + C1..C5. */
function evaluate(
  x: DecisionVector,
  ctx: SolverContext,
  counters: { evaluations: number },
): EvalResult {
  counters.evaluations += 1;
  // C5 — defensive envelope clamps (bounds already enforce them).
  const rLoan = clampLoanRateToConstraints(x.loanInterestRate, ctx.env);
  const fee = clampFeeRateToConstraints(x.feeRate, ctx.env);
  const blocked = clampBlockedRatioToConstraints(x.blockedDepositPct, ctx.env);
  const rDep = clampNum(x.depositInterestRate, 0, 1);
  const reserve = applyReserveFloor(ctx.reserveBase, ctx.env);
  const T = clampInt(x.depositRetentionMonths, 1, 60);
  const N = clampInt(x.repaymentMonths, 1, 360);
  const M = Math.max(0, x.loanToDepositMultiplier);

  const solution: DecisionVector = {
    depositRetentionMonths: T,
    loanToDepositMultiplier: M,
    blockedDepositPct: blocked,
    loanInterestRate: rLoan,
    depositInterestRate: rDep,
    feeRate: fee,
    repaymentMonths: N,
  };

  const cohort = projectCohortLiquidity({
    depositVolumeRial: ctx.D,
    loanToDepositMultiplier: M,
    depositRetentionMonths: T,
    repaymentMonths: N,
    blockedDepositPct: blocked,
    unblockedRunoffRate: ctx.runoff,
    loanInterestRate: rLoan,
    depositInterestRate: rDep,
    feeRate: fee,
    statutoryReserve: reserve,
    liquidityDeduction: ctx.liquidityDeduction,
    pd: ctx.pd,
    lgd: ctx.lgd,
    treasuryRate: ctx.treasuryRate,
  });

  const cann = computeCannibalization({
    depositVolumeRial: ctx.D,
    loanToDepositMultiplier: M,
    cannibalizationRate: ctx.alpha,
    sourceDepositCost: ctx.rSrc,
    depositInterestRate: rDep,
    loanInterestRate: rLoan,
    feeRate: fee,
    statutoryReserve: reserve,
    liquidityDeduction: ctx.liquidityDeduction,
    opexRatio: ctx.opexRatio,
    expectedLossRate: ctx.pd * ctx.lgd,
    treasuryRate: ctx.treasuryRate,
  });

  // Bank IRR on the ECONOMICS of the product (P&L flows), anchored by the
  // economic capital the bank must hold against the book — the repo's
  // CAPITAL convention. Principal movements (deposit in / disbursement /
  // instalment principal) are balance-sheet events and do NOT belong in the
  // return stream; only interest, fees, treasury, deposit cost, opex and
  // expected loss do. Capital is charged at t0 and released at the horizon
  // end (book run-off), giving a meaningful annualised project return.
  const loanBook = M * ctx.D;
  const blockedAmount = blocked * ctx.D;
  const economicCapital =
    CAPITAL.capitalToLoans * loanBook + CAPITAL.hqlaToDeposits * ctx.D;
  const setupCost = ctx.D * ALM_CALIBRATION.programSetupCostRate;
  // P&L rows come straight from the cohort ledger (single source of truth:
  // capacity-capped treasury, wholesale gap cost, opex on usable funds).
  const economicFlows = new Array<number>(cohort.months.length);
  for (let i = 0; i < cohort.months.length; i += 1) {
    const row = cohort.months[i];
    economicFlows[i] =
      row.loanInterestIncomeRial +
      row.feeIncomeRial +
      row.treasuryInflowRial -
      row.depositInterestOutflowRial -
      row.opexOutflowRial -
      row.defaultLossRial -
      row.wholesaleCostOutflowRial;
  }
  if (economicFlows.length > 0) {
    economicFlows[0] -= economicCapital + setupCost;
    economicFlows[economicFlows.length - 1] += economicCapital * ALM_CALIBRATION.capitalReleaseFactor;
  }
  const monthlyBankIrr = irr(economicFlows, 0.02);
  const bankIrrAnnual = Number.isFinite(monthlyBankIrr) ? annualise(monthlyBankIrr) : NaN;

  const monthlyBorrower = (() => {
    if (loanBook <= 0) return 0;
    const solved = irr(
      borrowerFlows({
        loanBookRial: loanBook,
        feeRate: fee,
        blockedAmountRial: blockedAmount,
        repaymentMonths: N,
        loanInterestRate: rLoan,
      }),
      0.02,
    );
    return Number.isFinite(solved) ? solved : NaN;
  })();
  const borrowerNominal = Number.isFinite(monthlyBorrower) ? 12 * monthlyBorrower : NaN;
  const borrowerEffective = Number.isFinite(monthlyBorrower) ? annualise(monthlyBorrower) : NaN;

  const metrics: InverseSolverMetrics = {
    bankIrrAnnual: Number.isFinite(bankIrrAnnual) ? bankIrrAnnual : 0,
    borrowerNominalEquivalent: Number.isFinite(borrowerNominal) ? borrowerNominal : 0,
    borrowerEffectiveAnnual: Number.isFinite(borrowerEffective) ? borrowerEffective : 0,
    customerDepositYield: rDep,
    worstMonthlyGapRial: cohort.worstMonthlyGapRial,
    worstCumulativeGapRial: cohort.worstCumulativeGapRial,
    breakevenMonth: cohort.breakevenMonth,
    riskAdjustedNiiRial: cann.riskAdjustedNiiRial,
    netInterestIncomeRial: cann.netInterestIncomeRial,
    marginalCostOfFunds: cann.marginalCostOfFunds,
    lostSpreadOnCannibalizedRial: cann.lostSpreadOnCannibalizedRial,
  };

  // ---- Constraints C1..C5 (violations are Rial-scaled penalties) ----------
  const violations: string[] = [];
  let penalty = 0;
  const rateScale = ctx.D; // 1% of the deposit base ≈ one penalty unit

  if (!Number.isFinite(bankIrrAnnual) || bankIrrAnnual < ctx.targetBankIrrMin - 1e-9) {
    const shortfall = Number.isFinite(bankIrrAnnual)
      ? ctx.targetBankIrrMin - bankIrrAnnual
      : ctx.targetBankIrrMin + 0.5;
    violations.push(
      `bank IRR ${(Number.isFinite(bankIrrAnnual) ? bankIrrAnnual : 0).toFixed(4)} below target ${ctx.targetBankIrrMin.toFixed(4)}`,
    );
    penalty += shortfall * rateScale;
  }
  if (rDep < ctx.targetCustomerIrrMin - 1e-12) {
    violations.push(
      `deposit yield ${rDep.toFixed(4)} below customer floor ${ctx.targetCustomerIrrMin.toFixed(4)}`,
    );
    penalty += (ctx.targetCustomerIrrMin - rDep) * rateScale;
  }
  if (!Number.isFinite(borrowerNominal) || borrowerNominal > ctx.env.effective_rate_cap + 1e-9) {
    const breach = Number.isFinite(borrowerNominal)
      ? borrowerNominal - ctx.env.effective_rate_cap
      : 0.5;
    violations.push(
      `borrower effective rate ${(Number.isFinite(borrowerNominal) ? borrowerNominal : 0).toFixed(4)} breaches regulatory cap ${ctx.env.effective_rate_cap.toFixed(4)}`,
    );
    penalty += Math.max(0, breach) * rateScale + (Number.isFinite(borrowerNominal) ? 0 : rateScale);
  }
  if (cohort.worstCumulativeGapRial < -ctx.gapLimit) {
    const excess = -ctx.gapLimit - cohort.worstCumulativeGapRial;
    const monthOfWorst = cohort.months.find(
      (m) => m.cumulativeCashflowRial === cohort.worstCumulativeGapRial,
    )?.month;
    violations.push(
      `month-${monthOfWorst ?? "?"} liquidity gap exceeds limit by ${(excess / 1e9).toFixed(1)}B Rial`,
    );
    penalty += excess;
  }
  // Structural bounds (defensive — the search respects them by construction).
  if (rLoan > ctx.rateCapMax + 1e-12 || fee > ctx.feeCap + 1e-12 || blocked > ctx.blockedMax + 1e-12) {
    violations.push("decision variable outside regulatory envelope bounds");
    penalty += rateScale;
  }

  const feasible = violations.length === 0;
  const objective = cann.riskAdjustedNiiRial - penalty;
  return { solution, metrics, feasible, violations, objective, penalty };
}

/**
 * Rank: feasible first; among infeasible candidates the LEAST total
 * violation wins (so an unattainable target still returns the structure
 * closest to feasibility for the critique loop), then the objective, then a
 * lexicographic tie-break for full determinism.
 */
function better(a: EvalResult, b: EvalResult): boolean {
  if (a.feasible !== b.feasible) return a.feasible;
  if (!a.feasible && a.penalty !== b.penalty) return a.penalty < b.penalty;
  if (a.objective !== b.objective) return a.objective > b.objective;
  const av = a.solution;
  const bv = b.solution;
  return (
    av.depositRetentionMonths < bv.depositRetentionMonths ||
    (av.depositRetentionMonths === bv.depositRetentionMonths &&
      (av.loanToDepositMultiplier < bv.loanToDepositMultiplier ||
        (av.loanToDepositMultiplier === bv.loanToDepositMultiplier &&
          (av.blockedDepositPct < bv.blockedDepositPct ||
            (av.blockedDepositPct === bv.blockedDepositPct &&
              (av.loanInterestRate < bv.loanInterestRate ||
                (av.loanInterestRate === bv.loanInterestRate &&
                  (av.depositInterestRate < bv.depositInterestRate ||
                    (av.depositInterestRate === bv.depositInterestRate &&
                      av.repaymentMonths < bv.repaymentMonths)))))))))
  );
}

/**
 * Largest loan rate whose borrower nominal-equivalent stays ≤ cap.
 * Monotone in r_loan → plain bisection, borrower-flow evaluations only
 * (no cohort projection) so it is extremely cheap.
 */
function maxLoanRateUnderBorrowerCap(
  base: Omit<DecisionVector, "loanInterestRate">,
  ctx: SolverContext,
  counters: { evaluations: number },
): number {
  const cap = ctx.env.effective_rate_cap;
  const nominalAt = (rLoan: number): number => {
    counters.evaluations += 1;
    const m = irr(
      borrowerFlows({
        loanBookRial: base.loanToDepositMultiplier * ctx.D,
        feeRate: clampFeeRateToConstraints(base.feeRate, ctx.env),
        blockedAmountRial:
          clampBlockedRatioToConstraints(base.blockedDepositPct, ctx.env) * ctx.D,
        repaymentMonths: base.repaymentMonths,
        loanInterestRate: rLoan,
      }),
      0.02,
    );
    return Number.isFinite(m) ? 12 * m : NaN;
  };
  let hi = ctx.rateCapMax;
  const atHi = nominalAt(hi);
  if (Number.isFinite(atHi) && atHi <= cap) return hi;
  let lo = 0;
  const atLo = nominalAt(lo);
  if (!Number.isFinite(atLo) || atLo > cap) return 0;
  for (let i = 0; i < BISECTION_STEPS; i += 1) {
    const mid = (lo + hi) / 2;
    const nominal = nominalAt(mid);
    if (Number.isFinite(nominal) && nominal <= cap) lo = mid;
    else hi = mid;
  }
  return lo;
}

function uniqueSorted(values: number[]): number[] {
  return Array.from(new Set(values)).sort((a, b) => a - b);
}

export function solveInverseProduct(raw: InverseSolverInput): InverseSolverResult {
  const started = Date.now();
  const input = inverseSolverInputSchema.parse(raw);
  const env = input.regulatoryConstraints;

  const rateCapMax = clampLoanRateToConstraints(1, env);
  const feeCap = env.max_fee_rate;
  const blockedMax = env.allow_blocked_deposit_collateral ? 1 : 0;
  const rDepFloor = Math.max(input.targetCustomerIrrMin, 0);
  const rDepCeil = Math.min(REGULATORY.absoluteRateCeiling, 1);

  const userBounds = input.bounds ?? {};
  const bT = userBounds.depositRetentionMonths ?? [1, 12];
  const bM = userBounds.loanToDepositMultiplier ?? [0.5, 3];
  const bB: [number, number] = [
    Math.max(userBounds.blockedDepositPct?.[0] ?? 0, 0),
    Math.min(userBounds.blockedDepositPct?.[1] ?? 0.65, blockedMax),
  ];
  const bRL: [number, number] = [
    Math.max(userBounds.loanInterestRate?.[0] ?? 0, 0),
    Math.min(userBounds.loanInterestRate?.[1] ?? rateCapMax, rateCapMax),
  ];
  const bRD: [number, number] = [
    Math.max(userBounds.depositInterestRate?.[0] ?? rDepFloor, rDepFloor),
    Math.min(userBounds.depositInterestRate?.[1] ?? rDepCeil, rDepCeil),
  ];
  const bF: [number, number] = [
    Math.max(userBounds.feeRate?.[0] ?? 0, 0),
    Math.min(userBounds.feeRate?.[1] ?? feeCap, feeCap),
  ];
  const bN = userBounds.repaymentMonths ?? [12, 60];

  const ctx: SolverContext = {
    env,
    D: input.depositVolumeRial,
    alpha: input.cannibalizationRate,
    rSrc: input.sourceDepositCost,
    runoff: input.unblockedRunoffRate,
    reserveBase: input.statutoryReserveBase,
    pd: input.pd,
    lgd: input.lgd,
    liquidityDeduction: input.liquidityDeduction,
    opexRatio: input.opexRatio,
    treasuryRate: input.treasuryRate,
    targetBankIrrMin: input.targetBankIrrMin,
    targetCustomerIrrMin: input.targetCustomerIrrMin,
    gapLimit: input.maxLiquidityGapLimit,
    rateCapMax,
    feeCap,
    blockedMax,
    rDepFloor: bRD[0],
    rDepCeil: bRD[1],
  };

  const counters = { evaluations: 0 };
  const budgetExhausted = () => counters.evaluations >= MAX_EVALUATIONS;

  // Degenerate: the customer floor alone is unattainable.
  if (bRD[0] > bRD[1] + 1e-12 || bRL[0] > bRL[1] + 1e-12 || bB[0] > bB[1] + 1e-12) {
    const fallback: DecisionVector = {
      depositRetentionMonths: clampInt(bT[0], bT[0], bT[1]),
      loanToDepositMultiplier: bM[0],
      blockedDepositPct: Math.max(0, bB[0]),
      loanInterestRate: Math.max(0, bRL[0]),
      depositInterestRate: Math.max(0, bRD[0]),
      feeRate: Math.max(0, bF[0]),
      repaymentMonths: clampInt(bN[0], bN[0], bN[1]),
    };
    const evaluated = evaluate(fallback, ctx, counters);
    return {
      ...evaluated,
      evaluations: counters.evaluations,
      elapsedMs: Date.now() - started,
      violations: [
        ...evaluated.violations,
        "requested target/bounds are mutually unattainable inside the envelope",
      ],
      feasible: false,
    };
  }

  // ---------------- Stage 1: smart coarse grid ----------------------------
  const tGrid = uniqueSorted(
    [bT[0], Math.min(bT[1], 1), 3, 6, 9, Math.max(bT[0], 12)].filter(
      (v) => v >= bT[0] && v <= bT[1],
    ),
  );
  const nGrid = uniqueSorted(
    [bN[0], 12, 18, 24, 36, 48, 60, bN[1]].filter((v) => v >= bN[0] && v <= bN[1]),
  );
  const mGrid = uniqueSorted(
    [bM[0], 0.8, 1.2, 1.6, 2.2, bM[1]].filter((v) => v >= bM[0] && v <= bM[1]),
  );
  const bGrid = uniqueSorted(
    [bB[0], 0.15, 0.3, bB[1]].filter((v) => v >= bB[0] && v <= bB[1]),
  );
  const feeGrid = uniqueSorted(
    [bF[0], (bF[0] + bF[1]) / 2, bF[1]].filter((v) => v >= bF[0] && v <= bF[1]),
  );
  // The deposit rate is a pure cost above its competitiveness floor → solve
  // onto the floor; keep one exploratory tick above it for refinement.
  const rDepGrid = uniqueSorted(
    [bRD[0], Math.min(bRD[1], bRD[0] + 0.01)].filter((v) => v >= bRD[0] && v <= bRD[1]),
  );

  let best: EvalResult | null = null;
  // Functional update (not a closure mutation) so TypeScript's control-flow
  // analysis keeps `best` properly typed across the search.
  const consider = (candidate: EvalResult, current: EvalResult | null): EvalResult =>
    !current || better(candidate, current) ? candidate : current;

  for (const T of tGrid) {
    for (const N of nGrid) {
      for (const M of mGrid) {
        for (const blocked of bGrid) {
          for (const rDep of rDepGrid) {
            for (const fee of feeGrid) {
              if (budgetExhausted()) break;
              const partial = {
                depositRetentionMonths: T,
                loanToDepositMultiplier: M,
                blockedDepositPct: blocked,
                depositInterestRate: rDep,
                feeRate: fee,
                repaymentMonths: N,
              };
              const rLoan = maxLoanRateUnderBorrowerCap(partial, ctx, counters);
              best = consider(
                evaluate({ ...partial, loanInterestRate: rLoan }, ctx, counters),
                best,
              );
            }
          }
        }
      }
    }
  }

  // ---------------- Stage 2: coordinate pattern refinement ----------------
  // Deterministic local search: the stage-1 best plus three structural
  // neighbours seed a coordinate pattern search with halving steps.
  if (best) {
    const neighbours: DecisionVector[] = [
      { ...best.solution, depositRetentionMonths: clampInt(best.solution.depositRetentionMonths + 1, bT[0], bT[1]) },
      { ...best.solution, repaymentMonths: clampInt(best.solution.repaymentMonths + 12, bN[0], bN[1]) },
      { ...best.solution, loanToDepositMultiplier: clampNum(best.solution.loanToDepositMultiplier + 0.2, bM[0], bM[1]) },
    ];
    for (const nb of neighbours) {
      const withRate = {
        ...nb,
        loanInterestRate: maxLoanRateUnderBorrowerCap(nb, ctx, counters),
      };
      best = consider(evaluate(withRate, ctx, counters), best);
    }
  }

  let stepScale = 1;
  const structuralSteps = [1, 6, 0.2, 0.05, 0.01, 0.01];
  for (let pass = 0; pass < 8 && stepScale > 1 / 32 && !budgetExhausted(); pass += 1) {
    let improved = false;
    const base = best;
    if (!base) break;
    const coords: {
      apply: (v: DecisionVector, dir: number) => DecisionVector;
      reprice: boolean;
    }[] = [
      {
        apply: (v, dir) => ({
          ...v,
          depositRetentionMonths: clampInt(
            v.depositRetentionMonths + dir * structuralSteps[0],
            bT[0],
            bT[1],
          ),
        }),
        reprice: false,
      },
      {
        apply: (v, dir) => ({
          ...v,
          repaymentMonths: clampInt(v.repaymentMonths + dir * structuralSteps[1], bN[0], bN[1]),
        }),
        reprice: false,
      },
      {
        apply: (v, dir) => ({
          ...v,
          loanToDepositMultiplier: clampNum(
            v.loanToDepositMultiplier + dir * structuralSteps[2] * stepScale * 2,
            bM[0],
            bM[1],
          ),
        }),
        reprice: false,
      },
      {
        apply: (v, dir) => ({
          ...v,
          blockedDepositPct: clampNum(
            v.blockedDepositPct + dir * structuralSteps[3] * stepScale * 2,
            bB[0],
            bB[1],
          ),
        }),
        reprice: false,
      },
      {
        apply: (v, dir) => ({
          ...v,
          feeRate: clampNum(v.feeRate + dir * structuralSteps[5] * stepScale, bF[0], bF[1]),
          depositInterestRate: clampNum(
            v.depositInterestRate + dir * structuralSteps[4] * stepScale,
            bRD[0],
            bRD[1],
          ),
        }),
        reprice: true,
      },
      {
        apply: (v, dir) => ({
          ...v,
          loanInterestRate: clampNum(
            v.loanInterestRate + dir * 0.005 * stepScale,
            bRL[0],
            bRL[1],
          ),
        }),
        reprice: true,
      },
    ];
    for (const coord of coords) {
      if (budgetExhausted()) break;
      for (const dir of [1, -1]) {
        if (budgetExhausted()) break;
        const rawNext = coord.apply(base.solution, dir);
        const next: DecisionVector = coord.reprice
          ? {
              ...rawNext,
              loanInterestRate: maxLoanRateUnderBorrowerCap(rawNext, ctx, counters),
            }
          : rawNext;
        const candidate = evaluate(next, ctx, counters);
        if (better(candidate, base)) {
          best = consider(candidate, best);
          improved = true;
          break;
        }
      }
    }
    if (!improved) stepScale /= 2;
  }

  const finalBest = best as EvalResult | null;
  if (!finalBest) {
    // Unreachable (grid always evaluates ≥ 1 point) — defensive fallback.
    const fallback = evaluate(
      {
        depositRetentionMonths: clampInt(3, bT[0], bT[1]),
        loanToDepositMultiplier: bM[0],
        blockedDepositPct: bB[0],
        loanInterestRate: bRL[0],
        depositInterestRate: bRD[0],
        feeRate: bF[0],
        repaymentMonths: clampInt(24, bN[0], bN[1]),
      },
      ctx,
      counters,
    );
    return {
      ...fallback,
      evaluations: counters.evaluations,
      elapsedMs: Date.now() - started,
    };
  }

  return {
    solution: finalBest.solution,
    metrics: finalBest.metrics,
    feasible: finalBest.feasible,
    violations: finalBest.violations,
    objective: finalBest.objective,
    evaluations: counters.evaluations,
    elapsedMs: Date.now() - started,
  };
}

/**
 * Borrower-side nominal-equivalent annual IRR (12 × monthly IRR) including
 * the hidden cost of fee deduction and compensating-balance lock-up.
 * Single source of truth for the hidden-usury metric used by both the
 * solver's C3 constraint and the compliance auditor's independent check.
 */
export function computeBorrowerNominalRate(params: {
  loanBookRial: number;
  feeRate: number;
  blockedAmountRial: number;
  repaymentMonths: number;
  loanInterestRate: number;
}): number {
  if (!(params.loanBookRial > 0) || !Number.isFinite(params.loanBookRial)) return 0;
  const monthly = irr(borrowerFlows(params), 0.02);
  return Number.isFinite(monthly) ? 12 * monthly : 0;
}

// ---------------------------------------------------------------------------
// Phase 4 — ALM & Risk Guardian stress matrix (Base + three deterministic shocks)
// ---------------------------------------------------------------------------

export type StressScenarioId =
  | "BASE"
  | "DEPOSIT_RUNOFF_20"
  | "NPL_SHOCK_3PP"
  | "CANNIBALIZATION_15PP";

export interface StressScenarioResult {
  id: StressScenarioId;
  labelFa: string;
  worstMonthlyGapRial: number;
  worstCumulativeGapRial: number;
  breakevenMonth: number | null;
  /** Σ monthly net cash-flow over the horizon (cannibalization-adjusted). */
  netCashflowRial: number;
  depositBalanceEndRial: number;
  finalLoanBalanceRial: number;
  breachedGapLimit: boolean;
}

export interface StressTestMatrix {
  scenarios: StressScenarioResult[];
  worstScenarioId: StressScenarioId;
  allRespectGapLimit: boolean;
  gapLimitRial: number;
}

/**
 * Base + Stress evaluation of the SOLVED structure through the cohort model:
 *   BASE                  — solved parameters as-is
 *   DEPOSIT_RUNOFF_20     — unblocked run-off rate × 1.2 (capped at 1)
 *   NPL_SHOCK_3PP         — PD + 3 percentage points (capped at 0.6)
 *   CANNIBALIZATION_15PP  — α + 15pp; net cash-flow reduced by the exact
 *                           INCREMENTAL LOST SPREAD of the extra migration
 *                           (lostSpread(α+0.15) − lostSpread(α) > 0 whenever
 *                           the new-money cost exceeds the source cost)
 * Fully deterministic: no sampling, no clock, no randomness.
 */
export function buildStressMatrix(
  input: InverseSolverInput,
  solution: DecisionVector,
  gapLimitRial: number,
): StressTestMatrix {
  const parsed = inverseSolverInputSchema.parse(input);
  const base: CohortInput = {
    depositVolumeRial: parsed.depositVolumeRial,
    loanToDepositMultiplier: solution.loanToDepositMultiplier,
    depositRetentionMonths: solution.depositRetentionMonths,
    repaymentMonths: solution.repaymentMonths,
    blockedDepositPct: solution.blockedDepositPct,
    unblockedRunoffRate: parsed.unblockedRunoffRate,
    loanInterestRate: solution.loanInterestRate,
    depositInterestRate: solution.depositInterestRate,
    feeRate: solution.feeRate,
    statutoryReserve: applyReserveFloor(parsed.statutoryReserveBase, parsed.regulatoryConstraints),
    liquidityDeduction: parsed.liquidityDeduction,
    pd: parsed.pd,
    lgd: parsed.lgd,
    treasuryRate: parsed.treasuryRate,
  };

  const lostSpreadAt = (alpha: number): number =>
    computeCannibalization({
      depositVolumeRial: parsed.depositVolumeRial,
      loanToDepositMultiplier: solution.loanToDepositMultiplier,
      cannibalizationRate: alpha,
      sourceDepositCost: parsed.sourceDepositCost,
      depositInterestRate: solution.depositInterestRate,
      loanInterestRate: solution.loanInterestRate,
      feeRate: solution.feeRate,
      statutoryReserve: base.statutoryReserve,
      liquidityDeduction: parsed.liquidityDeduction,
      opexRatio: parsed.opexRatio,
      expectedLossRate: parsed.pd * parsed.lgd,
      treasuryRate: parsed.treasuryRate,
    }).lostSpreadOnCannibalizedRial;
  // The adverse cannibalization shock is the EXTRA lost spread carried by
  // the incremental 15pp of migrated volume (positive whenever new money is
  // dearer than the source) — it reduces the scenario's net cash-flow.
  const cannibalizationDelta =
    lostSpreadAt(parsed.cannibalizationRate) -
    lostSpreadAt(Math.min(1, parsed.cannibalizationRate + 0.15));

  const rows: { id: StressScenarioId; labelFa: string; cohort: CohortInput; niiAdjust: number }[] = [
    { id: "BASE", labelFa: "پایه (ساختار حل‌شده)", cohort: base, niiAdjust: 0 },
    {
      id: "DEPOSIT_RUNOFF_20",
      labelFa: "شوک برداشت سپرده +۲۰٪",
      cohort: { ...base, unblockedRunoffRate: Math.min(1, base.unblockedRunoffRate * 1.2) },
      niiAdjust: 0,
    },
    {
      id: "NPL_SHOCK_3PP",
      labelFa: "شوک NPL +۳ واحد درصد",
      cohort: { ...base, pd: Math.min(0.6, base.pd + 0.03) },
      niiAdjust: 0,
    },
    {
      id: "CANNIBALIZATION_15PP",
      labelFa: "شوک مهاجرت سپرده +۱۵ واحد درصد",
      cohort: base,
      niiAdjust: cannibalizationDelta,
    },
  ];

  const scenarios: StressScenarioResult[] = rows.map((row) => {
    const cohort = projectCohortLiquidity(row.cohort);
    const last = cohort.months[cohort.months.length - 1];
    return {
      id: row.id,
      labelFa: row.labelFa,
      worstMonthlyGapRial: cohort.worstMonthlyGapRial,
      worstCumulativeGapRial: cohort.worstCumulativeGapRial,
      breakevenMonth: cohort.breakevenMonth,
      netCashflowRial:
        cohort.months.reduce((acc, m) => acc + m.netCashflowRial, 0) + row.niiAdjust,
      depositBalanceEndRial: last.depositsRial,
      finalLoanBalanceRial: cohort.finalLoanBalanceRial,
      breachedGapLimit: cohort.worstCumulativeGapRial < -gapLimitRial,
    };
  });

  let worst = scenarios[0];
  for (const s of scenarios) {
    if (s.worstCumulativeGapRial < worst.worstCumulativeGapRial) worst = s;
  }
  return {
    scenarios,
    worstScenarioId: worst.id,
    allRespectGapLimit: scenarios.every((s) => !s.breachedGapLimit),
    gapLimitRial,
  };
}

// ---------------------------------------------------------------------------
// Adaptive decision core — feedback shooting onto the feasible frontier
// ---------------------------------------------------------------------------

export interface InverseFrontierRound {
  targetIrr: number;
  bankIrrAnnual: number;
  feasible: boolean;
  violationCount: number;
}

export interface InverseFrontier {
  /** Target requested by the intent (never mutated). */
  requestedTargetIrr: number;
  /** Target of the round whose result is returned. */
  finalTargetIrr: number;
  /** True when a probe round lowered the target and that round is returned. */
  recalibrated: boolean;
  /** Best result: feasible at the highest reached target, else the honest round-0 solve. */
  result: InverseSolverResult;
  /** Deterministic audit trail of every round (round 0 first). */
  trace: InverseFrontierRound[];
  /** Wall-clock budget of the whole frontier search (all rounds). */
  elapsedMs: number;
}

/**
 * Adaptive inverse solve — closed-loop feedback shooting (fully deterministic):
 *
 *   round 0   solve at the REQUESTED target.
 *   feedback  if (and only if) the bank-IRR constraint is among the
 *             violations, jump the target to the bank IRR the solver
 *             actually ACHIEVED (the observed frontier — a structure with
 *             IRR = c proves target c is attainable) and re-solve to verify.
 *             Repeat for at most `maxFeedbackRounds` probes; each probe is a
 *             verified feasibility test, never a blind decimation like the
 *             old fixed 25% decay.
 *   selection the returned result is the FEASIBLE round with the highest
 *             target; if no round is feasible the honest round-0 result is
 *             returned (violations reported at the requested target), so an
 *             unfixable problem (gap/usury levers, degenerate bounds) is
 *             never papered over by lowering the goalposts.
 *
 * Typical cost: 2 solves (~150 ms), worst case 1 + maxFeedbackRounds.
 */
export function solveInverseFrontier(
  raw: InverseSolverInput,
  opts: { maxFeedbackRounds?: number } = {},
): InverseFrontier {
  const started = Date.now();
  const maxFeedback = Math.max(0, Math.min(3, opts.maxFeedbackRounds ?? 2));
  const requested = raw.targetBankIrrMin;
  const trace: InverseFrontierRound[] = [];
  const results: InverseSolverResult[] = [];

  const runRound = (target: number): InverseSolverResult => {
    const result = solveInverseProduct({ ...raw, targetBankIrrMin: target });
    trace.push({
      targetIrr: target,
      bankIrrAnnual: result.metrics.bankIrrAnnual,
      feasible: result.feasible,
      violationCount: result.violations.length,
    });
    results.push(result);
    return result;
  };

  let current = runRound(requested);
  let currentTarget = requested;

  for (let probe = 0; probe < maxFeedback && !current.feasible; probe += 1) {
    const achieved = current.metrics.bankIrrAnnual;
    // Only the bank-IRR lever justifies a target move: if IRR met the goal
    // (or is non-finite) the binding problem is elsewhere — stop honestly.
    const irrIsTheLever =
      Number.isFinite(achieved) &&
      achieved < currentTarget - 1e-9 &&
      current.violations.some((v) => v.startsWith("bank IRR"));
    if (!irrIsTheLever) break;
    const nextTarget = Math.max(0.05, Math.min(currentTarget, achieved));
    if (currentTarget - nextTarget < 1e-9) break;
    currentTarget = nextTarget;
    current = runRound(currentTarget);
  }

  // Selection: highest-target feasible round, else the honest round-0 result.
  let chosenIndex = 0;
  for (let i = 1; i < results.length; i += 1) {
    if (results[i].feasible && !results[chosenIndex].feasible) chosenIndex = i;
    else if (results[i].feasible && results[chosenIndex].feasible) {
      if (trace[i].targetIrr > trace[chosenIndex].targetIrr) chosenIndex = i;
    }
  }
  const chosen = results[chosenIndex];
  return {
    requestedTargetIrr: requested,
    finalTargetIrr: trace[chosenIndex].targetIrr,
    recalibrated: chosenIndex > 0,
    result: chosen,
    trace,
    elapsedMs: Date.now() - started,
  };
}
