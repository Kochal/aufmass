-- 0019_rechnung_billing.sql
-- Complete the rechnung (the minimal version landed in 0006) for the 06 billing
-- path: tax snapshot + e-invoice fields, line items with traceability, and the
-- billing-quantity columns for the Einheitspreis/Pauschal/VOB-B-2(3) rule.
--
-- As everywhere: committed money values are stored; the engine computes them and
-- validates EN 16931 before issue. The DB stores and gates, it does not calculate.

alter table rechnung
  add column if not exists steuer_behandlung   text,
  add column if not exists ust_satz            numeric(5,2),
  add column if not exists kleinunternehmer    boolean,
  add column if not exists einvoice_format     text
        check (einvoice_format in ('xrechnung','zugferd','sonstige')),
  add column if not exists einvoice_artifact_id uuid references document(id);

-- rechnung_position: line items, each traceable to the LV position, the Aufmaß
-- entry, and/or the catalog Leistung it came from (00 traceability). Tendered
-- and measured Mengen are both retained so the Schlussrechnung can show the
-- delta and flag a VOB/B Section 2(3) case (06 resolved decision).
create table rechnung_position (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenant(id),
  rechnung_id     uuid not null references rechnung(id),
  position_nr     integer,
  bezeichnung     text not null,
  einheit         text,
  einheitspreis   numeric(12,2),               -- stored; engine-computed
  -- billing quantity: measured governs under Einheitspreisvertrag; both kept.
  menge_tender    numeric(14,3),               -- tendered Mengenansatz
  menge_aufmass   numeric(14,3),               -- measured (07)
  menge           numeric(14,3),               -- the quantity actually billed
  gesamtpreis     numeric(12,2),               -- stored; engine-computed
  vob_2_3_flag    boolean not null default false,  -- engine: deviation > 10% past threshold
  -- provenance (nullable; the residual human-review links)
  lv_position_id  uuid references lv_position(id),
  aufmass_entry_id uuid,                        -- FK added with aufmass_entry (07)
  leistung_id     uuid references leistung(id)
);
select core.add_standard_columns('rechnung_position');
select core.register_business_table('rechnung_position');

-- Re-issue rechnung with the same gate and tax snapshot as the Angebot. Keeps
-- the gapless allocation and freeze from 0006. With no checks recorded and no
-- tax profile present the behaviour is unchanged (the foundation flow still
-- works); the snapshot/gate engage once those exist.
create or replace function core.issue_rechnung(p_rechnung_id uuid) returns text
  language plpgsql as $$
declare
  v_status text;
  v_num    text;
  v_treat  text;
  v_satz   numeric(5,2);
  v_klein  boolean;
begin
  select status into v_status from rechnung where id = p_rechnung_id for update;
  if not found then
    raise exception 'rechnung % not found (or not visible in this tenant)', p_rechnung_id;
  end if;
  if v_status <> 'draft' then
    raise exception 'rechnung % is "%" and cannot be issued', p_rechnung_id, v_status;
  end if;

  -- Deterministic gate: no unresolved hard check failures (e.g. EN 16931
  -- validation, arithmetic integrity) recorded by the engine.
  perform core.assert_issuable('rechnung', p_rechnung_id);

  -- Tax snapshot (copy, not calculation).
  select ust_treatment, ust_satz, kleinunternehmer
    into v_treat, v_satz, v_klein
    from tenant_tax_profile
   where tenant_id = core.current_tenant() and deleted_at is null;

  v_num := core.allocate_number('rechnung');

  update rechnung
     set status = 'issued',
         rechnungsnummer = v_num,
         steuer_behandlung = coalesce(steuer_behandlung, v_treat),
         ust_satz = coalesce(ust_satz, v_satz),
         kleinunternehmer = coalesce(kleinunternehmer, v_klein)
   where id = p_rechnung_id;

  return v_num;
end $$;
