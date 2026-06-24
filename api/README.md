# api — Python / FastAPI backend

The backend and all deterministic engines (directive `10`). Owns money- and
measurement-math (with Postgres), the orchestration glue to the model endpoints
(`03`) and the validator sidecar (`06`), and the per-request RLS session context.

## Layout

| File | Role |
|------|------|
| `app/config.py` | Settings from the environment (DB URL, sidecar URLs, ENV). |
| `app/db.py` | psycopg connection pool + `tenant_connection()`, the per-request RLS session context. |
| `app/migrate.py` | The migration runner (`python -m app.migrate`). |
| `app/main.py` | FastAPI app: lifespan, `/health`, the `db_session` dependency, an example tenant-scoped endpoint. |

## The two things that must not break (directive 10)

1. **RLS session context.** Every request runs in one transaction that sets
   `app.tenant_id` / `app.user_id` with `set_config(..., is_local => true)`
   (transaction-local `SET LOCAL`). Because it is transaction-scoped, a pooled
   connection cannot carry one request's tenant into the next — verified by a
   leak test. The app connects as the **non-superuser `app` role** (member of
   `app_role`); a superuser/BYPASSRLS connection would silently defeat tenant
   isolation.
2. **Money is Decimal + Postgres.** No float money anywhere; psycopg maps
   `numeric` to `Decimal`. The frontend never computes a money value.

## Migrations

`python -m app.migrate` applies `migrations/*.sql` (repo root, mounted at
`/migrations` in dev) in order, exactly once each, tracked in `schema_migrations`,
using `psql --single-transaction` per file. It runs as a superuser /
`migration_role` (the migrations create roles + `SECURITY DEFINER` functions),
and in `ENV=dev` it then bootstraps the non-superuser `app` login role. This is a
deliberate thin wrapper over the plain-SQL migrations, not an ORM framework
(see `notes/ops/2026-06-23-migrations-and-test-tooling.md`).

## Auth is a stub

`get_principal` reads `X-Tenant-Id` / `X-User-Id` headers **in dev only** so the
RLS plumbing can be exercised before real authentication lands. Real auth
(session / OIDC, field-worker auth) is directive `09`; outside dev the stub
refuses with 501.
