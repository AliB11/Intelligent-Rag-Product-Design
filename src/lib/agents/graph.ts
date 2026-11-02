/**
 * app/agents/graph.py -> TypeScript twin
 * ---------------------------------------------------------------------------
 * LangGraph-style StateGraph with seven specialised nodes, conditional routing
 * and the critic self-correction loop (max 5 iterations). Events are streamed
 * to the client through Server-Sent Events by the API layer.
 */

import {
  MAX_MONTE_CARLO_RUNS,
  MAX_OPTIMIZER_CANDIDATES,
  MAX_PROMPT_LENGTH,
  MC_RUNS,
  MC_SCREEN_RUNS,
  MIN_OPTIMIZER_CANDIDATES,
  REGULATORY,
} from "../domain/constants";
import { parseIntent, type IntentOverrides } from "../domain/intentParser";
import {
  applyDirectives,
  assembleProduct,
  effectiveRiskLimits,
  enforceStagger,
  feasibilityCheck,
  optimizeProduct,
  objectiveScore,
  recomputeDerived,
  sensitivitySweep,
} from "../domain/optimizer";
import { runAlmSimulationAsync } from "../domain/almSimulator";
import { seedFromString } from "../domain/financial";
import {
  buildGuildEcosystem,
  personaByKey,
  PERSONAS,
} from "../domain/guildValueChain";
import { retrieveKnowledge } from "../rag/knowledgeBase";
import { searchBenchmarks } from "../rag/benchmarks";
import type { ProductSpec } from "../domain/types";
import {
  createInitialState,
  makeEmitter,
  StateGraph,
  type AgentState,
  type Emit,
  type SensitivityFrame,
  type TraceEvent,
} from "./state";
import {
  buildAccountingEntries,
  buildComplianceDraft,
  buildExecutiveReportEn,
  buildExecutiveReportFa,
  compareWithBenchmarks,
} from "./reportGenerator";

export interface PipelineOptions {
  runs?: number;
  candidates?: number;
  maxIterations?: number;
  withSensitivity?: boolean;
  seed?: string;
  intentOverrides?: IntentOverrides;
  signal?: AbortSignal;
}

export interface PipelineResult {
  state: AgentState;
  events: TraceEvent[];
}

/** Node 1 — parse natural-language intent into a typed objective function. */
function intentAnalyzerNode(state: AgentState, emit: Emit, options: PipelineOptions) {
  const { request, warnings } = parseIntent(state.prompt, options.intentOverrides);
  state.request = request;
  state.warnings = warnings;
  emit({
    node: "intent_analyzer",
    stage: "intent:parsed",
    level: "ok",
    titleFa: `قصد کاربر تجزیه شد: جذب ${request.targetDepositsHemmat.toFixed(2)} همت، هدف IRR ${(request.targetIrr * 100).toFixed(1)}٪، ${request.modeCount} طرح، افق ${request.horizonMonths} ماه`,
    titleEn: `Intent parsed: attract ${request.targetDepositsHemmat.toFixed(2)} Hemmat, target IRR ${(request.targetIrr * 100).toFixed(1)}%, ${request.modeCount} modes, ${request.horizonMonths}-month horizon`,
    detailFa: `پرسونای هدف: ${request.guild ?? request.personaKey ?? "عمومی"} | عقود ترجیحی: ${request.preferredContracts.join("، ") || "بدون ترجیح"} | تأکیدها: ${request.emphases.join("، ") || "—"}`,
    detailEn: `Persona: ${request.personaKey ?? "generic"} | Contracts: ${request.preferredContracts.join(", ") || "any"} | Emphases: ${request.emphases.join(", ") || "-"}`,
    metrics: {
      targetDepositsRial: request.targetDepositsRial,
      targetIrr: request.targetIrr,
      ldrCeiling: request.ldrCeiling,
      lcrFloor: request.lcrFloor,
      overturningTolerance: request.maxOverturningShock,
      lambda1: request.lambdas.lambda1Irr,
      lambda2: request.lambdas.lambda2Adoption,
      lambda3: request.lambdas.lambda3LdrPenalty,
      lambda4: request.lambdas.lambda4Overturning,
    },
  });
  warnings.forEach((w) =>
    emit({
      node: "intent_analyzer",
      stage: "intent:warning",
      level: "warn",
      titleFa: w,
      titleEn: w,
    }),
  );
}

