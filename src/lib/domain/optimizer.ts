/**
 * app/domain/optimizer.py -> TypeScript twin
 * ---------------------------------------------------------------------------
 * Hybrid inverse goal-seeking solver.
 *
 *  Stage A (integer part): enumerate the mode-count M and the archetype
 *          combination (the 0/1 selection variables of the MILP).
 *  Stage B (LP relaxation): water-fill the resource weights w_m subject to
 *          sum(w_m) = 1 and the segment capacity constraints — this is the
 *          exact optimal solution of the linear allocation sub-problem.
 *  Stage C (non-linear part): seeded structured random search + coordinate
 *          local refinement over {tau_d, alpha, tau_l, r_l, beta, omega,
 *          gamma} scored by the deterministic ALM digital twin.
 *  Stage D: critic-auditor directives loop (max 5 self-corrections).
 *
 *   max  lambda1*IRR + lambda2*Adoption
 *        - lambda3*max_t( max(0, LDR_t - 0.80)^2 )
 *        - lambda4*OverturningShock
 *   s.t. sum_m D_m = D_target ; rate caps ; PMT <= 40% persona income ;
 *        p95 LDR <= 0.85 ; p5 LCR >= 1.05
 */

import {
  ALM_HORIZON_MONTHS,
  BILLION_TOMAN_RIAL,
  CB_REWARD_RATE,
  HURDLE_RATE,
  MAX_MONTE_CARLO_RUNS,
  MAX_OPTIMIZER_CANDIDATES,
  MC_RUNS,
  MC_SCREEN_RUNS,
  REGULATORY,
  TREASURY_RATE,
  TOMAN_RIAL,
  contractRateCeiling,
} from "./constants";
import { clamp, createRng, pmt, sampleDirichlet, seedFromString, type Rng } from "./financial";
import { costOfFunds, expectedLossOf } from "./costOfFunds";
import {
  bankProductNpv,
  installmentAffordability,
  loanEntitlement,
  weightedAverageBalance,
} from "./pointEngine";
import { evaluateProduct, runAlmSimulation } from "./almSimulator";
import { PERSONAS } from "./guildValueChain";
import type { MarketPriors, MarketStructuralParams } from "../rag/marketIntel";
import type {
  AlmMetrics,
  AlmResult,
  ContractType,
  CriticFinding,
  ModeArchetype,
  ModeSpec,
  PersonaSpec,
  ProductGenerationRequest,
  ProductSpec,
} from "./types";

export interface ArchetypeBlueprint {
  archetype: ModeArchetype;
  nameFa: string;
  nameEn: string;
  contracts: ContractType[];
  /** Relative segment capacity; normalized over the selected archetypes when their sum is below 100%. */
  capacityShare: number;
  statutoryReserve: [number, number];
  depositRate: [number, number];
  loanRate: [number, number];
  sleepMonths: [number, number];
  tenorMonths: [number, number];
  loanMultiplier: [number, number];
  blockedRatio: [number, number];
  waitingMonths: [number, number];
  closedLoopRetention: [number, number];
  withdrawalFraction: [number, number];
  sourceKappa: number;
  feeIncomeRate: [number, number];
  capToman: [number, number];
  avgDepositPerCustomerToman: number;
  pd: [number, number];
  lgd: [number, number];
  adoption: [number, number];
  liquidityDeduction: number;
  opexRatio: number;
  blockRelease: ModeSpec["blockRelease"];
}

export const BLUEPRINTS: Record<ModeArchetype, ArchetypeBlueprint> = {
  "retail-qarz-average": {
    archetype: "retail-qarz-average",
    nameFa: "میانگین حساب قرض‌الحسنه خرد",
    nameEn: "Retail Qarz-ol-Hasanah average-balance",
    contracts: ["qarz-hasaneh"],
    capacityShare: 0.42,
    statutoryReserve: [0.02, 0.02],
    depositRate: [0.0, 0.005],
    loanRate: [0.02, 0.04],
    sleepMonths: [3, 12],
    tenorMonths: [12, 60],
    loanMultiplier: [0.8, 1.7],
    blockedRatio: [0.05, 0.4],
    waitingMonths: [1, 5],
    closedLoopRetention: [0.15, 0.72],
    withdrawalFraction: [0.25, 0.55],
    sourceKappa: 1.0,
    feeIncomeRate: [0.001, 0.004],
    capToman: [150e6, 3e9],
    avgDepositPerCustomerToman: 45e6,
    pd: [0.012, 0.028],
    lgd: [0.18, 0.3],
    adoption: [0.72, 0.95],
    liquidityDeduction: 0.012,
    opexRatio: 0.035,
    blockRelease: "midpoint",
  },
  "investment-deposit": {
    archetype: "investment-deposit",
    nameFa: "سپرده سرمایه‌گذاری کوتاه/بلندمدت",
    nameEn: "Short & long-term investment deposit",
    contracts: ["mudaraba", "morabaha"],
    capacityShare: 0.28,
    statutoryReserve: [0.1, 0.15],
    depositRate: [0.14, 0.205],
    loanRate: [0.18, 0.23],
    sleepMonths: [1, 6],
    tenorMonths: [12, 60],
    loanMultiplier: [0.55, 1.05],
    blockedRatio: [0.0, 0.18],
    waitingMonths: [0, 3],
    closedLoopRetention: [0.1, 0.68],
    withdrawalFraction: [0.18, 0.42],
    sourceKappa: 1.0,
    feeIncomeRate: [0.002, 0.006],
    capToman: [200e6, 5e9],
    avgDepositPerCustomerToman: 180e6,
    pd: [0.02, 0.045],
    lgd: [0.25, 0.4],
    adoption: [0.45, 0.75],
    liquidityDeduction: 0.01,
    opexRatio: 0.032,
    blockRelease: "linear",
  },
  "merchant-pos-accelerator": {
    archetype: "merchant-pos-accelerator",
    nameFa: "شتاب‌دهنده پذیرندگان POS و درگاه پرداخت",
    nameEn: "POS / IPG merchant accelerator",
    contracts: ["qarz-hasaneh", "joalah", "kharid-deyn", "bnpl"],
    capacityShare: 0.22,
    statutoryReserve: [0.02, 0.02],
    depositRate: [0.005, 0.02],
    loanRate: [0.03, 0.18],
    sleepMonths: [2, 6],
    tenorMonths: [6, 36],
    loanMultiplier: [1.0, 2.4],
    blockedRatio: [0.03, 0.25],
    waitingMonths: [0, 2],
    closedLoopRetention: [0.45, 0.92],
    withdrawalFraction: [0.2, 0.45],
    sourceKappa: 1.5,
    feeIncomeRate: [0.006, 0.014],
    capToman: [200e6, 5e9],
    avgDepositPerCustomerToman: 90e6,
    pd: [0.01, 0.024],
    lgd: [0.15, 0.26],
    adoption: [0.68, 0.93],
    liquidityDeduction: 0.008,
    opexRatio: 0.03,
    blockRelease: "linear",
  },
  "corporate-float-anchor": {
    archetype: "corporate-float-anchor",
    nameFa: "لنگر شناوری حقوق و دستمزد شرکتی",
    nameEn: "Corporate payroll / float anchor",
    contracts: ["morabaha", "kharid-deyn", "qarz-hasaneh"],
    capacityShare: 0.26,
    statutoryReserve: [0.02, 0.1],
    depositRate: [0.02, 0.06],
    loanRate: [0.04, 0.23],
    sleepMonths: [2, 5],
    tenorMonths: [18, 60],
    loanMultiplier: [0.7, 1.5],
    blockedRatio: [0.0, 0.2],
    waitingMonths: [0, 3],
    closedLoopRetention: [0.5, 0.9],
    withdrawalFraction: [0.15, 0.38],
    sourceKappa: 1.3,
    feeIncomeRate: [0.004, 0.012],
    capToman: [1e9, 5e9],
    avgDepositPerCustomerToman: 850e6,
    pd: [0.018, 0.038],
    lgd: [0.22, 0.35],
    adoption: [0.5, 0.8],
    liquidityDeduction: 0.01,
    opexRatio: 0.028,
    blockRelease: "linear",
  },
  "supply-chain-gam": {
    archetype: "supply-chain-gam",
    nameFa: "اوراق گام زنجیره تأمین",
    nameEn: "Gam supply-chain certificate",
    contracts: ["gam", "kharid-deyn"],
    capacityShare: 0.2,
    statutoryReserve: [0.0, 0.0],
    depositRate: [0.0, 0.02],
    loanRate: [0.06, 0.19],
    sleepMonths: [1, 4],
    tenorMonths: [6, 24],
    loanMultiplier: [0.9, 2.0],
    blockedRatio: [0.0, 0.12],
    waitingMonths: [0, 2],
    closedLoopRetention: [0.6, 0.95],
    withdrawalFraction: [0.1, 0.3],
    sourceKappa: 1.4,
    feeIncomeRate: [0.008, 0.018],
    capToman: [2e9, 5e9],
    avgDepositPerCustomerToman: 3.2e9,
    pd: [0.015, 0.03],
    lgd: [0.2, 0.32],
    adoption: [0.55, 0.82],
    liquidityDeduction: 0.006,
    opexRatio: 0.024,
    blockRelease: "end",
  },
  "scored-deposit-credit": {
    archetype: "scored-deposit-credit",
    nameFa: "اعتبار امتیازی سپرده‌محور (الگوی نیک/نگین/مهربانی)",
    nameEn: "Scored deposit-backed credit (Nik / Negin / Mehraban pattern)",
    contracts: ["qarz-hasaneh", "morabaha"],
    capacityShare: 0.32,
    statutoryReserve: [0.02, 0.1],
    depositRate: [0.0, 0.05],
    loanRate: [0.05, 0.23],
    sleepMonths: [4, 12],
    tenorMonths: [12, 60],
    loanMultiplier: [0.6, 3.0],
    blockedRatio: [0.0, 0.15],
    waitingMonths: [0, 6],
    closedLoopRetention: [0.55, 0.9],
    withdrawalFraction: [0.15, 0.35],
    sourceKappa: 1.2,
    feeIncomeRate: [0.002, 0.006],
    capToman: [150e6, 1e9],
    avgDepositPerCustomerToman: 60e6,
    pd: [0.01, 0.022],
    lgd: [0.15, 0.28],
    adoption: [0.75, 0.96],
    liquidityDeduction: 0.012,
    opexRatio: 0.032,
    blockRelease: "linear",
  },
  "neobank-behavioral-credit": {
    archetype: "neobank-behavioral-credit",
    nameFa: "اعتبار رفتاری نئوبانکی",
    nameEn: "Neobank behavioral credit",
    contracts: ["morabaha", "qarz-hasaneh"],
    capacityShare: 0.32,
    statutoryReserve: [0.02, 0.1],
    depositRate: [0.0, 0.05],
    loanRate: [0.05, 0.23],
    sleepMonths: [1, 6],
    tenorMonths: [6, 24],
    loanMultiplier: [0.5, 1.5],
    blockedRatio: [0.0, 0.15],
    waitingMonths: [0, 6],
    closedLoopRetention: [0.55, 0.9],
    withdrawalFraction: [0.15, 0.35],
    sourceKappa: 1.2,
    feeIncomeRate: [0.002, 0.006],
    capToman: [10e6, 200e6],
    avgDepositPerCustomerToman: 60e6,
    pd: [0.01, 0.022],
    lgd: [0.15, 0.28],
    adoption: [0.75, 0.96],
    liquidityDeduction: 0.012,
    opexRatio: 0.032,
    blockRelease: "linear",
  },
  "wealth-collateral-credit": {
    archetype: "wealth-collateral-credit",
    nameFa: "اعتبار با وثیقه دارایی",
    nameEn: "Wealth collateral credit",
    contracts: ["morabaha"],
    capacityShare: 0.32,
    statutoryReserve: [0.02, 0.1],
    depositRate: [0.0, 0.05],
    loanRate: [0.05, 0.23],
    sleepMonths: [0, 2],
    tenorMonths: [12, 60],
    loanMultiplier: [0.5, 0.85],
    blockedRatio: [0.0, 0.15],
    waitingMonths: [0, 6],
    closedLoopRetention: [0.55, 0.9],
    withdrawalFraction: [0.15, 0.35],
    sourceKappa: 1.2,
    feeIncomeRate: [0.002, 0.006],
    capToman: [150e6, 1e9],
    avgDepositPerCustomerToman: 60e6,
    pd: [0.01, 0.022],
    lgd: [0.15, 0.28],
    adoption: [0.75, 0.96],
    liquidityDeduction: 0.012,
    opexRatio: 0.032,
    blockRelease: "linear",
  },
};

