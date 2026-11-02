/**
 * app/domain/point_engine.py -> TypeScript twin
 * ---------------------------------------------------------------------------
 * Multi-mode average-balance (میانگین حساب) and loan-entitlement mechanics of
 * Iranian retail banking schemes.
 *
 *   B̄_m = (1 / N_d) * Σ_{t=1..N_d} B_{m,t} * kappa_source ,  N_d = 30 * tau_d,m
 *   L_m = alpha_m * B̄_m  (capped by L_max,m)
 *
 *   NPV_bank,m = Σ_{t=1..tau_d}  B̄_m (1-RR_m-LR_m)(r_treasury - CoF_m) / (1+r_h/12)^t
 *                - L_m (1 - gamma_m - beta_m)
 *                + Σ_{k=1..tau_l} [ PMT(r_l/12, tau_l, L_m) - Release_k(beta_m L_m) ]
 *                                   / (1+r_h/12)^(tau_d + omega_m + k)
 */

import { DAYS_PER_MONTH, HURDLE_RATE, TREASURY_RATE } from "./constants";
import { clamp, pmt } from "./financial";
import type { BlockReleaseSchedule, ModeSpec } from "./types";

export interface AverageBalanceInput {
  /** Contracted deposit volume of one cohort (Rial). */
  depositVolumeRial: number;
  /** tau_d,m — deposit sleep period in months. */
  sleepMonths: number;
  /** kappa_source — 1.0 retail, 1.5 POS/IPG merchant float, 1.3 corporate payroll. */
  sourceKappa?: number;
  /** Months needed to ramp the cohort to full balance. */
  rampMonths?: number;
  /** Fraction of the balance that stays after the loan is granted (1 - delta). */
  residualFraction?: number;
}

/** Daily balance profile of one cohort over the sleep period. */
export function dailyBalanceProfile(input: AverageBalanceInput): number[] {
  const days = Math.max(1, Math.round(input.sleepMonths * DAYS_PER_MONTH));
  const rampDays = Math.max(
    1,
    Math.round((input.rampMonths ?? Math.min(3, input.sleepMonths)) * DAYS_PER_MONTH),
  );
  const kappa = input.sourceKappa ?? 1;
  const residual = input.residualFraction ?? 1;
  const profile: number[] = [];
  for (let d = 1; d <= days; d += 1) {
    const ramp = d < rampDays ? d / rampDays : 1;
    profile.push(input.depositVolumeRial * ramp * kappa * residual);
  }
  return profile;
}

/** Weighted daily average balance B̄_m, computed analytically without a daily array. */
export function weightedAverageBalance(input: AverageBalanceInput): number {
  const deposit = input.depositVolumeRial;
  if (!Number.isFinite(deposit)) throw new RangeError("Deposit volume must be finite");
  const sleepMonths = Number.isFinite(input.sleepMonths) ? Math.max(0, input.sleepMonths) : 0;
  const days = Math.max(1, Math.round(sleepMonths * DAYS_PER_MONTH));
  const rampMonths = Number.isFinite(input.rampMonths)
    ? Math.max(0, input.rampMonths!)
    : Math.min(3, sleepMonths);
  const rampDays = Math.max(1, Math.round(rampMonths * DAYS_PER_MONTH));
  const kappa = input.sourceKappa ?? 1;
  const residual = input.residualFraction ?? 1;
  if (!Number.isFinite(kappa) || !Number.isFinite(residual) || kappa < 0 || residual < 0) {
    throw new RangeError("Average-balance multipliers must be finite and non-negative");
  }
  const rampTotal = rampDays <= days
    ? days - (rampDays - 1) / 2
    : (days * (days + 1)) / (2 * rampDays);
  return deposit * kappa * residual * (rampTotal / days);
}

export interface LoanEntitlementInput {
  averageBalanceRial: number;
  loanMultiplier: number;
  /** L_max,m in Rial. */
  capRial: number;
  customers: number;
}

/** L_m = alpha_m * B̄_m, subject to the regulatory / product cap. */
export function loanEntitlement(input: LoanEntitlementInput): {
  entitlementRial: number;
  cappedRial: number;
  cappedPerCustomerRial: number;
  capBinding: boolean;
} {
  const raw = Math.max(0, input.loanMultiplier) * input.averageBalanceRial;
  const perCustomerCap = Math.max(0, input.capRial);
  const customers = Number.isFinite(input.customers) ? Math.max(0, Math.floor(input.customers)) : 0;
  const aggregateCap = perCustomerCap * customers;
  const capped = Math.min(raw, aggregateCap);
  return {
    entitlementRial: raw,
    cappedRial: capped,
    cappedPerCustomerRial: customers > 0 ? Math.min(perCustomerCap, capped / customers) : 0,
    capBinding: raw > aggregateCap + 1,
  };
}

