-- 0003_cross_cutting_patterns.sql
-- Cross-cutting foundation, part 3: the reusable mechanisms and the single
-- procedure that installs all of them on a table. Directive 02 pins each
-- mechanism here once so it is "not reinvented per table".
--
-- A table becomes a fully-governed business table with one call:
--   select core.add_standard_columns('mytable');
--   select core.register_business_table('mytable');
-- which gives it: tenant RLS, the audit trigger, the bookkeeping/row_version
-- trigger, the no-hard-delete guard, and (for financial documents) the
-- freeze-on-issue guard.

------------------------------------------------------------------------------
-- Standard columns present on every business row (directive 02, Conventions).
------------------------------------------------------------------------------
create or replace function core.add_standard_columns(p_table regclass) returns void
  language plpgsql as $$
begin
  execute format($f$
    alter table %s
      add column if not exists created_at  timestamptz not null default now(),
      add column if not exists created_by  text        not null default core.current_actor(),
      add column if not exists updated_at  timestamptz not null default now(),
      add column if not exists updated_by  text        not null default core.current_actor(),
      add column if not exists row_version integer     not null default 1,
      add column if not exists deleted_at  timestamptz,
      add column if not exists deleted_by  text
  $f$, p_table);
end $$;

------------------------------------------------------------------------------
-- Bookkeeping + optimistic concurrency. BEFORE INSERT/UPDATE.
-- Stamps created/updated columns and makes row_version strictly monotonic. The
-- optimistic-concurrency *check* is the caller's `WHERE row_version = <read>`:
-- because this trigger always increments, a write against a stale version
-- matches zero rows. (directive 02, Optimistic concurrency.)
------------------------------------------------------------------------------
create or replace function core.set_audit_cols() returns trigger
  language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.created_at  := coalesce(new.created_at, now());
    new.created_by  := coalesce(new.created_by, core.current_actor());
    new.updated_at  := now();
    new.updated_by  := core.current_actor();
    new.row_version := 1;
  else  -- UPDATE
    new.created_at  := old.created_at;     -- immutable once set
    new.created_by  := old.created_by;
    new.updated_at  := now();
    new.updated_by  := core.current_actor();
    new.row_version := old.row_version + 1;
  end if;
  return new;
end $$;

------------------------------------------------------------------------------
-- Immutability of issued financial documents. BEFORE UPDATE/DELETE.
-- Drafts are mutable. Once issued, the only permitted change is the controlled
-- status move issued -> cancelled / superseded, and nothing else on the row may
-- change. Once cancelled/superseded the row is fully frozen. (directive 02,
-- Immutability of issued financial documents.)
------------------------------------------------------------------------------
create or replace function core.freeze_document() returns trigger
  language plpgsql as $$
declare
  v_old jsonb;
  v_new jsonb;
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'document % is "%" and cannot be deleted', old.id, old.status
        using errcode = 'integrity_constraint_violation';
    end if;
    return old;  -- a draft delete still has to pass the no-hard-delete guard
  end if;

  -- UPDATE from here.
  if old.status = 'draft' then
    return new;  -- drafts (including the draft -> issued transition) are mutable
  end if;

  if old.status in ('cancelled','superseded') then
    raise exception 'document % is "%" and is frozen', old.id, old.status
      using errcode = 'integrity_constraint_violation';
  end if;

  -- old.status = 'issued': only a status move to cancelled/superseded is allowed.
  if new.status not in ('cancelled','superseded') then
    raise exception 'issued document % is immutable (only cancel/supersede allowed)', old.id
      using errcode = 'integrity_constraint_violation';
  end if;

  -- ...and that move may not smuggle in any content change.
  v_old := to_jsonb(old) - 'status' - 'updated_at' - 'updated_by' - 'row_version'
                         - 'supersedes_id' - 'deleted_at' - 'deleted_by';
  v_new := to_jsonb(new) - 'status' - 'updated_at' - 'updated_by' - 'row_version'
                         - 'supersedes_id' - 'deleted_at' - 'deleted_by';
  if v_old is distinct from v_new then
    raise exception 'issued document % may only change status, not its content', old.id
      using errcode = 'integrity_constraint_violation';
  end if;

  return new;
end $$;

------------------------------------------------------------------------------
-- No hard deletes. BEFORE DELETE.
-- Defence-in-depth alongside the revoked DELETE grant: physical removal is only
-- ever done by the retention role via the retention job (directive 04).
------------------------------------------------------------------------------
create or replace function core.forbid_hard_delete() returns trigger
  language plpgsql as $$
begin
  if pg_has_role(current_user, 'retention_role', 'MEMBER') then
    return old;  -- the retention job is the one lawful path to physical deletion
  end if;
  raise exception 'hard delete on % is forbidden; use soft delete (set deleted_at)', tg_table_name
    using errcode = 'insufficient_privilege';
end $$;

------------------------------------------------------------------------------
-- Soft delete: the application's only way to remove a business row.
------------------------------------------------------------------------------
create or replace function core.soft_delete(p_table regclass, p_id uuid) returns void
  language plpgsql as $$
begin
  execute format(
    'update %s set deleted_at = now(), deleted_by = core.current_actor()
       where id = $1 and deleted_at is null', p_table)
  using p_id;
end $$;

------------------------------------------------------------------------------
-- The registration procedure: install every cross-cutting pattern on a table.
--   p_tenant_col     'tenant_id' for business tables, 'id' for the tenant table
--   p_financial      also install the freeze-on-issue guard
--   p_hard_delete_ok ephemeral table (e.g. edit_lock): allow real DELETE, skip
--                    the no-hard-delete guard, and grant DELETE to app_role
------------------------------------------------------------------------------
create or replace function core.register_business_table(
  p_table          regclass,
  p_tenant_col     text    default 'tenant_id',
  p_financial      boolean default false,
  p_hard_delete_ok boolean default false
) returns void
  language plpgsql as $$
begin
  -- 1. Tenant isolation via RLS, forced so even the table owner is bound.
  execute format('alter table %s enable row level security', p_table);
  execute format('alter table %s force  row level security', p_table);
  execute format($p$
    create policy tenant_isolation on %s
      using       (%I = core.current_tenant())
      with check  (%I = core.current_tenant())
  $p$, p_table, p_tenant_col, p_tenant_col);

  -- 2. Audit: every write lands a row in audit_log.
  execute format(
    'create trigger zzz_audit after insert or update or delete on %s
       for each row execute function core.audit_row(%L)', p_table, p_tenant_col);

  -- 3. Bookkeeping columns + optimistic-concurrency row_version (runs first).
  execute format(
    'create trigger aaa_set_audit_cols before insert or update on %s
       for each row execute function core.set_audit_cols()', p_table);

  -- 4. Immutability of issued financial documents.
  if p_financial then
    execute format(
      'create trigger bbb_freeze_document before update or delete on %s
         for each row execute function core.freeze_document()', p_table);
  end if;

  -- 5. No hard deletes (unless this is an ephemeral table).
  if not p_hard_delete_ok then
    execute format(
      'create trigger ccc_forbid_hard_delete before delete on %s
         for each row execute function core.forbid_hard_delete()', p_table);
  end if;

  -- 6. Grants. App may read/insert/update; DELETE is granted only to ephemeral
  --    tables, and explicitly revoked otherwise to make the rule enforceable.
  execute format('grant select, insert, update on %s to app_role', p_table);
  if p_hard_delete_ok then
    execute format('grant delete on %s to app_role', p_table);
  else
    execute format('revoke delete on %s from app_role', p_table);
  end if;
end $$;
