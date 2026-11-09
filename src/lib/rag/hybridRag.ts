/**
 * src/lib/rag/hybridRag.ts
 * ---------------------------------------------------------------------------
 * Multi-Stage Hybrid RAG Engine for Iranian Banking & Financial Intelligence.
 *
 * Combines:
 *  1. Persian/English morphological normalization, ZWNJ bi-form generation,
 *     lightweight suffix stemming, and colloquial banking query expansion;
 *  2. Zone-weighted Okapi BM25+ sparse retrieval (k1 = 1.5, b = 0.75, δ = 0.5);
 *  3. 256-dim signed feature-hashed dense vector retrieval over word unigrams,
 *     word bigrams, and character 3/4-grams (subword typo/inflection resilience);
 *  4. Reciprocal Rank Fusion (RRF) + metadata/constraint boosting with full
 *     explainable retrieval provenance.
 *
 * Deterministic and local; makes no external network or LLM calls.
 */

export const HYBRID_EMBED_DIM = 256;

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";

const STOP_WORDS = new Set([
  "از", "به", "در", "با", "برای", "که", "این", "آن", "را", "یک", "تا", "یا",
  "هم", "بر", "است", "شود", "دارد", "می", "من", "ما", "شما", "چه", "چقدر",
  "میخوام", "میخواهم", "بگیرم", "بده", "کن", "کنید", "لطفا", "سلام", "درود",
  "the", "and", "for", "with", "from", "that", "this", "into", "over", "under",
]);

const PERSIAN_SUFFIXES = [
  "هایی", "های", "ترین", "گان", "شان", "مان", "تان", "هایم", "هایت",
  "ها", "تر", "ان", "ات", "ین", "اش", "ای",
];

/** Domain-specific colloquial & semantic expansion dictionary (Iranian banking / Rade.ir). */
const DOMAIN_EXPANSIONS: readonly { triggers: string[]; expand: string[] }[] = [
  { triggers: ["ماشین", "اتومبیل", "پراید", "پژو", "دنا", "شاهین", "تارا خودرو"], expand: ["خودرو", "وام خودرو", "رهن خودرو"] },
  { triggers: ["خونه", "خانه", "آپارتمان", "ملک", "مستاجر", "ودیعه"], expand: ["مسکن", "تسه", "اوراق مسکن", "رهن", "تعمیرات"] },
  { triggers: ["عروسی", "داماد", "عروس", "نامزدی"], expand: ["ازدواج", "قرض الحسنه", "جهیزیه"] },
  { triggers: ["بچه", "نوزاد", "تولد فرزند"], expand: ["فرزندآوری", "قرض الحسنه"] },
  { triggers: ["بی ضامن", "بیضامن", "بدون ضامن", "ضامن ندارم"], expand: ["بدون ضامن", "اعتبارسنجی", "سفته الکترونیک", "چک صیادی", "نئوبانک"] },
  { triggers: ["فوری", "آنی", "سریع", "یک روزه", "همین امروز", "بدون خواب"], expand: ["فوری", "بدون خواب", "نئوبانک", "لندتک", "توثیق"] },
  { triggers: ["قسطی", "اقساطی", "کالا", "موبایل", "لپتاپ", "لپ تاپ", "لوازم خانگی", "یخچال"], expand: ["خرید کالا", "خرید اقساطی", "bnpl", "لندتک", "کالاکارت"] },
  { triggers: ["بلو", "بلوبانک", "ویپاد", "توبانک", "بانکینو", "کیوبانک", "باجت", "امیدبانک", "سپینو"], expand: ["نئوبانک", "بانک دیجیتال", "بدون ضامن", "آنلاین"] },
  { triggers: ["اسنپ پی", "تارا", "ازکی وام", "دیجی پی", "لندو", "تکنوپی"], expand: ["لندتک", "bnpl", "خرید اقساطی", "کیف پول"] },
  { triggers: ["طلا", "سکه", "شمش", "صندوق", "درآمد ثابت", "سهام", "رمزارز", "کریپتو", "دارایی"], expand: ["توثیق", "دارایی", "صندوق درآمد ثابت", "شمش", "طلا", "وثیقه"] },
  { triggers: ["معدل", "امتیاز", "رسالت", "مهر ایران", "مهربانی", "نیک وام", "نگین"], expand: ["امتیازی", "میانگین حساب", "قرض الحسنه", "سپرده"] },
  { triggers: ["کارتخوان", "پوز", "pos", "درگاه", "فروشگاه", "مغازه", "کاسب"], expand: ["پذیرنده", "کارتخوان", "pos", "سرمایه در گردش"] },
  { triggers: ["کارمند", "فیش حقوقی", "حکم کارگزینی", "مستمری"], expand: ["حقوق بگیر", "کسر از حقوق", "سازمانی"] },
];

