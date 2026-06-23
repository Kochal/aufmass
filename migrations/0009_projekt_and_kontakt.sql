-- 0009_projekt_and_kontakt.sql
-- The project spine (directive 05): projekt with its lifecycle state machine,
-- and kontakt (people at an Auftraggeber). Reusable status-machine helpers live
-- here and are reused by bestellung (0012).

------------------------------------------------------------------------------
-- Shared helpers for audited state transitions.
------------------------------------------------------------------------------
-- The reason behind a transition (app.reason GUC), or NULL when none was given.
create or replace function core._reason() returns text
  language sql stable as $$
  select nullif(current_setting('app.reason', true), '')
$$;

-- Generic linear lifecycle guard, attached as a BEFORE UPDATE trigger.
--   TG_ARGV[0] = ordered states, comma-separated (e.g. 'entwurf,bestellt,...')
--   TG_ARGV[1] = the cancel state (e.g. 'storniert')
-- Forward moves are free; backward moves and cancellation require app.reason;
-- the last ordered state and the cancel state are terminal.
create or replace function core.linear_status_guard() returns trigger
  language plpgsql as $$
declare
  v_states text[] := string_to_array(tg_argv[0], ',');
  v_cancel text   := tg_argv[1];
  oi int; ni int;
begin
  if new.status = old.status then
    return new;                                  -- not a status change
  end if;
  if old.status = v_cancel or old.status = v_states[array_upper(v_states,1)] then
    raise exception '% % is in terminal state "%" and cannot transition', tg_table_name, old.id, old.status
      using errcode = 'integrity_constraint_violation';
  end if;
  if new.status = v_cancel then
    if core._reason() is null then
      raise exception 'cancelling % % requires a reason (set app.reason)', tg_table_name, old.id
        using errcode = 'integrity_constraint_violation';
    end if;
    return new;
  end if;
  oi := array_position(v_states, old.status);
  ni := array_position(v_states, new.status);
  if oi is null or ni is null then
    raise exception 'invalid status transition %->% on %', old.status, new.status, tg_table_name
      using errcode = 'integrity_constraint_violation';
  end if;
  if ni < oi and core._reason() is null then
    raise exception 'backward transition %->% on % % requires a reason (set app.reason)',
      old.status, new.status, tg_table_name, old.id
      using errcode = 'integrity_constraint_violation';
  end if;
  return new;
end $$;

------------------------------------------------------------------------------
-- projekt (Baustelle): the central operational entity.
------------------------------------------------------------------------------
create table projekt (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenant(id),
  auftraggeber_id   uuid not null references auftraggeber(id),
  nummer            text,                       -- allocated from the Nummernkreis
  name              text not null,
  site_adresse      text,
  status            text not null default 'angelegt'
                      check (status in ('angelegt','kalkulation','beauftragt','in_ausfuehrung',
                                        'abgenommen','abgerechnet','gewaehrleistung','abgeschlossen',
                                        'pausiert','storniert')),
  status_vor_pause  text,                       -- the state to resume to after 'pausiert'
  regime            text check (regime in ('bgb','vob')),   -- fixed at 'beauftragt'; drives warranty
  abrechnungsart    text check (abrechnungsart in ('einheitspreis','pauschal')),
  abnahme_datum     date,                       -- set when reaching 'abgenommen'
  abnahme_document_id uuid references document(id),  -- simple-mode signed protocol
  start_datum       date,
  end_datum         date,
  unique (tenant_id, nummer)
);
select core.add_standard_columns('projekt');
select core.register_business_table('projekt');

-- Auto-allocate the project number from the tenant Nummernkreis at creation,
-- unless one was supplied (carryover). (directive 05: "A project number is
-- allocated from the tenant Nummernkreis".)
create or replace function core.assign_projekt_nummer() returns trigger
  language plpgsql as $$
begin
  if new.nummer is null then
    new.nummer := core.allocate_number('projekt');
  end if;
  return new;
end $$;
-- Runs before set_audit_cols alphabetically ('aaa_' < 'aab_'); order is fine
-- either way since they touch disjoint columns.
create trigger aab_assign_nummer before insert on projekt
  for each row execute function core.assign_projekt_nummer();

-- The project lifecycle guard: forward free; backward/cancel need a reason;
-- pausiert remembers and resumes the prior state; abgenommen requires a date;
-- abgeschlossen/storniert are terminal. (directive 05, Projekt states.)
create or replace function core.projekt_status_guard() returns trigger
  language plpgsql as $$
declare
  v_main text[] := array['angelegt','kalkulation','beauftragt','in_ausfuehrung',
                         'abgenommen','abgerechnet','gewaehrleistung','abgeschlossen'];
  oi int; ni int;
begin
  if new.status = old.status then
    return new;
  end if;
  if old.status in ('storniert','abgeschlossen') then
    raise exception 'projekt % is terminal ("%") and cannot transition', old.id, old.status
      using errcode = 'integrity_constraint_violation';
  end if;

  -- Cancellation: allowed from any non-terminal state, with a reason.
  if new.status = 'storniert' then
    if core._reason() is null then
      raise exception 'cancelling projekt % requires a reason (set app.reason)', old.id
        using errcode = 'integrity_constraint_violation';
    end if;
    return new;
  end if;

  -- Pause: remember where we came from so we can resume.
  if new.status = 'pausiert' then
    new.status_vor_pause := old.status;
    return new;
  end if;

  -- Resume from pause: must return to the remembered state.
  if old.status = 'pausiert' then
    if new.status is distinct from old.status_vor_pause then
      raise exception 'projekt % can only resume to "%", not "%"',
        old.id, old.status_vor_pause, new.status
        using errcode = 'integrity_constraint_violation';
    end if;
    new.status_vor_pause := null;
    return new;
  end if;

  -- Main-line transition.
  oi := array_position(v_main, old.status);
  ni := array_position(v_main, new.status);
  if oi is null or ni is null then
    raise exception 'invalid projekt status transition %->%', old.status, new.status
      using errcode = 'integrity_constraint_violation';
  end if;
  if ni < oi and core._reason() is null then
    raise exception 'backward projekt transition %->% requires a reason (set app.reason)',
      old.status, new.status
      using errcode = 'integrity_constraint_violation';
  end if;

  -- Abnahme must carry its date (it starts the Gewährleistung clock, 05).
  if new.status = 'abgenommen' and new.abnahme_datum is null then
    raise exception 'projekt % cannot reach "abgenommen" without abnahme_datum', old.id
      using errcode = 'integrity_constraint_violation';
  end if;

  return new;
end $$;
create trigger bbb_projekt_status before update on projekt
  for each row execute function core.projekt_status_guard();

------------------------------------------------------------------------------
-- kontakt: people at an Auftraggeber.
------------------------------------------------------------------------------
create table kontakt (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenant(id),
  auftraggeber_id uuid not null references auftraggeber(id),
  name            text not null,
  rolle           text,
  email           text,
  telefon         text
);
select core.add_standard_columns('kontakt');
select core.register_business_table('kontakt');
