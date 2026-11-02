/**
 * app/domain/alm_simulator.py -> TypeScript twin
 * ---------------------------------------------------------------------------
 * Cohort-based ALM Digital Twin with stochastic customer cohorts over a
 * rolling 60-month horizon and Monte Carlo runs. Implements:
 *
 *  - cohort lifecycle: sleep (tau_d) -> waiting queue (omega) -> disbursement
 *    -> repayment (tau_l) -> exit / roll-over
 *  - unblocked withdrawal fraction delta_m ~ Beta(a,b) at disbursement
 *  - contractually blocked fraction beta_m released step-wise / linearly
 *  - closed-loop retention gamma_m re-entering the liability ledger as
 *    low-cost merchant current deposits
 *  - monthly LDR(t), LCR(t), IRR_bank, ROI, ROE, NIM (joint / non-joint)
 *  - Resource Overturning Risk (ریسک واژگونی منابع)
 */

import {
  ALM_HORIZON_MONTHS,
  CAPITAL,
  HURDLE_RATE,
  MC_RUNS,
  MC_SCREEN_RUNS,
  REGULATORY,
  TREASURY_RATE,
} from "./constants";
import {
  annualise,
  clamp,
  createRng,
  irr,
  mean,
  percentile,
  pmt,
  sampleBeta,
  sampleNormal,
  seedFromString,
  type Rng,
} from "./financial";
import { blockedReleaseSchedule } from "./pointEngine";
import type {
  AlmMetrics,
  AlmMonthRow,
  AlmResult,
  ModeSpec,
  ProductSpec,
} from "./types";

export type StressScenario = "base" | "mild-rate-shock" | "severe-run";

/** Simulation calibration knobs (all deterministic, all unit-testable). */
export const ALM_CALIBRATION = {
  /** Share of surplus funds actually deployable into treasury/interbank. */
  treasuryDeploymentEfficiency: 0.78,
  /** Market-absorption cap: max share of the deposit book placeable at treasury rates. */
  treasuryCapacityRatio: 0.28,
  /** Yield earned on the structural HQLA buffer itself. */
  hqlaYield: 0.085,
  /** POS/IPG interchange per settlement turn. */
  interchangeRatePerTurn: 0.0015,
  /** Merchant settlement turns per month. */
  monthlyTurnover: 3,
  /** Origination operating cost as a share of disbursed principal. */
  originationCostRate: 0.0008,
  /** One-off programme setup cost as a share of attracted resources. */
  programSetupCostRate: 0.0012,
  /** Capital released at horizon net of credit erosion. */
  capitalReleaseFactor: 0.96,
  /** Share of released blocked funds that immediately re-deposits. */
  blockedRedepositFraction: 0.3,
  /** Share of exiting cohorts that roll into a fresh average-balance cycle. */
  cohortRolloverRetention: 0.38,
  /** Life of the closed-loop merchant float bucket (months). */
  floatLifeMonths: 3,
  /** Spread over interbank paid on wholesale funding gaps. */
  wholesaleSpread: 0.012,
  /** Standard deviation of the monthly adoption shock. */
  adoptionNoiseSd: 0.07,
  /** Concentration of the Beta law driving delta_m. */
  deltaConcentration: 12,
} as const;

interface Cohort {
  modeIdx: number;
  volume: number;
  balance: number;
  blockedRemaining: number;
  loanOutstanding: number;
  loanOriginal: number;
  age: number;
  delta: number;
  phase: 0 | 1 | 2 | 3; // 0 sleep, 1 queue, 2 repay, 3 closed
  releaseSchedule: number[];
}

interface FloatBucket {
  balance: number;
  age: number;
  life: number;
  modeIdx: number;
}

