-- 0013_time_and_mileage.sql
-- Working time and mileage. (directive 05, Working time / Mileage.) Both are
-- optional modules gated by tenant_setting toggles in the app/API layer; the DB
-- stores the records and enforces the freeze-on-approval (Freigabe) rule: once a
-- period is approved, its entries are frozen the way issued documents are, and a
-- later fix is an audited correction entry, not a rewrite.

------------------------------------------------------------------------------
-- Freeze-on-approval: BEFORE UPDATE/DELETE guard.
--   TG_ARGV[0] = the status column   (e.g. 'freigabe_status')
--   TG_ARGV[1] = the frozen value    (e.g. 'freigegeben')
-- The transition into the frozen value is allowed (OLD is not yet frozen);
-- once frozen, any further change or (soft-)delete is rejected.
------------------------------------------------------------------------------
create or replace function core.freeze_on_approval() returns trigger
  language plpgsql as $$
declare
  v_col    text := tg_argv[0];
  v_frozen text := tg_argv[1];
begin
  if (to_jsonb(old) ->> v_col) = v_frozen then
    raise exception '% % is approved (frozen); record an audited correction instead', tg_table_name, old.id
      using errcode = 'integrity_constraint_violation';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

------------------------------------------------------------------------------
-- arbeitszeit: actual worked time per user per project. Captured start/ende,
-- duration derived. Approved entries (freigabe_status='freigegeben') are frozen.
------------------------------------------------------------------------------
create table arbeitszeit (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenant(id),
  app_user_id     uuid not null references app_user(id),
  projekt_id      uuid references projekt(id),
  start_zeit      timestamptz not null,
  end_zeit        timestamptz,
  pause_minuten   integer not null default 0,
  -- duration derived from captured start/end minus breaks; not a free total.
  dauer           interval generated always as
                    (end_zeit - start_zeit - make_interval(mins => pause_minuten)) stored,
  art             text,                       -- e.g. 'arbeit' | 'fahrt' | 'ruest'
  freigabe_status text not null default 'offen'
                    check (freigabe_status in ('offen','freigegeben')),
  freigegeben_am  timestamptz,
  freigegeben_von text,
  -- a correction entry points at the frozen original it corrects.
  korrektur_von_id uuid references arbeitszeit(id)
);
select core.add_standard_columns('arbeitszeit');
select core.register_business_table('arbeitszeit');
create trigger bbb_freeze_on_approval before update or delete on arbeitszeit
  for each row execute function core.freeze_on_approval('freigabe_status','freigegeben');

------------------------------------------------------------------------------
-- fahrzeug: small vehicle master.
------------------------------------------------------------------------------
create table fahrzeug (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenant(id),
  kennzeichen   text not null,
  typ           text,
  privat_genutzt boolean not null default false,  -- relevant to Fahrtenbuch on the tax side
  unique (tenant_id, kennzeichen)
);
select core.add_standard_columns('fahrzeug');
select core.register_business_table('fahrzeug');

------------------------------------------------------------------------------
-- fahrt: trip-level distance capture (not continuous location tracking).
-- Approval mirrors working time: an approved trip is frozen.
------------------------------------------------------------------------------
create table fahrt (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenant(id),
  app_user_id     uuid not null references app_user(id),
  projekt_id      uuid references projekt(id),
  fahrzeug_id     uuid references fahrzeug(id),
  datum           date not null,
  von             text,
  nach            text,
  km              numeric(14,3) not null,
  zweck           text,
  freigabe_status text not null default 'offen'
                    check (freigabe_status in ('offen','freigegeben')),
  freigegeben_am  timestamptz,
  freigegeben_von text,
  korrektur_von_id uuid references fahrt(id)
);
select core.add_standard_columns('fahrt');
select core.register_business_table('fahrt');
create trigger bbb_freeze_on_approval before update or delete on fahrt
  for each row execute function core.freeze_on_approval('freigabe_status','freigegeben');
