-- 0017_angebot_and_lv.sql
-- The tendering/quotation tables (directive 02; 06 Stages 1-3, 6). angebot is a
-- financial document and gets the freeze-on-issue + versioning patterns. lv and
-- lv_position carry the provenance that makes "no orphan number" enforceable.
--
-- All committed money values (einheitspreis, gesamtpreis, totals) are STORED
-- here; the deterministic engine (06) computes them. The DB does not.

-- gaeb_artifact: a parsed GAEB DA file kept (as a document) unaltered (04).
create table gaeb_artifact (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenant(id),
  document_id  uuid references document(id),     -- the immutable original (04)
  phase        text check (phase in ('x83','d83','x84','d84','x81','d81')),  -- DA phase
  gaeb_version text                              -- 'DA 3.x' | 'GAEB 2000' | 'GAEB 90'
);
select core.add_standard_columns('gaeb_artifact');
select core.register_business_table('gaeb_artifact');

-- lv (Leistungsverzeichnis): per Angebot or per incoming tender. angebot_id is
-- nullable because a received tender may exist before the firm decides to quote.
create table lv (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenant(id),
  angebot_id      uuid,                            -- FK added after angebot below
  source          text not null check (source in ('gaeb','pdf','manual')),
  gaeb_artifact_id uuid references gaeb_artifact(id)
);
select core.add_standard_columns('lv');
select core.register_business_table('lv');

-- lv_position: one priced line. Carries the match provenance and a stored,
-- engine-computed gesamtpreis. Low-confidence matches are queued, never
-- auto-priced (00/06).
create table lv_position (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenant(id),
  lv_id             uuid not null references lv(id),
  oz                text,                          -- Ordnungszahl (order key)
  kurztext          text,
  langtext          text,
  menge             numeric(14,3),
  einheit           text,
  einheitspreis     numeric(12,2),                 -- from the matched leistung or manual
  gesamtpreis       numeric(12,2),                 -- engine-computed (menge*einheitspreis), stored
  matched_leistung_id uuid references leistung(id),
  match_confidence  numeric(5,4),
  match_status      text not null default 'review'
                      check (match_status in ('auto','review','confirmed','unmatched')),
  source            text check (source in ('gaeb','pdf','manual')),
  pricing_rule      text,                          -- the rule that produced the number (provenance)
  position_nr       integer
);
select core.add_standard_columns('lv_position');
select core.register_business_table('lv_position');

-- angebot: a quotation. Financial document: frozen at issue, versioned by
-- (document_group_id, version_no). Tax treatment is snapshotted at issue.
create table angebot (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenant(id),
  auftraggeber_id   uuid not null references auftraggeber(id),
  projekt_id        uuid references projekt(id),
  angebotsnummer    text,                          -- allocated at issue (non-gapless)
  status            text not null default 'draft'
                      check (status in ('draft','issued','cancelled','superseded')),
  document_group_id uuid not null default gen_random_uuid(),
  version_no        integer not null default 1,
  supersedes_id     uuid references angebot(id),
  -- tax snapshot (filled at issue from tenant_tax_profile)
  steuer_behandlung text,
  ust_satz          numeric(5,2),
  kleinunternehmer  boolean,
  -- committed totals (engine-computed, stored)
  summe_netto       numeric(12,2),
  nachlass_betrag   numeric(12,2),
  zuschlag_betrag   numeric(12,2),
  summe_brutto      numeric(12,2),
  waehrung          text not null default 'EUR',
  unique (tenant_id, angebotsnummer)
);
select core.add_standard_columns('angebot');
select core.register_business_table('angebot', p_financial => true);

-- Now that angebot exists, link lv -> angebot.
alter table lv add constraint lv_angebot_fk foreign key (angebot_id) references angebot(id);
