/**
 * app/agents/graph.py -> TypeScript twin
 * ---------------------------------------------------------------------------
 * LangGraph-style StateGraph with seven specialised nodes, conditional routing
 * and the critic self-correction loop (max 5 iterations). Events are streamed
 * to the client through Server-Sent Events by the API layer.
 */

import { MC_RUNS, REGULATORY } from "../domain/constants";
import { parseIntent } from "../domain/intentParser";
import {
  applyDirectives,
  assembleProduct,
  enforceStagger,
  feasibilityCheck,
  optimizeProduct,
  recomputeDerived,
  sensitivitySweep,
} from "../domain/optimizer";
import { runAlmSimulation } from "../domain/almSimulator";
import { createRng, seedFromString } from "../domain/financial";
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
}

export interface PipelineResult {
  state: AgentState;
  events: TraceEvent[];
}

/** Node 1 — parse natural-language intent into a typed objective function. */
function intentAnalyzerNode(state: AgentState, emit: Emit) {
  const { request, warnings } = parseIntent(state.prompt);
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
      runs: 220,
      screenRuns: 60,
      seed: state.prompt,
      horizonMonths: req.horizonMonths,
      persona: state.persona,
      forcedArchetypes: state.ecosystem?.recommendedModes.slice(0, req.modeCount),
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
    state.iterations = solve.iterations;
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
  const rng = createRng(seedFromString(state.prompt + state.iteration));
  const findings = state.findings;
  const { modes, appliedFa } = applyDirectives(state.product.modes, findings, rng);
  const nextProduct: ProductSpec = assembleProduct(
    recomputeDerived(enforceStagger(modes), state.persona, state.ecosystem?.gammaTarget ?? 0),
    state.product.targetDepositsRial,
    state.product.code,
    state.product.titleFa,
    state.product.titleEn,
  );
  state.product = nextProduct;
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
function almStressTesterNode(state: AgentState, emit: Emit, options: PipelineOptions) {
  const req = state.request;
  const product = state.product;
  if (!req || !product) return;
  const limit = options.maxIterations ?? REGULATORY.maxCriticIterations;
  const runs = state.iteration >= limit ? MC_RUNS : state.iteration === 1 ? 220 : 400;

  const alm = runAlmSimulation({
    product,
    runs,
    seed: seedFromString(state.prompt) + state.iteration * 7919,
    horizonMonths: req.horizonMonths,
  });
  state.alm = alm;
  const m = alm.metrics;
  emit({
    node: "alm_stress_tester",
    stage: "alm:done",
    level: runs >= MC_RUNS ? "ok" : "info",
    titleFa: `شبیه‌سازی مونت‌کارلو ${runs} مسیره × ${alm.horizonMonths} ماه — IRR ${(m.irrBankAnnual * 100).toFixed(2)}٪ | p95 LDR ${(m.p95Ldr * 100).toFixed(2)}٪ | p5 LCR ${m.p5Lcr.toFixed(2)} | واژگونی ${(m.overturningShock * 100).toFixed(2)}٪`,
    titleEn: `${runs}-path × ${alm.horizonMonths}-month Monte Carlo — IRR ${(m.irrBankAnnual * 100).toFixed(2)}% | p95 LDR ${(m.p95Ldr * 100).toFixed(2)}% | p5 LCR ${m.p5Lcr.toFixed(2)} | overturning ${(m.overturningShock * 100).toFixed(2)}%`,
    metrics: {
      irrBankAnnual: m.irrBankAnnual,
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

  const severe = runAlmSimulation({
    product,
    runs: 160,
    seed: seedFromString(state.prompt) + 555,
    horizonMonths: req.horizonMonths,
    scenario: "severe-run",
  });
  emit({
    node: "alm_stress_tester",
    stage: "alm:severe",
    level: severe.metrics.p95Ldr <= REGULATORY.ldrCeiling ? "ok" : "warn",
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
function criticAuditorNode(state: AgentState, emit: Emit) {
  const req = state.request;
  const product = state.product;
  const alm = state.alm;
  if (!req || !product || !alm) return;
  const findings = feasibilityCheck(product, alm.metrics, req);
  state.findings = findings;
  const blockers = findings.filter((f) => f.severity === "blocker");
  state.iterations = [
    ...state.iterations,
    {
      iteration: state.iteration,
      score: 0,
      irrAnnual: alm.metrics.irrBankAnnual,
      p95Ldr: alm.metrics.p95Ldr,
      p5Lcr: alm.metrics.p5Lcr,
      overturningShock: alm.metrics.overturningShock,
      netDrainRatio: alm.metrics.netLiquidityDrainRatio,
      feasible: blockers.length === 0,
      findings,
      directivesAppliedFa: findings.map((f) => f.directive.rationaleFa),
    },
  ];

  if (!blockers.length) {
    emit({
      node: "critic_auditor",
      stage: "critic:pass",
      level: "ok",
      titleFa: "ممیزی پذیرفته شد: تمامی قیود انحلال‌پذیری، پوشش نقدینگی، بازده هدف و تحمل ریسک واژگونی ارضا شدند.",
      titleEn: "Audit passed: solvency, liquidity coverage, target return and overturning tolerance all satisfied.",
      metrics: { blockers: 0, warnings: findings.length },
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
  emit({
    node: "critic_auditor",
    stage: "critic:loop",
    level: "info",
    titleFa: `بازگشت شرطی به گره سنتزکننده ریاضی (گام خوداصلاحی ${state.iteration + 1} از ${REGULATORY.maxCriticIterations})`,
    titleEn: `Conditional routing back to the mathematical synthesiser (self-correction ${state.iteration + 1}/${REGULATORY.maxCriticIterations})`,
  });
}

/** Node 7 — executive report, accounting entries, compliance draft, sensitivity. */
function executiveReportNode(state: AgentState, emit: Emit, options: PipelineOptions) {
  if (!state.request || !state.product || !state.alm) return;

  // Final confirmation with the full Monte Carlo population (1,000 paths).
  if (state.alm.monteCarloRuns < MC_RUNS) {
    emit({
      node: "executive_report_generator",
      stage: "report:confirm",
      level: "info",
      titleFa: `اجرای تأییدی نهایی با ${MC_RUNS} مسیر مونت‌کارلو پیش از صدور گزارش`,
      titleEn: `Running final confirmation with ${MC_RUNS} Monte Carlo paths before issuing the report`,
    });
    state.alm = runAlmSimulation({
      product: state.product,
      runs: MC_RUNS,
      seed: seedFromString(state.prompt) + 31337,
      horizonMonths: state.request.horizonMonths,
    });
    state.findings = feasibilityCheck(state.product, state.alm.metrics, state.request);
  }

  state.accountingEntries = buildAccountingEntries(state);
  state.complianceDraft = buildComplianceDraft(state);
  state.benchmarks = compareWithBenchmarks(state);
  state.reportFa = buildExecutiveReportFa(state);
  state.reportEn = buildExecutiveReportEn(state);

  if (options.withSensitivity !== false) {
    const sweep = sensitivitySweep(state.product, state.request, seedFromString(state.prompt));
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
    level: "ok",
    titleFa: `گزارش مدیریتی فارسی، ${state.accountingEntries.length} سند حسابداری و ${state.complianceDraft.length} بند پیش‌نویس انطباق تولید شد`,
    titleEn: `Persian executive report, ${state.accountingEntries.length} accounting entries and ${state.complianceDraft.length} compliance clauses generated`,
  });
  state.status = "complete";
}

export function buildPipelineGraph(options: PipelineOptions): StateGraph {
  const graph = new StateGraph();
  graph
    .addNode("intent_analyzer", intentAnalyzerNode)
    .addNode("regulatory_rag", regulatoryRagNode)
    .addNode("guild_persona", guildPersonaNode)
    .addNode("mathematical_synthesizer", (s, e) => mathematicalSynthesizerNode(s, e, options))
    .addNode("alm_stress_tester", (s, e) => almStressTesterNode(s, e, options))
    .addNode("critic_auditor", criticAuditorNode)
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
    await graph.invoke(state, emit);
  } catch (error) {
    state.status = "failed";
    state.error = error instanceof Error ? error.message : String(error);
    emit({
      node: "graph",
      stage: "graph:error",
      level: "error",
      titleFa: `خطا در اجرای خط لوله: ${state.error}`,
      titleEn: `Pipeline failure: ${state.error}`,
    });
  }
  state.elapsedMs = Date.now() - state.startedAt;
  return { state, events: state.trace };
}

export { NODE_LABEL_FA } from "./state";