const NUMERIC_ROW_KEYS: (keyof AlmMonthRow)[] = [
  "deposits",
  "blockedDeposits",
  "freeDeposits",
  "loans",
  "hqla",
  "netCashFlow",
  "cumulativeCashFlow",
  "ldr",
  "lcr",
  "jointIncome",
  "feeIncome",
  "treasuryIncome",
  "depositCost",
  "opex",
  "expectedLoss",
  "netIncome",
  "newOriginations",
  "installmentsIn",
  "withdrawals",
  "blockedReleased",
  "closedLoopInflow",
  "reversal",
  "activeCustomers",
];

function emptyRow(t: number): AlmMonthRow {
  const row = { t } as AlmMonthRow;
  NUMERIC_ROW_KEYS.forEach((key) => {
    (row[key] as number) = 0;
  });
  return row;
}

interface ModeRuntime {
  /** Effective loan-to-cohort-volume multiplier after caps. */
  loanFactor: number;
  intakePerMonth: number;
  cohortLife: number;
  annuity: boolean;
  monthlyRate: number;
  installmentCache: number;
}

export interface AlmSimulationInput {
  product: ProductSpec;
  runs?: number;
  seed?: number | string;
  horizonMonths?: number;
  scenario?: StressScenario;
  /** Optional per-mode parameter overrides used by the sensitivity dashboard. */
  overrides?: Partial<ModeSpec>[];
}

const scenarioFactors: Record<
  StressScenario,
  { outflow: number; adoption: number; delta: number; rate: number }
> = {
  base: { outflow: 1, adoption: 1, delta: 1, rate: 1 },
  "mild-rate-shock": { outflow: 1.25, adoption: 0.94, delta: 1.15, rate: 1.06 },
  "severe-run": { outflow: 1.85, adoption: 0.82, delta: 1.45, rate: 1.12 },
};

function buildRuntime(product: ProductSpec, horizon: number): ModeRuntime[] {
  return product.modes.map((mode) => {
    const annuity = mode.contract !== "qarz-hasaneh";
    const perCustomerLoan = Math.min(
      mode.capToman * 10,
      (mode.loanBookRial || 0) / Math.max(1, mode.customers),
    );
    const loanFactor =
      mode.depositVolumeRial > 0
        ? Math.max(
            0,
            Math.min(
              (perCustomerLoan * mode.customers) / mode.depositVolumeRial,
              mode.loanMultiplier * 1.6,
            ),
          )
        : 0;
    const cohortLife = Math.max(
      3,
      Math.round(mode.sleepMonths + mode.waitingMonths + mode.tenorMonths),
    );
    const ramp = Math.max(1, Math.round(Math.min(horizon * 0.4, mode.cohortRampMonths)));
    return {
      loanFactor,
      intakePerMonth: mode.depositVolumeRial / cohortLife / (ramp / Math.min(ramp, 6)),
      cohortLife,
      annuity,
      monthlyRate: mode.loanRate / 12,
      installmentCache: annuity
        ? pmt(mode.loanRate / 12, Math.max(1, mode.tenorMonths), 1)
        : 1 / Math.max(1, mode.tenorMonths),
    };
  });
}

/**
 * Single Monte Carlo path. When `runs === 1` the path uses expected values for
 * delta and adoption, which makes it the deterministic screening evaluator used
 * by the inverse optimiser.
 */
