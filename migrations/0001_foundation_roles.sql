-- 0001_foundation_roles.sql
-- Cross-cutting foundation, part 1: extensions, roles, and the two helper
-- functions every RLS policy and audit row depends on.
--
-- Implements the role model from directive 02 (Tenancy; soft-delete and
-- physical deletion): an RLS-bound application role, a privileged migration
-- role, and a restricted retention role that is the only one allowed to
-- physically delete business rows.
--
-- Run these migrations as a superuser or as migration_role. The application
-- connects as a *login* role that is a member of app_role (or SETs ROLE to it)
-- and must NOT be a superuser or a table owner, or RLS would be bypassed.

create extension if not exists pgcrypto;   -- gen_random_uuid(); harmless on PG13+

-- Application role: the effective role every app connection runs under.
-- RLS-enforced (no BYPASSRLS). DELETE on business tables is never granted to it.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_role') then
    create role app_role nologin nobypassrls;
  end if;
end $$;

-- Migration/owner role: owns the schema objects and may bypass RLS for DDL and
-- maintenance. The migrations run as (or as a member of) this role.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'migration_role') then
    create role migration_role nologin bypassrls;
  end if;
end $$;

-- Retention role: the ONLY role permitted to physically delete business rows,
-- and only via the retention job (directive 04). Bypasses RLS for the
-- cross-tenant retention sweep.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'retention_role') then
    create role retention_role nologin bypassrls;
  end if;
end $$;

-- Cross-cutting machinery lives in its own schema so it is clearly not domain.
create schema if not exists core;
grant usage on schema core to public;   -- policies/defaults call core.* functions

-- The tenant for the current connection. NULL when app.tenant_id is unset, so a
-- query with no tenant set returns no rows rather than erroring (directive 02,
-- Tenancy: "a query with no app.tenant_id set sees nothing"). The application
-- sets app.tenant_id per connection after authenticating; it is never taken
-- from client-supplied query data.
create or replace function core.current_tenant() returns uuid
  language sql stable as $$
  select nullif(current_setting('app.tenant_id', true), '')::uuid
$$;

-- The acting principal recorded in created_by/updated_by and audit_log.actor.
-- app.user_id when set (an app_user id or a job name); otherwise the db session
-- role, so the column is never null even for ad-hoc maintenance.
create or replace function core.current_actor() returns text
  language sql stable as $$
  select coalesce(nullif(current_setting('app.user_id', true), ''), session_user)
$$;
