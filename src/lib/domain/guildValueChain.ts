/**
 * app/domain/guild_value_chain.py -> TypeScript twin
 * ---------------------------------------------------------------------------
 * Maps an occupational / guild segment into a tripartite closed-loop
 * ecosystem (anchor ↔ B2B suppliers ↔ B2C clients) and derives the
 * recommended mode archetypes and the achievable closed-loop retention γ.
 */

import type {
  ContractType,
  GuildEcosystem,
  ModeArchetype,
  PersonaSpec,
} from "./types";

export const PERSONAS: PersonaSpec[] = [
  {
    key: "physician-specialist",
    titleFa: "پزشکان متخصص و کلینیک‌های درمانی",
    titleEn: "Specialist physicians & medical clinics",
    monthlyNetIncomeToman: 380e6,
    population: 148000,
    cashFlowBottleneckFa:
      "تأخیر ۴۵ تا ۱۲۰ روزه دریافت مطالبات از بیمه‌ها و صندوق‌های درمانی و نیاز فوری به نقدینگی برای تجهیزات و دارو",
    b2bSuppliersFa: [
      "شرکت‌های تجهیزات پزشکی و تصویربرداری",
      "داروخانه‌های زنجیره‌ای و شرکت‌های پخش دارو",
      "آزمایشگاه‌های مرجع و مراکز تصویربرداری",
      "تأمین‌کنندگان مواد مصرفی دندانپزشکی",
    ],
    b2cClientsFa: [
      "بیماران سرپایی و بستری",
      "بیماران دندانپزشکی و چشم‌پزشکی",
      "کارکنان شرکت‌های طرف قرارداد (پزشکی سازمانی)",
    ],
    settlementRailsFa: [
      "پایانه POS مطب و کلینیک",
      "درگاه پرداخت اینترنتی نوبت‌دهی",
      "تنخواه بیمه‌ای و خرید دین مطالبات بیمه",
    ],
    closedLoopPotential: 0.78,
    sourceKappa: 1.5,
    pd: 0.011,
    lgd: 0.16,
    preferredContracts: ["qarz-hasaneh", "morabaha", "kharid-deyn", "bnpl"],
  },
  {
    key: "dental-clinic",
    titleFa: "دندانپزشکان و کلینیک‌های دندانپزشکی",
    titleEn: "Dentists & dental clinics",
    monthlyNetIncomeToman: 340e6,
    population: 42000,
    cashFlowBottleneckFa:
      "سرمایه‌بری بالای تجهیز یونیت و مواد مصرفی وارداتی و بازگشت سرمایه ۱۸ تا ۳۶ ماهه",
    b2bSuppliersFa: [
      "واردکنندگان یونیت و تجهیزات دندانپزشکی",
      "توزیع‌کنندگان مواد ترمیمی و ایمپلنت",
      "آزمایشگاه‌های پروتز و لابراتوار دندانسازی",
    ],
    b2cClientsFa: ["بیماران ایمپلنت و ارتودنسی", "بیماران زیبایی و ترمیمی"],
    settlementRailsFa: ["POS مطب", "درگاه پرداخت اقساطی (BNPL) بیمار", "قرارداد با بیمه‌های تکمیلی"],
    closedLoopPotential: 0.74,
    sourceKappa: 1.5,
    pd: 0.013,
    lgd: 0.18,
    preferredContracts: ["qarz-hasaneh", "morabaha", "bnpl", "joalah"],
  },
  {
    key: "pharmacy",
    titleFa: "داروخانه‌ها و شرکت‌های پخش دارو",
    titleEn: "Pharmacies & drug distribution",
    monthlyNetIncomeToman: 210e6,
    population: 26000,
    cashFlowBottleneckFa:
      "گردش موجودی سریع با حاشیه سود کم و مطالبات معوق از سازمان غذا و دارو و بیمه‌ها",
    b2bSuppliersFa: ["شرکت‌های پخش سراسری دارو", "تولیدکنندگان داخلی دارو", "واردکنندگان داروهای خاص"],
    b2cClientsFa: ["بیماران مزمن", "مراجعین آزاد", "مراكز درمانی طرف قرارداد"],
    settlementRailsFa: ["POS داروخانه", "خرید دین نسخ الکترونیک", "اعتبار زنجیره تأمین گام"],
    closedLoopPotential: 0.81,
    sourceKappa: 1.5,
    pd: 0.014,
    lgd: 0.2,
    preferredContracts: ["kharid-deyn", "gam", "qarz-hasaneh"],
  },
  {
    key: "logistics-driver",
    titleFa: "شرکت‌های حمل‌ونقل و رانندگان ناوگان جاده‌ای",
    titleEn: "Logistics firms & road-fleet drivers",
    monthlyNetIncomeToman: 68e6,
    population: 410000,
    cashFlowBottleneckFa:
      "پرداخت کرایه با تأخیر ۳۰ تا ۹۰ روزه پس از تحویل بارنامه و هزینه جاری گازوئیل، لاستیک و تعمیرات",
    b2bSuppliersFa: [
      "پایانه‌های بار و شرکت‌های باربری",
      "تأمین‌کنندگان لاستیک و روغن و قطعات",
      "جایگاه‌های سوخت و ناوگان تعمیرگاهی",
    ],
    b2cClientsFa: ["رانندگان صاحب‌کامیون", "صاحبان کالا و کارخانجات", "باربری‌های آنلاین"],
    settlementRailsFa: ["بارنامه الکترونیکی ثبت‌شده", "کیف پول راننده", "حساب وکالتی کرایه"],
    closedLoopPotential: 0.72,
    sourceKappa: 1.3,
    pd: 0.026,
    lgd: 0.3,
    preferredContracts: ["kharid-deyn", "morabaha", "joalah"],
  },
  {
    key: "pos-merchant",
    titleFa: "پذیرندگان POS و فروشگاه‌های زنجیره‌ای",
    titleEn: "POS merchants & retail chains",
    monthlyNetIncomeToman: 145e6,
    population: 2_350_000,
    cashFlowBottleneckFa:
      "چرخه تسویه T+1 و نیاز به سرمایه در گردش برای تأمین موجودی فصلی",
    b2bSuppliersFa: ["بنکداران و عمده‌فروشان", "تولیدکنندگان داخلی", "شرکت‌های پخش مویرگی"],
    b2cClientsFa: ["خرده‌مشتریان", "باشگاه مشتریان", "فروش اقساطی کالا"],
    settlementRailsFa: ["پایانه فروشگاهی", "درگاه پرداخت اینترنتی", "کیف پول و اعتبار مشتری (BNPL)"],
    closedLoopPotential: 0.86,
    sourceKappa: 1.5,
    pd: 0.019,
    lgd: 0.22,
    preferredContracts: ["qarz-hasaneh", "joalah", "bnpl", "kharid-deyn"],
  },
  {
    key: "corporate-payroll",
    titleFa: "شرکت‌های حقوق‌بگیر و کارکنان سازمانی",
    titleEn: "Corporates & payroll employees",
    monthlyNetIncomeToman: 42e6,
    population: 6_400_000,
    cashFlowBottleneckFa:
      "نیاز خرد به اعتبار مصرفی بین دو حقوق و هزینه‌های پیش‌بینی نشده درمان و تحصیل",
    b2bSuppliersFa: ["کارفرمایان و سازمان‌های دولتی", "فروشندگان کالای خانگی", "مراکز آموزشی و درمانی"],
    b2cClientsFa: ["کارکنان حقوق‌بگیر", "بازنشستگان", "خانواده درجه یک کارکنان"],
    settlementRailsFa: ["واریز حقوق", "کسر اقساط از حقوق", "اعتبار مصرفی سازمانی"],
    closedLoopPotential: 0.62,
    sourceKappa: 1.3,
    pd: 0.021,
    lgd: 0.19,
    preferredContracts: ["qarz-hasaneh", "morabaha", "bnpl"],
  },
  {
    key: "industrial-supplier",
    titleFa: "صنایع و زنجیره تأمین تولیدی (اوراق گام)",
    titleEn: "Industrial supply chain (Gam certificates)",
    monthlyNetIncomeToman: 900e6,
    population: 96000,
    cashFlowBottleneckFa:
      "کمبود سرمایه در گردش خرید مواد اولیه و مطالبات مدت‌دار از خریداران بزرگ",
    b2bSuppliersFa: ["تأمین‌کنندگان مواد اولیه", "سازندگان قطعه", "پیمانکاران جزء"],
    b2cClientsFa: ["خریداران صنعتی بزرگ", "شبکه توزیع", "صادرات"],
    settlementRailsFa: ["انتشار و تنزیل اوراق گام", "خرید دین فاکتور", "اعتبار اسنادی داخلی"],
    closedLoopPotential: 0.88,
    sourceKappa: 1.4,
    pd: 0.024,
    lgd: 0.28,
    preferredContracts: ["gam", "kharid-deyn", "morabaha"],
  },
  {
    key: "gold-jeweller",
    titleFa: "طلافروشان و صندوق‌های امانات شمش",
    titleEn: "Gold jewellers & bullion custody",
    monthlyNetIncomeToman: 260e6,
    population: 34000,
    cashFlowBottleneckFa: "نوسان قیمت طلا و نیاز به پوشش ریسک موجودی و تأمین شمش استاندارد",
    b2bSuppliersFa: ["کارگاه‌های ریخته‌گری", "تأمین‌کنندگان شمش ۲۴ عیار", "صرافی‌های مجاز"],
    b2cClientsFa: ["خرده‌سرمایه‌گذاران طلا", "صندوق‌های امانات"],
    settlementRailsFa: ["حساب امانات و نگهداری شمش", "گواهی سپرده کالا", "POS طلافروشی"],
    closedLoopPotential: 0.68,
    sourceKappa: 1.2,
    pd: 0.028,
    lgd: 0.24,
    preferredContracts: ["morabaha", "joalah", "gam"],
  },
  {
    key: "retail-vulnerable",
    titleFa: "اقشار آسیب‌پذیر، روستاییان و زنان سرپرست خانوار",
    titleEn: "Vulnerable, rural & female-headed households",
    monthlyNetIncomeToman: 18e6,
    population: 8_900_000,
    cashFlowBottleneckFa: "دسترسی محدود به اعتبار رسمی و نیاز به مشاغل خانگی خرد",
    b2bSuppliersFa: ["تعاونی‌های روستایی", "تأمین‌کنندگان نهاده کشاورزی", "کارگاه‌های خانگی"],
    b2cClientsFa: ["خانوارهای روستایی", "مشاغل خانگی", "کمیته امداد و صندوق‌های خرد"],
    settlementRailsFa: ["صندوق‌های اجتماعی ۰٪", "کیف پول یارانه", "وام‌های خرد قرض‌الحسنه"],
    closedLoopPotential: 0.55,
    sourceKappa: 1.0,
    pd: 0.032,
    lgd: 0.32,
    preferredContracts: ["qarz-hasaneh", "joalah"],
  },
];

