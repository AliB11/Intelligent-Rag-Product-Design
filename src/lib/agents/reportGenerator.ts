/**
 * app/agents/executive_report_generator.py -> TypeScript twin
 * ---------------------------------------------------------------------------
 * Compiles the final executive proposal (Persian + English), the accounting
 * entries of the synthesized structure, the regulatory compliance draft and
 * the benchmark comparison table.
 */

import {
  HEMMAT_RIAL,
  REGULATORY,
  formatNumberFa,
  formatPercent,
  rialToHemmat,
} from "../domain/constants";
import { ARCHETYPE_LABEL_FA, CONTRACT_LABEL_FA } from "../domain/guildValueChain";
import { searchBenchmarks } from "../rag/benchmarks";
import type { AlmResult, BenchmarkScheme, ModeSpec, ProductSpec, RegulatoryConstraint } from "../domain/types";
import type { AccountingEntry, AgentState, ComplianceDraftItem } from "./state";

const bToman = (rial: number) => rial / 1e10; // میلیارد تومان
const fmtBT = (rial: number, digits = 1) => formatNumberFa(bToman(rial), digits);
const fmtHemmat = (rial: number, digits = 2) => formatNumberFa(rialToHemmat(rial), digits);

export function buildAccountingEntries(state: AgentState): AccountingEntry[] {
  const product = state.product;
  const metrics = state.alm?.metrics;
  if (!product || !metrics) return [];
  const retail = product.modes[0] ?? ({} as ModeSpec);
  const merchant =
    product.modes.find((m) => m.archetype === "merchant-pos-accelerator") ?? retail;
  const corporate =
    product.modes.find((m) => m.archetype === "corporate-float-anchor") ??
    product.modes.find((m) => m.archetype === "supply-chain-gam") ??
    retail;
  const qh = product.modes.find((m) => m.contract === "qarz-hasaneh") ?? retail;

  const totalDeposits = product.modes.reduce((a, m) => a + m.depositVolumeRial, 0);
  const reserveAmount = product.modes.reduce(
    (a, m) => a + m.depositVolumeRial * m.statutoryReserve,
    0,
  );
  const blockedAmount = product.modes.reduce(
    (a, m) => a + m.depositVolumeRial * m.blockedRatio,
    0,
  );
  const closedLoopAmount = product.modes.reduce(
    (a, m) => a + m.loanBookRial * m.closedLoopRetention,
    0,
  );
  const commissionAmount = qh.loanBookRial * qh.loanRate;
  const profitReceivable =
    product.modes
      .filter((m) => m.contract !== "qarz-hasaneh")
      .reduce((a, m) => a + m.loanBookRial * m.loanRate * (m.tenorMonths / 12), 0) * 0.55;
  const elProvision = metrics.peakLoansRial * 0.02;

  return [
    {
      eventFa: "جذب منابع طرح میانگین حساب (تجمیعی)",
      eventEn: "Scheme resource attraction (cumulative)",
      debitFa: "موجودی نقد و بانک / حساب‌های مشتریان",
      creditFa: "سپرده قرض‌الحسنه و سرمایه‌گذاری — طرح‌های چندطرحی",
      amountRial: totalDeposits,
      contract: "سپرده‌گذاری",
    },
    {
      eventFa: "نزد بانک مرکزی — سپرده قانونی",
      eventEn: "Statutory reserve placed with the CBI",
      debitFa: "سپرده قانونی نزد بانک مرکزی",
      creditFa: "موجودی نقد و بانک",
      amountRial: reserveAmount,
      contract: "تنظیمی",
    },
    {
      eventFa: "انتقال سهم مسدودی هوشمند به وثیقه نقدی",
      eventEn: "Smart blocking reclassified to cash collateral",
      debitFa: `سپرده سرمایه‌گذاری — ${retail.nameFa}`,
      creditFa: "سپرده مسدودشده (وثیقه نقدی تسهیلات)",
      amountRial: blockedAmount,
      contract: "وثیقه",
    },
    {
      eventFa: "اعطای تسهیلات قرض‌الحسنه میانگینی",
      eventEn: "QH average-balance facility disbursement",
      debitFa: "تسهیلات قرض‌الحسنه اعطایی",
      creditFa: "موجودی نقد و بانک / حساب جاری مشتری",
      amountRial: qh.loanBookRial,
      contract: CONTRACT_LABEL_FA[qh.contract],
    },
    {
      eventFa: "شناسایی کارمزد تسهیلات قرض‌الحسنه (درآمد غیرمشاع)",
      eventEn: "QH commission recognised (non-joint income)",
      debitFa: "سپرده قرض‌الحسنه مشتریان",
      creditFa: "درآمد غیرمشاع — کارمزد تسهیلات",
      amountRial: commissionAmount,
      contract: "قرض‌الحسنه",
    },
    {
      eventFa: "هدایت تسهیلات به پذیرندگان و تأمین‌کنندگان همان بانک (حلقه بسته γ)",
      eventEn: "Closed-loop routing to in-house merchants/suppliers",
      debitFa: "تسهیلات اعطایی — پذیرندگان و زنجیره تأمین",
      creditFa: `سپرده جاری پذیرندگان — ${merchant.nameFa}`,
      amountRial: closedLoopAmount,
      contract: "حلقه بسته",
    },
    {
      eventFa: "شناسایی سود عقود مبادله‌ای دریافتنی (درآمد مشاع)",
      eventEn: "Accrued Morabaha profit receivable (joint income)",
      debitFa: "سود تسهیلات دریافتنی",
      creditFa: "درآمد مشاع تسهیلات",
      amountRial: profitReceivable,
      contract: "مرابحه / خرید دین",
    },
    {
      eventFa: "ذخیره کاهش ارزش تسهیلات (زیان اعتباری مورد انتظار)",
      eventEn: "Expected credit-loss provisioning",
      debitFa: "هزینه مطالبات مشکوک‌الوصول",
      creditFa: "ذخیره کاهش ارزش تسهیلات",
      amountRial: elProvision,
      contract: "ریسک اعتباری",
    },
    {
      eventFa: "سهم‌الربده سپرده‌های سرمایه‌گذاری و هزینه عملیاتی",
      eventEn: "Investment-deposit profit share & operating cost",
      debitFa: "سهم‌الربده علی‌الحساب سپرده‌ها / هزینه عملیاتی",
      creditFa: "سپرده سرمایه‌گذاری — هزینه‌های اداری",
      amountRial:
        product.modes.reduce((a, m) => a + m.depositVolumeRial * (m.depositRate + m.opexRatio), 0) * 0.5,
      contract: "مضاربه",
    },
    {
      eventFa: "استقرار منابع مازاد در اوراق خزانه و بازار بین‌بانکی",
      eventEn: "Surplus deployed into treasury paper & interbank",
      debitFa: "سرمایه‌گذاری در اوراق بهادار دولتی",
      creditFa: `موجودی نقد و بانک — ${corporate.nameFa}`,
      amountRial: Math.max(0, totalDeposits * (1 - product.blendedStatutoryReserve) - product.totalLoanBookRial),
      contract: "خزانه‌داری",
    },
  ];
}

