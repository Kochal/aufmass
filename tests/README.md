# tests

The foundation guarantees from directive `02` (restated in `CLAUDE.md`, "Foundation
first") have tests here *before* any feature module builds on them.

## What is proven

`foundation_test.sql` asserts each guarantee against the migrated schema. It runs
as `app_role` (via `SET ROLE`) so it exercises row-level security exactly as the
application will. Each assertion prints `ok: ...`; a failure aborts the run with a
nonzero exit (`ON_ERROR_STOP`). Reaching the final banner means everything passed.

| Tag  | Guarantee |
|------|-----------|
| G1   | A query with no `app.tenant_id` set returns nothing |
| G2   | A cross-tenant read returns empty |
| G3   | An issued `rechnung` rejects an UPDATE (the controlled `issued -> cancelled` move is still allowed) |
| G4   | A rolled-back invoice issue burns no number — gapless survives |
| G5   | A hard `DELETE` on a business table is refused; soft delete works |
| G6   | Every write lands a row in `audit_log`, and `audit_log` is append-only |
| OCC  | Optimistic concurrency: a write against a stale `row_version` affects 0 rows |
| LOCK | `edit_lock` advisory leases: acquire / block / release / auto-expire |

## Running

Against a **fresh** database, with libpq env vars pointing at it:

```sh
PGHOST=... PGPORT=... PGUSER=... PGDATABASE=aufmass_test tests/run.sh
```

`run.sh` applies `migrations/*.sql` in order, then runs `foundation_test.sql`.
Migrations create roles and `SECURITY DEFINER` functions, so connect as a
superuser or `migration_role`.

The suite was developed and verified on PostgreSQL 17. See
`notes/ops/2026-06-23-migrations-and-test-tooling.md` for why the tooling is
plain SQL + psql with no external test framework.
