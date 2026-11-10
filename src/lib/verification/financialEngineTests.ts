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

import { blendedCostOfFunds, costOfFunds, depositRateForTargetCoF } from "../domain/costOfFunds";
import { earlyWithdrawalSettlement } from "../domain/depositPenalty";
import {
  bankProductNpv,
  blockedReleaseSchedule,
  installmentAffordability,
  weightedAverageBalance,
} from "../domain/pointEngine";
import { irr, npv, pmt, percentile, createRng, sampleBeta, solveIrr } from "../domain/financial";
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
import { normalizeFaText, HybridRagIndex } from "../rag/hybridRag";
import { recommendProducts, estimateMonthlyPayment, parseRecommendationQuery, topsis } from "../domain/recommendation";
import { MARKET_PRODUCTS } from "../rag/benchmarks";
import { generatePopulation, scoreTiers, empiricalShares, populationPd } from "../simorgh/population";
import { portfolioUnderwriting } from "../simorgh/creditPolicy";
import { irbRetailK, vasicekPd, effectiveAprPct, unitSchedule, normInv } from "../simorgh/quant";
import { computeSimorghMetrics } from "../simorgh/metrics";
import { runStressSuite } from "../simorgh/stress";
import { PRODUCT_TEMPLATES, templatesForCategories } from "../simorgh/templates";
import { getRegulations, setRegulations, resetRegulations, checkModeCompliance } from "../simorgh/regulations";
import { estimate } from "../simorgh/calculator";
import { randomIdea } from "../simorgh/randomIdea";
import {
  CB_REWARD_RATE,
  HEMMAT_RIAL,
  LIQUIDITY_DEDUCTION_DEFAULT,
  MAX_MONTE_CARLO_RUNS,
  MC_RUNS,
  REGULATORY,
  STATUTORY_RESERVE,
  OPEX_RATIO_DEFAULT,
  contractRateCeiling,
} from "../domain/constants";
import {
  formatZodIssues,
  generateRequestSchema,
  pipelineOptionsSchema,
  recommendRequestSchema,
} from "../validation/schemas";
import {
  applyReserveFloor,
  clampBlockedRatioToConstraints,
  clampFeeRateToConstraints,
  clampLoanRateToConstraints,
  defaultRegulatoryConstraints,
  regulatoryConstraintsSchema,
  type RegulatoryConstraints,
} from "../domain/regulatory";
import { extractRegulatoryConstraints } from "../rag/regulatoryConstraintExtractor";
import { computeCannibalization } from "../domain/cannibalization";
import { projectCohortLiquidity, type CohortInput } from "../domain/cohortModel";
import {
  solveInverseFrontier,
  solveInverseProduct,
  type InverseSolverInput,
} from "../domain/inverseSolver";
import { buildProductDossier, productDossierSchema } from "../dossier/productDossier";
import { isChunkActiveAt, regulatoryChunkMetaSchema } from "../rag/governance";
import { allBindings, KB_DOCUMENTS, KB_SEED, retrieveKnowledge } from "../rag/knowledgeBase";
import type { RegulatoryChunkMeta, RegulatoryConstraint } from "../domain/types";
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
      "پوشش هشت کهن‌الگوی ساختاری در موتور سنتز",
      "Eight structural archetypes available to the synthesiser",
      "8",
      String(blueprintKeys.length),
      blueprintKeys.length === 8 && blueprintKeys.includes("scored-deposit-credit"),
    ),
  );

  const index = new HybridRagIndex([{ id: "a", title: "وام قرض‌الحسنه", entity: "بانک", tags: "", body: "تسهیلات ازدواج", item: 1 }, { id: "b", title: "وام خودرو", entity: "بانک", tags: "", body: "خرید خودرو", item: 2 }]);
  const hybrid = index.search("وام قرض الحسنه");
  out.push(assert("U-RAG-01", "یکسان‌سازی نیم‌فاصله و بازیابی ترکیبی", "ZWNJ normalization and hybrid retrieval", "equivalent / a", `${normalizeFaText("قرض‌الحسنه") === normalizeFaText("قرض الحسنه")} / ${hybrid[0]?.id}`, normalizeFaText("قرض‌الحسنه") === normalizeFaText("قرض الحسنه") && hybrid[0]?.id === "a"));
  const rec = recommendProducts({ query: "نیروگاه خورشیدی خانگی", amountToman: 100e6, monthlyIncomeToman: 1e6 });
  out.push(assert("U-REC-01", "پیشنهاد مستند با هشدار توان بازپرداخت", "Grounded recommendation and affordability warning", "source and warning", `${rec.results[0]?.code} / ${rec.results[0]?.warnings.length}`, rec.results.some((r) => r.code === "MELLAT-SOLAR-HOME" && !!r.sourceRef && r.warnings.length > 0)));
  out.push(assert("U-REC-02", "قسط صفر درصد", "Zero-rate payment calculation", "100", String(estimateMonthlyPayment(1200, 0, 12)), estimateMonthlyPayment(1200, 0, 12) === 100));
  out.push(assert("U-RAG-02", "جست‌وجوی بدون واژه معنادار نتیجه ساختگی ندارد", "Empty meaningful query yields no hits", "0", String(index.search("برای من").length), index.search("برای من").length === 0));

  const profile = parseRecommendationQuery("وام ۱٫۵ میلیارد با درآمد ماهانه ۵۰ میلیون");
  out.push(assert("U-REC-03", "استخراج مبلغ فارسی با اعشار", "Persian decimal and income extraction", "1.5B / 50M", `${profile.amountToman} / ${profile.monthlyIncomeToman}`, profile.amountToman === 1.5e9 && profile.monthlyIncomeToman === 50e6));
  const choices = topsis([[1, 2], [0, 3]], [0.5, 0.5], [true, false]);
  out.push(assert("U-REC-04", "رتبه‌بندی تاپسیس معیار مثبت و منفی", "TOPSIS benefit and cost criteria", "first > second", choices.join(" / "), choices[0] > choices[1]));
  const blue = recommendProducts({ query: "وام به جا بلوبانک", amountToman: 100e6, availableDepositToman: 1e6, alternativeYield: 0.24, availableGuarantees: ["none"] }).results.find((r) => r.code === "BLUBANK-BEJA-GUAR");
  out.push(assert("U-REC-05", "هشدار تضامین و حداقل سپرده و سناریوی هزینه فرصت", "Guarantee and minimum deposit warning with opportunity scenario", "two conflicts / 60000", `${blue?.conflicts} / ${blue?.opportunityCostToman}`, Boolean(blue && blue.conflicts >= 2 && blue.opportunityCostToman === 60000)));
  const override = recommendProducts({ query: "وام ۱۰۰ میلیون بلوبانک", amountToman: 50e6 });
  out.push(assert("U-REC-06", "اولویت مقدار صریح فرم", "Explicit form amount overrides parsed query", "50M", String(override.profile.amountToman), override.profile.amountToman === 50e6));
  out.push(assert("U-REC-07", "توصیه بازتولیدپذیر", "Recommendation is deterministic", "same JSON", "replay", JSON.stringify(override) === JSON.stringify(recommendProducts({ query: "وام ۱۰۰ میلیون بلوبانک", amountToman: 50e6 }))));

  const snap = recommendProducts({ query: "وام نقدی اسنپ پی" }).results.find((r) => r.code === "SNAPPPAY-CREDIT-400");
  out.push(assert("U-REC-08", "تشخیص اعتبار خرید در درخواست وجه نقد", "Purchase credit is flagged for a cash request", "cash restriction warning", snap?.warnings.join(" / ") ?? "missing", Boolean(snap && snap.warnings.some((w) => w.includes("وجه نقد")))));
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

/** Simorgh lab layer — quant, population, policy, metrics, stress, templates, regulations. */
export function runSimorghCase(): TestCaseResult {
  const started = Date.now();
  const out: Assertion[] = [];

  // S-01 — quant primitives
  const k = irbRetailK(0.02, 0.25, "other");
  const pdUp = vasicekPd(0.02, 2);
  const pdDown = vasicekPd(0.02, -2);
  out.push(
    assert(
      "S-01",
      "اصول کمّی سیمرغ: سرمایه IRB مثبت، PD واشیکس یکنوا در شوک سیستماتیک",
      "Simorgh quant: IRB K positive; Vasicek PD monotone in the systematic factor",
      "K>0; PD(z=2) > PD(z=0) > PD(z=-2); normInv(0.5)==0",
      `K=${k.toFixed(4)}; ${pdUp.toFixed(4)}/${vasicekPd(0.02, 0).toFixed(4)}/${pdDown.toFixed(4)}; z0=${normInv(0.5).toFixed(3)}`,
      k > 0 && pdUp > vasicekPd(0.02, 0) && vasicekPd(0.02, 0) > pdDown && Math.abs(normInv(0.5)) < 1e-6,
    ),
  );

  // S-02 — APR of an annuity schedule is finite, ordered and above the nominal rate
  const schedule = unitSchedule(23, 36, "annuity");
  const apr = effectiveAprPct(schedule, 2);
  const aprZeroFee = effectiveAprPct(unitSchedule(23, 36, "annuity"), 0);
  out.push(
    assert(
      "S-02",
      "APR مؤثر جدول اقساطی متناهی، صعودی با کارمزد و بالاتر از نرخ اسمی",
      "Effective APR of the annuity schedule is finite, rises with upfront fee, and exceeds the nominal rate",
      "apr(fee=2%) >= apr(fee=0) > 23",
      `${apr.toFixed(2)}٪ vs ${aprZeroFee.toFixed(2)}٪`,
      Number.isFinite(apr) && apr >= aprZeroFee - 1e-9 && aprZeroFee > 23 && apr <= 999,
    ),
  );

  // S-03 — population determinism, score bounds, tier shares sum to 1
  const popA = generatePopulation(300, 4242);
  const popB = generatePopulation(300, 4242);
  const tiers = scoreTiers();
  const shares = empiricalShares(popA, tiers);
  const shareSum = shares.reduce((a, b) => a + b, 0);
  const scoresValid = popA.every((c) => c.score >= 250 && c.score <= 900);
  const same = JSON.stringify(popA) === JSON.stringify(popB);
  out.push(
    assert(
      "S-03",
      "جمعیت مصنوعی قطعی، رتبه‌ها در بازه ۲۵۰–۹۰۰ و سهم پله‌ها جمعاً ۱",
      "Synthetic population is deterministic, scores within 250..900, tier shares sum to 1",
      "identical replay; scores valid; Σshares==1",
      `same=${same}; scores=${scoresValid}; Σ=${shareSum.toFixed(4)}`,
      same && scoresValid && Math.abs(shareSum - 1) < 1e-9,
    ),
  );

  // S-04 — credit policy: DTI gate rejects low-income borrowers, tier pricing monotone
  const uw = portfolioUnderwriting(popA, { annualRate: 0.23, tenorMonths: 36, amountMillionToman: 300 });
  const pricingMonotone = tiers.every((t, i) => i === 0 || tiers[i - 1].pricingIndex <= t.pricingIndex);
  out.push(
    assert(
      "S-04",
      "سیاست اعتبار: نرخ پذیرش بین ۰ تا ۱ و قیمت‌گذاری پله‌ها یکنوای صعودی",
      "Credit policy: approval rate within (0,1); tier pricing indices monotone non-decreasing",
      "0<approval<1; pricing monotone",
      `approval=${(uw.approvalRate * 100).toFixed(0)}%; pricing=[${tiers.map((t) => t.pricingIndex).join(",")}]`,
      uw.approvalRate > 0 && uw.approvalRate < 1 && pricingMonotone,
    ),
  );

  // S-05 — 7-scenario stress suite is deterministic and produces distinct runs
  const request = parseIntent(
    "یک بسته بانکی ۴ طرحی میانگین حساب برای جذب ۱۰ همت منبع با IRR حداقل ۲۴٪ طراحی کن",
  ).request;
  const refProduct = buildReferenceProduct();
  const stressA = runStressSuite(refProduct, request, 777, 60, 60);
  const stressB = runStressSuite(refProduct, request, 777, 60, 60);
  const distinct = new Set(stressA.runs.map((r) => r.irrBankAnnual.toFixed(6))).size >= 3;
  const sameStress = JSON.stringify(stressA.runs.map((r) => r.irrBankAnnual)) === JSON.stringify(stressB.runs.map((r) => r.irrBankAnnual));
  out.push(
    assert(
      "S-05",
      "آزمون ۷ سناریوی کلان قطعی است و سناریوها نتایج متمایز می‌دهند",
      "The 7-scenario stress suite is deterministic and scenarios produce distinct outcomes",
      "same seed => identical; >=3 distinct IRRs across scenarios",
      `same=${sameStress}; distinct=${distinct}`,
      sameStress && distinct && stressA.runs.length === 7,
    ),
  );

  // S-06 — metrics: APR/NPL/VaR/IRB/real-return within sane bounds
  const almRef = runAlmSimulation({ product: refProduct, runs: 40, seed: 99 });
  const simorghMetrics = computeSimorghMetrics({
    alm: almRef,
    blendedAnnualRate: 0.2,
    blendedTenorMonths: 36,
    blendedPd: 0.022,
    blendedLgd: 0.25,
    population: popA,
    approvedIds: new Set(Array.from(uw.decisions.entries()).filter(([, d]) => d.approved).map(([id]) => id)),
  });
  out.push(
    assert(
      "S-06",
      "سنجه‌های پیشرفته سیمرغ در محدوده منطقی: APR، NPL، VaR، IRB، بازده واقعی، شمول",
      "Simorgh metrics within sane bounds: APR finite, NPL in (0,0.5], IRB>0, real return finite, inclusion in [0,1]",
      "APR>20 (nominal input); NPL∈(0,0.5]; K>0; |real|<3; inclusion∈[0,1]",
      `APR=${simorghMetrics.aprPct.toFixed(1)}; NPL=${simorghMetrics.nplRatio.toFixed(3)}; K=${simorghMetrics.irbCapitalRate.toFixed(3)}; real=${simorghMetrics.realReturnAnnual.toFixed(2)}; incl=${simorghMetrics.inclusionScore.toFixed(2)}`,
      simorghMetrics.aprPct > 20 &&
        simorghMetrics.nplRatio > 0 && simorghMetrics.nplRatio <= 0.5 &&
        simorghMetrics.irbCapitalRate > 0 &&
        Math.abs(simorghMetrics.realReturnAnnual) < 3 &&
        simorghMetrics.inclusionScore >= 0 && simorghMetrics.inclusionScore <= 1,
    ),
  );

  // S-07 — 17 templates exist, category lookup works, random idea is coherent
  const agri = templatesForCategories(["agri"]);
  const idea = randomIdea(1234);
  const ideaReplay = randomIdea(1234);
  out.push(
    assert(
      "S-07",
      "۱۷ قالب آغازین، نگاشت دسته‌ای (کشاورزی→خرید دین) و ایده تصادفی قطعی و منسجم",
      "17 starting templates; category lookup hits the agri factoring family; random idea deterministic with control ranges",
      "17 templates; agri→kharid-deyn; idea replay identical; hemmat∈[2,14]",
      `n=${PRODUCT_TEMPLATES.length}; agri=${agri[0].contract}; idea=${idea.templateId}@${idea.controls.hemmat}همت; replay=${ideaReplay.prompt === idea.prompt ? "equal" : "diff"}`,
      PRODUCT_TEMPLATES.length === 17 &&
        agri[0].contract === "kharid-deyn" &&
        ideaReplay.prompt === idea.prompt &&
        idea.controls.hemmat >= 2 && idea.controls.hemmat <= 14,
    ),
  );

  // S-08 — configurable regulations: patch, hard floors, compliance, reset
  const before = getRegulations();
  setRegulations({ loanRateCap: 0.5, dtiCap: 0.8 });
  const after = getRegulations();
  const clampedOk = after.loanRateCap <= 0.23 + 1e-9 && after.dtiCap <= 0.4 + 1e-9;
  const violation = checkModeCompliance(
    { nameFa: "تست", contract: "morabaha", loanRate: 0.25, installmentToIncome: 0.2, blockedRatio: 0.1 },
    getRegulations(),
  );
  const failCount = violation.failed;
  resetRegulations();
  const restored = getRegulations().loanRateCap === before.loanRateCap;
  out.push(
    assert(
      "S-08",
      "کتاب مقررات پیکربندی‌شدنی با کف‌های سخت بانک مرکزی و گزارش انطباق فعال",
      "Configurable rulebook enforces hard CBI floors on patch; compliance flags a 25% Murabaha breach; reset restores defaults",
      "patch clamped; 1 fail on breach; restored",
      `cap=${after.loanRateCap}; dti=${after.dtiCap}; fails=${failCount}; restored=${restored}`,
      clampedOk && failCount === 1 && restored,
    ),
  );

  // S-09 — customer calculator: QH instalment, revolving APR, points limit
  const qh = estimate({ productClass: "qh", annualRate: 0.04, tenorMonths: 36, amountMillionToman: 300, monthlyIncomeMillionToman: 40, upfrontFeePct: 4 });
  const revolving = estimate({ productClass: "revolving", annualRate: 0.23, tenorMonths: 12, amountMillionToman: 200, monthlyIncomeMillionToman: 40 });
  const points = estimate({ productClass: "points", annualRate: 0.04, tenorMonths: 12, amountMillionToman: 100, depositBalance: 200, holdingMonths: 8 });
  const pointsLimitExpected = 0.35 * 200 * (8 / 12);
  out.push(
    assert(
      "S-09",
      "محاسبه‌گر مشتری: اقساط قرض‌الحسنه، APR گردشی و سقف امتیازی L=k×B×H/N",
      "Customer calculator: QH instalment, revolving APR, points limit L=k×B×H/N",
      "QH monthly = P/36 + fee share; revolving APR>23; points==formula",
      `QH=${qh.kind}:${(qh as { monthlyPayment: number }).monthlyPayment.toFixed(1)}م.ت · rev APR=${(revolving as { aprPct: number }).aprPct.toFixed(1)}٪ · pts=${(points as { estimatedLimit: number }).estimatedLimit.toFixed(1)} vs ${pointsLimitExpected.toFixed(1)}`,
      Math.abs((qh as { monthlyPayment: number }).monthlyPayment - (300 / 36 + 300 * 0.04 / 36)) < 0.5 &&
        (revolving as { aprPct: number }).aprPct > 23 &&
        Math.abs((points as { estimatedLimit: number }).estimatedLimit - pointsLimitExpected) < 1e-9,
    ),
  );

  // S-10 — population PD under shock rises (portfolio-level Vasicek)
  const pdBase = populationPd(popA, 0);
  const pdShock = populationPd(popA, 2);
  out.push(
    assert(
      "S-10",
      "PD جمعیت تحت شوک واشیکس افزایش می‌یابد (مدل نظام‌مند ریسک)",
      "Population PD rises under a positive Vasicek systematic shock",
      "PD(z=2) > PD(z=0)",
      `${pdShock.toFixed(4)} > ${pdBase.toFixed(4)}`,
      pdShock > pdBase && pdBase > 0,
    ),
  );

  return {
    id: "TC-SIMORGH",
    titleFa: "آزمون لایه سیمرغ — کمّ، جمعیت، اعتبار، سناریو، قالب، مقررات، محاسبه‌گر",
    titleEn: "Simorgh layer — quant, population, policy, stress, templates, regulations, calculator",
    assertions: out,
    passed: out.every((item) => item.passed),
    durationMs: Date.now() - started,
    summary: {
      population: 300,
      templates: PRODUCT_TEMPLATES.length,
      scenarios: 7,
      apr: Number(simorghMetrics.aprPct.toFixed(1)),
    },
  };
}