export function buildComplianceDraft(state: AgentState): ComplianceDraftItem[] {
  const product = state.product;
  const metrics = state.alm?.metrics;
  if (!product || !metrics) return [];
  const items: ComplianceDraftItem[] = [];

  product.modes.forEach((m) => {
    const ceiling =
      m.contract === "qarz-hasaneh"
        ? REGULATORY.qarzHasanehMaxCommission
        : m.contract === "morabaha" || m.contract === "mudaraba"
          ? REGULATORY.morabahaMaxRate
          : REGULATORY.absoluteRateCeiling;
    items.push({
      code: `RATE-${m.id}`,
      titleFa: `رعایت سقف نرخ برای «${m.nameFa}»`,
      requirementFa: `نرخ ${formatPercent(m.loanRate)} در برابر سقف مصوب ${formatPercent(ceiling)} برای عقد ${CONTRACT_LABEL_FA[m.contract]} — ${m.loanRate <= ceiling ? "مطابق" : "نیازمند اصلاح"}.`,
      statusFa: m.loanRate <= ceiling ? "مطابق مقررات" : "عدم انطباق",
      severity: "mandatory",
    });
    items.push({
      code: `AFFORD-${m.id}`,
      titleFa: `توان بازپرداخت «${m.nameFa}»`,
      requirementFa: `قسط ماهانه ${formatNumberFa(m.monthlyInstallmentToman, 0)} تومان برابر ${formatPercent(m.installmentToIncome, 1)} از درآمد خالص پرسونا (سقف ۴۰٪).`,
      statusFa: m.installmentToIncome <= 0.4 ? "مطابق مقررات" : "نیازمند تمدید سررسید",
      severity: "mandatory",
    });
    items.push({
      code: `NPV-${m.id}`,
      titleFa: `معادل عملیاتی «${m.nameFa}»`,
      requirementFa: `ارزش فعلی خالص جریان نقد بانک ${fmtBT(m.npvBankRial)} میلیارد تومان در نرخ مانع ${formatPercent(product.hurdleRate)}.`,
      statusFa: m.npvBankRial >= 0 ? "معادل عملیاتی برقرار است" : "هشدار: معادل عملیاتی منفی",
      severity: m.npvBankRial >= 0 ? "mandatory" : "advisory",
    });
  });

  items.push({
    code: "SOLV-LDR",
    titleFa: "قاعده انحلال‌پذیری LDR",
    requirementFa: `صدک ۹۵ نسبت خالص تسهیلات به سپرده ${formatPercent(metrics.p95Ldr, 2)} در برابر سقف ${formatPercent(REGULATORY.ldrCeiling)}.`,
    statusFa: metrics.p95Ldr <= REGULATORY.ldrCeiling ? "مطابق" : "نقض — نیازمند بازطراحی",
    severity: "mandatory",
  });
  items.push({
    code: "SOLV-LCR",
    titleFa: "کفایت پوشش نقدینگی LCR",
    requirementFa: `صدک ۵ نسبت پوشش نقدینگی ${formatNumberFa(metrics.p5Lcr, 2)} در برابر کف ${REGULATORY.lcrFloor}.`,
    statusFa: metrics.p5Lcr >= REGULATORY.lcrFloor ? "مطابق" : "نقض — نیازمند بازطراحی",
    severity: "mandatory",
  });
  items.push({
    code: "OVERTURN",
    titleFa: "ریسک واژگونی منابع",
    requirementFa: `شوک واژگونی صدک ۹۵ برابر ${formatPercent(metrics.overturningShock, 2)} و خالص خروج نقدینگی ${formatPercent(metrics.netLiquidityDrainRatio, 2)} از منابع جذب‌شده.`,
    statusFa:
      metrics.overturningShock <= (state.request?.maxOverturningShock ?? 0.06)
        ? "در محدوده تحمل ریسک"
        : "فراتر از تحمل ریسک",
    severity: "mandatory",
  });
  items.push({
    code: "GATE-SAMAT",
    titleFa: "دروازه‌های اعتبارسنجی پیش از اعطا",
    requirementFa:
      "استعلام سامات، رفع سوءاثر چک برگشتی (صیاد)، احراز اظهارنامه مالیاتی در سامانه مؤدیان و تطبیق فهرست‌های مبارزه با پولشویی برای همه متقاضیان الزامی است.",
    statusFa: "در گردش کار اعطا تعبیه شد",
    severity: "mandatory",
  });
  items.push({
    code: "CUSTOMER-9",
    titleFa: "نُه اصل حمایت از مشتریان",
    requirementFa:
      "اعلام کتبی نرخ مؤثر کل، ممنوعیت فروش تجمیعی، امکان انتقال امتیاز به بستگان درجه یک، گزارش دوره‌ای عملکرد طرح و رسیدگی به شکایت ظرف ۱۵ روز کاری.",
    statusFa: "پیش‌نویس قرارداد مطابق نُه اصل تنظیم شد",
    severity: "mandatory",
  });

  return items;
}

