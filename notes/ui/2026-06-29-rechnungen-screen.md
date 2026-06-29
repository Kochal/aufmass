---
date: 2026-06-29
area: ui
---

# Rechnungen screen

## What was built

**RechnungList** (`/office/rechnungen`):
- Table: Rechnungsnummer (mono), Auftraggeber, Projekt (both resolved client-side),
  Brutto (de-DE formatted), Status badge, Rechnungsdatum
- Status filter (Entwurf / Ausgestellt)
- "Neue Rechnung" dialog: optional auftraggeber_id + projekt_id (projekt list
  filtered by selected auftraggeber); navigating to detail not automatic from
  list — user clicks the row

**RechnungDetail** (`/office/rechnungen/:id`):

Three-step workflow gated behind distinct UI sections:

1. **Positionen** (draft only): table with add dialog (bezeichnung, einheit,
   menge, EP, vob_2_3_flag=false) and per-row delete. Issued rechnungen show
   the table read-only.

2. **Kalkulation**: Nachlass/Zuschlag amount inputs + "Berechnen" button
   → `POST /{id}/berechnen`. Totals display (netto, MwSt derived inline,
   brutto) updated immediately from rechnung state. Always visible.

3. **Prüfung** (draft only): "Prüfen" button → `POST /{id}/pruefen`.
   Check results rendered inline: ✓/✗ icon + rule label + severity "Pflicht"
   badge + detail (missing fields list for einvoice_master_data, KoSIT messages
   for einvoice_en16931, error/note text). Results held in local state — not
   persisted in the component's query cache.

4. **Ausstellen** (draft only): enabled only when prüfen was run AND all hard
   checks passed. One click → `POST /{id}/ausstellen` → XRechnung generated and
   KoSIT-validated server-side. Toast shows allocated Rechnungsnummer. On
   success: rechnung query invalidated, check results cleared, issued state
   shows.

**Issued rechnung**: shows Rechnungsdetails section (rechnungsdatum,
faelligkeitsdatum, leistungsdatum, waehrung, steuer_behandlung) + XRechnung
artifact reference + version/supersedes info if version_no > 1.

## Key design decisions

- **Check results in local state**: `POST /pruefen` returns the check rows; we
  keep them in `useState`. Re-running prüfen replaces them. No separate query
  for check_result — avoids a GET endpoint for results we just fetched.

- **Ausstellen gate**: the button is `disabled` unless `checkResults !== null &&
  hardChecksPassed`. This prevents issue without running prüfen first. The
  server re-validates anyway (non-negotiable), but the UI makes the two-step
  explicit.

- **No navigation on create**: the create dialog (`RechnungList`) doesn't
  navigate to the detail page. The `onClose` signature had an `id` parameter
  for that but it was removed (unused TS warning). Navigation is intentional:
  the reviewer picks the rechnung from the list. Easy to add later.

- **MwSt line derived inline**: `summe_brutto - summe_netto` is shown as the
  MwSt row in the Kalkulation summary. This is a display convenience — the
  real authoritative value is `summe_brutto` from the server.

## Deleted ComingSoon

The `ComingSoon` helper function in `routes.tsx` was removed entirely — all
office routes are now live. The `ComingSoon` reference had already been dropped
from all route definitions.

## Assumption

`rechnung.status` is either "draft" or "issued" in practice. Other potential
values (e.g. "storniert") are handled gracefully by the StatusBadge fallback.
What would invalidate: if a "storniert" flow is added to the backend, the
detail page needs a separate frozen view for that state.