/** Step-wise release schedule of the blocked fraction beta_m * B̄_m. */
export function blockedReleaseSchedule(
  schedule: BlockReleaseSchedule,
  blockedAmountRial: number,
  installments: number,
): number[] {
  const n = Number.isFinite(installments) ? clamp(Math.round(installments), 1, 1_000) : 1;
  const out = new Array<number>(n).fill(0);
  if (blockedAmountRial <= 0) return out;
  if (schedule === "linear") {
    const per = blockedAmountRial / n;
    for (let i = 0; i < n; i += 1) out[i] = per;
    return out;
  }
  if (schedule === "midpoint") {
    // released once 50% of the instalments have been serviced
    const idx = clamp(Math.ceil(n / 2) - 1, 0, n - 1);
    out[idx] = blockedAmountRial;
    return out;
  }
  out[n - 1] = blockedAmountRial;
  return out;
}

export interface BankNpvInput {
  averageBalanceRial: number;
  loanAmountRial: number;
  sleepMonths: number;
  waitingMonths: number;
  tenorMonths: number;
  loanRate: number;
  blockedRatio: number;
  closedLoopRetention: number;
  statutoryReserve: number;
  liquidityDeduction?: number;
  costOfFunds: number;
  /** Qarz-ol-Hasanah repays principal equally and earns a one-off commission. */
  annuity?: boolean;
  upfrontCommissionRate?: number;
  hurdleRate?: number;
  treasuryRate?: number;
  blockRelease?: BlockReleaseSchedule;
}

export interface BankNpvResult {
  npvBankRial: number;
  treasurySpreadLegRial: number;
  liquidityDrainLegRial: number;
  installmentLegRial: number;
  upfrontCommissionLegRial: number;
  monthlyInstallmentRial: number;
  actuariallyEquivalent: boolean;
}

/** NPV_bank,m of the point engine — actuarial equivalence test. */
export function bankProductNpv(input: BankNpvInput): BankNpvResult {
  const monthlyHurdle = (input.hurdleRate ?? HURDLE_RATE) / 12;
  const treasury = input.treasuryRate ?? TREASURY_RATE;
  const discount = (t: number) => Math.pow(1 + monthlyHurdle, t);

  const sleep = Math.max(1, Math.round(input.sleepMonths));
  const tenor = Math.max(1, Math.round(input.tenorMonths));
  const availableFraction = Math.max(0, 1 - input.statutoryReserve - (input.liquidityDeduction ?? 0));
  const spreadPerMonth =
    input.averageBalanceRial *
    availableFraction *
    (treasury - input.costOfFunds);

  let treasurySpreadLeg = 0;
  for (let t = 1; t <= sleep; t += 1) {
    treasurySpreadLeg += spreadPerMonth / discount(t);
  }

  const drain =
    input.loanAmountRial *
    (1 - input.closedLoopRetention - input.blockedRatio);
  const liquidityDrainLeg = -Math.max(0, drain);

  const monthlyInstallment = input.annuity === false
    ? input.loanAmountRial / tenor
    : pmt(input.loanRate / 12, tenor, input.loanAmountRial);
  const releases = blockedReleaseSchedule(
    input.blockRelease ?? "linear",
    input.blockedRatio * input.loanAmountRial,
    tenor,
  );

  let installmentLeg = 0;
  const forbearance = Number.isFinite(input.waitingMonths) ? Math.max(0, input.waitingMonths) : 0;
  for (let k = 1; k <= tenor; k += 1) {
    const release = releases[k - 1] ?? 0;
    const t = sleep + forbearance + k;
    installmentLeg += (monthlyInstallment - release) / discount(t);
  }

  const upfrontCommissionLeg = input.annuity === false
    ? (input.loanAmountRial * (input.upfrontCommissionRate ?? input.loanRate)) /
      discount(sleep + forbearance)
    : 0;
  const npv = treasurySpreadLeg + liquidityDrainLeg + installmentLeg + upfrontCommissionLeg;
  return {
    npvBankRial: npv,
    treasurySpreadLegRial: treasurySpreadLeg,
    liquidityDrainLegRial: liquidityDrainLeg,
    installmentLegRial: installmentLeg,
    upfrontCommissionLegRial: upfrontCommissionLeg,
    monthlyInstallmentRial: monthlyInstallment,
    actuariallyEquivalent: npv >= 0,
  };
}

export interface SolveLoanRateInput extends Omit<BankNpvInput, "loanRate"> {
  minRate: number;
  maxRate: number;
}

/**
 * Inverse actuarial solver: the smallest contract rate inside the CBI ceiling
 * that keeps NPV_bank,m >= 0 (the "break-even Morabaha / commission rate").
 */
export function solveBreakEvenLoanRate(input: SolveLoanRateInput): {
  loanRate: number;
  npvBankRial: number;
  breakEvenFound: boolean;
} {
  let lo = input.minRate;
  let hi = input.maxRate;
  const atHi = bankProductNpv({ ...input, loanRate: hi });
  if (atHi.npvBankRial < 0) {
    return { loanRate: hi, npvBankRial: atHi.npvBankRial, breakEvenFound: false };
  }
  const atLo = bankProductNpv({ ...input, loanRate: lo });
  if (atLo.npvBankRial >= 0) {
    return { loanRate: lo, npvBankRial: atLo.npvBankRial, breakEvenFound: true };
  }
  for (let i = 0; i < 60; i += 1) {
    const mid = (lo + hi) / 2;
    const value = bankProductNpv({ ...input, loanRate: mid }).npvBankRial;
    if (Math.abs(hi - lo) < 1e-6) break;
    if (value >= 0) hi = mid;
    else lo = mid;
  }
  return {
    loanRate: hi,
    npvBankRial: bankProductNpv({ ...input, loanRate: hi }).npvBankRial,
    breakEvenFound: true,
  };
}