/** Normalise Persian/Arabic characters, digits, and ZWNJ spacing. */
export function normalizeFaText(input: string): string {
  const mapped = input
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u064A\u0649]/g, "ی")
    .replace(/\u0643/g, "ک")
    .replace(/[\u064B-\u065F\u0640]/g, "")
    .split("")
    .map((ch) => {
      const fa = FA_DIGITS.indexOf(ch);
      if (fa >= 0) return String(fa);
      const ar = AR_DIGITS.indexOf(ch);
      if (ar >= 0) return String(ar);
      return ch;
    })
    .join("");

  // Emit both ZWNJ-joined and ZWNJ-split forms by replacing ZWNJ with space in primary stream
  return mapped
    .replace(/[\u200c\u200f]+/g, " ")
    .replace(/[^0-9a-z\u0600-\u06FF]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Lightweight, deterministic Persian suffix stemmer preserving root >= 3 chars. */
export function stemPersianToken(token: string): string {
  if (token.length <= 4 || /^[0-9a-z]+$/.test(token)) return token;
  for (const suffix of PERSIAN_SUFFIXES) {
    if (token.endsWith(suffix) && token.length - suffix.length >= 3) {
      return token.slice(0, token.length - suffix.length);
    }
  }
  return token;
}

/** Tokenise text into both surface tokens and morphological stems, plus ZWNJ-joined compounds. */
export function tokenizeRich(rawText: string, expandSynonyms = false): string[] {
  const joinedCompounds: string[] = [];
  const zwnjRegex = /[\u0600-\u06FF]+\u200c[\u0600-\u06FF]+/g;
  let m: RegExpExecArray | null;
  while ((m = zwnjRegex.exec(rawText)) !== null) {
    const joined = normalizeFaText(m[0].replace(/\u200c/g, ""));
    if (joined.length >= 3) joinedCompounds.push(joined);
  }

  const norm = normalizeFaText(rawText);
  const rawTokens = norm.split(" ").filter((t) => t.length > 1 && !STOP_WORDS.has(t));

  const out: string[] = [...joinedCompounds];
  for (const t of rawTokens) {
    out.push(t);
    const stem = stemPersianToken(t);
    if (stem !== t) out.push(stem);
  }

  if (expandSynonyms) {
    for (const rule of DOMAIN_EXPANSIONS) {
      if (rule.triggers.some((tr) => norm.includes(normalizeFaText(tr)))) {
        for (const extra of rule.expand) {
          for (const sub of normalizeFaText(extra).split(" ")) {
            if (sub.length > 1) out.push(sub);
          }
        }
      }
    }
  }

  return out.slice(0, 500);
}

function fnv1a(feature: string): number {
  let hash = 2166136261;
  for (let i = 0; i < feature.length; i += 1) {
    hash ^= feature.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function addSignedFeature(vec: number[], feature: string, weight: number): void {
  const h = fnv1a(feature);
  const idx = h % HYBRID_EMBED_DIM;
  const sign = (h & 0x80000000) === 0 ? 1 : -1;
  vec[idx] += sign * weight;
}

/**
 * 256-dim dense feature-hashed embedding over word unigrams + word bigrams +
 * character 3/4-grams (subword representations).
 */
export function embedHybrid256(text: string, isQuery = false): number[] {
  const vec = new Array<number>(HYBRID_EMBED_DIM).fill(0);
  const tokens = tokenizeRich(text, isQuery);
  if (!tokens.length) return vec;

  const tf = new Map<string, number>();
  for (const tok of tokens) tf.set(tok, (tf.get(tok) ?? 0) + 1);

  tf.forEach((freq, tok) => {
    const w = 1 + Math.log(freq);
    addSignedFeature(vec, `w:${tok}`, w);
    // Character 3-grams and 4-grams for morphological & typo invariance
    const padded = `<${tok}>`;
    if (padded.length >= 4) {
      for (let i = 0; i <= padded.length - 3; i += 1) {
        addSignedFeature(vec, `c3:${padded.slice(i, i + 3)}`, 0.38 * w);
      }
    }
    if (padded.length >= 5) {
      for (let i = 0; i <= padded.length - 4; i += 1) {
        addSignedFeature(vec, `c4:${padded.slice(i, i + 4)}`, 0.32 * w);
      }
    }
  });

  // Word bigrams capture phrases like "بدون ضامن", "میانگین حساب", "صندوق طلا"
  for (let i = 0; i < Math.min(tokens.length - 1, 200); i += 1) {
    addSignedFeature(vec, `bi:${tokens[i]}_${tokens[i + 1]}`, 0.85);
  }

  let normSq = 0;
  for (let i = 0; i < HYBRID_EMBED_DIM; i += 1) normSq += vec[i] * vec[i];
  const norm = Math.sqrt(normSq) || 1;
  for (let i = 0; i < HYBRID_EMBED_DIM; i += 1) vec[i] /= norm;
  return vec;
}

export function cosineDense(a: number[], b: number[]): number {
  if (a.length !== b.length || !a.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i += 1) dot += a[i] * b[i];
  return Math.max(0, Math.min(1, dot));
}

export interface HybridIndexDoc<T> {
  id: string;
  title: string;
  entity: string;
  tags: string;
  body: string;
  item: T;
}

interface IndexedRecord<T> {
  id: string;
  item: T;
  tfWeighted: Map<string, number>;
  docLen: number;
  dense: number[];
  rawTokens: Set<string>;
}

export interface HybridSearchHit<T> {
  id: string;
  item: T;
  score: number;
  bm25Score: number;
  denseScore: number;
  rrfScore: number;
  matchedTerms: string[];
}

/**
 * Reusable Hybrid Sparse (BM25+) + Dense (256D Subword) + RRF Retriever.
 */
export class HybridRagIndex<T> {
  private readonly records: IndexedRecord<T>[] = [];
  private readonly df = new Map<string, number>();
  private readonly avgDocLen: number;
  private readonly k1 = 1.5;
  private readonly b = 0.75;
  private readonly delta = 0.5;
  private readonly rrfK = 60;

  constructor(docs: HybridIndexDoc<T>[]) {
    let totalLen = 0;
    for (const doc of docs) {
      const tfWeighted = new Map<string, number>();
      const rawTokens = new Set<string>();
      const zones: [string, number][] = [
        [doc.title, 3.0],
        [doc.tags, 2.5],
        [doc.entity, 2.2],
        [doc.body, 1.15],
      ];
      let docLen = 0;
      for (const [text, zoneWeight] of zones) {
        const toks = tokenizeRich(text, false);
        for (const tok of toks) {
          tfWeighted.set(tok, (tfWeighted.get(tok) ?? 0) + zoneWeight);
          rawTokens.add(tok);
          docLen += zoneWeight;
        }
      }
      rawTokens.forEach((tok) => {
        this.df.set(tok, (this.df.get(tok) ?? 0) + 1);
      });
      totalLen += docLen;
      const fullText = `${doc.title} ${doc.entity} ${doc.tags} ${doc.body}`;
      this.records.push({
        id: doc.id,
        item: doc.item,
        tfWeighted,
        docLen: Math.max(1, docLen),
        dense: embedHybrid256(fullText, false),
        rawTokens,
      });
    }
    this.avgDocLen = docs.length ? totalLen / docs.length : 1;
  }

  search(
    query: string,
    options: {
      topK?: number;
      boostFn?: (item: T) => number;
      minScore?: number;
      /**
       * Governance PRE-filter. When present it runs BEFORE any BM25 or dense
       * scoring: excluded records are never scored, never enter the RRF rank
       * lists, and cannot surface regardless of textual relevance. This is how
       * superseded / amended / expired regulatory chunks are kept out of the
       * ranking (status !== "ACTIVE" is filtered before fusion).
       */
      filterFn?: (item: T) => boolean;
    } = {},
  ): HybridSearchHit<T>[] {
    const topK = Math.max(1, Math.min(100, options.topK ?? 12));
    if (!this.records.length) return [];

    // --- Pre-filter (governance) — happens before scoring -------------------
    const candidates = options.filterFn
      ? this.records.filter((rec) => options.filterFn!(rec.item))
      : this.records;
    if (!candidates.length) return [];

    const qTokens = Array.from(new Set(tokenizeRich(query, true)));
    if (!qTokens.length) {
      return [];
    }

    const qDense = embedHybrid256(query, true);
    const N = this.records.length;

    const rawScores = candidates.map((rec, index) => {
      let bm25 = 0;
      const matchedTerms: string[] = [];
      for (const qt of qTokens) {
        const tf = rec.tfWeighted.get(qt) ?? 0;
        if (tf <= 0) continue;
        matchedTerms.push(qt);
        const df = this.df.get(qt) ?? 0;
        const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
        const normTf =
          (tf * (this.k1 + 1)) /
          (tf + this.k1 * (1 - this.b + this.b * (rec.docLen / this.avgDocLen)));
        bm25 += idf * (normTf + this.delta);
      }
      const dense = cosineDense(qDense, rec.dense);
      return { index, rec, bm25, dense, matchedTerms };
    });

    // Compute BM25 and Dense ranks for Reciprocal Rank Fusion (RRF) —
    // ranks are assigned within the pre-filtered candidate set only.
    const byBm25 = [...rawScores].sort((a, b) => b.bm25 - a.bm25);
    const byDense = [...rawScores].sort((a, b) => b.dense - a.dense);
    const bm25Rank = new Array<number>(candidates.length);
    const denseRank = new Array<number>(candidates.length);
    byBm25.forEach((entry, r) => { bm25Rank[entry.index] = r + 1; });
    byDense.forEach((entry, r) => { denseRank[entry.index] = r + 1; });

    const maxBm25 = Math.max(1e-6, byBm25[0]?.bm25 ?? 1);
    const maxRrf = 0.52 / (this.rrfK + 1) + 0.48 / (this.rrfK + 1);

    const fused: HybridSearchHit<T>[] = rawScores.map((entry) => {
      const rrfRaw =
        0.52 / (this.rrfK + bm25Rank[entry.index]) +
        0.48 / (this.rrfK + denseRank[entry.index]);
      const rrfNorm = rrfRaw / maxRrf;
      const bm25Norm = entry.bm25 / maxBm25;
      const boost = options.boostFn ? options.boostFn(entry.rec.item) : 0;
      // Blend normalized RRF + calibrated BM25/Dense magnitude + domain boost
      const combined = Math.min(
        1,
        Math.max(0, 0.42 * rrfNorm + 0.33 * bm25Norm + 0.25 * entry.dense + boost),
      );
      return {
        id: entry.rec.id,
        item: entry.rec.item,
        score: combined,
        bm25Score: Number(bm25Norm.toFixed(4)),
        denseScore: Number(entry.dense.toFixed(4)),
        rrfScore: Number(rrfNorm.toFixed(4)),
        matchedTerms: entry.matchedTerms.slice(0, 6),
      };
    });

    const minScore = options.minScore ?? 0.05;
    return fused
      .filter((h) => h.score >= minScore && (h.bm25Score > 0 || h.denseScore > 0.08))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }
}
