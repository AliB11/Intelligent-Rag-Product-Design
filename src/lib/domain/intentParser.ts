/**
 * app/agents/intent_agent.py -> TypeScript twin
 * ---------------------------------------------------------------------------
 * Deterministic natural-language intent parser (Persian / English) producing a
 * strictly typed ProductGenerationRequest. The LLM layer only ever forwards the
 * raw prompt here; it never invents a number.
 */

import {
  BILLION_TOMAN_RIAL,
  DEFAULT_LAMBDAS,
  HEMMAT_RIAL,
  MILLION_TOMAN_RIAL,
  REGULATORY,
  ALM_HORIZON_MONTHS,
} from "./constants";
import { clamp } from "./financial";
import { PERSONAS } from "./guildValueChain";
import { resolveFacility } from "../rag/facilityResolver";
import type { ContractType, Language, ProductGenerationRequest } from "./types";

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";

export function normaliseDigits(input: string): string {
  return input
    .normalize("NFKC")
    .replace(/[\u064A\u0649]/g, "ی")
    .replace(/\u0643/g, "ک")
    .replace(/\u0640/g, "")
    .replace(/[\u200c\u200f\u202a-\u202e]/g, " ")
    .split("")
    .map((ch) => {
      const fa = FA_DIGITS.indexOf(ch);
      if (fa >= 0) return String(fa);
      const ar = AR_DIGITS.indexOf(ch);
      if (ar >= 0) return String(ar);
      if (ch === "٬" || ch === "،") return ",";
      if (ch === "٫") return ".";
      return ch;
    })
    .join("");
}

