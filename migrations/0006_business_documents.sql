-- 0006_business_documents.sql
-- A generic business table (auftraggeber) and the canonical financial document
-- (rechnung), present in the foundation because the immutability and numbering
-- guarantees are stated in terms of an issued Rechnung. The full rechnung
-- (positions, tax snapshot, e-invoice artifacts) is built out in directive 06;
-- here it carries only what the cross-cutting patterns need.

-- auftraggeber: the firm's client. A plain (non-financial) business table, used
-- to exercise tenant RLS, audit, soft-delete, and the no-hard-delete guard.
create table auftraggeber (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenant(id),
  kundennummer text,
  typ          text check (typ in ('privat','gewerblich','oeffentlich')),
  name         text not null,
  ust_idnr     text,
  unique (tenant_id, kundennummer)
);
select core.add_standard_columns('auftraggeber');
select core.register_business_table('auftraggeber');

-- rechnung: the invoice. Financial document -> gets the freeze-on-issue guard.
-- rechnungsnummer is assigned at the draft -> issued transition, never at draft
-- creation, and is gapless per legal requirement.
create table rechnung (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenant(id),
  auftraggeber_id   uuid references auftraggeber(id),
  projekt_id        uuid,                    -- FK added with the projekt table (05)
  rechnungsnummer   text,
  status            text not null default 'draft'
                      check (status in ('draft','issued','cancelled','superseded')),
  document_group_id uuid not null default gen_random_uuid(),  -- stable across versions
  version_no        integer not null default 1,
  supersedes_id     uuid references rechnung(id),
  waehrung          text not null default 'EUR',
  betrag_netto      numeric(12,2),           -- committed by the engine (06)
  betrag_brutto     numeric(12,2),
  unique (tenant_id, rechnungsnummer)
);
select core.add_standard_columns('rechnung');
select core.register_business_table('rechnung', p_financial => true);

-- Issue an invoice: allocate the gapless number and freeze the row, both inside
-- the caller's transaction. A rollback after this call burns no number.
create or replace function core.issue_rechnung(p_rechnung_id uuid) returns text
  language plpgsql as $$
declare
  v_status text;
  v_num    text;
begin
  select status into v_status from rechnung where id = p_rechnung_id for update;
  if not found then
    raise exception 'rechnung % not found (or not visible in this tenant)', p_rechnung_id;
  end if;
  if v_status <> 'draft' then
    raise exception 'rechnung % is "%" and cannot be issued', p_rechnung_id, v_status;
  end if;

  v_num := core.allocate_number('rechnung');

  update rechnung
     set status = 'issued', rechnungsnummer = v_num
   where id = p_rechnung_id;

  return v_num;
end $$;
