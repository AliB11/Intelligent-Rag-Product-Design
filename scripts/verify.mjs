#!/usr/bin/env node
/**
 * scripts/verify.mjs — one-command runner for the deterministic financial-engine
 * verification suite (the Pytest twin of tests/test_financial_engine.py).
 *
 *   node scripts/verify.mjs            # full suite (1,000 Monte Carlo paths)
 *   node scripts/verify.mjs --fast     # reduced paths, CI-friendly
 *
 * The suite is pure mathematics (no database, no network), so it compiles the
 * engine into a throwaway directory and executes it directly.
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, ".verify-build");
const fast = process.argv.includes("--fast");

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const tscArgs = [
  "tsc",
  "src/lib/verification/financialEngineTests.ts",
  "--rootDir",
  "src",
  "--outDir",
  outDir,
  "--module",
  "commonjs",
  "--target",
  "es2022",
  "--moduleResolution",
  "node",
  "--esModuleInterop",
  "--skipLibCheck",
  "--strict",
];

const compiled = path.join(outDir, "lib/verification/financialEngineTests.js");
if (fs.existsSync(compiled)) fs.rmSync(compiled, { force: true });

const tsc = spawnSync("npx", tscArgs, { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
if (tsc.status !== 0) {
  console.error("\nVERIFY FAILED — the engine did not type-check.");
  process.exit(tsc.status ?? 1);
}
if (!fs.existsSync(compiled)) {
  console.error(`\nVERIFY FAILED — expected compiled output at ${compiled}`);
  process.exit(1);
}

const { runVerificationSuite } = await import(
  `file://${compiled.replace(/\\/g, "/")}${process.platform === "win32" ? "" : ""}`
);

const result = await runVerificationSuite(fast);

const pad = (label, width = 74) => `${label} `.padEnd(width, "=");
for (const testCase of result.cases) {
  console.log(`\n${pad(` ${testCase.id} :: ${testCase.titleEn} `)}`);
  console.log(`  ${testCase.titleFa}  (${testCase.durationMs} ms)`);
  for (const a of testCase.assertions) {
    console.log(
      `  ${a.passed ? "PASS" : "FAIL"} [${a.id}] ${a.descriptionEn}\n` +
        `       expected ${a.expected} — got ${a.actual}`,
    );
  }
  console.log(`  summary: ${JSON.stringify(testCase.summary)}`);
}

const failing = result.cases.flatMap((c) =>
  c.assertions.filter((a) => !a.passed).map((a) => `${c.id}/${a.id}`),
);

console.log(
  `\n${pad(` SUITE ${result.passed ? "PASSED" : "FAILED"} `, "=")}\n` +
    `  ${result.passedAssertions}/${result.totalAssertions} assertions in ${result.durationMs} ms` +
    (failing.length ? `\n  failing: ${failing.join(", ")}` : "") +
    `\n  ran at ${result.ranAt}\n`,
);

fs.rmSync(outDir, { recursive: true, force: true });
process.exit(result.passed ? 0 : 1);