/** Node 2 — RAG retrieval of CBI directives and Islamic contract rules. */
function regulatoryRagNode(state: AgentState, emit: Emit) {
  const req = state.request;
  if (!req) return;
  const query = [
    req.prompt,
    ...req.preferredContracts,
    req.guild ?? "",
    ...req.emphases,
    "سپرده قانونی",
    "واژگونی منابع",
    "میانگین حساب",
    "حلقه بسته",
    "قرض‌الحسنه مرابحه جعاله خرید دین گام",
    "حمایت از حقوق مشتری",
    "سامات چک برگشتی اظهارنامه مالیاتی",
  ].join(" ");

  const boosts = ["cbi-directive", "islamic-contract", "risk-rule"];
  if (req.personaKey) boosts.push("product-rule", "compliance");
  const constraints = retrieveKnowledge(query, 8, boosts);
  state.constraints = constraints;

  emit({
    node: "regulatory_rag",
    stage: "rag:retrieved",
    level: "ok",
    titleFa: `${constraints.length} سند مقرراتی از پایگاه دانش بانک مرکزی بازیابی شد`,
    titleEn: `Retrieved ${constraints.length} regulatory documents from the Iranian banking vector store`,
    detailFa: constraints.map((c) => `• ${c.titleFa} — ${c.authority} (امتیاز ${(c.relevance * 100).toFixed(0)}٪)`).join("\n"),
    detailEn: constraints.map((c) => `• ${c.titleEn} (${(c.relevance * 100).toFixed(0)}%)`).join("\n"),
    metrics: { documents: constraints.length },
  });

  constraints.forEach((c) => {
    c.binding.forEach((b) =>
      emit({
        node: "regulatory_rag",
        stage: "rag:binding",
        level: "info",
        titleFa: `قید الزام‌آور تزریق شد: ${c.code} → ${b.field} ${b.op} ${Array.isArray(b.value) ? b.value.join("|") : b.value}`,
        titleEn: `Binding constraint injected: ${c.code} -> ${b.field} ${b.op} ${Array.isArray(b.value) ? b.value.join("|") : b.value}`,
      }),
    );
  });

  const bench = searchBenchmarks(
    `${req.guild ?? ""} ${req.preferredContracts.join(" ")} میانگین حساب پذیرنده`,
    6,
  );
  state.benchmarks = bench;
  emit({
    node: "regulatory_rag",
    stage: "rag:benchmarks",
    level: "info",
    titleFa: `${bench.length} بنچمارک بازار ایران برای مقایسه بارگذاری شد: ${bench.map((b) => b.productFa).join("، ")}`,
    titleEn: `Loaded ${bench.length} Iranian market benchmarks: ${bench.map((b) => b.productEn).join(", ")}`,
  });
}

/** Node 3 — guild / persona tripartite closed-loop ecosystem. */
function guildPersonaNode(state: AgentState, emit: Emit) {
  const req = state.request;
  if (!req) return;
  const persona = personaByKey(req.personaKey) ?? PERSONAS[0];
  const ecosystem = buildGuildEcosystem(persona);
  state.persona = persona;
  state.ecosystem = ecosystem;

  emit({
    node: "guild_persona",
    stage: "guild:mapped",
    level: "ok",
    titleFa: `زیست‌بوم سه‌جانبه «${ecosystem.titleFa}» ساخته شد — γ هدف ${ecosystem.gammaTarget.toFixed(2)}`,
    titleEn: `Tripartite ecosystem "${ecosystem.titleEn}" mapped — target gamma ${ecosystem.gammaTarget.toFixed(2)}`,
    detailFa: ecosystem.valueChainFa.map((v) => `• ${v}`).join("\n"),
    detailEn: `Anchor: ${persona.titleEn}. Suppliers: ${persona.b2bSuppliersFa.join(", ")}. Clients: ${persona.b2cClientsFa.join(", ")}. Rails: ${persona.settlementRailsFa.join(", ")}.`,
    metrics: {
      personaIncomeToman: persona.monthlyNetIncomeToman,
      closedLoopPotential: persona.closedLoopPotential,
      sourceKappa: persona.sourceKappa,
      pd: persona.pd,
      lgd: persona.lgd,
      loopClosure: ecosystem.loopClosure,
    },
  });
}