const WORD_NUMBERS: Record<string, number> = {
  یک: 1, دو: 2, سه: 3, چهار: 4, پنج: 5, شش: 6, هفت: 7, هشت: 8, نه: 9, ده: 10,
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

const NUMERIC_TOKEN = String.raw`(?:[0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]+)?|[0-9]+(?:\.[0-9]+)?|\.[0-9]+)`;
const WORD_NUMBER_TOKEN = Object.keys(WORD_NUMBERS)
  .sort((a, b) => b.length - a.length)
  .join("|");

function parseNumber(token: string): number | null {
  const cleaned = token.replace(/[,\s\u066c]/gi, "");
  if (!cleaned) return null;
  const direct = Number(cleaned);
  if (Number.isFinite(direct)) return direct;
  return WORD_NUMBERS[cleaned.toLowerCase()] ?? null;
}

const PERSONA_KEYWORDS: { key: string; words: string[] }[] = [
  { key: "physician-specialist", words: ["پزشک", "پزشکان", "متخصص", "دکتر", "کلینیک", "درمانی", "پزشکی", "physician", "doctor", "specialist", "clinic", "medical"] },
  { key: "dental-clinic", words: ["دندانپزشک", "دندانپزشکی", "دندان", "dental", "dentist"] },
  { key: "pharmacy", words: ["داروخانه", "دارو", "پخش دارو", "pharmacy", "drug"] },
  { key: "logistics-driver", words: ["راننده", "رانندگان", "حمل و نقل", "حمل‌ونقل", "باربری", "بارنامه", "کامیون", "لجستیک", "driver", "logistics", "fleet", "bill of lading", "truck"] },
  { key: "pos-merchant", words: ["پذیرنده", "پوز", "pos", "فروشگاه", "کسب و کار", "کسب‌وکار", "بازاری", "merchant", "retail", "shop", "ipg", "درگاه"] },
  { key: "corporate-payroll", words: ["حقوق بگیر", "حقوق‌بگیر", "کارمند", "کارکنان", "شرکت", "سازمان", "payroll", "employee", "corporate", "salary"] },
  { key: "industrial-supplier", words: ["زنجیره تامین", "زنجیره تأمین", "تولید", "صنعتی", "کارخانه", "گام", "supply chain", "industrial", "manufactur", "gam"] },
  { key: "gold-jeweller", words: ["طلا", "طلافروش", "شمش", "gold", "jewel", "bullion"] },
  { key: "retail-vulnerable", words: ["آسیب پذیر", "آسیب‌پذیر", "روستا", "روستایی", "سرپرست خانوار", "محروم", "vulnerable", "rural", "low income"] },
  { key: "student-community", words: ["دانشجو", "دانشجویان", "دانشگاه", "محصل", "student", "university"] },
  { key: "exporter-importer", words: ["صادرکننده", "صادرات", "واردکننده", "واردات", "تجارت خارجی", "exporter", "export", "import"] },
  { key: "agri-farmer", words: ["کشاورز", "کشاورزی", "دامدار", "نهاده", "باغدار", "farmer", "agricultur"] },
];

const CONTRACT_KEYWORDS: { contract: ContractType; words: string[] }[] = [
  { contract: "qarz-hasaneh", words: ["قرض الحسنه", "قرض‌الحسنه", "qarz", "qard", "hasaneh", "حسنه"] },
  { contract: "morabaha", words: ["مرابحه", "morabaha", "murabaha"] },
  { contract: "joalah", words: ["جعاله", "joalah", "jua'lah"] },
  { contract: "kharid-deyn", words: ["خرید دین", "خرید‌دین", "factoring", "kharid", "deyn", "طالبی"] },
  { contract: "gam", words: ["گام", "gam certificate", "supply chain bond", "اوراق گام"] },
  { contract: "mudaraba", words: ["مضاربه", "سپرده سرمایه گذاری", "سپرده سرمایه‌گذاری", "گواهی سپرده", "اوراق سپرده", "mudaraba", "investment deposit", "deposit certificate"] },
  { contract: "bnpl", words: ["bnpl", "اعتبار مصرفی", "خرید اقساطی", "لندتک", "فروش اقساطی"] },
];

const EMPHASIS_KEYWORDS: { key: string; words: string[] }[] = [
  { key: "closed-loop", words: ["حلقه بسته", "حلقه‌بسته", "closed loop", "closed-loop", "بازچرخش"] },
  { key: "liquidity-safety", words: ["واژگونی منابع", "overturning", "نقدینگی", "liquidity", "lcr"] },
  { key: "profitability", words: ["سودآوری", "بازده", "irr", "roe", "nim", "profitab"] },
  { key: "financial-inclusion", words: ["محروم", "آسیب پذیر", "روستایی", "inclusion", "vulnerable"] },
  { key: "merchant-float", words: ["پذیرنده", "merchant", "pos", "درگاه"] },
  { key: "supply-chain", words: ["زنجیره تامین", "زنجیره تأمین", "supply chain", "گام"] },
  { key: "zero-fee", words: ["بدون کارمزد", "کارمزد صفر", "بدون سود برای مشتری", "no fee", "zero fee"] },
  { key: "no-blocking", words: ["بدون مسدودی", "مسدودی صفر", "بدون بلوکه", "no blocking", "no block"] },
  { key: "fast-disbursal", words: ["اولویت اعطا", "اعطای فوری", "پرداخت فوری", "سرعت اعطا", "instant", "fast disbursal"] },
  { key: "salary-float", words: ["واریز حقوق", "کسر از حقوق", "حقوق‌بگیر", "payroll", "salary"] },
  { key: "deposit-certificate", words: ["گواهی سپرده", "اوراق سپرده", "سپرده خاص", "deposit certificate"] },
  { key: "scored-credit", words: ["امتیازی", "امتیاز حساب", "نیک", "نگین", "مهربانی", "کارت اعتباری", "اعتبار سپرده‌محور", "scored", "credit card", "loyalty"] },
  // Facility-category emphases (rade.ir loan taxonomy)
  { key: "cat-car", words: ["خودرو", "وام خودرو", "car loan", "خودرویی", "سنگین", "سبک"] },
  { key: "cat-housing", words: ["مسکن", "رهن", "خرید خانه", "ساخت مسکن", "تعمیرات مسکن", "mortgage", "housing", "جعاله تعمیر"] },
  { key: "cat-marriage", words: ["ازدواج", "فرزندآوری", "جهیزیه", "marriage", "مهریه"] },
  { key: "cat-agri", words: ["کشاورزی", "نهاده", "دامداری", "مرغداری", "غلات", "باغداری", "آبیاری", "agri", "farm"] },
  { key: "cat-energy", words: ["خورشیدی", "نیروگاه", "انرژی تجدیدپذیر", "ساتبا", "solar", "photovoltaic", "فتوولتائیک"] },
  { key: "cat-retiree", words: ["بازنشسته", "بازنشستگان", "تأمین اجتماعی", "تامین اجتماعی", "retiree", "pension"] },
  { key: "cat-student", words: ["دانشجویی", "دانشجویان", "تحصیلی", "صندوق رفاه دانشجویان", "student"] },
  { key: "cat-sme", words: ["خوداشتغالی", "تولیدی", "کسب‌وکار", "کارگاه", " SME", "self-employment", "اشتغال"] },
];

interface NumericCapture {
  value: number;
  raw: string;
  index: number;
}

function captureNumberUnits(text: string, unitRegex: RegExp): NumericCapture[] {
  const out: NumericCapture[] = [];
  const re = new RegExp(`(${NUMERIC_TOKEN}|${WORD_NUMBER_TOKEN})\\s*(${unitRegex.source})`, "gi");
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const value = parseNumber(match[1]);
    if (value !== null) out.push({ value, raw: match[0], index: match.index });
  }
  return out;
}

