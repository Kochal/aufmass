-- 0011_gewaehrleistung.sql
-- Warranty tracking per project, so expiry is queryable. (directive 05,
-- Warranty.) The clock starts at Abnahme; the term defaults by contract regime
-- (VOB/B 4y, BGB 5y for Bauwerk work) and can be overridden per project, with
-- material doubt confirmed legally (01 caveat). frist_ende is computed.

create table gewaehrleistung (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenant(id),
  projekt_id  uuid not null references projekt(id),
  regime      text not null check (regime in ('bgb','vob')),
  start_datum date,                          -- = projekt.abnahme_datum
  -- term in years: defaults by regime when null (set by the trigger below),
  -- overridable for the "an einem Bauwerk?" classification edge cases.
  frist_jahre integer,
  -- computed and stored, so upcoming expiries are a plain indexed query.
  frist_ende  date generated always as (
                (start_datum + make_interval(years => frist_jahre))::date
              ) stored,
  status      text not null default 'laufend'
                check (status in ('laufend','abgelaufen','beendet')),
  unique (tenant_id, projekt_id)
);

-- Default the term by regime before the generated frist_ende is computed.
-- VOB/B -> 4 years, BGB -> 5 years (defaults; overridable by setting frist_jahre).
create or replace function core.gewaehrleistung_default_term() returns trigger
  language plpgsql as $$
begin
  if new.frist_jahre is null then
    new.frist_jahre := case new.regime when 'vob' then 4 when 'bgb' then 5 end;
  end if;
  return new;
end $$;

select core.add_standard_columns('gewaehrleistung');
select core.register_business_table('gewaehrleistung');

-- Must run before set_audit_cols? No - they touch disjoint columns. But it must
-- run before the generated column is computed, which all BEFORE triggers do.
create trigger aab_default_term before insert or update on gewaehrleistung
  for each row execute function core.gewaehrleistung_default_term();
