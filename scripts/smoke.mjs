#!/usr/bin/env node
/**
 * scripts/smoke.mjs — end-to-end smoke test against a running server.
 *
 *   BASE_URL=http://127.0.0.1:3000 node scripts/smoke.mjs
 *
 * Checks: /api/health, /api/benchmarks, /api/runs, a full SSE generation run
 * and the verification suite endpoint.
 */

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const results = [];

const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

async function json(path, init) {
  const res = await fetch(`${BASE}${path}`, init);
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

// 1) health
{
  const { status, body } = await json("/api/health");
  check(
    "GET /api/health",
    status === 200 && body.ok === true && ["available", "unavailable"].includes(body.persistence),
    `status ${status}, persistence ${body.persistence ?? "unreported"}`,
  );
}

// 2) server-rendered Persian application shell
{
  const response = await fetch(BASE);
  const html = await response.text();
  check(
    "GET / renders the Persian application shell",
    response.ok && /<html[^>]*lang="fa"/.test(html) && html.includes("<main") && html.includes("ALM"),
    `status ${response.status}, ${html.length} HTML characters`,
  );
}

// 3) knowledge base + benchmarks
{
  const { status, body } = await json("/api/benchmarks");
  check(
    "GET /api/benchmarks",
    status === 200 &&
      Number(body?.totals?.benchmarks) > 20 &&
      Number(body?.totals?.kbDocuments) > 10 &&
      ["available", "unavailable"].includes(body?.persistence),
    `${body?.totals?.benchmarks} benchmarks / ${body?.totals?.kbDocuments} kb docs / persistence ${body?.persistence ?? "unreported"}`,
  );
}

// 4) persisted knowledge search must accurately reflect the configured store
{
  const { status, body } = await json("/api/benchmarks?source=db");
  const expectedPersisted = body?.persistence === "available";
  const persistedCount = Array.isArray(body?.persistedKnowledge) ? body.persistedKnowledge.length : -1;
  check(
    "GET /api/benchmarks?source=db reflects persistence state",
    status === 200 && ["available", "unavailable"].includes(body?.persistence) &&
      (expectedPersisted ? persistedCount > 0 : persistedCount === 0),
    `persistence ${body?.persistence ?? "unreported"}, ${persistedCount} persisted results`,
  );
}

// 5) runs index
{
  const { status, body } = await json("/api/runs");
  check("GET /api/runs", status === 200 && Array.isArray(body.runs), `${body?.count ?? 0} runs`);
}

// 6) invalid run counts must be rejected, not silently reduced
{
  const { status, body } = await json("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: "تست", runs: 99 }),
  });
  check("POST /api/generate rejects an unsupported Monte Carlo count", status === 400 && /runs/.test(body.error ?? ""), `status ${status}`);
}

// 7) composer overrides are validated before a long-running generation starts
{
  const { status, body } = await json("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: "تست", intentOverrides: { lcrFloor: 0.9 } }),
  });
  check("POST /api/generate rejects invalid intent overrides", status === 400 && /lcrFloor/.test(body.error ?? ""), `status ${status}`);
}

