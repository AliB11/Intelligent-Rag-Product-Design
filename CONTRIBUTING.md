# Contributing

Language: Persian first, English welcome. / زبان: فارسی، انگلیسی هم پذیرفته است.

Thanks for improving the **Intelligent Banking Product Generator & ALM Digital Twin
Simulator**. Please read this before opening a pull request.

## 1. The one architectural rule

> **Language models never compute financial numbers.**

Every Rial, rate, percentile and risk figure comes from the deterministic engine in
`src/lib/domain/`. Agents may only:

* parse natural-language intent into typed constraints (`src/lib/domain/intentParser.ts`),
* retrieve regulatory documents and inject binding limits (`src/lib/rag/`),
* choose objective weights (`λ₁…λ₄`) and structural archetypes,
* narrate reasoning and compile reports.

If your change lets an LLM produce a number, it will be rejected.

## 2. Determinism is a contract

* Every stochastic draw flows from a seeded PRNG (`createRng`, `seedFromString`).
* The same prompt and the same seed **must** reproduce byte-identical metrics.
  The suite enforces this in `TC0-A`.
* Never use `Math.random()` anywhere under `src/`.

## 3. Local setup

```bash
npm ci
cp .env.example .env          # then set DATABASE_URL
npm run db:push              # review and synchronise schema changes
npm run dev
```

## 4. Before you open a PR

```bash
npm run lint
npx next typegen
npm run typecheck
npm run build
node scripts/verify.mjs --fast   # or: make ci
```

All five must pass. CI runs the same sequence plus a Docker build.

## 5. Adding a new Iranian banking benchmark

1. Append an entry to `RAW` in `src/lib/rag/benchmarks.ts` with the source bank,
   contract type, ceiling, fee/profit rate, sleep period and closed-loop retention.
2. Add the corresponding regulatory constraint to `src/lib/rag/knowledgeBase.ts`
   only if it is a *rule*, not a product.
3. Re-run `node scripts/verify.mjs --fast`; the benchmark registry is asserted to
   contain more than 20 schemes.

Cite the bank and scheme name in the entry. Do not invent numbers — if a value is
unknown, leave it `null` rather than guessing.

## 6. Adding a new mode archetype

1. Add a `ArchetypeBlueprint` entry in `src/lib/domain/optimizer.ts` with
   **bounded ranges** for every parameter (`statutoryReserve`, `loanRate`,
   `sleepMonths`, `closedLoopRetention`, …).
2. Add the Persian/English labels to `src/lib/domain/guildValueChain.ts`.
3. Add at least one assertion covering it in
   `src/lib/verification/financialEngineTests.ts`.

## 7. Calibration changes

Changes to `src/lib/domain/constants.ts` or `ALM_CALIBRATION` alter every result in
the system. In the PR description, include a before/after table of the two
integration-test summaries (`TC1`, `TC2`).

## 8. Commit and PR style

* Conventional Commits: `feat(optimizer): stagger deposit sleep periods`.
* One logical change per PR; keep the diff reviewable.
* Fill in the PR template. Describe the *financial* effect, not just the code.
* UI text is Persian and RTL by default; keep numerals in `<span class="num">`.

## 9. Reporting security or regulatory issues

See [SECURITY.md](SECURITY.md). Please do not open a public issue for a
vulnerability, and never commit real customer data, bank data or credentials.
