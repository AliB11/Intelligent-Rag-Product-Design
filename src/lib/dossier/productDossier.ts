/**
 * Auditable Product Dossier (Phase 5)
 * ---------------------------------------------------------------------------
 * Single, deterministic projection of a completed pipeline state into the
 * deliverable dossier:
 *
 *   1. Optimal Product Spec        — the inverse solver's seven decision
 *                                    variables, feasibility and violations
 *   2. ALM & Profitability Metrics — Bank IRR, customer effective IRR, MCoF,
 *                                    net NII post-cannibalization, risk-
 *                                    adjusted NII, breakeven month, gaps
 *   3. Stress-Test Matrix          — Base / +20% run-off / +3pp NPL /
 *                                    +15pp cannibalization
 *   4. Compliance & Grounding      — executable envelope, extracted
 *                                    constraints, citations, hidden-usury
 *                                    flags, validation status
 *   5. Committee Audit Log         — structured critique + every
 *                                    self-correction iteration (≤ 3)
 *
 * The builder is total (null when the run lacks a solve), has no timestamps
 * or RNG, and re-validates its own output with a strict Zod schema — the
 * dossier that leaves the builder is the dossier the API ships.
 */

import { z } from "zod";
import type { AgentState } from "../agents/state";
import { applyReserveFloor, constraintCitationSchema } from "../domain/regulatory";
import { computeCannibalization } from "../domain/cannibalization";

const decisionVectorSchema = z
  .object({
    depositRetentionMonths: z.number().int().min(1),
    loanToDepositMultiplier: z.number().min(0),
    blockedDepositPct: z.number().min(0).max(1),
    loanInterestRate: z.number().min(0).max(1),
    depositInterestRate: z.number().min(0).max(1),
    feeRate: z.number().min(0).max(1),
    repaymentMonths: z.number().int().min(1),
  })
  .strict();

const stressScenarioSchema = z
  .object({
    id: z.enum(["BASE", "DEPOSIT_RUNOFF_20", "NPL_SHOCK_3PP", "CANNIBALIZATION_15PP"]),
    labelFa: z.string().min(1),
    worstMonthlyGapRial: z.number(),
    worstCumulativeGapRial: z.number(),
    breakevenMonth: z.number().int().nullable(),
    netCashflowRial: z.number(),
    depositBalanceEndRial: z.number(),
    finalLoanBalanceRial: z.number(),
    breachedGapLimit: z.boolean(),
  })
  .strict();

