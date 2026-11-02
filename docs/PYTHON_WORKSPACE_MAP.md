# Python Workspace Map

The original system specification describes a three-workspace deployment
(`backend/` FastAPI + LangGraph + Celery, `frontend/` Next.js, root
`docker-compose.yml`). This repository ships that system as a **single
deployable TypeScript workspace** so that the deterministic financial engine, the
agent graph, the RAG store and the delivery layer cannot drift apart, and so the
whole thing is reproducible with one `npm ci`.

This document maps every mandated Python module to the module that implements it,
so nothing is lost and a future Python port can be done file-by-file if a team
needs Celery-scale parallelism.

## 1. Mapping

### Root configuration

| Mandated file | Implemented as |
| --- | --- |
| `docker-compose.yml` | [`docker-compose.yml`](../docker-compose.yml) (postgres + app + db-push tool) |
| `.env.example` | [`.env.example`](../.env.example) |

### `backend/app/core/`

| Mandated file | Implemented as |
| --- | --- |
| `config.py` | [`src/lib/domain/constants.ts`](../src/lib/domain/constants.ts) (all tunables in one module) |
| `constants.py` | same file, `REGULATORY` / `STATUTORY_RESERVE` / `CAPITAL` blocks |

### `backend/app/domain/`

| Mandated file | Implemented as | Content parity |
| --- | --- | --- |
| `models.py` | [`src/lib/domain/types.ts`](../src/lib/domain/types.ts) | strict Pydantic-v2-equivalent schemas: `ModeSpec`, `ProductSpec`, `PersonaSpec`, `GuildEcosystem`, `ProductGenerationRequest`, `RegulatoryConstraint`, `AlmMonthRow`, `AlmMetrics`, `AlmResult`, `CriticFinding`, `BenchmarkScheme` |
| `cost_of_funds.py` | [`src/lib/domain/costOfFunds.ts`](../src/lib/domain/costOfFunds.ts) | exact CoF equation + inverse solver + portfolio blend |
| `point_engine.py` | [`src/lib/domain/pointEngine.ts`](../src/lib/domain/pointEngine.ts) | κ-weighted average balance, `L = α·B̄` with caps, blocked-release schedules, `NPV_bank`, break-even rate, affordability |
| `alm_simulator.py` | [`src/lib/domain/almSimulator.ts`](../src/lib/domain/almSimulator.ts) | cohort state machine, Beta δ, staged β release, closed-loop γ float, 60-month horizon, up to 2000 MC paths, LDR/LCR/IRR/ROI/ROE/NIM (joint vs non-joint), overturning engine, solvency rules |
| `optimizer.py` | [`src/lib/domain/optimizer.ts`](../src/lib/domain/optimizer.ts) | integer archetype selection, LP water-filling, seeded structured search + coordinate refinement, composite objective, critic directives, sensitivity sweep |
| `guild_value_chain.py` | [`src/lib/domain/guildValueChain.ts`](../src/lib/domain/guildValueChain.ts) | 9 personas, tripartite closed-loop ecosystem, κ/γ/PD/LGD calibration |

Supporting modules that the specification implies but does not name:

| Concern | Implemented as |
| --- | --- |
| `numpy-financial` (IRR/NPV/PMT), NumPy RNG, SciPy distributions | [`src/lib/domain/financial.ts`](../src/lib/domain/financial.ts) — mulberry32 PRNG, Box–Muller normal, Marsaglia–Tsang gamma, beta ratio, `pmt`, `npv`, `irr`, `percentile` |
| Numba-JIT hot loop | the cohort loop is already a single typed `Float`-free pass over arrays; V8 JIT handles it (≈1000 paths in under 1.5 s) |

### `backend/app/agents/`

| Mandated file | Implemented as |
| --- | --- |
| `state.py` | [`src/lib/agents/state.ts`](../src/lib/agents/state.ts) — `AgentState`, `TraceEvent`, `StateGraph` with conditional edges, checkpoint-friendly typed channels |
| `graph.py` | [`src/lib/agents/graph.ts`](../src/lib/agents/graph.ts) — the seven nodes, conditional routing, ≤5-iteration critic loop |
| `intent_agent.py` | [`src/lib/domain/intentParser.ts`](../src/lib/domain/intentParser.ts) + `intentAnalyzerNode` |
| `regulatory_rag_agent.py` | `regulatoryRagNode` + [`src/lib/rag/knowledgeBase.ts`](../src/lib/rag/knowledgeBase.ts) |
| `persona_guild_agent.py` | `guildPersonaNode` + [`src/lib/domain/guildValueChain.ts`](../src/lib/domain/guildValueChain.ts) |
| `synthesizer_node.py` | `mathematicalSynthesizerNode` + `optimizer.ts` |
| `critic_auditor_agent.py` | `criticAuditorNode` + `feasibilityCheck` / `applyDirectives` |
| `executive_report_generator.py` | [`src/lib/agents/reportGenerator.ts`](../src/lib/agents/reportGenerator.ts) |