export const personaByKey = (key: string | null): PersonaSpec | null =>
  PERSONAS.find((p) => p.key === key) ?? null;

/** Tripartite closed-loop ecosystem construction. */
export function buildGuildEcosystem(
  persona: PersonaSpec,
  gammaTarget?: number,
): GuildEcosystem {
  const supplierShare = 0.45;
  const clientShare = 0.55;
  const loopClosure = clamp01(
    0.55 +
      persona.closedLoopPotential * 0.4 +
      (persona.sourceKappa - 1) * 0.25,
  );
  const recommended: ModeArchetype[] = ["retail-qarz-average", "merchant-pos-accelerator"];
  if (persona.closedLoopPotential >= 0.75) recommended.push("supply-chain-gam");
  if (persona.population > 1_000_000 || persona.key === "corporate-payroll")
    recommended.push("corporate-float-anchor");
  if (persona.monthlyNetIncomeToman >= 200e6) recommended.push("investment-deposit");

  const suppliers = persona.b2bSuppliersFa.map((name, i) => ({
    name,
    instrument:
      i === 0
        ? "اعتبار زنجیره تأمین / اوراق گام"
        : i % 2 === 0
          ? "خرید دین فاکتور (Factoring)"
          : "مرابحه تأمین موجودی",
    share: supplierShare / persona.b2bSuppliersFa.length,
  }));
  const clients = persona.b2cClientsFa.map((name, i) => ({
    name,
    instrument:
      i === 0 ? "اعتبار مصرفی BNPL مشتری" : i % 2 === 0 ? "قرض‌الحسنه میانگین حساب" : "جعاله خدمات",
    share: clientShare / persona.b2cClientsFa.length,
  }));

  return {
    key: persona.key,
    titleFa: `زیست‌بوم حلقه بسته ${persona.titleFa}`,
    titleEn: `Closed-loop ecosystem — ${persona.titleEn}`,
    anchorFa: persona.titleFa,
    suppliersFa: suppliers,
    clientsFa: clients,
    railsFa: persona.settlementRailsFa,
    loopClosure,
    bottleneckFa: persona.cashFlowBottleneckFa,
    valueChainFa: [
      `۱) تأمین: ${persona.b2bSuppliersFa[0] ?? "تأمین‌کننده"} ← اعتبار زنجیره تأمین (گام/خرید دین)`,
      `۲) تولید خدمت: ${persona.titleFa} ← تنخواه و سرمایه در گردش`,
      `۳) مصرف: ${persona.b2cClientsFa[0] ?? "مشتری"} ← اعتبار خرد و BNPL`,
      `۴) تسویه: ${persona.settlementRailsFa.join("، ")} ← بازگشت منابع به حساب جاری کم‌هزینه بانک (κ=${persona.sourceKappa})`,
      `۵) بازچرخش: γ = ${(gammaTarget ?? persona.closedLoopPotential).toFixed(2)} از منابع پرداختی در همان بانک باقی می‌ماند`,
    ],
    recommendedModes: recommended.slice(0, 5),
    gammaTarget: gammaTarget ?? Math.max(0.65, persona.closedLoopPotential * 0.92),
  };
}

export function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

export const CONTRACT_LABEL_FA: Record<ContractType, string> = {
  "qarz-hasaneh": "قرض‌الحسنه",
  morabaha: "مرابحه",
  joalah: "جعاله",
  "kharid-deyn": "خرید دین",
  gam: "اوراق گام",
  mudaraba: "مضاربه / سپرده سرمایه‌گذاری",
  bnpl: "اعتبار مصرفی (BNPL)",
};

export const ARCHETYPE_LABEL_FA: Record<ModeArchetype, string> = {
  "retail-qarz-average": "میانگین حساب قرض‌الحسنه خرد",
  "investment-deposit": "سپرده سرمایه‌گذاری",
  "merchant-pos-accelerator": "شتاب‌دهنده پذیرندگان",
  "corporate-float-anchor": "لنگر شناوری شرکتی",
  "supply-chain-gam": "اوراق گام زنجیره تأمین",
};
