/**
 * app/rag/market_intel.py (TypeScript twin) — market intelligence layer
 * ---------------------------------------------------------------------------
 * Turns the researched market registry (`benchmarks.ts`) into usable product-
 * design intelligence:
 *
 *  1. analog retrieval  — score the parsed request against the registry and
 *     return the closest real market products with the matching reasons;
 *  2. prior derivation  — for every engine archetype that has enough analogs,
 *     compute the median of the observed structural parameters (τ_d, τ_l, ω,
 *     α, β, γ, δ, r_d, r_l) so the inverse optimizer explores the
 *     *market-observed* region of the design space instead of a uniform one;
 *  3. market-fit deviation — distance of the synthesized structure from its
 *     market analogs, reported back to the product-design unit.
 *
 * This module is deterministic and LLM-free: the intelligence comes from the
 * researched registry, not from a language model.
 */

import { MARKET_PRODUCTS, type MarketProduct, type MarketStructuralParams } from "./benchmarks";
import type { ContractType, ModeArchetype } from "../domain/types";

export type {
  MarketProduct,
  MarketSourceType,
  MarketStructuralParams,
} from "./benchmarks";

/** Keyword bridges between an engine persona and market-registry language. */
const PERSONA_SEARCH_TERMS: Record<string, string[]> = {
  "physician-specialist": ["درمان", "پزشک", "کادر درمان", "کلینیک", "بیمار"],
  "dental-clinic": ["درمان", "دندان", "کادر درمان"],
  pharmacy: ["دارو", "درمان", "پخش"],
  "logistics-driver": ["حمل", "راننده", "باربری", "ناوگان", "بار"],
  "pos-merchant": ["پذیرنده", "پوز", "pos", "فروشگاه", "خرید اقساطی", "bnpl"],
  "corporate-payroll": ["حقوق", "کارکنان", "کارمند", "سازمان"],
  "industrial-supplier": ["زنجیره", "گام", "تولید", "صنعتی", "فاکتور", "تأمین"],
  "gold-jeweller": ["طلا", "شمش"],
  "retail-vulnerable": ["آسیب‌پذیر", "روستا", "کم‌درآمد", "اقشار"],
  "student-community": ["دانشج"],
  "exporter-importer": ["صادرات", "واردات", "صادر"],
  "agri-farmer": ["کشاورز", "نهاده", "دامدار"],
};

export interface AnalogScore {
  product: MarketProduct;
  score: number;
  reasonsFa: string[];
}

export interface ArchetypePrior {
  archetype: ModeArchetype;
  analogCount: number;
  analogCodes: string[];
  /** Median of the researched structural parameters of the analog group. */
  median: MarketStructuralParams;
  /** Contract the analog group converges on (majority), when one exists. */
  contractHint: ContractType | null;
}

export interface MarketPriors {
  byArchetype: Partial<Record<ModeArchetype, ArchetypePrior>>;
  analogs: AnalogScore[];
  /** 0..1 — strength of the match between the request and the registry. */
  coverage: number;
  analogCount: number;
}

export interface MarketRequestContext {
  prompt: string;
  personaKey: string | null;
  guild: string | null;
  preferredContracts: ContractType[];
  emphases: string[];
  targetDepositsHemmat: number;
}

const MIN_ANALOGS_FOR_PRIOR = 2;
const MAX_ANALOGS = 14;

/** Median of a numeric list. */
function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function scoreAnalog(context: MarketRequestContext, product: MarketProduct): AnalogScore {
  let score = 0;
  const reasonsFa: string[] = [];

  if (context.preferredContracts.includes(product.contract)) {
    score += 3;
    reasonsFa.push("تطابق عقد ترجیحی");
  }

  const personaTerms = context.personaKey ? PERSONA_SEARCH_TERMS[context.personaKey] ?? [] : [];
  const haystack = `${product.segmentFa} ${product.segmentEn} ${product.notesFa} ${product.bank} ${product.productFa}`;
  for (const term of personaTerms) {
    if (haystack.toLowerCase().includes(term.toLowerCase())) {
      score += 2.5;
      reasonsFa.push(`تطابق پرسونا «${term}»`);
      break;
    }
  }

  const textLower = context.prompt.toLowerCase();
  for (const token of [product.bank, product.productFa]) {
    const probe = token.slice(0, 8).toLowerCase();
    if (probe.length > 3 && textLower.includes(probe)) {
      score += 2;
      reasonsFa.push("ارجاع مستقیم در متن کاربر");
      break;
    }
  }

  for (const emphasis of context.emphases) {
    if (emphasis === "closed-loop" && product.params.closedLoopRetention >= 0.7) {
      score += 1.5;
      reasonsFa.push("حلقه بسته بالا");
    }
    if (emphasis === "financial-inclusion" && /Vulnerable|vulnerable|روستا|کم‌درآمد/.test(`${product.segmentEn} ${product.segmentFa}`)) {
      score += 1.5;
      reasonsFa.push("شمول مالی");
    }
    if (emphasis === "merchant-float" && product.archetype === "merchant-pos-accelerator") {
      score += 1.5;
      reasonsFa.push("شناور پذیرنده");
    }
    if (emphasis === "supply-chain" && product.archetype === "supply-chain-gam") {
      score += 1.5;
      reasonsFa.push("زنجیره تأمین");
    }
    if (emphasis === "profitability" && (product.params.loanRate >= 0.18 || (product.profitRate ?? 0) >= 0.18)) {
      score += 0.75;
      reasonsFa.push("بازده بالای بازار");
    }
  }

  // scale proximity: products whose ceiling is within two orders of magnitude
  // of the per-mode resource volume implied by the request.
  const perModeToman = (context.targetDepositsHemmat / 3) * 1e13 / 10;
  const scaleRatio = product.ceilingToman > 0 ? perModeToman / product.ceilingToman : 1;
  if (scaleRatio >= 0.02 && scaleRatio <= 200) {
    score += 1;
    reasonsFa.push("مقیاس سازگار");
  }

  return { product, score, reasonsFa };
}