/** Node 4 — MILP/MINLP mathematical synthesis. */
async function mathematicalSynthesizerNode(
  state: AgentState,
  emit: Emit,
  options: PipelineOptions,
) {
  const req = state.request;
  if (!req) return;
  state.iteration += 1;

  if (state.iteration === 1 || !state.product) {
    const solve = await optimizeProduct(req, {
      candidates: options.candidates ?? 26,
      maxIterations: 1,
      runs: Math.min(options.runs ?? MC_RUNS, MC_SCREEN_RUNS),
      screenRuns: 60,
      seed: options.seed ?? state.prompt,
      horizonMonths: req.horizonMonths,
      persona: state.persona,
      signal: options.signal,
      forcedArchetypes:
        req.modeCount > 1 ? state.ecosystem?.recommendedModes.slice(0, req.modeCount) : undefined,
      gammaFloor: state.ecosystem ? state.ecosystem.gammaTarget : 0,
      onProgress: (p) =>
        emit({
          node: "mathematical_synthesizer",
          stage: p.stage,
          level: "info",
          titleFa: p.messageFa,
          titleEn: p.messageEn,
        }),
    });
    state.product = solve.product;
    state.alm = solve.alm;
    state.iterations = [];
    emit({
      node: "mathematical_synthesizer",
      stage: "synth:done",
      level: "ok",
      titleFa: `ساختار ${solve.product.modes.length}-طرحی «${solve.product.titleFa}» سنتز شد (کد ${solve.product.code})`,
      titleEn: `Synthesized ${solve.product.modes.length}-mode structure "${solve.product.titleEn}" (${solve.product.code})`,
      detailFa: solve.product.modes
        .map(
          (m, i) =>
            `${i + 1}) ${m.nameFa}: سهم ${(m.weight * 100).toFixed(1)}٪ | τ_d=${m.sleepMonths} | α=${m.loanMultiplier.toFixed(2)} | τ_l=${m.tenorMonths} | r_l=${(m.loanRate * 100).toFixed(2)}٪ | β=${(m.blockedRatio * 100).toFixed(0)}٪ | γ=${(m.closedLoopRetention * 100).toFixed(0)}٪ | ω=${m.waitingMonths}`,
        )
        .join("\n"),
      metrics: {
        candidatesScreened: solve.candidatesScreened,
        score: solve.score,
        elapsedMs: solve.elapsedMs,
      },
    });
    return;
  }

  // self-correction pass driven by the critic's mathematical directive
  const findings = state.findings;
  const { modes, appliedFa } = applyDirectives(state.product.modes, findings);
  const nextProduct: ProductSpec = assembleProduct(
    recomputeDerived(enforceStagger(modes), state.persona, state.ecosystem?.gammaTarget ?? 0),
    state.product.targetDepositsRial,
    state.product.code,
    state.product.titleFa,
    state.product.titleEn,
  );
  state.product = nextProduct;
  const previousIteration = state.iterations.findIndex((item) => item.iteration === state.iteration - 1);
  if (previousIteration >= 0) {
    state.iterations[previousIteration] = {
      ...state.iterations[previousIteration],
      directivesAppliedFa: appliedFa,
    };
  }
  emit({
    node: "mathematical_synthesizer",
    stage: "synth:directed",
    level: "info",
    titleFa: `اعمال دستورات ریاضی ممیز (گام ${state.iteration}): ${appliedFa.join(" | ")}`,
    titleEn: `Applied critic directives (step ${state.iteration}): ${appliedFa.length} adjustment vectors`,
    detailFa: nextProduct.modes
      .map(
        (m, i) =>
          `${i + 1}) ${m.nameFa}: τ_d=${m.sleepMonths} | α=${m.loanMultiplier.toFixed(2)} | β=${(m.blockedRatio * 100).toFixed(0)}٪ | γ=${(m.closedLoopRetention * 100).toFixed(0)}٪ | ω=${m.waitingMonths} | r_l=${(m.loanRate * 100).toFixed(2)}٪`,
      )
      .join("\n"),
  });
}

