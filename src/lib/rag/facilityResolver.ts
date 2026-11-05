/**
 * app/rag/facility_resolver.py (TypeScript twin) — product-identification agent
 * ---------------------------------------------------------------------------
 * Turns a terse natural-language need ("وام ازدواج", "ماشین", "خونه", "نیروگاه
 * خورشیدی") into the single best-matching REAL facility from the researched
 * market registry, with a confidence score, matched-on reasons and ranked
 * alternatives — the way rade.ir's need-based taxonomy (instant, no-guarantor,
 * cash, mortgage, home-repair, car, self-employment, goods, QH, marriage,
 * student) mirrors what users actually type.
 *
 * Deterministic and LLM-free: colloquial synonyms expand the query, then a
 * weighted hybrid score (exact name > synonym/category > bank > segment >
 * notes) ranks the registry. The winner feeds the optimizer as a forced
 * market prior so the synthesized design is the *best version of that exact
 * real product* rather than a generic structure.
 */

import { MARKET_PRODUCTS, type MarketProduct } from "./benchmarks";

/** Colloquial/collocation → formal facility vocabulary (rade.ir need taxonomy). */
export const NEED_SYNONYMS: { category: string; words: string[] }[] = [
  { category: "marriage", words: ["ازدواج", "عروسی", "واهمه", "جهیزیه", "مهریه", "فرزندآوری", "زایمی", "marriage", "wedding"] },
  { category: "car", words: ["خودرو", "ماشین", "پراید", "پژو", "تیبا", "شاهین", "دنا", "سایپا", "ایران خودرو", "وسایل نقلیه", "موتورسیکلت", "car", "vehicle"] },
  { category: "housing", words: ["مسکن", "خانه", "خونه", "آپارتمان", "رهن", "رهن‌گاه", "ساخت", "تعمیر", "بازسازی", "ملک", "housing", "mortgage", "home"] },
  { category: "student", words: ["دانشجو", "دانشجویان", "تحصیل", "تحصیلی", "شهریه", "مدرسه", "دانشگاه", "student", "tuition"] },
  { category: "retiree", words: ["بازنشسته", "بازنشستگان", "مستمری", "تأمین اجتماعی", "تامین اجتماعی", "کشوری", "سالمند", "pension", "retiree"] },
  { category: "solar", words: ["خورشیدی", "نیروگاه", "پنل", "فتوولتائیک", "ساتبا", "انرژی تجدیدپذیر", "solar", "pv", "photovoltaic"] },
  { category: "goods", words: ["کالا", "لوازم خانگی", "یخچال", "موبایل", "لپتاپ", "لپ تاپ", "تلویزیون", "اقساطی", "bnpl", "خرید اقساطی", "اعتبار خرید"] },
  { category: "instant", words: ["فوری", "سریع", "یک‌شبه", "یکشبه", "آنی", "فوری‌ترین", "instant", "quick"] },
  { category: "no-guarantor", words: ["بدون ضامن", "بی‌ضامن", "بدون ضمانت", "no guarantor"] },
  { category: "qh", words: ["قرض‌الحسنه", "قرض الحسنه", "بی‌سود", "بدون سود", "کارمزد کم", "qarz", "interest-free"] },
  { category: "merchant", words: ["پذیرنده", "pos", "درگاه", "کارتخوان", "کارت خوان", "فروشگاه", "کسبه", "merchant"] },
  { category: "payroll", words: ["حقوق", "حقوق‌بگیر", "کارمند", "کارکنان", "واریز حقوق", "کسر از حقوق", "payroll", "salary"] },
  { category: "agri", words: ["کشاورز", "کشاورزی", "نهاده", "دام", "طیور", "مرغ", "غله", "گندم", "باغ", "باغدار", "آبیاری", "farm", "agri"] },
  { category: "sme", words: ["اشتغال", "خوداشتغال", "کارگاه", "تولیدی", "کسب‌وکار", "کسب و کار", "شرکت کوچک", " SME", "business"] },
  { category: "supply-chain", words: ["زنجیره", "تأمین", "تامین", "گام", "فاکتور", "بارنامه", "حمل", "راننده", "supply chain"] },
  { category: "scored", words: ["امتیازی", "امتیاز", "نیک", "نگین", "مهربانی", "رتبه اعتباری", "scored", "loyalty"] },
  { category: "deposit-certificate", words: ["گواهی سپرده", "اوراق سپرده", "سپرده خاص", "سرمایه‌گذاری", "certificate"] },
];

/** Persian bank aliases — users type the short/colloquial bank name. */
const BANK_ALIASES: { bank: string; aliases: string[] }[] = [
  { bank: "مهر ایران", aliases: ["مهر ایران", "قرض‌الحسنه مهر", "بانک مهر"] },
  { bank: "ملت", aliases: ["ملت"] },
  { bank: "تجارت", aliases: ["تجارت"] },
  { bank: "ملی", aliases: ["ملی"] },
  { bank: "سپه", aliases: ["سپه"] },
  { bank: "کشاورزی", aliases: ["کشاورزی", "کشاورزی بانک"] },
  { bank: "صادرات", aliases: ["صادرات"] },
  { bank: "پارسیان", aliases: ["پارسیان"] },
  { bank: "پاسارگاد", aliases: ["پاسارگاد"] },
  { bank: "سامان", aliases: ["سامان"] },
  { bank: "رسالت", aliases: ["رسالت"] },
  { bank: "شهر", aliases: ["شهر", "بانک شهر"] },
  { bank: "رفاه", aliases: ["رفاه", "رفاه کارگران"] },
  { bank: "مسکن", aliases: ["مسکن"] },
  { bank: "توسعه تعاون", aliases: ["توسعه تعاون", "تعاون"] },
  { bank: "دیجی‌پی", aliases: ["دیجی پی", "دیجی‌پی", "دیجی‌کالا"] },
  { bank: "اسنپ", aliases: ["اسنپ"] },
];