export interface SolveOptions {
  runs?: number;
  screenRuns?: number;
  candidates?: number;
  seed?: string | number;
  horizonMonths?: number;
  maxIterations?: number;
  persona?: PersonaSpec | null;
  forcedArchetypes?: ModeArchetype[];
  gammaFloor?: number;
  /** Market-research priors: median structural parameters of the closest real products. */
  priors?: MarketPriors | null;
  signal?: AbortSignal;
  onProgress?: (event: OptimizerProgress) => void;
}

export interface OptimizerProgress {
  stage: string;
  messageFa: string;
  messageEn: string;
  detail?: Record<string, unknown>;
}

export interface SolveResult {
  product: ProductSpec;
  alm: AlmResult;
  metrics: AlmMetrics;
  score: number;
  feasible: boolean;
  iterations: OptimizerIteration[];
  candidatesScreened: number;
  elapsedMs: number;
}

export interface OptimizerIteration {
  iteration: number;
  score: number;
  irrAnnual: number;
  p95Ldr: number;
  p5Lcr: number;
  overturningShock: number;
  netDrainRatio: number;
  feasible: boolean;
  findings: CriticFinding[];
  directivesAppliedFa: string[];
}

function lerp(range: [number, number], u: number) {
  return range[0] + (range[1] - range[0]) * clamp(u, 0, 1);
}

/** Stage B — deterministic water-filling of relative segment capacities. */
export function allocateWeights(archetypes: ModeArchetype[], shares: number[]): number[] {
  if (!archetypes.length) return [];
  const priorities: number[] = archetypes.map((_, i) => Math.max(0, Number.isFinite(shares[i]) ? shares[i] : 0));
  const allZero = priorities.reduce((all, value) => all && value === 0, true);
  if (allZero) priorities.fill(1);
  const rawCaps = archetypes.map((a) => Math.max(0, BLUEPRINTS[a].capacityShare));
  const rawCapacity = rawCaps.reduce((total, value) => total + value, 0);
  const caps = rawCapacity > 0 && rawCapacity < 1
    ? rawCaps.map((value) => value / rawCapacity)
    : rawCaps;
  const out = new Array<number>(archetypes.length).fill(0);
  const active = new Set(archetypes.map((_, i) => i).filter((i) => caps[i] > 0));
  let remaining = 1;

  while (remaining > 1e-12 && active.size > 0) {
    const activePriority = [...active].reduce((total, i) => total + priorities[i], 0);
    let allocated = 0;
    const saturated: number[] = [];
    for (const i of active) {
      const share = activePriority > 0 ? priorities[i] / activePriority : 1 / active.size;
      const headroom = Math.max(0, caps[i] - out[i]);
      const give = Math.min(headroom, remaining * share);
      out[i] += give;
      allocated += give;
      if (headroom - give <= 1e-12) saturated.push(i);
    }
    remaining -= allocated;
    saturated.forEach((i) => active.delete(i));
    if (allocated <= 1e-12) break;
  }

  // The relative-capacity normalization guarantees sufficient capacity; retain
  // a final numerical correction so the invariant sum(w)=1 is exact.
  if (remaining > 1e-9) {
    const available = archetypes.map((_, i) => i).filter((i) => caps[i] > out[i] + 1e-12);
    const recipients = available.length ? available : archetypes.map((_, i) => i);
    const priorityTotal = recipients.reduce((total, i) => total + priorities[i], 0);
    recipients.forEach((i) => {
      const share = priorityTotal > 0 ? priorities[i] / priorityTotal : 1 / recipients.length;
      out[i] += remaining * share;
    });
  }
  const total = out.reduce((a, b) => a + b, 0);
  return total > 0 ? out.map((weight) => weight / total) : archetypes.map(() => 1 / archetypes.length);
}

export interface ModeSeed {
  archetype: ModeArchetype;
  contract: ContractType;
  u: Record<string, number>;
}

function randomUnitVector(rng: Rng, length: number, dirichletAlpha = 2.2): number[] {
  if (length <= 0) return [];
  return sampleDirichlet(rng, new Array<number>(length).fill(dirichletAlpha));
}

