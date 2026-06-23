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

`operations_test.sql` proves the directive-`05` operational-spine rules on top of
the foundation:

| Tag  | Guarantee |
|------|-----------|
| O1   | A `projekt` number is auto-allocated from the Nummernkreis |
| O2   | The `projekt` lifecycle: forward free; backward/cancel need a reason; `abgenommen` needs a date; terminal states are terminal; pause/resume |
| O3   | `gewaehrleistung.frist_ende` is computed by regime (VOB 4y / BGB 5y / override) |
| O4   | `arbeitszeit` duration is derived; an approved entry is frozen; a correction is a new linked entry |
| O5   | An Auftraggeber with open work cannot be soft-deleted; otherwise it can |
| O6   | The `bestellung` lifecycle via the generic linear guard |
| O7   | Directive-05 tables inherit tenant RLS + audit for free |
| O8   | `tenant_setting` accessors return values and defaults |

`quotation_test.sql` proves the DB-enforceable slice of directive `06` (the
deterministic arithmetic engine is application-layer per `02`, so it is not
tested here):

| Tag  | Guarantee |
|------|-----------|
| Q1   | `angebot` numbered at issue (non-gapless), then frozen |
| Q2   | The issue gate blocks an unpriced / in-review position |
| Q3   | The issue gate blocks an unresolved hard `check_result` failure |
| Q4   | Tax treatment is snapshotted at issue, immune to a later profile change |
| Q5   | `new_angebot_version` chains the document group and supersedes the prior |
| Q6   | `lv_position` match links and `rechnung_position` traceability are recorded |
| Q7   | New `06` tables inherit tenant RLS + audit |
| Q8   | `rechnung` billing path: gate + tax snapshot + e-invoice fields |

## Running

Against a **fresh** database, with libpq env vars pointing at it:

```sh
PGHOST=... PGPORT=... PGUSER=... PGDATABASE=aufmass_test tests/run.sh
```

`run.sh` applies `migrations/*.sql` in order, then runs `foundation_test.sql`,
`operations_test.sql`, and `quotation_test.sql`. Migrations create roles and
`SECURITY DEFINER` functions, so connect as a superuser or `migration_role`.

The suite was developed and verified on PostgreSQL 17. See
`notes/ops/2026-06-23-migrations-and-test-tooling.md` for why the tooling is
plain SQL + psql with no external test framework.
