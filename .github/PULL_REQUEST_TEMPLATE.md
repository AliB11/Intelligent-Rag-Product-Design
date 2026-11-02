<!--
  Persian first, English welcome. / فارسی، انگلیسی هم پذیرفته است.
-->

## What does this PR do?

<!-- یک پاراگراف: چه مشکلی را حل می‌کند؟ -->

## Which layer changed?

- [ ] Deterministic financial engine (`src/lib/domain/`) — **no LLM may compute numbers**
- [ ] Agent orchestration (`src/lib/agents/`)
- [ ] RAG / knowledge base (`src/lib/rag/`)
- [ ] API routes (`src/app/api/`)
- [ ] Frontend (`src/components/`, `src/app/page.tsx`)
- [ ] Database schema (`src/db/schema.ts`) — **schema push + migration note required**
- [ ] Tooling / docs / CI

## Financial impact

<!-- Does this change any constant, calibration or objective weight? -->

| Metric | Before | After |
| ------ | ------ | ----- |
| TC1 `IRR_bank` | | |
| TC1 `p95 LDR` | | |
| TC1 `p5 LCR` | | |
| TC2 weighted `γ` | | |
| TC2 net liquidity drain | | |

- [ ] No calibration change (`src/lib/domain/constants.ts`, `ALM_CALIBRATION` untouched)

## Verification

- [ ] `npm run lint`
- [ ] `npx next typegen`
- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] `node scripts/verify.mjs --fast`
- [ ] Determinism preserved: same prompt + same seed ⇒ identical metrics (`TC0-A`)

## Regulatory provenance

<!-- If you added/changed a CBI limit or a benchmark scheme, cite the source. -->

- [ ] N/A
- [ ] Source cited in the `citation` field

## Screenshots

<!-- Required for UI changes (RTL layout, charts, tables). -->
