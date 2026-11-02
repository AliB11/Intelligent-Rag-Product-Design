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
import type { ContractType, Language, ProductGenerationRequest } from "./types";

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";

export function normaliseDigits(input: string): string {
  return input
    .split("")
    .map((ch) => {
      const fa = FA_DIGITS.indexOf(ch);
      if (fa >= 0) return String(fa);
      const ar = AR_DIGITS.indexOf(ch);
      if (ar >= 0) return String(ar);
      if (ch === "٬" || ch === "،") return ",";
      return ch;
    })
    .join("");
}

const WORD_NUMBERS: Record<string, number> = {
  یک: 1, دو: 2, سه: 3, چهار: 4, پنج: 5, شش: 6, هفت: 7, هشت: 8, نه: 9, ده: 10,
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

function parseNumber(token: string): number | null {
  const cleaned = token.replace(/[,\s\u066C]/g, "");
  if (!cleaned) return null;
  const direct = Number(cleaned);
  if (Number.isFinite(direct)) return direct;
  if (WORD_NUMBERS[cleaned] !== undefined) return WORD_NUMBERS[cleaned];
  return null;
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
];

const CONTRACT_KEYWORDS: { contract: ContractType; words: string[] }[] = [
  { contract: "qarz-hasaneh", words: ["قرض الحسنه", "قرض‌الحسنه", "qarz", "qard", "hasaneh", "حسنه"] },
  { contract: "morabaha", words: ["مرابحه", "morabaha", "murabaha"] },
  { contract: "joalah", words: ["جعاله", "joalah", "jua'lah"] },
  { contract: "kharid-deyn", words: ["خرید دین", "خرید‌دین", "factoring", "kharid", "deyn", "طالبی"] },
  { contract: "gam", words: ["گام", "gam certificate", "supply chain bond", "اوراق گام"] },
  { contract: "mudaraba", words: ["مضاربه", "سپرده سرمایه گذاری", "سپرده سرمایه‌گذاری", "mudaraba", "investment deposit"] },
  { contract: "bnpl", words: ["bnpl", "اعتبار مصرفی", "خرید اقساطی", "لندتک"] },
];

const EMPHASIS_KEYWORDS: { key: string; words: string[] }[] = [
  { key: "closed-loop", words: ["حلقه بسته", "حلقه‌بسته", "closed loop", "closed-loop", "بازچرخش"] },
  { key: "liquidity-safety", words: ["واژگونی منابع", "overturning", "نقدینگی", "liquidity", "lcr"] },
  { key: "profitability", words: ["سودآوری", "بازده", "irr", "roe", "nim", "profitab"] },
  { key: "financial-inclusion", words: ["محروم", "آسیب پذیر", "روستایی", "inclusion", "vulnerable"] },
  { key: "merchant-float", words: ["پذیرنده", "merchant", "pos", "درگاه"] },
  { key: "supply-chain", words: ["زنجیره تامین", "زنجیره تأمین", "supply chain", "گام"] },
];

interface NumericCapture {
  value: number;
  raw: string;
  index: number;
}

function captureNumberUnits(text: string, unitRegex: RegExp): NumericCapture[] {
  const out: NumericCapture[] = [];
  const re = new RegExp(`([0-9]+(?:\\.[0-9]+)?|${Object.keys(WORD_NUMBERS).join("|")})\\s*(${unitRegex.source})`, "gi");
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

function parsePercent(text: string, keywords: RegExp): number | null {
  for (const kw of keywords.source.split("|")) {
    const re = new RegExp(`${kw}\\s*(?:حداقل|حداکثر|at least|at most|min|max|>=|<=|>|<|target)?\\s*[:=]?\\s*([0-9]+(?:\\.[0-9]+)?)\\s*(?:%|درصد|percent)`, "i");
    const m = re.exec(text);
    if (m) {
      const v = Number(m[1]);
      if (Number.isFinite(v)) return v / 100;
    }
    const re2 = new RegExp(`${kw}\\s*(?:حداقل|حداکثر|at least|at most|min|max|>=|<=|>|<|target)?\\s*[:=]?\\s*(0?\\.[0-9]+)`, "i");
    const m2 = re2.exec(text);
    if (m2) {
      const v = Number(m2[1]);
      if (Number.isFinite(v)) return v <= 1 ? v : v / 100;
    }
  }
  return null;
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
  const words = /(\b(?:three|four|five|سه|چهار|پنج|۳|۴|۵)\b)\s*(?:طرحی|طرح|mode|tier)/i.exec(text);
  if (words) {
    const v = parseNumber(words[1]);
    if (v) return clamp(v, 1, 5);
  }
  if (/چند\s*طرحی|multi-?mode|matrix/i.test(text)) return 4;
  if (/تک\s*طرحی|single[- ]mode/i.test(text)) return 1;
  return 4;
}

export interface ParseResult {
  request: ProductGenerationRequest;
  warnings: string[];
}

/** Stage 1 — natural language -> formal objective function + constraints. */
export function parseIntent(rawPrompt: string): ParseResult {
  const prompt = rawPrompt.trim();
  const text = normaliseDigits(prompt);
  const language = detectLanguage(text);
  const warnings: string[] = [];

  const deposits = parseTargetDeposits(text);
  let targetDepositsRial = deposits.rial;
  if (targetDepositsRial <= 0) {
    targetDepositsRial = 20 * HEMMAT_RIAL;
    warnings.push(
      language === "fa"
        ? "حجم منابع هدف در پیام یافت نشد؛ مقدار پیش‌فرض ۲۰ همت اعمال شد."
        : "No explicit resource target found; defaulted to 20 Hemmat.",
    );
  }

  const personaHit = detectPersona(text);
  const personaKey = personaHit?.key ?? null;
  const persona = PERSONAS.find((p) => p.key === personaKey) ?? null;

  const targetIrr =
    parsePercent(text, /irr|بازده داخلی|نرخ بازده داخلی|internal rate/i) ??
    (persona ? 0.27 : 0.26);
  const targetRoi = parsePercent(text, /roi|بازده سرمایه گذاری|بازده سرمایه‌گذاری|return on investment/i) ?? 0.9;
  const targetRoe = parsePercent(text, /roe|بازده حقوق صاحبان سهام|return on equity/i) ?? 0.28;
  const targetNim = parsePercent(text, /nim|حاشیه سود|net interest margin/i) ?? 0.075;

  const ldrCeiling =
    parsePercent(text, /ldr|تسهیلات به سپرده|credit[- ]to[- ]deposit|نسبت تسهیلات/i) ??
    REGULATORY.ldrCeiling;
  const lcrFloor =
    parsePercent(text, /lcr|پوشش نقدینگی|liquidity coverage/i) ?? REGULATORY.lcrFloor;
  const maxOverturningShock =
    parsePercent(text, /overturning|واژگونی|واژگونی منابع|resource reversal/i) ?? 0.06;

  const contracts = detectContracts(text);
  const emphases = detectEmphases(text);
  const modeCount = detectModeCount(text);

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
  const lsum =
    lambdas.lambda1Irr + lambdas.lambda2Adoption + lambdas.lambda3LdrPenalty + lambdas.lambda4Overturning;
  lambdas.lambda1Irr /= lsum;
  lambdas.lambda2Adoption /= lsum;
  lambdas.lambda3LdrPenalty /= lsum;
  lambdas.lambda4Overturning /= lsum;

  const parsedTokens: ProductGenerationRequest["parsedTokens"] = [
    ...deposits.tokens.map((t) => ({ raw: t.raw, kind: "resource-target", value: t.value })),
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
    targetDepositsHemmat: targetDepositsRial / HEMMAT_RIAL,
    targetIrr,
    targetRoi,
    targetRoe,
    targetNim,
    ldrCeiling: clamp(ldrCeiling, 0.4, 0.95),
    lcrFloor: clamp(lcrFloor, 1.0, 2.0),
    maxOverturningShock: clamp(maxOverturningShock, 0.01, 0.25),
    personaKey,
    guild: persona ? persona.titleFa : null,
    preferredContracts: contracts,
    modeCount,
    horizonMonths,
    lambdas,
    emphases,
    parsedTokens,
  };

  return { request, warnings };
}