/**
 * Analyze the parsed request against the market registry: return the closest
 * real products and archetype-level medians usable as optimizer priors.
 */
export function analyzeMarket(context: MarketRequestContext): MarketPriors {
  const scored = MARKET_PRODUCTS
    .map((product) => scoreAnalog(context, product))
    .sort((a, b) => b.score - a.score);
  const maxScore = scored[0]?.score ?? 0;
  const relevant = scored.filter((item) => item.score > 0);
  const topAnalogs = (relevant.length ? relevant : scored.slice(0, 8)).slice(0, MAX_ANALOGS);
  const coverage = maxScore > 0 ? Math.min(1, maxScore / 8) : 0;

  const groups = new Map<ModeArchetype, AnalogScore[]>();
  for (const item of topAnalogs) {
    const list = groups.get(item.product.archetype) ?? [];
    list.push(item);
    groups.set(item.product.archetype, list);
  }

  const byArchetype: MarketPriors["byArchetype"] = {};
  for (const [archetype, items] of groups) {
    if (items.length < MIN_ANALOGS_FOR_PRIOR) continue;
    const paramsList = items.map((item) => item.product.params);
    const pick = <K extends keyof MarketStructuralParams>(key: K): number =>
      median(paramsList.map((params) => params[key]));
    // contract the analog group converges on (strict majority)
    const contractFrequency = new Map<ContractType, number>();
    for (const item of items) {
      contractFrequency.set(item.product.contract, (contractFrequency.get(item.product.contract) ?? 0) + 1);
    }
    const rankedContracts = [...contractFrequency.entries()].sort((a, b) => b[1] - a[1]);
    const contractHint =
      rankedContracts.length && rankedContracts[0][1] > items.length / 2 ? rankedContracts[0][0] : null;
    byArchetype[archetype] = {
      archetype,
      analogCount: items.length,
      analogCodes: items.map((item) => item.product.code),
      contractHint,
      median: {
        sleepMonths: pick("sleepMonths"),
        tenorMonths: pick("tenorMonths"),
        waitingMonths: pick("waitingMonths"),
        loanMultiplier: pick("loanMultiplier"),
        blockedRatio: pick("blockedRatio"),
        closedLoopRetention: pick("closedLoopRetention"),
        withdrawalFraction: pick("withdrawalFraction"),
        depositRate: pick("depositRate"),
        loanRate: pick("loanRate"),
      },
    };
  }

  return {
    byArchetype,
    analogs: topAnalogs,
    coverage,
    analogCount: topAnalogs.length,
  };
}

/** Best matching real products for a free-text query (used by the API layer). */
export function searchMarketProducts(query: string, limit = 12): MarketProduct[] {
  const tokens = query.toLowerCase().split(/[\s,،.;؛]+/).filter((token) => token.length > 1);
  if (!tokens.length) return MARKET_PRODUCTS.slice(0, limit);
  const scored = MARKET_PRODUCTS.map((product) => {
    const haystack = `${product.bank} ${product.productFa} ${product.productEn} ${product.segmentFa} ${product.segmentEn} ${product.notesFa} ${product.contract}`.toLowerCase();
    const hits = tokens.filter((token) => haystack.includes(token)).length;
    return { product, hits };
  })
    .filter((item) => item.hits > 0)
    .sort((a, b) => b.hits - a.hits);
  const list = scored.length ? scored.map((item) => item.product) : MARKET_PRODUCTS;
  return list.slice(0, limit);
}
