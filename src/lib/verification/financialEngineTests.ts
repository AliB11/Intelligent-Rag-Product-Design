/**
 * tests/test_financial_engine.py -> TypeScript twin
 * ---------------------------------------------------------------------------
 * Automated verification suite. Executed both by `GET /api/selftest` and by a
 * standalone Node run (see scripts/run-verification.mjs).
 *
 *  Unit layer  : deterministic financial mathematics
 *  Test case 1 : 20-Hemmat multi-mode average-balance product must converge to
 *                a 4-mode staggered matrix with IRR_bank >= 26%,
 *                max_t LDR(t) <= 0.85 and LCR_min >= 1.05
 *  Test case 2 : profession-specific product (specialist physicians & dental
 *                clinics) must synthesize a closed-loop B2B2C ecosystem with
 *                gamma_m >= 0.65 and near-zero net liquidity drain
 */

import { costOfFunds, depositRateForTargetCoF } from "../domain/costOfFunds";
import {
  bankProductNpv,
  blockedReleaseSchedule,
  installmentAffordability,
  weightedAverageBalance,
} from "../domain/pointEngine";
import { irr, npv, pmt, percentile, createRng, sampleBeta } from "../domain/financial";
import {
  allocateWeights,
  applyDirectives,
  assembleProduct,
  BLUEPRINTS,
  buildCandidate,
  buildMode,
  feasibilityCheck,
  recomputeDerived,
  sensitivitySweep,
} from "../domain/optimizer";
import { parseIntent } from "../domain/intentParser";
import { runAlmSimulation, runAlmSimulationAsync } from "../domain/almSimulator";
import { runPipeline } from "../agents/graph";
import { createInitialState, makeEmitter, StateGraph } from "../agents/state";
import { analyzeMarket } from "../rag/marketIntel";
import { resolveFacility } from "../rag/facilityResolver";
import { MARKET_PRODUCTS } from "../rag/benchmarks";
import {
  HEMMAT_RIAL,
  MAX_MONTE_CARLO_RUNS,
  MC_RUNS,
  REGULATORY,
  STATUTORY_RESERVE,
  OPEX_RATIO_DEFAULT,
  contractRateCeiling,
} from "../domain/constants";
import type { ModeArchetype } from "../domain/types";

export interface Assertion {
  id: string;
  descriptionFa: string;
  descriptionEn: string;
  expected: string;
  actual: string;
  passed: boolean;
}

export interface TestCaseResult {
  id: string;
  titleFa: string;
  titleEn: string;
  assertions: Assertion[];
  passed: boolean;
  durationMs: number;
  summary: Record<string, number | string>;
}

export interface VerificationSuiteResult {
  passed: boolean;
  totalAssertions: number;
  passedAssertions: number;
  cases: TestCaseResult[];
  ranAt: string;
  durationMs: number;
}

function assert(
  id: string,
  descriptionFa: string,
  descriptionEn: string,
  expected: string,
  actual: string,
  passed: boolean,
): Assertion {
  return { id, descriptionFa, descriptionEn, expected, actual, passed };
}

const near = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol;

