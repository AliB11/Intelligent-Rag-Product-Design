/**
 * PostgreSQL persistence layer (Drizzle ORM) for the local RAG corpus,
 * illustrative benchmark registry and full generation audit trail.
 * Database failures degrade to the in-memory domain corpus; failed seeding is
 * retried rather than being memoized permanently.
 */

import { db } from "@/db";
import { benchmarks, generationRuns, kbDocuments } from "@/db/schema";
import { sql } from "drizzle-orm";
import { BENCHMARK_SCHEMES } from "@/lib/rag/benchmarks";
import { cosine, embed, KB_DOCUMENTS, tokenise } from "@/lib/rag/knowledgeBase";
import type { AgentState } from "@/lib/agents/state";

interface SeedResult {
  kb: number;
  benchmarks: number;
  persisted: boolean;
}

let seedPromise: Promise<SeedResult> | null = null;
let retryAfter = 0;
const databaseConfigured = Boolean(process.env.DATABASE_URL?.trim());
const inMemorySeedResult: SeedResult = {
  kb: KB_DOCUMENTS.length,
  benchmarks: BENCHMARK_SCHEMES.length,
  persisted: false,
};

/** Idempotently seed PostgreSQL; retain accurate in-memory corpus counts on DB failure. */
export function ensureSeeded(): Promise<SeedResult> {
  if (!databaseConfigured) return Promise.resolve(inMemorySeedResult);
  if (seedPromise) return seedPromise;
  if (Date.now() < retryAfter) return Promise.resolve(inMemorySeedResult);

  const pending = (async () => {
    try {
      await db.execute(sql`select 1`);
      await db
        .insert(kbDocuments)
        .values(KB_DOCUMENTS.map((doc) => ({
          id: doc.id,
          code: doc.code,
          category: doc.category,
          authority: doc.authority,
          titleFa: doc.titleFa,
          titleEn: doc.titleEn,
          bodyFa: doc.bodyFa,
          bodyEn: doc.bodyEn,
          tokens: doc.tokens,
          embedding: doc.embedding,
          constraints: doc.constraints,
          citations: doc.citation,
        })))
        .onConflictDoUpdate({
          target: kbDocuments.code,
          set: {
            category: sql`excluded.category`,
            authority: sql`excluded.authority`,
            titleFa: sql`excluded.title_fa`,
            titleEn: sql`excluded.title_en`,
            bodyFa: sql`excluded.body_fa`,
            bodyEn: sql`excluded.body_en`,
            tokens: sql`excluded.tokens`,
            embedding: sql`excluded.embedding`,
            constraints: sql`excluded.constraints`,
            citations: sql`excluded.citations`,
          },
        });

      await db
        .insert(benchmarks)
        .values(BENCHMARK_SCHEMES.map((item) => ({
          id: item.code,
          code: item.code,
          bank: item.bank,
          productFa: item.productFa,
          productEn: item.productEn,
          contractType: item.contractType,
          ceilingToman: item.ceilingToman,
          feeRate: item.feeRate,
          profitRate: item.profitRate,
          tenorMonths: item.tenorMonths,
          sleepMonths: item.sleepMonths,
          waitingDays: item.waitingDays,
          loanToDepositRatio: item.loanToDepositRatio,
          blockedRatio: item.blockedRatio,
          closedLoopRetention: item.closedLoopRetention,
          segmentFa: item.segmentFa,
          segmentEn: item.segmentEn,
          notesFa: item.notesFa,
          multiMode: item.multiMode ?? null,
        })))
        .onConflictDoUpdate({
          target: benchmarks.code,
          set: {
            bank: sql`excluded.bank`,
            productFa: sql`excluded.product_fa`,
            productEn: sql`excluded.product_en`,
            contractType: sql`excluded.contract_type`,
            ceilingToman: sql`excluded.ceiling_toman`,
            feeRate: sql`excluded.fee_rate`,
            profitRate: sql`excluded.profit_rate`,
            tenorMonths: sql`excluded.tenor_months`,
            sleepMonths: sql`excluded.sleep_months`,
            waitingDays: sql`excluded.waiting_days`,
            loanToDepositRatio: sql`excluded.loan_to_deposit_ratio`,
            blockedRatio: sql`excluded.blocked_ratio`,
            closedLoopRetention: sql`excluded.closed_loop_retention`,
            segmentFa: sql`excluded.segment_fa`,
            segmentEn: sql`excluded.segment_en`,
            notesFa: sql`excluded.notes_fa`,
            multiMode: sql`excluded.multi_mode`,
          },
        });

      return { kb: KB_DOCUMENTS.length, benchmarks: BENCHMARK_SCHEMES.length, persisted: true };
    } catch {
      return { kb: KB_DOCUMENTS.length, benchmarks: BENCHMARK_SCHEMES.length, persisted: false };
    }
  })();

  seedPromise = pending;
  void pending.then((result) => {
    if (!result.persisted) {
      retryAfter = Date.now() + 5_000;
      seedPromise = null;
    } else {
      retryAfter = 0;
    }
  }).catch(() => {
    retryAfter = Date.now() + 5_000;
    seedPromise = null;
  });
  return pending;
}