/** Stage C — build a fully derived, regulation-checked ModeSpec. */
export function buildMode(
  blueprint: ArchetypeBlueprint,
  contract: ContractType,
  weight: number,
  targetDepositsRial: number,
  params: Record<string, number>,
  persona: PersonaSpec | null,
  index: number,
  gammaFloor = 0,
  blockRelease: ModeSpec["blockRelease"] = blueprint.blockRelease,
): ModeSpec {
  const depositVolumeRial = Math.max(0, weight) * targetDepositsRial;
  const statutoryReserve = params.rrExact !== undefined
    ? clamp(params.rrExact, 0, 0.5)
    : lerp(blueprint.statutoryReserve, params.rr ?? 0.5);
  const depositRate = params.rdExact !== undefined
    ? clamp(params.rdExact, 0, 0.5)
    : lerp(blueprint.depositRate, params.rd ?? 0.5);
  const pd = params.pdExact !== undefined ? clamp(params.pdExact, 0, 1) : lerp(blueprint.pd, params.pd ?? 0.4);
  const lgd = params.lgdExact !== undefined ? clamp(params.lgdExact, 0, 1) : lerp(blueprint.lgd, params.lgd ?? 0.4);
  const el = expectedLossOf(pd, lgd);

  const cof = costOfFunds({
    depositRate,
    statutoryReserve,
    liquidityDeduction: blueprint.liquidityDeduction,
    opexRatio: blueprint.opexRatio,
    expectedLoss: el,
  });

  const rateCeiling = contractRateCeiling(contract);
  let loanRate = params.rlExact !== undefined
    ? clamp(params.rlExact, 0, rateCeiling)
    : clamp(lerp(blueprint.loanRate, params.rl ?? 0.6), 0, rateCeiling);

  // τ_d may be supplied exactly (post-staggering) so the value survives the
  // rebuild instead of being clamped back into the blueprint range.
  const sleepMonths = Math.round(params.tdExact !== undefined
    ? clamp(params.tdExact, 1, 24)
    : lerp(blueprint.sleepMonths, params.td ?? 0.5));
  const tenorMonths = Math.round(params.tlExact !== undefined
    ? clamp(params.tlExact, 1, 72)
    : lerp(blueprint.tenorMonths, params.tl ?? 0.5));
  const waitingMonths = Math.round(params.omegaExact !== undefined
    ? clamp(params.omegaExact, 0, 12)
    : lerp(blueprint.waitingMonths, params.omega ?? 0.4));
  let loanMultiplier = params.alphaExact !== undefined
    ? clamp(params.alphaExact, 0, 3)
    : lerp(blueprint.loanMultiplier, params.alpha ?? 0.5);
  const blockedRatio = params.betaExact !== undefined
    ? clamp(params.betaExact, 0, 0.65)
    : lerp(blueprint.blockedRatio, params.beta ?? 0.4);
  const rawGamma = params.gammaExact !== undefined
    ? params.gammaExact
    : lerp(blueprint.closedLoopRetention, params.gamma ?? 0.5);
  const closedLoopRetention = clamp(Math.max(rawGamma, gammaFloor), 0, 0.98);
  const withdrawalFractionMean = params.deltaExact !== undefined
    ? clamp(params.deltaExact, 0.01, 0.95)
    : lerp(blueprint.withdrawalFraction, params.delta ?? 0.5);
  const feeIncomeRate = contract === "qarz-hasaneh"
    ? 0
    : params.feeExact !== undefined
      ? clamp(params.feeExact, 0, 0.1)
      : lerp(blueprint.feeIncomeRate, params.fee ?? 0.4);
  const capToman = params.capExact !== undefined
    ? clamp(params.capExact, 1e6, 5e9)
    : lerp(blueprint.capToman, params.cap ?? 0.5);
  const adoptionScore = params.adoptionExact !== undefined
    ? clamp(params.adoptionExact, 0, 1)
    : lerp(blueprint.adoption, params.adoption ?? 0.6);

  // -----------------------------------------------------------------------
  // Market-learned coupling of the scored-deposit-credit family
  // (نیک‌وام ملت، نگین پویا/فراپویا سپه، مهربانی ملی). In these schemes the
  // customer accrues score = money × time, so the marketed matrices encode two
  // monotone laws that the engine reproduces deterministically:
  //   (1) α rises with the averaging window and the repayment tenor
  //       (نیک‌وام: coefficient 10%..320% over τ_d ∈ [4,12] × τ_l ∈ [12,60];
  //        مهربانی: up to 370% of the deposit);
  //   (2) for rate-bearing contracts r_l descends the 5%..23% ladder as the
  //       customer's patience (τ_d + ω) grows (نگین پویا/فراپویا trade-off).
  //   Qarz tiers reproduce the 0/2/4% fee ladder by ticket size (مهربانی).
  // -----------------------------------------------------------------------
  if (blueprint.archetype === "scored-deposit-credit") {
    const ramp = (value: number, lo: number, hi: number) =>
      clamp((value - lo) / Math.max(1, hi - lo), 0, 1);
    const tdRamp = ramp(sleepMonths, 4, 12);
    const tlRamp = ramp(tenorMonths, 12, 60);
    // +45% at the long (τ_d, τ_l) corner, −45% at the short corner — centered
    // so the blueprint-median structure keeps its sampled multiplier.
    loanMultiplier = clamp(
      loanMultiplier * (0.55 + 0.9 * (0.5 * tdRamp + 0.5 * tlRamp)),
      0.3,
      3,
    );
    if (contract === "qarz-hasaneh") {
      // مهربانی fee ladder: 0% up to 50M, 2% up to 100M, 4% above
      loanRate = capToman <= 50e6 ? 0 : capToman <= 100e6 ? 0.02 : 0.04;
    } else {
      // نگین patience pricing: longer (τ_d + ω) ⇒ visibly cheaper money
      const patience = 0.5 * tdRamp + 0.5 * ramp(waitingMonths, 0, 6);
      const floorRate = 0.05;
      loanRate = clamp(floorRate + (loanRate - floorRate) * (1 - 0.85 * patience), 0, rateCeiling);
    }
  }

  const avgDepositPerCustomerRial = blueprint.avgDepositPerCustomerToman * TOMAN_RIAL;
  const customers = Math.max(
    1,
    Math.round(depositVolumeRial / Math.max(1, avgDepositPerCustomerRial)),
  );

  const averageBalanceRial = weightedAverageBalance({
    depositVolumeRial,
    sleepMonths,
    sourceKappa: blueprint.sourceKappa,
    rampMonths: Math.min(6, Math.max(2, Math.round(sleepMonths * 0.7))),
  });

  const personaIncomeToman =
    persona?.monthlyNetIncomeToman ??
    (blueprint.archetype === "corporate-float-anchor" || blueprint.archetype === "supply-chain-gam"
      ? 420e6
      : blueprint.archetype === "merchant-pos-accelerator"
        ? 180e6
        : 42e6);

  const affordability = installmentAffordability(
    capToman * TOMAN_RIAL,
    contract === "qarz-hasaneh" ? 0 : loanRate,
    tenorMonths,
    personaIncomeToman,
    REGULATORY.installmentToIncomeCeiling,
  );
  const perCustomerCapRial = Math.min(
    capToman * TOMAN_RIAL,
    Math.max(capToman * TOMAN_RIAL * 0.08, affordability.maxAffordableLoanRial),
  );

  const entitlement = loanEntitlement({
    averageBalanceRial,
    loanMultiplier,
    capRial: perCustomerCapRial,
    customers,
  });
  const loanBookRial = entitlement.cappedRial;

  const npv = bankProductNpv({
    averageBalanceRial,
    loanAmountRial: loanBookRial,
    sleepMonths,
    waitingMonths,
    tenorMonths,
    loanRate,
    blockedRatio,
    closedLoopRetention,
    statutoryReserve,
    liquidityDeduction: blueprint.liquidityDeduction,
    costOfFunds: cof.costOfFunds,
    annuity: contract !== "qarz-hasaneh",
    upfrontCommissionRate: contract === "qarz-hasaneh" ? loanRate : 0,
    hurdleRate: HURDLE_RATE,
    treasuryRate: TREASURY_RATE,
    blockRelease,
  });

  const avgTicketToman = loanBookRial / TOMAN_RIAL / Math.max(1, customers);
  const installmentToman = pmt(
    (contract === "qarz-hasaneh" ? 0 : loanRate) / 12,
    Math.max(1, tenorMonths),
    (loanBookRial / Math.max(1, customers)),
  ) / TOMAN_RIAL;

  return {
    id: `M${index + 1}-${blueprint.archetype}`,
    nameFa: blueprint.nameFa,
    nameEn: blueprint.nameEn,
    archetype: blueprint.archetype,
    contract,
    weight,
    depositVolumeRial,
    depositRate,
    statutoryReserve,
    liquidityDeduction: blueprint.liquidityDeduction,
    opexRatio: blueprint.opexRatio,
    pd,
    lgd,
    sleepMonths,
    loanMultiplier,
    tenorMonths,
    loanRate,
    blockedRatio,
    waitingMonths,
    closedLoopRetention,
    withdrawalFractionMean,
    sourceKappa: blueprint.sourceKappa,
    feeIncomeRate,
    capToman,
    avgTicketToman,
    adoptionScore,
    blockRelease,
    cohortRampMonths: clamp(Math.round(sleepMonths * 0.8) + 2, 2, 14),
    personaIncomeToman,
    costOfFunds: cof.costOfFunds,
    expectedLoss: el,
    freeResourcesRial: depositVolumeRial * Math.max(0, 1 - statutoryReserve - blueprint.liquidityDeduction),
    loanBookRial,
    monthlyInstallmentToman: installmentToman,
    installmentToIncome: installmentToman / Math.max(1, personaIncomeToman),
    npvBankRial: npv.npvBankRial,
    customers,
  };
}

