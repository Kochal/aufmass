# 2026-06-23 — Implementing the `02` cross-cutting foundation

/ area: schema / status: implemented, migrations 0001–0007 / confidence: high on
mechanics, medium on a few choices flagged below for the firm's review /

This note records the decisions and assumptions made turning directive `02`'s
patterns into migrations. The directive states *what is true*; this is *why* the
implementation looks the way it does. Where `02` was silent I chose, and say so.

## The shape that emerged

One registration call installs every cross-cutting pattern on a table:

```sql
select core.add_standard_columns('mytable');
select core.register_business_table('mytable'[, p_tenant_col, p_financial, p_hard_delete_ok]);
```

`register_business_table` enables+forces RLS with a tenant-isolation policy,
attaches the audit trigger, the bookkeeping/`row_version` trigger, the
no-hard-delete guard, and (for financial docs) the freeze-on-issue guard, then
sets grants. This is the literal expression of "pinned here so it is not
reinvented per table". Every future table inherits the guarantees by calling it.

## Decisions / assumptions, with reasoning

1. **`FORCE ROW LEVEL SECURITY`, not just `ENABLE`.** `02` shows `ENABLE`. But a
   table *owner* bypasses RLS unless it is forced, and `SECURITY DEFINER`
   helpers run as the owner. Forcing it means the policy binds everyone except
   roles with the `BYPASSRLS` attribute (migration/retention). Without this the
   "no tenant set sees nothing" guarantee is false for the owner. **This is a
   strengthening of `02`, not a deviation from intent.**

2. **`current_tenant()` uses `current_setting('app.tenant_id', true)`** (missing
   ok = true) returning NULL when unset. `02`'s sketch used the throwing form;
   the throwing form makes "no tenant set" an *error*, not the *empty result*
   the guarantee requires. NULL → `tenant_id = NULL` → no rows. Same for the
   `app.user_id` / `app.reason` reads.

3. **Roles.** `app_role` (RLS-bound, no DELETE on business tables),
   `migration_role` (owner, BYPASSRLS), `retention_role` (BYPASSRLS, the only
   role the no-hard-delete guard lets through). The app connects as a login role
   that is a member of `app_role`; that login role must not be superuser/owner.

4. **`created_by` / `updated_by` / `audit_log.actor` are `text`, not a uuid FK.**
   `02` describes the actor as "app_user id **or job name**", which is not always
   a uuid (retention/import jobs). Text keeps the audit path generic and matches
   the actor concept. The value comes from `app.user_id` (or the session role).

5. **`row_version` is auto-incremented by the trigger; the conflict *check* is
   the caller's `WHERE row_version = <read>`.** A DB-enforced "client must send
   the prior version" is clumsy generically. Auto-increment + the conditional
   WHERE gives the optimistic-concurrency guarantee (a stale write hits 0 rows),
   which the test demonstrates. The app must include the WHERE clause; this is a
   contract the data layer has to honor.

6. **`rechnung` and `auftraggeber` are in the foundation.** `CLAUDE.md` says not
   to build feature tables first — but the guarantees are *stated in terms of*
   an issued Rechnung and a business table, and the freeze/numbering patterns are
   meaningless without a concrete financial document to attach to. So a **minimal**
   `rechnung` (status, number, version chain, the standard columns) and a minimal
   `auftraggeber` exist here to carry and prove the patterns. The full `rechnung`
   (positions, tax snapshot, e-invoice artifacts) is built in `06`; `projekt_id`
   is an unconstrained uuid until the `projekt` table exists.

7. **`nummernkreis.current_period`** (text) added beyond `02`'s listed columns,
   to detect a yearly/monthly boundary and reset the counter. `start_offset` is
   applied as the **initial value of `counter`** at setup (carryover = "last
   number used by prior software"); the allocator just does `counter + 1`. The
   counter UPDATE rides the audit trigger, so allocations are audited as `02`
   requires. Format tokens implemented: `{YYYY} {YY} {MM} {SEQ} {SEQ:n}`.

8. **`edit_lock` is registered with `p_hard_delete_ok => true`.** It is ephemeral
   operational state (release/expiry are real deletes), not a GoBD business
   record, so the no-hard-delete guard would be wrong. It still gets RLS + audit,
   so lock churn and admin overrides are logged ("Overrides are audited").

9. **Freeze rule details.** Drafts are fully mutable (incl. the draft→issued
   transition). Once `issued`, the only allowed UPDATE is a status move to
   `cancelled`/`superseded` with no other column change (enforced by a
   `to_jsonb(OLD) - <bookkeeping keys>` vs NEW comparison). Once
   cancelled/superseded, fully frozen. Hard DELETE of any non-draft is rejected
   by the freeze guard; drafts fall through to the no-hard-delete guard.

## For the firm's review (not decided by us)

- The exact set of **gapless** doc types and **reset policy** per type is a tax
  matter — `02` marks Rechnung gapless; confirm with the Steuerberater before
  real invoices issue (`CLAUDE.md`, "When you do not know something").
- Number **format templates** per tenant are config, seeded per firm at
  onboarding; the carryover `start_offset` must match the prior software's last
  number exactly.

## Not yet built (same pattern applies when they land)

`tenant_tax_profile`, `tenant_setting`, and every `05`/`06`/`07` business table:
add columns, then `register_business_table`. They inherit all six guarantees for
free. See [[2026-06-23-migrations-and-test-tooling]] for how to run the suite.
