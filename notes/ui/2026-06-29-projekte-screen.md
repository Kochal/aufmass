---
date: 2026-06-29
area: ui
---

# Projekte screen

## What was built

**ProjektList** (`/office/projekte`):
- Table: Nr. (mono), Name (link to detail), Auftraggeber name (resolved client-
  side from the auftraggeber query cache), Status badge (color-coded), Start, Ende
- Status filter dropdown (all or one of the 10 status values)
- "Neues Projekt" dialog: name + auftraggeber_id dropdown; if no auftraggeber
  exist yet, shows inline link to /office/auftraggeber

**ProjektDetail** (`/office/projekte/:id`):
- Inline status change: styled `<select>` that calls PATCH /{id}/status immediately
  on change (no save required); row_version passed; toast on success
- Two form sections — Projektdaten (name, auftraggeber, site_adresse, regime,
  abrechnungsart) and Termine (start_datum, end_datum, abnahme_datum as date
  inputs) — saved together via PUT /{id}
- Linked Angebote section: loads GET /api/angebot?projekt_id=... and lists them
  with status label; each is a link into AngebotReview
- Soft-delete with confirmation dialog → navigate back to list

## Status lifecycle

10 statuses: angelegt → kalkulation → beauftragt → in_ausfuehrung → abgenommen
→ abgerechnet → gewaehrleistung → abgeschlossen (also: pausiert, storniert).
The backend allows any status→status transition (no guard in the DB). The UI
exposes all options unconditionally — the reviewer decides. The `reason` field
of ProjektStatusPatch is optional; the UI does not prompt for it (no blocking
dialog on status change by design; trivial to add later if needed).

## Navigation

AppShell: "Projekte" nav item added (FolderOpen icon), no stub — live from day
one. Route: `/office/projekte` and `/office/projekte/:id` wired in routes.tsx.

## Assumption

The `nummer` field is auto-allocated by the DB trigger when NULL is passed on
create (same pattern as Angebotsnummer / Rechnungsnummer). The detail header
shows it when present. What would invalidate: if the firm wants a custom project
numbering scheme — that's a trigger-config change, not a UI change.
