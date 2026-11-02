# Architecture

This document explains how the system is layered, why each boundary exists, and how
data flows from a natural-language strategic objective to a bank-ready product
specification.

> Language: Persian is the delivery language; this engineering document is English.

## 1. Layer diagram

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│  DELIVERY LAYER   src/app/page.tsx · src/components/*                        │
│  RTL Persian UI · SSE consumer · Recharts · SVG ecosystem canvas             │
└──────────────────────────────────────────────────────────────────────────────┘
              ▲ JSON / text-event-stream
┌──────────────────────────────────────────────────────────────────────────────┐
│  API LAYER        src/app/api/{generate,runs,benchmarks,selftest,health}      │
│  Route handlers · SSE framing · input validation · no business logic          │
└──────────────────────────────────────────────────────────────────────────────┘
              ▲ typed calls
┌──────────────────────────────────────────────────────────────────────────────┐
│  ORCHESTRATION    src/lib/agents/                                            │
│  StateGraph (7 nodes, conditional routing, ≤5 self-correction iterations)     │
│  intent_analyzer → regulatory_rag → guild_persona → mathematical_synthesizer  │
│                  → alm_stress_tester → critic_auditor ↺ → report_generator    │
└──────────────────────────────────────────────────────────────────────────────┘
        │ asks                       ▲ configures            │ retrieves
        ▼                            │                       │
┌──────────────────────────────────────────────────────┐  ┌───────────────────┐
│  DETERMINISTIC DOMAIN  src/lib/domain/               │  │  RAG  src/lib/rag/ │
│  constants · financial · costOfFunds · pointEngine   │  │  18 CBI/Islamic    │
│  almSimulator · optimizer · intentParser             │  │  contract docs,    │
│  guildValueChain · types                             │  │  hashed embeddings │
│  → 100% pure, seeded, no I/O, no LLM, no Math.random │  │  + 27 benchmarks   │
└──────────────────────────────────────────────────────┘  └───────────────────┘
              ▲ Drizzle ORM
┌──────────────────────────────────────────────────────────────────────────────┐
│  PERSISTENCE   src/db/schema.ts · src/lib/db/repository.ts                    │
│  kb_documents · benchmarks · generation_runs                                 │
└──────────────────────────────────────────────────────────────────────────────┘
```

## 2. The invariants (and why they are enforced)

| Invariant | Why | Enforced by |
| --- | --- | --- |
| LLMs never compute financial numbers | Hallucinated Rials are unauditable and unregulatable | No LLM call exists in `src/lib/domain/`; agents only emit weights/archetypes |
| Full reproducibility | A product specification must be defensible in an ALCO meeting | `createRng` / `seedFromString`; `TC0-A` asserts bit-identical metrics |
| Domain layer is pure | Testable without a database, a network or a server | No `fetch`, no `fs`, no `process.env` under `src/lib/domain/` |
| Constraints come from retrieval, not invention | Regulatory limits must be citable | `retrieveKnowledge` returns `binding` limits with a `citation` field |
| The critic can always force a redesign | A feasible-looking product that breaches LDR/LCR is dangerous | `feasibilityCheck` → `applyDirectives` loop, max 5 iterations |

## 3. Data flow of a single run

```text
prompt (fa/en)
   │
   ├─ parseIntent ─────────────▶ ProductGenerationRequest
   │      · Hemmat/Toman/Rial unit capture (۰-۹ and ٠-۹ normalisation)
   │      · persona detection (9 personas, weighted keyword scoring)
   │      · contract + emphasis detection → λ re-weighting (normalised)
   │
   ├─ retrieveKnowledge ───────▶ RegulatoryConstraint[]   (cosine + lexical + category boost)
   │                             each with binding[]: { field, op, value }
   │
   ├─ buildGuildEcosystem ─────▶ suppliers ↔ anchor ↔ clients, rails, γ target
   │
   ├─ optimizeProduct ─────────▶ 4 stages
   │      A  integer archetype selection (5 blueprints, bounded ranges)
   │      B  LP water-filling of w_m subject to Σw = 1 and capacityShare caps
   │      C  seeded structured search + coordinate refinement, scored by the ALM twin
   │      D  critic directives (β↑ γ↑ ω↑ τ_d staggering α↓ τ_l↑)
   │
   ├─ runAlmSimulation ────────▶ cohorts, Monte Carlo paths, LDR/LCR/IRR/ROI/ROE/NIM
   │
   ├─ criticAuditor ───────────▶ findings → blocker? loop back
   │
   └─ executiveReport ─────────▶ mode matrix · accounting entries · compliance draft
                                 · Persian proposal · English summary · sensitivity frame
                                 → persisted to generation_runs
```

## 4. Cohort state machine inside the ALM twin

```text
        ┌────────────┐  age ≥ τ_d      ┌───────────┐  age ≥ τ_d+ω    ┌──────────────┐
new ───▶│ 0 sleeping │────────────────▶│ 1 queued  │────────────────▶│ 2 repaying   │
        └────────────┘                 └───────────┘                 └──────────────┘
             balance = intake                disbursement:                 · annuity PMT (or
             × ramp(t) × κ                     loan = α·volume               straight-line for QH)
                                               withdrawable = volume·(1−β)  · blocked release per
                                               leak = withdrawable·δ ~        schedule (linear /
                                                 Beta(a,b)                    midpoint / end)
                                               closed loop: loan·γ →          · γ float bucket
                                                 merchant float bucket         decays over 3 months
                                             ─────────────────────▶        └──────┬───────┘
                                                                                   │ fully repaid
                                                                                   ▼
                                                                            ┌────────────┐
                                                                            │ 3 closed   │──▶ 38% rolls
                                                                            └────────────┘    into a fresh
                                                                                              cycle
```

Every month the twin aggregates cohorts into a balance sheet, computes the ratios,
and records the overturning reversal `max(0, withdrawals − closedLoopInflow) / prevDeposits`.

## 5. Concurrency and streaming

* `POST /api/generate` opens a `ReadableStream` and emits SSE frames. Each graph node
  awaits a `setTimeout(0)` tick so buffered frames flush instead of arriving in one block.
* `optimizeProduct` is asynchronous and yields every 4 screened candidates, which is
  what makes the progress stream feel live during the 26-candidate sweep.
* The client aborts with `AbortController`; the stream controller closes safely when
  the peer disconnects.

## 6. Performance profile

| Stage | Cost | Notes |
| --- | --- | --- |
| Intent parsing | < 1 ms | regex + dictionaries |
| RAG retrieval | < 2 ms | 18 documents, 128-dim cosine |
| Guild mapping | < 1 ms | pure lookups |
| Candidate screening (26 × single deterministic path × 60 months) | ~250 ms | dominates the solve |
| Critic loop (5 × 220–1000 paths) | 0.4–1.5 s | final confirmation uses the full population |
| Sensitivity sweep (6 dims × 5 deltas × 40 paths) | ~1.5 s | optional, `withSensitivity: false` skips it |

Total end-to-end for a 20-Hemmat request with sensitivity: **≈ 4–6 s** on a single core.
The suite's fast mode (`--fast`) reduces paths to keep CI under ~10 s.

## 7. Extension points

* **New archetype** → add an `ArchetypeBlueprint` in `optimizer.ts` (bounded ranges only).
* **New persona / guild** → add to `PERSONAS` in `guildValueChain.ts`.
* **New regulatory rule** → add a `KbDocumentSeed` in `knowledgeBase.ts` with `binding` limits.
* **New market benchmark** → append to `RAW` in `benchmarks.ts`.
* **New stress scenario** → add an entry to `scenarioFactors` in `almSimulator.ts`
  (`outflow`, `adoption`, `delta`, `rate` multipliers).
