/**
 * simorgh/calculator.ts — customer-facing estimator (Simorgh adaptation).
 * ---------------------------------------------------------------------------
 * Version-independent, stateless estimate for the four product classes:
 * instalment/QH (annuity schedule), revolving (credit card / credit line),
 * points loan (money–time) and loyalty. All money in million toman; no
 * customer input is ever persisted.
 */

import { clamp } from "../domain/financial";
import { annuityPayment } from "./creditPolicy";
import { effectiveAprPct, unitSchedule } from "./quant";

export interface InstalmentEstimate {
  kind: "instalment";
  eligible: boolean;
  reasonsFa: string[];
  amount: number;
  rate: number;
  tenorMonths: number;
  monthlyPayment: number;
  totalPayment: number;
  totalCost: number;
  aprPct: number;
  firstPaymentDateHintFa: string;
}

export interface RevolvingEstimate {
  kind: "revolving";
  eligible: boolean;
  reasonsFa: string[];
  limit: number;
  drawn: number;
  rate: number;
  monthlyBurden: number;
  annualFee: number;
  aprPct: number;
}

export interface PointsEstimate {
  kind: "points";
  eligible: boolean;
  reasonsFa: string[];
  balance: number;
  holdingMonths: number;
  multiplier: number;
  estimatedLimit: number;
  commission: number;
}

export type CalculatorResult = InstalmentEstimate | RevolvingEstimate | PointsEstimate;

export interface CalculatorInput {
  productClass: "instalment" | "qh" | "revolving" | "points";
  /** Annual rate or commission, fraction (0.23 = 23%). */
  annualRate: number;
  tenorMonths: number;
  amountMillionToman: number;
  /** Customer context for the DTI/eligibility hints. */
  monthlyIncomeMillionToman?: number;
  existingMonthlyDebt?: number;
  upfrontFeePct?: number;
  annualFeePct?: number;
  /** points-loan inputs */
  depositBalance?: number;
  holdingMonths?: number;
  multiplierK?: number;
  drawnPct?: number;
  dtiCap?: number;
}

const fa = (v: number) => `${(v * 100).toFixed(1)}٪`;

export function estimate(input: CalculatorInput): CalculatorResult {
  const dtiCap = input.dtiCap ?? 0.4;
  const income = Math.max(1, input.monthlyIncomeMillionToman ?? 0);
  const reasonsFa: string[] = [];

  if (input.productClass === "revolving") {
    const limit = Math.max(0, input.amountMillionToman);
    const drawn = clamp(input.drawnPct ?? 0.6, 0.05, 1);
    const eff = Math.pow(1 + clamp(input.annualRate, 0, 2) / 12, 12) - 1;
    const burden = (limit * drawn * clamp(input.annualRate, 0, 2)) / 12;
    const annualFee = limit * (input.annualFeePct ?? 0.01);
    const aprPct = eff * 100 + (annualFee / Math.max(0.1, drawn)) / Math.max(1, input.tenorMonths / 12);
    const monthlyBurden = burden + (input.existingMonthlyDebt ?? 0);
    const eligible = income > 0 && monthlyBurden / income <= dtiCap;
    if (!eligible) reasonsFa.push(`بار ماهانه ${monthlyBurden.toFixed(1)} م.ت از سقف DTI عبور می‌کند`);
    return {
      kind: "revolving",
      eligible,
      reasonsFa,
      limit,
      drawn: limit * drawn,
      rate: input.annualRate,
      monthlyBurden,
      annualFee,
      aprPct: clamp(aprPct, 0, 999),
    };
  }

  if (input.productClass === "points") {
    const balance = Math.max(0, input.depositBalance ?? 0);
    const holding = clamp(input.holdingMonths ?? 6, 1, 36);
    const k = clamp(input.multiplierK ?? 0.35, 0.05, 1.5);
    // L = k × B × H / N  — money–time points limit
    const estimatedLimit = k * balance * (holding / Math.max(1, input.tenorMonths));
    const commission = estimatedLimit * clamp(input.annualRate, 0, 0.06);
    const eligible = balance > 0;
    if (!eligible) reasonsFa.push("مانده سپرده برای امتیازگیری صفر است");
    return {
      kind: "points",
      eligible,
      reasonsFa,
      balance,
      holdingMonths: holding,
      multiplier: k,
      estimatedLimit,
      commission,
    };
  }

  // instalment / QH
  const tenor = clamp(Math.round(input.tenorMonths), 1, 360);
  const amount = Math.max(0, input.amountMillionToman);
  const isQh = input.productClass === "qh";
  const rate = isQh ? 0 : clamp(input.annualRate, 0, 2);
  const monthlyPayment = annuityPayment(rate, tenor, amount);
  const totalPayment = monthlyPayment * tenor + amount * (input.upfrontFeePct ?? 0) * (isQh ? 1 : 0);
  const schedule = unitSchedule(rate * 100, tenor, "annuity");
  const aprPct = effectiveAprPct(schedule, isQh ? (input.upfrontFeePct ?? 4) : (input.upfrontFeePct ?? 0));
  const burden = monthlyPayment + (input.existingMonthlyDebt ?? 0);
  const eligible = income > 0 && burden / income <= dtiCap;
  if (!eligible) reasonsFa.push(`قسط ${monthlyPayment.toFixed(1)} م.ت + بدهی جاری از سقف ${fa(dtiCap)} درآمد عبور می‌کند`);
  return {
    kind: "instalment",
    eligible,
    reasonsFa,
    amount,
    rate,
    tenorMonths: tenor,
    monthlyPayment,
    totalPayment,
    totalCost: totalPayment - amount,
    aprPct: clamp(aprPct, 0, 999),
    firstPaymentDateHintFa: isQh ? "قسط قرض‌الحسنه برابر اقساط مساوی اصل + کارمزد پیش‌دریافت" : "قسط annuity ماهانه",
  };
}
