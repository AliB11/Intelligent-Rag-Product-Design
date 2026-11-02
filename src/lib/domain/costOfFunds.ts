/**
 * app/domain/cost_of_funds.py -> TypeScript twin
 * ---------------------------------------------------------------------------
 * Exact Iranian banking Cost-of-Funds equation accounting for the Central Bank
 * statutory reserve (سپرده قانونی) and the vault/ATM liquidity deduction
 * (ضریب نقدینگی):
 *
 *   CoF_m = ( r_d,m - RR_m * r_CB_reward ) / ( 1 - RR_m - LR_m )
 *           + theta_OpEx + theta_EL,m
 *
 * where theta_EL,m = PD_m * LGD_m.
 */

import {
  CB_REWARD_RATE,
  LIQUIDITY_DEDUCTION_DEFAULT,
  OPEX_RATIO_DEFAULT,
} from "./constants";

export interface CostOfFundsInput {
  /** r_d,m — nominal deposit rate / expected participation return. */
  depositRate: number;
  /** RR_m — statutory reserve ratio. */
  statutoryReserve: number;
  /** LR_m — vault & ATM liquidity deduction ratio. */
  liquidityDeduction?: number;
  /** Central Bank reward paid on the blocked statutory reserve. */
  cbRewardRate?: number;
  /** theta_OpEx — administrative cost ratio over free resources. */
  opexRatio?: number;
  /** PD_m */
  pd?: number;
  /** LGD_m */
  lgd?: number;
  /** Optional explicit expected-loss override. */
  expectedLoss?: number;
}

export interface CostOfFundsResult {
  costOfFunds: number;
  adjustedDepositRate: number;
  availableFraction: number;
  statutoryReserveDrag: number;
  liquidityDrag: number;
  opexComponent: number;
  expectedLoss: number;
  expectedLossComponent: number;
  rewardOffset: number;
}

export function expectedLossOf(pd: number, lgd: number): number {
  if (!Number.isFinite(pd) || !Number.isFinite(lgd)) {
    throw new RangeError("PD and LGD must be finite");
  }
  return Math.min(1, Math.max(0, pd)) * Math.min(1, Math.max(0, lgd));
}

function validateFundingFractions(rr: number, lr: number): number {
  if (!Number.isFinite(rr) || !Number.isFinite(lr) || rr < 0 || lr < 0 || rr + lr >= 1) {
    throw new RangeError("Statutory reserve and liquidity deductions must be non-negative and sum to less than 1");
  }
  return 1 - rr - lr;
}

export function costOfFunds(input: CostOfFundsInput): CostOfFundsResult {
  const rr = input.statutoryReserve ?? 0;
  const lr = input.liquidityDeduction ?? LIQUIDITY_DEDUCTION_DEFAULT;
  const reward = input.cbRewardRate ?? CB_REWARD_RATE;
  const opex = input.opexRatio ?? OPEX_RATIO_DEFAULT;
  const depositRate = input.depositRate;
  const el = input.expectedLoss ?? expectedLossOf(input.pd ?? 0, input.lgd ?? 0);
  if (![depositRate, reward, opex, el].every(Number.isFinite) || opex < 0 || el < 0) {
    throw new RangeError("Cost-of-funds rates and ratios must be finite and non-negative where applicable");
  }

  const availableFraction = validateFundingFractions(rr, lr);
  const adjustedDepositRate = depositRate - rr * reward;
  const fundingComponent = adjustedDepositRate / availableFraction;
  const rewardOffset = (rr * reward) / availableFraction;

  return {
    costOfFunds: fundingComponent + opex + el,
    adjustedDepositRate,
    availableFraction,
    statutoryReserveDrag: (depositRate * rr) / availableFraction,
    liquidityDrag: (depositRate * lr) / availableFraction,
    opexComponent: opex,
    expectedLoss: el,
    expectedLossComponent: el,
    rewardOffset,
  };
}

/** Deposit-rate level that reproduces a target all-in cost of funds (inverse). */
export function depositRateForTargetCoF(
  targetCoF: number,
  input: Omit<CostOfFundsInput, "depositRate">,
): number {
  const rr = input.statutoryReserve ?? 0;
  const lr = input.liquidityDeduction ?? LIQUIDITY_DEDUCTION_DEFAULT;
  const reward = input.cbRewardRate ?? CB_REWARD_RATE;
  const opex = input.opexRatio ?? OPEX_RATIO_DEFAULT;
  const el = input.expectedLoss ?? expectedLossOf(input.pd ?? 0, input.lgd ?? 0);
  if (![targetCoF, reward, opex, el].every(Number.isFinite)) {
    throw new RangeError("Cost-of-funds inputs must be finite");
  }
  const availableFraction = validateFundingFractions(rr, lr);
  const funding = targetCoF - opex - el;
  return funding * availableFraction + rr * reward;
}

/** Weighted all-in cost of funds across a portfolio of modes. */
export function blendedCostOfFunds(
  modes: { depositVolumeRial: number; costOfFunds: number }[],
): number {
  const total = modes.reduce((acc, m) => acc + m.depositVolumeRial, 0);
  if (total <= 0) return 0;
  return modes.reduce(
    (acc, m) => acc + (m.depositVolumeRial / total) * m.costOfFunds,
    0,
  );
}
