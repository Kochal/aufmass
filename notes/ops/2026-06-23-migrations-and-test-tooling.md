# 2026-06-23 — Migration and test tooling for the foundation

/ area: ops / status: decided for the foundation, revisit when the app stack lands /

## Decision

The `02` cross-cutting foundation is delivered as **plain numbered SQL migration
files** (`migrations/0001_*.sql` … `0007_*.sql`), applied in lexical order, and a
**plain psql test script** (`tests/foundation_test.sql`) driven by a small shell
runner (`tests/run.sh`). No migration framework, no test framework.

## Why

- **No app language/framework is decided yet** (`CLAUDE.md`, "Not yet decided").
  Picking Flyway / Alembic / sqitch / pgTAP now would pre-commit a stack choice
  that belongs to a later, deliberate decision. Raw SQL keeps the foundation
  framework-agnostic: whatever migration tool we adopt can adopt these files
  (they are ordinary forward-only SQL).
- **Zero dependencies.** The test harness is a `_t_assert(bool, text)` function
  plus `psql -v ON_ERROR_STOP=1`. It needs nothing installed on the DB server
  (no pgTAP extension), which matters for the self-hosted German box (`03`).
- **The guarantees are database guarantees.** RLS, triggers, the gapless
  allocator, and the freeze rule are all enforced *in Postgres*. Testing them
  from SQL, as the role the app uses (`SET ROLE app_role`), tests the real thing
  rather than an application-layer reimplementation.

## How it is verified

Run `tests/run.sh` against a fresh DB. Every assertion prints `ok: …`; a failed
assertion raises and `ON_ERROR_STOP` returns a nonzero exit, so CI catches it.

Verified locally on **PostgreSQL 17** (a throwaway cluster, separate from any
real data): the full suite passes (exit 0); a deliberately false assertion aborts
with a nonzero exit (the harness has teeth); and dropping the freeze trigger lets
an issued-document UPDATE through (1 row), confirming G3's pass is attributable to
the trigger, not a vacuous test.

## What would change this

When the application stack is chosen (`notes/ops/`), we likely wrap these files
in that ecosystem's migration runner and may add a thin per-language test layer
*on top of* — not replacing — these SQL guarantee tests. If point-in-time price
reads or heavier fixtures appear, pgTAP becomes worth its dependency.

## Operational notes

- Migrations must run as superuser or `migration_role` (they `CREATE ROLE` and
  install `SECURITY DEFINER` functions).
- The app must connect as a login role that is a member of `app_role` and is
  **not** a superuser, table owner, or `BYPASSRLS` — otherwise RLS is bypassed.
  This is the one footgun; it belongs in the deployment/runbook.

Related: [[2026-06-23-cross-cutting-foundation]].