export function assembleProduct(
  modes: ModeSpec[],
  targetDepositsRial: number,
  code: string,
  titleFa: string,
  titleEn: string,
): ProductSpec {
  const totalDeposits = modes.reduce((a, m) => a + m.depositVolumeRial, 0) || 1;
  const totalLoans = modes.reduce((a, m) => a + m.loanBookRial, 0);
  return {
    code,
    titleFa,
    titleEn,
    targetDepositsRial,
    modes,
    blendedStatutoryReserve:
      modes.reduce((a, m) => a + m.weight * m.statutoryReserve, 0) /
      (modes.reduce((a, m) => a + m.weight, 0) || 1),
    blendedCostOfFunds:
      modes.reduce((a, m) => a + m.weight * m.costOfFunds, 0) /
      (modes.reduce((a, m) => a + m.weight, 0) || 1),
    blendedLoanRate:
      totalLoans > 0
        ? modes.reduce((a, m) => a + m.loanBookRial * m.loanRate, 0) / totalLoans
        : 0,
    blendedClosedLoopRetention:
      modes.reduce((a, m) => a + m.weight * m.closedLoopRetention, 0) /
      (modes.reduce((a, m) => a + m.weight, 0) || 1),
    totalLoanBookRial: totalLoans,
    structuralLoanToDeposit:
      totalLoans /
      Math.max(1, modes.reduce((total, mode) =>
        total + mode.depositVolumeRial * Math.max(0, 1 - mode.statutoryReserve - mode.liquidityDeduction), 0)),
    hurdleRate: HURDLE_RATE,
    treasuryRate: TREASURY_RATE,
    cbRewardRate: CB_REWARD_RATE,
  };
}

/** Apply the stricter of the user-requested risk limits and modeled regulatory floors/caps. */
export function effectiveRiskLimits(
  request: Pick<ProductGenerationRequest, "ldrCeiling" | "lcrFloor">,
): { ldrCeiling: number; lcrFloor: number } {
  return {
    ldrCeiling: Math.min(request.ldrCeiling, REGULATORY.ldrCeiling),
    lcrFloor: Math.max(request.lcrFloor, REGULATORY.lcrFloor),
  };
}

/** Composite objective function using the weights and effective risk limits. */
export function objectiveScore(
  metrics: AlmMetrics,
  request: ProductGenerationRequest,
): { score: number; parts: Record<string, number> } {
  const lambdas = request.lambdas;
  const limits = effectiveRiskLimits(request);
  const ldrExcess = Math.max(0, metrics.meanLdr - Math.min(limits.ldrCeiling, REGULATORY.ldrWarning)) ** 2;
  const irrPart = lambdas.lambda1Irr * clamp(metrics.irrBankAnnual, -1, 2);
  const adoptionPart = lambdas.lambda2Adoption * clamp(metrics.adoptionScore, 0, 1);
  const ldrPart = -lambdas.lambda3LdrPenalty * ldrExcess * 12;
  const overturnPart = -lambdas.lambda4Overturning * clamp(metrics.overturningShock, 0, 1) * 6;
  const drainPart = -0.08 * clamp(metrics.netLiquidityDrainRatio, 0, 5);
  const nimPart = 0.05 * clamp(metrics.nim, -0.5, 0.6);
  const irrShortfall = Math.max(0, request.targetIrr - metrics.irrBankAnnual);
  const roiShortfall = Math.max(0, request.targetRoi - metrics.roi) / Math.max(0.1, request.targetRoi);
  const roeShortfall = Math.max(0, request.targetRoe - metrics.roe) / Math.max(0.05, request.targetRoe);
  const nimShortfall = Math.max(0, request.targetNim - metrics.nim) / Math.max(0.02, request.targetNim);
  const targetPenalty =
    -0.55 * irrShortfall -
    0.10 * clamp(roiShortfall, 0, 5) -
    0.10 * clamp(roeShortfall, 0, 5) -
    0.10 * clamp(nimShortfall, 0, 5);
  const breachPenalty =
    -1.6 * Math.max(0, metrics.p95Ldr - limits.ldrCeiling) * 8 -
    1.4 * Math.max(0, limits.lcrFloor - metrics.p5Lcr) -
    1.2 * Math.max(0, metrics.overturningShock - request.maxOverturningShock) * 6;
  const parts = {
    irrPart,
    adoptionPart,
    ldrPart,
    overturnPart,
    drainPart,
    nimPart,
    targetPenalty,
    breachPenalty,
    ldrExcess,
    irrShortfall,
    roiShortfall,
    roeShortfall,
    nimShortfall,
  };
  return {
    score: irrPart + adoptionPart + ldrPart + overturnPart + drainPart + nimPart + targetPenalty + breachPenalty,
    parts,
  };
}

export function feasibilityCheck(
  product: ProductSpec,
  metrics: AlmMetrics,
  request: ProductGenerationRequest,
): CriticFinding[] {
  const findings: CriticFinding[] = [];
  const limits = effectiveRiskLimits(request);
  if (metrics.p95Ldr > limits.ldrCeiling) {
    findings.push({
      id: "ldr-p95-breach",
      severity: "blocker",
      metric: "p95 LDR",
      observed: metrics.p95Ldr,
      limit: limits.ldrCeiling,
      messageFa: `نسبت خالص تسهیلات به سپرده در صدک ۹۵ برابر ${(metrics.p95Ldr * 100).toFixed(1)}٪ است و از سقف مؤثر ${(limits.ldrCeiling * 100).toFixed(0)}٪ (سخت‌گیرانه‌ترِ درخواست و سقف مدل) عبور کرده است.`,
      messageEn: `p95 net LDR ${(metrics.p95Ldr * 100).toFixed(1)}% exceeds the effective ${limits.ldrCeiling} ceiling (stricter of the request and modeled regulatory cap).`,
      directive: {
        field: "loanMultiplier",
        action: "decrease",
        magnitude: 0.07 * Math.min(4, 1 + (metrics.p95Ldr - limits.ldrCeiling) * 12),
        rationaleFa:
          "کاهش ضریب تسهیلات (α)، افزایش ماندگاری حلقه بسته (γ) و کاهش برداشت آزاد (δ)؛ افزایش مسدودی می‌تواند مخرج سپرده قابل‌استفاده را کوچک و LDR را بدتر کند.",
      },
    });
  }
  if (metrics.p5Lcr < limits.lcrFloor) {
    findings.push({
      id: "lcr-floor-breach",
      severity: "blocker",
      metric: "p5 LCR",
      observed: metrics.p5Lcr,
      limit: limits.lcrFloor,
      messageFa: `نسبت پوشش نقدینگی در صدک ۵ به ${metrics.p5Lcr.toFixed(2)} رسیده و کف مؤثر ${limits.lcrFloor.toFixed(2)} (سخت‌گیرانه‌ترِ درخواست و کف مدل) را نقض کرده است.`,
      messageEn: `p5 LCR ${metrics.p5Lcr.toFixed(2)} breaches the effective ${limits.lcrFloor.toFixed(2)} floor (stricter of the request and modeled regulatory floor).`,
      directive: {
        field: "loanMultiplier",
        action: "decrease",
        magnitude: 0.09,
        rationaleFa:
          "کاهش ضریب تسهیلات (α) و پلکانی‌سازی دوره‌های خواب سپرده برای آزادسازی دارایی با نقدشوندگی بالا.",
      },
    });
  }
  if (metrics.irrBankAnnual < request.targetIrr) {
    findings.push({
      id: "irr-shortfall",
      severity: "blocker",
      metric: "IRR_bank",
      observed: metrics.irrBankAnnual,
      limit: request.targetIrr,
      messageFa: `نرخ بازده داخلی بانک ${(metrics.irrBankAnnual * 100).toFixed(2)}٪ و کمتر از هدف ${(request.targetIrr * 100).toFixed(1)}٪ است.`,
      messageEn: `Bank IRR ${(metrics.irrBankAnnual * 100).toFixed(2)}% below the ${(request.targetIrr * 100).toFixed(1)}% target.`,
      directive: {
        field: "closedLoopRetention",
        action: "increase",
        magnitude: 0.08,
        rationaleFa:
          "افزایش بازگشت منابع در حلقه بسته (γ) و نرخ کارمزد غیرمشاع و استفاده از سررسیدهای شناور برای بهبود درآمد مشاع و غیرمشاع.",
      },
    });
  }
  if (metrics.overturningShock > request.maxOverturningShock) {
    findings.push({
      id: "overturning-risk",
      severity: "blocker",
      metric: "Resource Overturning Shock",
      observed: metrics.overturningShock,
      limit: request.maxOverturningShock,
      messageFa: `شوکه واژگونی منابع ${(metrics.overturningShock * 100).toFixed(2)}٪ و فراتر از آستانه تحمل ریسک ${(request.maxOverturningShock * 100).toFixed(2)}٪ است.`,
      messageEn: `Overturning shock ${(metrics.overturningShock * 100).toFixed(2)}% above tolerance.`,
      directive: {
        field: "sleepMonths",
        action: "stagger",
        magnitude: 2,
        rationaleFa:
          "پلکانی‌سازی (Staggering) دوره‌های خواب سپرده بین طرح‌ها و افزایش سهم مسدودی تا موج‌های بازپرداخت همزمان نشوند.",
      },
    });
  }
  const addTargetWarning = (
    id: string,
    metric: string,
    observed: number,
    limit: number,
    messageFa: string,
    messageEn: string,
  ) => {
    if (observed >= limit) return;
    findings.push({
      id,
      severity: "warning",
      metric,
      observed,
      limit,
      messageFa,
      messageEn,
      directive: {
        field: "*",
        action: "hold",
        magnitude: 0,
        rationaleFa: "این شاخص هدف عملکردی است؛ پیش از هر تعدیل، حساسیت آن با مدل و داده‌های معتبر بررسی شود.",
      },
    });
  };
  addTargetWarning(
    "roi-target-gap",
    "ROI",
    metrics.roi,
    request.targetRoi,
    `بازده تجمعی سرمایه ${(metrics.roi * 100).toFixed(1)}٪ و کمتر از هدف ${(request.targetRoi * 100).toFixed(1)}٪ است.`,
    `ROI ${(metrics.roi * 100).toFixed(1)}% is below the requested ${(request.targetRoi * 100).toFixed(1)}% objective.`,
  );
  addTargetWarning(
    "roe-target-gap",
    "ROE",
    metrics.roe,
    request.targetRoe,
    `بازده سالانه سرمایه ${(metrics.roe * 100).toFixed(1)}٪ و کمتر از هدف ${(request.targetRoe * 100).toFixed(1)}٪ است.`,
    `ROE ${(metrics.roe * 100).toFixed(1)}% is below the requested ${(request.targetRoe * 100).toFixed(1)}% objective.`,
  );
  addTargetWarning(
    "nim-target-gap",
    "NIM",
    metrics.nim,
    request.targetNim,
    `حاشیه سود خالص ${(metrics.nim * 100).toFixed(2)}٪ و کمتر از هدف ${(request.targetNim * 100).toFixed(2)}٪ است.`,
    `NIM ${(metrics.nim * 100).toFixed(2)}% is below the requested ${(request.targetNim * 100).toFixed(2)}% objective.`,
  );

  product.modes.forEach((mode, i) => {
    const rateCeiling = contractRateCeiling(mode.contract);
    if (mode.loanRate > rateCeiling + 1e-9) {
      findings.push({
        id: `contract-rate-cap-${i}`,
        severity: "blocker",
        metric: "Contract rate cap",
        observed: mode.loanRate,
        limit: rateCeiling,
        messageFa: `نرخ قراردادی طرح «${mode.nameFa}» از سقف محافظه‌کارانه ${(rateCeiling * 100).toFixed(1)}٪ عبور کرده است.`,
        messageEn: `Mode ${mode.nameEn} exceeds the conservative ${ (rateCeiling * 100).toFixed(1) }% contract-rate cap.`,
        directive: {
          field: "loanRate",
          action: "decrease",
          magnitude: 0.01,
          rationaleFa: "نرخ را به سقف قراردادی محافظه‌کارانه محدود کنید و مبنای حقوقی را با منبع رسمی تأیید کنید.",
        },
      });
    }
    if (mode.installmentToIncome > REGULATORY.installmentToIncomeCeiling) {
      findings.push({
        id: `affordability-${i}`,
        severity: "blocker",
        metric: "PMT / income",
        observed: mode.installmentToIncome,
        limit: REGULATORY.installmentToIncomeCeiling,
        messageFa: `قسط ماهانه طرح «${mode.nameFa}» ${(mode.installmentToIncome * 100).toFixed(1)}٪ از درآمد خالص پرسونای هدف است (سقف ۴۰٪).`,
        messageEn: `Installment of mode ${mode.nameEn} exceeds 40% of persona income.`,
        directive: {
          field: "tenorMonths",
          action: "increase",
          magnitude: 6,
          rationaleFa: "افزایش سررسید بازپرداخت و کاهش مبلغ هر فقره برای رعایت توان بازپرداخت مشتری.",
        },
      });
    }
    if (mode.npvBankRial < 0) {
      findings.push({
        id: `npv-negative-${i}`,
        severity: "blocker",
        metric: "NPV_bank",
        observed: mode.npvBankRial,
        limit: 0,
        messageFa: `معادل عملیاتی طرح «${mode.nameFa}» منفی است؛ نرخ سود/کارمزد یا ضریب تسهیلات نیاز به اصلاح دارد.`,
        messageEn: `Actuarial equivalence of ${mode.nameEn} is negative.`,
        directive: {
          field: "loanRate",
          action: "increase",
          magnitude: 0.008,
          rationaleFa: "افزایش نرخ تا سقف مصوب شورای پول و اعتبار یا کاهش ضریب تسهیلات.",
        },
      });
    }
  });
  return findings;
}

