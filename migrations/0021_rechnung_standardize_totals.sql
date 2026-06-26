-- 0021_rechnung_standardize_totals.sql
-- Standardise rechnung totals columns to match angebot (02 / 06).
--
-- The foundation migration (0006) gave rechnung minimal columns betrag_netto /
-- betrag_brutto as placeholders while the billing path was deferred. Angebot
-- (0017) was built with the fuller set: summe_netto / nachlass_betrag /
-- zuschlag_betrag / summe_brutto. The asymmetry was a footgun (the sense-check
-- engine had to do a dual-key lookup). This migration aligns the two tables.
--
-- Rename: betrag_netto → summe_netto, betrag_brutto → summe_brutto
-- Add:    nachlass_betrag, zuschlag_betrag (nullable; v1 rechnung has no discount
--         columns yet, but keeping parity prevents the next asymmetry).

alter table rechnung
  rename column betrag_netto to summe_netto;

alter table rechnung
  rename column betrag_brutto to summe_brutto;

alter table rechnung
  add column if not exists nachlass_betrag numeric(12,2),
  add column if not exists zuschlag_betrag numeric(12,2);
