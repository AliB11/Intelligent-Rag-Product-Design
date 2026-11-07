import { MARKET_INDEX } from "../rag/benchmarks";
import { normalizeFaText } from "../rag/hybridRag";
import { retrieveKnowledge } from "../rag/knowledgeBase";
import type { GuaranteeType } from "./types";

export interface RecommendationInput {
  query: string;
  amountToman?: number;
  monthlyIncomeToman?: number;
  existingInstallmentToman?: number;
  availableDepositToman?: number;
  maxSleepMonths?: number;
  availableGuarantees?: GuaranteeType[];
  alternativeYield?: number;
}

/** Extract only explicit, unambiguous local amounts. Form values always win. */
export function parseRecommendationQuery(query: string): Partial<RecommendationInput> {
  const text = normalizeFaText(query.replace(/[.٫]/g, "dddecimaldd"));
  const amount = (pattern: RegExp): number | undefined => {
    const match = text.match(pattern);
    if (!match) return undefined;
    const number = Number(match[1].replace("dddecimaldd", "."));
    return Number.isFinite(number) && number > 0 && number * (match[2] === "میلیارد" ? 1e9 : 1e6) <= 1e15 ? number * (match[2] === "میلیارد" ? 1e9 : 1e6) : undefined;
  };
  return {
    amountToman: amount(/(?:وام|تسهیلات|اعتبار)\s+(?:به مبلغ\s+|مبلغ\s+)?(\d+(?:dddecimaldd\d+)?)\s*(میلیون|میلیارد)/),
    monthlyIncomeToman: amount(/(?:درآمد|حقوق)\s+(?:ماهانه\s+)?(\d+(?:dddecimaldd\d+)?)\s*(میلیون|میلیارد)/),
  };
}

/** Approximate amortisation only: actual bank schedules and fees may differ. */
export function estimateMonthlyPayment(amount: number, annualRate: number, months: number): number {
  if (!(amount > 0) || !(months > 0)) return 0;
  const rate = annualRate / 12;
  return rate > 0 ? amount * rate / (1 - Math.pow(1 + rate, -months)) : amount / months;
}

/** TOPSIS over observed values. Missing costs get the worst observed value, not zero. */
export function topsis(rows: (number | null)[][], weights: number[], benefits: boolean[]): number[] {
  if (!rows.length) return [];
  const filled = rows.map((row) => [...row]);
  for (let col = 0; col < weights.length; col++) {
    const known = rows.map((r) => r[col]).filter((v): v is number => v !== null && Number.isFinite(v));
    const worst = known.length ? (benefits[col] ? Math.min(...known) : Math.max(...known)) : 0;
    filled.forEach((row) => { if (row[col] === null || !Number.isFinite(row[col])) row[col] = worst; });
  }
  const matrix = filled.map((row) => row.map((v, j) => {
    const norm = Math.sqrt(filled.reduce((sum, r) => sum + (r[j] as number) ** 2, 0));
    return norm ? ((v as number) / norm) * weights[j] : 0;
  }));
  const ideal = weights.map((_, j) => benefits[j] ? Math.max(...matrix.map((r) => r[j])) : Math.min(...matrix.map((r) => r[j])));
  const anti = weights.map((_, j) => benefits[j] ? Math.min(...matrix.map((r) => r[j])) : Math.max(...matrix.map((r) => r[j])));
  return matrix.map((row) => {
    const positive = Math.sqrt(row.reduce((s, v, j) => s + (v - ideal[j]) ** 2, 0));
    const negative = Math.sqrt(row.reduce((s, v, j) => s + (v - anti[j]) ** 2, 0));
    return positive + negative > 0 ? negative / (positive + negative) : 0.5;
  });
}