/** Apply deterministic, directionally correct critic-auditor adjustments. */
export function applyDirectives(
  modes: ModeSpec[],
  findings: CriticFinding[],
): { modes: ModeSpec[]; appliedFa: string[] } {
  const appliedFa: string[] = [];
  const next = modes.map((mode) => ({ ...mode }));
  const has = (id: string) => findings.some((finding) => finding.id === id || finding.id.startsWith(id));
  const magnitude = (id: string) => findings
    .filter((finding) => finding.id === id || finding.id.startsWith(id))
    .reduce((largest, finding) => Math.max(largest, finding.directive.magnitude), 0);

  const ldrBreach = has("ldr-p95-breach");
  const lcrBreach = has("lcr-floor-breach");
  if (ldrBreach || lcrBreach) {
    const alphaReduction = Math.min(
      0.5,
      (ldrBreach ? Math.max(0.1, 0.1 + magnitude("ldr-p95-breach") * 0.7) : 0) +
      (lcrBreach ? Math.max(0.12, 0.12 + magnitude("lcr-floor-breach") * 0.5) : 0),
    );
    next.forEach((mode) => {
      mode.loanMultiplier = clamp(mode.loanMultiplier - alphaReduction, 0.05, 3);
      mode.closedLoopRetention = clamp(
        mode.closedLoopRetention + (ldrBreach ? 0.04 : 0) + (lcrBreach ? 0.05 : 0),
        0,
        0.95,
      );
      mode.waitingMonths = clamp(mode.waitingMonths + 1, 0, 12);
      mode.withdrawalFractionMean = clamp(
        mode.withdrawalFractionMean - (ldrBreach ? 0.025 : 0) - (lcrBreach ? 0.025 : 0),
        0.01,
        0.95,
      );
      // Blocked balances are deducted from usable deposits. Raising beta can
      // therefore worsen LDR even while it reduces runoff; lower it only when
      // the binding issue is LDR, and offset the extra run-off with lower delta.
      if (ldrBreach && !lcrBreach) {
        mode.blockedRatio = clamp(mode.blockedRatio - 0.025, 0, 0.65);
      }
    });
    appliedFa.push(
      "کاهش مستقیم ضریب تسهیلات α، افزایش منابع حلقه‌بسته γ و صف انتظار ω، کاهش برداشت آزاد δ" +
      (ldrBreach && !lcrBreach ? " و آزادسازی بخشی از مانده مسدودی برای تقویت مخرج LDR" : ""),
    );
  }

  if (has("overturning-risk")) {
    const base = Math.round(next[0]?.sleepMonths ?? 4);
    next.forEach((mode, i) => {
      const bp = BLUEPRINTS[mode.archetype];
      mode.sleepMonths = clamp(
        base + i * 2 + (i % 2 === 0 ? 1 : 0),
        bp.sleepMonths[0],
        bp.sleepMonths[1] + 4,
      );
      mode.cohortRampMonths = clamp(mode.cohortRampMonths + 3, 2, 24);
      mode.closedLoopRetention = clamp(mode.closedLoopRetention + 0.04, 0, 0.95);
      mode.withdrawalFractionMean = clamp(mode.withdrawalFractionMean - 0.04, 0.01, 0.95);
      mode.blockRelease = i % 2 === 0 ? "midpoint" : "linear";
    });
    appliedFa.push(
      "پلکانی‌سازی دوره خواب τ_d و رمپ جذب، کاهش برداشت آزاد δ و ارتقای ماندگاری حلقه بسته γ برای مهار واژگونی",
    );
  }

  if (has("irr-shortfall")) {
    // Market-centred starts sit near realistic market margins; when the target
    // IRR is still unmet the correction must move fast enough to reach it
    // within the bounded iteration budget (2%/step toward the contract ceiling).
    const shortfall = magnitude("irr-shortfall");
    const step = clamp(0.012 + shortfall * 0.6, 0.012, 0.03);
    next.forEach((mode) => {
      const bp = BLUEPRINTS[mode.archetype];
      const ceiling = contractRateCeiling(mode.contract);
      mode.loanRate = clamp(mode.loanRate + step, 0, ceiling);
      mode.feeIncomeRate = clamp(mode.feeIncomeRate + step * 0.3, bp.feeIncomeRate[0], bp.feeIncomeRate[1] * 1.35);
      mode.closedLoopRetention = clamp(mode.closedLoopRetention + 0.05, 0, 0.95);
      if (mode.archetype === "investment-deposit") {
        mode.depositRate = clamp(mode.depositRate - 0.006, 0.05, 0.205);
      }
      if (mode.archetype === "retail-qarz-average") {
        // lift the loan multiplier within the blueprint band to deepen joint income
        mode.loanMultiplier = clamp(mode.loanMultiplier * 1.04, bp.loanMultiplier[0], bp.loanMultiplier[1]);
      }
    });
    appliedFa.push(
      "افزایش محسوس نرخ سود/کارمزد تا سقف قراردادی، ارتقای درآمد غیرمشاع و بهبود بازگشت منابع حلقه بسته",
    );
  }

  findings
    .filter((finding) => finding.id.startsWith("affordability"))
    .forEach((finding) => {
      const idx = Number(finding.id.split("-").pop());
      const mode = next[idx];
      if (!mode) return;
      const bp = BLUEPRINTS[mode.archetype];
      mode.tenorMonths = clamp(mode.tenorMonths + 6, bp.tenorMonths[0], 72);
      mode.capToman = clamp(mode.capToman * 0.88, bp.capToman[0] * 0.6, bp.capToman[1]);
      appliedFa.push(
        `تمدید سررسید و کاهش سقف فردی طرح «${mode.nameFa}» برای رعایت نسبت قسط به درآمد ≤ ۴۰٪`,
      );
    });

  findings
    .filter((finding) => finding.id.startsWith("npv-negative"))
    .forEach((finding) => {
      const idx = Number(finding.id.split("-").pop());
      const mode = next[idx];
      if (!mode) return;
      mode.loanRate = clamp(mode.loanRate + 0.008, 0, contractRateCeiling(mode.contract));
      mode.loanMultiplier = clamp(mode.loanMultiplier * 0.94, 0.05, 3);
      appliedFa.push(`بازتنظیم نرخ مجاز و ضریب تسهیلات طرح «${mode.nameFa}» برای رفع NPV منفی`);
    });

  findings
    .filter((finding) => finding.id.startsWith("contract-rate-cap"))
    .forEach((finding) => {
      const idx = Number(finding.id.split("-").pop());
      const mode = next[idx];
      if (!mode) return;
      mode.loanRate = Math.min(mode.loanRate, contractRateCeiling(mode.contract));
      appliedFa.push(`محدودکردن نرخ قراردادی «${mode.nameFa}» به سقف مجاز مدل`);
    });

  if (findings.some((finding) => finding.severity === "blocker") && appliedFa.length === 0) {
    next.forEach((mode) => {
      mode.loanMultiplier = clamp(mode.loanMultiplier * 0.9, 0.05, 3);
      mode.closedLoopRetention = clamp(mode.closedLoopRetention + 0.03, 0, 0.95);
    });
    appliedFa.push("اعمال محافظه‌کاری پشتیبان: کاهش ضریب تسهیلات و افزایش ماندگاری منابع برای بازآزمایی");
  }

  return { modes: next, appliedFa };
}

