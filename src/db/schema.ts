import {
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * RAG knowledge base of Central Bank of Iran (CBI) directives, Islamic
 * contract rules and customer-protection principles.
 *
 * `embedding` is a deterministic hashed bag-of-words vector (128 dims) so the
 * store is pgvector-compatible (cosine similarity) while remaining fully
 * reproducible inside the sandbox.
 */
export const kbDocuments = pgTable("kb_documents", {
  id: text("id").primaryKey(),
  code: text("code").notNull().unique(),
  category: text("category").notNull(),
  authority: text("authority").notNull(),
  titleFa: text("title_fa").notNull(),
  titleEn: text("title_en").notNull(),
  bodyFa: text("body_fa").notNull(),
  bodyEn: text("body_en").notNull(),
  tokens: text("tokens").array().notNull(),
  embedding: doublePrecision("embedding").array(),
  constraints: jsonb("constraints").notNull(),
  citations: text("citations").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Pre-seeded Iranian banking product benchmark registry (Mehr Iran, Tejarat, Mellat, Melli, Shahr, Medical Fund...). */
export const benchmarks = pgTable("benchmarks", {
  id: text("id").primaryKey(),
  code: text("code").notNull().unique(),
  bank: text("bank").notNull(),
  productFa: text("product_fa").notNull(),
  productEn: text("product_en").notNull(),
  contractType: text("contract_type").notNull(),
  ceilingToman: doublePrecision("ceiling_toman").notNull(),
  feeRate: doublePrecision("fee_rate"),
  profitRate: doublePrecision("profit_rate"),
  tenorMonths: integer("tenor_months"),
  sleepMonths: doublePrecision("sleep_months"),
  waitingDays: integer("waiting_days"),
  loanToDepositRatio: doublePrecision("loan_to_deposit_ratio"),
  blockedRatio: doublePrecision("blocked_ratio"),
  closedLoopRetention: doublePrecision("closed_loop_retention"),
  segmentFa: text("segment_fa").notNull(),
  segmentEn: text("segment_en").notNull(),
  notesFa: text("notes_fa").notNull(),
  multiMode: jsonb("multi_mode").array(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Persisted inverse goal-seeking generation runs (full digital-twin audit trail). */
export const generationRuns = pgTable("generation_runs", {
  id: text("id").primaryKey(),
  prompt: text("prompt").notNull(),
  language: text("language").notNull(),
  status: text("status").notNull(),
  iterations: integer("iterations").notNull(),
  intent: jsonb("intent").notNull(),
  retrievedConstraints: jsonb("retrieved_constraints").notNull(),
  guild: jsonb("guild"),
  productSpec: jsonb("product_spec").notNull(),
  metrics: jsonb("metrics").notNull(),
  sensitivity: jsonb("sensitivity"),
  trace: jsonb("trace").notNull(),
  reportFa: text("report_fa").notNull(),
  targetDeposits: doublePrecision("target_deposits").notNull(),
  irrBank: doublePrecision("irr_bank"),
  maxLdr: doublePrecision("max_ldr"),
  minLcr: doublePrecision("min_lcr"),
  overturningRisk: doublePrecision("overturning_risk"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type KbDocument = typeof kbDocuments.$inferSelect;
export type Benchmark = typeof benchmarks.$inferSelect;
export type GenerationRun = typeof generationRuns.$inferSelect;