function simulatePath(
  product: ProductSpec,
  runtime: ModeRuntime[],
  horizon: number,
  rng: Rng,
  stochastic: boolean,
  scenario: StressScenario,
): PathOutput {
  const sf = scenarioFactors[scenario];
  const cohorts: Cohort[] = [];
  const floats: FloatBucket[] = [];
  const rows: AlmMonthRow[] = [];

  let earningsBuffer = 0;
  let cumulativeCash = 0;
  let prevDeposits = 0;
  let totalIntake = 0;
  let grossDrain = 0;
  let netDrainSum = 0;
  let totalOriginations = 0;
  const cf: number[] = new Array<number>(horizon).fill(0);
  let peakLoans = 0;
  let peakDeposits = 0;

  for (let t = 0; t < horizon; t += 1) {
    let newOriginations = 0;
    let withdrawals = 0;
    let blockedReleased = 0;
    let closedLoopInflow = 0;
    let installmentsIn = 0;
    let jointIncome = 0;
    let feeIncome = 0;
    let disbursementLeak = 0;

    // 1) cohort intake -------------------------------------------------------
    for (let m = 0; m < product.modes.length; m += 1) {
      const mode = product.modes[m];
      const rt = runtime[m];
      const ramp = Math.max(1, Math.round(Math.min(horizon * 0.4, mode.cohortRampMonths)));
      const rampFactor = clamp(0.25 + (0.75 * Math.min(t + 1, ramp)) / ramp, 0.25, 1);
      let intake = rt.intakePerMonth * rampFactor;
      if (stochastic) {
        intake *= clamp(
          1 + sampleNormal(rng, 0, ALM_CALIBRATION.adoptionNoiseSd) * sf.adoption,
          0.55,
          1.5,
        );
      } else {
        intake *= sf.adoption;
      }
      if (intake <= 0) continue;
      totalIntake += intake;
      const deltaMean = clamp(mode.withdrawalFractionMean * sf.delta, 0.02, 0.92);
      const delta = stochastic
        ? clamp(
            sampleBeta(
              rng,
              Math.max(0.4, deltaMean * ALM_CALIBRATION.deltaConcentration),
              Math.max(0.4, (1 - deltaMean) * ALM_CALIBRATION.deltaConcentration),
            ),
            0.01,
            0.97,
          )
        : deltaMean;
      cohorts.push({
        modeIdx: m,
        volume: intake,
        balance: intake,
        blockedRemaining: 0,
        loanOutstanding: 0,
        loanOriginal: 0,
        age: 0,
        delta,
        phase: 0,
        releaseSchedule: [],
      });
    }

    // 2) cohort ageing -------------------------------------------------------
    for (let i = cohorts.length - 1; i >= 0; i -= 1) {
      const c = cohorts[i];
      const mode = product.modes[c.modeIdx];
      const rt = runtime[c.modeIdx];
      c.age += 1;

      if (c.phase === 0 && c.age >= mode.sleepMonths) {
        c.phase = 1;
      }

      if (c.phase === 1 && c.age >= mode.sleepMonths + mode.waitingMonths) {
        // disbursement
        const loan = rt.loanFactor * c.volume;
        c.loanOriginal = loan;
        c.loanOutstanding = loan;
        c.phase = 2;
        const withdrawable = c.volume * (1 - mode.blockedRatio);
        const leak = withdrawable * c.delta;
        c.balance -= leak;
        withdrawals += leak;
        disbursementLeak += leak;
        c.blockedRemaining = c.volume * mode.blockedRatio;
        c.releaseSchedule = blockedReleaseSchedule(
          mode.blockRelease,
          c.blockedRemaining,
          mode.tenorMonths,
        );
        // closed-loop retention re-enters as low-cost merchant current deposit
        const retained = loan * mode.closedLoopRetention;
        if (retained > 0) {
          closedLoopInflow += retained;
          floats.push({
            balance: retained,
            age: 0,
            life: ALM_CALIBRATION.floatLifeMonths,
            modeIdx: c.modeIdx,
          });
          c.balance += retained * 0.25; // settlement residual kept on account
        }
        newOriginations += loan;
        // non-joint fee income at origination
        if (mode.contract === "qarz-hasaneh") {
          feeIncome += loan * mode.loanRate; // commission charged upfront
        }
        feeIncome += loan * mode.feeIncomeRate;
        cf[t] -= loan * ALM_CALIBRATION.originationCostRate;
      }

      if (c.phase === 2 && c.loanOutstanding > 0) {
        const tenor = Math.max(1, mode.tenorMonths);
        const installment =
          c.loanOriginal * rt.installmentCache * (rt.annuity ? 1 : 1);
        const interestPart = rt.annuity
          ? Math.min(c.loanOutstanding * rt.monthlyRate * sf.rate, installment)
          : 0;
        const principalPart = Math.min(
          c.loanOutstanding,
          Math.max(0, installment - interestPart),
        );
        c.loanOutstanding -= principalPart;
        jointIncome += interestPart;
        installmentsIn += installment;

        const idx = Math.min(c.age - Math.round(mode.sleepMonths + mode.waitingMonths) - 1, tenor - 1);
        const release = idx >= 0 && idx < c.releaseSchedule.length ? c.releaseSchedule[idx] : 0;
        if (release > 0) {
          blockedReleased += release;
          const redeposit = release * ALM_CALIBRATION.blockedRedepositFraction;
          c.balance -= release - redeposit;
          withdrawals += release - redeposit;
          c.blockedRemaining = Math.max(0, c.blockedRemaining - release);
        }
        if (c.loanOutstanding <= c.loanOriginal * 1e-6 || c.age >= tenor + mode.sleepMonths + mode.waitingMonths) {
          c.loanOutstanding = 0;
          c.phase = 3;
        }
      }

      if (c.phase === 3) {
        const rollover = c.balance * ALM_CALIBRATION.cohortRolloverRetention;
        withdrawals += c.balance - rollover;
        if (rollover > 0) {
          const deltaMean = clamp(mode.withdrawalFractionMean * sf.delta, 0.02, 0.92);
          cohorts.push({
            modeIdx: c.modeIdx,
            volume: rollover,
            balance: rollover,
            blockedRemaining: 0,
            loanOutstanding: 0,
            loanOriginal: 0,
            age: 0,
            delta: stochastic ? clamp(sampleBeta(rng, deltaMean * 10 + 1, (1 - deltaMean) * 10 + 1), 0.01, 0.97) : deltaMean,
            phase: 0,
            releaseSchedule: [],
          });
        }
        cohorts.splice(i, 1);
      }
      if (c.balance < 0) c.balance = 0;
    }

    // 3) closed-loop float decay + acquirer interchange ----------------------
    for (let i = floats.length - 1; i >= 0; i -= 1) {
      const f = floats[i];
      f.age += 1;
      const mode = product.modes[f.modeIdx];
      feeIncome +=
        f.balance * ALM_CALIBRATION.interchangeRatePerTurn * ALM_CALIBRATION.monthlyTurnover *
        (mode.sourceKappa >= 1.3 ? 1.25 : 1);
      if (f.age >= f.life) {
        withdrawals += f.balance * 0.7;
        closedLoopInflow += f.balance * 0.3; // re-settled into merchant accounts
        floats.splice(i, 1);
      } else {
        f.balance *= 0.985;
      }
    }

    // 4) aggregates ----------------------------------------------------------
    let depositBalance = 0;
    let blockedBalance = 0;
    let loanBalance = 0;
    let weightedRr = 0;
    let depositCost = 0;
    let expectedLoss = 0;
    let opex = 0;
    let activeCustomers = 0;

    for (const c of cohorts) {
      const mode = product.modes[c.modeIdx];
      depositBalance += c.balance;
      blockedBalance += c.blockedRemaining;
      loanBalance += c.loanOutstanding;
      weightedRr += c.balance * mode.statutoryReserve;
      depositCost += (c.balance * mode.depositRate) / 12;
      expectedLoss += (c.loanOutstanding * mode.pd * mode.lgd) / 12;
      opex += (c.balance * (1 - mode.statutoryReserve) * mode.opexRatio) / 12;
      if (c.loanOutstanding > 0) activeCustomers += 1;
    }
    let floatBalance = 0;
    for (const f of floats) {
      floatBalance += f.balance;
      weightedRr += f.balance * 0.02;
      depositCost += (f.balance * 0.01) / 12; // low-cost current deposit
    }
    const deposits = depositBalance + floatBalance;
    const rrWeighted = deposits > 0 ? weightedRr / deposits : 0;
    const usableDeposits = deposits * (1 - rrWeighted);
    const hotDeposits = Math.max(0, deposits - blockedBalance);

    // 5) treasury / wholesale funding leg ------------------------------------
    const requiredHqla = CAPITAL.hqlaToDeposits * deposits;
    const buffer = Math.max(0, earningsBuffer) * 0.3;
    const hqla = Math.min(requiredHqla, Math.max(0, usableDeposits - loanBalance + buffer));
    const fundingGap = Math.max(0, loanBalance + requiredHqla - usableDeposits - buffer);
    const surplus = Math.max(0, usableDeposits - loanBalance - hqla);
    // Market-absorption cap: only a fraction of the deposit book can actually be
    // placed at interbank/treasury rates; the idle remainder earns nothing.
    const deployableCapacity = ALM_CALIBRATION.treasuryCapacityRatio * deposits;
    const treasuryPlacements = Math.min(surplus, deployableCapacity);
    const treasuryIncome =
      (treasuryPlacements * ALM_CALIBRATION.treasuryDeploymentEfficiency * (TREASURY_RATE * sf.rate)) / 12 +
      (hqla * ALM_CALIBRATION.hqlaYield) / 12;
    const wholesaleCost =
      (fundingGap * (HURDLE_RATE + ALM_CALIBRATION.wholesaleSpread)) / 12;

    const netIncome =
      jointIncome + feeIncome + treasuryIncome - depositCost - opex - expectedLoss - wholesaleCost;

    earningsBuffer += netIncome;
    cf[t] += netIncome - (t === 0 ? 0 : 0);

    // 6) regulatory ratios ---------------------------------------------------
    const ldr = usableDeposits > 0 ? loanBalance / usableDeposits : 0;
    const stressedOutflow =
      CAPITAL.stressedOutflowShock * hotDeposits * sf.outflow + 0.25 * blockedReleased;
    const inflow30 = installmentsIn + treasuryIncome + feeIncome * 0.5;
    const lcr = stressedOutflow > 0 ? (hqla + inflow30) / stressedOutflow : 99;

    const reversal =
      prevDeposits > 0
        ? Math.max(0, withdrawals - closedLoopInflow) / prevDeposits
        : 0;
    grossDrain += Math.max(0, withdrawals - closedLoopInflow);
    netDrainSum += Math.max(0, disbursementLeak - closedLoopInflow);
    totalOriginations += newOriginations;
    cumulativeCash += netIncome;
    peakLoans = Math.max(peakLoans, loanBalance);
    peakDeposits = Math.max(peakDeposits, deposits);

    rows.push({
      t: t + 1,
      deposits,
      blockedDeposits: blockedBalance,
      freeDeposits: Math.max(0, deposits - blockedBalance),
      loans: loanBalance,
      hqla,
      netCashFlow: netIncome,
      cumulativeCashFlow: cumulativeCash,
      ldr,
      lcr,
      jointIncome,
      feeIncome,
      treasuryIncome,
      depositCost,
      opex,
      expectedLoss,
      netIncome,
      newOriginations,
      installmentsIn,
      withdrawals,
      blockedReleased,
      closedLoopInflow,
      reversal,
      activeCustomers,
    });

    prevDeposits = deposits;
  }

  // 7) program capital and IRR ------------------------------------------------
  const setupCost = totalIntake * ALM_CALIBRATION.programSetupCostRate;
  const economicCapital =
    CAPITAL.capitalToLoans * peakLoans + CAPITAL.hqlaToDeposits * peakDeposits + setupCost;
  cf[0] -= economicCapital;
  cf[horizon - 1] += economicCapital * ALM_CALIBRATION.capitalReleaseFactor;
  const monthlyIrr = irr(cf, 0.02);

  return {
    rows,
    irrMonthly: Number.isFinite(monthlyIrr) ? monthlyIrr : NaN,
    economicCapital,
    totalIntake,
    grossDrain,
    netDrain: netDrainSum,
    totalOriginations,
  };
}