/** Retrieval first, then transparent fit assessment; never an eligibility decision. */
export function recommendProducts(input: RecommendationInput) {
  const parsed = parseRecommendationQuery(input.query);
  const profile = { ...input, amountToman: input.amountToman ?? parsed.amountToman, monthlyIncomeToman: input.monthlyIncomeToman ?? parsed.monthlyIncomeToman };
  const retrieved = MARKET_INDEX.search(input.query, { topK: 40 }).filter((hit) => hit.matchedTerms.length > 0 && hit.item.archetype !== "investment-deposit" && hit.item.code !== "CBI-GAM-PROGRAM-350");
  const hits = retrieved.filter((hit) => hit.score >= (retrieved[0]?.score ?? 0) * 0.8);
  const results = hits.map((hit) => {
    const p = hit.item;
    const amount = profile.amountToman;
    const nominalRate = p.profitRate ?? p.feeRate;
    const payment = amount && p.tenorMonths && nominalRate !== null ? estimateMonthlyPayment(amount, nominalRate, p.tenorMonths) : null;
    const warnings: string[] = [];
    let conflicts = 0;
    if (/وام نقدی|تسهیلات نقدی|پول نقد/.test(normalizeFaText(input.query)) && p.useType === "purchase") { warnings.push("این اعتبار فقط برای خرید است، نه پرداخت وجه نقد."); conflicts++; }
    if (amount && amount > p.ceilingToman) { warnings.push("مبلغ درخواستی از سقف ثبت‌شده بیشتر است."); conflicts++; }
    if (profile.maxSleepMonths !== undefined && p.sleepMonths !== null && p.sleepMonths > profile.maxSleepMonths) { warnings.push("دوره خواب سپرده از محدودیت شما بیشتر است."); conflicts++; }
    if (profile.maxSleepMonths !== undefined && p.sleepMonths === null) warnings.push("دوره خواب سپرده نامشخص است.");
    if (profile.availableDepositToman !== undefined && p.minimumDepositToman !== undefined && profile.availableDepositToman < p.minimumDepositToman) { warnings.push("سپرده اعلام‌شده کمتر از حداقل ثبت‌شده است؛ احراز نسبت وام به سپرده همچنان لازم است."); conflicts++; }
    if (profile.availableGuarantees && p.guaranteesAccepted && !p.guaranteesAccepted.some((g) => g === "none" || profile.availableGuarantees?.includes(g))) { warnings.push("تضمین اعلام‌شده با تضمین ثبت‌شده سازگار نیست؛ از ارائه‌دهنده استعلام کنید."); conflicts++; }
    if (profile.availableGuarantees && !p.guaranteesAccepted) warnings.push("شرط ضمانت این طرح در داده ساخت‌یافته نامشخص است.");
    if (payment !== null && profile.monthlyIncomeToman !== undefined && payment + (profile.existingInstallmentToman ?? 0) > profile.monthlyIncomeToman * 0.4) { warnings.push("اقساط برآوردی و بدهی فعلی بیش از ۴۰٪ درآمد است؛ این آستانه فرض تحلیلی است."); conflicts++; }
    if (payment === null && amount) warnings.push("بازپرداخت به دلیل نبود نرخ یا مدت قابل برآورد نیست.");
    // Scenario only, not an APR or an estimate of the required deposit.
    const opportunityCost = profile.availableDepositToman !== undefined && profile.alternativeYield !== undefined && p.sleepMonths !== null
      ? profile.availableDepositToman * profile.alternativeYield * p.sleepMonths / 12 : null;
    return {
      code: p.code, productFa: p.productFa, bank: p.bank, segmentFa: p.segmentFa,
      ceilingToman: p.ceilingToman, tenorMonths: p.tenorMonths, sleepMonths: p.sleepMonths,
      nominalRate, effectiveAprHint: p.effectiveAprHint ?? null, estimatedMonthlyPaymentToman: payment,
      opportunityCostToman: opportunityCost, observedAt: p.observedAt ?? null,
      sourceRef: p.sourceRef, notesFa: p.notesFa, digitalOnboarding: p.digitalOnboarding ?? null,
      relevance: hit.score, rankScore: 0, conflicts,
      evidence: { bm25: hit.bm25Score, dense: hit.denseScore, matchedTerms: hit.matchedTerms }, warnings,
    };
  });
  // TOPSIS is a relative comparison, not a probability or eligibility score.
  const scores = topsis(results.map((r) => [r.relevance, profile.amountToman ? Math.min(r.ceilingToman / profile.amountToman, 1) : null, r.nominalRate, r.sleepMonths, r.estimatedMonthlyPaymentToman, r.digitalOnboarding === null ? null : Number(r.digitalOnboarding)]), [0.40, 0.18, 0.12, 0.12, 0.12, 0.06], [true, true, false, false, false, true]);
  results.forEach((r, i) => { r.rankScore = scores[i]; });
  results.sort((a, b) => (b.rankScore - Math.min(0.45, b.conflicts * 0.15)) - (a.rankScore - Math.min(0.45, a.conflicts * 0.15)) || b.relevance - a.relevance || a.code.localeCompare(b.code));
  return {
    profile: { amountToman: profile.amountToman ?? null, monthlyIncomeToman: profile.monthlyIncomeToman ?? null },
    results: results.slice(0, 8),
    knowledge: retrieveKnowledge(input.query, 3).map((d) => ({ code: d.code, titleFa: d.titleFa, citation: d.citation, relevance: d.relevance })),
    disclaimer: "مقایسه بر داده‌های نمونه و احتمالاً قدیمی استوار است و تأیید صلاحیت نیست. نرخ مؤثر و شرایط وام را از ارائه‌دهنده بررسی کنید. رتبه TOPSIS نسبی است؛ قسط، تخمین اقساط مساوی بدون هزینه جانبی است. هزینه فرصت سناریوی ساده برای کل سپرده اعلام‌شده است و سود واقعی سپرده یا مسدودی را لحاظ نمی‌کند.",
  };
}
