/**
 * app/agents/state.py -> TypeScript twin
 * ---------------------------------------------------------------------------
 * Typed LangGraph channel state carried by every node of the StateGraph and
 * the SSE trace events streamed to the frontend.
 */

import type {
  AlmResult,
  BenchmarkScheme,
  CriticFinding,
  GuildEcosystem,
  ModeSpec,
  PersonaSpec,
  ProductGenerationRequest,
  ProductSpec,
  RegulatoryConstraint,
} from "../domain/types";
import type { RegulatoryConstraints } from "../domain/regulatory";
import type { OptimizerIteration } from "../domain/optimizer";
import type {
  InverseSolverInput,
  InverseSolverResult,
  StressTestMatrix,
} from "../domain/inverseSolver";
import type { MarketPriors } from "../rag/marketIntel";

export type NodeName =
  | "intent_analyzer"
  | "regulatory_rag"
  | "guild_persona"
  | "mathematical_synthesizer"
  | "inverse_solver"
  | "stress_guardian"
  | "alm_stress_tester"
  | "critic_auditor"
  | "executive_report_generator";

export interface TraceEvent {
  id: number;
  node: NodeName | "graph";
  stage: string;
  level: "info" | "ok" | "warn" | "error";
  titleFa: string;
  titleEn: string;
  detailFa?: string;
  detailEn?: string;
  metrics?: Record<string, number | string>;
  ts: number;
}

export interface AccountingEntry {
  eventFa: string;
  eventEn: string;
  debitFa: string;
  creditFa: string;
  amountRial: number;
  contract: string;
}

export interface ComplianceDraftItem {
  code: string;
  titleFa: string;
  requirementFa: string;
  statusFa: string;
  severity: "mandatory" | "advisory";
}

export type ValidationStatus = "pending" | "constraints_passed" | "not_validated";

/** Simorgh lab report — 7-scenario stress, synthetic population, metrics, advisor. */
export interface SimorghReport {
  metrics: {
    aprPct: number;
    nplRatio: number;
    var95NetIncomeRial: number;
    irbCapitalRate: number;
    realReturnAnnual: number;
    inclusionScore: number;
    decileGap: number;
  };
  population: {
    size: number;
    seed: number;
    approvalRate: number;
    weightedPd: number;
    weightedRate: number;
    tiers: { labelFa: string; share: number; approval: number; pd: number; pricingIndex: number }[];
    medianIncomeMillionToman: number;
  };
  stress: {
    feasibleInAll: boolean;
    worstScenario: string;
    pathsPerScenario: number;
    runs: {
      id: string;
      labelFa: string;
      irrBankAnnual: number;
      p95Ldr: number;
      p5Lcr: number;
      overturningShock: number;
      feasible: boolean;
    }[];
  };
  advisor: {
    health: "healthy" | "watch" | "critical";
    insights: {
      id: string;
      level: "critical" | "warning" | "info" | "good";
      titleFa: string;
      detailFa: string;
      actionFa: string;
      source: string;
    }[];
  };
  template: { id: string; nameFa: string; emoji: string } | null;
}

/** Market-research intelligence snapshot produced by the RAG node. */
export interface MarketIntel {
  /** Closest real market products with match scores and reasons. */
  analogs: {
    code: string;
    bank: string;
    productFa: string;
    productEn: string;
    contract: string;
    archetype: string;
    segmentFa: string;
    ceilingToman: number;
    feeRate: number | null;
    profitRate: number | null;
    tenorMonths: number | null;
    sleepMonths: number | null;
    loanToDepositRatio: number | null;
    blockedRatio: number | null;
    closedLoopRetention: number | null;
    sourceType: string;
    sourceRef: string;
    score: number;
    reasonsFa: string[];
    params: {
      sleepMonths: number;
      tenorMonths: number;
      waitingMonths: number;
      loanMultiplier: number;
      blockedRatio: number;
      closedLoopRetention: number;
      withdrawalFraction: number;
      depositRate: number;
      loanRate: number;
    };
  }[];
  /** Archetype-level medians fed to the optimizer sampler. */
  priors: MarketPriors["byArchetype"];
  coverage: number;
  analogCount: number;
}

export interface AgentState {
  prompt: string;
  request: ProductGenerationRequest | null;
  warnings: string[];
  constraints: RegulatoryConstraint[];
  /** Executable constraint envelope extracted from the retrieved ACTIVE chunks. */
  regulatoryConstraints: RegulatoryConstraints | null;
  /** Phase 4 — deterministic inverse product solve output. */
  inverseSolution: InverseSolverResult | null;
  /** Input the inverse node solved with (consumed by the stress guardian). */
  inverseSolverInput: InverseSolverInput | null;
  /** Phase 4 — Base + shock stress matrix from the ALM guardian. */
  stressMatrix: StressTestMatrix | null;
  /** Phase 4 — latest structured self-correction critique (CRITIQUE: …). */
  critique: string | null;
  marketIntel: MarketIntel | null;
  persona: PersonaSpec | null;
  ecosystem: GuildEcosystem | null;
  product: ProductSpec | null;
  alm: AlmResult | null;
  simorgh: SimorghReport | null;
  findings: CriticFinding[];
  iterations: OptimizerIteration[];
  iteration: number;
  sensitivity: SensitivityFrame | null;
  benchmarks: BenchmarkScheme[];
  accountingEntries: AccountingEntry[];
  complianceDraft: ComplianceDraftItem[];
  reportFa: string;
  reportEn: string;
  trace: TraceEvent[];
  /** Model-constraint result; this is not regulatory or production approval. */
  validationStatus: ValidationStatus;
  status: "running" | "complete" | "failed";
  error?: string;
  elapsedMs: number;
  startedAt: number;
}