export function detectLanguage(prompt: string): Language {
  return /[\u0600-\u06FF]/.test(prompt) ? "fa" : "en";
}

export function parseTargetDeposits(text: string): { rial: number; tokens: NumericCapture[] } {
  const tokens: NumericCapture[] = [];
  let rial = 0;

  captureNumberUnits(text, /همت|hemmat|حمات/i).forEach((c) => {
    rial += c.value * HEMMAT_RIAL;
    tokens.push(c);
  });
  captureNumberUnits(text, /هزار\s*میلیارد\s*تومان|trillion\s*toman/i).forEach((c) => {
    rial += c.value * 1e12 * 10;
    tokens.push(c);
  });
  captureNumberUnits(text, /میلیارد\s*تومان|billion\s*toman/i).forEach((c) => {
    rial += c.value * BILLION_TOMAN_RIAL;
    tokens.push(c);
  });
  captureNumberUnits(text, /میلیون\s*تومان|million\s*toman/i).forEach((c) => {
    rial += c.value * MILLION_TOMAN_RIAL;
    tokens.push(c);
  });
  captureNumberUnits(text, /هزار\s*میلیارد\s*ریال/i).forEach((c) => {
    rial += c.value * 1e12;
    tokens.push(c);
  });
  captureNumberUnits(text, /میلیارد\s*ریال/i).forEach((c) => {
    rial += c.value * 1e9;
    tokens.push(c);
  });
  captureNumberUnits(text, /همت\s*معادل/i).forEach((c) => tokens.push(c));

  // "20 hemmat worth of resources" without unit token but with explicit rial
  if (rial === 0) {
    captureNumberUnits(text, /ریال|rial/i).forEach((c) => {
      rial += c.value;
      tokens.push(c);
    });
  }
  return { rial, tokens };
}

function parseRateLike(text: string, keywords: RegExp, percentOnly: boolean): number | null {
  const modifier = String.raw`(?:حداقل|حداکثر|سقف|کف|حد|برابر|at least|at most|ceiling|floor|limit|target|at|is|of|min|max|>=|<=|>|<)?`;
  const re = new RegExp(
    `(?:${keywords.source})\\s*${modifier}\\s*[:=]?\\s*(${NUMERIC_TOKEN})(\\s*(?:%|درصد|percent))?`,
    "i",
  );
  const match = re.exec(text);
  if (!match) return null;
  const value = parseNumber(match[1]);
  if (value === null) return null;
  const hasPercentUnit = Boolean(match[2]);
  if (percentOnly || hasPercentUnit) return hasPercentUnit || value > 1 ? value / 100 : value;
  return value;
}

function parsePercent(text: string, keywords: RegExp): number | null {
  return parseRateLike(text, keywords, true);
}