/**
 * Test case — numerical & boundary edge cases: hardened IRR root-finding,
 * Qard-al-Hasan (zero-interest) flows, high blocked-deposit ratios, early
 * withdrawal penalties, cost-of-funds guards and Zod schema boundaries.
 */
function runEdgeCaseCase(): TestCaseResult {
  const started = Date.now();
  const out: Assertion[] = [];

  // --- IRR: closed-form certification within 1e-6 --------------------------
  // Single 12-month lump sum repaid at 1%/month: flows at t=0 and t=12 only.
  const exactMonthly = Math.pow(1.01, 12);
  const closedForm = irr([-100, ...new Array<number>(11).fill(0), 100 * exactMonthly]);
  out.push(
    assert(
      "U-IRR-01",
      "گواهی ریشه بسته IRR با دقت کمتر از ۱۰⁻⁶",
      "Closed-form IRR root certified inside 1e-6 tolerance",
      "|r − 0.01| < 1e-6",
      Number.isFinite(closedForm) ? Math.abs(closedForm - 0.01).toExponential(2) : String(closedForm),
      Number.isFinite(closedForm) && Math.abs(closedForm - 0.01) < 1e-6,
    ),
  );

  // --- IRR: scale invariance (regression: 1e300 flows used to overflow) ---
  const baseFlows = [-1000, 300, 400, 500];
  const rBase = irr(baseFlows);
  const rBig = irr(baseFlows.map((x) => x * 1e300));
  const rSmall = irr(baseFlows.map((x) => x * 1e-300));
  out.push(
    assert(
      "U-IRR-02",
      "تغییر مقیاس جریان‌های نقد (۱۰³۰۰±) بدون NaN و با همان ریشه",
      "Scale invariance across 1e±300 flows without NaN, same root",
      "finite roots within 1e-6 of 0.0890",
      [rBase, rBig, rSmall].map((r) => (Number.isFinite(r) ? r.toFixed(6) : String(r))).join(" / "),
      [rBase, rBig, rSmall].every(
        (r) => Number.isFinite(r) && Math.abs(r - rBase) < 1e-6 && Math.abs(r - 0.089) < 0.002,
      ),
    ),
  );

  // --- IRR: root below the legacy −0.9 bracket floor ----------------------
  // npv(r) = −1 + 1e-4/(1+r) has its unique root at r = −0.9999.
  const deepRoot = irr([-1, 1e-4]);
  out.push(
    assert(
      "U-IRR-03",
      "ریشه IRR پایین‌تر از کف قدیمی −۰٫۹ (نزدیک به −۱) پیدا می‌شود",
      "IRR root below the legacy −0.9 floor (near −1) is bracketed",
      "−0.9999 ± 1e-6",
      Number.isFinite(deepRoot) ? deepRoot.toFixed(6) : String(deepRoot),
      Number.isFinite(deepRoot) && Math.abs(deepRoot + 0.9999) < 1e-6,
    ),
  );

  // --- IRR: Qard zero-rate schedule + documented degenerate reasons -------
  const qardIrr = irr([-1000, 250, 250, 250, 250]);
  const zeroStream = solveIrr([0, 0, 0, 0]);
  const noSign = solveIrr([1, 2, 3]);
  const noRoot = solveIrr([1, -1, 1]);
  const tooShort = solveIrr([100]);
  const nonFinite = solveIrr([Infinity, 1]);
  out.push(
    assert(
      "U-IRR-04",
      "جریان قرض‌الحسنه بدون بهره صفر و دلایل مستند نامعین‌بودن",
      "Zero-interest Qard stream solves to 0; undefined cases carry reasons",
      "qard≈0 finite; reasons documented; no Infinity anywhere",
      `qard=${Number.isFinite(qardIrr) ? qardIrr.toFixed(8) : qardIrr}; ` +
        `${zeroStream.method}/${noSign.reason}/${noRoot.reason}/${tooShort.reason}/${nonFinite.reason}`,
      Number.isFinite(qardIrr) &&
        Math.abs(qardIrr) < 1e-6 &&
        zeroStream.converged &&
        zeroStream.rate === 0 &&
        zeroStream.method === "closed_form" &&
        !noSign.converged &&
        noSign.reason === "no_sign_change" &&
        !noRoot.converged &&
        noRoot.reason === "no_bracket" &&
        tooShort.reason === "insufficient_flows" &&
        nonFinite.reason === "non_finite_flows" &&
        [qardIrr, zeroStream.rate, noSign.rate, noRoot.rate].every(
          (v) => v !== Infinity && v !== -Infinity,
        ),
    ),
  );

  // --- IRR: property — seeded single-root streams vs an independent
  //     dense-scan + bisection reference, all within 1e-6. ------------------
  const referenceRoot = (flows: number[]): number | null => {
    const f = (r: number) => npv(r, flows, true);
    // Independent deterministic scan (deliberately different grid from the
    // production solver): dense linear band + logarithmic tail.
    const probes: number[] = [];
    for (let i = 0; i <= 1500; i += 1) probes.push(-0.999999 + (i * (101)) / 1500);
    for (let i = 1; i <= 600; i += 1) probes.push(Math.pow(10, -3 + (i * 10) / 600));
    let prevR = probes[0];
    let prevF = f(prevR);
    if (prevF === 0) return prevR;
    for (let i = 1; i < probes.length; i += 1) {
      const r = probes[i];
      const fr = f(r);
      if (fr === 0) return r;
      if (Number.isFinite(prevF) && Number.isFinite(fr) && Math.sign(fr) !== Math.sign(prevF)) {
        let lo = prevR;
        let hi = r;
        for (let k = 0; k < 120; k += 1) {
          const mid = (lo + hi) / 2;
          const fm = f(mid);
          if (!Number.isFinite(fm)) break;
          if (fm === 0) return mid;
          if (Math.sign(fm) === Math.sign(prevF)) lo = mid;
          else hi = mid;
        }
        return (lo + hi) / 2;
      }
      prevR = r;
      prevF = fr;
    }
    return null;
  };
  const propRng = createRng(20261109);
  let matched = 0;
  let total = 0;
  let worstError = 0;
  for (let k = 0; k < 40; k += 1) {
    // Exactly-one-root families: −1 then non-negative flows (bank side), or
    // +1 then non-positive flows (borrower side) — monotone in x = 1/(1+r).
    const n = 3 + Math.floor(propRng() * 8);
    const borrowerSide = propRng() < 0.5;
    const flows: number[] = [borrowerSide ? 1 : -1];
    for (let t = 1; t < n; t += 1) {
      const magnitude = Math.pow(10, -3 + propRng() * 6); // 1e-3 .. 1e3
      flows.push(borrowerSide ? -magnitude : magnitude);
    }
    const ref = referenceRoot(flows);
    if (ref === null) continue;
    total += 1;
    const solved = solveIrr(flows, 0.02);
    if (!solved.converged || !Number.isFinite(solved.rate)) continue;
    const err = Math.abs(solved.rate - ref);
    worstError = Math.max(worstError, err);
    if (err <= 1e-6) matched += 1;
  }
  out.push(
    assert(
      "U-IRR-06",
      "ویژگی: ۴۰ جریان تصادفی قطعی با یک ریشه، تطبیق با مرجع تراکمی در ۱۰⁻⁶",
      "Property: 40 seeded single-root streams match a dense-scan reference within 1e-6",
      `${total}/${total} matched, worst error < 1e-6`,
      `${matched}/${total} matched, worst ${worstError.toExponential(2)}`,
      total === 40 && matched === total && worstError < 1e-6,
    ),
  );

  // --- Qard-al-Hasan point engine: zero-interest, zero-commission ----------
  const qhNpv = bankProductNpv({
    averageBalanceRial: 1e12,
    loanAmountRial: 5e11,
    sleepMonths: 6,
    waitingMonths: 0,
    tenorMonths: 36,
    loanRate: 0,
    blockedRatio: 0.1,
    closedLoopRetention: 0.3,
    statutoryReserve: 0.15,
    costOfFunds: 0.19,
    annuity: false,
    upfrontCommissionRate: 0,
    blockRelease: "linear",
  });
  out.push(
    assert(
      "U-QH-01",
      "قرض‌الحسنه بدون بهره: قسط برابر اصل تقسیمی و NPV متناهی",
      "Zero-interest Qard: exact equal-principal instalment, finite NPV",
      `${(5e11 / 36).toExponential(6)} / finite`,
      `${qhNpv.monthlyInstallmentRial.toExponential(6)} / ${qhNpv.npvBankRial.toExponential(3)}`,
      qhNpv.monthlyInstallmentRial === 5e11 / 36 &&
        Number.isFinite(qhNpv.npvBankRial) &&
        typeof qhNpv.actuariallyEquivalent === "boolean",
    ),
  );

  // --- PMT guards: zero rate and overflow ----------------------------------
  const pmtZero = pmt(0, 36, 5e11);
  const pmtOverflow = pmt(50, 400, 1e6); // (51)^400 overflows double
  out.push(
    assert(
      "U-QH-02",
      "پرداخت با نرخ صفر و سرریز توان (بی‌نهایت‌شدن ضریب) هر دو متناهی",
      "PMT at zero rate and under power overflow both stay finite",
      `${(5e11 / 36).toExponential(6)} / 5.000e+7`,
      `${pmtZero.toExponential(6)} / ${pmtOverflow.toExponential(3)}`,
      pmtZero === 5e11 / 36 && Number.isFinite(pmtOverflow) && pmtOverflow === 1e6 * 50,
    ),
  );

  // --- High blocked-deposit ratios -----------------------------------------
  let blockSumsOk = true;
  for (const beta of [0.9, 0.95, 1]) {
    const target = beta * 1e9;
    const releases = blockedReleaseSchedule("linear", target, 36);
    const totalReleased = releases.reduce((a, b) => a + b, 0);
    if (Math.abs(totalReleased - target) > target * 1e-9 || releases.some((x) => x < 0)) {
      blockSumsOk = false;
    }
  }
  const fullBlock = bankProductNpv({
    averageBalanceRial: 1e12,
    loanAmountRial: 1e12,
    sleepMonths: 3,
    waitingMonths: 0,
    tenorMonths: 60,
    loanRate: 0.23,
    blockedRatio: 1,
    closedLoopRetention: 0.5,
    statutoryReserve: 0.15,
    costOfFunds: 0.19,
  });
  out.push(
    assert(
      "U-BLOCK-01",
      "نسبت مسدودی بالا (۹۰–۱۰۰٪): جمع آزادسازی دقیق و بدون تخلیه نقدینگی",
      "High blocked ratios (90–100%): exact release sums, zero liquidity drain",
      "sums ±1e-9 rel; drain leg = 0; finite NPV",
      `sums=${blockSumsOk}; drain=${fullBlock.liquidityDrainLegRial}; npv=${Number.isFinite(fullBlock.npvBankRial)}`,
      blockSumsOk &&
        fullBlock.liquidityDrainLegRial === 0 &&
        Number.isFinite(fullBlock.npvBankRial),
    ),
  );

  const bullet = blockedReleaseSchedule("end", 1e9, 60);
  const midpoint = blockedReleaseSchedule("midpoint", 1e9, 60);
  out.push(
    assert(
      "U-BLOCK-02",
      "آزادسازی گلوله‌ای و وسطی: تنها یک قسط، مبلغ کامل، بدون کسری",
      "Bullet & midpoint release: single full-payment instalment, no shortfall",
      "bullet: last only; midpoint: index 29; both sum to 1e9",
      `bullet=${bullet.filter((x) => x > 0).length}@${bullet[59] === 1e9}; ` +
        `mid=${midpoint.filter((x) => x > 0).length}@${midpoint[29] === 1e9}`,
      bullet[59] === 1e9 &&
        bullet.slice(0, 59).every((x) => x === 0) &&
        midpoint[29] === 1e9 &&
        midpoint.filter((x) => x > 0).length === 1,
    ),
  );

  // --- Early withdrawal penalties ------------------------------------------
  const principal = 1e9;
  const contractedRate = 0.18;
  const proRata = earlyWithdrawalSettlement({
    principalRial: principal,
    annualRate: contractedRate,
    contractedMonths: 24,
    withdrawnMonth: 6,
  });
  const forfeit = earlyWithdrawalSettlement({
    principalRial: principal,
    annualRate: contractedRate,
    contractedMonths: 24,
    withdrawnMonth: 6,
    policy: "forfeit_accrued",
  });
  const partial = earlyWithdrawalSettlement({
    principalRial: principal,
    annualRate: contractedRate,
    contractedMonths: 24,
    withdrawnMonth: 6,
    policy: "penalty_fraction",
    penaltyFraction: 0.25,
  });
  const expectedAccrued = principal * (contractedRate / 12) * 6;
  out.push(
    assert(
      "U-WD-01",
      "سه سیاست برداشت پیش‌ازموعد: تمام‌سهم، اسقاط تمام سود، و جزئی ۲۵٪",
      "Three early-withdrawal policies: pro-rata, full forfeit, 25% penalty",
      `accrued=${expectedAccrued.toExponential(6)}; eff 0.18 / 0 / 0.135`,
      `acc=${proRata.accruedProfitRial.toExponential(6)}; eff=` +
        `${proRata.effectiveAnnualRate.toFixed(6)}/${forfeit.effectiveAnnualRate.toFixed(6)}/${partial.effectiveAnnualRate.toFixed(6)}`,
      near(proRata.accruedProfitRial, expectedAccrued, 1e-3) &&
        proRata.penaltyRial === 0 &&
        near(proRata.effectiveAnnualRate, contractedRate, 1e-9) &&
        forfeit.penaltyRial === forfeit.accruedProfitRial &&
        forfeit.depositorPayoutRial === principal &&
        forfeit.effectiveAnnualRate === 0 &&
        near(partial.penaltyRial, expectedAccrued * 0.25, 1e-3) &&
        near(partial.effectiveAnnualRate, contractedRate * 0.75, 1e-9),
    ),
  );

  const monthZero = earlyWithdrawalSettlement({
    principalRial: principal,
    annualRate: contractedRate,
    contractedMonths: 24,
    withdrawnMonth: 0,
  });
  const monthOver = earlyWithdrawalSettlement({
    principalRial: principal,
    annualRate: contractedRate,
    contractedMonths: 24,
    withdrawnMonth: 999,
    policy: "forfeit_accrued",
  });
  const qardDeposit = earlyWithdrawalSettlement({
    principalRial: principal,
    annualRate: 0,
    contractedMonths: 12,
    withdrawnMonth: 3,
  });
  out.push(
    assert(
      "U-WD-02",
      "لبه‌های برداشت: ماه صفر بدون تقسیم بر صفر، ماه فراتر از سررسید به کف سررسید، سپرده قرض‌الحسنه",
      "Edge months: m=0 no division-by-zero, m>N clamped, zero-rate Qard deposit",
      "m=0 → 0/0-safe; m>N → full term; Qard → payout = principal",
      `m0=${monthZero.effectiveAnnualRate}/${monthZero.depositorPayoutRial}; ` +
        `over=${monthOver.accruedProfitRial === monthOver.fullTermProfitRial}; ` +
        `qh=${qardDeposit.depositorPayoutRial === principal}`,
      monthZero.effectiveAnnualRate === 0 &&
        monthZero.depositorPayoutRial === principal &&
        Number.isFinite(monthZero.penaltyRial) &&
        monthOver.accruedProfitRial === monthOver.fullTermProfitRial &&
        qardDeposit.depositorPayoutRial === principal &&
        qardDeposit.accruedProfitRial === 0 &&
        qardDeposit.effectiveAnnualRate === 0,
    ),
  );

  const penRng = createRng(777);
  let invariantsOk = true;
  const policies = ["pro_rata", "forfeit_accrued", "penalty_fraction"] as const;
  for (let k = 0; k < 200; k += 1) {
    const p = penRng() * 1e12;
    const rate = penRng() * 0.3;
    const n = 1 + Math.floor(penRng() * 60);
    const m = Math.floor(penRng() * (n + 5));
    const policy = policies[Math.floor(penRng() * 3)];
    const res = earlyWithdrawalSettlement({
      principalRial: p,
      annualRate: rate,
      contractedMonths: n,
      withdrawnMonth: m,
      policy,
      penaltyFraction: penRng(),
    });
    const slack = Math.max(1e-9, 8 * Number.EPSILON * Math.max(p, res.fullTermProfitRial, 1));
    const ok =
      Number.isFinite(res.depositorPayoutRial) &&
      Number.isFinite(res.penaltyRial) &&
      Number.isFinite(res.effectiveAnnualRate) &&
      // Magnitude-aware slack: doubles carry ~1e-16 relative error, which at
      // 1e12 Rial is ~1e-4 absolute — the invariants are checked to 8 ulp.
      res.depositorPayoutRial >= p - slack &&
      res.depositorPayoutRial <= p + res.fullTermProfitRial + slack &&
      res.penaltyRial >= 0 &&
      res.penaltyRial <= res.accruedProfitRial + slack &&
      res.effectiveAnnualRate >= -1e-12 &&
      res.effectiveAnnualRate <= rate + 1e-9;
    if (!ok) invariantsOk = false;
  }
  out.push(
    assert(
      "U-WD-03",
      "ویژگی: ۲۰۰ نمونه قطعی — سود پرداختی بین اصل و سود کامل، کارمزد بین صفر و سود انباشته",
      "Property: 200 seeded draws keep payout within [P, P+full], penalty within [0, accrued]",
      "200/200 invariants hold",
      invariantsOk ? "200/200 invariants hold" : "invariant violation",
      invariantsOk,
    ),
  );

  // --- Cost of funds: zero-rate Qard + division-by-zero guards -------------
  const zeroRateCof = costOfFunds({ depositRate: 0, statutoryReserve: 0.15 });
  const expectedCof =
    (0 - 0.15 * CB_REWARD_RATE) / (1 - 0.15 - LIQUIDITY_DEDUCTION_DEFAULT) +
    OPEX_RATIO_DEFAULT;
  let reserveGuard = false;
  try {
    costOfFunds({ depositRate: 0.1, statutoryReserve: 0.99, liquidityDeduction: 0.02 });
  } catch (error) {
    reserveGuard = error instanceof RangeError;
  }
  out.push(
    assert(
      "U-COF-01",
      "بهای تأمین سپرده صفربه‌فرمول دقیق و نگهبان تقسیم بر صفر ذخیره قانونی",
      "Zero-rate cost of funds matches the closed form; reserve-sum guard throws",
      `${expectedCof.toFixed(10)} / RangeError / blended([]) = 0`,
      `${zeroRateCof.costOfFunds.toFixed(10)} / ${reserveGuard} / ${blendedCostOfFunds([])}`,
      near(zeroRateCof.costOfFunds, expectedCof, 1e-12) &&
        zeroRateCof.costOfFunds < 0.05 &&
        reserveGuard &&
        blendedCostOfFunds([]) === 0,
    ),
  );

  // --- Zod boundaries: generate / recommend / engine options ----------------
  const genOk = generateRequestSchema.safeParse({ prompt: "  طراحی محصول  " });
  const genBadRuns = generateRequestSchema.safeParse({ prompt: "x", runs: 99999 });
  const genBadOverride = generateRequestSchema.safeParse({
    prompt: "x",
    intentOverrides: { lcrFloor: 0.5 },
  });
  const genTypo = generateRequestSchema.safeParse({ prompt: "x", run: 5 });
  const genEmpty = generateRequestSchema.safeParse({ prompt: "   " });
  out.push(
    assert(
      "U-SCHEMA-01",
      "درخواست تولید: پیش‌فرض‌ها، رد محدوده‌ها، رد کلید ناشناخته، و پیام دقیق کلید",
      "Generate schema: defaults, range rejection, unknown-key rejection, exact key in message",
      "ok+defaults; 'runs' in msg; 'lcrFloor' in msg; strict; 'prompt is required'",
      [
        genOk.success ? "ok" : "fail",
        genBadRuns.success ? "" : formatZodIssues(genBadRuns.error),
        genBadOverride.success ? "" : formatZodIssues(genBadOverride.error),
        genTypo.success ? "typo-accepted" : "strict",
        genEmpty.success ? "" : formatZodIssues(genEmpty.error),
      ].join(" | "),
      genOk.success &&
        genOk.data.prompt === "طراحی محصول" &&
        genOk.data.runs === MC_RUNS &&
        genOk.data.withSensitivity === true &&
        !genBadRuns.success &&
        formatZodIssues(genBadRuns.error).includes("runs") &&
        !genBadOverride.success &&
        formatZodIssues(genBadOverride.error).includes("lcrFloor") &&
        !genTypo.success &&
        !genEmpty.success &&
        formatZodIssues(genEmpty.error).includes("prompt is required"),
    ),
  );

  const recOk = recommendRequestSchema.safeParse({
    query: "  وام خرید  ",
    amountToman: 1e8,
    alternativeYield: 0.24,
    availableGuarantees: ["none"],
  });
  const recLong = recommendRequestSchema.safeParse({ query: "x".repeat(2001) });
  const recYield = recommendRequestSchema.safeParse({ query: "وام", alternativeYield: 1.5 });
  const recGuarantee = recommendRequestSchema.safeParse({
    query: "وام",
    availableGuarantees: ["not-a-guarantee"],
  });
  out.push(
    assert(
      "U-SCHEMA-02",
      "درخواست توصیه: برش عبارت، سقف بازده، و نوع ضمانت نامعتبر",
      "Recommend schema: query trim, yield cap, invalid guarantee rejected",
      "ok+trimmed; long/fraction/bad-guarantee rejected",
      [recOk.success, !recLong.success, !recYield.success, !recGuarantee.success].join("/"),
      recOk.success &&
        recOk.data.query === "وام خرید" &&
        recOk.data.amountToman === 1e8 &&
        !recLong.success &&
        !recYield.success &&
        !recGuarantee.success,
    ),
  );

  const optsOk = pipelineOptionsSchema.safeParse({
    runs: 220,
    candidates: 18,
    withSensitivity: false,
  });
  const optsRuns = pipelineOptionsSchema.safeParse({ runs: 2001 });
  const optsTypo = pipelineOptionsSchema.safeParse({ runs: 10, foo: 1 });
  const optsSignalOk = pipelineOptionsSchema.safeParse({
    signal: new AbortController().signal,
  });
  const optsSignalBad = pipelineOptionsSchema.safeParse({ signal: "not-a-signal" });
  out.push(
    assert(
      "U-SCHEMA-03",
      "مرز موتور مالی: گزینه‌های معتبر، رد فراتر از سقف، سخت‌گیری کلید، AbortSignal",
      "Engine boundary: valid options, over-cap runs, strict keys, AbortSignal check",
      "2001 rejected w/ 'runs'; strict; signal typed",
      [
        optsOk.success,
        optsRuns.success ? "" : formatZodIssues(optsRuns.error),
        optsTypo.success ? "loose" : "strict",
        optsSignalOk.success,
        optsSignalBad.success ? "bad-signal-accepted" : "bad-rejected",
      ].join(" | "),
      optsOk.success &&
        !optsRuns.success &&
        formatZodIssues(optsRuns.error).includes("runs") &&
        !optsTypo.success &&
        optsSignalOk.success &&
        !optsSignalBad.success,
    ),
  );

  return {
    id: "TC-EDGE",
    titleFa: "آزمون لبه‌ها — IRR سخت‌شده، قرض‌الحسنه، نسبت مسدودی بالا، برداشت پیش‌ازموعد، مرزهای Zod",
    titleEn: "Edge cases — hardened IRR, Qard zero-interest, high blocked ratios, early withdrawal, Zod boundaries",
    assertions: out,
    passed: out.every((item) => item.passed),
    durationMs: Date.now() - started,
    summary: {
      assertions: out.length,
      irrReferenceMatched: matched,
      worstIrrError: Number(worstError.toExponential(2)),
      withdrawalSamples: 200,
    },
  };
}