export interface PathOutput {
  rows: AlmMonthRow[];
  irrMonthly: number;
  economicCapital: number;
  totalIntake: number;
  grossDrain: number;
  /** Disbursement leakage net of the closed-loop return (Rial). */
  netDrain: number;
  totalOriginations: number;
}

interface PathSummary {
  irrMonthly: number;
  maxLdr: number;
  minLcr: number;
  overturning: number;
  netDrain: number;
  totalIntake: number;
  peakLoans: number;
  peakDeposits: number;
  originations: number;
  netIncomeTotal: number;
  monthsBreachLdr: number;
  monthsBreachLcr: number;
}

/** Full Monte Carlo ALM stress test. */
export function runAlmSimulation(input: AlmSimulationInput): AlmResult {
  const horizon = Math.max(6, input.horizonMonths ?? ALM_HORIZON_MONTHS);
  const runs = Math.max(1, input.runs ?? MC_RUNS);
  const scenario = input.scenario ?? "base";
  const seedValue =
    typeof input.seed === "string"
      ? seedFromString(input.seed)
      : input.seed ?? seedFromString("alm-digital-twin");
  const rng = createRng(seedValue);

  const product: ProductSpec = input.overrides
    ? {
        ...input.product,
        modes: input.product.modes.map((m, i) => ({ ...m, ...(input.overrides?.[i] ?? {}) })),
      }
    : input.product;

  const runtime = buildRuntime(product, horizon);
  const stochastic = runs > 1;

  const acc: AlmMonthRow[] = Array.from({ length: horizon }, (_, i) =>
    emptyRow(i + 1),
  );

  const series = {
    irr: [] as number[],
    maxLdr: [] as number[],
    minLcr: [] as number[],
    overturning: [] as number[],
    drain: [] as number[],
    intake: [] as number[],
    peakLoans: [] as number[],
    peakDeposits: [] as number[],
    originations: [] as number[],
    netIncome: [] as number[],
    breachLdr: [] as number[],
    breachLcr: [] as number[],
    ldrByMonth: [] as number[][],
    lcrByMonth: [] as number[][],
  };
  for (let m = 0; m < horizon; m += 1) {
    series.ldrByMonth.push([]);
    series.lcrByMonth.push([]);
  }

  const summaries: PathSummary[] = [];

  for (let p = 0; p < runs; p += 1) {
    const path = simulatePath(product, runtime, horizon, rng, stochastic, scenario);
    const rows = path.rows;
    let maxLdr = 0;
    let minLcr = Infinity;
    let overturning = 0;
    let netDrain = 0;
    let intake = 0;
    let originations = 0;
    let netIncomeTotal = 0;
    let breachLdr = 0;
    let breachLcr = 0;
    let peakLoans = 0;
    let peakDeposits = 0;
    intake = path.totalIntake;
    netDrain = path.netDrain;

    for (let t = 0; t < rows.length; t += 1) {
      const row = rows[t];
      const target = acc[t];
      target.deposits += row.deposits;
      target.blockedDeposits += row.blockedDeposits;
      target.freeDeposits += row.freeDeposits;
      target.loans += row.loans;
      target.hqla += row.hqla;
      target.netCashFlow += row.netCashFlow;
      target.cumulativeCashFlow += row.cumulativeCashFlow;
      target.ldr += row.ldr;
      target.lcr += row.lcr;
      target.jointIncome += row.jointIncome;
      target.feeIncome += row.feeIncome;
      target.treasuryIncome += row.treasuryIncome;
      target.depositCost += row.depositCost;
      target.opex += row.opex;
      target.expectedLoss += row.expectedLoss;
      target.netIncome += row.netIncome;
      target.newOriginations += row.newOriginations;
      target.installmentsIn += row.installmentsIn;
      target.withdrawals += row.withdrawals;
      target.blockedReleased += row.blockedReleased;
      target.closedLoopInflow += row.closedLoopInflow;
      target.reversal += row.reversal;
      target.activeCustomers += row.activeCustomers;

      series.ldrByMonth[t].push(row.ldr);
      series.lcrByMonth[t].push(row.lcr);

      maxLdr = Math.max(maxLdr, row.ldr);
      minLcr = Math.min(minLcr, row.lcr);
      overturning = Math.max(overturning, row.reversal);
      originations += row.newOriginations;
      netIncomeTotal += row.netIncome;
      peakLoans = Math.max(peakLoans, row.loans);
      peakDeposits = Math.max(peakDeposits, row.deposits);
      if (row.ldr > REGULATORY.ldrCeiling) breachLdr += 1;
      if (row.lcr < REGULATORY.lcrFloor) breachLcr += 1;
    }

    const irrMonthly = path.irrMonthly;
    if (Number.isFinite(irrMonthly)) series.irr.push(irrMonthly);
    series.maxLdr.push(maxLdr);
    series.minLcr.push(Number.isFinite(minLcr) ? minLcr : 0);
    series.overturning.push(overturning);
    series.drain.push(netDrain);
    series.intake.push(intake);
    series.peakLoans.push(peakLoans);
    series.peakDeposits.push(peakDeposits);
    series.originations.push(originations);
    series.netIncome.push(netIncomeTotal);
    series.breachLdr.push(breachLdr);
    series.breachLcr.push(breachLcr);
    summaries.push({
      irrMonthly: Number.isFinite(irrMonthly) ? irrMonthly : 0,
      maxLdr,
      minLcr: Number.isFinite(minLcr) ? minLcr : 0,
      overturning,
      netDrain,
      totalIntake: intake,
      peakLoans,
      peakDeposits,
      originations,
      netIncomeTotal,
      monthsBreachLdr: breachLdr,
      monthsBreachLcr: breachLcr,
    });
  }

  const monthly = acc.map((row) => {
    const out: Record<string, number> = { t: row.t };
    NUMERIC_ROW_KEYS.forEach((key) => {
      out[key] = (row[key] as number) / runs;
    });
    return out as unknown as AlmMonthRow;
  });

  const avgEarningAssets = mean(
    monthly.map((r) => r.loans + r.hqla + Math.max(0, r.freeDeposits - r.loans)),
  );
  const totalJoint = monthly.reduce((a, r) => a + r.jointIncome + r.treasuryIncome, 0);
  const totalFee = monthly.reduce((a, r) => a + r.feeIncome, 0);
  const totalCost = monthly.reduce(
    (a, r) => a + r.depositCost + r.opex + r.expectedLoss,
    0,
  );
  const totalNetIncome = monthly.reduce((a, r) => a + r.netIncome, 0);
  const economicCapital =
    CAPITAL.capitalToLoans * mean(series.peakLoans) +
    CAPITAL.hqlaToDeposits * mean(series.peakDeposits) +
    mean(series.intake) * ALM_CALIBRATION.programSetupCostRate;

  const irrMonthly = series.irr.length ? mean(series.irr) : NaN;
  const irrAnnual = Number.isFinite(irrMonthly) ? annualise(irrMonthly) : 0;
  const years = horizon / 12;

  const metrics: AlmMetrics = {
    irrBank: Number.isFinite(irrMonthly) ? irrMonthly : 0,
    irrBankAnnual: irrAnnual,
    roi: economicCapital > 0 ? totalNetIncome / economicCapital : 0,
    roe:
      economicCapital > 0
        ? (totalNetIncome / years) / economicCapital
        : 0,
    nim: avgEarningAssets > 0 ? ((totalJoint + totalFee - totalCost) / years) / avgEarningAssets : 0,
    nimJoint: avgEarningAssets > 0 ? ((totalJoint - totalCost) / years) / avgEarningAssets : 0,
    nimNonJoint: avgEarningAssets > 0 ? (totalFee / years) / avgEarningAssets : 0,
    maxLdr: series.maxLdr.length ? percentile(series.maxLdr, 95) : 0,
    p95Ldr: series.maxLdr.length ? percentile(series.maxLdr, 95) : 0,
    meanLdr: mean(monthly.map((r) => r.ldr)),
    minLcr: series.minLcr.length ? percentile(series.minLcr, 5) : 0,
    p5Lcr: series.minLcr.length ? percentile(series.minLcr, 5) : 0,
    meanLcr: mean(monthly.map((r) => r.lcr)),
    overturningShock: series.overturning.length
      ? percentile(series.overturning, 95)
      : 0,
    netLiquidityDrainRial: mean(series.drain),
    netLiquidityDrainRatio:
      mean(series.originations) > 0 ? mean(series.drain) / mean(series.originations) : 0,
    adoptionScore: product.modes.reduce(
      (acc, m) => acc + m.adoptionScore * m.weight,
      0,
    ),
    peakLoansRial: mean(series.peakLoans),
    peakDepositsRial: mean(series.peakDeposits),
    totalDepositsAttractedRial: mean(series.intake),
    totalFacilitiesOriginatedRial: mean(series.originations),
    facilityCount: product.modes.reduce((acc, m) => acc + m.customers, 0),
    totalNetIncomeRial: totalNetIncome,
    monthsInBreachLdr: mean(series.breachLdr),
    monthsInBreachLcr: mean(series.breachLcr),
    economicCapitalRial: economicCapital,
    costOfIncome: totalJoint + totalFee > 0 ? totalCost / (totalJoint + totalFee) : 0,
    resourceStabilityIndex: clamp(
      1 - (series.overturning.length ? percentile(series.overturning, 95) : 0) * 6,
      0,
      1,
    ),
  };

  const breaches: AlmResult["breaches"] = [];
  series.ldrByMonth.forEach((values, i) => {
    const p95 = percentile(values, 95);
    if (p95 > REGULATORY.ldrCeiling)
      breaches.push({ t: i + 1, metric: "LDR", value: p95, limit: REGULATORY.ldrCeiling });
  });
  series.lcrByMonth.forEach((values, i) => {
    const p5 = percentile(values, 5);
    if (p5 < REGULATORY.lcrFloor)
      breaches.push({ t: i + 1, metric: "LCR", value: p5, limit: REGULATORY.lcrFloor });
  });

  const buckets = [0, 0.02, 0.04, 0.06, 0.08, 0.12, 0.2, 1];
  const histogram = buckets.slice(0, -1).map((lo, i) => {
    const hi = buckets[i + 1];
    const count = series.overturning.filter((v) => v >= lo && v < hi).length;
    return {
      bucket: `${(lo * 100).toFixed(0)}–${(hi * 100).toFixed(0)}%`,
      frequency: runs ? count / runs : 0,
    };
  });

  return {
    horizonMonths: horizon,
    monteCarloRuns: runs,
    seed: seedValue,
    metrics,
    monthly,
    ldrMean: monthly.map((r) => r.ldr),
    ldrP95: series.ldrByMonth.map((v) => percentile(v, 95)),
    lcrMean: monthly.map((r) => r.lcr),
    lcrP5: series.lcrByMonth.map((v) => percentile(v, 5)),
    depositsMean: monthly.map((r) => r.deposits),
    loansMean: monthly.map((r) => r.loans),
    netCashFlowMean: monthly.map((r) => r.netCashFlow),
    cumulativeMean: monthly.map((r) => r.cumulativeCashFlow),
    jointIncomeMean: monthly.map((r) => r.jointIncome + r.treasuryIncome),
    feeIncomeMean: monthly.map((r) => r.feeIncome),
    overturningHistogram: histogram,
    breaches,
  };
}

/** Deterministic screening evaluator (expected-value path, no sampling). */
export function evaluateProduct(
  product: ProductSpec,
  seed: number | string = "screen",
  horizonMonths = ALM_HORIZON_MONTHS,
): AlmMetrics {
  return runAlmSimulation({ product, runs: 1, seed, horizonMonths }).metrics;
}

export { MC_SCREEN_RUNS, MC_RUNS };
export type { AlmMonthRow, PathSummary };