export function recomputeDerived(
  modes: ModeSpec[],
  persona: PersonaSpec | null,
  gammaFloor = 0,
): ModeSpec[] {
  // Every rebuild re-imposes the τ_d staggering invariant, and the staggered
  // value is handed to buildMode exactly so the derived fields (average
  // balance, entitlement, NPV, affordability) are consistent with it.
  const staggered = enforceStagger(modes);
  const totalDeposits = modes.reduce((a, x) => a + x.depositVolumeRial, 0);
  return staggered.map((m, i) =>
    buildMode(
      BLUEPRINTS[m.archetype],
      m.contract,
      m.weight,
      totalDeposits,
      {
        rrExact: m.statutoryReserve,
        rdExact: m.depositRate,
        pdExact: m.pd,
        lgdExact: m.lgd,
        rlExact: m.loanRate,
        tdExact: m.sleepMonths,
        tlExact: m.tenorMonths,
        omegaExact: m.waitingMonths,
        alphaExact: m.loanMultiplier,
        betaExact: m.blockedRatio,
        gammaExact: m.closedLoopRetention,
        deltaExact: m.withdrawalFractionMean,
        feeExact: m.feeIncomeRate,
        capExact: m.capToman,
        adoptionExact: m.adoptionScore,
      },
      persona,
      i,
      gammaFloor,
      m.blockRelease,
    ),
  );
}

function inverseLerp(range: [number, number], value: number) {
  const span = range[1] - range[0];
  if (span <= 0) return 0.5;
  return clamp((value - range[0]) / span, 0, 1);
}

/**
 * Structural invariant mandated by the CBI overturning-risk directive: deposit
 * sleep periods (τ_d) must be staggered across the modes of a package so the
 * disbursement waves never coincide. Enforced, not merely encouraged — every
 * candidate, every refinement and every critic-directed rebuild passes through
 * this function, which guarantees pairwise-distinct integer sleep months.
 */
export function enforceStagger(modes: ModeSpec[]): ModeSpec[] {
  if (modes.length <= 1) return [...modes];
  const bounds = modes.map((m) => {
    const bp = BLUEPRINTS[m.archetype];
    const lo = Math.max(1, Math.round(bp.sleepMonths[0]));
    const hi = Math.max(Math.round(bp.sleepMonths[1]) + 6, lo + modes.length - 1);
    return { lo, hi };
  });
  const base = Math.max(2, Math.min(...bounds.map((b) => b.lo)));
  const taken = new Set<number>();
  const assigned: number[] = [];
  modes.forEach((_, i) => {
    const { lo, hi } = bounds[i];
    let value = clamp(base + i * 2, lo, hi);
    let guard = 0;
    const budget = hi - lo + modes.length + 2;
    while (taken.has(value) && guard < budget) {
      value = value >= hi ? lo : value + 1;
      guard += 1;
    }
    if (taken.has(value)) value = clamp(base + i, lo, hi);
    taken.add(value);
    assigned.push(value);
  });
  return modes.map((m, i) => ({ ...m, sleepMonths: assigned[i] }));
}