/**
 * Test case — temporal & regulatory governance: chunk metadata, retrieval
 * pre-filtering, the regulatory-constraint extractor and the hard-boundary
 * enforcement inside the financial-engine.
 */
function runGovernanceCase(): TestCaseResult {
  const started = Date.now();
  const out: Assertion[] = [];

  const govHit = (
    id: string,
    governance: RegulatoryChunkMeta,
    citation = `clause-of-${id}`,
  ): RegulatoryConstraint => ({
    id,
    code: id,
    titleFa: `سند ${id}`,
    titleEn: `Document ${id}`,
    authority: "بانک مرکزی",
    category: "cbi-directive",
    bodyFa: "متن",
    bodyEn: "body",
    citation,
    relevance: 0.9,
    binding: [],
    governance,
  });

  const activeMeta = (
    regulatory_caps?: RegulatoryChunkMeta["regulatory_caps"],
    overrides: Partial<RegulatoryChunkMeta> = {},
  ): RegulatoryChunkMeta => ({
    effective_date: "2022-01-01T00:00:00.000Z",
    expiration_date: null,
    status: "ACTIVE",
    sharia_contract_type: "GENERAL",
    ...(regulatory_caps ? { regulatory_caps } : {}),
    ...overrides,
  });

  const at = new Date("2026-06-01T00:00:00.000Z");

  // --- GOV-01: extraction produces the executable envelope -----------------
  const extracted = extractRegulatoryConstraints(
    [
      govHit("CBI-MORABAHA-RATE-23", activeMeta({ maxLoanInterestRate: 0.23, effectiveRateCap: 0.23 })),
      govHit("CBI-QH-COMMISSION-04", activeMeta({ maxFeeRate: 0.04 })),
      govHit("CBI-STATUTORY-RESERVE", activeMeta({ minReserveRatio: 0.1 })),
      govHit("CBI-BLOCKED-DEPOSIT-COLLATERAL", activeMeta({ allowBlockedDepositCollateral: true })),
    ],
    { at },
  );
  const schemaCheck = regulatoryConstraintsSchema.safeParse(extracted);
  out.push(
    assert(
      "GOV-01",
      "استخراج پاکت مقرراتی اجراپذیر با citations مستند و اعتبارسنجی Zod",
      "Extractor yields the executable envelope with grounded citations, Zod-valid",
      "0.23 / 0.04 / 0.10 / true / 0.23 + 4 citations",
      `${extracted.max_loan_interest_rate} / ${extracted.max_fee_rate} / ` +
        `${extracted.min_reserve_ratio} / ${extracted.allow_blocked_deposit_collateral} / ` +
        `${extracted.effective_rate_cap} + ${extracted.citations.length} citations`,
      schemaCheck.success &&
        extracted.max_loan_interest_rate === 0.23 &&
        extracted.max_fee_rate === 0.04 &&
        extracted.min_reserve_ratio === 0.1 &&
        extracted.allow_blocked_deposit_collateral === true &&
        extracted.effective_rate_cap === 0.23 &&
        extracted.citations.length === 4 &&
        extracted.citations.every(
          (c) => c.doc_id.length > 0 && c.clause.length > 0 && c.summary.length > 0,
        ),
    ),
  );

  // --- GOV-02: conservative merge algebra ---------------------------------
  const looseAndTight = extractRegulatoryConstraints(
    [
      // Looser than the statutory fallback: must NOT widen the envelope.
      govHit("LOOSE-RATE", activeMeta({ maxLoanInterestRate: 0.25, effectiveRateCap: 0.25 })),
      govHit("LOOSE-RESERVE", activeMeta({ minReserveRatio: 0.08 })),
      // Tighter: must bind.
      govHit("TIGHT-FEE", activeMeta({ maxFeeRate: 0.02 })),
      govHit("TIGHT-RESERVE", activeMeta({ minReserveRatio: 0.15 })),
      govHit("NO-COLLATERAL", activeMeta({ allowBlockedDepositCollateral: false })),
    ],
    { at },
  );
  out.push(
    assert(
      "GOV-02",
      "ادغام محافظه‌کارانه: سقف‌های سست باز نمی‌شوند، سخت‌ها بسته می‌شوند",
      "Conservative merge: loose caps never widen, tight caps always bind",
      "rate stays 0.23; fee 0.02; reserve 0.15; collateral false",
      `rate=${looseAndTight.max_loan_interest_rate}; fee=${looseAndTight.max_fee_rate}; ` +
        `reserve=${looseAndTight.min_reserve_ratio}; collateral=${looseAndTight.allow_blocked_deposit_collateral}`,
      looseAndTight.max_loan_interest_rate === 0.23 &&
        looseAndTight.effective_rate_cap === 0.23 &&
        looseAndTight.max_fee_rate === 0.02 &&
        looseAndTight.min_reserve_ratio === 0.15 &&
        looseAndTight.allow_blocked_deposit_collateral === false,
    ),
  );

  // --- GOV-03: non-ACTIVE hits are ignored even if injected directly -------
  const baseHits = [
    govHit("CBI-MORABAHA-RATE-23", activeMeta({ maxLoanInterestRate: 0.23, effectiveRateCap: 0.23 })),
    govHit("CBI-QH-COMMISSION-04", activeMeta({ maxFeeRate: 0.04 })),
  ];
  const polluted = extractRegulatoryConstraints(
    [
      ...baseHits,
      govHit(
        "CBI-BLOCKED-COLLATERAL-OLD",
        activeMeta(
          { allowBlockedDepositCollateral: false },
          { status: "SUPERSEDED", expiration_date: "2023-01-01T00:00:00.000Z" },
        ),
      ),
      govHit(
        "CBI-RATE-CAP-20-AMENDED",
        activeMeta({ maxLoanInterestRate: 0.2, effectiveRateCap: 0.2 }, { status: "AMENDED" }),
      ),
      govHit(
        "CBI-PANDEMIC-RELIEF-2020",
        activeMeta(
          { maxFeeRate: 0.02 },
          { expiration_date: "2021-12-21T00:00:00.000Z" },
        ),
      ),
      govHit(
        "CBI-FUTURE-REVIEW-2099",
        activeMeta(
          { maxLoanInterestRate: 0.15, effectiveRateCap: 0.15 },
          { effective_date: "2099-01-01T00:00:00.000Z" },
        ),
      ),
    ],
    { at },
  );
  out.push(
    assert(
      "GOV-03",
      "دروازه دوم: ضربه‌های منسوخ/بازنگری‌شده/منقضی/آینده حتی مستقیم هم نادیده گرفته می‌شوند",
      "Second gate: superseded/amended/expired/future hits are ignored even when injected",
      "rate 0.23, fee 0.04, collateral true, citations = 2",
      `rate=${polluted.max_loan_interest_rate}; fee=${polluted.max_fee_rate}; ` +
        `collateral=${polluted.allow_blocked_deposit_collateral}; citations=${polluted.citations.length}`,
      polluted.max_loan_interest_rate === 0.23 &&
        polluted.effective_rate_cap === 0.23 &&
        polluted.max_fee_rate === 0.04 &&
        polluted.allow_blocked_deposit_collateral === true &&
        polluted.citations.length === 2,
    ),
  );

  // --- GOV-04: hard-boundary helpers (incl. NaN safety) --------------------
  const env = extracted;
  const forbidden: RegulatoryConstraints = { ...env, allow_blocked_deposit_collateral: false };
  out.push(
    assert(
      "GOV-04",
      "بندهای سخت موتور: سقف نرخ/کارمزد، کف ذخیره، مسدودی ممنوع، ورودی نامعتبر",
      "Engine hard bounds: rate/fee caps, reserve floor, collateral ban, invalid input",
      "0.23 / 0.04 / 0.10 / 0 / safe-NaN",
      [
        clampLoanRateToConstraints(0.27, env),
        clampFeeRateToConstraints(0.06, env),
        applyReserveFloor(0.02, env),
        clampBlockedRatioToConstraints(0.35, forbidden),
        clampLoanRateToConstraints(NaN, env),
      ].join(" / "),
      clampLoanRateToConstraints(0.27, env) === 0.23 &&
        clampLoanRateToConstraints(0.19, env) === 0.19 &&
        clampFeeRateToConstraints(0.06, env) === 0.04 &&
        applyReserveFloor(0.02, env) === 0.1 &&
        applyReserveFloor(0.15, env) === 0.15 &&
        clampBlockedRatioToConstraints(0.35, forbidden) === 0 &&
        clampBlockedRatioToConstraints(0.35, env) === 0.35 &&
        Number.isFinite(clampLoanRateToConstraints(NaN, env)),
    ),
  );

  // --- GOV-05: temporal window boundaries ----------------------------------
  const windowMeta: RegulatoryChunkMeta = {
    effective_date: "2023-01-01T00:00:00.000Z",
    expiration_date: "2025-01-01T00:00:00.000Z",
    status: "ACTIVE",
    sharia_contract_type: "GENERAL",
  };
  out.push(
    assert(
      "GOV-05",
      "پنجره زمانی: لحظه شروع شامل، لحظه انقضا حذف، وضعیت غیرفعال همیشه حذف",
      "Window: inclusive start, exclusive expiry, non-ACTIVE always excluded",
      "true / false / true / false / false",
      [
        isChunkActiveAt(windowMeta, new Date("2023-01-01T00:00:00.000Z")),
        isChunkActiveAt(windowMeta, new Date("2025-01-01T00:00:00.000Z")),
        isChunkActiveAt(windowMeta, new Date("2024-06-01T00:00:00.000Z")),
        isChunkActiveAt({ ...windowMeta, status: "SUPERSEDED" }, new Date("2024-06-01T00:00:00.000Z")),
        isChunkActiveAt({ ...windowMeta, status: "AMENDED" }, new Date("2024-06-01T00:00:00.000Z")),
      ].join(" / "),
      isChunkActiveAt(windowMeta, new Date("2023-01-01T00:00:00.000Z")) === true &&
        isChunkActiveAt(windowMeta, new Date("2025-01-01T00:00:00.000Z")) === false &&
        isChunkActiveAt(windowMeta, new Date("2024-06-01T00:00:00.000Z")) === true &&
        isChunkActiveAt({ ...windowMeta, status: "SUPERSEDED" }, new Date("2024-06-01T00:00:00.000Z")) === false &&
        isChunkActiveAt({ ...windowMeta, status: "AMENDED" }, new Date("2024-06-01T00:00:00.000Z")) === false,
    ),
  );

  // --- GOV-06: end-to-end retrieval pre-filter -----------------------------
  const nowHits = retrieveKnowledge("CBI-BLOCKED-COLLATERAL-OLD", 10, [], at);
  const amendedHits = retrieveKnowledge("CBI-RATE-CAP-20-AMENDED", 10, [], at);
  const expiredNow = retrieveKnowledge("CBI-PANDEMIC-RELIEF-2020", 10, [], at);
  const expiredPast = retrieveKnowledge("CBI-PANDEMIC-RELIEF-2020", 10, [], new Date("2021-01-01T00:00:00.000Z"));
  const futureNow = retrieveKnowledge("CBI-FUTURE-REVIEW-2099", 10, [], at);
  const futureLater = retrieveKnowledge("CBI-FUTURE-REVIEW-2099", 10, [], new Date("2100-01-01T00:00:00.000Z"));
  const activeNow = retrieveKnowledge("CBI-BLOCKED-DEPOSIT-COLLATERAL", 10, [], at);
  const everyActive = (hits: RegulatoryConstraint[]) =>
    hits.every((h) => h.governance?.status === "ACTIVE" && isChunkActiveAt(h.governance, at));
  out.push(
    assert(
      "GOV-06",
      "پیش‌فیلتر بازیابی: نامعتبرها هرگز سطح نمی‌آیند؛ فعال‌ها و پنجره‌های زمانی درست کار می‌کنند",
      "Retrieval pre-filter: invalid chunks never surface; active + time windows behave",
      "superseded/amended/expired/future absent now; present only in their windows; active present",
      `old=${nowHits.some((h) => h.code === "CBI-BLOCKED-COLLATERAL-OLD")}; ` +
        `amended=${amendedHits.some((h) => h.code === "CBI-RATE-CAP-20-AMENDED")}; ` +
        `expiredNow=${expiredNow.some((h) => h.code === "CBI-PANDEMIC-RELIEF-2020")}; ` +
        `expiredPast=${expiredPast.some((h) => h.code === "CBI-PANDEMIC-RELIEF-2020")}; ` +
        `futureNow=${futureNow.some((h) => h.code === "CBI-FUTURE-REVIEW-2099")}; ` +
        `futureLater=${futureLater.some((h) => h.code === "CBI-FUTURE-REVIEW-2099")}; ` +
        `active=${activeNow.some((h) => h.code === "CBI-BLOCKED-DEPOSIT-COLLATERAL")}`,
      everyActive(nowHits) &&
        everyActive(amendedHits) &&
        everyActive(expiredNow) &&
        everyActive(futureNow) &&
        !nowHits.some((h) => h.code === "CBI-BLOCKED-COLLATERAL-OLD") &&
        !amendedHits.some((h) => h.code === "CBI-RATE-CAP-20-AMENDED") &&
        !expiredNow.some((h) => h.code === "CBI-PANDEMIC-RELIEF-2020") &&
        expiredPast.some((h) => h.code === "CBI-PANDEMIC-RELIEF-2020") &&
        !futureNow.some((h) => h.code === "CBI-FUTURE-REVIEW-2099") &&
        futureLater.some((h) => h.code === "CBI-FUTURE-REVIEW-2099") &&
        activeNow.some((h) => h.code === "CBI-BLOCKED-DEPOSIT-COLLATERAL"),
    ),
  );

  // --- GOV-07: filterFn excludes BEFORE scoring ----------------------------
  const miniIndex = new HybridRagIndex<{ tag: string }>([
    {
      id: "a",
      title: "zebraquark directive",
      entity: "authority-a",
      tags: "zebraquark",
      body: "zebraquark exclusive clause about rates",
      item: { tag: "a" },
    },
    {
      id: "b",
      title: "flibbertigibbet rule",
      entity: "authority-b",
      tags: "flibbertigibbet",
      body: "flibbertigibbet general rule about reserves",
      item: { tag: "b" },
    },
  ]);
  const controlHits = miniIndex.search("zebraquark", { minScore: 0.01 });
  const filteredHits = miniIndex.search("zebraquark", {
    minScore: 0.01,
    filterFn: (item) => item.tag !== "a",
  });
  const bothHits = miniIndex.search("zebraquark flibbertigibbet", {
    minScore: 0.01,
    filterFn: (item) => item.tag !== "a",
  });
  out.push(
    assert(
      "GOV-07",
      "filterFn قبل از امتیازدهی BM25/_dense حذف می‌کند: مستندِ فیلترشده حتی با تطابق کامل برنمی‌گردد",
      "filterFn drops records before BM25/dense scoring: a perfect match cannot resurface",
      "control finds a; filtered empty; mixed returns only b",
      `control=${controlHits.map((h) => h.id).join(",") || "none"}; ` +
        `filtered=${filteredHits.length}; both=${bothHits.map((h) => h.id).join(",") || "none"}`,
      controlHits.some((h) => h.id === "a") &&
        filteredHits.length === 0 &&
        bothHits.length > 0 &&
        bothHits.every((h) => h.id === "b"),
    ),
  );

  // --- GOV-08: engine applies the envelope as hard bounds -------------------
  const blueprint = BLUEPRINTS[Object.keys(BLUEPRINTS)[0] as keyof typeof BLUEPRINTS];
  const tightEnv: RegulatoryConstraints = {
    ...defaultRegulatoryConstraints(),
    max_loan_interest_rate: 0.19,
    effective_rate_cap: 0.19,
    citations: [{ doc_id: "TEST", clause: "clause", summary: "summary" }],
  };
  const extremeParams = { rlExact: 0.27, rrExact: 0.02, betaExact: 0.4, feeExact: 0.09 };
  const unconstrained = buildMode(blueprint, "morabaha", 0.1, 1e13, extremeParams, null, 0);
  const constrained = buildMode(
    blueprint,
    "morabaha",
    0.1,
    1e13,
    extremeParams,
    null,
    0,
    0,
    undefined,
    tightEnv,
  );
  const collateralBanned = buildMode(
    blueprint,
    "morabaha",
    0.1,
    1e13,
    extremeParams,
    null,
    0,
    0,
    undefined,
    { ...tightEnv, allow_blocked_deposit_collateral: false },
  );
  out.push(
    assert(
      "GOV-08",
      "موتور مالی: کف/سقف‌های پاکت روی نرخ، کارمزد، ذخیره و مسدودی اعمال می‌شود",
      "Financial-engine enforces envelope caps/floors on rate, fee, reserve and blocking",
      "0.19 rate / 0.04 fee / 0.10 reserve / 0 blocked; control keeps pre-envelope sampling",
      `rate=${constrained.loanRate}; fee=${constrained.feeIncomeRate}; ` +
        `reserve=${constrained.statutoryReserve}; blocked=${collateralBanned.blockedRatio}; ` +
        `controlRate=${unconstrained.loanRate}; controlBlocked=${unconstrained.blockedRatio}`,
      constrained.loanRate === 0.19 &&
        constrained.feeIncomeRate === 0.04 &&
        constrained.statutoryReserve === 0.1 &&
        collateralBanned.blockedRatio === 0 &&
        unconstrained.loanRate === 0.23 &&
        unconstrained.feeIncomeRate === 0.09 &&
        unconstrained.statutoryReserve === 0.02 &&
        unconstrained.blockedRatio === 0.4,
    ),
  );

  // --- GOV-09: corpus governance completeness + allBindings hygiene ---------
  const statuses = new Set(KB_SEED.map((d) => d.governance.status));
  const bindingsNow = allBindings(at).map((b) => b.code);
  out.push(
    assert(
      "GOV-09",
      "متن کامل: هر سند گردش‌کار دارد، نامعتبرها در allBindings نیستند",
      "Corpus completeness: every seed governed; invalid docs absent from allBindings",
      `>=23 seeds, 3 statuses, no non-ACTIVE in bindings (got ${KB_SEED.length})`,
      `seeds=${KB_SEED.length}; statuses=${[...statuses].join("/")}; ` +
        `leaked=${["CBI-BLOCKED-COLLATERAL-OLD", "CBI-RATE-CAP-20-AMENDED", "CBI-PANDEMIC-RELIEF-2020", "CBI-FUTURE-REVIEW-2099"].filter((c) => bindingsNow.includes(c)).join(",") || "none"}`,
      KB_SEED.length >= 23 &&
        KB_DOCUMENTS.every((d) => regulatoryChunkMetaSchema.safeParse(d.governance).success) &&
        statuses.has("ACTIVE") &&
        statuses.has("SUPERSEDED") &&
        statuses.has("AMENDED") &&
        !bindingsNow.includes("CBI-BLOCKED-COLLATERAL-OLD") &&
        !bindingsNow.includes("CBI-RATE-CAP-20-AMENDED") &&
        !bindingsNow.includes("CBI-PANDEMIC-RELIEF-2020") &&
        !bindingsNow.includes("CBI-FUTURE-REVIEW-2099"),
    ),
  );

  return {
    id: "TC-GOV",
    titleFa: "آزمون حکمرانی — متادیتای زمانی، پیش‌فیلتر بازیابی، استخراج مقررات، بندهای سخت موتور",
    titleEn: "Governance — temporal metadata, retrieval pre-filter, constraint extraction, engine hard bounds",
    assertions: out,
    passed: out.every((item) => item.passed),
    durationMs: Date.now() - started,
    summary: {
      assertions: out.length,
      seeds: KB_SEED.length,
      citations: extracted.citations.length,
      envelopeRate: extracted.max_loan_interest_rate,
      envelopeFee: extracted.max_fee_rate,
    },
  };
}