export async function saveRun(state: AgentState): Promise<string | null> {
  if (!databaseConfigured) return null;
  const id = crypto.randomUUID();
  const metrics = state.alm?.metrics;
  if (!state.request || !state.product || !state.alm || !metrics) return null;
  try {
    await db.insert(generationRuns).values({
      id,
      prompt: state.prompt,
      language: state.request.language,
      status: state.status,
      validationStatus: state.validationStatus,
      iterations: state.iteration,
      intent: state.request,
      retrievedConstraints: state.constraints,
      marketIntel: state.marketIntel ?? null,
      guild: state.ecosystem ?? null,
      persona: state.persona ?? null,
      findings: state.findings,
      productSpec: state.product,
      // Persist all charts and generated artifacts so historical runs replay fully.
      metrics: state.alm,
      sensitivity: state.sensitivity ?? null,
      benchmarks: state.benchmarks,
      accountingEntries: state.accountingEntries,
      complianceDraft: state.complianceDraft,
      trace: state.trace,
      reportFa: state.reportFa,
      reportEn: state.reportEn,
      targetDeposits: state.request.targetDepositsRial,
      irrBank: metrics.irrBankAnnual,
      maxLdr: metrics.p95Ldr,
      minLcr: metrics.p5Lcr,
      overturningRisk: metrics.overturningShock,
    });
    return id;
  } catch {
    return null;
  }
}

export interface RunSummary {
  id: string;
  prompt: string;
  status: string;
  validationStatus: string;
  iterations: number;
  targetDeposits: number;
  irrBank: number | null;
  maxLdr: number | null;
  minLcr: number | null;
  overturningRisk: number | null;
  createdAt: Date | string;
}

export async function listRuns(limit = 25): Promise<RunSummary[]> {
  if (!databaseConfigured) return [];
  const safeLimit = Number.isFinite(limit) ? Math.min(100, Math.max(1, Math.floor(limit))) : 25;
  try {
    const rows = await db
      .select({
        id: generationRuns.id,
        prompt: generationRuns.prompt,
        status: generationRuns.status,
        validationStatus: generationRuns.validationStatus,
        iterations: generationRuns.iterations,
        targetDeposits: generationRuns.targetDeposits,
        irrBank: generationRuns.irrBank,
        maxLdr: generationRuns.maxLdr,
        minLcr: generationRuns.minLcr,
        overturningRisk: generationRuns.overturningRisk,
        createdAt: generationRuns.createdAt,
      })
      .from(generationRuns)
      .orderBy(sql`${generationRuns.createdAt} desc`)
      .limit(safeLimit);
    return rows as RunSummary[];
  } catch {
    return [];
  }
}

export async function getRun(id: string) {
  if (!databaseConfigured) return null;
  try {
    const rows = await db
      .select()
      .from(generationRuns)
      .where(sql`${generationRuns.id} = ${id}`)
      .limit(1);
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

/** Hybrid vector + lexical search against PostgreSQL's mirrored corpus. */
export async function kbSearch(query: string, limit = 8) {
  if (!databaseConfigured) return [];
  const cleanQuery = query.trim().slice(0, 512);
  if (!cleanQuery) return [];
  const safeLimit = Number.isFinite(limit) ? Math.min(50, Math.max(1, Math.floor(limit))) : 8;
  const seed = await ensureSeeded();
  if (!seed.persisted) return [];
  try {
    const rows = await db
      .select({
        code: kbDocuments.code,
        titleFa: kbDocuments.titleFa,
        titleEn: kbDocuments.titleEn,
        category: kbDocuments.category,
        authority: kbDocuments.authority,
        bodyFa: kbDocuments.bodyFa,
        bodyEn: kbDocuments.bodyEn,
        citations: kbDocuments.citations,
        tokens: kbDocuments.tokens,
        embedding: kbDocuments.embedding,
      })
      .from(kbDocuments)
      .limit(200);
    const queryTokens = new Set(tokenise(cleanQuery));
    const queryVector = embed(cleanQuery);
    return rows
      .map((row) => {
        const tokens = row.tokens ?? [];
        const overlap = tokens.reduce((count, token) => count + Number(queryTokens.has(token)), 0);
        const lexical = queryTokens.size && tokens.length
          ? overlap / Math.sqrt(queryTokens.size * tokens.length)
          : 0;
        const semantic = Math.max(0, cosine(queryVector, row.embedding ?? []));
        return { ...row, relevance: Math.min(1, 0.55 * semantic + 0.45 * lexical) };
      })
      .filter((row) => row.relevance > 0.04)
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, safeLimit);
  } catch {
    return [];
  }
}
