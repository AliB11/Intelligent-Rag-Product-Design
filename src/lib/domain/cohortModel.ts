/**
 * Cohort Behavioral Model — Phase A / B / C liquidity projection
 * ---------------------------------------------------------------------------
 * Deterministic monthly cash-flow ledger for one product cohort:
 *
 *   Phase A (months 1..T_wait)   deposit accumulation & retention:
 *        linear inflow D/T_wait per month, deposit interest paid on the
 *        opening balance, treasury income on liquidity held net of the
 *        statutory reserve + liquidity haircuts, no loans yet.
 *   Phase B (month T_wait + 1)   loan origination surge:
 *        loan book L = M·D disbursed (cash out), upfront fee = fee·L
 *        received, blocked share of deposits locked, unblocked deposits
 *        begin running off at β_runoff per month.
 *   Phase C (months T_wait+2 .. T_wait+1+T_repay)  amortisation & risk:
 *        annuity instalments (principal + interest) flow back, expected
 *        default loss = balance · PD/12 · LGD is charged in cash every
 *        month, blocked deposits release pro-rata with principal
 *        amortisation, unblocked deposits keep running off.
 *
 * Every month the ledger closes with
 *   net = newDeposits − depositInterest + treasury + fee + instalments
 *         − disbursement − runoff − defaultLoss
 * and `worstMonthlyGapRial = min(net)` (peak single-month financing need)
 * while `worstCumulativeGapRial = min(cumulative)` (peak cumulative need).
 * Both feed the inverse solver's `max_liquidity_gap_limit` and the Phase-4
 * stress committee. Fully deterministic — no RNG, typed-array friendly.
 */

import { z } from "zod";
import {
  CAPITAL,
  HURDLE_RATE,
  LIQUIDITY_DEDUCTION_DEFAULT,
  OPEX_RATIO_DEFAULT,
  TREASURY_RATE,
} from "./constants";
import { ALM_CALIBRATION } from "./almSimulator";
import { pmt } from "./financial";

export const cohortInputSchema = z
  .object({
    /** D — target attracted deposit volume (Rial), fully in by T_wait. */
    depositVolumeRial: z.number().finite().min(0),
    /** M — loan book / deposits. */
    loanToDepositMultiplier: z.number().finite().min(0).max(10),
    /** T_wait — Phase A length in months (>= 1). */
    depositRetentionMonths: z.number().int().min(1).max(60),
    /** T_repay — instalment count of the Phase-C amortisation. */
    repaymentMonths: z.number().int().min(1).max(360),
    /** Share of deposits locked as collateral at origination, ∈ [0,1]. */
    blockedDepositPct: z.number().min(0).max(1),
    /** β_runoff — monthly run-off rate of UNBLOCKED deposits, ∈ [0,1]. */
    unblockedRunoffRate: z.number().min(0).max(1),
    loanInterestRate: z.number().finite().min(0).max(1),
    depositInterestRate: z.number().finite().min(0).max(1),
    feeRate: z.number().finite().min(0).max(1),
    statutoryReserve: z.number().finite().min(0).max(0.95),
    liquidityDeduction: z.number().finite().min(0).max(0.95).optional(),
    /** Annual PD of the loan book. */
    pd: z.number().finite().min(0).max(1),
    /** Loss given default. */
    lgd: z.number().finite().min(0).max(1),
    treasuryRate: z.number().finite().min(0).max(1).optional(),
    /** Opex ratio over USABLE resources (repo CoF convention). */
    opexRatio: z.number().finite().min(0).max(1).optional(),
  })
  .strict()
  .refine((v) => v.statutoryReserve + (v.liquidityDeduction ?? LIQUIDITY_DEDUCTION_DEFAULT) < 1, {
    message: "statutoryReserve + liquidityDeduction must be < 1",
  });

export type CohortInput = z.output<typeof cohortInputSchema>;

export interface CohortMonth {
  /** 1-based absolute month. */
  month: number;
  phase: "A" | "B" | "C";
  depositsRial: number;
  blockedRial: number;
  unblockedRial: number;
  loanBalanceRial: number;
  newDepositInflowRial: number;
  depositInterestOutflowRial: number;
  treasuryInflowRial: number;
  feeIncomeRial: number;
  disbursementOutflowRial: number;
  instalmentInflowRial: number;
  /** Interest accrual on the opening loan balance (P&L view; 0 in A/B). */
  loanInterestIncomeRial: number;
  runoffOutflowRial: number;
  defaultLossRial: number;
  /** Wholesale funding cost of the month-end gap (repo ALM convention). */
  wholesaleCostOutflowRial: number;
  /** Opex on usable resources (repo CoF convention). */
  opexOutflowRial: number;
  netCashflowRial: number;
  cumulativeCashflowRial: number;
}