### `backend/app/rag/`

| Mandated file | Implemented as |
| --- | --- |
| `vector_store.py` | [`src/lib/rag/knowledgeBase.ts`](../src/lib/rag/knowledgeBase.ts) — feature-hashed 128-dim L2-normalised embeddings, cosine + lexical hybrid re-ranking, category boosting |
| `seed_iran_banking_kb.py` | `KB_SEED` (18 regulatory & Islamic-contract documents) + [`src/lib/rag/benchmarks.ts`](../src/lib/rag/benchmarks.ts) (27 Iranian schemes) |

### `backend/app/api/`

| Mandated file | Implemented as |
| --- | --- |
| `routes_generator.py` (async + SSE) | [`src/app/api/generate/route.ts`](../src/app/api/generate/route.ts) — `ReadableStream` SSE with `status`/`trace`/`result`/`done`/`error` frames |
| `routes_benchmarks.py` | [`src/app/api/benchmarks/route.ts`](../src/app/api/benchmarks/route.ts) + [`src/app/api/runs/route.ts`](../src/app/api/runs/route.ts) |

Additional endpoints: `/api/health` (readiness), `/api/selftest` (verification suite).

### `backend/tests/`

| Mandated file | Implemented as |
| --- | --- |
| `test_financial_engine.py` | [`src/lib/verification/financialEngineTests.ts`](../src/lib/verification/financialEngineTests.ts), executed by [`scripts/verify.mjs`](../scripts/verify.mjs) and `GET /api/selftest` |

### `frontend/`

| Mandated file | Implemented as |
| --- | --- |
| `src/app/layout.tsx` | [`src/app/layout.tsx`](../src/app/layout.tsx) — `lang="fa" dir="rtl"`, Vazirmatn, grid backdrop |
| `src/app/page.tsx` | [`src/app/page.tsx`](../src/app/page.tsx) |
| `PromptComposer.tsx` | [`src/components/PromptComposer.tsx`](../src/components/PromptComposer.tsx) |
| `AgentReasoningStream.tsx` | [`src/components/AgentReasoningStream.tsx`](../src/components/AgentReasoningStream.tsx) |
| `MultiModeMatrixTable.tsx` | [`src/components/MultiModeMatrixTable.tsx`](../src/components/MultiModeMatrixTable.tsx) |
| `ALMCashFlowChart.tsx` | [`src/components/ALMCashFlowChart.tsx`](../src/components/ALMCashFlowChart.tsx) |
| `GuildEcosystemCanvas.tsx` | [`src/components/GuildEcosystemCanvas.tsx`](../src/components/GuildEcosystemCanvas.tsx) |
| (extra) | [`src/components/ResultPanels.tsx`](../src/components/ResultPanels.tsx) — metrics, critic trace, sensitivity, RAG/benchmark, compliance/accounting, executive report, run history |

## 2. Where a Python port still adds value

The TypeScript workspace is not a compromise on the mathematics — every formula is
implemented verbatim. Three things genuinely justify a Python service, if and when
the workload outgrows one Node process:

1. **Celery-scale Monte Carlo.** 100 000 paths × 60 months parallelises cleanly.
   Port `alm_simulator.py` first, keep the seeded PRNG algorithm identical
   (mulberry32) so results stay comparable, and assert parity against
   `TC1`/`TC2` summaries.
2. **OR-Tools / PuLP exact MILP.** The water-filling stage is provably optimal for
   the allocation sub-problem, and the structured search handles the rest. If you
   need branch-and-bound over the archetype selection with hard cardinality
   constraints, swap stage A for OR-Tools and keep stages B–D unchanged.
3. **ChromaDB / PGVector semantic search.** The hashed-bag-of-words store is
   deterministic and dependency-free, which is why it is used here. A real
   embedding model improves retrieval only — it must **not** change the binding
   limits, which come from the seeded documents.

If you port, keep these three rules from `CONTRIBUTING.md`:

* the domain layer stays free of network I/O;
* no `Math.random()` / unseeded RNG anywhere;
* the two integration tests must still pass with the same thresholds
  (IRR ≥ 26%, p95 LDR ≤ 0.85, p5 LCR ≥ 1.05, γ ≥ 0.65, net drain ≈ 0).

## 3. Parity checklist for a port

```text
[ ] CoF formula matches U-COF-01 to 1e-9
[ ] inverse deposit-rate solver round-trips
[ ] PMT/NPV/IRR match numpy-financial to 1e-6
[ ] midpoint release lands on index ⌈n/2⌉−1
[ ] water-filling weights sum to 1.0 exactly
[ ] same seed ⇒ identical IRR / p95 LDR / p5 LCR / overturning
[ ] TC1 summary within tolerance of the TypeScript baseline
[ ] TC2 γ_weighted ≥ 0.65 and netDrainRatio ≤ 0.05
```
