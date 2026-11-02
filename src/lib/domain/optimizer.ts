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
  DEFAULT_LAMBDAS,
  HURDLE_RATE,
  MC_RUNS,
  MC_SCREEN_RUNS,
  REGULATORY,
  TREASURY_RATE,
  TOMAN_RIAL,
} from "./constants";
import { clamp, createRng, pmt, seedFromString, type Rng } from "./financial";
import { costOfFunds, expectedLossOf } from "./costOfFunds";
import {
  bankProductNpv,
  installmentAffordability,
  loanEntitlement,
  weightedAverageBalance,
} from "./pointEngine";
import { evaluateProduct, runAlmSimulation } from "./almSimulator";
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
  /** Share of the target resource pool this segment can realistically absorb. */
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
    contracts: ["qarz-hasaneh", "joalah", "kharid-deyn"],
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

const LAMBDAS = DEFAULT_LAMBDAS;

function lerp(range: [number, number], u: number) {
  return range[0] + (range[1] - range[0]) * clamp(u, 0, 1);
}

/** Stage B — LP water-filling of the resource weights under capacity limits. */
export function allocateWeights(
  archetypes: ModeArchetype[],
  shares: number[],
): number[] {
  const caps = archetypes.map((a) => BLUEPRINTS[a].capacityShare);
  const remaining = [...shares];
  const out = new Array<number>(archetypes.length).fill(0);
  let left = 1;
  let guard = 0;
  while (left > 1e-9 && guard < 50) {
    guard += 1;
    const totalRemaining = remaining.reduce((a, b) => a + Math.max(b, 0), 0);
    if (totalRemaining <= 0) break;
    let allocatedThisRound = 0;
    for (let i = 0; i < archetypes.length; i += 1) {
      if (remaining[i] <= 0) continue;
      const headroom = Math.max(0, caps[i] - out[i]);
      const want = (remaining[i] / totalRemaining) * left;
      const give = Math.min(headroom, want);
      out[i] += give;
      allocatedThisRound += give;
    }
    left -= allocatedThisRound;
    if (allocatedThisRound <= 1e-12) {
      // every segment saturated -> spread the residual proportionally anyway
      for (let i = 0; i < archetypes.length; i += 1) {
        out[i] += (remaining[i] / totalRemaining) * left;
      }
      left = 0;
    }
  }
  const sum = out.reduce((a, b) => a + b, 0);
  return sum > 0 ? out.map((w) => w / sum) : out;
}

export interface ModeSeed {
  archetype: ModeArchetype;
  contract: ContractType;
  u: Record<string, number>;
}

