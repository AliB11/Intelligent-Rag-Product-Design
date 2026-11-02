# Environment configuration

Copy `.env.example` to `.env` and adjust. **Never commit `.env`.** The example lists variables that the current application or Docker Compose actually reads; the browser calls same-origin relative API routes, so it does not need a separate API base URL.

| Variable | Required | Default | Used by |
| --- | --- | --- | --- |
| `DATABASE_URL` | No for generation; yes for PostgreSQL persistence | Unset in the app (repository stays in-memory; the low-level client/Drizzle CLI fallback points to `127.0.0.1:5432/app_db`) | Drizzle client (`src/db/index.ts`), repository, and `drizzle-kit` |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` / `POSTGRES_PORT` | — | `postgres` / `postgres` / `app_db` / `5432` | PostgreSQL service in `docker-compose.yml` |
| `APP_PORT` | — | `3000` | Host port published by Docker Compose |
| `BASE_URL` | — | `http://127.0.0.1:3000` | `scripts/smoke.mjs` only |

The default ALM horizon and Monte Carlo count are defined in
`src/lib/domain/constants.ts`. Monte Carlo runs, optimizer candidates, critic
iterations and sensitivity are request-level controls. The API rejects an
out-of-range or non-integer run count; it never silently substitutes a lower
count for the final base-case ALM evaluation. The optimizer's low-fidelity
candidate screening and the separate severe-run diagnostic are auxiliary
non-final evaluations and are not presented as the requested final run.

## Reserved integrations

The following are not consumed by the current Next.js request path. They are
listed here only to distinguish planned integrations from active configuration:

| Planned integration | Reserved variables |
| --- | --- |
| Python worker / external job queue | `REDIS_URL`, `CELERY_BROKER_URL`, `CELERY_RESULT_BACKEND` |
| External vector store | `CHROMA_HOST`, `CHROMA_PORT`, `CHROMA_COLLECTION`, `PGVECTOR_TABLE`, `EMBEDDING_DIM` |
| External reasoning/checkpoint provider | `OPENAI_API_KEY`, `OPENAI_MODEL`, `LANGGRAPH_CHECKPOINT_TABLE` |
| Environment-specific CBI calibration | `CBI_INTERBANK_RATE`, `CBI_HURDLE_MARGIN`, `CBI_TREASURY_RATE`, `CBI_QH_MAX_COMMISSION`, `CBI_MORABAHA_MAX_RATE` (the current engine uses constants in source instead) |

Server-only secrets must never be prefixed with `NEXT_PUBLIC_`; only
`NEXT_PUBLIC_*` values reach the browser bundle. The current client uses relative
routes and should not be configured with a browser-facing `localhost` URL.

## Database schema

Run `npm run db:push` against a disposable/local database first and review
Drizzle's proposed changes. No `--force` flag is used. For production, apply
schema changes through your reviewed database-change process and take a backup
before changing existing data. In Compose, start the stack and then run:

```sh
docker compose --profile tools run --rm db-push
```

If PostgreSQL is unavailable, the generation engine continues with its local
in-memory corpus; run history and PostgreSQL persistence will not be available.
The bootstrap trace reports which corpus mode is active.

## Rotating credentials

1. Update the value in your secret manager / hosting provider.
2. Restart the app (`docker compose up -d --force-recreate app`).
3. Confirm with `curl "$BASE_URL/api/health"`.

If a credential was committed by accident, rotate it immediately and purge the
blob from history (`git filter-repo`) — a rotation alone does not remove it.