// 8) full generation over SSE
{
  const requestedRuns = 120;
  const prompt =
    "یک بسته ۴ طرحی میانگین حساب برای جذب ۲۰ همت منبع با IRR حداقل ۲۶٪، سقف LDR ۸۵٪، کف LCR ۱٫۰۵ و حداکثر ریسک واژگونی ۶٪ طراحی کن";
  const res = await fetch(`${BASE}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      candidates: 8,
      runs: requestedRuns,
      withSensitivity: false,
      intentOverrides: { targetIrr: 0.27 },
    }),
  });
  const text = await res.text();
  const frames = text.split("\n\n");
  const events = [];
  let bootstrapPayload = null;
  let resultPayload = null;
  for (const frame of frames) {
    const lines = frame.split("\n");
    const event = lines.find((l) => l.startsWith("event:"))?.slice(6).trim();
    const data = lines
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trim())
      .join("");
    if (!event || !data) continue;
    events.push(event);
    if (event === "status") {
      try {
        bootstrapPayload = JSON.parse(data);
      } catch {
        bootstrapPayload = null;
      }
    }
    if (event === "result") {
      try {
        resultPayload = JSON.parse(data);
      } catch {
        resultPayload = null;
      }
    }
  }
  const hasResult = events.includes("result");
  const hasTrace = events.filter((e) => e === "trace").length;
  const metrics = resultPayload ?? {};
  const product = metrics.product ?? {};
  const alm = metrics.alm ?? {};
  const m = alm.metrics ?? {};
  check(
    "POST /api/generate (SSE stream)",
    res.ok && hasResult && hasTrace >= 10,
    `${events.length} frames, ${hasTrace} trace events`,
  );
  check(
    "generation bootstrap reports persistence mode",
    typeof bootstrapPayload?.persisted === "boolean",
    bootstrapPayload?.persisted ? "PostgreSQL corpus" : "in-memory corpus",
  );
  check(
    "synthesised matrix has >= 4 modes",
    (product.modes?.length ?? 0) >= 4,
    `${product.modes?.length ?? 0} modes`,
  );
  check(
    "p95 LDR <= 0.85",
    typeof m.p95Ldr === "number" && m.p95Ldr <= 0.85,
    m.p95Ldr != null ? m.p95Ldr.toFixed(4) : "n/a",
  );
  check(
    "p5 LCR >= 1.05",
    typeof m.p5Lcr === "number" && m.p5Lcr >= 1.05,
    m.p5Lcr != null ? m.p5Lcr.toFixed(3) : "n/a",
  );
  check(
    "final ALM uses exactly the requested Monte Carlo count",
    alm.monteCarloRuns === requestedRuns,
    `${alm.monteCarloRuns ?? "n/a"}/${requestedRuns} paths`,
  );
  check(
    "explicit composer intent override is applied",
    Math.abs((metrics.request?.targetIrr ?? 0) - 0.27) < 1e-9,
    `target IRR ${metrics.request?.targetIrr ?? "missing"}`,
  );
  const validationExplicit =
    (metrics.validationStatus === "not_validated" && metrics.reportFa?.includes("غیرقابل‌تأیید")) ||
    (metrics.validationStatus === "constraints_passed" && metrics.reportFa?.includes("قیود سخت پاس شدند"));
  check(
    "validation result is explicit in API and report",
    validationExplicit,
    String(metrics.validationStatus ?? "missing status"),
  );
  if (bootstrapPayload?.persisted === true) {
    if (typeof metrics.runId === "string") {
      const { status, body } = await json(`/api/runs?id=${encodeURIComponent(metrics.runId)}`);
      const stored = body?.run;
      check(
        "persisted run rehydrates its validation and audit artifacts",
        status === 200 && stored?.validationStatus === metrics.validationStatus &&
          stored?.metrics?.monteCarloRuns === requestedRuns &&
          Array.isArray(stored?.findings) && Array.isArray(stored?.accountingEntries) &&
          Array.isArray(stored?.complianceDraft) && Array.isArray(stored?.benchmarks) &&
          typeof stored?.reportEn === "string",
        status === 200 ? `validation ${stored?.validationStatus ?? "missing"}` : `status ${status}`,
      );
    } else {
      check("persisted generation returns a run id", false, "PostgreSQL was available but runId was null");
    }
  } else {
    check(
      "in-memory mode does not claim a persisted run id",
      bootstrapPayload?.persisted === false && metrics.runId === null,
      `persisted=${bootstrapPayload?.persisted}; runId=${metrics.runId ?? "null"}`,
    );
  }
  const { status: historyStatus, body: historyBody } = await json("/api/runs");
  check(
    "run history matches the active persistence mode",
    historyStatus === 200 && (bootstrapPayload?.persisted === true ? historyBody.count > 0 : historyBody.count === 0),
    `${historyBody?.count ?? 0} runs, persisted=${bootstrapPayload?.persisted}`,
  );
  check(
    "executive report emitted",
    (metrics.reportFa?.length ?? 0) > 800,
    `${metrics.reportFa?.length ?? 0} chars`,
  );
}

// 9) verification suite endpoint
{
  const { status, body } = await json("/api/selftest?fast=1");
  check(
    "GET /api/selftest?fast=1",
    status === 200 && body.passed === true,
    `${body.passedAssertions}/${body.totalAssertions} assertions`,
  );
}

const failed = results.filter((r) => !r.ok);
console.log(`\nSMOKE ${failed.length === 0 ? "PASSED" : "FAILED"} — ${results.length - failed.length}/${results.length} checks`);
process.exit(failed.length === 0 ? 0 : 1);
