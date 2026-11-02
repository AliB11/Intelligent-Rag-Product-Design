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
  check("GET /api/health", status === 200 && body.ok === true, `status ${status}`);
}

// 2) knowledge base + benchmarks
{
  const { status, body } = await json("/api/benchmarks");
  check(
    "GET /api/benchmarks",
    status === 200 &&
      Number(body?.totals?.benchmarks) > 20 &&
      Number(body?.totals?.kbDocuments) > 10,
    `${body?.totals?.benchmarks} benchmarks / ${body?.totals?.kbDocuments} kb docs`,
  );
}

// 3) runs index
{
  const { status, body } = await json("/api/runs");
  check("GET /api/runs", status === 200 && Array.isArray(body.runs), `${body?.count ?? 0} runs`);
}

// 4) full generation over SSE
{
  const prompt =
    "یک بسته ۴ طرحی میانگین حساب برای جذب ۲۰ همت منبع با IRR حداقل ۲۶٪، سقف LDR ۸۵٪، کف LCR ۱٫۰۵ و حداکثر ریسک واژگونی ۶٪ طراحی کن";
  const res = await fetch(`${BASE}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, candidates: 8, runs: 120, withSensitivity: false }),
  });
  const text = await res.text();
  const frames = text.split("\n\n");
  const events = [];
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
    "executive report emitted",
    (metrics.reportFa?.length ?? 0) > 800,
    `${metrics.reportFa?.length ?? 0} chars`,
  );
}

// 5) verification suite endpoint
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
