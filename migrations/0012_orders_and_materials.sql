-- 0012_orders_and_materials.sql
-- Material procurement against a project. (directive 05, Orders and materials.)
-- bestellung uses the generic linear lifecycle guard from 0009.

-- lieferant: supplier master.
create table lieferant (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenant(id),
  name       text not null,
  ust_idnr   text,
  zahlungsziel_tage integer
);
select core.add_standard_columns('lieferant');
select core.register_business_table('lieferant');

-- material: material master, reused across projects.
create table material (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references tenant(id),
  bezeichnung          text not null,
  einheit              text not null,
  standard_lieferant_id uuid references lieferant(id),
  standard_preis       numeric(12,2)            -- stored value; no calc in the DB
);
select core.add_standard_columns('material');
select core.register_business_table('material');

-- bestellung: an order, optionally against a project (some stock orders are not).
create table bestellung (
  id                        uuid primary key default gen_random_uuid(),
  tenant_id                 uuid not null references tenant(id),
  projekt_id                uuid references projekt(id),
  lieferant_id              uuid not null references lieferant(id),
  status                    text not null default 'entwurf'
                              check (status in ('entwurf','bestellt','teilgeliefert','geliefert','storniert')),
  bestelldatum              date,
  summe                     numeric(12,2),                  -- committed by the engine
  -- An Auftragsbestätigung / delivery note is a Buchungsbeleg (8y, 01): kept as
  -- a document with the right retention class, not just a status flag.
  auftragsbestaetigung_document_id uuid references document(id)
);
select core.add_standard_columns('bestellung');
select core.register_business_table('bestellung');

-- entwurf -> bestellt -> teilgeliefert -> geliefert ; storniert (reason). The
-- last ordered state and 'storniert' are terminal; backward/cancel need a reason.
create trigger bbb_bestellung_status before update on bestellung
  for each row execute function core.linear_status_guard(
    'entwurf,bestellt,teilgeliefert,geliefert', 'storniert');

-- bestellposition: order line, referencing the material master.
create table bestellposition (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenant(id),
  bestellung_id uuid not null references bestellung(id),
  material_id   uuid references material(id),
  bezeichnung   text not null,               -- snapshot, in case material text changes
  menge         numeric(14,3) not null,
  einheit       text not null,
  einzelpreis   numeric(12,2),               -- stored; no calc in the DB
  position_nr   integer
);
select core.add_standard_columns('bestellposition');
select core.register_business_table('bestellposition');