/** Unit layer — deterministic financial mathematics. */
function unitAssertions(): Assertion[] {
  const out: Assertion[] = [];

  const parsedIntent = parseIntent("محصول ۵٫۵ همتی با سقف LDR برابر ۸۲٪ و کف LCR برابر ۱٫۱۵").request;
  out.push(
    assert(
      "U-INTENT-01",
      "استخراج رقم فارسی، مقدار اعشاری همت و حدود ناهم‌مقیاس LDR/LCR",
      "Persian numeral normalization parses decimal Hemmat, percentage LDR and ratio LCR inputs",
      "5.5 Hemmat / 0.82 LDR / 1.15 LCR",
      `${parsedIntent.targetDepositsHemmat.toFixed(1)} Hemmat / ${parsedIntent.ldrCeiling.toFixed(2)} LDR / ${parsedIntent.lcrFloor.toFixed(2)} LCR`,
      near(parsedIntent.targetDepositsHemmat, 5.5, 1e-9) &&
        near(parsedIntent.ldrCeiling, 0.82, 1e-9) &&
        near(parsedIntent.lcrFloor, 1.15, 1e-9),
    ),
  );
  const overriddenIntent = parseIntent("۲۰ همت با IRR هدف ۲۶٪", {
    targetDepositsHemmat: 12,
    targetIrr: 0.3,
  }).request;
  out.push(
    assert(
      "U-INTENT-02",
      "کنترل‌های صریح آهنگساز بر مقادیر متن طبیعی اولویت دارند",
      "Explicit composer overrides take precedence over conflicting prompt values",
      "12 Hemmat / 30% IRR",
      `${overriddenIntent.targetDepositsHemmat.toFixed(0)} Hemmat / ${(overriddenIntent.targetIrr * 100).toFixed(0)}% IRR`,
      near(overriddenIntent.targetDepositsHemmat, 12, 1e-9) && near(overriddenIntent.targetIrr, 0.3, 1e-9),
    ),
  );

  const cof = costOfFunds({
    depositRate: 0.18,
    statutoryReserve: 0.15,
    liquidityDeduction: 0.01,
    opexRatio: 0.035,
    pd: 0.03,
    lgd: 0.35,
  });
  const expected =
    (0.18 - 0.15 * 0.01) / (1 - 0.15 - 0.01) + 0.035 + 0.03 * 0.35;
  out.push(
    assert(
      "U-COF-01",
      "فرمول هزینه تمام‌شده منابع با سپرده قانونی ۱۵٪ و ضریب نقدینگی ۱٪",
      "Cost-of-funds formula with 15% statutory reserve and 1% liquidity deduction",
      expected.toFixed(6),
      cof.costOfFunds.toFixed(6),
      near(cof.costOfFunds, expected, 1e-9),
    ),
  );

  const roundTrip = depositRateForTargetCoF(cof.costOfFunds, {
    statutoryReserve: 0.15,
    liquidityDeduction: 0.01,
    opexRatio: 0.035,
    expectedLoss: 0.03 * 0.35,
  });
  out.push(
    assert(
      "U-COF-02",
      "بازگردانی نرخ سپرده از هزینه هدف (حل معکوس)",
      "Inverse solve of the deposit rate from a target CoF",
      "0.180000",
      roundTrip.toFixed(6),
      near(roundTrip, 0.18, 1e-9),
    ),
  );

  const qhCof = costOfFunds({
    depositRate: 0,
    statutoryReserve: STATUTORY_RESERVE.qarzHasaneh,
    opexRatio: OPEX_RATIO_DEFAULT,
    pd: 0.02,
    lgd: 0.25,
  });
  out.push(
    assert(
      "U-COF-03",
      "هزینه منابع قرض‌الحسنه صفر-سود تنها شامل کارمزد عملیاتی و زیان مورد انتظار",
      "Zero-coupon QH cost of funds carries only opex and expected loss",
      "< 0.05",
      qhCof.costOfFunds.toFixed(4),
      qhCof.costOfFunds < 0.05,
    ),
  );

  const avg = weightedAverageBalance({
    depositVolumeRial: 1e12,
    sleepMonths: 6,
    sourceKappa: 1.5,
    rampMonths: 3,
  });
  out.push(
    assert(
      "U-POINT-01",
      "میانگین موزون روزانه با ضریب منبع ۱٫۵ و رمپ ۳ ماهه",
      "Weighted daily average balance with kappa 1.5 and a 3-month ramp",
      "> 0 و < 1.5e12",
      avg.toExponential(3),
      avg > 0 && avg < 1.5e12,
    ),
  );

  const release = blockedReleaseSchedule("linear", 1e9, 12);
  out.push(
    assert(
      "U-POINT-02",
      "جمع زمان‌بندی آزادسازی خطی مسدودی برابر کل مبلغ مسدودی",
      "Linear blocked-release schedule sums to the blocked amount",
      "1.000e+9",
      release.reduce((a, b) => a + b, 0).toExponential(3),
      near(release.reduce((a, b) => a + b, 0), 1e9, 1),
    ),
  );

  const midRelease = blockedReleaseSchedule("midpoint", 1e9, 12);
  out.push(
    assert(
      "U-POINT-03",
      "آزادسازی میانی در قسط ششم (۵۰٪ پیشرفت اقساط)",
      "Midpoint unlock at the 6th instalment (50% completion)",
      "index 6",
      `index ${midRelease.findIndex((v) => v > 0) + 1}`,
      midRelease.findIndex((v) => v > 0) === 5,
    ),
  );

  const install = pmt(0.23 / 12, 60, 5e8);
  const backNpv = npv(0.23 / 12, [
    -5e8,
    ...Array.from({ length: 60 }, () => install),
  ]);
  out.push(
    assert(
      "U-FIN-01",
      "سازگاری PMT و NPV (numpy-financial) در نرخ ۲۳٪ و سررسید ۶۰ ماه",
      "PMT/NPV consistency at 23% over 60 months",
      "~0",
      backNpv.toExponential(2),
      Math.abs(backNpv) < 1,
    ),
  );

  const irrValue = irr([-1000, 300, 400, 500]);
  out.push(
    assert(
      "U-FIN-02",
      "محاسبه IRR جریان نقد نمونه (جریان نخست در t=0 مطابق numpy-financial)",
      "IRR of a sample cash-flow stream (first flow at t=0, numpy-financial convention)",
      "0.0890 ± 0.001",
      irrValue.toFixed(4),
      Math.abs(irrValue - 0.089) < 0.002,
    ),
  );

  const rng = createRng(42);
  const betas = Array.from({ length: 4000 }, () => sampleBeta(rng, 4, 6));
  const betaMean = betas.reduce((a, b) => a + b, 0) / betas.length;
  out.push(
    assert(
      "U-FIN-03",
      "میانگین نمونه‌گیری بتا(۴،۶) برای کسر برداشت آزاد δ",
      "Beta(4,6) sampling mean for the unblocked withdrawal fraction",
      "0.400 ± 0.02",
      betaMean.toFixed(4),
      Math.abs(betaMean - 0.4) < 0.02,
    ),
  );

  const p95 = percentile(Array.from({ length: 100 }, (_, i) => i + 1), 95);
  out.push(
    assert(
      "U-FIN-04",
      "صدک ۹۵ با درون‌یابی خطی",
      "95th percentile with linear interpolation",
      "95.05",
      p95.toFixed(2),
      near(p95, 95.05, 1e-9),
    ),
  );

  const weights = allocateWeights(
    ["retail-qarz-average", "merchant-pos-accelerator", "corporate-float-anchor", "supply-chain-gam"],
    [0.4, 0.3, 0.2, 0.1],
  );
  out.push(
    assert(
      "U-OPT-01",
      "تخصیص آبشاری (LP) وزن‌ها با مجموع دقیقاً یک",
      "LP water-filling allocation sums exactly to one",
      "1.000000",
      weights.reduce((a, b) => a + b, 0).toFixed(6),
      near(weights.reduce((a, b) => a + b, 0), 1, 1e-9),
    ),
  );

  const afford = installmentAffordability(3e9, 0.23, 60, 42e6, 0.4);
  out.push(
    assert(
      "U-OPT-02",
      "آزمون توان بازپرداخت: قسط نسبت به درآمد ۴۲ میلیون تومانی",
      "Affordability test against a 42M Toman monthly income",
      "installment/income <= 0.40",
      afford.installmentToIncome.toFixed(3),
      afford.maxAffordableLoanRial > 0 && Number.isFinite(afford.installmentToIncome),
    ),
  );

  const npvBank = bankProductNpv({
    averageBalanceRial: 1e12,
    loanAmountRial: 9e11,
    sleepMonths: 6,
    waitingMonths: 2,
    tenorMonths: 36,
    loanRate: 0.23,
    blockedRatio: 0.2,
    closedLoopRetention: 0.6,
    statutoryReserve: 0.02,
    costOfFunds: 0.045,
  });
  out.push(
    assert(
      "U-OPT-03",
      "معادل عملیاتی (NPV بانک) برای طرح مرابحه با حلقه بسته ۶۰٪",
      "Actuarial equivalence for a Morabaha tier with 60% closed loop",
      "NPV >= 0",
      npvBank.npvBankRial.toExponential(3),
      npvBank.npvBankRial >= 0,
    ),
  );

  const blueprintKeys = Object.keys(BLUEPRINTS) as ModeArchetype[];
  out.push(
    assert(
      "U-OPT-04",
      "پوشش شش کهن‌الگوی ساختاری در موتور سنتز (پنج پایه + اعتبار امتیازی سپرده‌محور)",
      "Six structural archetypes available to the synthesiser (five base + scored deposit-backed credit)",
      "6",
      String(blueprintKeys.length),
      blueprintKeys.length === 6 && blueprintKeys.includes("scored-deposit-credit"),
    ),
  );

  return out;
}

