---
date: 2026-07-02
area: quotation
---

# Rechnung position import from Angebot

## What was built

When creating a Rechnung, the user selects an Angebot. On creation the API
bulk-copies all `lv_position` rows (across all LVs of the Angebot) into
`rechnung_position`, preserving:

- `lv_position_id` → FK back to the source position (traceability non-negotiable)
- `menge_tender` = `lv_position.menge` (the quantity the Angebot was based on)
- `menge` = same initially (the billed quantity; changed later if Aufmaß differs)
- `bezeichnung` = `lv_position.kurztext`
- `einheitspreis`, `einheit` copied verbatim
- `leistung_id` = `matched_leistung_id` (catalog link preserved)

`auftraggeber_id` and `projekt_id` on the Rechnung are derived from the
selected Angebot on the backend — the frontend does not need to pass them
separately. This prevents AG/Projekt inconsistency between the Rechnung and
its source Angebot.

Migration 0027 adds `rechnung.angebot_id uuid references angebot(id)`.

## menge_tender vs menge — the traceability chain

The three menge fields on `rechnung_position`:

| Field | Set when | Meaning |
|---|---|---|
| `menge_tender` | Angebot import | Quantity from the LV (what was agreed) |
| `menge_aufmass` | Aufmaß reconciler (future) | Quantity from measured Aufmaß |
| `menge` | Created/edited | Effective billed quantity |

On initial import: `menge = menge_tender`. After Aufmaß reconciliation
(directive `07`), `menge` will be overwritten with `menge_aufmass` unless
the user overrides. The UI already shows an amber indicator when `menge ≠
menge_tender`, which is the trigger for VOB §2(3) review.

## CreateDialog design decision

The dialog shows Auftraggeber first (filtering the Angebot list), then the
Angebot (filtered to that AG's active Angebote). AG and Projekt are derived
from the selected Angebot and shown as read-only confirmation. A
"Direktrechnung" checkbox bypasses the Angebot picker entirely and restores
manual AG/Projekt pickers.

First attempt had Angebot as the primary picker (no AG filter), which the
user found confusing — reverted to AG → Angebot drill-down.

## What would invalidate this

- If a tenant needs to invoice partial LVs (only some positions from an
  Angebot), the import-all approach is wrong. Current assumption: import all,
  delete unwanted rows in RechnungDetail.
- If a tenant needs to invoice against multiple Angebote in one Rechnung
  (e.g., change orders), the single `angebot_id` FK is insufficient. Deferred.
