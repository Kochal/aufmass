-- 0024 – address / phone / contacts structural additions
-- Adds:
--   adresse.hausnummer        — house number as a separate column
--   auftraggeber.telefon      — direct phone number on the client record
--   lieferant.adresse_id      — FK to adresse for supplier addresses
--   projekt.baustellen_adresse_id — FK to adresse for project site addresses

alter table adresse
  add column if not exists hausnummer text;

alter table auftraggeber
  add column if not exists telefon text;

alter table lieferant
  add column if not exists adresse_id uuid references adresse(id);

alter table projekt
  add column if not exists baustellen_adresse_id uuid references adresse(id);
