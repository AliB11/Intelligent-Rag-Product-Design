/**
 * app/agents/graph.py -> TypeScript twin
 * ---------------------------------------------------------------------------
 * LangGraph-style StateGraph with nine specialised nodes, conditional routing
 * and the deterministic self-correction critique loop (Phase 4 cap: 3
 * iterations). Committee: Node 1 designer → inverse solver → Node 3 stress
 * guardian (base + 3 shocks) → ALM twin → Node 2 compliance/sharia auditor
 * (hidden-usury flag) → Node 4 structured CRITIQUE loop → executive report.
 * Events are streamed to the client through Server-Sent Events by the API
 * layer.
 */

import {
  MC_RUNS,
  MC_SCREEN_RUNS,
  REGULATORY,
} from "../domain/constants";
import {
  formatZodIssues,
  pipelineOptionsSchema,
  pipelinePromptSchema,
} from "../validation/schemas";
import { extractRegulatoryConstraints } from "../rag/regulatoryConstraintExtractor";
import { describeRegulatoryConstraints } from "../domain/regulatory";
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
import {
  buildStressMatrix,
  computeBorrowerNominalRate,
  solveInverseFrontier,
  type InverseSolverInput,
} from "../domain/inverseSolver";
import { seedFromString } from "../domain/financial";
import {
  buildGuildEcosystem,
  personaByKey,
  PERSONAS,
} from "../domain/guildValueChain";
import { retrieveKnowledge } from "../rag/knowledgeBase";
import { searchBenchmarks } from "../rag/benchmarks";
import { analyzeMarket } from "../rag/marketIntel";
import { generatePopulation, empiricalShares, scoreTiers } from "../simorgh/population";
import { portfolioUnderwriting } from "../simorgh/creditPolicy";
import { computeSimorghMetrics } from "../simorgh/metrics";
import { runStressSuite } from "../simorgh/stress";
import { buildAdvisorReport } from "../simorgh/advisor";
import { templatesForCategories } from "../simorgh/templates";
import type { ModeSpec, ProductSpec } from "../domain/types";
import {
  createInitialState,
  makeEmitter,
  StateGraph,
  type AgentState,
  type Emit,
  type MarketIntel,
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

  // Product-identification agent: announce the resolved real facility.
  const matched = request.matchedFacility;
  if (matched) {
    emit({
      node: "intent_analyzer",
      stage: "intent:facility-identified",
      level: "ok",
      titleFa: `محصول مرجع شناسایی شد: «${matched.productFa}» — ${matched.bank} (اطمینان ${(matched.confidence * 100).toFixed(0)}٪)`,
      titleEn: `Reference facility identified: "${matched.productEn}" — ${matched.bank} (confidence ${(matched.confidence * 100).toFixed(0)}%)`,
      detailFa:
        `دلایل تطبیق: ${matched.matchedOnFa.join("، ")}` +
        (matched.alternativesFa.length
          ? `\nجایگزین‌های نزدیک: ${matched.alternativesFa.map((a) => `${a.productFa} (${a.bank}، ${(a.confidence * 100).toFixed(0)}٪)`).join(" · ")}`
          : ""),
      detailEn: `Matched on: ${matched.matchedOnFa.join(", ")}`,
      metrics: {
        confidence: matched.confidence,
        alternatives: matched.alternativesFa.length,
      },
    });
  }
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

  // Extract the executable constraint envelope from the pre-filtered ACTIVE
  // chunks; it is passed directly into the financial-engine as hard bounds.
  const envelope = extractRegulatoryConstraints(constraints);
  state.regulatoryConstraints = envelope;
  emit({
    node: "regulatory_rag",
    stage: "rag:constraints",
    level: "ok",
    titleFa: `اجرایی‌سازی مقررات: ${describeRegulatoryConstraints(envelope)}`,
    titleEn: `Executable regulatory envelope: ${describeRegulatoryConstraints(envelope)}`,
    detailFa: envelope.citations
      .map((c) => `• ${c.doc_id} — ${c.clause}: ${c.summary}`)
      .join("\n"),
    detailEn: envelope.citations.map((c) => `${c.doc_id}: ${c.summary}`).join("\n"),
    metrics: { citations: envelope.citations.length },
  });

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

  // Market intelligence: retrieve the closest real products and derive the
  // archetype-level structural medians that centre the optimizer sampler.
  const market = analyzeMarket({
    prompt: req.prompt,
    personaKey: req.personaKey,
    guild: req.guild,
    preferredContracts: req.preferredContracts,
    emphases: req.emphases,
    targetDepositsHemmat: req.targetDepositsHemmat,
    forcedCode: req.matchedFacility?.code ?? null,
  });
  const intel: MarketIntel = {
    analogs: market.analogs.map(({ product, score, reasonsFa }) => ({
      code: product.code,
      bank: product.bank,
      productFa: product.productFa,
      productEn: product.productEn,
      contract: product.contract,
      archetype: product.archetype,
      segmentFa: product.segmentFa,
      ceilingToman: product.ceilingToman,
      feeRate: product.feeRate,
      profitRate: product.profitRate,
      tenorMonths: product.tenorMonths,
      sleepMonths: product.sleepMonths,
      loanToDepositRatio: product.loanToDepositRatio,
      blockedRatio: product.blockedRatio,
      closedLoopRetention: product.closedLoopRetention,
      sourceType: product.sourceType,
      sourceRef: product.sourceRef,
      score: Math.round(score * 100) / 100,
      reasonsFa,
      params: { ...product.params },
    })),
    priors: market.byArchetype,
    coverage: market.coverage,
    analogCount: market.analogCount,
  };
  state.marketIntel = intel;

  const priorKeys = Object.keys(market.byArchetype);
  emit({
    node: "regulatory_rag",
    stage: "market:analogs",
    level: "ok",
    titleFa: `${intel.analogCount} محصول واقعی هم‌خانواده از ثبت‌نام بازار بازیابی شد (پوشش ${(intel.coverage * 100).toFixed(0)}٪) و میانه ساختاری ${priorKeys.length} الگو به‌عنوان اولویت نمونه‌گیری تزریق شد`,
    titleEn: `Retrieved ${intel.analogCount} real market analogs (coverage ${(intel.coverage * 100).toFixed(0)}%); structural medians of ${priorKeys.length} archetype(s) injected as sampler priors`,
    detailFa: intel.analogs
      .slice(0, 6)
      .map((a) => `• ${a.bank} — ${a.productFa} (${a.sourceType}) — امتیاز ${a.score} — ${a.reasonsFa.join("، ")}`)
      .join("\n"),
    detailEn: intel.analogs
      .slice(0, 6)
      .map((a) => `• ${a.bank} — ${a.productEn} (${a.sourceType}) — score ${a.score}`)
      .join("\n"),
    metrics: {
      analogCount: intel.analogCount,
      coveragePct: Math.round(intel.coverage * 100),
      archetypesWithPrior: priorKeys.length,
    },
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
    const priorCount = Object.keys(state.marketIntel?.priors ?? {}).length;
    const solve = await optimizeProduct(req, {
      candidates: options.candidates ?? 26,
      maxIterations: 1,
      runs: Math.min(options.runs ?? MC_RUNS, MC_SCREEN_RUNS),
      screenRuns: 60,
      seed: options.seed ?? state.prompt,
      horizonMonths: req.horizonMonths,
      persona: state.persona,
      signal: options.signal,
      regulatoryConstraints: state.regulatoryConstraints,
      forcedArchetypes:
        req.modeCount > 1 ? state.ecosystem?.recommendedModes.slice(0, req.modeCount) : undefined,
      gammaFloor: state.ecosystem ? state.ecosystem.gammaTarget : 0,
      priors: priorCount
        ? {
            byArchetype: state.marketIntel!.priors,
            analogs: [],
            coverage: state.marketIntel!.coverage,
            analogCount: state.marketIntel!.analogCount,
          }
        : null,
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

/** Deposit-volume-weighted average of a mode attribute. */
function weightedModeValue(modes: ModeSpec[], pick: (m: ModeSpec) => number): number {
  const total = modes.reduce((acc, m) => acc + m.depositVolumeRial, 0);
  if (!(total > 0)) {
    return modes.length ? modes.reduce((acc, m) => acc + pick(m), 0) / modes.length : 0;
  }
  return modes.reduce((acc, m) => acc + m.depositVolumeRial * pick(m), 0) / total;
}

/**
 * Node 4b — adaptive inverse product solver (closed-loop decision core).
 * Round 0 always honours the REQUESTED target; if the bank-IRR constraint is
 * what blocks feasibility, `solveInverseFrontier` shoots the target onto the
 * observed frontier (the achieved IRR) and re-solves to VERIFY feasibility —
 * feedback-driven instead of the old blind 25% decay. Structural pressure
 * still tightens with critique-loop iterations (loan-multiplier ceiling ×0.85
 * per round). Fully deterministic — no RNG.
 */
function inverseSolverNode(state: AgentState, emit: Emit) {
  const req = state.request;
  const env = state.regulatoryConstraints;
  if (!req || !env) return;
  const k = Math.max(1, state.iteration);
  const decay = Math.pow(0.85, k - 1);
  const targetBankIrrMin = Math.min(0.6, Math.max(0.05, req.targetIrr));
  const D = state.product?.targetDepositsRial ?? req.targetDepositsRial;
  const modes = state.product?.modes ?? [];
  const input: InverseSolverInput = {
    targetBankIrrMin,
    // Opportunity floor: a competitive 10% deposit yield (customer-side C2).
    targetCustomerIrrMin: 0.1,
    // Peak financing deficit may not exceed 40% of the deposit base.
    maxLiquidityGapLimit: 0.4 * D,
    regulatoryConstraints: env,
    depositVolumeRial: D,
    cannibalizationRate: 0.3,
    sourceDepositCost: 0.02,
    unblockedRunoffRate: 0.02,
    statutoryReserveBase: modes.length
      ? weightedModeValue(modes, (m) => m.statutoryReserve)
      : 0.1,
    pd: modes.length ? weightedModeValue(modes, (m) => m.pd) : 0.03,
    lgd: modes.length ? weightedModeValue(modes, (m) => m.lgd) : 0.45,
    bounds: {
      loanToDepositMultiplier: [0.5, Math.max(0.5, 3 * decay)],
    },
  };
  const frontier = solveInverseFrontier(input);
  const solution = frontier.result;
  state.inverseSolverInput = input;
  state.inverseFrontier = frontier;
  state.inverseSolution = solution;
  const recalibNote = frontier.recalibrated
    ? ` · مرزی‌سازی: هدف ${(frontier.requestedTargetIrr * 100).toFixed(1)}٪ ← ${(frontier.finalTargetIrr * 100).toFixed(2)}٪ در ${frontier.trace.length} آزمون`
    : "";
  const recalibEn = frontier.recalibrated
    ? `; frontier recalibration: target ${(frontier.requestedTargetIrr * 100).toFixed(1)}% → ${(frontier.finalTargetIrr * 100).toFixed(2)}% over ${frontier.trace.length} rounds`
    : "";
  emit({
    node: "inverse_solver",
    stage: frontier.recalibrated ? "inverse:frontier" : "inverse:solve",
    level: solution.feasible ? "ok" : "warn",
    titleFa: solution.feasible
      ? `حل معکوس: IRR بانک ${(solution.metrics.bankIrrAnnual * 100).toFixed(2)}٪ ≥ هدف ${(frontier.finalTargetIrr * 100).toFixed(1)}٪${recalibNote} · T_wait=${solution.solution.depositRetentionMonths} · M=${solution.solution.loanToDepositMultiplier.toFixed(2)} · مسدودی ${(solution.solution.blockedDepositPct * 100).toFixed(0)}٪ · r_l=${(solution.solution.loanInterestRate * 100).toFixed(2)}٪ · کارمزد ${(solution.solution.feeRate * 100).toFixed(2)}٪ · N=${solution.solution.repaymentMonths}`
      : `حل معکوس نزدیک‌ترین ساختار را با ${solution.violations.length} نقض برگرداند (IRR ${(solution.metrics.bankIrrAnnual * 100).toFixed(2)}٪ در برابر هدف درخواستی ${(frontier.requestedTargetIrr * 100).toFixed(1)}٪)`,
    titleEn: solution.feasible
      ? `Inverse solve: bank IRR ${(solution.metrics.bankIrrAnnual * 100).toFixed(2)}% ≥ target ${(frontier.finalTargetIrr * 100).toFixed(1)}%${recalibEn}; T=${solution.solution.depositRetentionMonths}, M=${solution.solution.loanToDepositMultiplier.toFixed(2)}, blocked=${(solution.solution.blockedDepositPct * 100).toFixed(0)}%, rL=${(solution.solution.loanInterestRate * 100).toFixed(2)}%, fee=${(solution.solution.feeRate * 100).toFixed(2)}%, N=${solution.solution.repaymentMonths}`
      : `Inverse solve returned the closest structure with ${solution.violations.length} violation(s) (IRR ${(solution.metrics.bankIrrAnnual * 100).toFixed(2)}% vs requested ${(frontier.requestedTargetIrr * 100).toFixed(1)}%)`,
    metrics: {
      bankIrrAnnual: solution.metrics.bankIrrAnnual,
      borrowerNominal: solution.metrics.borrowerNominalEquivalent,
      feasible: solution.feasible ? 1 : 0,
      requestedTarget: frontier.requestedTargetIrr,
      finalTarget: frontier.finalTargetIrr,
      frontierRounds: frontier.trace.length,
      evaluations: solution.evaluations,
      elapsedMs: frontier.elapsedMs,
    },
  });
}

/** Node 4c — ALM & risk guardian: Base + three deterministic shocks. */
function stressGuardianNode(state: AgentState, emit: Emit) {
  const input = state.inverseSolverInput;
  const solution = state.inverseSolution?.solution;
  if (!input || !solution) return;
  const matrix = buildStressMatrix(input, solution, input.maxLiquidityGapLimit);
  state.stressMatrix = matrix;
  const worst = matrix.scenarios.find((s) => s.id === matrix.worstScenarioId);
  emit({
    node: "stress_guardian",
    stage: "stress:matrix",
    level: matrix.allRespectGapLimit ? "ok" : "warn",
    titleFa: `نگهبان ALM — پایه و سه شوک (+۲۰٪ برداشت سپرده، +۳٪ NPL، +۱۵٪ مهاجرت): بدترین سناریو «${worst?.labelFa ?? "—"}» با شکاف تجمعی ${(((worst?.worstCumulativeGapRial ?? 0) / 1e12)).toFixed(2)} تریلیون ریال · سر-به-سر ماه ${worst?.breakevenMonth ?? "—"} · ${matrix.allRespectGapLimit ? "همه سناریوها داخل سقف" : "نقض سقف شکاف"}`,
    titleEn: `ALM guardian — base + three shocks (+20% deposit run-off, +3pp NPL, +15pp migration): worst "${matrix.worstScenarioId}" cumulative gap ${(((worst?.worstCumulativeGapRial ?? 0) / 1e12)).toFixed(2)}T Rial; breakeven month ${worst?.breakevenMonth ?? "none"}; ${matrix.allRespectGapLimit ? "all scenarios within limit" : "gap limit breached"}`,
    metrics: {
      scenarios: matrix.scenarios.length,
      worstScenario: matrix.worstScenarioId,
      worstCumulativeGapRial: worst?.worstCumulativeGapRial ?? 0,
      allRespectGapLimit: matrix.allRespectGapLimit ? 1 : 0,
    },
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

  // ---- Simorgh lab: 7-scenario stress + synthetic population + metrics ----
  try {
    const labSeed = seedFromString(options.seed ?? state.prompt) + state.iteration * 104729;
    const stress = runStressSuite(product, req, labSeed, 90, req.horizonMonths);
    emit({
      node: "alm_stress_tester",
      stage: "alm:stress-suite",
      level: stress.feasibleInAll ? "ok" : "warn",
      titleFa: `آزمون ۷ سناریوی کلان سیمرغ: ${stress.feasibleInAll ? "همه موجه" : `ضعیف‌ترین «${stress.runs.find((r) => r.scenario.id === stress.worstScenario)?.scenario.labelFa ?? stress.worstScenario}»`} (${stress.pathsPerScenario} مسیر هر سناریو)`,
      titleEn: `Simorgh 7-scenario macro stress: ${stress.feasibleInAll ? "all feasible" : `weakest "${stress.worstScenario}"`} (${stress.pathsPerScenario} paths each)`,
      metrics: { scenarios: stress.runs.length, feasible: stress.feasibleInAll ? 1 : 0 },
    });

    // synthetic population underwriting against the blended representative mode
    const POP_N = 400;
    const population = generatePopulation(POP_N, labSeed);
    const totalLoans = Math.max(1, product.modes.reduce((a, m) => a + m.loanBookRial, 0));
    const blendedRate = product.modes.reduce((a, m) => a + m.loanBookRial * m.loanRate, 0) / totalLoans;
    const blendedTenor =
      product.modes.reduce((a, m) => a + m.loanBookRial * m.tenorMonths, 0) / totalLoans;
    const blendedPd = product.modes.reduce((a, m) => a + m.loanBookRial * m.pd, 0) / totalLoans;
    const blendedLgd = product.modes.reduce((a, m) => a + m.loanBookRial * m.lgd, 0) / totalLoans;
    const perCustomer = (product.modes.reduce((a, m) => a + m.loanBookRial, 0) /
      Math.max(1, product.modes.reduce((a, m) => a + m.customers, 0))) / 10;
    const uw = portfolioUnderwriting(population, {
      annualRate: blendedRate,
      tenorMonths: blendedTenor,
      amountMillionToman: perCustomer,
    });
    const tiers = scoreTiers();
    const shares = empiricalShares(population, tiers);
    const metrics = computeSimorghMetrics({
      alm: alm,
      blendedAnnualRate: blendedRate,
      blendedTenorMonths: blendedTenor,
      blendedPd,
      blendedLgd,
      population,
      approvedIds: new Set(Array.from(uw.decisions.entries()).filter(([, d]) => d.approved).map(([id]) => id)),
    });
    const categories = req.emphases.filter((e) => e.startsWith("cat-")).map((e) => e.slice(4));
    const tpl = templatesForCategories(categories)[0];
    state.simorgh = {
      metrics,
      population: {
        size: POP_N,
        seed: labSeed,
        approvalRate: uw.approvalRate,
        weightedPd: uw.weightedPd,
        weightedRate: uw.weightedRate,
        tiers: tiers.map((t, i) => ({
          labelFa: t.label,
          share: shares[i],
          approval: uw.tierApproval[i],
          pd: t.pd,
          pricingIndex: t.pricingIndex,
        })),
        medianIncomeMillionToman:
          population.map((c) => c.income).sort((a, b) => a - b)[Math.floor(POP_N / 2)] ?? 0,
      },
      stress: {
        feasibleInAll: stress.feasibleInAll,
        worstScenario: stress.worstScenario,
        pathsPerScenario: stress.pathsPerScenario,
        runs: stress.runs.map((r) => ({
          id: r.scenario.id,
          labelFa: r.scenario.labelFa,
          irrBankAnnual: r.irrBankAnnual,
          p95Ldr: r.p95Ldr,
          p5Lcr: r.p5Lcr,
          overturningShock: r.overturningShock,
          feasible: r.feasible,
        })),
      },
      advisor: { health: "healthy", insights: [] },
      template: tpl ? { id: tpl.id, nameFa: tpl.nameFa, emoji: tpl.emoji } : null,
    };
    emit({
      node: "alm_stress_tester",
      stage: "alm:simorgh-population",
      level: "info",
      titleFa: `شبیه‌سازی ${POP_N} مشتری مصنوعی: نرخ پذیرش ${(uw.approvalRate * 100).toFixed(0)}٪ · APR مؤثر ${metrics.aprPct.toFixed(1)}٪ · سرمایه IRB ${(metrics.irbCapitalRate * 100).toFixed(1)}٪`,
      titleEn: `Synthetic population of ${POP_N}: approval ${(uw.approvalRate * 100).toFixed(0)}% · APR ${metrics.aprPct.toFixed(1)}% · IRB capital ${(metrics.irbCapitalRate * 100).toFixed(1)}%`,
      metrics: {
        approvalRate: uw.approvalRate,
        aprPct: metrics.aprPct,
        nplRatio: metrics.nplRatio,
        inclusionScore: metrics.inclusionScore,
      },
    });
  } catch {
    // lab is additive: never fail the pipeline on lab errors
  }
}

/** Node 6 — critic auditor with mathematical adjustment directives. */
function criticAuditorNode(state: AgentState, emit: Emit, options: PipelineOptions) {
  const req = state.request;
  const product = state.product;
  const alm = state.alm;
  if (!req || !product || !alm) return;
  const findings = feasibilityCheck(product, alm.metrics, req);

  // ---- Phase 4 committee layers ------------------------------------------
  const rateCap =
    state.regulatoryConstraints?.effective_rate_cap ?? REGULATORY.morabahaMaxRate;

  // Node 2 — compliance & sharia auditor: hidden-usury flag. The solver's
  // borrower nominal-equivalent IRR (fee deduction + compensating-balance
  // lock-up) must stay ≤ the effective rate cap; a breach is a hard blocker.
  if (state.inverseSolution) {
    const sol = state.inverseSolution;
    const nominal = sol.metrics.borrowerNominalEquivalent;
    if (nominal > rateCap + 1e-9) {
      findings.push({
        id: "hidden-usury-effective-irr",
        severity: "blocker",
        metric: "IRR_effective_borrower",
        observed: nominal,
        limit: rateCap,
        messageFa: `نرخ مؤثر وام‌گیرنده ${(nominal * 100).toFixed(2)}٪ (با احتساب هزینه پنهان مسدودی و کارمزد) از سقف نرخ مؤثر ${(rateCap * 100).toFixed(2)}٪ عبور کرده است — ربا پنهان.`,
        messageEn: `Borrower effective IRR ${(nominal * 100).toFixed(2)}% (incl. hidden blocked-deposit and fee cost) exceeds the effective rate cap ${(rateCap * 100).toFixed(2)}% — hidden usury.`,
        directive: {
          field: "blockedRatio",
          action: "decrease",
          magnitude: 0.1,
          rationaleFa:
            "کاهش سهم سپرده مسدودی و کارمزد تا نرخ مؤثر وام‌گیرنده زیر سقف نرخ مؤثر قرار گیرد.",
        },
      });
    } else if (state.inverseFrontier?.recalibrated && sol.feasible) {
      // Adaptive decision core: the requested target was unattainable but
      // feedback shooting verified a feasible structure ON the observed
      // frontier — disclosed as a warning with the exact recalibration gap.
      const frontier = state.inverseFrontier;
      const gap = Math.max(0, frontier.requestedTargetIrr - frontier.finalTargetIrr);
      findings.push({
        id: "inverse-frontier-recalibrated",
        severity: "warning",
        metric: "inverse_solver.feasible_frontier",
        observed: frontier.finalTargetIrr,
        limit: frontier.requestedTargetIrr,
        messageFa: `هدف درخواستی IRR بانک ${(frontier.requestedTargetIrr * 100).toFixed(1)}٪ در پوسته مقرراتی ناممکن بود؛ حل‌کننده با تیراندازی بازخوردی (${frontier.trace.length} آزمون) ساختار ممکن روی مرز ${(frontier.finalTargetIrr * 100).toFixed(2)}٪ را تأیید کرد.`,
        messageEn: `Requested bank IRR target ${(frontier.requestedTargetIrr * 100).toFixed(1)}% is unattainable inside the envelope; feedback shooting (${frontier.trace.length} rounds) verified a feasible structure on the ${(frontier.finalTargetIrr * 100).toFixed(2)}% frontier.`,
        directive: {
          field: "*",
          action: "hold",
          magnitude: frontier.requestedTargetIrr > 0 ? gap / frontier.requestedTargetIrr : 0,
          rationaleFa:
            "نگه داشتن هدف روی مرز دست‌یافتهٔ تأییدشده؛ کاهش بیشتر سودآوری را قربانی می‌کند و افزایش آن ناممکن است.",
        },
      });
    } else if (!sol.feasible) {
      // Even after feedback rounds the structure stays infeasible (the
      // binding lever is not the bank-IRR target) — honest shortfall report
      // whose directive magnitude is proportional to the measured gap.
      const frontier = state.inverseFrontier;
      const target = frontier?.requestedTargetIrr ?? req.targetIrr;
      const shortfall = Math.max(0, target - sol.metrics.bankIrrAnnual);
      findings.push({
        id: "inverse-target-shortfall",
        severity: "warning",
        metric: "inverse_solver.bank_irr",
        observed: sol.metrics.bankIrrAnnual,
        limit: target,
        messageFa: `حل‌کننده معکوس پس از ${frontier?.trace.length ?? 1} آزمون به هدف IRR بانک ${(target * 100).toFixed(1)}٪ دست نیافت (نزدیک‌ترین ساختار ${(sol.metrics.bankIrrAnnual * 100).toFixed(2)}٪)؛ اهرم محدودکننده خارج از هدف است.`,
        messageEn: `Inverse solver did not reach the ${(target * 100).toFixed(1)}% bank IRR target after ${frontier?.trace.length ?? 1} round(s) (closest structure ${(sol.metrics.bankIrrAnnual * 100).toFixed(2)}%); the binding lever is not the target.`,
        directive: {
          field: "*",
          action: "decrease",
          magnitude: Math.min(0.5, Math.max(0.05, shortfall / Math.max(target, 0.01))),
          rationaleFa:
            "کاهش متناسب با کسری اندازه‌گیری‌شده هدف و بازنگری ساختاری (ضریب تسهیلات، ماندگاری)؛ شدت دستور از شکاف واقعی گرفته می‌شود، نه مقدار ثابت.",
        },
      });
    }
  }

  // Node 2 — design-level hidden-usury audit: volume-weighted borrower
  // nominal-equivalent of the SYNTHESIZED modes against the effective cap.
  if (product.modes.length > 0) {
    const totalD = product.modes.reduce((acc, m) => acc + m.depositVolumeRial, 0) || 1;
    const weighted = (pick: (m: ModeSpec) => number): number =>
      product.modes.reduce((acc, m) => acc + m.depositVolumeRial * pick(m), 0) / totalD;
    const designNominal = computeBorrowerNominalRate({
      loanBookRial: product.totalLoanBookRial,
      feeRate: weighted((m) => m.feeIncomeRate),
      blockedAmountRial: weighted((m) => m.blockedRatio) * product.targetDepositsRial,
      repaymentMonths: Math.max(12, Math.round(weighted((m) => m.tenorMonths))),
      loanInterestRate: weighted((m) => m.loanRate),
    });
    if (designNominal > rateCap + 1e-9) {
      findings.push({
        id: "hidden-usury-design",
        severity: "warning",
        metric: "design_IRR_effective_borrower",
        observed: designNominal,
        limit: rateCap,
        messageFa: `نرخ مؤثر طراحی‌شده طرح‌ها ${(designNominal * 100).toFixed(2)}٪ از سقف نرخ مؤثر ${(rateCap * 100).toFixed(2)}٪ فراتر است؛ پارامترهای حل‌شده معکوس (دارای سقف) مبنای عرضه‌اند.`,
        messageEn: `Design-level borrower effective IRR ${(designNominal * 100).toFixed(2)}% exceeds the ${(rateCap * 100).toFixed(2)}% cap; the capped inverse-solved parameters take precedence for offering.`,
        directive: {
          field: "blockedRatio",
          action: "decrease",
          magnitude: 0.05,
          rationaleFa:
            "کاهش نسبت مسدودی و کارمزد طراحی تا نرخ مؤثر وام‌گیرنده در طراحی نیز زیر سقف بماند.",
        },
      });
    }
  }

  // Node 3 — stress guardian findings: any shocked scenario whose worst
  // cumulative gap exceeds the limit is surfaced to the critique loop.
  if (state.stressMatrix && !state.stressMatrix.allRespectGapLimit) {
    const breached = state.stressMatrix.scenarios.filter((s) => s.breachedGapLimit);
    const worstBreach = breached.reduce((a, b) =>
      b.worstCumulativeGapRial < a.worstCumulativeGapRial ? b : a,
    );
    findings.push({
      id: "stress-gap-breach",
      severity: "warning",
      metric: `stress_${worstBreach.id}_worst_cumulative_gap`,
      observed: worstBreach.worstCumulativeGapRial,
      limit: -state.stressMatrix.gapLimitRial,
      messageFa: `سناریوی استرس «${worstBreach.labelFa}» شکاف تجمعی ${((worstBreach.worstCumulativeGapRial / 1e12).toFixed(2))} تریلیون ریال را ثبت کرده که از سقف ${((state.stressMatrix.gapLimitRial / 1e12).toFixed(2))} تریلیون فراتر می‌رود.`,
      messageEn: `Stress scenario "${worstBreach.id}" posts a worst cumulative gap of ${(worstBreach.worstCumulativeGapRial / 1e12).toFixed(2)}T Rial beyond the ${(state.stressMatrix.gapLimitRial / 1e12).toFixed(2)}T limit.`,
      directive: {
        field: "loanMultiplier",
        action: "decrease",
        // Proportional controller: severity scales with the measured breach
        // ratio instead of a fixed step (clamped to a sane action range).
        magnitude: Math.min(
          0.3,
          Math.max(
            0.05,
            0.05 +
              0.25 *
                (Math.max(0, -state.stressMatrix.gapLimitRial - worstBreach.worstCumulativeGapRial) /
                  Math.max(1, state.stressMatrix.gapLimitRial)),
          ),
        ),
        rationaleFa:
          "کاهش متناسب با میزان نقضِ اندازه‌گیری‌شده ضریب تسهیلات و پلکانی‌سازی دوره خواب سپرده تا شکاف سناریوهای استرس داخل سقف بماند.",
      },
    });
  }

  state.findings = findings;
  const blockers = findings.filter((f) => f.severity === "blocker");

  // Node 4 — structured self-correction critique (deterministic format).
  const actionFa: Record<string, string> = {
    increase: "افزایش",
    decrease: "کاهش",
    stagger: "پلکانی‌سازی",
    hold: "حفظ",
  };
  const topFinding = blockers[0] ?? findings.find((f) => f.severity === "warning") ?? null;
  state.critique = topFinding
    ? `CRITIQUE: ${topFinding.messageEn} Action required: ${topFinding.directive.action} on ${String(topFinding.directive.field)} by ${topFinding.directive.magnitude.toFixed(3)} — ${topFinding.directive.rationaleFa}`
    : "CRITIQUE: All hard constraints, stress scenarios and regulatory caps are satisfied. Action required: none.";
  emit({
    node: "critic_auditor",
    stage: "critic:critique",
    level: blockers.length ? "warn" : topFinding ? "info" : "ok",
    titleFa: topFinding
      ? `انتقاد: ${topFinding.messageFa} اقدام لازم: ${actionFa[topFinding.directive.action] ?? topFinding.directive.action} پارامتر «${String(topFinding.directive.field)}» با بزرگی ${topFinding.directive.magnitude.toFixed(3)}.`
      : "انتقاد: همه قیدهای سخت، سناریوهای استرس و سقف‌های مقرراتی پاس شدند؛ اقدام لازم: بدون اقدام.",
    titleEn: state.critique,
    metrics: { findings: findings.length, blockers: blockers.length },
  });
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

  // Simorgh advisor: merge critic + regulation + stress + metrics insights
  if (state.simorgh) {
    try {
      state.simorgh.advisor = buildAdvisorReport(product, alm, findings, {
        runs: state.simorgh.stress.runs.map((r) => ({
          scenario: { id: r.id as import("../simorgh/stress").ScenarioId, labelFa: r.labelFa, factors: { outflow: 1, adoption: 1, delta: 1, rate: 1 }, z: 0 },
          irrBankAnnual: r.irrBankAnnual,
          p95Ldr: r.p95Ldr,
          p5Lcr: r.p5Lcr,
          overturningShock: r.overturningShock,
          monthsInBreachLdr: 0,
          monthsInBreachLcr: 0,
          feasible: r.feasible,
        })),
        worstScenario: state.simorgh.stress.worstScenario,
        feasibleInAll: state.simorgh.stress.feasibleInAll,
        seed: state.simorgh.population.seed,
        pathsPerScenario: state.simorgh.stress.pathsPerScenario,
      });
      const top = state.simorgh.advisor.insights.slice(0, 3);
      if (top.length) {
        emit({
          node: "critic_auditor",
          stage: "critic:advisor",
          level: state.simorgh.advisor.health === "critical" ? "warn" : "info",
          titleFa: `مشاور سیمرغ (${state.simorgh.advisor.health === "healthy" ? "سالم" : state.simorgh.advisor.health === "watch" ? "پایش" : "بحرانی"}): ${top.map((i) => i.titleFa).join(" | ")}`,
          titleEn: `Simorgh advisor (${state.simorgh.advisor.health}): top insights emitted`,
          metrics: { insights: state.simorgh.advisor.insights.length },
        });
      }
    } catch {
      // advisory is additive
    }
  }

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
    .addNode("inverse_solver", (s, e) => inverseSolverNode(s, e))
    .addNode("stress_guardian", (s, e) => stressGuardianNode(s, e))
    .addNode("alm_stress_tester", (s, e) => almStressTesterNode(s, e, options))
    .addNode("critic_auditor", (s, e) => criticAuditorNode(s, e, options))
    .addNode("executive_report_generator", (s, e) => executiveReportNode(s, e, options));

  graph.addConditionalEdge("intent_analyzer", () => "regulatory_rag");
  graph.addConditionalEdge(
    "regulatory_rag",
    (s) => (s.request?.personaKey ? "guild_persona" : "mathematical_synthesizer"),
  );
  graph.addConditionalEdge("guild_persona", () => "mathematical_synthesizer");
  graph.addConditionalEdge("mathematical_synthesizer", () => "inverse_solver");
  graph.addConditionalEdge("inverse_solver", () => "stress_guardian");
  graph.addConditionalEdge("stress_guardian", () => "alm_stress_tester");
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
  // Zod-backed boundary: the engine re-validates even when the API route
  // already has (defence in depth). Prompt failures stay TypeErrors and
  // option failures stay RangeErrors, preserving the historical contract.
  const promptResult = pipelinePromptSchema.safeParse(prompt);
  if (!promptResult.success) {
    throw new TypeError(formatZodIssues(promptResult.error));
  }
  const optionsResult = pipelineOptionsSchema.safeParse(options);
  if (!optionsResult.success) {
    throw new RangeError(`Invalid pipeline options: ${formatZodIssues(optionsResult.error)}`);
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