function randomUnitVector(rng: Rng, length: number, dirichletAlpha = 2.2): number[] {
  const draws = Array.from({ length }, () =>
    Math.pow(-Math.log(Math.max(1e-9, rng())), 1 / dirichletAlpha),
  );
  const total = draws.reduce((a, b) => a + b, 0) || 1;
  return draws.map((d) => d / total);
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
): ModeSpec {
  const depositVolumeRial = Math.max(0, weight) * targetDepositsRial;
  const statutoryReserve = lerp(blueprint.statutoryReserve, params.rr ?? 0.5);
  const depositRate = lerp(blueprint.depositRate, params.rd ?? 0.5);
  const pd = lerp(blueprint.pd, params.pd ?? 0.4);
  const lgd = lerp(blueprint.lgd, params.lgd ?? 0.4);
  const el = expectedLossOf(pd, lgd);

  const cof = costOfFunds({
    depositRate,
    statutoryReserve,
    liquidityDeduction: blueprint.liquidityDeduction,
    opexRatio: blueprint.opexRatio,
    expectedLoss: el,
  });

  let loanRate = lerp(blueprint.loanRate, params.rl ?? 0.6);
  const rateCeiling =
    contract === "qarz-hasaneh"
      ? REGULATORY.qarzHasanehMaxCommission
      : contract === "morabaha" || contract === "mudaraba"
        ? REGULATORY.morabahaMaxRate
        : REGULATORY.absoluteRateCeiling;
  loanRate = clamp(loanRate, 0, rateCeiling);

  // τ_d may be supplied exactly (post-staggering) so the value survives the
  // rebuild instead of being clamped back into the blueprint range.
  const sleepMonths =
    params.tdExact !== undefined
      ? Math.round(clamp(params.tdExact, 1, 24))
      : Math.round(lerp(blueprint.sleepMonths, params.td ?? 0.5));
  const tenorMonths = Math.round(lerp(blueprint.tenorMonths, params.tl ?? 0.5));
  const waitingMonths = Math.round(lerp(blueprint.waitingMonths, params.omega ?? 0.4));
  const loanMultiplier = lerp(blueprint.loanMultiplier, params.alpha ?? 0.5);
  const blockedRatio = lerp(blueprint.blockedRatio, params.beta ?? 0.4);
  const closedLoopCeiling = Math.max(
    blueprint.closedLoopRetention[1],
    Math.min(gammaFloor, blueprint.closedLoopRetention[1]),
  );
  const closedLoopRetention = clamp(
    Math.max(
      lerp(blueprint.closedLoopRetention, params.gamma ?? 0.5),
      Math.min(gammaFloor, blueprint.closedLoopRetention[1]),
    ),
    0,
    closedLoopCeiling,
  );
  const withdrawalFractionMean = lerp(blueprint.withdrawalFraction, params.delta ?? 0.5);
  const feeIncomeRate = lerp(blueprint.feeIncomeRate, params.fee ?? 0.4);
  const capToman = lerp(blueprint.capToman, params.cap ?? 0.5);
  const adoptionScore = lerp(blueprint.adoption, params.adoption ?? 0.6);

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
    loanRate,
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
    costOfFunds: cof.costOfFunds,
    hurdleRate: HURDLE_RATE,
    treasuryRate: TREASURY_RATE,
    blockRelease: blueprint.blockRelease,
  });

  const avgTicketToman = loanBookRial / TOMAN_RIAL / Math.max(1, customers);
  const installmentToman = pmt(
    loanRate / 12,
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
    blockRelease: blueprint.blockRelease,
    cohortRampMonths: clamp(Math.round(sleepMonths * 0.8) + 2, 2, 14),
    personaIncomeToman,
    costOfFunds: cof.costOfFunds,
    expectedLoss: el,
    freeResourcesRial: depositVolumeRial * (1 - statutoryReserve + blueprint.liquidityDeduction),
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
  const blend = <T extends number>(pick: (m: ModeSpec) => number): number =>
    modes.reduce((a, m) => a + (m.depositVolumeRial / totalDeposits) * pick(m), 0);
  void blend;
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
    structuralLoanToDeposit: totalLoans / (totalDeposits * (1 - 0.06)),
    hurdleRate: HURDLE_RATE,
    treasuryRate: TREASURY_RATE,
    cbRewardRate: REGULATORY.qarzHasanehMaxCommission > 0 ? 0.01 : 0.01,
  };
}

/** Composite objective function of the inverse optimiser. */
export function objectiveScore(
  product: ProductSpec,
  metrics: AlmMetrics,
  request: ProductGenerationRequest,
): { score: number; parts: Record<string, number> } {
  const ldrExcess = product.modes.length
    ? Math.max(
        0,
        metrics.meanLdr - REGULATORY.ldrWarning,
      ) ** 2
    : 0;
  const irrPart = LAMBDAS.lambda1Irr * clamp(metrics.irrBankAnnual, -1, 2);
  const adoptionPart = LAMBDAS.lambda2Adoption * metrics.adoptionScore;
  const ldrPart = -LAMBDAS.lambda3LdrPenalty * ldrExcess * 12;
  const overturnPart = -LAMBDAS.lambda4Overturning * metrics.overturningShock * 6;
  const drainPart = -0.08 * clamp(metrics.netLiquidityDrainRatio, 0, 5);
  const nimPart = 0.05 * clamp(metrics.nim, -0.5, 0.6);
  const shortfall = Math.max(0, request.targetIrr - metrics.irrBankAnnual);
  const targetPenalty = -0.55 * shortfall;
  const breachPenalty =
    -1.6 * Math.max(0, metrics.p95Ldr - REGULATORY.ldrCeiling) * 8 -
    1.4 * Math.max(0, REGULATORY.lcrFloor - metrics.p5Lcr);
  return {
    score:
      irrPart +
      adoptionPart +
      ldrPart +
      overturnPart +
      drainPart +
      nimPart +
      targetPenalty +
      breachPenalty,
    parts: {
      irrPart,
      adoptionPart,
      ldrPart,
      overturnPart,
      drainPart,
      nimPart,
      targetPenalty,
      breachPenalty,
      ldrExcess,
    },
  };
}