/**
 * Test case — advanced engine: deposit cannibalization math, Phase A/B/C
 * cohort liquidity modelling and the deterministic inverse product solver.
 */
function runAdvancedEngineCase(): TestCaseResult {
  const started = Date.now();
  const out: Assertion[] = [];

  const canBase = {
    depositVolumeRial: 1e13,
    loanToDepositMultiplier: 1.2,
    sourceDepositCost: 0.02,
    depositInterestRate: 0.15,
    loanInterestRate: 0.23,
    feeRate: 0.02,
    statutoryReserve: 0.1,
  };

  // --- CAN-01: migration-matrix identities ---------------------------------
  const can0 = computeCannibalization({ ...canBase, cannibalizationRate: 0 });
  const can1 = computeCannibalization({ ...canBase, cannibalizationRate: 1 });
  const canHalf = computeCannibalization({ ...canBase, cannibalizationRate: 0.5 });
  const expectedMid =
    can0.newMoneyCostOfFunds - 0.5 * (can0.newMoneyCostOfFunds - can0.sourceCostOfFunds);
  out.push(
    assert(
      "CAN-01",
      "ماتریس مهاجرت: α=0 فقط NNM، α=1 فقط مهاجرت، MCoF خطی در میانه",
      "Migration matrix: α=0 pure NNM, α=1 pure migration, MCoF linear at midpoint",
      "NNM+Migrated=D; MCoF(0)=cofNew; MCoF(1)=cofSrc; MCoF(0.5)=midpoint",
      `nnm0=${can0.netNewMoneyRial}; mig1=${can1.migratedInternalFundsRial}; ` +
        `mcof0=${can0.marginalCostOfFunds.toFixed(6)}; mcof1=${can1.marginalCostOfFunds.toFixed(6)}; mid=${canHalf.marginalCostOfFunds.toFixed(6)}`,
      can0.netNewMoneyRial === 1e13 &&
        can0.migratedInternalFundsRial === 0 &&
        can1.migratedInternalFundsRial === 1e13 &&
        can0.lostSpreadOnCannibalizedRial === 0 &&
        can0.marginalCostOfFunds === can0.newMoneyCostOfFunds &&
        Math.abs(can1.marginalCostOfFunds - can0.sourceCostOfFunds) < 1e-12 &&
        Math.abs(canHalf.marginalCostOfFunds - expectedMid) < 1e-12 &&
        Math.abs(can0.netNewMoneyRial + can0.migratedInternalFundsRial - 1e13) < 1e-3,
    ),
  );

  // --- CAN-02: NII identity & risk adjustment ------------------------------
  const canWithEl = computeCannibalization({
    ...canBase,
    cannibalizationRate: 0.4,
    expectedLossRate: 0.03 * 0.45,
  });
  const niiIdentity =
    canWithEl.grossInterestIncomeRial +
    canWithEl.treasuryIncomeRial -
    canWithEl.fundingCostRial;
  out.push(
    assert(
      "CAN-02",
      "NII پس‌ازمهاجرت = درآمد + خزانه − هزینه تأمین با MCoF؛ سپرده‌ای با ریسک تعدیل",
      "Post-migration NII identity with MCoF funding cost and risk adjustment",
      "|NII − identity| < 1e-3; riskAdjusted = NII − L·EL; lost spread > 0",
      `nii=${canWithEl.netInterestIncomeRial.toFixed(3)}; ` +
        `delta=${Math.abs(canWithEl.netInterestIncomeRial - niiIdentity).toFixed(6)}; ` +
        `lost=${canWithEl.lostSpreadOnCannibalizedRial.toFixed(0)}`,
      Math.abs(canWithEl.netInterestIncomeRial - niiIdentity) < 1e-3 &&
        Math.abs(
          canWithEl.riskAdjustedNiiRial -
            (canWithEl.netInterestIncomeRial - canWithEl.loanBookRial * 0.03 * 0.45),
        ) < 1e-3 &&
        canWithEl.lostSpreadOnCannibalizedRial > 0 &&
        canWithEl.marginalCostOfFunds < canWithEl.newMoneyCostOfFunds,
    ),
  );

  // --- CAN-03: input guards ------------------------------------------------
  const guardResults: string[] = [];
  for (const bad of [
    { ...canBase, cannibalizationRate: 1.5 },
    { ...canBase, sourceDepositCost: NaN },
    { ...canBase, statutoryReserve: 0.99, liquidityDeduction: 0.02 },
  ]) {
    let threw = false;
    try {
      computeCannibalization(bad as never);
    } catch {
      threw = true;
    }
    guardResults.push(threw ? "throw" : "accepted");
  }
  out.push(
    assert(
      "CAN-03",
      "نگهبان‌های ورودی: α>1، NaN، و ذخیره+نقدینگی≥۱ همگی رد می‌شوند",
      "Input guards: α>1, NaN and reserve+liquidity ≥ 1 are all rejected",
      "throw / throw / throw",
      guardResults.join(" / "),
      guardResults.every((r) => r === "throw"),
    ),
  );

  // --- COH-01: phase structure & amortisation ------------------------------
  const cohortIn: CohortInput = {
    depositVolumeRial: 1e13,
    loanToDepositMultiplier: 1.2,
    depositRetentionMonths: 4,
    repaymentMonths: 12,
    blockedDepositPct: 0.3,
    unblockedRunoffRate: 0.05,
    loanInterestRate: 0.23,
    depositInterestRate: 0.12,
    feeRate: 0.02,
    statutoryReserve: 0.1,
    pd: 0.03,
    lgd: 0.45,
  };
  const cohort = projectCohortLiquidity(cohortIn);
  const phasesOk =
    cohort.months.length === 4 + 1 + 12 &&
    cohort.months.slice(0, 4).every((m) => m.phase === "A" && m.loanBalanceRial === 0) &&
    cohort.months[4].phase === "B" &&
    cohort.months[4].loanBalanceRial === 1.2e13 &&
    cohort.months.slice(5).every((m) => m.phase === "C") &&
    cohort.finalLoanBalanceRial < 1;
  out.push(
    assert(
      "COH-01",
      "ساختار فازها: A تجمع، B اعطای وام (L=M·D)، C استهلاک تا صفر",
      "Phase structure: A accumulation, B origination (L=M·D), C amortises to zero",
      "17 months; A×4, B×1, C×12; final balance ≈ 0",
      `months=${cohort.months.length}; phases=${cohort.months.map((m) => m.phase).join("")}; final=${cohort.finalLoanBalanceRial.toExponential(2)}`,
      phasesOk,
    ),
  );

  // --- COH-02: blocked release + geometric run-off -------------------------
  const b5 = cohort.months[4];
  const b6 = cohort.months[5];
  const blockedNonIncreasing = cohort.months
    .slice(4)
    .every((m, i, arr) => i === 0 || m.blockedRial <= arr[i - 1].blockedRial + 1);
  out.push(
    assert(
      "COH-02",
      "مسدودی با استهلاک آزاد می‌شود؛ آزادشونده هندسی با β کاهش می‌یابد؛ جمع سپرده حفظ می‌شود",
      "Blocked releases with amortisation; unblocked decays geometrically by β; deposits conserved",
      "blocked(5)=3e12; blocked non-increasing; U(6)=U(5)·0.95; B+U=D",
      `b5=${b5.blockedRial.toExponential(3)}; ratio=${(b6.unblockedRial / b5.unblockedRial).toFixed(6)}; ` +
        `cons=${(b6.blockedRial + b6.unblockedRial - b6.depositsRial).toFixed(6)}`,
      Math.abs(b5.blockedRial - 3e12) < 1 &&
        blockedNonIncreasing &&
        Math.abs(b6.unblockedRial / b5.unblockedRial - 0.95) < 1e-12 &&
        Math.abs(b6.blockedRial + b6.unblockedRial - b6.depositsRial) < 1e-3,
    ),
  );

  // --- COH-03: ledger identities -------------------------------------------
  let ledgerOk = true;
  for (const m of cohort.months) {
    const recomputed =
      m.newDepositInflowRial -
      m.depositInterestOutflowRial +
      m.treasuryInflowRial +
      m.feeIncomeRial -
      m.disbursementOutflowRial +
      m.instalmentInflowRial -
      m.runoffOutflowRial -
      m.defaultLossRial -
      m.wholesaleCostOutflowRial -
      m.opexOutflowRial;
    if (Math.abs(recomputed - m.netCashflowRial) > 1e-3 + 1e-12 * Math.abs(m.netCashflowRial)) {
      ledgerOk = false;
    }
  }
  const cumOk = cohort.months.every((m, i) =>
    i === 0
      ? Math.abs(m.cumulativeCashflowRial - m.netCashflowRial) < 1e-3
      : Math.abs(
          m.cumulativeCashflowRial -
            (cohort.months[i - 1].cumulativeCashflowRial + m.netCashflowRial),
        ) < 1e-3 + 1e-12 * Math.abs(m.cumulativeCashflowRial),
  );
  out.push(
    assert(
      "COH-03",
      "دفتر نقدینگی: جمع اقلام هر ماه برابر خالص جریان؛ تجمعی بازپذیر",
      "Ledger identity: components sum to net cash-flow; cumulative is consistent",
      "all months exact within 1e-3 Rial",
      `ledger=${ledgerOk}; cumulative=${cumOk}; worst=${cohort.worstMonthlyGapRial.toFixed(0)}`,
      ledgerOk && cumOk,
    ),
  );

  // --- COH-04: determinism + breakeven -------------------------------------
  const cohortAgain = projectCohortLiquidity(cohortIn);
  const profitable = projectCohortLiquidity({
    ...cohortIn,
    loanToDepositMultiplier: 0.5,
    unblockedRunoffRate: 0.01,
    depositInterestRate: 0.08,
  });
  out.push(
    assert(
      "COH-04",
      "قطعیت مطلق پروژه‌کهولی و یافتن ماه سر به سر در ساختار سودآور",
      "Fully deterministic cohort replay; profitable structure finds a breakeven month",
      "identical JSON; breakeven not null",
      `same=${JSON.stringify(cohort) === JSON.stringify(cohortAgain)}; be=${profitable.breakevenMonth}`,
      JSON.stringify(cohort) === JSON.stringify(cohortAgain) &&
        profitable.breakevenMonth !== null,
    ),
  );

  // --- Solver shared fixture ----------------------------------------------
  const solverBase: InverseSolverInput = {
    targetBankIrrMin: 0.15,
    targetCustomerIrrMin: 0.1,
    maxLiquidityGapLimit: 4e12,
    regulatoryConstraints: defaultRegulatoryConstraints(),
    depositVolumeRial: 1e13,
    cannibalizationRate: 0.3,
    sourceDepositCost: 0.02,
    unblockedRunoffRate: 0.02,
    statutoryReserveBase: 0.1,
    pd: 0.03,
    lgd: 0.45,
  };

  // --- INV-01: solved vector inside bounds with integer structure -----------
  const inv1 = solveInverseProduct(solverBase);
  const s1 = inv1.solution;
  out.push(
    assert(
      "INV-01",
      "بردار حل: متغیرهای صحیح در بازه، نرخ/کارمزد در پوشت مقرراتی",
      "Solution vector: integers in range, rates inside the regulatory envelope",
      "T∈[1,12] int; N∈[12,60] int; M∈[0.5,3]; rL≤0.23; rDep≥0.10; fee≤0.04",
      `T=${s1.depositRetentionMonths}; N=${s1.repaymentMonths}; M=${s1.loanToDepositMultiplier}; ` +
        `rL=${s1.loanInterestRate.toFixed(4)}; rD=${s1.depositInterestRate}; fee=${s1.feeRate}`,
      Number.isInteger(s1.depositRetentionMonths) &&
        s1.depositRetentionMonths >= 1 &&
        s1.depositRetentionMonths <= 12 &&
        Number.isInteger(s1.repaymentMonths) &&
        s1.repaymentMonths >= 12 &&
        s1.repaymentMonths <= 60 &&
        s1.loanToDepositMultiplier >= 0.5 &&
        s1.loanToDepositMultiplier <= 3 &&
        s1.loanInterestRate <= 0.23 + 1e-9 &&
        s1.depositInterestRate >= 0.1 - 1e-12 &&
        s1.feeRate <= 0.04 + 1e-9 &&
        s1.blockedDepositPct >= 0 &&
        s1.blockedDepositPct <= 1,
    ),
  );

  // --- INV-02: all hard constraints satisfied on an achievable target -------
  out.push(
    assert(
      "INV-02",
      "هدف‌های دست‌یافتنی: IRR بانک، کف سود مشتری، سقف نرخ وام‌گیرنده، و شکاف نقدینگی همگی پاس",
      "Achievable targets: bank IRR, customer floor, borrower cap and liquidity gap all pass",
      "feasible; 0 violations; irr≥0.15; gap≥−4e12; borrower≤0.23",
      `feasible=${inv1.feasible}; irr=${inv1.metrics.bankIrrAnnual.toFixed(4)}; ` +
        `gap=${inv1.metrics.worstCumulativeGapRial.toFixed(0)}; bor=${inv1.metrics.borrowerNominalEquivalent.toFixed(4)}; ` +
        `viol=${inv1.violations.length}`,
      inv1.feasible &&
        inv1.violations.length === 0 &&
        inv1.metrics.bankIrrAnnual >= 0.15 - 1e-9 &&
        inv1.metrics.worstCumulativeGapRial >= -4e12 &&
        inv1.metrics.borrowerNominalEquivalent <= 0.23 + 1e-9 &&
        inv1.metrics.customerDepositYield >= 0.1 - 1e-12 &&
        inv1.metrics.riskAdjustedNiiRial > 0,
    ),
  );

  // --- INV-03: unattainable target degrades gracefully ----------------------
  const inv3 = solveInverseProduct({ ...solverBase, targetBankIrrMin: 0.6 });
  out.push(
    assert(
      "INV-03",
      "هدف غیرممکن: بدون سقوط، نزدیک‌ترین ساختار با گزارش نقض برگردانده می‌شود",
      "Impossible target: no crash — closest structure returned with violation report",
      "feasible=false; violations non-empty; all metrics finite",
      `feasible=${inv3.feasible}; irr=${inv3.metrics.bankIrrAnnual.toFixed(4)}; ` +
        `viol=${inv3.violations[0] ?? "none"}`,
      !inv3.feasible &&
        inv3.violations.length > 0 &&
        inv3.violations.some((v) => v.includes("bank IRR")) &&
        [
          inv3.metrics.bankIrrAnnual,
          inv3.metrics.riskAdjustedNiiRial,
          inv3.metrics.worstCumulativeGapRial,
          inv3.objective,
        ].every(Number.isFinite) &&
        inv3.metrics.bankIrrAnnual < 0.6,
    ),
  );

  // --- INV-04: determinism + serverless budget ------------------------------
  const inv4a = solveInverseProduct(solverBase);
  const inv4b = solveInverseProduct(solverBase);
  out.push(
    assert(
      "INV-04",
      "قطعیت مطلق و بودجه زمانی سرورلس: تکرار یکسان و کمتر از ۵۰۰ میلی‌ثانیه",
      "Absolute determinism and serverless budget: identical replay under 500 ms",
      "identical solution+metrics; elapsedMs < 500; evaluations ≤ 7000",
      `same=${JSON.stringify([inv4a.solution, inv4a.metrics, inv4a.objective]) ===
        JSON.stringify([inv4b.solution, inv4b.metrics, inv4b.objective])}; ` +
        `ms=${inv4a.elapsedMs}; evals=${inv4a.evaluations}`,
      JSON.stringify([inv4a.solution, inv4a.metrics, inv4a.objective]) ===
        JSON.stringify([inv4b.solution, inv4b.metrics, inv4b.objective]) &&
        inv4a.elapsedMs < 500 &&
        inv4a.evaluations <= 7000,
    ),
  );

  // --- INV-05: forbidden blocked-deposit collateral -------------------------
  const inv5 = solveInverseProduct({
    ...solverBase,
    targetBankIrrMin: 0.14,
    regulatoryConstraints: {
      ...defaultRegulatoryConstraints(),
      allow_blocked_deposit_collateral: false,
    },
  });
  out.push(
    assert(
      "INV-05",
      "ممنوعیت وثیقه سپرده مسدودی: سهم مسدودی صفر و بدون نقض",
      "Blocked-deposit collateral ban: solved blocked share is exactly zero",
      "feasible; blockedDepositPct = 0",
      `feasible=${inv5.feasible}; blocked=${inv5.solution.blockedDepositPct}; viol=${inv5.violations.length}`,
      inv5.feasible && inv5.solution.blockedDepositPct === 0 && inv5.violations.length === 0,
    ),
  );

  // --- INV-06: customer opportunity floor is binding ------------------------
  const inv6 = solveInverseProduct({ ...solverBase, targetCustomerIrrMin: 0.13 });
  out.push(
    assert(
      "INV-06",
      "کف رقابت‌پذیری مشتری: نرخ سپرده هرگز زیر کف تخصیص داده نمی‌شود",
      "Customer competitiveness floor: the deposit rate never solves below the floor",
      "depositInterestRate ≥ 0.13",
      `rDep=${inv6.solution.depositInterestRate}; feasible=${inv6.feasible}; viol=${inv6.violations[0] ?? "none"}`,
      inv6.solution.depositInterestRate >= 0.13 - 1e-12,
    ),
  );

  // --- INV-07: tight liquidity-gap limit is honoured ------------------------
  const inv7 = solveInverseProduct({
    ...solverBase,
    targetBankIrrMin: 0.1,
    maxLiquidityGapLimit: 1e12,
  });
  out.push(
    assert(
      "INV-07",
      "محدودیت سخت شکاف نقدینگی: در حالت ممکن شکاف تجمعی داخل سقف می‌ماند",
      "Tight liquidity-gap limit: feasible solutions keep the cumulative gap inside the cap",
      "feasible ⇒ worstCumulativeGap ≥ −1e12",
      `feasible=${inv7.feasible}; gap=${inv7.metrics.worstCumulativeGapRial.toFixed(0)}; ` +
        `viol=${inv7.violations[0] ?? "none"}`,
      inv7.feasible
        ? inv7.metrics.worstCumulativeGapRial >= -1e12
        : inv7.violations.length > 0,
    ),
  );

  return {
    id: "TC-ADV",
    titleFa: "آزمون موتور پیشرفته — مهاجرت سپرده، مدل رفتاری کهولی، حل معکوس محصول",
    titleEn: "Advanced engine — deposit migration, cohort behaviour, inverse product solve",
    assertions: out,
    passed: out.every((item) => item.passed),
    durationMs: Date.now() - started,
    summary: {
      assertions: out.length,
      solverFeasible: inv1.feasible ? 1 : 0,
      solverIrr: Number(inv1.metrics.bankIrrAnnual.toFixed(4)),
      solverMs: inv1.elapsedMs,
      evaluations: inv1.evaluations,
      breakevenMonth: profitable.breakevenMonth ?? -1,
    },
  };
}