/** Node 5 — Monte Carlo ALM digital twin stress test. */
async function almStressTesterNode(state: AgentState, emit: Emit, options: PipelineOptions): Promise<void> {
  const req = state.request;
  const product = state.product;
  if (!req || !product) return;
  const runs = options.runs ?? MC_RUNS;
  const riskLimits = effectiveRiskLimits(req);

  const alm = await runAlmSimulationAsync({
    product,
    runs,
    seed: seedFromString(options.seed ?? state.prompt) + state.iteration * 7919,
    horizonMonths: req.horizonMonths,
    limits: riskLimits,
    signal: options.signal,
  });
  state.alm = alm;
  const m = alm.metrics;
  emit({
    node: "alm_stress_tester",
    stage: "alm:done",
    level: "ok",
    titleFa: `شبیه‌سازی مونت‌کارلو ${runs} مسیره × ${alm.horizonMonths} ماه — IRR ${(m.irrBankAnnual * 100).toFixed(2)}٪ | p95 LDR ${(m.p95Ldr * 100).toFixed(2)}٪ | p5 LCR ${m.p5Lcr.toFixed(2)} | واژگونی ${(m.overturningShock * 100).toFixed(2)}٪`,
    titleEn: `${runs}-path × ${alm.horizonMonths}-month Monte Carlo — IRR ${(m.irrBankAnnual * 100).toFixed(2)}% | p95 LDR ${(m.p95Ldr * 100).toFixed(2)}% | p5 LCR ${m.p5Lcr.toFixed(2)} | overturning ${(m.overturningShock * 100).toFixed(2)}%`,
    metrics: {
      irrBankAnnual: m.irrBankAnnual,
      irrValidPathShare: m.irrValidPathShare,
      roi: m.roi,
      roe: m.roe,
      nim: m.nim,
      nimJoint: m.nimJoint,
      nimNonJoint: m.nimNonJoint,
      p95Ldr: m.p95Ldr,
      p5Lcr: m.p5Lcr,
      overturningShock: m.overturningShock,
      netLiquidityDrainRatio: m.netLiquidityDrainRatio,
      peakLoansRial: m.peakLoansRial,
      peakDepositsRial: m.peakDepositsRial,
      economicCapitalRial: m.economicCapitalRial,
      adoptionScore: m.adoptionScore,
    },
  });

  const severe = await runAlmSimulationAsync({
    product,
    runs: 160,
    seed: seedFromString(options.seed ?? state.prompt) + 555,
    horizonMonths: req.horizonMonths,
    scenario: "severe-run",
    limits: riskLimits,
    signal: options.signal,
  });
  emit({
    node: "alm_stress_tester",
    stage: "alm:severe",
    level:
      severe.metrics.p95Ldr <= riskLimits.ldrCeiling && severe.metrics.p5Lcr >= riskLimits.lcrFloor
        ? "ok"
        : "warn",
    titleFa: `سناریوی هجوم شدید: p95 LDR ${(severe.metrics.p95Ldr * 100).toFixed(2)}٪ | p5 LCR ${severe.metrics.p5Lcr.toFixed(2)} | شوک واژگونی ${(severe.metrics.overturningShock * 100).toFixed(2)}٪`,
    titleEn: `Severe run scenario: p95 LDR ${(severe.metrics.p95Ldr * 100).toFixed(2)}% | p5 LCR ${severe.metrics.p5Lcr.toFixed(2)} | overturning ${(severe.metrics.overturningShock * 100).toFixed(2)}%`,
    metrics: {
      severeP95Ldr: severe.metrics.p95Ldr,
      severeP5Lcr: severe.metrics.p5Lcr,
      severeOverturning: severe.metrics.overturningShock,
    },
  });
}