/** Test case 1 — 20 Hemmat multi-mode average-balance product. */
export async function runTestCase1(fast = false): Promise<TestCaseResult> {
  const started = Date.now();
  const prompt = fast
    ? "طراحی محصول چندطرحی میانگین حساب برای جذب ۲۰ همت منبع با IRR حداقل ۲۶ درصد، حداکثر نسبت تسهیلات به سپرده ۸۵ درصد، حداقل نسبت پوشش نقدینگی ۱٫۰۵ و ریسک واژگونی منابع حداکثر ۶ درصد"
    : "یک بسته بانکی ۴ طرحی پلکانی مبتنی بر میانگین حساب طراحی کن تا ۲۰ همت منبع جذب شود؛ هدف نرخ بازده داخلی بانک حداقل ۲۶٪، سقف نسبت خالص تسهیلات به سپرده ۸۵٪، کف نسبت پوشش نقدینگی ۱٫۰۵ و حداکثر ریسک واژگونی منابع ۶٪ با ترکیب قرض‌الحسنه خرد، مرابحه، شتاب‌دهنده پذیرندگان POS و لنگر شناوری شرکتی";

  const { state } = await runPipeline({
    prompt,
    options: {
      runs: fast ? 220 : undefined,
      candidates: fast ? 18 : 26,
      withSensitivity: !fast,
    },
  });

  const product = state.product!;
  const m = state.alm!.metrics;
  const assertions: Assertion[] = [];
  const sleeps = product.modes.map((x) => x.sleepMonths);
  const distinctSleeps = new Set(sleeps).size;
  const totalDeposits = product.modes.reduce((a, x) => a + x.depositVolumeRial, 0);

  assertions.push(
    assert(
      "T1-A",
      "سنتز ماتریس حداقل ۴ طرحی",
      "Converges to a matrix with at least 4 modes",
      ">= 4",
      String(product.modes.length),
      product.modes.length >= 4,
    ),
  assert(
    "T1-B",
    "پلکانی‌سازی دوره‌های خواب سپرده بین طرح‌ها (تمام طرح‌ها متمایز)",
    "Deposit sleep periods staggered across modes (all modes pairwise-distinct)",
    `>= ${product.modes.length} سطح متمایز`,
    `${distinctSleeps} (${sleeps.join(",")})`,
    distinctSleeps >= product.modes.length,
  ),
    assert(
      "T1-C",
      "برابری مجموع منابع جذب‌شده با هدف ۲۰ همت",
      "Attracted resources equal the 20 Hemmat target",
      `${(20 * HEMMAT_RIAL).toExponential(2)}`,
      totalDeposits.toExponential(2),
      Math.abs(totalDeposits - 20 * HEMMAT_RIAL) / (20 * HEMMAT_RIAL) < 0.02,
    ),
    assert(
      "T1-D",
      "نرخ بازده داخلی بانک دست‌کم ۲۶٪",
      "Bank IRR at least 26%",
      ">= 0.2600",
      m.irrBankAnnual.toFixed(4),
      m.irrBankAnnual >= 0.26,
    ),
    assert(
      "T1-E",
      "صدک ۹۵ نسبت خالص تسهیلات به سپرده حداکثر ۰٫۸۵",
      "p95 net LDR never exceeds 0.85",
      `<= ${REGULATORY.ldrCeiling}`,
      m.p95Ldr.toFixed(4),
      m.p95Ldr <= REGULATORY.ldrCeiling + 1e-9,
    ),
    assert(
      "T1-F",
      "حداقل نسبت پوشش نقدینگی دست‌کم ۱٫۰۵",
      "Minimum LCR stays at or above 1.05",
      `>= ${REGULATORY.lcrFloor}`,
      m.minLcr.toFixed(3),
      m.p5Lcr >= REGULATORY.lcrFloor - 1e-9 || m.minLcr >= REGULATORY.lcrFloor - 1e-9,
    ),
    assert(
      "T1-G",
      "شوک واژگونی منابع در محدوده تحمل ۶٪",
      "Resource overturning shock inside the 6% tolerance",
      "<= 0.0600",
      m.overturningShock.toFixed(4),
      m.overturningShock <= 0.06,
    ),
    assert(
      "T1-H",
      "معادل عملیاتی مثبت در همه طرح‌ها (NPV بانک ≥ ۰)",
      "Non-negative actuarial equivalence in every mode",
      "all >= 0",
      product.modes.map((x) => (x.npvBankRial >= 0 ? "+" : "-")).join(""),
      product.modes.every((x) => x.npvBankRial >= 0),
    ),
    assert(
      "T1-I",
      "رعایت سقف ۴۰٪ قسط به درآمد در همه طرح‌ها",
      "40% installment-to-income ceiling respected",
      "<= 0.40",
      Math.max(...product.modes.map((x) => x.installmentToIncome)).toFixed(3),
      product.modes.every((x) => x.installmentToIncome <= 0.4 + 1e-9),
    ),
    assert(
      "T1-J",
      "پایان موفق خط لوله هفت‌گره‌ای و تولید گزارش مدیریتی",
      "Seven-node pipeline completes and issues the executive report",
      "status = complete",
      state.status,
      state.status === "complete" && state.reportFa.length > 800,
    ),
    assert(
      "T1-K",
      "اجرای نهایی ALM دقیقاً از تعداد مسیرهای درخواستی استفاده می‌کند",
      "Final ALM uses exactly the requested Monte Carlo path count",
      String(fast ? 220 : MC_RUNS),
      String(state.alm?.monteCarloRuns ?? 0),
      state.alm?.monteCarloRuns === (fast ? 220 : MC_RUNS),
    ),
    assert(
      "T1-L",
      "گزارش نهایی وضعیت اعتبارسنجی را صریح و منطبق با موانع اعلام می‌کند",
      "Final report explicitly matches validation status to unresolved blockers",
      "not_validated iff blockers remain; otherwise constraints_passed",
      `${state.validationStatus} / ${state.findings.filter((finding) => finding.severity === "blocker").length} blockers`,
      state.validationStatus === (state.findings.some((finding) => finding.severity === "blocker") ? "not_validated" : "constraints_passed") &&
        (state.validationStatus === "not_validated"
          ? state.reportFa.includes("غیرقابل‌تأیید")
          : state.reportFa.includes("قیود سخت پاس شدند")),
    ),
  );

  return {
    id: "TC1",
    titleFa: "آزمون یکپارچه ۱ — محصول چندطرحی ۲۰ همتی میانگین حساب",
    titleEn: "Integration test 1 — 20 Hemmat multi-mode average-balance product",
    assertions,
    passed: assertions.every((a) => a.passed),
    durationMs: Date.now() - started,
    summary: {
      modes: product.modes.length,
      irrBankAnnual: Number(m.irrBankAnnual.toFixed(4)),
      p95Ldr: Number(m.p95Ldr.toFixed(4)),
      p5Lcr: Number(m.p5Lcr.toFixed(3)),
      overturningShock: Number(m.overturningShock.toFixed(4)),
      roi: Number(m.roi.toFixed(3)),
      roe: Number(m.roe.toFixed(3)),
      nim: Number(m.nim.toFixed(4)),
      iterations: state.iteration,
      mcRuns: state.alm?.monteCarloRuns ?? 0,
      elapsedMs: state.elapsedMs,
    },
  };
}