export function compareWithBenchmarks(state: AgentState): BenchmarkScheme[] {
  const product = state.product;
  if (!product) return [];
  const terms = [
    ...product.modes.flatMap((m) => [m.nameFa, CONTRACT_LABEL_FA[m.contract]]),
    state.persona?.titleFa ?? "",
    state.ecosystem?.titleFa ?? "",
    "میانگین حساب",
    "پذیرنده",
  ].filter(Boolean);
  return searchBenchmarks(terms.join(" "), 10);
}

export function buildExecutiveReportFa(state: AgentState): string {
  const req = state.request;
  const product = state.product;
  const m = state.alm?.metrics;
  if (!req || !product || !m) return "";

  const modeLines = product.modes
    .map((mode, i) => {
      return [
        `### ${i + 1}) ${mode.nameFa} — «${ARCHETYPE_LABEL_FA[mode.archetype]}»`,
        `- عقد: ${CONTRACT_LABEL_FA[mode.contract]} | سهم از منابع: ${formatPercent(mode.weight, 1)} معادل ${fmtHemmat(mode.depositVolumeRial)} همت (${fmtBT(mode.depositVolumeRial)} میلیارد تومان)`,
        `- دوره خواب سپرده τ_d = ${mode.sleepMonths} ماه | صف انتظار ω = ${mode.waitingMonths} ماه | سررسید بازپرداخت τ_l = ${mode.tenorMonths} ماه`,
        `- ضریب تسهیلات α = ${formatNumberFa(mode.loanMultiplier, 2)} | نرخ/کارمزد r_l = ${formatPercent(mode.loanRate, 2)} | مسدودی β = ${formatPercent(mode.blockedRatio, 1)} (${mode.blockRelease === "midpoint" ? "آزادسازی میانی" : mode.blockRelease === "linear" ? "آزادسازی خطی" : "آزادسازی در سررسید"})`,
        `- ماندگاری حلقه بسته γ = ${formatPercent(mode.closedLoopRetention, 1)} | برداشت آزاد δ = ${formatPercent(mode.withdrawalFractionMean, 1)} | ضریب منبع κ = ${formatNumberFa(mode.sourceKappa, 2)}`,
        `- هزینه تمام‌شده منابع CoF = ${formatPercent(mode.costOfFunds, 2)} (سپرده قانونی ${formatPercent(mode.statutoryReserve, 1)}، ضریب نقدینگی ${formatPercent(mode.liquidityDeduction, 1)}، هزینه عملیاتی ${formatPercent(mode.opexRatio, 2)}، زیان مورد انتظار ${formatPercent(mode.expectedLoss, 2)})`,
        `- دفتر تسهیلات ${fmtBT(mode.loanBookRial)} میلیارد تومان در ${formatNumberFa(mode.customers, 0)} فقره | میانگین مبلغ ${formatNumberFa(mode.avgTicketToman, 0)} تومان | قسط ${formatNumberFa(mode.monthlyInstallmentToman, 0)} تومان (${formatPercent(mode.installmentToIncome, 1)} درآمد)`,
        `- معادل عملیاتی NPV بانک = ${fmtBT(mode.npvBankRial)} میلیارد تومان ${mode.npvBankRial >= 0 ? "✓" : "✗"}`,
      ].join("\n");
    })
    .join("\n\n");

  const constraintLines = state.constraints
    .map((c, i) => `${i + 1}. **${c.titleFa}** — ${c.authority} (امتیاز بازیابی ${formatNumberFa(c.relevance, 2)})\n   ${c.bodyFa}`)
    .join("\n");

  const guildBlock = state.ecosystem
    ? [
        "## ۴) زیست‌بوم حلقه بسته صنفی",
        `**لنگر زنجیره:** ${state.ecosystem.anchorFa}`,
        `**گلوگاه نقدینگی:** ${state.ecosystem.bottleneckFa}`,
        "",
        ...state.ecosystem.valueChainFa.map((v) => `- ${v}`),
        "",
        `**هدف ماندگاری حلقه بسته γ:** ${formatPercent(state.ecosystem.gammaTarget, 0)}`,
        `**درجه بسته‌بودن اکوسیستم:** ${formatPercent(state.ecosystem.loopClosure, 0)}`,
      ].join("\n")
    : "";

  const iterationLines = state.iterations
    .map(
      (it) =>
        `- گام ${it.iteration}: امتیاز هدف ${formatNumberFa(it.score, 3)} | IRR ${formatPercent(it.irrAnnual, 2)} | p95 LDR ${formatPercent(it.p95Ldr, 2)} | p5 LCR ${formatNumberFa(it.p5Lcr, 2)} | واژگونی ${formatPercent(it.overturningShock, 2)}${it.feasible ? " — **موجه**" : " — نیازمند خوداصلاحی"}`,
    )
    .join("\n");

  return [
    `# پیشنهاد مدیریتی محصول بانکی «${product.titleFa}»`,
    "",
    `**کد محصول:** ${product.code} | **تاریخ تولید:** ${new Date().toLocaleDateString("fa-IR")} | **افق شبیه‌سازی:** ${product.modes.length ? state.alm?.horizonMonths ?? 60 : 60} ماه | **اجرای مونت‌کارلو:** ${formatNumberFa(state.alm?.monteCarloRuns ?? 0, 0)} مسیر`,
    "",
    "## ۱) خلاصه مدیریتی",
    `درخواست راهبردی کاربر به تابع هدف و قیود صوری با هدف جذب **${fmtHemmat(req.targetDepositsHemmat)} همت** (${fmtBT(req.targetDepositsRial)} میلیارد تومان) منبع و نرخ بازده داخلی هدف **${formatPercent(req.targetIrr, 1)}** ترجمه شد. حل‌کننده معکوس MILP/MINLP یک ماتریس **${product.modes.length}-طرحی پلکانی** با عنوان «${product.titleFa}» سنتز کرد و دوقلوی دیجیتال ALM آن را در ${state.alm?.horizonMonths ?? 60} ماه و ${formatNumberFa(state.alm?.monteCarloRuns ?? 0, 0)} مسیر مونت‌کارلو آزمون تنش کرد.`,
    "",
    `| سنجه | مقدار | هدف/حد | وضعیت |`,
    `| --- | --- | --- | --- |`,
    `| IRR بانک (سالانه) | ${formatPercent(m.irrBankAnnual, 2)} | ≥ ${formatPercent(req.targetIrr, 1)} | ${m.irrBankAnnual >= req.targetIrr ? "✓ تحقق" : "✗ کسری"} |`,
    `| ROI تجمیعی ۵ ساله | ${formatPercent(m.roi, 1)} | ≥ ${formatPercent(req.targetRoi, 0)} | ${m.roi >= req.targetRoi ? "✓" : "✗"} |`,
    `| ROE سالانه | ${formatPercent(m.roe, 2)} | ≥ ${formatPercent(req.targetRoe, 1)} | ${m.roe >= req.targetRoe ? "✓" : "✗"} |`,
    `| NIM (مشاع + غیرمشاع) | ${formatPercent(m.nim, 2)} | ≥ ${formatPercent(req.targetNim, 1)} | ${m.nim >= req.targetNim ? "✓" : "✗"} |`,
    `| p95 نسبت تسهیلات به سپرده | ${formatPercent(m.p95Ldr, 2)} | ≤ ${formatPercent(REGULATORY.ldrCeiling)} | ${m.p95Ldr <= REGULATORY.ldrCeiling ? "✓" : "✗"} |`,
    `| p5 نسبت پوشش نقدینگی | ${formatNumberFa(m.p5Lcr, 2)} | ≥ ${REGULATORY.lcrFloor} | ${m.p5Lcr >= REGULATORY.lcrFloor ? "✓" : "✗"} |`,
    `| شوک واژگونی منابع (p95) | ${formatPercent(m.overturningShock, 2)} | ≤ ${formatPercent(req.maxOverturningShock, 2)} | ${m.overturningShock <= req.maxOverturningShock ? "✓" : "✗"} |`,
    `| خالص خروج نقدینگی | ${formatPercent(m.netLiquidityDrainRatio, 2)} | نزدیک صفر | ${m.netLiquidityDrainRatio <= 0.05 ? "✓" : "△"} |`,
    "",
    `**اوج دفتر تسهیلات:** ${fmtBT(m.peakLoansRial)} میلیارد تومان | **اوج منابع:** ${fmtBT(m.peakDepositsRial)} میلیارد تومان | **کل تسهیلات اعطایی:** ${fmtBT(m.totalFacilitiesOriginatedRial)} میلیارد تومان | **سرمایه اقتصادی برنامه:** ${fmtBT(m.economicCapitalRial)} میلیارد تومان`,
    "",
    "## ۲) اهداف و محدودیت‌های استخراج‌شده از پیام کاربر",
    req.parsedTokens
      .map((t) => `- \`${t.raw}\` → ${t.kind} = ${typeof t.value === "number" ? formatNumberFa(t.value, 4) : t.value}`)
      .join("\n"),
    req.emphases.length ? `\n**تأکیدهای راهبردی:** ${req.emphases.join("، ")}` : "",
    `\n**وزن‌های تابع هدف (λ):** λ₁=${formatNumberFa(req.lambdas.lambda1Irr, 3)} (IRR)، λ₂=${formatNumberFa(req.lambdas.lambda2Adoption, 3)} (پذیرش مشتری)، λ₃=${formatNumberFa(req.lambdas.lambda3LdrPenalty, 3)} (جریمه LDR)، λ₄=${formatNumberFa(req.lambdas.lambda4Overturning, 3)} (واژگونی منابع)`,
    "",
    "## ۳) مقررات بازیابی‌شده از پایگاه دانش بانک مرکزی (RAG)",
    constraintLines || "- موردی بازیابی نشد.",
    "",
    guildBlock,
    "",
    "## ۵) ماتریس چندطرحی محصول سنتزشده",
    modeLines,
    "",
    "## ۶) مسیر خوداصلاحی ممیز (Critic Auditor)",
    iterationLines || "- ساختار در نخستین ارزیابی موجه تشخیص داده شد.",
    "",
    "## ۷) سندهای حسابداری پیشنهادی",
    state.accountingEntries
      .map(
        (e, i) =>
          `${i + 1}. **${e.eventFa}** — بدهکار: ${e.debitFa} / بستانکار: ${e.creditFa} — مبلغ ${fmtBT(e.amountRial)} میلیارد تومان`,
      )
      .join("\n"),
    "",
    "## ۸) پیش‌نویس انطباق مقرراتی",
    state.complianceDraft
      .map((c) => `- **[${c.code}] ${c.titleFa}** — ${c.requirementFa} — وضعیت: ${c.statusFa}`)
      .join("\n"),
    "",
    "## ۹) مقایسه با بنچمارک‌های بازار ایران",
    state.benchmarks
      .slice(0, 8)
      .map(
        (b) =>
          `- **${b.bank} — ${b.productFa}**: سقف ${formatNumberFa(b.ceilingToman / 1e6, 0)} میلیون تومان${b.profitRate ? `، نرخ ${formatPercent(b.profitRate, 1)}` : ""}${b.feeRate ? `، کارمزد ${formatPercent(b.feeRate, 1)}` : ""}${b.tenorMonths ? `، سررسید ${b.tenorMonths} ماه` : ""}${b.sleepMonths ? `، خواب ${b.sleepMonths} ماه` : ""}.`,
      )
      .join("\n"),
    "",
    "## ۱۰) ریسک‌های باقیمانده و توصیه‌های اجرا",
    `- مانیتورینگ ماهانه p95 LDR و p5 LCR در داشبورد ALCO با هشدار خودکار در آستانه ${formatPercent(REGULATORY.ldrWarning)}.`,
    `- فعال‌سازی آزادسازی پلکانی مسدودی تنها پس از تأیید خوش‌حسابی در سامانه اعتبارسنجی.`,
    `- انعقاد قرارداد تسویه مستقیم با تأمین‌کنندگان و پذیرندگان جهت تضمین γ ≥ ${formatPercent(product.blendedClosedLoopRetention, 0)} در عملیات واقعی.`,
    `- بازبینی فصلی نرخ‌ها در صورت تغییر مصوبات شورای پول و اعتبار و به‌روزرسانی پایگاه دانش RAG.`,
    `- اجرای آزمون تحمل سناریوی «هجوم شدید» پیش از عرضه عمومی محصول.`,
    "",
    `**جمع‌بندی:** ${state.findings.filter((f) => f.severity === "blocker").length === 0 ? "ساختار سنتزشده تمامی قیود انحصاری بانک مرکزی و حدود تحمل ریسک درخواست‌شده را ارضا می‌کند و آماده تصویب در کمیته محصولات است." : "ساختار پس از " + state.iterations.length + " گام خوداصلاحی به مرز انطباق رسیده است؛ موارد باقیمانده در بخش انطباق درج شده و نیازمند تصمیم مدیریتی است."}`,
  ]
    .filter((line) => line !== undefined)
    .join("\n");
}