/** Node 6 — critic auditor with mathematical adjustment directives. */
function criticAuditorNode(state: AgentState, emit: Emit, options: PipelineOptions) {
  const req = state.request;
  const product = state.product;
  const alm = state.alm;
  if (!req || !product || !alm) return;
  const findings = feasibilityCheck(product, alm.metrics, req);
  state.findings = findings;
  const blockers = findings.filter((f) => f.severity === "blocker");
  const iterationRecord = {
    iteration: state.iteration,
    score: objectiveScore(alm.metrics, req).score,
    irrAnnual: alm.metrics.irrBankAnnual,
    p95Ldr: alm.metrics.p95Ldr,
    p5Lcr: alm.metrics.p5Lcr,
    overturningShock: alm.metrics.overturningShock,
    netDrainRatio: alm.metrics.netLiquidityDrainRatio,
    feasible: blockers.length === 0,
    findings,
    directivesAppliedFa: [] as string[],
  };
  const existingIndex = state.iterations.findIndex((item) => item.iteration === state.iteration);
  if (existingIndex >= 0) state.iterations[existingIndex] = iterationRecord;
  else state.iterations.push(iterationRecord);

  if (!blockers.length) {
    emit({
      node: "critic_auditor",
      stage: "critic:pass",
      level: "ok",
      titleFa: findings.some((f) => f.severity === "warning")
        ? "قیود سخت ریسک و بازده هدف IRR برقرار است؛ هشدارهای اهداف نرم عملکردی در گزارش مشخص شده‌اند."
        : "ممیزی پذیرفته شد: قیود سخت کفایت نقدینگی، توان بازپرداخت و بازده هدف ارضا شدند.",
      titleEn: findings.some((f) => f.severity === "warning")
        ? "Hard risk and IRR constraints pass; soft performance-target warnings are retained in the report."
        : "Audit passed: hard liquidity, affordability and target-return constraints are satisfied.",
      metrics: { blockers: 0, warnings: findings.filter((f) => f.severity === "warning").length },
    });
    return;
  }

  blockers.forEach((f) =>
    emit({
      node: "critic_auditor",
      stage: "critic:blocker",
      level: "warn",
      titleFa: f.messageFa,
      titleEn: f.messageEn,
      detailFa: `دستور تعدیل: ${f.directive.action} روی «${String(f.directive.field)}» با بزرگی ${f.directive.magnitude.toFixed(3)} — ${f.directive.rationaleFa}`,
      detailEn: `Adjustment directive: ${f.directive.action} on ${String(f.directive.field)} by ${f.directive.magnitude.toFixed(3)}`,
      metrics: { observed: f.observed, limit: f.limit },
    }),
  );
  const limit = options.maxIterations ?? REGULATORY.maxCriticIterations;
  emit({
    node: "critic_auditor",
    stage: state.iteration < limit ? "critic:loop" : "critic:limit",
    level: state.iteration < limit ? "info" : "warn",
    titleFa: state.iteration < limit
      ? `بازگشت به گره سنتز ریاضی برای خوداصلاحی ${state.iteration + 1} از ${limit}`
      : `پس از ${limit} تلاش، ${blockers.length} قید سخت همچنان نقض می‌شود؛ گزارش با وضعیت غیرقابل‌تأیید صادر خواهد شد.`,
    titleEn: state.iteration < limit
      ? `Routing back to mathematical synthesis for correction ${state.iteration + 1} of ${limit}`
      : `${blockers.length} hard constraints remain after ${limit} attempts; the report will retain an unverified status.`,
  });
}