/**
 * Product-side category vocabulary — formal words that appear in *product
 * texts*. Kept separate from the user-side synonyms so colloquial words
 * ("ماشین") never leak into product matching ("موتورسیکلت" must not satisfy
 * the car category when the user typed "ماشین").
 */
const CATEGORY_PRODUCT_HINTS: Record<string, string[]> = {
  marriage: ["ازدواج", "فرزندآوری", "marriage"],
  car: ["خودرو", "خودرویی", "car"],
  housing: ["مسکن", "رهن", "housing", "تعمیرات", "ساخت"],
  student: ["دانشجو", "student", "تحصیلی"],
  retiree: ["بازنشسته", "retiree", "pension"],
  solar: ["خورشیدی", "نیروگاه", "solar"],
  goods: ["کالا", "لوازم خانگی", "bnpl", "اقساطی", "موتورسیکلت"],
  instant: ["فوری", "یک‌شبه", "instant"],
  "no-guarantor": ["بدون ضامن", "بدون ضمانت"],
  qh: ["قرض‌الحسنه", "قرض الحسنه", "qarz"],
  merchant: ["پذیرنده", "pos", "merchant"],
  payroll: ["حقوق", "payroll", "کارکنان"],
  agri: ["کشاورز", "نهاده", "دام", "غله", "farm", "باغ"],
  sme: ["اشتغال", "خوداشتغال", "کارگاه", "تولیدی"],
  "supply-chain": ["زنجیره", "گام", "بارنامه", "خرید دین", "kharid-deyn"],
  scored: ["امتیازی", "نیک", "نگین", "مهربانی", "scored"],
  "deposit-certificate": ["گواهی سپرده", "اوراق سپرده"],
};

export interface FacilityMatch {
  product: MarketProduct;
  score: number;
  confidence: number;
  matchedOnFa: string[];
}

export interface FacilityResolution {
  best: FacilityMatch | null;
  alternatives: FacilityMatch[];
  /** Categories the user's words touched (rade.ir need taxonomy). */
  categories: string[];
}

const textOf = (p: MarketProduct) =>
  `${p.productFa} ${p.productEn} ${p.bank} ${p.segmentFa} ${p.segmentEn} ${p.notesFa}`;

/** ASCII hints match on word boundaries so "car" never hits inside "healthcare". */
const hintHit = (haystack: string, hint: string): boolean => {
  if (/^[a-z0-9 .&-]+$/i.test(hint)) {
    const escaped = hint.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z])${escaped}([^a-z]|$)`, "i").test(haystack);
  }
  return haystack.includes(hint.toLowerCase());
};

/**
 * Resolve a (possibly very short) user need to the best real facility.
 * Pure function over the static registry — no I/O, fully deterministic.
 */
export function resolveFacility(rawQuery: string): FacilityResolution {
  const query = rawQuery.trim();
  if (!query) return { best: null, alternatives: [], categories: [] };
  const q = query.toLowerCase();

  // 1) which need-categories does the user's vocabulary touch?
  const categories: string[] = [];
  for (const group of NEED_SYNONYMS) {
    if (group.words.some((w) => q.includes(w.toLowerCase()))) categories.push(group.category);
  }
  // rade.ir category names typed directly (e.g. "وام مسکن" hits housing above)

  // 2) bank mention?
  const bankHit = BANK_ALIASES.find((b) => b.aliases.some((a) => q.includes(a)));

  // 3) score every product
  const scored: FacilityMatch[] = MARKET_PRODUCTS.map((product) => {
    let score = 0;
    const matchedOnFa: string[] = [];
    const haystack = textOf(product).toLowerCase();
    const nameHaystack = `${product.productFa} ${product.productEn}`.toLowerCase();

    for (const token of q.split(/[\s،,]+/).filter((t) => t.length > 2)) {
      if (nameHaystack.includes(token)) {
        score += 3;
        matchedOnFa.push(`نام محصول: «${token}»`);
      } else if (haystack.includes(token)) {
        score += 1;
        matchedOnFa.push(`متن: «${token}»`);
      }
    }

    for (const category of categories) {
      // product membership uses the formal product-side vocabulary, never the
      // colloquial user synonyms (ماشین ↔ خودرو must not cross-match)
      const hit = CATEGORY_PRODUCT_HINTS[category]?.find((w) => hintHit(haystack, w));
      if (hit) {
        score += 2.5;
        matchedOnFa.push(`دسته نیاز: ${category}`);
        break;
      }
    }

    if (bankHit && product.bank.includes(bankHit.bank)) {
      score += 2;
      matchedOnFa.push(`بانک: ${bankHit.bank}`);
    }

    // direct facility-name probe (e.g. "نگین فراپویا", "نیک‌وام", "مهربانی")
    const probe = product.productFa.slice(0, 8).toLowerCase();
    if (probe.length > 3 && q.includes(probe)) {
      score += 4;
      matchedOnFa.push("تطابق مستقیم نام طرح");
    }

    return {
      product,
      score,
      // single synonym hit ≈ 42%, name+category ≈ 90%+, direct probe ≈ 100%
      confidence: Math.max(0, Math.min(1, score / 6)),
      matchedOnFa: [...new Set(matchedOnFa)].slice(0, 4),
    };
  }).sort((a, b) => b.score - a.score);

  const best = scored[0] && scored[0].score > 0 ? scored[0] : null;
  const alternatives = scored.filter((m) => m.score > 0 && m.product.code !== best?.product.code).slice(0, 4);
  return { best, alternatives, categories };
}