export interface CohortProjection {
  months: CohortMonth[];
  totalDepositsRial: number;
  loanBookRial: number;
  /** Minimum single-month net cash-flow (most negative = worst gap). */
  worstMonthlyGapRial: number;
  /** Minimum cumulative cash-flow across the horizon. */
  worstCumulativeGapRial: number;
  /** First month after origination whose cumulative cash-flow is >= 0. */
  breakevenMonth: number | null;
  totalInterestIncomeRial: number;
  totalDepositInterestRial: number;
  totalDefaultLossRial: number;
  totalRunoffRial: number;
  totalWholesaleCostRial: number;
  totalOpexRial: number;
  finalLoanBalanceRial: number;
  finalDepositsRial: number;
}

/**
 * Project the cohort cash-flows. Total, deterministic, and allocation-light
 * so the full horizon (< 370 months) evaluates in microseconds for the
 * inverse solver's inner loop.
 */
export function projectCohortLiquidity(raw: CohortInput): CohortProjection {
  const input = cohortInputSchema.parse(raw);
  const D = input.depositVolumeRial;
  const M = input.loanToDepositMultiplier;
  const tWait = input.depositRetentionMonths;
  const tRepay = input.repaymentMonths;
  const rr = input.statutoryReserve;
  const lr = input.liquidityDeduction ?? LIQUIDITY_DEDUCTION_DEFAULT;
  const treasuryRate = input.treasuryRate ?? TREASURY_RATE;
  const liquidHaircut = Math.max(0, 1 - rr - lr);
  const opexRatio = input.opexRatio ?? OPEX_RATIO_DEFAULT;

  const loanBookRial = M * D;
  const monthlyLoanRate = input.loanInterestRate / 12;
  const instalment =
    loanBookRial > 0 && tRepay > 0 ? pmt(monthlyLoanRate, tRepay, loanBookRial) : 0;
  const feeIncomeRial = input.feeRate * loanBookRial;
  const blockedTarget = input.blockedDepositPct * D;

  const totalMonths = tWait + 1 + tRepay;
  const months: CohortMonth[] = [];

  let deposits = 0;
  let blocked = 0;
  let unblocked = 0;
  let loanBalance = 0;
  let cumulative = 0;
  let prevUnblocked = 0;
  let worstMonthly = Infinity;
  let worstCumulative = Infinity;
  let breakevenMonth: number | null = null;
  let totalInterestIncome = 0;
  let totalDepositInterest = 0;
  let totalDefaultLoss = 0;
  let totalRunoff = 0;
  let totalWholesaleCost = 0;
  let totalOpex = 0;
  let originationMonth = 0;

  const newDepositInflow = tWait > 0 ? D / tWait : 0;

  for (let m = 1; m <= totalMonths; m += 1) {
    const prevDeposits = deposits;
    const prevLoan = loanBalance;
    let phase: "A" | "B" | "C";
    let newIn = 0;
    let depositInterest = 0;
    let treasuryIn = 0;
    let feeIn = 0;
    let disbursement = 0;
    let instalmentIn = 0;
    let loanInterestIncome = 0;
    let runoff = 0;
    let defaultLoss = 0;
    let wholesaleOut = 0;
    let opexOut = 0;

    if (m <= tWait) {
      // ---- Phase A: accumulation & retention ------------------------------
      phase = "A";
      newIn = newDepositInflow;
      deposits = prevDeposits + newIn;
      blocked = 0;
      unblocked = deposits;
      loanBalance = 0;
      depositInterest = prevDeposits * (input.depositInterestRate / 12);
    } else if (m === tWait + 1) {
      // ---- Phase B: origination surge, lock-in, run-off begins -----------
      phase = "B";
      originationMonth = m;
      deposits = prevDeposits; // already fully accumulated
      blocked = Math.min(blockedTarget, deposits);
      unblocked = Math.max(0, deposits - blocked);
      loanBalance = loanBookRial;
      feeIn = feeIncomeRial;
      disbursement = loanBookRial;
      depositInterest = prevDeposits * (input.depositInterestRate / 12);
      // unblocked run-off happens after lock-in within the same month
      const runoffNow = unblocked * input.unblockedRunoffRate;
      runoff = runoffNow;
      unblocked = Math.max(0, unblocked - runoffNow);
      deposits = blocked + unblocked;
      prevUnblocked = unblocked;
    } else {
      // ---- Phase C: amortisation, defaults, continuing run-off -----------
      phase = "C";
      // blocked releases pro-rata with outstanding principal
      const releaseShare = loanBookRial > 0 ? prevLoan / loanBookRial : 0;
      blocked = blockedTarget * releaseShare;
      const runoffNow = prevUnblocked * input.unblockedRunoffRate;
      runoff = runoffNow;
      unblocked = Math.max(0, prevUnblocked - runoffNow);
      deposits = blocked + unblocked;

      // instalment: interest on opening balance, principal = instalment − interest
      const interestPart = prevLoan * monthlyLoanRate;
      let principalPart = Math.max(0, instalment - interestPart);
      if (principalPart > prevLoan) principalPart = prevLoan;
      loanBalance = Math.max(0, prevLoan - principalPart);
      instalmentIn = prevLoan > 0 ? interestPart + principalPart : 0;
      loanInterestIncome = interestPart;
      // final instalment rounding: whatever remains is collected as principal
      if (m === totalMonths && loanBalance > 0 && instalmentIn > 0) {
        instalmentIn += loanBalance;
        loanBalance = 0;
      }
      defaultLoss = prevLoan * (input.pd / 12) * input.lgd;
      depositInterest = prevDeposits * (input.depositInterestRate / 12);
      feeIn = 0;
      newIn = 0;
      prevUnblocked = unblocked; // carry the post-runoff balance into next month
    }

    // Month-end balance-sheet repricing (repo ALM convention): treasury on
    // deployable surplus with a market-absorption capacity cap, wholesale
    // funding cost on the gap beyond usable deposits, opex on usable funds.
    const usableEnd = Math.max(0, deposits * liquidHaircut - blocked);
    const requiredHqla = CAPITAL.hqlaToDeposits * deposits;
    const surplusEnd = Math.max(0, usableEnd - loanBalance);
    const hqlaEnd = Math.min(requiredHqla, surplusEnd);
    const treasuryPlacements = Math.min(
      surplusEnd,
      ALM_CALIBRATION.treasuryCapacityRatio * deposits,
    );
    treasuryIn =
      (treasuryPlacements * ALM_CALIBRATION.treasuryDeploymentEfficiency * treasuryRate) / 12 +
      (hqlaEnd * ALM_CALIBRATION.hqlaYield) / 12;
    const fundingGap = Math.max(0, loanBalance + requiredHqla - usableEnd);
    wholesaleOut = (fundingGap * (HURDLE_RATE + ALM_CALIBRATION.wholesaleSpread)) / 12;
    opexOut = (usableEnd * opexRatio) / 12;

    const net =
      newIn - depositInterest + treasuryIn + feeIn - disbursement + instalmentIn - runoff -
      defaultLoss - wholesaleOut - opexOut;
    cumulative += net;

    totalInterestIncome += loanInterestIncome;
    totalDepositInterest += depositInterest;
    totalDefaultLoss += defaultLoss;
    totalRunoff += runoff;
    totalWholesaleCost += wholesaleOut;
    totalOpex += opexOut;
    worstMonthly = Math.min(worstMonthly, net);
    worstCumulative = Math.min(worstCumulative, cumulative);

    if (breakevenMonth === null && originationMonth > 0 && m > originationMonth && cumulative >= 0) {
      breakevenMonth = m;
    }

    months.push({
      month: m,
      phase,
      depositsRial: deposits,
      blockedRial: blocked,
      unblockedRial: unblocked,
      loanBalanceRial: loanBalance,
      newDepositInflowRial: newIn,
      depositInterestOutflowRial: depositInterest,
      treasuryInflowRial: treasuryIn,
      feeIncomeRial: feeIn,
      disbursementOutflowRial: disbursement,
      instalmentInflowRial: instalmentIn,
      loanInterestIncomeRial: loanInterestIncome,
      runoffOutflowRial: runoff,
      defaultLossRial: defaultLoss,
      wholesaleCostOutflowRial: wholesaleOut,
      opexOutflowRial: opexOut,
      netCashflowRial: net,
      cumulativeCashflowRial: cumulative,
    });
  }

  return {
    months,
    totalDepositsRial: D,
    loanBookRial,
    worstMonthlyGapRial: Number.isFinite(worstMonthly) ? worstMonthly : 0,
    worstCumulativeGapRial: Number.isFinite(worstCumulative) ? worstCumulative : 0,
    breakevenMonth,
    totalInterestIncomeRial: totalInterestIncome,
    totalDepositInterestRial: totalDepositInterest,
    totalDefaultLossRial: totalDefaultLoss,
    totalRunoffRial: totalRunoff,
    totalWholesaleCostRial: totalWholesaleCost,
    totalOpexRial: totalOpex,
    finalLoanBalanceRial: loanBalance,
    finalDepositsRial: deposits,
  };
}