export const productDossierSchema = z
  .object({
    product: z
      .object({
        code: z.string().min(1),
        titleFa: z.string().min(1),
        titleEn: z.string().min(1),
        targetDepositsRial: z.number().min(0),
        modeCount: z.number().int().min(1),
        modes: z
          .array(
            z
              .object({
                id: z.string(),
                nameFa: z.string(),
                contract: z.string(),
                weight: z.number(),
                loanRate: z.number(),
                blockedRatio: z.number(),
                feeIncomeRate: z.number(),
                sleepMonths: z.number().int(),
                tenorMonths: z.number().int(),
              })
              .strict(),
          )
          .min(1),
      })
      .strict(),
    optimalSpec: z
      .object({
        solution: decisionVectorSchema,
        feasible: z.boolean(),
        violations: z.array(z.string()),
        objective: z.number(),
        evaluations: z.number().int().min(0),
        elapsedMs: z.number().min(0),
      })
      .strict(),
    almProfitability: z
      .object({
        bankIrrAnnual: z.number(),
        customerNominalIrr: z.number(),
        customerEffectiveIrr: z.number(),
        customerDepositYield: z.number(),
        marginalCostOfFunds: z.number(),
        netNiiPostCannibalization: z.number(),
        riskAdjustedNiiRial: z.number(),
        lostSpreadOnCannibalizedRial: z.number(),
        breakevenMonth: z.number().int().nullable(),
        worstMonthlyGapRial: z.number(),
        worstCumulativeGapRial: z.number(),
      })
      .strict(),
    cannibalization: z
      .object({
        rate: z.number().min(0).max(1),
        netNewMoneyRial: z.number(),
        migratedRial: z.number(),
        sourceCostOfFunds: z.number(),
        newMoneyCostOfFunds: z.number(),
        marginalCostOfFunds: z.number(),
        lostSpreadOnCannibalizedRial: z.number(),
        netInterestIncomeRial: z.number(),
      })
      .strict(),
    stressMatrix: z
      .object({
        scenarios: z.array(stressScenarioSchema).length(4),
        worstScenarioId: z.enum([
          "BASE",
          "DEPOSIT_RUNOFF_20",
          "NPL_SHOCK_3PP",
          "CANNIBALIZATION_15PP",
        ]),
        allRespectGapLimit: z.boolean(),
        gapLimitRial: z.number().min(0),
      })
      .strict(),
    compliance: z
      .object({
        validationStatus: z.enum(["constraints_passed", "not_validated", "pending"]),
        envelope: z
          .object({
            max_loan_interest_rate: z.number().min(0).max(1),
            max_fee_rate: z.number().min(0).max(1),
            min_reserve_ratio: z.number().min(0).max(1),
            allow_blocked_deposit_collateral: z.boolean(),
            effective_rate_cap: z.number().min(0).max(1),
            citations: z.array(constraintCitationSchema),
          })
          .strict(),
        constraintCount: z.number().int().min(0),
        bindingConstraints: z.array(
          z.object({ id: z.string(), code: z.string(), citation: z.string() }).strict(),
        ),
        hiddenUsury: z
          .object({
            effectiveRateCap: z.number().min(0).max(1),
            solverBorrowerNominal: z.number(),
            solverFlagged: z.boolean(),
            designFlagged: z.boolean(),
          })
          .strict(),
      })
      .strict(),
    committeeAuditLog: z
      .object({
        critique: z.string().min(1),
        maxIterations: z.number().int().min(1),
        iterations: z
          .array(
            z
              .object({
                iteration: z.number().int().min(1),
                feasible: z.boolean(),
                irrAnnual: z.number(),
                p95Ldr: z.number(),
                p5Lcr: z.number(),
                findingCount: z.number().int().min(0),
                blockerCount: z.number().int().min(0),
                directivesApplied: z.number().int().min(0),
              })
              .strict(),
          )
          .max(8),
        committeeNodes: z.array(z.string()).min(1),
        traceEventCount: z.number().int().min(0),
      })
      .strict(),
  })
  .strict();

export type ProductDossier = z.output<typeof productDossierSchema>;

/**
 * Build the dossier from a completed pipeline state.
 * Returns null when the state does not carry an inverse solve (e.g. a failed
 * run) — the API then ships `dossier: null` rather than a partial artifact.
 */
