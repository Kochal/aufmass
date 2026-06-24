# 2026-06-24 — Dev stack scaffold (api / web / validator / stubs)

/ area: ops / status: scaffolded; DB layer verified on PG17; Compose not yet run on a Docker host /

## What was built

The four services directive `10` describes now exist as buildable skeletons, so
`docker compose up` is the intended entry point:

- `api/` — Python 3.12 / FastAPI. `app/config.py` (env settings), `app/db.py`
  (psycopg pool + the per-request RLS session context), `app/migrate.py` (the
  migration runner), `app/main.py` (lifespan, `/health`, the `db_session`
  dependency, one example tenant-scoped endpoint). Dockerfile installs
  `postgresql-client` (the runner uses `psql`).
- `web/` — Vite + React + TypeScript PWA (`vite-plugin-pwa`), a health screen
  hitting the API, and a `gen:api` script (openapi-typescript) for the generated
  client.
- `stubs/` — a tiny FastAPI serving `/model` and `/m365` fakes.
- `validator/` — a best-effort, pinned Dockerfile for the KoSIT validator;
  flagged as needing verification on a Docker host (see `validator/README.md`).
- Root `.gitignore` (incl. `/data/`), root `README.md`, updated
  `docker-compose.yml`.

## Decisions settled here (directive 10 left them open)

- **Migration runner = thin wrapper over the plain SQL, not an ORM framework.**
  `app/migrate.py` tracks applied files in `schema_migrations` and applies the
  pending ones with `psql --single-transaction`. Reusing `psql` sidesteps the
  real problem with parsing the migrations ourselves: the dollar-quoted function
  bodies (`$$...$$`) make naive `;`-splitting wrong. This honours the prior
  decision to keep migrations framework-agnostic
  ([[2026-06-23-migrations-and-test-tooling]]). Resolves directive 10 open
  question 1 (one-shot `migrate` service).
- **Two DB roles in dev, by necessity.** The migrations create `app_role` as
  NOLOGIN/NOBYPASSRLS, so they must run as a superuser/`migration_role`. But if
  the *app* also connected as that superuser, RLS would be silently bypassed and
  directive 10's "full RLS in dev" would be a lie. So: the `migrate` step runs as
  superuser and, in `ENV=dev` only, bootstraps a non-superuser `app` login role
  (member of `app_role`); the `api` connects as `app`. Login-role creation stays
  out of the migrations (it is a deployment/runbook concern, `09`); dev gets it
  via the migrate step so "clone, up, working" holds with real isolation.
- **RLS session context = transaction-local set_config.** `tenant_connection`
  opens one transaction per request and sets `app.tenant_id`/`app.user_id` with
  `set_config(key, value, is_local => true)`. Transaction-local means the
  setting dies with the transaction, so a pooled connection cannot leak one
  request's tenant into the next — no custom pool reset needed.
- **Stubs = a small shared service**, not per-test fakes (directive 10 open
  question 2). One `stubs` container fakes the model server and M365 so the app
  runs with zero real credentials.
- **Auth is a dev header stub.** `get_principal` reads `X-Tenant-Id`/`X-User-Id`
  in dev only, and refuses (501) otherwise. Real auth is `09`; this just lets the
  RLS plumbing be exercised end to end now.
- **React specifics:** plain Vite + React + TS + `vite-plugin-pwa`, generated
  client via openapi-typescript. No router/state library committed yet — add when
  the first real screen needs it, not preemptively.

## What was verified, and what was not

Verified against a throwaway **PostgreSQL 17** cluster with the real
`app/migrate.py` and psycopg:

- Fresh apply of all 20 migrations; a second run reports "up to date" (idempotent
  via `schema_migrations`); the dev-role bootstrap is idempotent (create then
  alter path).
- The `app` role is `rolsuper=f`, `rolbypassrls=f`, can log in, and is a member
  of `app_role`.
- RLS binds **as the `app` role**: no tenant set → 0 rows; tenant=T1 → only T1's
  row; T1 cannot see T2's row. The directive-10 footgun is avoided.
- No tenant leak across pooled connection reuse: on one physical connection,
  three sequential transactions (T1, T2, none) each saw only their own data and
  the no-tenant one saw nothing — validating the transaction-local approach.

**Not** verified (no Docker host here, and compute is meant to be remote per
`03`): the Docker image builds, `docker compose up` end to end, HMR/PWA in the
browser, and — most importantly — the **KoSIT validator** image (artifact URLs,
daemon HTTP interface, and the `/health` path the Compose healthcheck assumes).
That is the one piece to confirm first on a real Docker host; details and the
checklist are in `validator/README.md`.

## A bug found and fixed during verification

The first cut bootstrapped the dev role with a parameterized `DO $$ ... $$`
block; Postgres can't bind parameters into a DO block (`IndeterminateDatatype`).
Fixed by composing the identifier/literal with `psycopg.sql` and an explicit
existence check instead.

Related: [[2026-06-23-application-stack]] (why this stack),
[[2026-06-23-migrations-and-test-tooling]] (why plain SQL + psql).
