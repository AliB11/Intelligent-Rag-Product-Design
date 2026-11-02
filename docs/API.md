# API Reference

Base URL: `http://localhost:3000`. All endpoints are Node.js runtime route
handlers and are `dynamic = "force-dynamic"` (no caching).

Errors return `{ error: string, errorFa?: string }` with an appropriate HTTP status.

---

## `GET /api/health`

Liveness + database connectivity.

```json
{ "ok": true }
```

`200` when `select 1` succeeds, `500` with `{ "ok": false }` otherwise.

---

## `POST /api/generate`

Runs the full five-stage inverse goal-seeking pipeline and streams the agent
trace over **Server-Sent Events**.

### Request body

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `prompt` | `string` | — | **Required.** Persian or English strategic objective. Trimmed, min length 1. |
| `candidates` | `number` | `26` | Structural candidates screened by stage C. 8–60. |
| `runs` | `number` | `1000` | Monte Carlo paths for the final confirmation. |
| `maxIterations` | `number` | `5` | Upper bound on the critic self-correction loop. |
| `withSensitivity` | `boolean` | `true` | Compute the 6-dimension sensitivity sweep. |

```bash
curl -N -X POST localhost:3000/api/generate \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"۲۰ همت منبع با IRR حداقل ۲۶٪ و سقف LDR ۸۵٪","candidates":12,"runs":400}'
```

### SSE frames

| `event:` | Payload |
| --- | --- |
| `status` | `{ stage: "bootstrap", titleFa, titleEn }` — knowledge-base seeding result |
| `trace` | `TraceEvent` — one per agent reasoning step (see below) |
| `result` | the complete `GenerationResult` |
| `done` | `{ ok: true, runId }` |
| `error` | `{ message }` |

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
  status: "complete" | "failed";
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

Knowledge base + benchmark registry. Seeds PostgreSQL idempotently on first call.

| Query param | Default | Notes |
| --- | --- | --- |
| `q` | — | Free-text query (Persian or English). |
| `source` | `memory` | `db` also runs the persisted PostgreSQL search. |

```json
{
  "benchmarks": [ /* BenchmarkScheme[] */ ],
  "knowledge": [ /* RegulatoryConstraint[] with relevance */ ],
  "persistedKnowledge": [],
  "regulatory": { "ldrCeiling": 0.85, "lcrFloor": 1.05, "statutoryReserve": { "...": "..." } },
  "totals": { "benchmarks": 27, "kbDocuments": 18 }
}
```

---

## `GET /api/runs`

| Param | Notes |
| --- | --- |
| none | Latest 25 runs (ascending recency), summary columns only. |
| `?limit=N` | 1–100. |
| `?id=<uuid>` | Full audit trail of one run, including `trace`. |

```json
{
  "runs": [{
    "id": "f9a8dbf7-…",
    "prompt": "برای پزشکان متخصص …",
    "status": "complete",
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

`GET /api/runs?id=…` returns `{ run: { intent, retrievedConstraints, guild,
productSpec, metrics /* full AlmResult */, sensitivity, trace, reportFa } }`.

---

## `GET /api/selftest`

Executes the deterministic verification suite.

| Param | Notes |
| --- | --- |
| `?fast=1` | Reduced Monte Carlo paths, CI-friendly. |

```json
{
  "passed": true,
  "totalAssertions": 33,
  "passedAssertions": 33,
  "durationMs": 1736,
  "ranAt": "2026-01-01T10:00:00.000Z",
  "cases": [
    { "id": "TC0", "passed": true, "assertions": [ { "id": "U-COF-01", "passed": true, "expected": "0.253058", "actual": "0.253058" } ], "summary": { } },
    { "id": "TC1", "passed": true, "summary": { "modes": 4, "irrBankAnnual": 0.3162, "p95Ldr": 0.4195, "p5Lcr": 1.392 } },
    { "id": "TC2", "passed": true, "summary": { "gammaWeighted": 0.729, "netLiquidityDrainRatio": 0 } }
  ]
}
```

`200` when the whole suite passes, `500` otherwise.

---

## Rate / size notes

* A full run with sensitivity takes **≈ 4–6 s** of CPU; `candidates: 60` and
  `runs: 2000` can reach ≈ 25 s. Keep `maxDuration` generous when deploying
  behind a proxy that buffers SSE.
* SSE responses set `Cache-Control: no-cache, no-transform` and
  `X-Accel-Buffering: no` for nginx compatibility.