export function buildProductDossier(state: AgentState): ProductDossier | null {
  const solution = state.inverseSolution;
  const input = state.inverseSolverInput;
  const matrix = state.stressMatrix;
  const product = state.product;
  const envelope = state.regulatoryConstraints;
  if (!solution || !input || !matrix || !product || !envelope) return null;

  const rateCap = envelope.effective_rate_cap;
  const designFlagged = state.findings.some((f) => f.id === "hidden-usury-design");

  // Exact migration-matrix figures for the solved structure (single source:
  // the same module the solver and stress guardian use).
  const cannibalization = computeCannibalization({
    depositVolumeRial: input.depositVolumeRial,
    loanToDepositMultiplier: solution.solution.loanToDepositMultiplier,
    cannibalizationRate: input.cannibalizationRate,
    sourceDepositCost: input.sourceDepositCost,
    depositInterestRate: solution.solution.depositInterestRate,
    loanInterestRate: solution.solution.loanInterestRate,
    feeRate: solution.solution.feeRate,
    statutoryReserve: applyReserveFloor(
      input.statutoryReserveBase,
      envelope,
    ),
    liquidityDeduction: input.liquidityDeduction,
    opexRatio: input.opexRatio,
    expectedLossRate: input.pd * input.lgd,
    treasuryRate: input.treasuryRate,
  });
  const committeeNodes = Array.from(
    new Set(
      state.trace
        .map((e) => e.node)
        .filter((n) =>
          ["inverse_solver", "stress_guardian", "critic_auditor", "mathematical_synthesizer"].includes(
            n,
          ),
        ),
    ),
  ).sort();

  const dossier: ProductDossier = {
    product: {
      code: product.code,
      titleFa: product.titleFa,
      titleEn: product.titleEn,
      targetDepositsRial: product.targetDepositsRial,
      modeCount: product.modes.length,
      modes: product.modes.map((m) => ({
        id: m.id,
        nameFa: m.nameFa,
        contract: m.contract,
        weight: m.weight,
        loanRate: m.loanRate,
        blockedRatio: m.blockedRatio,
        feeIncomeRate: m.feeIncomeRate,
        sleepMonths: m.sleepMonths,
        tenorMonths: m.tenorMonths,
      })),
    },
    optimalSpec: {
      solution: solution.solution,
      feasible: solution.feasible,
      violations: solution.violations,
      objective: solution.objective,
      evaluations: solution.evaluations,
      elapsedMs: solution.elapsedMs,
    },
    almProfitability: {
      bankIrrAnnual: solution.metrics.bankIrrAnnual,
      customerNominalIrr: solution.metrics.borrowerNominalEquivalent,
      customerEffectiveIrr: solution.metrics.borrowerEffectiveAnnual,
      customerDepositYield: solution.metrics.customerDepositYield,
      marginalCostOfFunds: solution.metrics.marginalCostOfFunds,
      netNiiPostCannibalization: solution.metrics.netInterestIncomeRial,
      riskAdjustedNiiRial: solution.metrics.riskAdjustedNiiRial,
      lostSpreadOnCannibalizedRial: solution.metrics.lostSpreadOnCannibalizedRial,
      breakevenMonth: solution.metrics.breakevenMonth,
      worstMonthlyGapRial: solution.metrics.worstMonthlyGapRial,
      worstCumulativeGapRial: solution.metrics.worstCumulativeGapRial,
    },
    cannibalization: {
      rate: input.cannibalizationRate,
      netNewMoneyRial: cannibalization.netNewMoneyRial,
      migratedRial: cannibalization.migratedInternalFundsRial,
      sourceCostOfFunds: cannibalization.sourceCostOfFunds,
      newMoneyCostOfFunds: cannibalization.newMoneyCostOfFunds,
      marginalCostOfFunds: cannibalization.marginalCostOfFunds,
      lostSpreadOnCannibalizedRial: cannibalization.lostSpreadOnCannibalizedRial,
      netInterestIncomeRial: cannibalization.netInterestIncomeRial,
    },
    stressMatrix: matrix,
    compliance: {
      validationStatus: state.validationStatus,
      envelope,
      constraintCount: state.constraints.length,
      bindingConstraints: state.constraints.map((c) => ({
        id: c.id,
        code: c.code,
        citation: c.citation,
      })),
      hiddenUsury: {
        effectiveRateCap: rateCap,
        solverBorrowerNominal: solution.metrics.borrowerNominalEquivalent,
        solverFlagged: solution.metrics.borrowerNominalEquivalent > rateCap + 1e-9,
        designFlagged,
      },
    },
    committeeAuditLog: {
      critique: state.critique ?? "CRITIQUE: not available. Action required: none.",
      maxIterations: 3,
      iterations: state.iterations.map((it) => ({
        iteration: it.iteration,
        feasible: it.feasible,
        irrAnnual: it.irrAnnual,
        p95Ldr: it.p95Ldr,
        p5Lcr: it.p5Lcr,
        findingCount: it.findings.length,
        blockerCount: it.findings.filter((f) => f.severity === "blocker").length,
        directivesApplied: it.directivesAppliedFa.length,
      })),
      committeeNodes,
      traceEventCount: state.trace.length,
    },
  };

  // Defence in depth: a dossier that does not satisfy its own strict schema
  // never reaches the API or the UI.
  productDossierSchema.parse(dossier);
  return dossier;
}