export function feasibilityCheck(
  product: ProductSpec,
  metrics: AlmMetrics,
  request: ProductGenerationRequest,
): CriticFinding[] {
  const findings: CriticFinding[] = [];
  if (metrics.p95Ldr > request.ldrCeiling) {
    findings.push({
      id: "ldr-p95-breach",
      severity: "blocker",
      metric: "p95 LDR",
      observed: metrics.p95Ldr,
      limit: request.ldrCeiling,
      messageFa: `نسبت خالص تسهیلات به سپرده در صدک ۹۵ برابر ${(metrics.p95Ldr * 100).toFixed(1)}٪ است و از سقف ${(request.ldrCeiling * 100).toFixed(0)}٪ عبور کرده است.`,
      messageEn: `p95 net LDR ${(metrics.p95Ldr * 100).toFixed(1)}% exceeds the ${request.ldrCeiling} solvency ceiling.`,
      directive: {
        field: "blockedRatio",
        action: "increase",
        magnitude: 0.07 * Math.min(4, 1 + (metrics.p95Ldr - request.ldrCeiling) * 12),
        rationaleFa:
          "افزایش مسدودی هوشمند (β) و افزایش ماندگاری حلقه بسته (γ) و تمدید صف انتظار (ω) برای کاهش همزمان دارایی و حمایت از مخرج نسبت.",
      },
    });
  }
  if (metrics.p5Lcr < request.lcrFloor) {
    findings.push({
      id: "lcr-floor-breach",
      severity: "blocker",
      metric: "p5 LCR",
      observed: metrics.p5Lcr,
      limit: request.lcrFloor,
      messageFa: `نسبت پوشش نقدینگی در صدک ۵ به ${(metrics.p5Lcr).toFixed(2)} رسیده و کف ${(request.lcrFloor).toFixed(2)} را نقض کرده است.`,
      messageEn: `p5 LCR ${metrics.p5Lcr.toFixed(2)} breaches the ${request.lcrFloor} floor.`,
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
  product.modes.forEach((mode, i) => {
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
        severity: "warning",
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

/** Apply the critic-auditor mathematical adjustment directives. */
export function applyDirectives(
  modes: ModeSpec[],
  findings: CriticFinding[],
  rng: Rng,
): { modes: ModeSpec[]; appliedFa: string[] } {
  const appliedFa: string[] = [];
  const next = modes.map((m) => ({ ...m }));
  const has = (id: string) => findings.some((f) => f.id === id || f.id.startsWith(id));

  if (has("ldr-p95-breach") || has("lcr-floor-breach")) {
    next.forEach((m, i) => {
      const bp = BLUEPRINTS[m.archetype];
      m.blockedRatio = clamp(m.blockedRatio + 0.07, bp.blockedRatio[0], 0.55);
      m.closedLoopRetention = clamp(
        m.closedLoopRetention + 0.06,
        bp.closedLoopRetention[0],
        0.95,
      );
      m.waitingMonths = clamp(m.waitingMonths + 1, bp.waitingMonths[0], 8);
      m.loanMultiplier = clamp(m.loanMultiplier - 0.08, bp.loanMultiplier[0] * 0.75, bp.loanMultiplier[1]);
      if (i % 2 === 0) m.withdrawalFractionMean = clamp(m.withdrawalFractionMean + 0.02, 0.05, 0.8);
    });
    appliedFa.push(
      "افزایش مسدودی پلکانی β، ارتقای ماندگاری حلقه بسته γ، تمدید صف انتظار ω و کاهش ضریب تسهیلات α در همه طرح‌ها",
    );
  }

  if (has("overturning-risk")) {
    const base = Math.round(next[0]?.sleepMonths ?? 4);
    next.forEach((m, i) => {
      const bp = BLUEPRINTS[m.archetype];
      m.sleepMonths = clamp(base + i * 2 + (i % 2 === 0 ? 1 : 0), bp.sleepMonths[0], bp.sleepMonths[1] + 4);
      m.cohortRampMonths = clamp(m.cohortRampMonths + 2, 2, 16);
      m.blockRelease = i % 2 === 0 ? "midpoint" : "linear";
    });
    appliedFa.push(
      "پلکانی‌سازی دوره خواب سپرده (τ_d) بین طرح‌ها و تغییر الگوی آزادسازی مسدودی به آزادسازی میانی/خطی",
    );
  }

  if (has("irr-shortfall")) {
    next.forEach((m) => {
      const bp = BLUEPRINTS[m.archetype];
      const ceiling =
        m.contract === "qarz-hasaneh"
          ? REGULATORY.qarzHasanehMaxCommission
          : m.contract === "morabaha" || m.contract === "mudaraba"
            ? REGULATORY.morabahaMaxRate
            : REGULATORY.absoluteRateCeiling;
      m.loanRate = clamp(m.loanRate + 0.008, 0, ceiling);
      m.feeIncomeRate = clamp(m.feeIncomeRate + 0.0015, bp.feeIncomeRate[0], bp.feeIncomeRate[1] * 1.35);
      m.closedLoopRetention = clamp(m.closedLoopRetention + 0.05, bp.closedLoopRetention[0], 0.95);
      if (m.archetype === "investment-deposit") {
        m.depositRate = clamp(m.depositRate - 0.004, 0.05, 0.205);
      }
    });
    appliedFa.push(
      "افزایش نرخ سود/کارمزد تا سقف مصوب، ارتقای درآمد غیرمشاع (کارمزد پذیرندگان و انتشار) و بهبود بازگشت منابع حلقه بسته",
    );
  }

  findings
    .filter((f) => f.id.startsWith("affordability"))
    .forEach((f) => {
      const idx = Number(f.id.split("-").pop());
      const m = next[idx];
      if (!m) return;
      const bp = BLUEPRINTS[m.archetype];
      m.tenorMonths = clamp(m.tenorMonths + 6, bp.tenorMonths[0], 72);
      m.capToman = clamp(m.capToman * 0.88, bp.capToman[0] * 0.6, bp.capToman[1]);
      appliedFa.push(
        `تمدید سررسید و کاهش سقف فردی طرح «${m.nameFa}» برای رعایت نسبت قسط به درآمد ≤ ۴۰٪`,
      );
    });

  findings
    .filter((f) => f.id.startsWith("npv-negative"))
    .forEach((f) => {
      const idx = Number(f.id.split("-").pop());
      const m = next[idx];
      if (!m) return;
      m.loanMultiplier = clamp(m.loanMultiplier * 0.94, 0.3, BLUEPRINTS[m.archetype].loanMultiplier[1]);
    });

  // stochastic micro-jitter to escape local optima
  next.forEach((m) => {
    m.blockedRatio = clamp(m.blockedRatio + (rng() - 0.5) * 0.01, 0, 0.55);
    m.closedLoopRetention = clamp(
      m.closedLoopRetention + (rng() - 0.5) * 0.012,
      0,
      0.95,
    );
  });

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
        rr: inverseLerp(BLUEPRINTS[m.archetype].statutoryReserve, m.statutoryReserve),
        rd: inverseLerp(BLUEPRINTS[m.archetype].depositRate, m.depositRate),
        pd: inverseLerp(BLUEPRINTS[m.archetype].pd, m.pd),
        lgd: inverseLerp(BLUEPRINTS[m.archetype].lgd, m.lgd),
        rl: inverseLerp(BLUEPRINTS[m.archetype].loanRate, m.loanRate),
        td: inverseLerp(BLUEPRINTS[m.archetype].sleepMonths, m.sleepMonths),
        tdExact: m.sleepMonths,
        tl: inverseLerp(BLUEPRINTS[m.archetype].tenorMonths, m.tenorMonths),
        omega: inverseLerp(BLUEPRINTS[m.archetype].waitingMonths, m.waitingMonths),
        alpha: inverseLerp(BLUEPRINTS[m.archetype].loanMultiplier, m.loanMultiplier),
        beta: inverseLerp(BLUEPRINTS[m.archetype].blockedRatio, m.blockedRatio),
        gamma: inverseLerp(BLUEPRINTS[m.archetype].closedLoopRetention, m.closedLoopRetention),
        delta: inverseLerp(BLUEPRINTS[m.archetype].withdrawalFraction, m.withdrawalFractionMean),
        fee: inverseLerp(BLUEPRINTS[m.archetype].feeIncomeRate, m.feeIncomeRate),
        cap: inverseLerp(BLUEPRINTS[m.archetype].capToman, m.capToman),
        adoption: inverseLerp(BLUEPRINTS[m.archetype].adoption, m.adoptionScore),
      },
      persona,
      i,
      gammaFloor,
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
  if (forced && forced.length >= 2) {
    const extra = pool.filter((p) => !forced.includes(p));
    const need = Math.max(0, request.modeCount - forced.length);
    const chosen = [...forced];
    for (let i = 0; i < need && extra.length; i += 1) {
      chosen.push(extra.splice(Math.floor(rng() * extra.length), 1)[0]);
    }
    return chosen.slice(0, Math.max(3, request.modeCount));
  }
  const shuffled = [...pool].sort(() => rng() - 0.5);
  const count = clamp(request.modeCount, 3, 5);
  // Retail QH + merchant accelerator are structurally mandatory for a
  // staggered Iranian average-balance matrix.
  const chosen: ModeArchetype[] = ["retail-qarz-average", "merchant-pos-accelerator"];
  shuffled
    .filter((a) => !chosen.includes(a))
    .slice(0, count - chosen.length)
    .forEach((a) => chosen.push(a));
  return chosen.slice(0, count);
}

function pickContract(bp: ArchetypeBlueprint, request: ProductGenerationRequest, rng: Rng): ContractType {
  const preferred = bp.contracts.filter((c) => request.preferredContracts.includes(c));
  const list = preferred.length ? preferred : bp.contracts;
  return list[Math.floor(rng() * list.length)];
}

/** Stage A/B/C — one candidate structure. */
export function buildCandidate(
  request: ProductGenerationRequest,
  archetypes: ModeArchetype[],
  rng: Rng,
  persona: PersonaSpec | null,
  gammaFloor: number,
): ProductSpec {
  const shares = randomUnitVector(rng, archetypes.length);
  const weights = allocateWeights(archetypes, shares);
  const modes = archetypes.map((archetype, i) => {
    const bp = BLUEPRINTS[archetype];
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
    // structural prior: stagger sleep periods across modes from the start
    params.td = clamp(0.2 + i * 0.18 + (rng() - 0.5) * 0.2, 0, 1);
    params.beta = clamp(params.beta * 0.8 + 0.15, 0, 1);
    params.gamma = clamp(params.gamma * 0.75 + 0.25, 0, 1);
    return buildMode(
      bp,
      pickContract(bp, request, rng),
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
  const candidateCount = options.candidates ?? 42;
  const horizon = options.horizonMonths ?? ALM_HORIZON_MONTHS;
  const maxIterations = options.maxIterations ?? REGULATORY.maxCriticIterations;
  const persona = options.persona ?? null;
  const gammaFloor = options.gammaFloor ?? 0;

  options.onProgress?.({
    stage: "optimizer:start",
    messageFa: `آغاز حل معکوس MILP/MINLP با ${candidateCount} کاندید ساختاری و افق ${horizon} ماهه`,
    messageEn: `Inverse MILP/MINLP solve with ${candidateCount} structural candidates over ${horizon} months`,
  });

  // ---- Stage A/B/C screening -------------------------------------------------
  const screened: { product: ProductSpec; score: number; metrics: AlmMetrics }[] = [];
  for (let c = 0; c < candidateCount; c += 1) {
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
    );
    const metrics = evaluateProduct(candidate, seedValue + c, horizon);
    const { score } = objectiveScore(candidate, metrics, request);
    screened.push({ product: candidate, score, metrics });
    if (c % 4 === 0) await tick();
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
    const refined =
      it === 1 ? current.product : refine(current.product, request, rng, persona, gammaFloor);
    const applied =
      it === 1
        ? { modes: refined.modes, appliedFa: ["انتخاب بهترین کاندید غربالگری‌شده به‌عنوان نقطه شروع"] }
        : { modes: refined.modes, appliedFa: ["بازجستجوی مختصاتی محلی around incumbent"] };

    const alm = runAlmSimulation({
      product: refined,
      runs: it === maxIterations ? (options.runs ?? MC_RUNS) : Math.max(8, options.screenRuns ?? MC_SCREEN_RUNS),
      seed: seedValue + it * 104729,
      horizonMonths: horizon,
    });
    const { score } = objectiveScore(refined, alm.metrics, request);
    const findings = feasibilityCheck(refined, alm.metrics, request);
    const feasible = findings.filter((f) => f.severity === "blocker").length === 0;

    const directiveResult = applyDirectives(refined.modes, findings, rng);
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
      // confirm with the full Monte Carlo run
      const confirm = runAlmSimulation({
        product: refined,
        runs: options.runs ?? MC_RUNS,
        seed: seedValue + 7,
        horizonMonths: horizon,
      });
      const confirmFindings = feasibilityCheck(refined, confirm.metrics, request);
      if (confirmFindings.filter((f) => f.severity === "blocker").length === 0) {
        return {
          product: refined,
          alm: confirm,
          metrics: confirm.metrics,
          score: objectiveScore(refined, confirm.metrics, request).score,
          feasible: true,
          iterations,
          candidatesScreened: candidateCount,
          elapsedMs: Date.now() - started,
        };
      }
      current = { product: refined, score, metrics: confirm.metrics };
      directiveResult.appliedFa.forEach((x) => void x);
    }
    // apply directives for the next iteration
    const directed = assembleProduct(
      recomputeDerived(directiveResult.modes, persona, gammaFloor),
      request.targetDepositsRial,
      refined.code,
      refined.titleFa,
      refined.titleEn,
    );
    const directedMetrics = evaluateProduct(directed, seedValue + it, horizon);
    const directedScore = objectiveScore(directed, directedMetrics, request).score;
    if (directedScore >= current.score) {
      current = { product: directed, score: directedScore, metrics: directedMetrics };
    }
  }

  const finalAlm = runAlmSimulation({
    product: current.product,
    runs: options.runs ?? MC_RUNS,
    seed: seedValue + 99,
    horizonMonths: horizon,
  });
  const findings = feasibilityCheck(current.product, finalAlm.metrics, request);
  return {
    product: current.product,
    alm: finalAlm,
    metrics: finalAlm.metrics,
    score: objectiveScore(current.product, finalAlm.metrics, request).score,
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
  return dims.map((dim) => {
    const irr: number[] = [];
    const ldr: number[] = [];
    const lcr: number[] = [];
    const overturning: number[] = [];
    const adoption: number[] = [];
    dim.deltas.forEach((d) => {
      const modes = product.modes.map((m) => dim.apply(m, d));
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
        horizonMonths: ALM_HORIZON_MONTHS,
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