export interface SensitivityFrame {
  dims: string[];
  deltas: number[][];
  irr: number[][];
  ldr: number[][];
  lcr: number[][];
  overturning: number[][];
  adoption: number[][];
}

export function createInitialState(prompt: string): AgentState {
  return {
    prompt,
    request: null,
    warnings: [],
    constraints: [],
    regulatoryConstraints: null,
    inverseSolution: null,
    inverseSolverInput: null,
    stressMatrix: null,
    critique: null,
    marketIntel: null,
    persona: null,
    ecosystem: null,
    product: null,
    alm: null,
    simorgh: null,
    findings: [],
    iterations: [],
    iteration: 0,
    sensitivity: null,
    benchmarks: [],
    accountingEntries: [],
    complianceDraft: [],
    reportFa: "",
    reportEn: "",
    trace: [],
    validationStatus: "pending",
    status: "running",
    startedAt: Date.now(),
    elapsedMs: 0,
  };
}

export type Emit = (event: Omit<TraceEvent, "id" | "ts">) => void;

export function makeEmitter(state: AgentState, push?: (e: TraceEvent) => void): Emit {
  let counter = 0;
  return (event) => {
    counter += 1;
    const full: TraceEvent = { ...event, id: counter, ts: Date.now() - state.startedAt };
    state.trace.push(full);
    push?.(full);
  };
}

export type NodeFn = (state: AgentState, emit: Emit) => Promise<void> | void;
export type Router = (state: AgentState) => NodeName | "END";

/** Minimal StateGraph with conditional routing, loops and checkpoint hooks. */
export class StateGraph {
  private nodes = new Map<NodeName, NodeFn>();
  private routers = new Map<NodeName, Router>();
  entry: NodeName = "intent_analyzer";

  addNode(name: NodeName, fn: NodeFn): this {
    this.nodes.set(name, fn);
    return this;
  }

  addConditionalEdge(name: NodeName, router: Router): this {
    this.routers.set(name, router);
    return this;
  }

  async invoke(
    state: AgentState,
    emit: Emit,
    maxSteps = 24,
    signal?: AbortSignal,
  ): Promise<AgentState> {
    if (!Number.isSafeInteger(maxSteps) || maxSteps < 1) {
      throw new RangeError(`StateGraph maxSteps must be a positive integer; received ${maxSteps}`);
    }
    let current: NodeName | "END" = this.entry;
    let steps = 0;
    while (current !== "END") {
      if (signal?.aborted) {
        const error = new Error("Pipeline cancelled by the caller");
        error.name = "AbortError";
        throw error;
      }
      if (steps >= maxSteps) throw new Error(`StateGraph exhausted its ${maxSteps}-step execution budget`);
      steps += 1;
      const node = this.nodes.get(current);
      if (!node) throw new Error(`Missing node implementation: ${current}`);
      emit({
        node: current,
        stage: "node:enter",
        level: "info",
        titleFa: `ورود به گره «${NODE_LABEL_FA[current]}»`,
        titleEn: `Entering node "${current}"`,
      });
      await node(state, emit);
      if (signal?.aborted) {
        const error = new Error("Pipeline cancelled by the caller");
        error.name = "AbortError";
        throw error;
      }
      // yield so buffered trace events flush to the SSE client between nodes
      await new Promise((resolve) => setTimeout(resolve, 0));
      const router = this.routers.get(current);
      current = router ? router(state) : "END";
    }
    return state;
  }
}

export const NODE_LABEL_FA: Record<NodeName, string> = {
  intent_analyzer: "تحلیل‌گر قصد کاربر",
  regulatory_rag: "RAG مقررات بانک مرکزی",
  guild_persona: "پرسونا و زنجیره ارزش صنفی",
  mathematical_synthesizer: "سنتزکننده ریاضی MILP/MINLP",
  inverse_solver: "حل‌کننده معکوس محصول (قید به قید)",
  stress_guardian: "نگهبان ALM — پایه و سه شوک استرس",
  alm_stress_tester: "دوقلوی دیجیتال ALM (مونت‌کارلو)",
  critic_auditor: "ممیز و منتقد خوداصلاح",
  executive_report_generator: "تولید گزارش مدیریتی",
};

export type { ModeSpec, ProductSpec };