function shuffle<T>(items: T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Facility-category emphasis → engine archetype (rade.ir loan taxonomy). */
const CATEGORY_ARCHETYPE: Record<string, ModeArchetype> = {
  "cat-car": "corporate-float-anchor",
  "cat-housing": "investment-deposit",
  "cat-marriage": "retail-qarz-average",
  "cat-agri": "supply-chain-gam",
  "cat-energy": "supply-chain-gam",
  "cat-retiree": "corporate-float-anchor",
  "cat-student": "scored-deposit-credit",
  "cat-sme": "corporate-float-anchor",
};

function pickArchetypes(
  request: ProductGenerationRequest,
  rng: Rng,
  forced?: ModeArchetype[],
): ModeArchetype[] {
  const pool: ModeArchetype[] = [
    "retail-qarz-average",
    "merchant-pos-accelerator",
    "corporate-float-anchor",
    "investment-deposit",
    "supply-chain-gam",
  ];
  const count = clamp(Math.round(request.modeCount), 1, pool.length);
  const uniqueForced = [...new Set(forced ?? [])].filter((item) => pool.includes(item) || item === "scored-deposit-credit");
  if (uniqueForced.length) {
    const chosen = uniqueForced.slice(0, count);
    const extra = shuffle(pool.filter((item) => !chosen.includes(item)), rng);
    while (chosen.length < count && extra.length) chosen.push(extra.shift()!);
    return chosen;
  }

  // The scored deposit-backed credit family (نیک/نگین/مهربانی pattern) is
  // requested explicitly — an "امتیازی / کارت اعتباری / نگین / مهربانی"
  // prompt reserves its tier deterministically instead of relying on chance.
  const scoredRequested = request.emphases.includes("scored-credit");
  // Facility-category emphases (car/housing/agri/...) bias the anchor tier.
  const categoryPick = request.emphases
    .map((emphasis) => CATEGORY_ARCHETYPE[emphasis])
    .find((archetype): archetype is ModeArchetype => Boolean(archetype));

  if (count === 1) {
    if (scoredRequested) return ["scored-deposit-credit"];
    if (categoryPick) return [categoryPick];
    const contractMatches = request.preferredContracts.length
      ? pool.filter((archetype) => BLUEPRINTS[archetype].contracts.some((contract) =>
          request.preferredContracts.includes(contract),
        ))
      : [];
    const candidates = contractMatches.length ? contractMatches : pool;
    return [candidates[Math.floor(rng() * candidates.length)]];
  }

  // Retail QH and merchant channels are default anchors for a multi-mode
  // average-balance structure; higher requested counts add distinct segments.
  const chosen: ModeArchetype[] = ["retail-qarz-average", "merchant-pos-accelerator"];
  if (categoryPick && !chosen.includes(categoryPick)) {
    chosen[0] = categoryPick;
  }
  if (scoredRequested && !chosen.includes("scored-deposit-credit")) {
    chosen.push("scored-deposit-credit");
  }
  const extras = shuffle(
    pool.filter((item) => !chosen.includes(item)),
    rng,
  );
  while (chosen.length < count && extras.length) chosen.push(extras.shift()!);
  if (scoredRequested && !chosen.includes("scored-deposit-credit")) {
    // replace the lowest-priority extra tier so the scored family always lands
    chosen[chosen.length - 1] = "scored-deposit-credit";
  }
  return chosen;
}

function pickContract(
  bp: ArchetypeBlueprint,
  request: ProductGenerationRequest,
  rng: Rng,
  contractHint?: ContractType | null,
): ContractType {
  // Market-intelligence bias: when the researched analogs of this archetype
  // converge on one contract the market actually uses, prefer it if offered.
  if (contractHint && bp.contracts.includes(contractHint)) {
    const preferred = request.preferredContracts.includes(contractHint);
    if (preferred || Math.floor(rng() * 3) > 0) return contractHint;
  }
  const preferred = bp.contracts.filter((c) => request.preferredContracts.includes(c));
  const list = preferred.length ? preferred : bp.contracts;
  return list[Math.floor(rng() * list.length)];
}

/**
 * Engine-parameter sampling ranges — the blueprint fields each sampler key maps
 * onto. Market priors are expressed in these units through inverseLerp, so a
 * median observed in the market is centred *inside* the feasible design space.
 */
const PRIOR_PARAM_RANGES: Record<
  "rd" | "rl" | "tl" | "omega" | "alpha" | "beta" | "gamma" | "delta",
  (bp: ArchetypeBlueprint) => [number, number]
> = {
  rd: (bp) => bp.depositRate,
  rl: (bp) => bp.loanRate,
  tl: (bp) => bp.tenorMonths,
  omega: (bp) => bp.waitingMonths,
  alpha: (bp) => bp.loanMultiplier,
  beta: (bp) => bp.blockedRatio,
  gamma: (bp) => bp.closedLoopRetention,
  delta: (bp) => bp.withdrawalFraction,
};

/** Half-width (u-space) of the market-centred sampler; 0.5 keeps local exploration. */
const PRIOR_SPREAD_U = 0.5;

/** Sampler-key -> MarketStructuralParams key. */
const PRIOR_MEDIAN_KEY: Record<"rd" | "rl" | "tl" | "omega" | "alpha" | "beta" | "gamma" | "delta", keyof MarketStructuralParams> = {
  rd: "depositRate",
  rl: "loanRate",
  tl: "tenorMonths",
  omega: "waitingMonths",
  alpha: "loanMultiplier",
  beta: "blockedRatio",
  gamma: "closedLoopRetention",
  delta: "withdrawalFraction",
};

/** Stage A/B/C — one candidate structure. */
export function buildCandidate(
  request: ProductGenerationRequest,
  archetypes: ModeArchetype[],
  rng: Rng,
  persona: PersonaSpec | null,
  gammaFloor: number,
  priors?: MarketPriors | null,
): ProductSpec {
  const shares = randomUnitVector(rng, archetypes.length);
  // Contracts are drawn first (with the market hint) so the weight allocation
  // can see each tier's rate capability: a 26% IRR target cannot be carried by
  // a 4%-commission Qarz tier, so when the profitability bar is high the
  // water-filling LP tilts resource share toward margin-capable contracts —
  // exactly how a real product-design unit blends a QH anchor with Morabaha
  // yield tiers in a staggered matrix.
  const contracts = archetypes.map(
    (archetype) =>
      pickContract(BLUEPRINTS[archetype], request, rng, priors?.byArchetype[archetype]?.contractHint),
  );
  const tiltedShares = request.targetIrr >= 0.24
    ? shares.map((share, i) => share * Math.sqrt(contractRateCeiling(contracts[i])))
    : shares;
  const weights = allocateWeights(archetypes, tiltedShares);
  const modes = archetypes.map((archetype, i) => {
    const bp = BLUEPRINTS[archetype];
    const prior = priors?.byArchetype[archetype];
    const params: Record<string, number> = {};
    (
      [
        "rr",
        "rd",
        "rl",
        "td",
        "tl",
        "omega",
        "alpha",
        "beta",
        "gamma",
        "delta",
        "fee",
        "cap",
        "adoption",
        "pd",
        "lgd",
      ] as const
    ).forEach((key) => {
      params[key] = rng();
    });
    if (prior) {
      // Market-grounded sampling: centre each researchable knob on the median
      // observed in the closest real products, jittered for local exploration.
      const median = prior.median;
      (
        ["rd", "rl", "tl", "omega", "alpha", "beta", "gamma", "delta"] as const
      ).forEach((key) => {
        const range = PRIOR_PARAM_RANGES[key](bp);
        const centreU = inverseLerp(range, median[PRIOR_MEDIAN_KEY[key]]);
        params[key] = clamp(centreU + (rng() - 0.5) * PRIOR_SPREAD_U, 0, 1);
      });
    }
    // structural prior: stagger sleep periods across modes from the start
    params.td = clamp(0.2 + i * 0.18 + (rng() - 0.5) * 0.2, 0, 1);
    params.beta = clamp(params.beta * 0.8 + 0.15, 0, 1);
    params.gamma = clamp(params.gamma * 0.75 + 0.25, 0, 1);
    return buildMode(
      bp,
      contracts[i],
      weights[i],
      request.targetDepositsRial,
      params,
      persona,
      i,
      gammaFloor,
    );
  });
  return assembleProduct(
    recomputeDerived(enforceStagger(modes), persona, gammaFloor),
    request.targetDepositsRial,
    `PRD-${Math.floor(rng() * 90000 + 10000)}`,
    request.guild
      ? `بسته چندطرحی زنجیره ارزش ${request.guild}`
      : "بسته چندطرحی میانگین حساب",
    request.guild ? `${request.guild} multi-mode value-chain package` : "Multi-mode average-balance package",
  );
}

/** Coordinate local refinement around the incumbent structure. */
function refine(
  product: ProductSpec,
  request: ProductGenerationRequest,
  rng: Rng,
  persona: PersonaSpec | null,
  gammaFloor = 0,
): ProductSpec {
  const modes = product.modes.map((m) => ({ ...m }));
  modes.forEach((m) => {
    const bp = BLUEPRINTS[m.archetype];
    const shock = () => (rng() - 0.5) * 0.12;
    m.loanMultiplier = clamp(m.loanMultiplier * (1 + shock()), bp.loanMultiplier[0] * 0.8, bp.loanMultiplier[1] * 1.05);
    m.blockedRatio = clamp(m.blockedRatio + shock() * 0.4, bp.blockedRatio[0], 0.55);
    m.closedLoopRetention = clamp(m.closedLoopRetention + shock() * 0.4, 0, 0.95);
    m.waitingMonths = clamp(Math.round(m.waitingMonths + (rng() - 0.4)), bp.waitingMonths[0], 8);
    m.sleepMonths = clamp(Math.round(m.sleepMonths + (rng() - 0.5) * 2), bp.sleepMonths[0], bp.sleepMonths[1] + 4);
    m.tenorMonths = clamp(Math.round(m.tenorMonths + (rng() - 0.5) * 6), bp.tenorMonths[0], 72);
    m.feeIncomeRate = clamp(m.feeIncomeRate * (1 + shock() * 0.5), bp.feeIncomeRate[0], bp.feeIncomeRate[1] * 1.4);
  });
  // keep sum(w) = 1 -> sum(D) = D_target
  const total = modes.reduce((a, m) => a + m.depositVolumeRial, 0) || 1;
  modes.forEach((m) => {
    m.weight = m.depositVolumeRial / total;
  });
  // re-impose the τ_d staggering invariant after the perturbation
  enforceStagger(modes).forEach((m, i) => {
    modes[i].sleepMonths = m.sleepMonths;
  });
  return assembleProduct(
    recomputeDerived(enforceStagger(modes), persona, gammaFloor),
    request.targetDepositsRial,
    product.code,
    product.titleFa,
    product.titleEn,
  );
}

/** Yields to the event loop so progress can be streamed over SSE. */
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const error = new Error("Optimization cancelled by the caller");
    error.name = "AbortError";
    throw error;
  }
}

