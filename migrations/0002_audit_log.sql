-- 0002_audit_log.sql
-- Cross-cutting foundation, part 2: the append-only audit trail.
--
-- Directive 02 (Audit): "A single audit_log table, written by an AFTER
-- INSERT/UPDATE/DELETE trigger installed on every business table. Not writable
-- by the application. audit_log has no UPDATE/DELETE grants for any role; it
-- only grows."
--
-- The trigger function is SECURITY DEFINER so it can write audit_log even
-- though the application role has no INSERT grant on it: the trigger is the
-- only writer.

create table audit_log (
  id          bigint generated always as identity primary key,
  tenant_id   uuid        not null,
  table_name  text        not null,
  row_id      uuid        not null,
  op          char(1)     not null check (op in ('I','U','D')),  -- Insert/Update/Delete
  old_row     jsonb,
  new_row     jsonb,
  actor       text        not null,            -- app_user id or job name
  reason      text,                            -- app.reason, set for status changes
  at          timestamptz not null default now()
);

create index audit_log_tenant_idx on audit_log (tenant_id, at);
create index audit_log_row_idx    on audit_log (table_name, row_id);

-- Reads are tenant-isolated; the app may SELECT its own tenant's trail only.
-- No INSERT/UPDATE/DELETE grant: append happens solely via the definer trigger.
alter table audit_log enable row level security;
create policy audit_tenant_read on audit_log
  for select
  using (tenant_id = core.current_tenant());

revoke all on audit_log from public;
grant select on audit_log to app_role;

-- The trigger. Captures the actor and (optional) reason from session settings,
-- and derives tenant_id / row_id generically: the tenant column name is passed
-- as a trigger argument ('tenant_id' for most tables, 'id' for the tenant table
-- itself), and every business table has a uuid `id` primary key.
create or replace function core.audit_row() returns trigger
  language plpgsql
  security definer
  set search_path = pg_catalog, public
as $$
declare
  v_tenant_col text := tg_argv[0];
  v_old jsonb;
  v_new jsonb;
  v_op  char(1);
begin
  if tg_op = 'INSERT' then
    v_op := 'I'; v_new := to_jsonb(new); v_old := null;
  elsif tg_op = 'UPDATE' then
    v_op := 'U'; v_new := to_jsonb(new); v_old := to_jsonb(old);
  else
    v_op := 'D'; v_new := null; v_old := to_jsonb(old);
  end if;

  insert into audit_log (tenant_id, table_name, row_id, op, old_row, new_row, actor, reason)
  values (
    (coalesce(v_new, v_old) ->> v_tenant_col)::uuid,
    tg_table_name,
    (coalesce(v_new, v_old) ->> 'id')::uuid,
    v_op, v_old, v_new,
    core.current_actor(),
    nullif(current_setting('app.reason', true), '')
  );

  return null;  -- AFTER trigger: return value is ignored
end $$;