function parseRatio(text: string, keywords: RegExp): number | null {
  return parseRateLike(text, keywords, false);
}

function detectPersona(text: string): { key: string; score: number } | null {
  let best: { key: string; score: number } | null = null;
  PERSONA_KEYWORDS.forEach((entry) => {
    let score = 0;
    entry.words.forEach((w) => {
      const re = new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
      const hits = (text.match(re) || []).length;
      score += hits * (w.length > 6 ? 2 : 1);
    });
    if (score > 0 && (!best || score > best.score)) best = { key: entry.key, score };
  });
  return best;
}

function detectContracts(text: string): ContractType[] {
  const found: ContractType[] = [];
  CONTRACT_KEYWORDS.forEach((entry) => {
    if (entry.words.some((w) => text.toLowerCase().includes(w.toLowerCase()))) {
      if (!found.includes(entry.contract)) found.push(entry.contract);
    }
  });
  return found;
}

function detectEmphases(text: string): string[] {
  const found: string[] = [];
  EMPHASIS_KEYWORDS.forEach((entry) => {
    if (entry.words.some((w) => text.toLowerCase().includes(w.toLowerCase()))) found.push(entry.key);
  });
  return found;
}

function detectModeCount(text: string): number {
  const m = /([0-9]+)\s*(?:طرح|حالت|mode|tier|product)/i.exec(text);
  if (m) return clamp(Number(m[1]), 1, 5);
  const words = /(\b(?:one|two|three|four|five)\b|یک|دو|سه|چهار|پنج)\s*(?:طرحی|طرح|حالت|mode|tier)/i.exec(text);
  if (words) {
    const v = parseNumber(words[1]);
    if (v) return clamp(v, 1, 5);
  }
  if (/چند\s*طرحی|multi-?mode|matrix/i.test(text)) return 4;
  if (/تک\s*طرحی|single[- ]mode/i.test(text)) return 1;
  return 4;
}

export interface IntentOverrides {
  targetDepositsHemmat?: number;
  targetIrr?: number;
  ldrCeiling?: number;
  lcrFloor?: number;
  maxOverturningShock?: number;
}

export interface ParseResult {
  request: ProductGenerationRequest;
  warnings: string[];
}

