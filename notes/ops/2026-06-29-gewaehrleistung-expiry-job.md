---
date: 2026-06-29
area: ops
---

# Gewährleistung auto-expiry background job

## What was built

**`migrations/0023_expire_gewaehrleistung.sql`**: Adds `core.expire_gewaehrleistung()`
— a `SECURITY DEFINER` function that flips `status = 'laufend'` rows to
`'abgelaufen'` when `frist_ende < current_date`.

**`api/app/jobs.py`**: `expire_gewaehrleistung_loop()` — async coroutine that runs
the function via `asyncio.to_thread` at startup and then every 24 hours.

**`api/app/main.py`**: Wired into the FastAPI lifespan as an `asyncio.create_task`.
The task is cancelled and awaited cleanly on shutdown.

## Why SECURITY DEFINER

The app connects as `app_role` which has `nobypassrls` and is bound by
`FORCE ROW LEVEL SECURITY` on all business tables. The RLS policy uses
`core.current_tenant()` — which returns NULL when `app.tenant_id` is not set —
meaning a connection without a tenant context sees zero rows.

A background job has no request context, so it can't use `tenant_connection()`.
Options considered:

1. **Iterate over tenants from Python** — requires a separate superuser connection
   to read `tenant` table (also RLS-protected), then N round-trips. Complex.
2. **`SECURITY DEFINER` function** owned by the migration role (`maler`,
   POSTGRES_USER = superuser) — runs with superuser privilege at call time,
   bypassing FORCE RLS. One round-trip for all tenants. Clean.
3. **Separate superuser connection pool** — would require exposing the superuser
   password to the app layer. Against the spirit of the role separation in `0001`.

Option 2 is the right call: the DB owns the expiry logic, the privilege boundary
is narrow and explicit (just this one function), and adding new system jobs later
follows the same pattern.

## Audit trail

The audit trigger (`zzz_audit` on gewaehrleistung) reads `tenant_id` from
`new` (the updated row) — line 64 of `0002_audit_log.sql`. So even though
`app.tenant_id` is not set in the session, `audit_log.tenant_id` is always
populated correctly from the row data.

`updated_by` (and `audit_log.actor`) comes from `core.current_actor()`, which
returns `app.user_id` if set, otherwise `session_user`. The function calls
`set_config('app.user_id', 'system:expire_gewaehrleistung', true)` before the
UPDATE, so the audit trail clearly identifies the system job as the actor.

## Search path pinning

The function uses `SET search_path = public, core` (a PostgreSQL SECURITY DEFINER
best practice) to prevent search path injection if an attacker could create
objects in a schema that appears earlier in the default path.

## Future notification hook point

When the user wants email/UI notifications for expired Gewährleistung entries,
the natural insertion point is inside the function body, after the UPDATE:

```sql
-- Collect affected rows before they change status:
for v_row in
  select id, tenant_id, projekt_id, frist_ende
  from gewaehrleistung
  where status = 'laufend'
    and frist_ende < current_date
    and deleted_at is null
loop
  -- INSERT into a notifications table, or call pg_notify, etc.
  ...
end loop;
-- Then do the UPDATE
```

Or equivalently, move the SELECT into a CTE with RETURNING to capture affected IDs
after the UPDATE. Either approach keeps the hook in the same DB transaction as
the status flip, so notifications and expiry are atomic.

## Job schedule

The job runs once at startup (to catch any entries that expired while the server
was down), then sleeps 24 hours. Since `frist_ende` is a date (not a timestamp),
once-a-day resolution is sufficient — a warranty doesn't expire to the minute.

If 24-hour drift is ever a concern (server restarted late in the day), the job
could be changed to run at a fixed wall-clock time using APScheduler or a Postgres
`pg_cron` job. For now, the simple sleep loop is sufficient and adds no dependency.
