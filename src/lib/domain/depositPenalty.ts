/**
 * Early-withdrawal settlement of term deposits (سپرده‌های بلندمدت / ویژه).
 * ---------------------------------------------------------------------------
 * Iranian retail banks settle a deposit withdrawn before maturity under one
 * of three contractual policies:
 *
 *   • "pro_rata"        — CBI pro-rata profit: the depositor keeps the profit
 *                         accrued up to the withdrawal month (no penalty).
 *   • "forfeit_accrued" — full forfeiture: the bank keeps the accrued profit
 *                         (قرض‌الحسنه بلندمدت / طرح‌های ویژه زودرس‌برداشت).
 *   • "penalty_fraction"— a contractual fraction of the accrued profit is
 *                         withheld by the bank (جریمه برداشت پیش‌ازموعد).
 *
 * Accrual convention (consistent with the monthly cohort engine):
 *
 *   accrued(m) = P · (r / 12) · min(m, N)
 *   fullTerm   = P · (r / 12) · N
 *
 * with P = principal, r = contracted nominal annual rate, N = contractual
 * months, m = withdrawal month. Every function here is total: it never
 * divides by zero (m = 0 or r = 0 are well-defined), never emits NaN /
 * Infinity for finite inputs, and always satisfies
 *
 *   principal ≤ payout ≤ principal + fullTerm,   0 ≤ penalty ≤ accrued,
 *   0 ≤ effectiveAnnualRate ≤ r.
 */

export type EarlyWithdrawalPolicy = "pro_rata" | "forfeit_accrued" | "penalty_fraction";

export interface EarlyWithdrawalInput {
  /** Principal P in Rial (>= 0). */
  principalRial: number;
  /** Contracted nominal annual rate r in [0, 1] (0 for Qard-al-Hasan deposits). */
  annualRate: number;
  /** Contracted term N in months (>= 1). */
  contractedMonths: number;
  /** Withdrawal month m in [0, N] (values above N are clamped to N). */
  withdrawnMonth: number;
  /** Settlement policy; defaults to "pro_rata". */
  policy?: EarlyWithdrawalPolicy;
  /** For "penalty_fraction": fraction of accrued profit withheld, in [0, 1]. */
  penaltyFraction?: number;
}

export interface EarlyWithdrawalResult {
  /** Profit accrued up to withdrawal: P·r/12·min(m, N). */
  accruedProfitRial: number;
  /** Profit that would be paid at maturity: P·r/12·N. */
  fullTermProfitRial: number;
  /** Amount withheld from the depositor by the bank (>= 0). */
  penaltyRial: number;
  /** principal + accrued − penalty (>= principal). */
  depositorPayoutRial: number;
  /** Annualised rate the depositor actually earned; 0-safe. */
  effectiveAnnualRate: number;
  /** Bank's net gain from the early withdrawal (== penaltyRial). */
  bankGainRial: number;
}

function requireFinite(name: string, value: number): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${name} must be a finite number`);
  }
}

/**
 * Settle an early deposit withdrawal. Deterministic, total, and invariant-
 * checked: out-of-range months are clamped, penalties are capped at the
 * accrued profit, and principal is never reduced below its face value.
 */
export function earlyWithdrawalSettlement(
  input: EarlyWithdrawalInput,
): EarlyWithdrawalResult {
  const { principalRial, annualRate } = input;
  requireFinite("principalRial", principalRial);
  requireFinite("annualRate", annualRate);
  requireFinite("contractedMonths", input.contractedMonths);
  requireFinite("withdrawnMonth", input.withdrawnMonth);
  if (principalRial < 0) throw new RangeError("principalRial must be non-negative");
  if (annualRate < 0) throw new RangeError("annualRate must be non-negative");
  if (annualRate > 1) throw new RangeError("annualRate must be at most 1 (100% p.a.)");
  if (input.contractedMonths < 1) throw new RangeError("contractedMonths must be >= 1");

  const months = Math.max(1, Math.round(input.contractedMonths));
  const m = Math.min(Math.max(0, Math.round(input.withdrawnMonth)), months);
  const policy = input.policy ?? "pro_rata";

  const monthlyProfit = (principalRial * annualRate) / 12;
  const accruedProfitRial = monthlyProfit * m;
  const fullTermProfitRial = monthlyProfit * months;

  let penaltyFraction = 0;
  if (policy === "forfeit_accrued") penaltyFraction = 1;
  else if (policy === "penalty_fraction") {
    const raw = input.penaltyFraction ?? 0;
    requireFinite("penaltyFraction", raw);
    if (raw < 0 || raw > 1) throw new RangeError("penaltyFraction must be in [0, 1]");
    penaltyFraction = raw;
  } else if (policy !== "pro_rata") {
    throw new RangeError(`Unknown early-withdrawal policy: ${String(policy)}`);
  }

  const penaltyRial = accruedProfitRial * penaltyFraction;
  const depositorPayoutRial = principalRial + accruedProfitRial - penaltyRial;
  // Effective annual rate: (payout − P)/P · 12/m. Guarded so m = 0 or a
  // zero principal yield 0 instead of NaN.
  const effectiveAnnualRate =
    principalRial > 0 && m > 0
      ? ((depositorPayoutRial - principalRial) / principalRial) * (12 / m)
      : 0;

  return {
    accruedProfitRial,
    fullTermProfitRial,
    penaltyRial,
    depositorPayoutRial,
    effectiveAnnualRate,
    bankGainRial: penaltyRial,
  };
}