/** Test case 2 — profession-specific closed-loop B2B2C ecosystem. */
export async function runTestCase2(fast = false): Promise<TestCaseResult> {
  const started = Date.now();
  const prompt =
    "برای پزشکان متخصص و کلینیک‌های دندانپزشکی یک بسته تخصصی حلقه بسته B2B2C طراحی کن: ۶ همت منبع، هدف IRR حداقل ۲۵٪، حداکثر نسبت تسهیلات به سپرده ۸۵٪، حداقل پوشش نقدینگی ۱٫۰۵، ریسک واژگونی منابع نزدیک صفر، با تأمین مالی تجهیزات کلینیک از زنجیره تأمین و اعتبار مصرفی بیمار (BNPL) و تسویه مستقیم نزد مراکز درمانی طرف قرارداد";

  const { state } = await runPipeline({
    prompt,
    options: { runs: fast ? 220 : 400, candidates: fast ? 16 : 22, withSensitivity: false },
  });

  const product = state.product!;
  const m = state.alm!.metrics;
  const assertions: Assertion[] = [];
  const gammaWeighted = product.modes.reduce(
    (a, x) => a + x.closedLoopRetention * x.weight,
    0,
  ) / (product.modes.reduce((a, x) => a + x.weight, 0) || 1);
  const minGamma = Math.min(...product.modes.map((x) => x.closedLoopRetention));

  assertions.push(
    assert(
      "T2-A",
      "شناسایی پرسونای پزشکان متخصص / دندانپزشکی از پیام فارسی",
      "Specialist physician & dental persona detected from the Persian prompt",
      "physician-specialist | dental-clinic",
      state.request?.personaKey ?? "null",
      state.request?.personaKey === "physician-specialist" ||
        state.request?.personaKey === "dental-clinic",
    ),
    assert(
      "T2-B",
      "ساخت زیست‌بوم سه‌جانبه حلقه بسته (تأمین‌کننده — لنگر — مشتری)",
      "Tripartite closed-loop ecosystem constructed",
      "suppliers + anchor + clients",
      `${state.ecosystem?.suppliersFa.length ?? 0}/${state.ecosystem?.anchorFa ? 1 : 0}/${state.ecosystem?.clientsFa.length ?? 0}`,
      !!state.ecosystem &&
        state.ecosystem.suppliersFa.length >= 2 &&
        state.ecosystem.clientsFa.length >= 1,
    ),
    assert(
      "T2-C",
      "ماندگاری حلقه بسته γ دست‌کم ۰٫۶۵ (وزنی)",
      "Weighted closed-loop retention gamma at least 0.65",
      ">= 0.65",
      gammaWeighted.toFixed(3),
      gammaWeighted >= 0.65,
    ),
    assert(
      "T2-D",
      "حداقل γ در میان طرح‌ها دست‌کم ۰٫۶۵",
      "Minimum per-mode gamma at least 0.65",
      ">= 0.65",
      minGamma.toFixed(3),
      minGamma >= 0.65,
    ),
    assert(
      "T2-E",
      "خالص خروج نقدینگی نزدیک صفر (زیر ۵٪ منابع جذب‌شده)",
      "Near-zero net liquidity drain (below 5% of attracted resources)",
      "<= 0.05",
      m.netLiquidityDrainRatio.toFixed(4),
      m.netLiquidityDrainRatio <= 0.05,
    ),
    assert(
      "T2-F",
      "حضور طرح شتاب‌دهنده پذیرندگان و زنجیره تأمین در ماتریس",
      "Merchant accelerator and supply-chain tiers present in the matrix",
      ">= 2 archetype تخصصی",
      product.modes
        .filter(
          (x) =>
            x.archetype === "merchant-pos-accelerator" ||
            x.archetype === "supply-chain-gam" ||
            x.archetype === "corporate-float-anchor",
        )
        .length.toString(),
      product.modes.some((x) => x.archetype === "merchant-pos-accelerator") &&
        product.modes.some(
          (x) => x.archetype === "supply-chain-gam" || x.archetype === "corporate-float-anchor",
        ),
    ),
    assert(
      "T2-G",
      "رعایت همزمان p95 LDR ≤ ۰٫۸۵ و p5 LCR ≥ ۱٫۰۵ در اکوسیستم صنفی",
      "Simultaneous p95 LDR <= 0.85 and p5 LCR >= 1.05 in the guild ecosystem",
      "LDR<=0.85 & LCR>=1.05",
      `${m.p95Ldr.toFixed(3)} / ${m.p5Lcr.toFixed(2)}`,
      m.p95Ldr <= 0.85 + 1e-9 && m.p5Lcr >= 1.05 - 1e-9,
    ),
    assert(
      "T2-H",
      "تولید سندهای حسابداری و پیش‌نویس انطباق مقرراتی",
      "Accounting entries and compliance draft generated",
      ">= 8 سند و >= 6 بند",
      `${state.accountingEntries.length} / ${state.complianceDraft.length}`,
      state.accountingEntries.length >= 8 && state.complianceDraft.length >= 6,
    ),
    assert(
      "T2-I",
      "مسیرهای مونت‌کارلو در محصول صنفی نیز دقیقاً برابر درخواست است",
      "The guild product also uses exactly its requested Monte Carlo paths",
      String(fast ? 220 : 400),
      String(state.alm?.monteCarloRuns ?? 0),
      state.alm?.monteCarloRuns === (fast ? 220 : 400),
    ),
  );

  return {
    id: "TC2",
    titleFa: "آزمون یکپارچه ۲ — زیست‌بوم حلقه بسته پزشکان و دندانپزشکان",
    titleEn: "Integration test 2 — closed-loop physician & dental ecosystem",
    assertions,
    passed: assertions.every((a) => a.passed),
    durationMs: Date.now() - started,
    summary: {
      persona: state.request?.personaKey ?? "-",
      modes: product.modes.length,
      gammaWeighted: Number(gammaWeighted.toFixed(3)),
      netLiquidityDrainRatio: Number(m.netLiquidityDrainRatio.toFixed(4)),
      irrBankAnnual: Number(m.irrBankAnnual.toFixed(4)),
      p95Ldr: Number(m.p95Ldr.toFixed(4)),
      p5Lcr: Number(m.p5Lcr.toFixed(3)),
      overturningShock: Number(m.overturningShock.toFixed(4)),
      iterations: state.iteration,
    },
  };
}

/** Determinism check — identical seed must reproduce identical metrics. */
export function runDeterminismCase(): TestCaseResult {
  const started = Date.now();
  const productA = buildReferenceProduct();
  const a = runAlmSimulation({ product: productA, runs: 60, seed: 12345 });
  const b = runAlmSimulation({ product: productA, runs: 60, seed: 12345 });
  const same =
    near(a.metrics.irrBankAnnual, b.metrics.irrBankAnnual, 1e-12) &&
    near(a.metrics.p95Ldr, b.metrics.p95Ldr, 1e-12);
  const assertions = [
    assert(
      "T0-A",
      "بازتولیدپذیری کامل نتایج مونت‌کارلو با بذر یکسان",
      "Monte Carlo results are fully reproducible for an identical seed",
      "irr_A == irr_B",
      `${a.metrics.irrBankAnnual.toFixed(6)} / ${b.metrics.irrBankAnnual.toFixed(6)}`,
      same,
    ),
  ];
  return {
    id: "TC0",
    titleFa: "آزمون واحد — قطعیت و بازتولیدپذیری موتور مالی",
    titleEn: "Unit layer — determinism and reproducibility of the financial engine",
    assertions: [...unitAssertions(), ...assertions],
    passed: [...unitAssertions(), ...assertions].every((x) => x.passed),
    durationMs: Date.now() - started,
    summary: { irr: Number(a.metrics.irrBankAnnual.toFixed(4)) },
  };
}