/** Stage 1 — natural language plus explicit UI controls -> formal request. */
export function parseIntent(rawPrompt: string, overrides: IntentOverrides = {}): ParseResult {
  const prompt = rawPrompt.trim();
  const text = normaliseDigits(prompt);
  const language = detectLanguage(text);
  const warnings: string[] = [];

  const deposits = parseTargetDeposits(text);
  let targetDepositsHemmat =
    Number.isFinite(overrides.targetDepositsHemmat) && overrides.targetDepositsHemmat! > 0
      ? overrides.targetDepositsHemmat!
      : deposits.rial / HEMMAT_RIAL;
  if (targetDepositsHemmat <= 0) {
    targetDepositsHemmat = 20;
    warnings.push(
      language === "fa"
        ? "حجم منابع هدف در پیام یافت نشد؛ مقدار پیش‌فرض ۲۰ همت اعمال شد."
        : "No explicit resource target found; defaulted to 20 Hemmat.",
    );
  }
  targetDepositsHemmat = clamp(targetDepositsHemmat, 0.01, 1_000);
  const targetDepositsRial = targetDepositsHemmat * HEMMAT_RIAL;

  const personaHit = detectPersona(text);
  const personaKey = personaHit?.key ?? null;
  const persona = PERSONAS.find((p) => p.key === personaKey) ?? null;

  let targetIrr = clamp(
    overrides.targetIrr ?? parsePercent(text, /irr|بازده داخلی|نرخ بازده داخلی|internal rate/i) ?? (persona ? 0.27 : 0.26),
    0.01,
    1.0,
  );
  const targetRoi = clamp(parsePercent(text, /roi|بازده سرمایه گذاری|بازده سرمایه‌گذاری|return on investment/i) ?? 0.9, 0, 5);
  const targetRoe = clamp(parsePercent(text, /roe|بازده حقوق صاحبان سهام|return on equity/i) ?? 0.28, 0, 1.5);
  const targetNim = clamp(parsePercent(text, /nim|حاشیه سود|net interest margin/i) ?? 0.075, 0, 0.5);

  const ldrCeiling = clamp(
    overrides.ldrCeiling ?? parsePercent(text, /ldr|تسهیلات به سپرده|credit[- ]to[- ]deposit|نسبت تسهیلات/i) ?? REGULATORY.ldrCeiling,
    0.4,
    0.95,
  );
  const lcrFloor = clamp(
    overrides.lcrFloor ?? parseRatio(text, /lcr|پوشش نقدینگی|liquidity coverage/i) ?? REGULATORY.lcrFloor,
    1.0,
    2.0,
  );
  const maxOverturningShock = clamp(
    overrides.maxOverturningShock ??
      parsePercent(text, /overturning|واژگونی|واژگونی منابع|resource reversal/i) ??
      (/نزدیک\s*صفر|near\s*zero/i.test(text) ? 0.02 : 0.06),
    0.01,
    0.25,
  );

  const contracts = detectContracts(text);
  const emphases = detectEmphases(text);
  const modeCount = detectModeCount(text);

  // ---- Product-identification agent -------------------------------------
  // A few-word need ("وام ازدواج", "ماشین", "خونه") is resolved to the single
  // best-matching REAL facility from the researched registry; its contract and
  // category vocabulary are merged into the request so the optimizer designs
  // the best version of that exact product. The agent steps aside for
  // fully-specified strategic prompts (explicit resource volume): those are
  // power-user requests where forcing one facility's priors would over-constrain.
  const resolution = resolveFacility(prompt);
  const hasExplicitResource = deposits.rial > 0;
  const attachFacility = !hasExplicitResource && !!resolution.best && resolution.best.confidence >= 0.35;
  const matchedFacility: ProductGenerationRequest["matchedFacility"] = attachFacility && resolution.best
    ? {
        code: resolution.best.product.code,
        productFa: resolution.best.product.productFa,
        productEn: resolution.best.product.productEn,
        bank: resolution.best.product.bank,
        contract: resolution.best.product.contract,
        confidence: Math.round(resolution.best.confidence * 100) / 100,
        matchedOnFa: resolution.best.matchedOnFa,
        alternativesFa: resolution.alternatives.map((alt) => ({
          productFa: alt.product.productFa,
          bank: alt.product.bank,
          confidence: Math.round(alt.confidence * 100) / 100,
        })),
      }
    : null;
  if (matchedFacility && !contracts.includes(matchedFacility.contract)) {
    contracts.push(matchedFacility.contract);
  }
  // map the resolved need-category to engine emphases so routing/priors follow
  const CATEGORY_EMPHASIS: Record<string, string> = {
    marriage: "cat-marriage",
    car: "cat-car",
    housing: "cat-housing",
    student: "cat-student",
    retiree: "cat-retiree",
    solar: "cat-energy",
    goods: "merchant-float",
    instant: "fast-disbursal",
    "no-guarantor": "financial-inclusion",
    qh: "zero-fee",
    merchant: "merchant-float",
    payroll: "salary-float",
    agri: "cat-agri",
    sme: "cat-sme",
    "supply-chain": "supply-chain",
    scored: "scored-credit",
    "deposit-certificate": "deposit-certificate",
  };
  if (attachFacility) {
    for (const category of resolution.categories) {
      const emphasis = CATEGORY_EMPHASIS[category];
      if (emphasis && !emphases.includes(emphasis)) emphases.push(emphasis);
    }
  }

  // Return-objective inference: when the user asked for a specific product
  // class ("وام ازدواج") without stating an IRR, the target must come from the
  // economics of THAT class — a 4%-commission QH marriage loan cannot carry a
  // generic 26% objective, while a rate-bearing facility can. This keeps the
  // self-correction loop honest instead of labelling realistic designs
  // not_validated against an imported target.
  const irrMentioned = /irr|بازده داخلی|internal rate/i.test(text);
  if (attachFacility && resolution.best && overrides.targetIrr === undefined && !irrMentioned) {
    const facility = resolution.best.product;
    targetIrr = facility.contract === "qarz-hasaneh"
      ? clamp(0.06 + facility.params.loanRate * 1.5, 0.08, 0.16)
      : clamp(facility.params.loanRate + 0.03, 0.18, 0.28);
  }

  const horizonMatch = /([0-9]{2,3})\s*(?:ماه|month)/i.exec(text);
  const horizonMonths = horizonMatch
    ? clamp(Number(horizonMatch[1]), 12, ALM_HORIZON_MONTHS)
    : ALM_HORIZON_MONTHS;

  // lambda weighting driven by detected strategic emphasis
  const lambdas = { ...DEFAULT_LAMBDAS };
  if (emphases.includes("profitability")) lambdas.lambda1Irr += 0.08;
  if (emphases.includes("liquidity-safety")) {
    lambdas.lambda4Overturning += 0.08;
    lambdas.lambda3LdrPenalty += 0.05;
  }
  if (emphases.includes("financial-inclusion") || emphases.includes("closed-loop"))
    lambdas.lambda2Adoption += 0.06;
  // customer-experience emphases tilt the objective toward adoption and away
  // from pure margin: zero-fee / instant-disbursal products must stay adoptable.
  if (emphases.includes("zero-fee") || emphases.includes("fast-disbursal"))
    lambdas.lambda2Adoption += 0.07;
  if (emphases.includes("salary-float")) lambdas.lambda3LdrPenalty += 0.03;
  // scored-deposit products are adoption anchors: their economics rely on a
  // wide, loyal deposit base, so weight adoption a little more.
  if (emphases.includes("scored-credit")) lambdas.lambda2Adoption += 0.05;
  const lsum =
    lambdas.lambda1Irr + lambdas.lambda2Adoption + lambdas.lambda3LdrPenalty + lambdas.lambda4Overturning;
  lambdas.lambda1Irr /= lsum;
  lambdas.lambda2Adoption /= lsum;
  lambdas.lambda3LdrPenalty /= lsum;
  lambdas.lambda4Overturning /= lsum;

  const parsedTokens: ProductGenerationRequest["parsedTokens"] = [
    ...(overrides.targetDepositsHemmat !== undefined
      ? [{ raw: "composer target", kind: "resource-target", value: targetDepositsHemmat }]
      : deposits.tokens.map((t) => ({ raw: t.raw, kind: "resource-target", value: t.value }))),
    { raw: "IRR", kind: "profitability-target", value: targetIrr },
    { raw: "ROI", kind: "profitability-target", value: targetRoi },
    { raw: "ROE", kind: "profitability-target", value: targetRoe },
    { raw: "NIM", kind: "profitability-target", value: targetNim },
    { raw: "LDR", kind: "risk-tolerance", value: ldrCeiling },
    { raw: "LCR", kind: "risk-tolerance", value: lcrFloor },
    { raw: "overturning", kind: "risk-tolerance", value: maxOverturningShock },
    ...(personaKey ? [{ raw: personaKey, kind: "persona", value: personaKey }] : []),
    ...contracts.map((c) => ({ raw: c, kind: "contract", value: c })),
    ...emphases.map((e) => ({ raw: e, kind: "emphasis", value: e })),
    { raw: "modes", kind: "structure", value: modeCount },
    { raw: "horizon", kind: "structure", value: horizonMonths },
  ];

  const request: ProductGenerationRequest = {
    prompt,
    language,
    targetDepositsRial,
    targetDepositsHemmat,
    targetIrr,
    targetRoi,
    targetRoe,
    targetNim,
    ldrCeiling,
    lcrFloor,
    maxOverturningShock,
    personaKey,
    guild: persona ? persona.titleFa : null,
    preferredContracts: contracts,
    modeCount,
    horizonMonths,
    lambdas,
    emphases,
    matchedFacility,
    parsedTokens,
  };

  if (matchedFacility) {
    parsedTokens.push({
      raw: `${matchedFacility.productFa} (${matchedFacility.bank})`,
      kind: "matched-facility",
      value: matchedFacility.confidence,
    });
  }

  return { request, warnings };
}