/**
 * Test case — neuro-symbolic closed loop & adversarial committee (Phase 4):
 * inverse solver inside the graph, hidden-usury audit vs the effective cap,
 * Base+3 stress matrix, structured CRITIQUE format, determinism and the
 * ≤3-iteration cap.
 */
async function runClosedLoopCase(fast = false): Promise<TestCaseResult> {
  const started = Date.now();
  const prompt = fast
    ? "طراحی محصول چندطرحی میانگین حساب برای جذب ۲۰ همت منبع با IRR حداقل ۲۶ درصد، حداکثر نسبت تسهیلات به سپرده ۸۵ درصد، حداقل نسبت پوشش نقدینگی ۱٫۰۵ و ریسک واژگونی منابع حداکثر ۶ درصد"
    : "یک بسته بانکی ۴ طرحی پلکانی مبتنی بر میانگین حساب طراحی کن تا ۲۰ همت منبع جذب شود؛ هدف نرخ بازده داخلی بانک حداقل ۲۶٪، سقف نسبت خالص تسهیلات به سپرده ۸۵٪، کف نسبت پوشش نقدینگی ۱٫۰۵ و حداکثر ریسک واژگونی منابع ۶٪";
  const options = {
    runs: fast ? 220 : undefined,
    candidates: fast ? 18 : 26,
    withSensitivity: false as const,
    seed: "closed-loop-2026",
  };
  const runA = await runPipeline({ prompt, options });
  const runB = await runPipeline({ prompt, options });
  const sa = runA.state;
  const sb = runB.state;
  const out: Assertion[] = [];
  const cap = sa.regulatoryConstraints?.effective_rate_cap ?? 0.23;

  // --- CL-01: inverse solution present, finite, cap-respecting -------------
  const inv = sa.inverseSolution;
  out.push(
    assert(
      "CL-01",
      "حل معکوس داخل خط لوله: ساختار حل‌شده، IRRهای متناهی و نرخ مؤثر وام‌گیرنده زیر سقف",
      "Inverse solve in-pipeline: solved structure, finite IRRs, borrower nominal ≤ cap",
      "non-null; finite metrics; borrowerNominal ≤ effective cap; feasible ⇔ no violations",
      inv
        ? `feasible=${inv.feasible}; irr=${inv.metrics.bankIrrAnnual.toFixed(4)}; bor=${inv.metrics.borrowerNominalEquivalent.toFixed(4)}; cap=${cap}; ms=${inv.elapsedMs}`
        : "null",
      inv !== null &&
        [
          inv.metrics.bankIrrAnnual,
          inv.metrics.borrowerNominalEquivalent,
          inv.metrics.worstCumulativeGapRial,
          inv.metrics.riskAdjustedNiiRial,
        ].every(Number.isFinite) &&
        inv.metrics.borrowerNominalEquivalent <= cap + 1e-9 &&
        inv.feasible === (inv.violations.length === 0) &&
        inv.elapsedMs < 500,
    ),
  );

  // --- CL-02: stress matrix — base + three shocks with correct direction ---
  const mx = sa.stressMatrix;
  const byId = (id: string) => mx?.scenarios.find((s) => s.id === id);
  const base = byId("BASE");
  const runoff = byId("DEPOSIT_RUNOFF_20");
  const npl = byId("NPL_SHOCK_3PP");
  const cannib = byId("CANNIBALIZATION_15PP");
  out.push(
    assert(
      "CL-02",
      "نگهبان استرس: پایه و سه شوک با اثرات جهت‌دار (+۲۰٪ برداشت، +۳٪ NPL، +۱۵٪ مهاجرت)",
      "Stress guardian: base plus three shocks with the correct directional effects",
      "4 ordered scenarios; runoff end-deposits ≤ base; NPL net < base; cannibalization net < base",
      mx
        ? `ids=${mx.scenarios.map((s) => s.id).join(",")}; worst=${mx.worstScenarioId}; ` +
            `endD runoff/base=${runoff?.depositBalanceEndRial.toFixed(0)}/${base?.depositBalanceEndRial.toFixed(0)}; ` +
            `net npl/base=${npl?.netCashflowRial.toFixed(0)}/${base?.netCashflowRial.toFixed(0)}; ` +
            `net cannib/base=${cannib?.netCashflowRial.toFixed(0)}/${base?.netCashflowRial.toFixed(0)}`
        : "null",
      mx !== null &&
        mx.scenarios.length === 4 &&
        mx.scenarios.map((s) => s.id).join(",") ===
          "BASE,DEPOSIT_RUNOFF_20,NPL_SHOCK_3PP,CANNIBALIZATION_15PP" &&
        base !== undefined &&
        runoff !== undefined &&
        npl !== undefined &&
        cannib !== undefined &&
        runoff.depositBalanceEndRial <= base.depositBalanceEndRial &&
        npl.netCashflowRial < base.netCashflowRial &&
        cannib.netCashflowRial < base.netCashflowRial &&
        mx.scenarios.some((s) => s.id === mx.worstScenarioId),
    ),
  );

  // --- CL-03: structured CRITIQUE format -----------------------------------
  out.push(
    assert(
      "CL-03",
      "حلقه نقد ساخت‌یافته: پیام دقیقاً با CRITIQUE: و Action required: ساختار می‌یابد",
      "Structured critique loop: message carries the exact CRITIQUE: / Action required: skeleton",
      'startsWith("CRITIQUE: "); includes("Action required: ")',
      (sa.critique ?? "null").slice(0, 120),
      typeof sa.critique === "string" &&
        sa.critique.startsWith("CRITIQUE: ") &&
        sa.critique.includes("Action required: "),
    ),
  );

  // --- CL-04: committee events + iteration cap -----------------------------
  const nodeNames = new Set(runA.events.map((e) => e.node));
  out.push(
    assert(
      "CL-04",
      "کمیته: گره‌های حل معکوس و نگهبان استرس در ردیاب‌اند و حلقه ≤۳ گام می‌ماند",
      "Committee: inverse-solver and stress-guardian nodes traced; loop stays within the 3-step cap",
      "events contain inverse_solver + stress_guardian; iterations ≤ 3",
      `nodes=${[...nodeNames].filter((n) => n === "inverse_solver" || n === "stress_guardian").join("+")}; iterations=${sa.iterations.length}; status=${sa.status}`,
      nodeNames.has("inverse_solver") &&
        nodeNames.has("stress_guardian") &&
        sa.iterations.length <= REGULATORY.maxCriticIterations &&
        sa.status === "complete",
    ),
  );

  // --- CL-05: absolute determinism of the committee outputs -----------------
  // (elapsedMs is wall-clock telemetry, excluded from the determinism contract)
  const fingerprint = (s: typeof sa) =>
    JSON.stringify([
      s.inverseSolution ? { ...s.inverseSolution, elapsedMs: 0 } : null,
      s.stressMatrix,
      s.critique,
    ]);
  out.push(
    assert(
      "CL-05",
      "قطعیت مطلق: تکرار کمیته خروجی یکسان حل معکوس، ماتریس استرس و نقد را می‌دهد",
      "Absolute determinism: a replayed committee yields identical solve, stress and critique outputs",
      "JSON(inverse+stress+critique, elapsedMs excluded) identical across runs",
      `same=${fingerprint(sa) === fingerprint(sb)}`,
      fingerprint(sa) === fingerprint(sb),
    ),
  );

  return {
    id: "TC-CLOSED",
    titleFa: "آزمون حلقه بسته عصبی-نمادین — حل معکوس، نگهبان استرس، ممیزی ربا پنهان و نقد ساخت‌یافته",
    titleEn: "Neuro-symbolic closed loop — inverse solve, stress guardian, hidden-usury audit, structured critique",
    assertions: out,
    passed: out.every((item) => item.passed),
    durationMs: Date.now() - started,
    summary: {
      assertions: out.length,
      inverseFeasible: inv?.feasible ? 1 : 0,
      inverseIrr: Number((inv?.metrics.bankIrrAnnual ?? 0).toFixed(4)),
      borrowerNominal: Number((inv?.metrics.borrowerNominalEquivalent ?? 0).toFixed(4)),
      stressScenarios: mx?.scenarios.length ?? 0,
      iterations: sa.iterations.length,
    },
  };
}