export function buildExecutiveReportEn(state: AgentState): string {
  const req = state.request;
  const product = state.product;
  const m = state.alm?.metrics;
  if (!req || !product || !m) return "";
  return [
    `# Executive product specification — ${product.titleEn} (${product.code})`,
    "",
    `Target resources: ${(req.targetDepositsRial / HEMMAT_RIAL).toFixed(2)} Hemmat (${(req.targetDepositsRial / 1e9).toFixed(0)} B Rial) | Horizon: ${state.alm?.horizonMonths ?? 60} months | Monte Carlo runs: ${state.alm?.monteCarloRuns ?? 0}`,
    "",
    `| Metric | Value | Target | Status |`,
    `| --- | --- | --- | --- |`,
    `| Bank IRR (annual) | ${(m.irrBankAnnual * 100).toFixed(2)}% | >= ${(req.targetIrr * 100).toFixed(1)}% | ${m.irrBankAnnual >= req.targetIrr ? "PASS" : "FAIL"} |`,
    `| ROI (cumulative) | ${(m.roi * 100).toFixed(1)}% | >= ${(req.targetRoi * 100).toFixed(0)}% | ${m.roi >= req.targetRoi ? "PASS" : "FAIL"} |`,
    `| ROE (annual) | ${(m.roe * 100).toFixed(2)}% | >= ${(req.targetRoe * 100).toFixed(1)}% | ${m.roe >= req.targetRoe ? "PASS" : "FAIL"} |`,
    `| NIM | ${(m.nim * 100).toFixed(2)}% | >= ${(req.targetNim * 100).toFixed(1)}% | ${m.nim >= req.targetNim ? "PASS" : "FAIL"} |`,
    `| p95 net LDR | ${(m.p95Ldr * 100).toFixed(2)}% | <= ${(req.ldrCeiling * 100).toFixed(0)}% | ${m.p95Ldr <= req.ldrCeiling ? "PASS" : "FAIL"} |`,
    `| p5 LCR | ${m.p5Lcr.toFixed(2)} | >= ${req.lcrFloor.toFixed(2)} | ${m.p5Lcr >= req.lcrFloor ? "PASS" : "FAIL"} |`,
    `| Overturning shock (p95) | ${(m.overturningShock * 100).toFixed(2)}% | <= ${(req.maxOverturningShock * 100).toFixed(2)}% | ${m.overturningShock <= req.maxOverturningShock ? "PASS" : "FAIL"} |`,
    `| Net liquidity drain | ${(m.netLiquidityDrainRatio * 100).toFixed(2)}% | ~0 | ${m.netLiquidityDrainRatio <= 0.05 ? "PASS" : "WATCH"} |`,
    "",
    "## Mode matrix",
    ...product.modes.map((mode, i) =>
      `${i + 1}. **${mode.nameEn}** (${mode.contract}) — w=${(mode.weight * 100).toFixed(1)}%, tau_d=${mode.sleepMonths}m, omega=${mode.waitingMonths}m, tau_l=${mode.tenorMonths}m, alpha=${mode.loanMultiplier.toFixed(2)}, r_l=${(mode.loanRate * 100).toFixed(2)}%, beta=${(mode.blockedRatio * 100).toFixed(1)}%, gamma=${(mode.closedLoopRetention * 100).toFixed(1)}%, delta=${(mode.withdrawalFractionMean * 100).toFixed(1)}%, kappa=${mode.sourceKappa}, CoF=${(mode.costOfFunds * 100).toFixed(2)}%, NPV=${(mode.npvBankRial / 1e9).toFixed(1)}B Rial`,
    ),
    "",
    "## Retrieved CBI constraints",
    ...state.constraints.map((c) => `- **${c.titleEn}** (${c.authority}) — relevance ${(c.relevance * 100).toFixed(0)}%`),
    "",
    "## Self-correction trace",
    ...state.iterations.map(
      (it) =>
        `- Iteration ${it.iteration}: score ${it.score.toFixed(3)}, IRR ${(it.irrAnnual * 100).toFixed(2)}%, p95 LDR ${(it.p95Ldr * 100).toFixed(2)}%, p5 LCR ${it.p5Lcr.toFixed(2)}, overturning ${(it.overturningShock * 100).toFixed(2)}% ${it.feasible ? "[FEASIBLE]" : ""}`,
    ),
    "",
    "## Compliance draft",
    ...state.complianceDraft.map((c) => `- [${c.code}] ${c.requirementFa}`),
  ].join("\n");
}