/** Node 7 — executive report, accounting entries, compliance draft, sensitivity. */
function executiveReportNode(state: AgentState, emit: Emit, options: PipelineOptions) {
  if (!state.request || !state.product || !state.alm) return;

  // Never replace a requested final simulation with a lower-fidelity fallback.
  // A count mismatch is a pipeline failure; reports are issued only from the
  // exact requested Monte Carlo evaluation.
  const requestedRuns = options.runs ?? MC_RUNS;
  if (state.alm.monteCarloRuns !== requestedRuns) {
    throw new Error(
      `Refusing to issue a report: final ALM used ${state.alm.monteCarloRuns} runs, but ${requestedRuns} were requested`,
    );
  }

  const remainingBlockers = state.findings.filter((finding) => finding.severity === "blocker").length;
  state.validationStatus = remainingBlockers === 0 ? "constraints_passed" : "not_validated";
  state.accountingEntries = buildAccountingEntries(state);
  state.complianceDraft = buildComplianceDraft(state);
  state.benchmarks = compareWithBenchmarks(state);
  state.reportFa = buildExecutiveReportFa(state);
  state.reportEn = buildExecutiveReportEn(state);

  if (options.withSensitivity !== false) {
    const sweep = sensitivitySweep(state.product, state.request, seedFromString(options.seed ?? state.prompt));
    const frame: SensitivityFrame = {
      dims: sweep.map((s) => s.label),
      deltas: sweep.map((s) => s.deltas),
      irr: sweep.map((s) => s.irr),
      ldr: sweep.map((s) => s.ldr),
      lcr: sweep.map((s) => s.lcr),
      overturning: sweep.map((s) => s.overturning),
      adoption: sweep.map((s) => s.adoption),
    };
    state.sensitivity = frame;
    emit({
      node: "executive_report_generator",
      stage: "report:sensitivity",
      level: "info",
      titleFa: `داشبورد حساسیت‌سنجی روی ${sweep.length} بعد پارامتری (γ, β, α, τ_d, ω, δ) محاسبه شد`,
      titleEn: `Sensitivity dashboard computed across ${sweep.length} parameter dimensions`,
    });
  }

  emit({
    node: "executive_report_generator",
    stage: "report:done",
    level: remainingBlockers ? "warn" : "ok",
    titleFa: remainingBlockers
      ? `گزارش با ${remainingBlockers} قید سختِ نقض‌شده صادر شد؛ این سناریو تأییدپذیر نیست.`
      : `گزارش مدیریتی، ${state.accountingEntries.length} سند حسابداری و ${state.complianceDraft.length} بند پیش‌نویس انطباق تولید شد.`,
    titleEn: remainingBlockers
      ? `Report issued with ${remainingBlockers} unresolved hard-constraint breach(es); this scenario is not validated.`
      : `Management report, ${state.accountingEntries.length} accounting entries and ${state.complianceDraft.length} compliance clauses generated.`,
    metrics: { remainingBlockers, warnings: state.findings.filter((finding) => finding.severity === "warning").length },
  });
  state.status = "complete";
}

export function buildPipelineGraph(options: PipelineOptions): StateGraph {
  const graph = new StateGraph();
  graph
    .addNode("intent_analyzer", (s, e) => intentAnalyzerNode(s, e, options))
    .addNode("regulatory_rag", regulatoryRagNode)
    .addNode("guild_persona", guildPersonaNode)
    .addNode("mathematical_synthesizer", (s, e) => mathematicalSynthesizerNode(s, e, options))
    .addNode("alm_stress_tester", (s, e) => almStressTesterNode(s, e, options))
    .addNode("critic_auditor", (s, e) => criticAuditorNode(s, e, options))
    .addNode("executive_report_generator", (s, e) => executiveReportNode(s, e, options));

  graph.addConditionalEdge("intent_analyzer", () => "regulatory_rag");
  graph.addConditionalEdge(
    "regulatory_rag",
    (s) => (s.request?.personaKey ? "guild_persona" : "mathematical_synthesizer"),
  );
  graph.addConditionalEdge("guild_persona", () => "mathematical_synthesizer");
  graph.addConditionalEdge("mathematical_synthesizer", () => "alm_stress_tester");
  graph.addConditionalEdge("alm_stress_tester", () => "critic_auditor");
  graph.addConditionalEdge("critic_auditor", (s) => {
    const blockers = s.findings.filter((f) => f.severity === "blocker").length;
    const limit = options.maxIterations ?? REGULATORY.maxCriticIterations;
    return blockers > 0 && s.iteration < limit
      ? "mathematical_synthesizer"
      : "executive_report_generator";
  });
  graph.addConditionalEdge("executive_report_generator", () => "END");
  return graph;
}