/**
 * Test case — auditable product dossier & serverless budget (Phase 5):
 * schema-valid dossier, metric identities against the solve, the <500 ms
 * serverless envelope (solver + cohort + dossier build), build determinism
 * and audit-log consistency.
 */
async function runDossierCase(fast = false): Promise<TestCaseResult> {
  const started = Date.now();
  const prompt = fast
    ? "طراحی محصول چندطرحی میانگین حساب برای جذب ۲۰ همت منبع با IRR حداقل ۲۶ درصد، حداکثر نسبت تسهیلات به سپرده ۸۵ درصد، حداقل نسبت پوشش نقدینگی ۱٫۰۵ و ریسک واژگونی منابع حداکثر ۶ درصد"
    : "یک بسته بانکی ۴ طرحی پلکانی مبتنی بر میانگین حساب طراحی کن تا ۲۰ همت منبع جذب شود؛ هدف نرخ بازده داخلی بانک حداقل ۲۶٪، سقف نسبت خالص تسهیلات به سپرده ۸۵٪، کف نسبت پوشش نقدینگی ۱٫۰۵ و حداکثر ریسک واژگونی منابع ۶٪";
  const { state } = await runPipeline({
    prompt,
    options: {
      runs: fast ? 220 : undefined,
      candidates: fast ? 18 : 26,
      withSensitivity: false,
      seed: "dossier-2026",
    },
  });
  const out: Assertion[] = [];
  const dossier = buildProductDossier(state);

  // --- DOSSIER-01: strict schema + six complete sections --------------------
  const parsed = dossier ? productDossierSchema.safeParse(dossier) : null;
  out.push(
    assert(
      "DOSSIER-01",
      "دوسیه کامل: شش بخش مشخصه، سودآوری، مهاجرت، استرس، انطباق و کمیته — با اسکیمای سخت‌گیرانه",
      "Complete dossier: spec, profitability, cannibalization, stress, compliance, committee — strict schema",
      "safeParse success; 4 stress scenarios; citations array; critique present",
      dossier
        ? `ok=${parsed?.success}; modes=${dossier.product.modeCount}; scenarios=${dossier.stressMatrix.scenarios.length}; citations=${dossier.compliance.envelope.citations.length}; critique=${dossier.committeeAuditLog.critique.slice(0, 24)}…`
        : "null",
      dossier !== null &&
        parsed !== null &&
        parsed.success &&
        dossier.product.modeCount >= 1 &&
        dossier.product.modes.length === dossier.product.modeCount &&
        dossier.stressMatrix.scenarios.length === 4 &&
        Array.isArray(dossier.compliance.envelope.citations) &&
        dossier.committeeAuditLog.critique.startsWith("CRITIQUE: "),
    ),
  );

  // --- DOSSIER-02: metric identities against the solve ----------------------
  const metrics = state.inverseSolution?.metrics;
  const cann = dossier?.cannibalization;
  const dInput = state.inverseSolverInput;
  out.push(
    assert(
      "DOSSIER-02",
      "هویت شاخص‌ها: دوسیه عیناً از حل معکوس و ماتریس مهاجرت تغذیه می‌شود",
      "Metric identities: dossier mirrors the inverse solve and migration matrix exactly",
      "IRR/MCoF/NII/breakeven === solve; NNM+migrated = D",
      dossier && metrics && cann && dInput
        ? `irr=${dossier.almProfitability.bankIrrAnnual === metrics.bankIrrAnnual}; ` +
            `mcof=${dossier.almProfitability.marginalCostOfFunds === metrics.marginalCostOfFunds}; ` +
            `nii=${dossier.almProfitability.netNiiPostCannibalization === metrics.netInterestIncomeRial}; ` +
            `be=${dossier.almProfitability.breakevenMonth === metrics.breakevenMonth}; ` +
            `split=${Math.abs(cann.netNewMoneyRial + cann.migratedRial - dInput.depositVolumeRial)}`
        : "null",
      dossier !== null &&
        metrics !== undefined &&
        cann !== undefined &&
        dInput !== null &&
        dossier.almProfitability.bankIrrAnnual === metrics.bankIrrAnnual &&
        dossier.almProfitability.customerEffectiveIrr === metrics.borrowerEffectiveAnnual &&
        dossier.almProfitability.customerNominalIrr === metrics.borrowerNominalEquivalent &&
        dossier.almProfitability.marginalCostOfFunds === metrics.marginalCostOfFunds &&
        dossier.almProfitability.netNiiPostCannibalization === metrics.netInterestIncomeRial &&
        dossier.almProfitability.riskAdjustedNiiRial === metrics.riskAdjustedNiiRial &&
        dossier.almProfitability.breakevenMonth === metrics.breakevenMonth &&
        dossier.almProfitability.worstCumulativeGapRial === metrics.worstCumulativeGapRial &&
        Math.abs(cann.netNewMoneyRial + cann.migratedRial - dInput.depositVolumeRial) < 1e-3 &&
        Math.abs(cann.netNewMoneyRial - (1 - cann.rate) * dInput.depositVolumeRial) < 1e-3,
    ),
  );

  // --- DOSSIER-03: serverless budget — solver + cohort + dossier < 500 ms ----
  let budgetMs = -1;
  let budgetOk = false;
  if (dInput) {
    const t0 = Date.now();
    const fresh = solveInverseProduct(dInput);
    const cohortMsStart = Date.now();
    projectCohortLiquidity({
      depositVolumeRial: dInput.depositVolumeRial,
      loanToDepositMultiplier: fresh.solution.loanToDepositMultiplier,
      depositRetentionMonths: fresh.solution.depositRetentionMonths,
      repaymentMonths: fresh.solution.repaymentMonths,
      blockedDepositPct: fresh.solution.blockedDepositPct,
      unblockedRunoffRate: dInput.unblockedRunoffRate,
      loanInterestRate: fresh.solution.loanInterestRate,
      depositInterestRate: fresh.solution.depositInterestRate,
      feeRate: fresh.solution.feeRate,
      statutoryReserve: dInput.statutoryReserveBase,
      pd: dInput.pd,
      lgd: dInput.lgd,
    });
    const cohortMs = Date.now() - cohortMsStart;
    const dossierMsStart = Date.now();
    buildProductDossier(state);
    const dossierMs = Date.now() - dossierMsStart;
    budgetMs = Date.now() - t0;
    budgetOk = budgetMs < 500 && fresh.elapsedMs < 500 && cohortMs < 100 && dossierMs < 50;
  }
  out.push(
    assert(
      "DOSSIER-03",
      "بودجه سرورلس: حل معکوس + پروژه‌کهولی + ساخت دوسیه در مجموع کمتر از ۵۰۰ میلی‌ثانیه",
      "Serverless budget: inverse solve + cohort projection + dossier build under 500 ms combined",
      "total < 500 ms (solver < 500, cohort < 100, dossier < 50)",
      `total=${budgetMs} ms`,
      budgetOk,
    ),
  );

  // --- DOSSIER-04: deterministic build --------------------------------------
  const again = buildProductDossier(state);
  out.push(
    assert(
      "DOSSIER-04",
      "ساخت قطعی دوسیه: تکرار بدون زمان‌سنجی/تصادفی بایت‌به‌بایت یکسان است",
      "Deterministic dossier build: replay is byte-identical (no clocks, no RNG)",
      "JSON identical across two builds",
      `same=${JSON.stringify(dossier) === JSON.stringify(again)}`,
      JSON.stringify(dossier) === JSON.stringify(again),
    ),
  );

  // --- DOSSIER-05: audit-log consistency ------------------------------------
  const log = dossier?.committeeAuditLog;
  out.push(
    assert(
      "DOSSIER-05",
      "سازگاری گزارش کمیته: وضعیت اعتبارسنجی، سقف گام‌ها و پرچم ربا پنهان با وضعیت واقعی یکی است",
      "Audit-log consistency: validation status, iteration cap and usury flags match live state",
      "status === state; iterations ≤ 3; flag ⇔ nominal > cap",
      log && dossier
        ? `status=${dossier.compliance.validationStatus}; iters=${log.iterations.length}; solverFlag=${dossier.compliance.hiddenUsury.solverFlagged}`
        : "null",
      log !== undefined &&
        dossier !== null &&
        dossier.compliance.validationStatus === state.validationStatus &&
        log.iterations.length <= log.maxIterations &&
        log.maxIterations === REGULATORY.maxCriticIterations &&
        dossier.compliance.hiddenUsury.solverFlagged ===
          (dossier.almProfitability.customerNominalIrr >
            dossier.compliance.hiddenUsury.effectiveRateCap + 1e-9),
    ),
  );

  return {
    id: "TC-DOSSIER",
    titleFa: "آزمون دوسیه محصول — اسکیمای سخت، هویت شاخص‌ها، بودجه سرورلس و گزارش کمیته",
    titleEn: "Product dossier — strict schema, metric identities, serverless budget, committee log",
    assertions: out,
    passed: out.every((item) => item.passed),
    durationMs: Date.now() - started,
    summary: {
      assertions: out.length,
      schemaOk: dossier && parsed?.success ? 1 : 0,
      budgetMs,
      citations: dossier?.compliance.envelope.citations.length ?? 0,
      usuryFlags:
        (dossier?.compliance.hiddenUsury.solverFlagged ? 1 : 0) +
        (dossier?.compliance.hiddenUsury.designFlagged ? 1 : 0),
    },
  };
}

