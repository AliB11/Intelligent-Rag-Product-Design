/**
 * Deposit Cannibalization & Migration Matrix
 * ---------------------------------------------------------------------------
 * A new product rarely raises only fresh money: a share α of its inflow is
 * MIGRATED from the bank's own existing low-cost deposits (CASA / Qard-al-
 * Hasan savings). This module prices that migration honestly:
 *
 *   D                = attracted product deposit volume (Rial)
 *   α                = cannibalization_rate ∈ [0, 1]
 *   NNM              = (1 − α) · D        Net New Money (genuinely fresh)
 *   Migrated         = α · D              Migrated Internal Funds
 *   r_src            = source_deposit_cost (annual) — what the bank used to
 *                      pay on the migrated funds
 *   r_dep            = product deposit rate (annual)
 *   cof(r)           = audited all-in cost of funds at rate r
 *                      (reserve drag + liquidity drag + opex + EL)
 *
 *   marginal funding cost of a migrated dollar = cof(r_dep) − cof(r_src)
 *   MCoF  = [ NNM·cof(r_dep) + Migrated·(cof(r_dep) − cof(r_src)) ] / D
 *         = cof(r_dep) − α · ( cof(r_dep) − cof(r_src) )
 *
 *   lostSpreadOnCannibalizedRial = Migrated · (cof(r_dep) − cof(r_src))
 *         (the spread the bank forfeits by replacing cheap source funding
 *          with product funding — negative when the product is CHEAPER than
 *          the source, i.e. a genuine funding gain.)
 *
 *   NII_post = LoanBook·(r_loan + fee) + treasuryIncome − D·MCoF
 *   riskAdjustedNII = NII_post − LoanBook·EL,  EL = PD·LGD
 *
 * All identities are exact; inputs are Zod-grade validated (RangeError on
 * out-of-range α / non-finite or negative rates) and every output is finite.
 */

import { z } from "zod";
import { LIQUIDITY_DEDUCTION_DEFAULT, OPEX_RATIO_DEFAULT, TREASURY_RATE } from "./constants";
import { costOfFunds } from "./costOfFunds";

export const cannibalizationInputSchema = z
  .object({
    depositVolumeRial: z.number().finite().min(0),
    loanToDepositMultiplier: z.number().finite().min(0).max(10),
    cannibalizationRate: z.number().min(0).max(1),
    sourceDepositCost: z.number().finite().min(0).max(1),
    depositInterestRate: z.number().finite().min(0).max(1),
    loanInterestRate: z.number().finite().min(0).max(1),
    feeRate: z.number().finite().min(0).max(1),
    statutoryReserve: z.number().finite().min(0).max(0.95),
    liquidityDeduction: z.number().finite().min(0).max(0.95).optional(),
    opexRatio: z.number().finite().min(0).max(1).optional(),
    /** PD × LGD of the loan book (risk charge on NII). */
    expectedLossRate: z.number().finite().min(0).max(1).optional(),
    treasuryRate: z.number().finite().min(0).max(1).optional(),
  })
  .strict()
  .refine((v) => v.statutoryReserve + (v.liquidityDeduction ?? LIQUIDITY_DEDUCTION_DEFAULT) < 1, {
    message: "statutoryReserve + liquidityDeduction must be < 1",
  });

export type CannibalizationInput = z.output<typeof cannibalizationInputSchema>;

export interface CannibalizationResult {
  /** (1 − α) · D — genuinely new money. */
  netNewMoneyRial: number;
  /** α · D — funds migrated from existing low-cost deposits. */
  migratedInternalFundsRial: number;
  /** All-in marginal cost of the attracted deposit dollar (annual). */
  marginalCostOfFunds: number;
  /** Annual incremental funding cost of migrated funds (the lost spread). */
  lostSpreadOnCannibalizedRial: number;
  /** Total annual funding cost = D · MCoF. */
  fundingCostRial: number;
  loanBookRial: number;
  /** LoanBook · (r_loan + fee). */
  grossInterestIncomeRial: number;
  /** Treasury income on liquidity left after reserve/liquidity haircuts. */
  treasuryIncomeRial: number;
  /** max(0, D·(1−RR−LR) − LoanBook) — idle liquidity base. */
  excessLiquidityRial: number;
  /** Post-cannibalization NII (repo all-in convention): income + treasury − funding. */
  netInterestIncomeRial: number;
  /** NII − LoanBook · EL. */
  riskAdjustedNiiRial: number;
  /** cof(r_dep) — cost of funds if the raise were 100% new money. */
  newMoneyCostOfFunds: number;
  /** cof(r_src) — cost of funds of the source (pre-migration) deposits. */
  sourceCostOfFunds: number;
}

/**
 * Compute the migration matrix, MCoF and post-cannibalization NII.
 * Deterministic and total for every input accepted by the schema.
 */
export function computeCannibalization(raw: CannibalizationInput): CannibalizationResult {
  const input = cannibalizationInputSchema.parse(raw);
  const {
    depositVolumeRial: D,
    loanToDepositMultiplier: M,
    cannibalizationRate: alpha,
    sourceDepositCost: rSrc,
    depositInterestRate: rDep,
    loanInterestRate: rLoan,
    feeRate: fee,
    statutoryReserve: rr,
  } = input;
  const lr = input.liquidityDeduction ?? LIQUIDITY_DEDUCTION_DEFAULT;
  const opex = input.opexRatio ?? OPEX_RATIO_DEFAULT;
  const el = input.expectedLossRate ?? 0;
  const treasury = input.treasuryRate ?? TREASURY_RATE;

  const cofNew = costOfFunds({
    depositRate: rDep,
    statutoryReserve: rr,
    liquidityDeduction: lr,
    opexRatio: opex,
  }).costOfFunds;
  const cofSrc = costOfFunds({
    depositRate: rSrc,
    statutoryReserve: rr,
    liquidityDeduction: lr,
    opexRatio: opex,
  }).costOfFunds;

  const netNewMoneyRial = (1 - alpha) * D;
  const migratedInternalFundsRial = alpha * D;
  // MCoF = cof(r_dep) − α·(cof(r_dep) − cof(r_src))  (exact linear form).
  const marginalCostOfFunds = cofNew - alpha * (cofNew - cofSrc);
  const lostSpreadOnCannibalizedRial = migratedInternalFundsRial * (cofNew - cofSrc);
  const fundingCostRial = D * marginalCostOfFunds;

  const loanBookRial = M * D;
  const grossInterestIncomeRial = loanBookRial * (rLoan + fee);
  const excessLiquidityRial = Math.max(0, D * (1 - rr - lr) - loanBookRial);
  const treasuryIncomeRial = excessLiquidityRial * treasury;
  const netInterestIncomeRial = grossInterestIncomeRial + treasuryIncomeRial - fundingCostRial;
  const riskAdjustedNiiRial = netInterestIncomeRial - loanBookRial * el;

  return {
    netNewMoneyRial,
    migratedInternalFundsRial,
    marginalCostOfFunds,
    lostSpreadOnCannibalizedRial,
    fundingCostRial,
    loanBookRial,
    grossInterestIncomeRial,
    treasuryIncomeRial,
    excessLiquidityRial,
    netInterestIncomeRial,
    riskAdjustedNiiRial,
    newMoneyCostOfFunds: cofNew,
    sourceCostOfFunds: cofSrc,
  };
}
