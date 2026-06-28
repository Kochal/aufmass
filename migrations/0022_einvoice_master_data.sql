-- 0022_einvoice_master_data.sql
-- Party master data required for EN 16931 XRechnung generation, plus invoice
-- date columns on rechnung.
--
-- A valid XRechnung needs party data not previously modelled:
--   seller: postal address, IBAN, electronic address (BT-34)
--   buyer:  postal address, Leitweg-ID (BT-10, mandatory for B2G)
-- Invoice dates (BT-2 IssueDate, BT-9 DueDate, BT-72 delivery date) are set
-- atomically at issue time.
--
-- Design decision: normalized tables (adresse, bankverbindung) rather than
-- adding columns to existing tables. See notes/quotation/2026-06-28-xrechnung-einvoice.md.
--
-- All new tables follow the standard pattern (add_standard_columns +
-- register_business_table): tenant RLS, audit, soft-delete, immutability,
-- row_version.

------------------------------------------------------------------------------
-- adresse: generic postal address, tenant-scoped.
-- Referenced by tenant_billing_profile (seller) and auftraggeber (buyer).
------------------------------------------------------------------------------
create table adresse (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenant(id),
  strasse        text,
  adresszusatz   text,
  plz            text,
  ort            text,
  land           text not null default 'DE'   -- ISO 3166-1 alpha-2
);
select core.add_standard_columns('adresse');
select core.register_business_table('adresse');

------------------------------------------------------------------------------
-- bankverbindung: SEPA credit-transfer account (BG-16 / BT-84).
-- Seller bank account for payment means on the invoice.
------------------------------------------------------------------------------
create table bankverbindung (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenant(id),
  inhaber        text,
  iban           text not null,
  bic            text,
  bank_name      text
);
select core.add_standard_columns('bankverbindung');
select core.register_business_table('bankverbindung');

------------------------------------------------------------------------------
-- tenant_billing_profile: 1:1 with tenant; seller-party identity for invoicing.
-- Complements tenant (name/rechtsform) and tenant_tax_profile (ust_idnr).
-- elektronische_adresse + eas_scheme: electronic routing address (BT-34 / BT-34-1).
-- zahlungsziel_tage: default payment term used to derive faelligkeitsdatum.
--
-- STEUERBERATER FLAG: payment-term default and electronic address scheme
-- correctness must be confirmed for each production buyer/client type before
-- the first real invoice is issued.
------------------------------------------------------------------------------
create table tenant_billing_profile (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null unique references tenant(id),
  adresse_id            uuid references adresse(id),
  bankverbindung_id     uuid references bankverbindung(id),
  elektronische_adresse text,            -- BT-34 seller electronic address
  eas_scheme            text not null default 'EM',  -- BT-34-1 scheme (EM=email)
  kontakt_name          text,            -- BG-6 contact name
  kontakt_tel           text,            -- BG-6 telephone
  kontakt_email         text,            -- BG-6 email
  zahlungsziel_tage     integer not null default 30
);
select core.add_standard_columns('tenant_billing_profile');
select core.register_business_table('tenant_billing_profile');

------------------------------------------------------------------------------
-- Extend auftraggeber: buyer postal address + Leitweg-ID.
-- leitweg_id (BT-10 BuyerReference): mandatory for XRechnung B2G invoices.
-- STEUERBERATER FLAG: Leitweg-ID values must be verified with each public
-- buyer before production invoicing; an incorrect Leitweg-ID may prevent
-- payment or fail electronic routing.
------------------------------------------------------------------------------
alter table auftraggeber
  add column if not exists adresse_id            uuid references adresse(id),
  add column if not exists leitweg_id            text,         -- BT-10 Buyer Reference
  add column if not exists elektronische_adresse text,         -- BT-49 buyer electronic address
  add column if not exists eas_scheme            text not null default 'EM'; -- BT-49-1

------------------------------------------------------------------------------
-- Extend rechnung: invoice dates set atomically at issue time.
-- rechnungsdatum    = BT-2  (mandatory, invoice issue date)
-- faelligkeitsdatum = BT-9  (payment due date)
-- leistungsdatum    = BT-72 (actual delivery/service date; period BT-73/BT-74 deferred)
------------------------------------------------------------------------------
alter table rechnung
  add column if not exists rechnungsdatum      date,
  add column if not exists faelligkeitsdatum   date,
  add column if not exists leistungsdatum      date;

------------------------------------------------------------------------------
-- core.rechnung_finalize_issue: the single atomic draft→issued UPDATE.
--
-- Called from ausstellen_rechnung (Python) after:
--   (1) assert_issuable passed
--   (2) number allocated via core.allocate_number (same txn)
--   (3) XRechnung XML built and validated by KoSIT
--   (4) original artifact stored in the document table
-- The function re-locks the row and re-checks status so a concurrent attempt
-- blocks until commit, then sees status='issued' and fails cleanly.
-- The freeze_document trigger allows the UPDATE because OLD.status='draft'.
-- Parameters match the rechnung columns written at issue time.
------------------------------------------------------------------------------
create or replace function core.rechnung_finalize_issue(
  p_id                uuid,
  p_num               text,
  p_rechnungsdatum    date,
  p_faelligkeitsdatum date,
  p_leistungsdatum    date,
  p_treat             text,
  p_satz              numeric(5,2),
  p_klein             boolean,
  p_fmt               text,
  p_artifact_id       uuid
) returns void language plpgsql as $$
declare
  v_status text;
begin
  -- Re-lock so a concurrent ausstellen attempt blocks until we commit.
  select status into v_status from rechnung where id = p_id for update;
  if not found then
    raise exception 'rechnung % not found (or not visible in this tenant)', p_id;
  end if;
  if v_status <> 'draft' then
    raise exception 'rechnung % is "%" and cannot be issued', p_id, v_status;
  end if;

  -- Single atomic UPDATE. OLD.status='draft' → freeze_document allows all fields.
  update rechnung
     set status               = 'issued',
         rechnungsnummer      = p_num,
         rechnungsdatum       = p_rechnungsdatum,
         faelligkeitsdatum    = p_faelligkeitsdatum,
         leistungsdatum       = p_leistungsdatum,
         steuer_behandlung    = coalesce(steuer_behandlung, p_treat),
         ust_satz             = coalesce(ust_satz, p_satz),
         kleinunternehmer     = coalesce(kleinunternehmer, p_klein),
         einvoice_format      = p_fmt,
         einvoice_artifact_id = p_artifact_id
   where id = p_id;
end $$;