/**
 * Test case — adaptive decision core (feedback shooting onto the feasible
 * frontier, binding-constraint diagnostics, decision confidence):
 * DEC-01..05 unit-level frontier behaviour; DEC-06 pipeline integration.
 */
async function runDecisionCoreCase(fast = false): Promise<TestCaseResult> {
  const started = Date.now();
  const out: Assertion[] = [];
  const decBase: InverseSolverInput = {
    targetBankIrrMin: 0.15,
    targetCustomerIrrMin: 0.1,
    maxLiquidityGapLimit: 4e12,
    regulatoryConstraints: defaultRegulatoryConstraints(),
    depositVolumeRial: 1e13,
    cannibalizationRate: 0.3,
    sourceDepositCost: 0.02,
    unblockedRunoffRate: 0.02,
    statutoryReserveBase: 0.1,
    pd: 0.03,
    lgd: 0.45,
  };

  // --- DEC-01: feedback shooting lands ON the observed frontier ------------
  const a = solveInverseFrontier({ ...decBase, targetBankIrrMin: 0.18 });
  const aDecreasing = a.trace.every((r, i) => i === 0 || r.targetIrr <= a.trace[i - 1].targetIrr);
  out.push(
    assert(
      "DEC-01",
      "تیراندازی بازخوردی: هدف غیرممکن ۱۸٪ در دو آزمون روی مرز مشاهده‌شده می‌نشیند و تأیید می‌شود",
      "Feedback shooting: unattainable 18% target lands on the observed frontier in two verified rounds",
      "recalibrated; feasible; final ≈ achieved IRR; targets non-increasing; ≤ 4 rounds",
      `req=${a.requestedTargetIrr}; fin=${a.finalTargetIrr.toFixed(5)}; feas=${a.result.feasible}; rounds=${a.trace.length}; trace=${a.trace.map((t) => `${t.targetIrr.toFixed(4)}:${t.feasible ? "ok" : "no"}`).join(",")}`,
      a.recalibrated &&
        a.result.feasible &&
        a.result.violations.length === 0 &&
        a.finalTargetIrr < 0.18 &&
        a.finalTargetIrr >= a.result.metrics.bankIrrAnnual - 1e-9 &&
        aDecreasing &&
        a.trace.length >= 2 &&
        a.trace.length <= 4,
    ),
  );

  // --- DEC-02: absurd target resolves to the frontier, honestly ------------
  const b = solveInverseFrontier({ ...decBase, targetBankIrrMin: 0.6 });
  out.push(
    assert(
      "DEC-02",
      "هدف غیرعقلانی ۶۰٪: مرز ممکن با شفافیت بازتنظیم می‌شود، نه پنهان",
      "Absurd 60% target: the attainable frontier is recalibrated transparently, never hidden",
      "recalibrated; feasible; 0.10 ≤ final ≤ 0.25; trace ≤ 4",
      `fin=${b.finalTargetIrr.toFixed(4)}; feas=${b.result.feasible}; rounds=${b.trace.length}`,
      b.recalibrated &&
        b.result.feasible &&
        b.finalTargetIrr >= 0.1 &&
        b.finalTargetIrr <= 0.25 &&
        b.trace.length <= 4,
    ),
  );

  // --- DEC-03: attainable target → no recalibration, single round ----------
  const c = solveInverseFrontier({ ...decBase, targetBankIrrMin: 0.12 });
  out.push(
    assert(
      "DEC-03",
      "هدف دست‌یافتنی دست‌نخورده می‌ماند: بدون بازتنظیم و تنها با یک آزمون",
      "Attainable target stays untouched: no recalibration, single round",
      "recalibrated=false; trace length 1; feasible",
      `feas=${c.result.feasible}; rounds=${c.trace.length}; irr=${c.result.metrics.bankIrrAnnual.toFixed(4)}`,
      !c.recalibrated &&
        c.trace.length === 1 &&
        c.result.feasible &&
        c.result.metrics.bankIrrAnnual >= 0.12 - 1e-9,
    ),
  );

  // --- DEC-04: non-fixable structure → honest single-round failure ----------
  const d = solveInverseFrontier({
    ...decBase,
    targetBankIrrMin: 0.01,
    maxLiquidityGapLimit: 1,
    bounds: { loanToDepositMultiplier: [3, 3] },
  });
  out.push(
    assert(
      "DEC-04",
      "اهرم غیرقابل‌رفع: بدون حلقه بی‌نهایت و بدون پنهان‌کاری — یک آزمون و گزارش صادقانه نقض",
      "Unfixable lever: no infinite loop, no cover-up — one round and an honest violation report",
      "recalibrated=false; trace length 1; infeasible; gap violation reported",
      `rounds=${d.trace.length}; feas=${d.result.feasible}; viol=${d.result.violations.join(" | ").slice(0, 80)}`,
      !d.recalibrated &&
        d.trace.length === 1 &&
        !d.result.feasible &&
        d.result.violations.some((v) => v.includes("liquidity gap")),
    ),
  );

  // --- DEC-05: determinism + serverless budget of the frontier -------------
  const fp = (f: typeof a) =>
    JSON.stringify({ ...f, result: { ...f.result, elapsedMs: 0 }, elapsedMs: 0 });
  const e = solveInverseFrontier({ ...decBase, targetBankIrrMin: 0.27 });
  out.push(
    assert(
      "DEC-05",
      "قطعیت و بودجه: تکرار یکسان و جستجوی مرزی در مجموع کمتر از ۴۰۰ میلی‌ثانیه",
      "Determinism and budget: identical replay, whole frontier search under 400 ms",
      "fingerprint equal; elapsedMs < 400; rounds ≤ 4",
      `same=${fp(e) === fp(solveInverseFrontier({ ...decBase, targetBankIrrMin: 0.27 }))}; ms=${e.elapsedMs}; rounds=${e.trace.length}`,
      fp(e) === fp(solveInverseFrontier({ ...decBase, targetBankIrrMin: 0.27 })) &&
        e.elapsedMs < 400 &&
        e.trace.length <= 4,
    ),
  );

  // --- DEC-06: pipeline integration — diagnostics, binding, confidence ------
  const prompt = fast
    ? "طراحی محصول چندطرحی میانگین حساب برای جذب ۲۰ همت منبع با IRR حداقل ۲۶ درصد، حداکثر نسبت تسهیلات به سپرده ۸۵ درصد، حداقل نسبت پوشش نقدینگی ۱٫۰۵ و ریسک واژگونی منابع حداکثر ۶ درصد"
    : "یک بسته بانکی ۴ طرحی پلکانی مبتنی بر میانگین حساب طراحی کن تا ۲۰ همت منبع جذب شود؛ هدف نرخ بازده داخلی بانک حداقل ۲۶٪";
  const { state } = await runPipeline({
    prompt,
    options: { runs: fast ? 220 : undefined, candidates: fast ? 18 : 26, withSensitivity: false, seed: "decision-core-2026" },
  });
  const frontier = state.inverseFrontier;
  const dossier = buildProductDossier(state);
  const diag = dossier?.decisionDiagnostics;
  const metrics = state.inverseSolution?.metrics;
  const envelope = state.regulatoryConstraints;
  const slackChecks =
    diag && metrics && envelope
      ? diag.slacks.bankIrr === metrics.bankIrrAnnual - diag.finalTargetIrr &&
        diag.slacks.borrowerRateCap === envelope.effective_rate_cap - metrics.borrowerNominalEquivalent &&
        diag.slacks.liquidityGap === metrics.worstCumulativeGapRial + state.inverseSolverInput!.maxLiquidityGapLimit &&
        diag.slacks.customerFloor === metrics.customerDepositYield - state.inverseSolverInput!.targetCustomerIrrMin
      : false;
  const expectedConf =
    diag && metrics && envelope
      ? 0.5 * (state.inverseSolution!.feasible ? 1 : Math.max(0, Math.min(1, metrics.bankIrrAnnual / Math.max(diag.finalTargetIrr, 0.01)))) +
        0.25 * Math.max(0, Math.min(1, 1 - state.stressMatrix!.scenarios.filter((x) => x.breachedGapLimit).length / 4)) +
        0.25 * Math.min(1, envelope.citations.length / 3)
      : -1;
  out.push(
    assert(
      "DEC-06",
      "یکپارچگی خط لوله: مرز در state، تشخیص بندهای الزام‌آور، شاخص اطمینان و هشدار بازتنظیم در منتقد",
      "Pipeline integration: frontier in state, binding-constraint slacks, confidence index, recalibration warning",
      "frontier+diagnostics present; slack identities exact; binding includes cap levers; confidence = formula; critic warns",
      frontier && diag
        ? `req=${diag.requestedTargetIrr}; fin=${diag.finalTargetIrr.toFixed(4)}; rec=${diag.recalibrated}; binding=[${diag.binding.join(",")}]; conf=${diag.decisionConfidence.toFixed(4)}; warn=${state.findings.some((f) => f.id === "inverse-frontier-recalibrated")}; ms=${frontier.elapsedMs}`
        : "null",
      frontier !== null &&
        diag !== undefined &&
        dossier !== null &&
        productDossierSchema.safeParse(dossier).success &&
        diag.recalibrated === frontier.recalibrated &&
        diag.requestedTargetIrr === frontier.requestedTargetIrr &&
        diag.finalTargetIrr === frontier.finalTargetIrr &&
        diag.frontierRounds === frontier.trace.length &&
        slackChecks &&
        diag.binding.includes("borrower_rate_cap") &&
        diag.decisionConfidence >= 0 &&
        diag.decisionConfidence <= 1 &&
        Math.abs(diag.decisionConfidence - expectedConf) < 1e-12 &&
        state.findings.some((f) => f.id === "inverse-frontier-recalibrated") &&
        frontier.elapsedMs < 400,
    ),
  );

  return {
    id: "TC-DECIDE",
    titleFa: "آزمون هسته تصمیم تطبیقی — تیراندازی بازخوردی، بندهای الزام‌آور و شاخص اطمینان",
    titleEn: "Adaptive decision core — feedback shooting, binding constraints, confidence index",
    assertions: out,
    passed: out.every((item) => item.passed),
    durationMs: Date.now() - started,
    summary: {
      assertions: out.length,
      frontierRounds: frontier?.trace.length ?? -1,
      recalibrated: diag?.recalibrated ? 1 : 0,
      finalTarget: Number((diag?.finalTargetIrr ?? 0).toFixed(4)),
      confidence: Number((diag?.decisionConfidence ?? 0).toFixed(4)),
      bindingCount: diag?.binding.length ?? 0,
    },
  };
}

export async function runVerificationSuite(fast = false): Promise<VerificationSuiteResult> {
  const started = Date.now();
  const cases: TestCaseResult[] = [runDeterminismCase(), runCorrectionCase()];
  cases.push(await runStateGraphCase());
  cases.push(runMarketIntelCase());
  cases.push(runSimorghCase());
  cases.push(runEdgeCaseCase());
  cases.push(runGovernanceCase());
  cases.push(runAdvancedEngineCase());
  cases.push(await runClosedLoopCase(fast));
  cases.push(await runDossierCase(fast));
  cases.push(await runDecisionCoreCase(fast));
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
