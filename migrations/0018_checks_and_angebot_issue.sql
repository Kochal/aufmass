-- 0018_checks_and_angebot_issue.sql
-- The deterministic gate, as far as the DB can enforce it (directive 06 Stage
-- 4/6). The engine RUNS the sense-checks (arithmetic re-derivation, plausibility
-- bands, GAEB round-trip - all app-layer, 02) and records each result here. The
-- DB enforces the boundary at issue time: a document with a failing hard check,
-- or with unpriced / still-in-review positions, cannot be issued. "The check
-- results are stored and auditable."

-- One row per sense-check outcome against a document (angebot or rechnung).
create table check_result (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenant(id),
  target_table text not null check (target_table in ('angebot','rechnung')),
  target_id    uuid not null,
  rule         text not null,                 -- 'completeness' | 'gaeb_roundtrip' | 'arithmetic' | 'plausibility' | 'unit' | 'zero_guard'
  severity     text not null check (severity in ('hard','soft')),
  passed       boolean not null,
  resolved     boolean not null default false,  -- a reviewer cleared a soft/!passed flag
  detail       jsonb,
  checked_at   timestamptz not null default now()
);
select core.add_standard_columns('check_result');
select core.register_business_table('check_result');
create index check_result_target_idx on check_result (target_table, target_id);

-- The gate predicate, reusable by both issue paths. Raises on the first reason a
-- document may not be issued; does nothing if clear.
create or replace function core.assert_issuable(p_target_table text, p_target_id uuid)
  returns void language plpgsql as $$
declare
  v_bad_check int;
begin
  -- A failing hard check that no one has resolved blocks issue.
  select count(*) into v_bad_check
    from check_result
   where target_table = p_target_table
     and target_id    = p_target_id
     and severity = 'hard'
     and passed = false
     and resolved = false
     and deleted_at is null;
  if v_bad_check > 0 then
    raise exception '% % cannot be issued: % unresolved hard check failure(s)',
      p_target_table, p_target_id, v_bad_check
      using errcode = 'integrity_constraint_violation';
  end if;
end $$;

-- Issue an Angebot: enforce the gate, allocate the (non-gapless) Angebotsnummer,
-- snapshot the tax treatment, freeze + (the row is now versionable). No money
-- math here: totals were committed by the engine before issue.
create or replace function core.issue_angebot(p_angebot_id uuid) returns text
  language plpgsql as $$
declare
  v_status   text;
  v_num      text;
  v_unpriced int;
  v_treat    text;
  v_satz     numeric(5,2);
  v_klein    boolean;
begin
  select status into v_status from angebot where id = p_angebot_id for update;
  if not found then
    raise exception 'angebot % not found (or not visible in this tenant)', p_angebot_id;
  end if;
  if v_status <> 'draft' then
    raise exception 'angebot % is "%" and cannot be issued', p_angebot_id, v_status;
  end if;

  -- Gate 1: no unresolved hard check failures.
  perform core.assert_issuable('angebot', p_angebot_id);

  -- Gate 2: no orphan numbers - every position priced and matched (not in
  -- review / unmatched). (06 Stage 4 completeness, DB-enforceable slice.)
  select count(*) into v_unpriced
    from lv_position p
    join lv l on l.id = p.lv_id
   where l.angebot_id = p_angebot_id
     and p.deleted_at is null
     and (p.gesamtpreis is null or p.match_status in ('review','unmatched'));
  if v_unpriced > 0 then
    raise exception 'angebot % cannot be issued: % position(s) unpriced or still in review',
      p_angebot_id, v_unpriced
      using errcode = 'integrity_constraint_violation';
  end if;

  -- Tax snapshot from the current profile (copy, not calculation).
  select ust_treatment, ust_satz, kleinunternehmer
    into v_treat, v_satz, v_klein
    from tenant_tax_profile
   where tenant_id = core.current_tenant() and deleted_at is null;

  v_num := core.allocate_number('angebot');

  update angebot
     set status = 'issued',
         angebotsnummer = v_num,
         steuer_behandlung = v_treat,
         ust_satz = v_satz,
         kleinunternehmer = v_klein
   where id = p_angebot_id;

  return v_num;
end $$;

-- Create the next version of an issued Angebot: a new draft sharing the
-- document_group_id, with version_no incremented and supersedes_id set; the
-- prior version moves issued -> superseded (a controlled, freeze-allowed move).
-- Cloning the LV content into the new version is the engine's job (06).
create or replace function core.new_angebot_version(p_angebot_id uuid) returns uuid
  language plpgsql as $$
declare
  old angebot%rowtype;
  v_new_id uuid;
begin
  select * into old from angebot where id = p_angebot_id for update;
  if not found then
    raise exception 'angebot % not found', p_angebot_id;
  end if;
  if old.status <> 'issued' then
    raise exception 'only an issued angebot can be versioned (got "%")', old.status;
  end if;

  insert into angebot (tenant_id, auftraggeber_id, projekt_id, status,
                       document_group_id, version_no, supersedes_id, waehrung)
  values (old.tenant_id, old.auftraggeber_id, old.projekt_id, 'draft',
          old.document_group_id, old.version_no + 1, old.id, old.waehrung)
  returning id into v_new_id;

  update angebot set status = 'superseded' where id = old.id;

  return v_new_id;
end $$;
