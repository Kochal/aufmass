# 2026-06-25 — 05 API layer implementation decisions

/ area: operations / status: implemented / confidence: high /

Captures the design calls made when building the HTTP surface over the 05
operational spine. The DB layer (migrations 0008–0014) was already complete;
this note covers the application layer.

## Architecture choices

**`deps.py` for shared dependencies.** `Principal`, `get_principal`, and
`db_session` moved to `api/app/deps.py` rather than staying in `main.py`.
FastAPI routers must import `db_session` but `main.py` imports the routers —
circular if both lived in `main.py`. This is the standard FastAPI pattern.

**`dict_row` via pool `configure` callback.** `ConnectionPool` does not take
`row_factory` as a connect parameter; the correct hook is `configure=(fn)`, a
callable called on each new connection. All pooled connections now return dicts.
Side effect: `healthcheck()` updated from `fetchone() == (1,)` to
`fetchone()["alive"] == 1`.

**`Principal.user_id` typed as `UUID`.** The original stub used `str`. Changed
to `UUID` so the value can be passed as `app_user_id` FK directly (e.g.,
`arbeitszeit.app_user_id`). Audit columns still get `str(principal.user_id)`.

**Shared `db_errors()` context manager.** Catches `psycopg` SQLSTATE errors
and maps them to HTTP before they escape to FastAPI's generic error handler:
- `UniqueViolation` (23505) → 409
- `ForeignKeyViolation` (23503) → 422
- `CheckViolation` (23514) → 422
- `IntegrityConstraintViolation` (23000) / `RaiseException` (P0001) → 409,
  `detail` = `diag.message_primary` (the guard functions write human messages)

This means every trigger guard's message (missing reason, frozen entry,
delete-with-deps, terminal state, invalid transition) surfaces directly in the
HTTP response body with no additional mapping needed per entity.

**`require_row(row, conn, table, id)` for optimistic concurrency.** After a
`UPDATE … WHERE row_version=%s RETURNING *`, `fetchone()` returns `None` on
mismatch. `require_row` does a secondary SELECT (no `deleted_at is null` filter)
to discriminate 404 (absent / soft-deleted) from 409 (stale version). Called
outside `db_errors()` since it does a SELECT, not a guarded write.

**Soft-delete as inline UPDATE.** The endpoint does
`UPDATE … SET deleted_at=now(), deleted_by=core.current_actor() WHERE id=%s AND deleted_at IS NULL`
and checks `cur.rowcount`. The `core.soft_delete()` function exists but returns
void, making rowcount-based 404 detection impossible from it. For DML without
`RETURNING`, psycopg3 sets `rowcount` correctly after execution.

**`set_reason()` before the status UPDATE, outside `db_errors()`.** The
`app.reason` GUC must be set in the same transaction before the guard trigger
runs. Since `set_config(key, value, true)` is transaction-local, it is cleared
automatically when the transaction ends. `set_reason` itself cannot fail
meaningfully, so it lives outside the error-mapping context.

**Lifecycle status changes via `PATCH /{id}/status` carrying `row_version`.** 
The row_version check is included on the status patch (not just on PUT) because
a status transition is still an optimistic-concurrent write — two concurrent
transitions on the same projekt would otherwise collide silently.

**Korrektur inherits `app_user_id` from the source row.** When creating a
correction for a frozen `arbeitszeit` (or `fahrt`), the new row uses the
original row's `app_user_id`, not the current principal's user_id. The corrected
hours stay attributed to the employee; the audit `created_by` column records who
made the correction (the principal via the `aaa_set_audit_cols` trigger).

**`timedelta` serialises as ISO 8601 duration in Pydantic v2.** The `dauer`
generated column (interval in Postgres → timedelta in psycopg3) becomes
`"PT7H30M"` in JSON, not total seconds. Tests check the exact string.

## Test approach

All 13 pytest tests run against the real compose Postgres (not mocks) using the
seeded dev tenants via `X-Tenant-Id`/`X-User-Id` headers. FastAPI `TestClient`
wraps the full `app` including lifespan (pool open/close). `scope="session"` so
the pool is shared across tests. Tests write their own data and do not clean up —
the DB accumulates test rows but this is fine for dev.

## Seed design

Two tenants with fixed UUIDs (T1 for use, T2 for RLS isolation testing). The
seed runs from the migrate container (superuser URL) after migrations, idempotent
via `ON CONFLICT DO NOTHING`. The `migrate` image must be rebuilt separately from
`api` because it lacks the `./api:/app` volume mount that gives the api container
live code.

## gen:api URL

`web/package.json gen:api` was `http://localhost:8000/openapi.json` — this fails
inside the web container where `localhost` is the container itself. Changed to
`http://api:8000/openapi.json` (docker compose network service name).