export interface RunPipelineInput {
  prompt: string;
  onEvent?: (event: TraceEvent) => void;
  options?: PipelineOptions;
}

function validatePipelineInput(prompt: string, options: PipelineOptions): void {
  if (typeof prompt !== "string" || !prompt.trim()) {
    throw new TypeError("A non-empty strategic prompt is required");
  }
  if (prompt.length > MAX_PROMPT_LENGTH) {
    throw new RangeError(`Prompt exceeds the ${MAX_PROMPT_LENGTH}-character limit`);
  }
  const runs = options.runs ?? MC_RUNS;
  if (!Number.isSafeInteger(runs) || runs < 1 || runs > MAX_MONTE_CARLO_RUNS) {
    throw new RangeError(`Requested Monte Carlo runs must be an integer between 1 and ${MAX_MONTE_CARLO_RUNS}; received ${runs}`);
  }
  const candidates = options.candidates ?? 26;
  if (!Number.isSafeInteger(candidates) || candidates < MIN_OPTIMIZER_CANDIDATES || candidates > MAX_OPTIMIZER_CANDIDATES) {
    throw new RangeError(`Candidate count must be an integer between ${MIN_OPTIMIZER_CANDIDATES} and ${MAX_OPTIMIZER_CANDIDATES}; received ${candidates}`);
  }
  const iterations = options.maxIterations ?? REGULATORY.maxCriticIterations;
  if (!Number.isSafeInteger(iterations) || iterations < 1 || iterations > REGULATORY.maxCriticIterations) {
    throw new RangeError(`Critic iterations must be an integer between 1 and ${REGULATORY.maxCriticIterations}; received ${iterations}`);
  }
  if (options.seed !== undefined && (typeof options.seed !== "string" || options.seed.length > 128)) {
    throw new RangeError("Seed must be a string of at most 128 characters");
  }
  const overrideRanges: Record<keyof IntentOverrides, readonly [number, number]> = {
    targetDepositsHemmat: [0.01, 1_000],
    targetIrr: [0.01, 1],
    ldrCeiling: [0.4, 0.95],
    lcrFloor: [1, 2],
    maxOverturningShock: [0.01, 0.25],
  };
  for (const [key, value] of Object.entries(options.intentOverrides ?? {})) {
    const range = overrideRanges[key as keyof IntentOverrides];
    if (!range || typeof value !== "number" || !Number.isFinite(value) || value < range[0] || value > range[1]) {
      throw new RangeError(`Invalid intent override ${key}: ${String(value)}`);
    }
  }
  if (options.withSensitivity !== undefined && typeof options.withSensitivity !== "boolean") {
    throw new TypeError("withSensitivity must be a boolean");
  }
}

/** Runs the full five-stage inverse goal-seeking pipeline. */
export async function runPipeline({
  prompt,
  onEvent,
  options = {},
}: RunPipelineInput): Promise<PipelineResult> {
  const state = createInitialState(prompt);
  const emit = makeEmitter(state, (event) => onEvent?.(event));
  const graph = buildPipelineGraph(options);
  try {
    validatePipelineInput(prompt, options);
    await graph.invoke(state, emit, 24, options.signal);
  } catch (error) {
    state.status = "failed";
    state.error = options.signal?.aborted || (error instanceof Error && error.name === "AbortError")
      ? "Run cancelled"
      : error instanceof Error ? error.message : String(error);
    if (state.error !== "Run cancelled") {
      emit({
        node: "graph",
        stage: "graph:error",
        level: "error",
        titleFa: `خطا در اجرای خط لوله: ${state.error}`,
        titleEn: `Pipeline failure: ${state.error}`,
      });
    }
  }
  state.elapsedMs = Date.now() - state.startedAt;
  return { state, events: state.trace };
}

export { NODE_LABEL_FA } from "./state";