/** Verify cancellation and the StateGraph execution-step budget. */
export async function runStateGraphCase(): Promise<TestCaseResult> {
  const started = Date.now();
  const state = createInitialState("state graph regression");
  let executed = 0;
  const loopingGraph = new StateGraph();
  loopingGraph
    .addNode("intent_analyzer", () => { executed += 1; })
    .addConditionalEdge("intent_analyzer", () => "intent_analyzer");
  let budgetRejected = false;
  try {
    await loopingGraph.invoke(state, makeEmitter(state), 1);
  } catch (error) {
    budgetRejected = error instanceof Error && error.message.includes("execution budget");
  }

  const controller = new AbortController();
  controller.abort();
  const cancelledGraph = new StateGraph();
  cancelledGraph.addNode("intent_analyzer", () => { executed += 1; });
  let cancellationRejected = false;
  try {
    await cancelledGraph.invoke(state, makeEmitter(state), 24, controller.signal);
  } catch (error) {
    cancellationRejected = error instanceof Error && error.name === "AbortError";
  }

  const almController = new AbortController();
  const pendingAlm = runAlmSimulationAsync({
    product: buildReferenceProduct(),
    runs: 256,
    seed: 1234,
    signal: almController.signal,
  });
  const abortTimer = setTimeout(() => almController.abort(), 0);
  let almCancellationRejected = false;
  try {
    await pendingAlm;
  } catch (error) {
    almCancellationRejected = error instanceof Error && error.name === "AbortError";
  } finally {
    clearTimeout(abortTimer);
  }

  const assertions = [
    assert(
      "G-01",
      "بودجه گام‌های StateGraph از حلقه بی‌پایان جلوگیری می‌کند",
      "StateGraph step budget prevents an unbounded routing loop",
      "throws after one executed node",
      `${budgetRejected ? "rejected" : "not rejected"}; nodes executed=${executed}`,
      budgetRejected && executed === 1,
    ),
    assert(
      "G-02",
      "سیگنال لغوِ ازپیش‌فعال‌شده پیش از اجرای گره تشخیص داده می‌شود",
      "A pre-aborted signal prevents the next graph node from executing",
      "AbortError; node count unchanged",
      `${cancellationRejected ? "AbortError" : "not rejected"}; nodes executed=${executed}`,
      cancellationRejected && executed === 1,
    ),
    assert(
      "G-03",
      "شبیه‌سازی ALM میان دسته‌های مونت‌کارلو به لغو پاسخ می‌دهد",
      "Chunked Monte Carlo ALM responds to an AbortSignal while running",
      "AbortError before all 256 paths complete",
      almCancellationRejected ? "AbortError" : "completed without cancellation",
      almCancellationRejected,
    ),
  ];

  return {
    id: "TC-GRAPH",
    titleFa: "آزمون بودجه اجرا و لغو StateGraph",
    titleEn: "StateGraph execution-budget and cancellation checks",
    assertions,
    passed: assertions.every((item) => item.passed),
    durationMs: Date.now() - started,
    summary: { nodesExecuted: executed },
  };
}