/** The full hybrid inverse solve with the critic self-correction loop. */
export async function optimizeProduct(
  request: ProductGenerationRequest,
  options: SolveOptions = {},
): Promise<SolveResult> {
  const started = Date.now();
  const seedValue =
    typeof options.seed === "string"
      ? seedFromString(options.seed + request.prompt)
      : options.seed ?? seedFromString(request.prompt || "default-seed");
  const rng = createRng(seedValue);
  const candidateCount = clamp(Math.round(options.candidates ?? 42), 1, MAX_OPTIMIZER_CANDIDATES);
  const horizon = clamp(Math.round(options.horizonMonths ?? ALM_HORIZON_MONTHS), 6, 120);
  const requestedRuns = options.runs ?? MC_RUNS;
  if (!Number.isSafeInteger(requestedRuns) || requestedRuns < 1 || requestedRuns > MAX_MONTE_CARLO_RUNS) {
    throw new RangeError(`Optimizer runs must be an integer between 1 and ${MAX_MONTE_CARLO_RUNS}; received ${requestedRuns}`);
  }
  const maxIterations = clamp(
    Math.round(options.maxIterations ?? REGULATORY.maxCriticIterations),
    1,
    REGULATORY.maxCriticIterations,
  );
  const persona = options.persona ?? null;
  const gammaFloor = options.gammaFloor ?? 0;
  const priors = options.priors ?? null;
  const riskLimits = effectiveRiskLimits(request);

  options.onProgress?.({
    stage: "optimizer:start",
    messageFa: `آغاز حل معکوس MILP/MINLP با ${candidateCount} کاندید ساختاری و افق ${horizon} ماهه${priors ? ` — نمونه‌گیری متمرکز روی میانه‌های ${Object.keys(priors.byArchetype).length} الگوی واقعی بازار` : ""}`,
    messageEn: `Inverse MILP/MINLP solve with ${candidateCount} structural candidates over ${horizon} months${priors ? ` — market-centred sampling on ${Object.keys(priors.byArchetype).length} archetype prior(s)` : ""}`,
  });

  // ---- Stage A/B/C screening -------------------------------------------------
  const screened: { product: ProductSpec; score: number; metrics: AlmMetrics }[] = [];
  for (let c = 0; c < candidateCount; c += 1) {
    throwIfAborted(options.signal);
    const archetypes =
      c < 6
        ? pickArchetypes(request, createRng(seedValue + c * 977), options.forcedArchetypes)
        : pickArchetypes(request, createRng(seedValue + c * 31), options.forcedArchetypes);
    const candidate = buildCandidate(
      request,
      archetypes,
      createRng(seedValue + c * 7919),
      persona,
      gammaFloor,
      priors,
    );
    const metrics = evaluateProduct(candidate, seedValue + c, horizon, riskLimits);
    const { score } = objectiveScore(metrics, request);
    screened.push({ product: candidate, score, metrics });
    if (c % 4 === 0) {
      await tick();
      throwIfAborted(options.signal);
    }
    if (c % 12 === 0) {
      options.onProgress?.({
        stage: "optimizer:screen",
        messageFa: `غربالگری کاندید ${c + 1} از ${candidateCount} — بهترین امتیاز تاکنون ${screened.reduce((a, b) => Math.max(a, b.score), -9).toFixed(3)}`,
        messageEn: `Screened ${c + 1}/${candidateCount} candidates — best score so far ${screened.reduce((a, b) => Math.max(a, b.score), -9).toFixed(3)}`,
      });
    }
  }
  screened.sort((a, b) => b.score - a.score);
  let incumbent = screened[0];

  // ---- Stage D critic loop ---------------------------------------------------
  const iterations: OptimizerIteration[] = [];
  let current = incumbent;
  for (let it = 1; it <= maxIterations; it += 1) {
    throwIfAborted(options.signal);
    const refined =
      it === 1 ? current.product : refine(current.product, request, rng, persona, gammaFloor);
    const applied =
      it === 1
        ? { modes: refined.modes, appliedFa: ["انتخاب بهترین کاندید غربالگری‌شده به‌عنوان نقطه شروع"] }
        : { modes: refined.modes, appliedFa: ["بازجست‌وجوی مختصاتی محلی حول ساختار فعلی"] };

    const alm = runAlmSimulation({
      product: refined,
      runs: requestedRuns,
      seed: seedValue + it * 104729,
      horizonMonths: horizon,
      limits: riskLimits,
      signal: options.signal,
    });
    const { score } = objectiveScore(alm.metrics, request);
    const findings = feasibilityCheck(refined, alm.metrics, request);
    const feasible = findings.filter((f) => f.severity === "blocker").length === 0;

    const directiveResult = applyDirectives(refined.modes, findings);
    iterations.push({
      iteration: it,
      score,
      irrAnnual: alm.metrics.irrBankAnnual,
      p95Ldr: alm.metrics.p95Ldr,
      p5Lcr: alm.metrics.p5Lcr,
      overturningShock: alm.metrics.overturningShock,
      netDrainRatio: alm.metrics.netLiquidityDrainRatio,
      feasible,
      findings,
      directivesAppliedFa: applied.appliedFa,
    });

    options.onProgress?.({
      stage: feasible ? "optimizer:feasible" : "optimizer:iterate",
      messageFa: `گام خوداصلاحی ${it}: IRR=${(alm.metrics.irrBankAnnual * 100).toFixed(2)}٪ | p95 LDR=${(alm.metrics.p95Ldr * 100).toFixed(1)}٪ | p5 LCR=${alm.metrics.p5Lcr.toFixed(2)} | واژگونی=${(alm.metrics.overturningShock * 100).toFixed(2)}٪`,
      messageEn: `Self-correction ${it}: IRR=${(alm.metrics.irrBankAnnual * 100).toFixed(2)}% | p95 LDR=${(alm.metrics.p95Ldr * 100).toFixed(1)}% | p5 LCR=${alm.metrics.p5Lcr.toFixed(2)} | overturning=${(alm.metrics.overturningShock * 100).toFixed(2)}%`,
      detail: { findings: findings.length, score },
    });

    if (score >= current.score) {
      current = { product: refined, score, metrics: alm.metrics };
    }
    if (feasible) {
      return {
        product: refined,
        alm,
        metrics: alm.metrics,
        score,
        feasible: true,
        iterations,
        candidatesScreened: candidateCount,
        elapsedMs: Date.now() - started,
      };
    }
    // apply directives for the next iteration
    const directed = assembleProduct(
      recomputeDerived(directiveResult.modes, persona, gammaFloor),
      request.targetDepositsRial,
      refined.code,
      refined.titleFa,
      refined.titleEn,
    );
    const directedMetrics = evaluateProduct(directed, seedValue + it, horizon, riskLimits);
    const directedScore = objectiveScore(directedMetrics, request).score;
    if (directedScore >= current.score) {
      current = { product: directed, score: directedScore, metrics: directedMetrics };
    }
  }

  throwIfAborted(options.signal);
  const finalAlm = runAlmSimulation({
    product: current.product,
    runs: requestedRuns,
    seed: seedValue + 99,
    horizonMonths: horizon,
    limits: riskLimits,
    signal: options.signal,
  });
  const findings = feasibilityCheck(current.product, finalAlm.metrics, request);
  return {
    product: current.product,
    alm: finalAlm,
    metrics: finalAlm.metrics,
    score: objectiveScore(finalAlm.metrics, request).score,
    feasible: findings.filter((f) => f.severity === "blocker").length === 0,
    iterations,
    candidatesScreened: candidateCount,
    elapsedMs: Date.now() - started,
  };
}

/** One-shot sensitivity sweep used by the interactive dashboard. */
export function sensitivitySweep(
  product: ProductSpec,
  request: ProductGenerationRequest,
  seed: number | string = "sensitivity",
): {
  key: string;
  label: string;
  deltas: number[];
  irr: number[];
  ldr: number[];
  lcr: number[];
  overturning: number[];
  adoption: number[];
}[] {
  const dims: {
    key: string;
    label: string;
    deltas: number[];
    apply: (m: ModeSpec, d: number) => ModeSpec;
  }[] = [
    {
      key: "gamma",
      label: "γ — ماندگاری حلقه بسته",
      deltas: [-0.15, -0.08, 0, 0.08, 0.15],
      apply: (m, d) => ({ ...m, closedLoopRetention: clamp(m.closedLoopRetention + d, 0, 0.97) }),
    },
    {
      key: "beta",
      label: "β — مسدودی هوشمند",
      deltas: [-0.1, -0.05, 0, 0.05, 0.12],
      apply: (m, d) => ({ ...m, blockedRatio: clamp(m.blockedRatio + d, 0, 0.6) }),
    },
    {
      key: "alpha",
      label: "α — ضریب تسهیلات",
      deltas: [-0.2, -0.1, 0, 0.1, 0.25],
      apply: (m, d) => ({ ...m, loanMultiplier: clamp(m.loanMultiplier * (1 + d), 0.2, 3) }),
    },
    {
      key: "tau_d",
      label: "τ_d — دوره خواب سپرده",
      deltas: [-3, -1, 0, 2, 4],
      apply: (m, d) => ({ ...m, sleepMonths: clamp(m.sleepMonths + d, 1, 24) }),
    },
    {
      key: "omega",
      label: "ω — صف انتظار",
      deltas: [-1, 0, 1, 2, 4],
      apply: (m, d) => ({ ...m, waitingMonths: clamp(m.waitingMonths + d, 0, 12) }),
    },
    {
      key: "delta",
      label: "δ — برداشت آزاد",
      deltas: [-0.1, -0.05, 0, 0.08, 0.18],
      apply: (m, d) => ({
        ...m,
        withdrawalFractionMean: clamp(m.withdrawalFractionMean + d, 0.02, 0.9),
      }),
    },
  ];

  const seedValue = typeof seed === "string" ? seedFromString(seed) : seed;
  const riskLimits = effectiveRiskLimits(request);
  return dims.map((dim) => {
    const irr: number[] = [];
    const ldr: number[] = [];
    const lcr: number[] = [];
    const overturning: number[] = [];
    const adoption: number[] = [];
    dim.deltas.forEach((d) => {
      const persona = PERSONAS.find((item) => item.key === request.personaKey) ?? null;
      const modes = recomputeDerived(
        product.modes.map((m) => dim.apply(m, d)),
        persona,
        0,
      );
      const variant = assembleProduct(
        modes,
        product.targetDepositsRial,
        product.code,
        product.titleFa,
        product.titleEn,
      );
      const metrics = runAlmSimulation({
        product: variant,
        runs: 40,
        seed: seedValue + Math.round(d * 100),
        horizonMonths: request.horizonMonths,
        limits: riskLimits,
      }).metrics;
      irr.push(metrics.irrBankAnnual);
      ldr.push(metrics.p95Ldr);
      lcr.push(metrics.p5Lcr);
      overturning.push(metrics.overturningShock);
      adoption.push(metrics.adoptionScore);
    });
    return {
      key: dim.key,
      label: dim.label,
      deltas: dim.deltas,
      irr,
      ldr,
      lcr,
      overturning,
      adoption,
    };
  });
}

export { BILLION_TOMAN_RIAL, MC_SCREEN_RUNS };
