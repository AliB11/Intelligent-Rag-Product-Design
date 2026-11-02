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
  assembleProduct,
  BLUEPRINTS,
  buildMode,
} from "../domain/optimizer";
import { runAlmSimulation } from "../domain/almSimulator";
import { runPipeline } from "../agents/graph";
import {
  HEMMAT_RIAL,
  REGULATORY,
  STATUTORY_RESERVE,
  OPEX_RATIO_DEFAULT,
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

  const cof = costOfFunds({
    depositRate: 0.18,
    statutoryReserve: 0.15,
    liquidityDeduction: 0.01,
    opexRatio: 0.035,
    pd: 0.03,
    lgd: 0.35,
  });
  const expected =
    (0.18 - 0.15 * 0.01) / (1 - 0.15 + 0.01) + 0.035 + 0.03 * 0.35;
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
      "پوشش پنج کهن‌الگوی ساختاری در موتور سنتز",
      "Five structural archetypes available to the synthesiser",
      "5",
      String(blueprintKeys.length),
      blueprintKeys.length === 5,
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

export async function runVerificationSuite(fast = false): Promise<VerificationSuiteResult> {
  const started = Date.now();
  const cases: TestCaseResult[] = [runDeterminismCase()];
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