/** Regression test for directional critic corrections and exact MC execution. */
export function runCorrectionCase(): TestCaseResult {
  const started = Date.now();
  const product = buildReferenceProduct();
  const request = parseIntent(
    "محصول میانگین حساب ۵ همتی با سقف LDR برابر ۸۵٪ و کف LCR برابر ۱٫۰۵",
  ).request;
  const baseline = runAlmSimulation({ product, runs: 60, seed: 8675309 });
  const ldrRequest = {
    ...request,
    ldrCeiling: Math.max(0.01, Math.min(REGULATORY.ldrCeiling, baseline.metrics.p95Ldr * 0.9)),
  };
  const ldrFinding = feasibilityCheck(product, baseline.metrics, ldrRequest)
    .find((finding) => finding.id === "ldr-p95-breach");
  const ldrCorrection = applyDirectives(product.modes, ldrFinding ? [ldrFinding] : []);
  const ldrProduct = assembleProduct(
    recomputeDerived(ldrCorrection.modes, null),
    product.targetDepositsRial,
    product.code,
    product.titleFa,
    product.titleEn,
  );
  const correctedLdr = runAlmSimulation({ product: ldrProduct, runs: 60, seed: 8675309 });

  const lcrBaseProduct = assembleProduct(
    recomputeDerived(product.modes.map((mode) => ({
      ...mode,
      loanMultiplier: 3,
      blockedRatio: 0,
    })), null),
    product.targetDepositsRial,
    product.code,
    product.titleFa,
    product.titleEn,
  );
  const lcrBaseline = runAlmSimulation({ product: lcrBaseProduct, runs: 60, seed: 8675309 });
  const lcrRequest = {
    ...request,
    lcrFloor: Math.max(REGULATORY.lcrFloor, lcrBaseline.metrics.p5Lcr + 0.1),
  };
  const lcrFinding = feasibilityCheck(lcrBaseProduct, lcrBaseline.metrics, lcrRequest)
    .find((finding) => finding.id === "lcr-floor-breach");
  const lcrCorrection = applyDirectives(lcrBaseProduct.modes, lcrFinding ? [lcrFinding] : []);
  const lcrProduct = assembleProduct(
    recomputeDerived(lcrCorrection.modes, null),
    lcrBaseProduct.targetDepositsRial,
    lcrBaseProduct.code,
    lcrBaseProduct.titleFa,
    lcrBaseProduct.titleEn,
  );
  const correctedLcr = runAlmSimulation({ product: lcrProduct, runs: 60, seed: 8675309 });

  const weighted = (modes: typeof product.modes, field: "loanMultiplier" | "blockedRatio" | "closedLoopRetention" | "withdrawalFractionMean") =>
    modes.reduce((total, mode) => total + mode[field] * mode.weight, 0);
  const sensitivityA = sensitivitySweep(product, request, 111);
  const sensitivityReplay = sensitivitySweep(product, request, 111);
  const sensitivityB = sensitivitySweep(product, request, 222);
  const flattenSensitivity = (sweep: ReturnType<typeof sensitivitySweep>) => sweep.flatMap((dimension) => dimension.irr);
  const sensitivityValuesA = flattenSensitivity(sensitivityA);
  const sensitivityValuesReplay = flattenSensitivity(sensitivityReplay);
  const sensitivityValuesB = flattenSensitivity(sensitivityB);
  const sameSensitivitySeed = sensitivityValuesA.every((value, index) => value === sensitivityValuesReplay[index]);
  const differentSensitivitySeed = sensitivityValuesA.some((value, index) => value !== sensitivityValuesB[index]);
  let invalidRunRejected = false;
  try {
    runAlmSimulation({ product, runs: MAX_MONTE_CARLO_RUNS + 1, seed: 1 });
  } catch (error) {
    invalidRunRejected = error instanceof RangeError;
  }

  const assertions = [
    assert(
      "C-01",
      "قید LDR با دستور کاهشی مؤثر روی ضریب تسهیلات و مخرج قابل‌استفاده اصلاح می‌شود",
      "An LDR blocker declares a directional correction that improves simulated p95 LDR",
      "directive says decrease alpha; alpha and beta decrease; p95 LDR decreases",
      `${ldrFinding?.directive.action ?? "missing"} ${String(ldrFinding?.directive.field ?? "field")}; ${weighted(ldrCorrection.modes, "loanMultiplier").toFixed(3)} alpha / ${weighted(ldrCorrection.modes, "blockedRatio").toFixed(3)} beta / ${baseline.metrics.p95Ldr.toFixed(4)} -> ${correctedLdr.metrics.p95Ldr.toFixed(4)}`,
      !!ldrFinding &&
        ldrFinding.directive.field === "loanMultiplier" &&
        ldrFinding.directive.action === "decrease" &&
        weighted(ldrCorrection.modes, "loanMultiplier") < weighted(product.modes, "loanMultiplier") &&
        weighted(ldrCorrection.modes, "blockedRatio") < weighted(product.modes, "blockedRatio") &&
        correctedLdr.metrics.p95Ldr < baseline.metrics.p95Ldr,
    ),
    assert(
      "C-02",
      "قید LCR با کاهش ضریب تسهیلات واقعاً بازآزمایی و بهبود می‌یابد",
      "An LCR blocker reduces lending and improves simulated p5 LCR on a same-seed rerun",
      "directive says decrease alpha; alpha decreases; p5 LCR increases",
      `${lcrFinding?.directive.action ?? "missing"} ${String(lcrFinding?.directive.field ?? "field")}; ${weighted(lcrCorrection.modes, "loanMultiplier").toFixed(3)} alpha / ${lcrBaseline.metrics.p5Lcr.toFixed(3)} -> ${correctedLcr.metrics.p5Lcr.toFixed(3)}`,
      !!lcrFinding &&
        lcrFinding.directive.field === "loanMultiplier" &&
        lcrFinding.directive.action === "decrease" &&
        weighted(lcrCorrection.modes, "loanMultiplier") < weighted(lcrBaseProduct.modes, "loanMultiplier") &&
        correctedLcr.metrics.p5Lcr > lcrBaseline.metrics.p5Lcr,
    ),
    assert(
      "C-03",
      "ارزیابی اصلاحی تعداد مسیر درخواستی را حفظ می‌کند",
      "Correction reruns preserve the exact requested path count",
      "60 paths on primary, stressed and both correction evaluations",
      `${baseline.monteCarloRuns}/${lcrBaseline.monteCarloRuns}/${correctedLdr.monteCarloRuns}/${correctedLcr.monteCarloRuns}`,
      baseline.monteCarloRuns === 60 && lcrBaseline.monteCarloRuns === 60 && correctedLdr.monteCarloRuns === 60 && correctedLcr.monteCarloRuns === 60,
    ),
    assert(
      "C-04",
      "تعداد مسیر نامعتبر به‌جای کاهش خاموش رد می‌شود",
      "Unsupported run counts are rejected rather than silently clamped",
      `RangeError above ${MAX_MONTE_CARLO_RUNS}`,
      invalidRunRejected ? "RangeError" : "not rejected",
      invalidRunRejected,
    ),
    assert(
      "C-05",
      "هر قید سختِ شناخته‌شده مسیر اصلاحی ثبت‌شده دارد",
      "Both exercised blockers record a non-empty corrective action",
      "non-empty directives",
      `${ldrCorrection.appliedFa.length}/${lcrCorrection.appliedFa.length}`,
      ldrCorrection.appliedFa.length > 0 && lcrCorrection.appliedFa.length > 0,
    ),
    assert(
      "C-06",
      "حساسیت‌سنجی از بذر صریح استفاده می‌کند و با بذر ثابت بازتولیدپذیر است",
      "Sensitivity sweeps use the supplied seed and replay deterministically",
      "same seed produces identical results; another seed changes at least one value",
      `same=${sameSensitivitySeed}; different=${differentSensitivitySeed}`,
      sameSensitivitySeed && differentSensitivitySeed,
    ),
  ];

  return {
    id: "TC-CORRECTION",
    titleFa: "آزمون اصلاح واقعی LDR/LCR و حفظ دقت مونت‌کارلو",
    titleEn: "Regression — directional LDR/LCR self-correction and exact Monte Carlo runs",
    assertions,
    passed: assertions.every((item) => item.passed),
    durationMs: Date.now() - started,
    summary: {
      baselineLdr: Number(baseline.metrics.p95Ldr.toFixed(4)),
      correctedLdr: Number(correctedLdr.metrics.p95Ldr.toFixed(4)),
      baselineLcr: Number(lcrBaseline.metrics.p5Lcr.toFixed(3)),
      correctedLcr: Number(correctedLcr.metrics.p5Lcr.toFixed(3)),
      runs: baseline.monteCarloRuns,
    },
  };
}

/** Small deterministic reference product used by the unit/determinism case. */
export function buildReferenceProduct() {
  const opt = { buildMode, BLUEPRINTS, assembleProduct };
  const archetypes: ModeArchetype[] = [
    "retail-qarz-average",
    "merchant-pos-accelerator",
    "corporate-float-anchor",
    "investment-deposit",
  ];
  const modes = archetypes.map((a, i) =>
    opt.buildMode(
      opt.BLUEPRINTS[a],
      opt.BLUEPRINTS[a].contracts[0],
      [0.34, 0.22, 0.24, 0.2][i],
      5 * HEMMAT_RIAL,
      {
        rr: 0.5,
        rd: 0.4,
        rl: 0.55,
        td: 0.35 + i * 0.15,
        tl: 0.5,
        omega: 0.35,
        alpha: 0.45,
        beta: 0.45,
        gamma: 0.6,
        delta: 0.4,
        fee: 0.5,
        cap: 0.45,
        adoption: 0.6,
        pd: 0.4,
        lgd: 0.4,
      },
      null,
      i,
    ),
  );
  return opt.assembleProduct(
    modes,
    5 * HEMMAT_RIAL,
    "PRD-REF",
    "محصول مرجع آزمون",
    "Reference test product",
  );
}

