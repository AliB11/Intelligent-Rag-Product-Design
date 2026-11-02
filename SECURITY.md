# Security Policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| `main`  | ✅        |

## Reporting a vulnerability

Please do **not** open a public GitHub issue for security reports.

1. Use GitHub's *Report a vulnerability* flow under **Security → Advisories**, or
2. contact a maintainer directly (see the `CODEOWNERS` entry / repository owners).

You will receive an acknowledgement within 3 working days and a status update at
least every 7 days until resolution.

## Scope

In scope:

* Anything that lets untrusted input reach `eval`, dynamic `require`, SQL text
  interpolation or the file system.
* Prompt-injection that could alter financial parameters outside the typed
  `ProductGenerationRequest` schema.
* Secrets committed to the repository or leaked into logs / SSE payloads.
* Determinism breakage: a same-seed run producing different numbers.
* SSRF via user-supplied URLs, and prototype pollution in API route handlers.

Out of scope:

* Vulnerabilities in the sandbox/preview hosting platform itself.
* Reports about the *accuracy* of regulatory calibrations — those are product
  issues, not security issues (see the disclaimer in `LICENSE`).

## Hard rules for contributors

* Never commit `.env`, credentials, API keys or real customer/bank data.
  `.env.example` documents every variable; `.gitignore` blocks the real file.
* All database access goes through Drizzle's parameter binding (`sql` template
  tags) — never string-concatenate SQL.
* The financial engine must remain free of network I/O and free of `Math.random()`.
* SSE payloads are derived from validated server state only; do not echo raw user
  input back into HTML without React escaping.

## Regulatory-data provenance

Regulatory limits seeded in `src/lib/rag/knowledgeBase.ts` are illustrative
calibrations used to drive the optimiser. Before production use, re-validate every
limit against the current directives of the Central Bank of Iran and the Money and
Credit Council, and record the source citation in the `citation` field.
