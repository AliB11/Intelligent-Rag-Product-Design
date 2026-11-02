/**
 * PostgreSQL persistence layer (Drizzle ORM) for the RAG vector store, the
 * benchmark registry and the generation-run audit trail. Every call degrades
 * gracefully when the database has not been migrated yet.
 */

import { db } from "@/db";
import { benchmarks, generationRuns, kbDocuments } from "@/db/schema";
import { sql } from "drizzle-orm";
import { BENCHMARK_SCHEMES } from "@/lib/rag/benchmarks";
import { KB_DOCUMENTS } from "@/lib/rag/knowledgeBase";
import type { AgentState } from "@/lib/agents/state";

let seedPromise: Promise<{ kb: number; benchmarks: number }> | null = null;

/** Idempotent seeding of the CBI knowledge base + Iranian benchmark registry. */
export function ensureSeeded(): Promise<{ kb: number; benchmarks: number }> {
  if (!seedPromise) {
    seedPromise = (async () => {
      let kbCount = 0;
      let benchCount = 0;
      try {
        await db.execute(sql`select 1`);
      } catch {
        return { kb: 0, benchmarks: 0 };
      }
      for (const doc of KB_DOCUMENTS) {
        try {
          await db
            .insert(kbDocuments)
            .values({
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
            })
            .onConflictDoUpdate({
              target: kbDocuments.code,
              set: {
                bodyFa: doc.bodyFa,
                bodyEn: doc.bodyEn,
                tokens: doc.tokens,
                embedding: doc.embedding,
                constraints: doc.constraints,
              },
            });
          kbCount += 1;
        } catch {
          /* ignore row-level failures */
        }
      }
      for (const b of BENCHMARK_SCHEMES) {
        try {
          await db
            .insert(benchmarks)
            .values({
              id: b.code,
              code: b.code,
              bank: b.bank,
              productFa: b.productFa,
              productEn: b.productEn,
              contractType: b.contractType,
              ceilingToman: b.ceilingToman,
              feeRate: b.feeRate,
              profitRate: b.profitRate,
              tenorMonths: b.tenorMonths,
              sleepMonths: b.sleepMonths,
              waitingDays: b.waitingDays,
              loanToDepositRatio: b.loanToDepositRatio,
              blockedRatio: b.blockedRatio,
              closedLoopRetention: b.closedLoopRetention,
              segmentFa: b.segmentFa,
              segmentEn: b.segmentEn,
              notesFa: b.notesFa,
              multiMode: b.multiMode ?? null,
            })
            .onConflictDoUpdate({
              target: benchmarks.code,
              set: { notesFa: b.notesFa, ceilingToman: b.ceilingToman },
            });
          benchCount += 1;
        } catch {
          /* ignore row-level failures */
        }
      }
      return { kb: kbCount, benchmarks: benchCount };
    })();
  }
  return seedPromise;
}

export async function saveRun(state: AgentState): Promise<string | null> {
  const id = crypto.randomUUID();
  const metrics = state.alm?.metrics;
  if (!state.request || !state.product || !metrics) return null;
  try {
    await db.insert(generationRuns).values({
      id,
      prompt: state.prompt,
      language: state.request.language,
      status: state.status,
      iterations: state.iteration,
      intent: state.request,
      retrievedConstraints: state.constraints,
      guild: state.ecosystem ?? null,
      productSpec: state.product,
      // the whole AlmResult is persisted so a saved run can be replayed with charts
      metrics: state.alm,
      sensitivity: state.sensitivity ?? null,
      trace: state.trace,
      reportFa: state.reportFa,
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
  iterations: number;
  targetDeposits: number;
  irrBank: number | null;
  maxLdr: number | null;
  minLcr: number | null;
  overturningRisk: number | null;
  createdAt: Date;
}

export async function listRuns(limit = 25): Promise<RunSummary[]> {
  try {
    const rows = await db
      .select({
        id: generationRuns.id,
        prompt: generationRuns.prompt,
        status: generationRuns.status,
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
      .limit(limit);
    return rows as RunSummary[];
  } catch {
    return [];
  }
}

export async function getRun(id: string) {
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

/** Vector-store search executed against PostgreSQL (cosine on the embedding). */
export async function kbSearch(query: string, limit = 8) {
  await ensureSeeded();
  try {
    const rows = await db
      .select({
        code: kbDocuments.code,
        titleFa: kbDocuments.titleFa,
        titleEn: kbDocuments.titleEn,
        category: kbDocuments.category,
        authority: kbDocuments.authority,
        bodyFa: kbDocuments.bodyFa,
        citations: kbDocuments.citations,
        tokens: kbDocuments.tokens,
      })
      .from(kbDocuments)
      .limit(200);
    const q = query.toLowerCase().split(/\s+/).filter((t) => t.length > 1);
    return rows
      .map((r) => {
        const hay = `${r.titleFa} ${r.titleEn} ${r.bodyFa} ${(r.tokens ?? []).join(" ")}`.toLowerCase();
        const hits = q.filter((t) => hay.includes(t)).length;
        return { ...r, relevance: q.length ? hits / q.length : 0 };
      })
      .filter((r) => r.relevance > 0)
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, limit);
  } catch {
    return [];
  }
}