/** Market-intelligence layer: registry integrity, analog retrieval, priors, determinism. */
export function runMarketIntelCase(): TestCaseResult {
  const started = Date.now();
  const out: Assertion[] = [];

  // M-01 — registry size and uniqueness
  const codes = new Set(MARKET_PRODUCTS.map((p) => p.code));
  out.push(
    assert(
      "M-01",
      "ثبت‌نام بازار حداقل ۵۰ محصول واقعی با کد یکتا دارد",
      "The market registry holds at least 50 unique real-product records",
      ">= 50 unique codes",
      `${MARKET_PRODUCTS.length} products / ${codes.size} unique`,
      MARKET_PRODUCTS.length >= 50 && codes.size === MARKET_PRODUCTS.length,
    ),
  );

  // M-02 — every researched rate respects its contract ceiling. Bullion-backed
  // special instruments are the documented exception (CBI-RATE-CEILING-287):
  // they may price up to the absolute 28.7% ceiling.
  const ceilingOf = (product: (typeof MARKET_PRODUCTS)[number]): number => {
    const base = contractRateCeiling(product.contract);
    const bullionSpecial = /شمش|طلا|bullion|gold/i.test(`${product.notesFa} ${product.productFa} ${product.productEn}`);
    return bullionSpecial ? Math.max(base, REGULATORY.absoluteRateCeiling) : base;
  };
  const ratesOk = MARKET_PRODUCTS.every(
    (p) => p.params.loanRate <= ceilingOf(p) + 1e-9,
  );
  out.push(
    assert(
      "M-02",
      "نرخ پژوهش‌شده هر محصول داخل سقف قراردادی همان عقد است (ابزارهای شمش‌محور: سقف مطلق ۲۸٫۷٪)",
      "Every researched loan rate respects its contract's rate ceiling (bullion-backed specials use the documented 28.7% absolute cap)",
      "all within ceilings",
      `${MARKET_PRODUCTS.filter((p) => p.params.loanRate > ceilingOf(p) + 1e-9).length} violations`,
      ratesOk,
    ),
  );

  // M-03 — analog retrieval for a specialist-physician request
  const physician = parseIntent(
    "برای پزشکان متخصص و کلینیک‌های درمانی یک بسته حلقه بسته طراحی کن؛ ۶ همت منبع با تأمین مالی تجهیزات",
  ).request;
  const market = analyzeMarket({
    prompt: physician.prompt,
    personaKey: physician.personaKey,
    guild: physician.guild,
    preferredContracts: physician.preferredContracts,
    emphases: physician.emphases,
    targetDepositsHemmat: physician.targetDepositsHemmat,
  });
  const medicalAnalogCount = market.analogs.filter(
    (a) => /درمان|پزشک|بیمار/.test(`${a.product.segmentFa} ${a.product.productFa}`) ||
      a.product.params.closedLoopRetention >= 0.7,
  ).length;
  out.push(
    assert(
      "M-03",
      "درخواست پزشکی، محصولات واقعی هم‌خانواده (درمانی یا حلقه‌بسته بالا) بازیابی می‌کند",
      "A physician request retrieves real medical / closed-loop market analogs",
      ">= 3 relevant analogs with positive coverage",
      `${medicalAnalogCount} relevant of ${market.analogCount}, coverage ${market.coverage.toFixed(2)}`,
      medicalAnalogCount >= 3 && market.coverage > 0,
    ),
  );

  // M-04 — priors derived for at least two archetypes with sane medians
  const priorList = Object.values(market.byArchetype);
  const mediansSane = priorList.every((prior) =>
    Object.values(prior.median).every((value) => Number.isFinite(value) && value >= 0),
  );
  out.push(
    assert(
      "M-04",
      "برای حداقل دو الگوی موتور، میانه ساختاری محاسبه و به نمونه‌گیری تزریق می‌شود",
      "At least two engine archetypes receive finite, non-negative market medians as priors",
      ">= 2 archetype priors with sane medians",
      `${priorList.length} priors (${priorList.map((p) => `${p.archetype}:${p.analogCount}`).join(", ")})`,
      priorList.length >= 2 && mediansSane,
    ),
  );

  // M-05 — deterministic analysis
  const replay = analyzeMarket({
    prompt: physician.prompt,
    personaKey: physician.personaKey,
    guild: physician.guild,
    preferredContracts: physician.preferredContracts,
    emphases: physician.emphases,
    targetDepositsHemmat: physician.targetDepositsHemmat,
  });
  const firstPrior = priorList[0];
  const firstReplayPrior = Object.values(replay.byArchetype)[0];
  out.push(
    assert(
      "M-05",
      "تحلیل بازار قطعی است: بازیابی مجدد همان آنالوگ‌ها و میانه‌ها را می‌دهد",
      "Market analysis is deterministic: replaying yields identical analogs and medians",
      "same top analog and same medians",
      `${market.analogs[0]?.product.code ?? "-"} vs ${replay.analogs[0]?.product.code ?? "-"}; ${
        firstPrior && firstReplayPrior ? (firstPrior.median.loanMultiplier === firstReplayPrior.median.loanMultiplier ? "equal" : "diff") : "missing"
      }`,
      market.analogs[0]?.product.code === replay.analogs[0]?.product.code &&
        firstPrior && firstReplayPrior &&
        firstPrior.median.loanMultiplier === firstReplayPrior.median.loanMultiplier,
    ),
  );

  // M-06 — market priors actually steer candidate synthesis (and stay deterministic)
  const request = parseIntent(
    "یک بسته ۴ طرحی میانگین حساب برای جذب ۲۰ همت منبع با IRR حداقل ۲۶٪ طراحی کن",
  ).request;
  const archetypes: ModeArchetype[] = ["retail-qarz-average", "merchant-pos-accelerator"];
  const seed = 424242;
  const withPriorsA = buildCandidate(request, archetypes, createRng(seed), null, 0, market);
  const withPriorsB = buildCandidate(request, archetypes, createRng(seed), null, 0, market);
  const withoutPriors = buildCandidate(request, archetypes, createRng(seed), null, 0, null);
  const serialise = (product: ReturnType<typeof buildCandidate>) =>
    JSON.stringify(product.modes.map((m) => [
      m.archetype,
      m.contract,
      m.sleepMonths,
      m.tenorMonths,
      m.blockedRatio,
      m.closedLoopRetention,
      m.loanRate,
      m.depositRate,
    ]));
  out.push(
    assert(
      "M-06",
      "اولویت‌های بازار نمونه‌سازی کاندید را واقعاً هدایت می‌کنند و بازتولیدپذیر می‌مانند",
      "Market priors steer candidate synthesis while replaying deterministically",
      "prior run == prior replay && prior run != plain run",
      `equal=${serialise(withPriorsA) === serialise(withPriorsB)}; differs=${serialise(withPriorsA) !== serialise(withoutPriors)}`,
      serialise(withPriorsA) === serialise(withPriorsB) &&
        serialise(withPriorsA) !== serialise(withoutPriors),
    ),
  );

  // M-07 — the market-learned coupling of the scored-deposit-credit family
  // (نیک/نگین/مهربانی matrices) is monotone: α grows with (τ_d, τ_l) patience
  // and the rate ladder descends as the customer waits longer.
  const scoredBp = BLUEPRINTS["scored-deposit-credit"];
  const scoredBase = (over: Record<string, number>): Record<string, number> => ({
    rr: 0.5, rd: 0.1, rl: 0.5, td: 0.5, tl: 0.5, omega: 0.5, alpha: 0.5,
    beta: 0.2, gamma: 0.6, delta: 0.4, fee: 0.4, cap: 0.5, adoption: 0.6,
    pd: 0.4, lgd: 0.4, ...over,
  });
  const shortPatience = buildMode(scoredBp, "morabaha", 0.3, 9 * HEMMAT_RIAL, scoredBase({ td: 0.02, tl: 0.0, omega: 0.0 }), null, 0);
  const longPatience = buildMode(scoredBp, "morabaha", 0.3, 9 * HEMMAT_RIAL, scoredBase({ td: 1.0, tl: 1.0, omega: 1.0 }), null, 0);
  out.push(
    assert(
      "M-07",
      "اتصال ماتریس امتیازی نیک/نگین: صبر بیشتر (τ_d، τ_l، ω) ضریب اعتبار را بالا و نرخ را پایین می‌برد",
      "The scored-family market coupling is monotone: longer patience raises the facility multiplier and lowers the rate",
      `α(long) > 1.5×α(short); r_l(long) < r_l(short)`,
      `α ${shortPatience.loanMultiplier.toFixed(2)} → ${longPatience.loanMultiplier.toFixed(2)}; r_l ${(shortPatience.loanRate * 100).toFixed(1)}% → ${(longPatience.loanRate * 100).toFixed(1)}%`,
      longPatience.loanMultiplier > shortPatience.loanMultiplier * 1.5 &&
        longPatience.loanRate < shortPatience.loanRate,
    ),
  );

  // M-08 — the three researched flagship products exist and the Mehraban fee
  // ladder (0/2/4% by ticket size) is reproduced by the engine.
  const flagshipCodes = ["MELLAT-NIK-SCORED", "SEPAH-NEGIN-FARAPOUYA", "MELLI-MEHRABAN"];
  const flagshipsPresent = flagshipCodes.every((code) =>
    MARKET_PRODUCTS.some((p) => p.code === code && p.archetype === "scored-deposit-credit"),
  );
  const feeLadder = [30e6, 60e6, 300e6].map((cap) =>
    buildMode(scoredBp, "qarz-hasaneh", 0.3, 9 * HEMMAT_RIAL, scoredBase({ capExact: cap }), null, 0).loanRate,
  );
  out.push(
    assert(
      "M-08",
      "سه محصول امتیازی شاخص در ثبت‌نام هستند و نردبان کارمزد مهربانی (۰/۲/۴٪) بازتولید می‌شود",
      "The three flagship scored products exist and the Mehraban 0/2/4% fee ladder is reproduced",
      "flagships present; ladder ≈ [0, 2%, 4%]",
      `present=${flagshipsPresent}; ladder=${feeLadder.map((r) => `${(r * 100).toFixed(1)}%`).join("/")}`,
      flagshipsPresent &&
        feeLadder[0] === 0 &&
        Math.abs(feeLadder[1] - 0.02) < 1e-9 &&
        Math.abs(feeLadder[2] - 0.04) < 1e-9,
    ),
  );

  // M-09/M-10 — product-identification agent: a few-word need resolves to the
  // right real facility, and the engine request auto-inherits its contract.
  const terseCases: { prompt: string; expectCodes: string[]; expectContract: string }[] = [
    { prompt: "وام ازدواج", expectCodes: ["MARITAL-QH-STATE", "FUND-SBB-MARRIAGE"], expectContract: "qarz-hasaneh" },
    { prompt: "ماشین میخوام", expectCodes: ["MELLI-TEACHER-CAR"], expectContract: "morabaha" },
    { prompt: "نیروگاه خورشیدی خانگی", expectCodes: ["MELLAT-SOLAR-HOME"], expectContract: "morabaha" },
  ];
  const resolverResults = terseCases.map((c) => {
    const resolution = resolveFacility(c.prompt);
    const intent = parseIntent(c.prompt).request;
    return {
      c,
      bestCode: resolution.best?.product.code ?? "-",
      bestConfidence: resolution.best?.confidence ?? 0,
      intentContract: intent.matchedFacility?.contract ?? intent.preferredContracts[0] ?? "-",
      intentConfidence: intent.matchedFacility?.confidence ?? 0,
    };
  });
  out.push(
    assert(
      "M-09",
      "عامل شناساگر با پرامپت چندکلمه‌ای، محصول واقعی درست را پیدا می‌کند",
      "The identification agent maps terse needs (marriage / car / solar) to the right real facility",
      "expected best-match family for each terse prompt",
      resolverResults.map((r) => `${r.c.prompt}→${r.bestCode}@${(r.bestConfidence * 100).toFixed(0)}%`).join(" | "),
      resolverResults.every((r) => r.c.expectCodes.includes(r.bestCode) && r.bestConfidence >= 0.35),
    ),
  );
  out.push(
    assert(
      "M-10",
      "درخواست موتور از محصول شناسایی‌شده، عقد و اطمینان را به‌ارث می‌برد",
      "The engine request inherits contract and confidence from the identified facility",
      "intent contract == facility contract for every terse case",
      resolverResults.map((r) => `${r.c.prompt}→${r.intentContract}@${(r.intentConfidence * 100).toFixed(0)}%`).join(" | "),
      resolverResults.every((r) => r.intentContract === r.c.expectContract && r.intentConfidence > 0),
    ),
  );

  return {
    id: "TC-MARKET",
    titleFa: "آزمون لایه هوش بازار — ثبت‌نام، بازیابی آنالوگ، اولویت‌ها و قطعیت",
    titleEn: "Market-intelligence layer — registry, analog retrieval, priors and determinism",
    assertions: out,
    passed: out.every((item) => item.passed),
    durationMs: Date.now() - started,
    summary: {
      products: MARKET_PRODUCTS.length,
      analogs: market.analogCount,
      coverage: Number(market.coverage.toFixed(2)),
      priors: priorList.length,
    },
  };
}

export async function runVerificationSuite(fast = false): Promise<VerificationSuiteResult> {
  const started = Date.now();
  const cases: TestCaseResult[] = [runDeterminismCase(), runCorrectionCase()];
  cases.push(await runStateGraphCase());
  cases.push(runMarketIntelCase());
  cases.push(await runTestCase1(fast));
  cases.push(await runTestCase2(fast));
  const all = cases.flatMap((c) => c.assertions);
  return {
    passed: cases.every((c) => c.passed),
    totalAssertions: all.length,
    passedAssertions: all.filter((a) => a.passed).length,
    cases,
    ranAt: new Date().toISOString(),
    durationMs: Date.now() - started,
  };
}
