# Environment variables

Copy `.env.example` to `.env` and adjust. **Never commit `.env`.**

| Variable | Required | Default | Used by |
| --- | --- | --- | --- |
| `DATABASE_URL` | ✅ | `postgresql://postgres:postgres@127.0.0.1:5432/app_db` | Drizzle client (`src/db/index.ts`), route handlers, repository |
| `ALM_HORIZON_MONTHS` | — | `60` | documents/deploy defaults only (the pipeline passes the horizon per request) |
| `MONTE_CARLO_RUNS` | — | `1000` | documents/deploy defaults only |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` / `POSTGRES_PORT` | — | `postgres` / `postgres` / `app_db` / `5432` | `docker-compose.yml` |
| `APP_PORT` | — | `3000` | `docker-compose.yml` host port |
| `BASE_URL` | — | `http://127.0.0.1:3000` | `scripts/smoke.mjs` |

Reserved for a future Python worker / external embedding provider (not required by
the current code path):

| Variable | Notes |
| --- | --- |
| `REDIS_URL`, `CELERY_BROKER_URL`, `CELERY_RESULT_BACKEND` | heavy Monte Carlo queue |
| `CHROMA_HOST`, `CHROMA_PORT`, `CHROMA_COLLECTION` | external vector store |
| `PGVECTOR_TABLE`, `EMBEDDING_DIM` | PGVector mirror |
| `OPENAI_API_KEY`, `OPENAI_MODEL`, `LANGGRAPH_CHECKPOINT_TABLE` | LLM reasoning text only — never financial numbers |

Server-only secrets must never be prefixed with `NEXT_PUBLIC_`; only
`NEXT_PUBLIC_*` values reach the browser bundle.

## Rotating credentials

1. Update the value in your secret manager / hosting provider.
2. Restart the app (`docker compose up -d --force-recreate app`).
3. Confirm with `curl $BASE_URL/api/health`.

If a credential was committed by accident, rotate it immediately and purge the
blob from history (`git filter-repo`) — a rotation alone does not remove it.
