# API Reference

Base URL: `http://localhost:3000`. All endpoints are Node.js runtime route
handlers and are `dynamic = "force-dynamic"` (no caching).

Errors return `{ error: string, errorFa?: string }` with an appropriate HTTP status.

---

## `GET /api/health`

Application liveness plus an explicit persistence/corpus status.

```json
{
  "ok": true,
  "persistence": "available",
  "corpus": { "documents": 18, "benchmarks": 27 }
}
```

The endpoint returns `200` while the generator is available, even if PostgreSQL
is not configured or reachable; `persistence` distinguishes that degraded mode
from a database-backed corpus.

---

## `POST /api/generate`

Runs the full seven-node inverse goal-seeking pipeline and streams the agent
trace over **Server-Sent Events**.

### Request body

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `prompt` | `string` | — | **Required.** Persian or English strategic objective, trimmed and limited to 4,000 characters. |
| `candidates` | `number` | `26` | Structural candidates screened by stage C. Integer in 8–60. |
| `runs` | `number` | `1000` | Final base-case Monte Carlo paths. Integer in 100–2,000; the API rejects invalid counts and never silently reduces the requested final count. |
| `maxIterations` | `number` | `5` | Critic self-correction limit, integer in 1–5. |
| `withSensitivity` | `boolean` | `true` | Compute the six-dimension sensitivity sweep. |
| `seed` | `string` | derived from prompt | Optional reproducibility seed (up to 128 characters); also seeds sensitivity evaluation. |
| `intentOverrides` | `object` | `{}` | Optional explicit composer values; overrides conflicting prompt-parsed values. Keys/ranges: `targetDepositsHemmat` 0.01–1,000; `targetIrr` 0.01–1; `ldrCeiling` 0.4–0.95; `lcrFloor` 1–2; `maxOverturningShock` 0.01–0.25. Unknown keys and invalid values return `400`. |

```bash
curl -N -X POST localhost:3000/api/generate \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"۲۰ همت منبع با IRR حداقل ۲۶٪ و سقف LDR ۸۵٪","candidates":12,"runs":400}'
```

### SSE frames

| `event:` | Payload |
| --- | --- |
| `status` | `{ stage: "bootstrap", titleFa, titleEn, persisted }` — reports whether the corpus is backed by PostgreSQL or in-memory data |
| `trace` | `TraceEvent` — one per agent reasoning step (see below) |
| `result` | the complete generation result, including `validationStatus` and nullable `runId` |
| `done` | `{ ok: boolean, runId?: string | null }` |
| `error` | `{ message, status? }` — a failed graph may be reported in-band after the SSE response starts |

`TraceEvent`:

```ts
{
  id: number;
  node: "intent_analyzer" | "regulatory_rag" | "guild_persona" |
        "mathematical_synthesizer" | "alm_stress_tester" |
        "critic_auditor" | "executive_report_generator" | "graph";
  stage: string;              // e.g. "rag:retrieved", "critic:blocker"
  level: "info" | "ok" | "warn" | "error";
  titleFa: string;
  titleEn: string;
  detailFa?: string;
  detailEn?: string;
  metrics?: Record<string, number | string>;
  ts: number;                 // ms since pipeline start
}
```

### `result` payload

```ts
{
  runId: string | null;
  prompt: string;
  status: "complete";
  validationStatus: "constraints_passed" | "not_validated";
  error: string | null;
  elapsedMs: number;
  iterationCount: number;

  request: ProductGenerationRequest;   // parsed objective, λ weights, parsedTokens
  warnings: string[];
  constraints: RegulatoryConstraint[]; // retrieved CBI limits + binding[] + citation
  persona: PersonaSpec | null;
  ecosystem: GuildEcosystem | null;    // tripartite closed-loop value chain
  product: ProductSpec;                // the multi-mode matrix
  alm: AlmResult;                      // metrics + monthly series + percentile envelopes
  findings: CriticFinding[];
  iterations: OptimizerIteration[];    // self-correction trace
  sensitivity: SensitivityFrame | null;
  accountingEntries: AccountingEntry[];
  complianceDraft: ComplianceDraftItem[];
  benchmarks: BenchmarkScheme[];
  reportFa: string;                    // Persian executive proposal (Markdown)
  reportEn: string;
}
```

`ProductSpec.modes[i]` carries every structural lever:

`weight, depositVolumeRial, depositRate, statutoryReserve, liquidityDeduction,
opexRatio, pd, lgd, sleepMonths (τ_d), loanMultiplier (α), tenorMonths (τ_l),
loanRate (r_l), blockedRatio (β), waitingMonths (ω), closedLoopRetention (γ),
withdrawalFractionMean (δ), sourceKappa (κ), feeIncomeRate, capToman,
avgTicketToman, adoptionScore, blockRelease, cohortRampMonths, personaIncomeToman,
costOfFunds, expectedLoss, freeResourcesRial, loanBookRial,
monthlyInstallmentToman, installmentToIncome, npvBankRial, customers`

---

## `GET /api/benchmarks`

Knowledge base + benchmark registry. Seeds PostgreSQL idempotently on first call when configured; local domain data remains available if persistence is unavailable.

| Query param | Default | Notes |
| --- | --- | --- |
| `q` | — | Free-text query (Persian or English). |
| `source` | `memory` | `db` also runs the persisted PostgreSQL search. |

```json
{
  "benchmarks": [ /* BenchmarkScheme[] */ ],
  "knowledge": [ /* RegulatoryConstraint[] with relevance */ ],
  "persistedKnowledge": [],
  "persistence": "unavailable",
  "regulatory": { "ldrCeiling": 0.85, "lcrFloor": 1.05, "statutoryReserve": { "...": "..." } },
  "totals": { "benchmarks": 27, "kbDocuments": 18 }
}
```

---

## `GET /api/runs`

| Param | Notes |
| --- | --- |
| none | Latest 25 persisted runs (newest first), summary columns only; returns an empty list when persistence is unavailable. |
| `?limit=N` | 1–100. |
| `?id=<uuid>` | Full audit trail of one run, including `trace`. |

```json
{
  "runs": [{
    "id": "f9a8dbf7-…",
    "prompt": "برای پزشکان متخصص …",
    "status": "complete",
    "validationStatus": "constraints_passed",
    "iterations": 2,
    "targetDeposits": 6.0e13,
    "irrBank": 0.2817,
    "maxLdr": 0.5463,
    "minLcr": 1.3923,
    "overturningRisk": 0.0176,
    "createdAt": "2026-01-01T10:00:00.000Z"
  }],
  "count": 1
}
```

`GET /api/runs?id=…` returns the stored `generation_runs` row with parsed
`intent`, `retrievedConstraints`, `guild`, `persona`, `findings`, `productSpec`,
`metrics` (full ALM result), `sensitivity`, `benchmarks`, accounting and
compliance artifacts, `trace`, both reports, and `validationStatus`.

---

## `GET /api/selftest`

Executes the deterministic verification suite: financial unit checks, directional
LDR/LCR correction and sensitivity-seed regressions, graph budget/cancellation,
and two end-to-end product scenarios.

| Param | Notes |
| --- | --- |
| `?fast=1` | Uses 220 final ALM paths for the two integration cases; CI-friendly. The exact requested path count remains enforced. |

The current suite has 47 assertions across `TC0`, `TC-CORRECTION`, `TC-GRAPH`,
`TC1` and `TC2`. Counts may change as coverage is extended.

```json
{
  "passed": true,
  "totalAssertions": 47,
  "passedAssertions": 47,
  "durationMs": 4567,
  "cases": [
    { "id": "TC0", "passed": true },
    { "id": "TC-CORRECTION", "passed": true },
    { "id": "TC-GRAPH", "passed": true },
    { "id": "TC1", "passed": true },
    { "id": "TC2", "passed": true }
  ]
}
```

`200` when the whole suite passes, `500` otherwise.

---

## Rate / size notes

* Final base-case ALM always uses exactly the requested `runs`; candidate
  screening, severe-run diagnostics and sensitivity points are separate
  auxiliary evaluations and are not substituted for the final result.
* `validationStatus` is `not_validated` when hard blockers remain after the
  configured correction loop. A completed pipeline is not itself a claim that
  every constraint passed.
* Large requests (up to `runs: 2000` and `candidates: 60`) are CPU-intensive.
  Keep `maxDuration` generous when deploying behind a proxy that buffers SSE.
* SSE responses set `Cache-Control: no-cache, no-transform` and
  `X-Accel-Buffering: no` for nginx compatibility.