/** Affordability test: PMT must not exceed 40% of persona monthly net income. */
export function installmentAffordability(
  loanAmountRial: number,
  loanRate: number,
  tenorMonths: number,
  personaIncomeToman: number,
  ceiling = 0.4,
): {
  installmentToman: number;
  installmentToIncome: number;
  affordable: boolean;
  maxAffordableLoanRial: number;
} {
  const installmentRial = pmt(loanRate / 12, Math.max(1, tenorMonths), loanAmountRial);
  const installmentToman = installmentRial / 10;
  const income = Math.max(1, personaIncomeToman);
  const ratio = installmentToman / income;
  // invert the annuity formula for the affordable principal
  const monthlyRate = loanRate / 12;
  const periods = Math.max(1, tenorMonths);
  const factor =
    Math.abs(monthlyRate) < 1e-12
      ? periods
      : (Math.pow(1 + monthlyRate, periods) - 1) /
        (monthlyRate * Math.pow(1 + monthlyRate, periods));
  const maxAffordableLoanRial = income * ceiling * factor * 10;
  return {
    installmentToman,
    installmentToIncome: ratio,
    affordable: ratio <= ceiling + 1e-9,
    maxAffordableLoanRial,
  };
}

/** Point-engine entitlement of a fully specified mode. */
export function evaluateMode(mode: ModeSpec): {
  averageBalanceRial: number;
  entitlementRial: number;
  loanBookRial: number;
  npvBankRial: number;
  monthlyInstallmentToman: number;
  installmentToIncome: number;
  customers: number;
} {
  const perCustomerDepositRial = mode.depositVolumeRial / Math.max(1, mode.customers || 1);
  void perCustomerDepositRial;
  const averageBalanceRial = weightedAverageBalance({
    depositVolumeRial: mode.depositVolumeRial,
    sleepMonths: mode.sleepMonths,
    sourceKappa: mode.sourceKappa,
    rampMonths: mode.cohortRampMonths,
  });
  const entitlement = loanEntitlement({
    averageBalanceRial,
    loanMultiplier: mode.loanMultiplier,
    capRial: mode.capToman * 10,
    customers: Math.max(1, mode.customers),
  });
  const loanBookRial = Math.min(entitlement.cappedRial, mode.loanBookRial || Infinity);
  const npv = bankProductNpv({
    averageBalanceRial,
    loanAmountRial: loanBookRial,
    sleepMonths: mode.sleepMonths,
    waitingMonths: mode.waitingMonths,
    tenorMonths: mode.tenorMonths,
    loanRate: mode.loanRate,
    blockedRatio: mode.blockedRatio,
    closedLoopRetention: mode.closedLoopRetention,
    statutoryReserve: mode.statutoryReserve,
    liquidityDeduction: mode.liquidityDeduction,
    costOfFunds: mode.costOfFunds,
    annuity: mode.contract !== "qarz-hasaneh",
    upfrontCommissionRate: mode.contract === "qarz-hasaneh" ? mode.loanRate : 0,
    blockRelease: mode.blockRelease,
  });
  const affordability = installmentAffordability(
    loanBookRial / Math.max(1, mode.customers),
    mode.contract === "qarz-hasaneh" ? 0 : mode.loanRate,
    mode.tenorMonths,
    mode.personaIncomeToman,
  );
  return {
    averageBalanceRial,
    entitlementRial: entitlement.entitlementRial,
    loanBookRial,
    npvBankRial: npv.npvBankRial,
    monthlyInstallmentToman: affordability.installmentToman,
    installmentToIncome: affordability.installmentToIncome,
    customers: mode.customers,
  };
}

/**
 * Point-earning rule used by Mehr-Iran style schemes: points accrue per
 * million-Toman-day of weighted average balance and convert into a loan
 * entitlement ratio. Returned for the executive report / UI.
 */
export function pointsLedger(
  depositVolumeRial: number,
  sleepMonths: number,
  sourceKappa: number,
  pointsPerMillionTomanDay = 1,
): { points: number; entitlementRatio: number; averageBalanceRial: number } {
  const averageBalanceRial = weightedAverageBalance({
    depositVolumeRial,
    sleepMonths,
    sourceKappa,
  });
  const days = Math.max(1, sleepMonths * DAYS_PER_MONTH);
  const millionTomanDays = (averageBalanceRial / 1e7) * days;
  const points = millionTomanDays * pointsPerMillionTomanDay;
  const entitlementRatio = depositVolumeRial > 0 ? points / (depositVolumeRial / 1e7) : 0;
  return { points, entitlementRatio, averageBalanceRial };
}
