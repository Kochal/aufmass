-- 0010_abnahme_and_mangel.sql
-- Structured Abnahme (acceptance) and its Mängel (defects) list. Present only
-- when abnahme_mode is structured; in simple mode the project carries
-- abnahme_datum + an attached document instead. (directive 05, Abnahme and
-- Mängel.)

-- abnahmeprotokoll: the acceptance record for a project.
create table abnahmeprotokoll (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenant(id),
  projekt_id    uuid not null references projekt(id),
  abnahme_datum date not null,
  art           text not null
                  check (art in ('foermlich','fiktiv','konkludent','bgb')),  -- VOB/B kinds + BGB
  abnehmer      text,                         -- the accepting person
  vorbehalte    text,                         -- reservations (e.g. Vertragsstrafe vorbehalten)
  protokoll_document_id uuid references document(id),  -- the signed protocol original
  unique (tenant_id, projekt_id)              -- one acceptance record per project
);
select core.add_standard_columns('abnahmeprotokoll');
select core.register_business_table('abnahmeprotokoll');

-- mangel: a defect hanging off an Abnahmeprotokoll. The records the firm leans
-- on in a later Gewährleistung claim.
create table mangel (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenant(id),
  abnahmeprotokoll_id uuid not null references abnahmeprotokoll(id),
  beschreibung        text not null,
  ort                 text,
  schwere             text check (schwere in ('gering','mittel','schwer')),
  frist               date,                   -- remedy deadline
  status              text not null default 'offen'
                        check (status in ('offen','behoben','abgelehnt')),
  behoben_am          date
);
select core.add_standard_columns('mangel');
select core.register_business_table('mangel');
