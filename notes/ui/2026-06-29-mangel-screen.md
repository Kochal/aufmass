---
date: 2026-06-29
area: ui
---

# Mängel screen

## Domain

Two levels: Abnahmeprotokoll (1) → Mangel (many). A protocol belongs to
a Projekt; a Mangel belongs to a protocol. You cannot create a Mangel without
first selecting or creating a protocol.

## What was built

**MangelList** (`/office/mangel`): list of all Abnahmeprotokolle for the tenant.

- Filter by Projekt (server-side via GET /api/abnahmeprotokoll?projekt_id=).
- Table: Datum, Projekt (resolved from projekt query cache), Abnahmeart
  (human-readable via ART_LABELS map), Abnehmer, Vorbehalte (truncated),
  "Mängel →" link to detail.
- Create dialog: Projekt (required), Abnahmedatum (required), Art select
  (foermlich/fiktiv/konkludent/bgb), Abnehmer (free text), Vorbehalte (textarea).
  On success, navigates directly to the detail page (window.location.href) so the
  user can start adding Mängel immediately.

Note: using window.location.href rather than useNavigate because the dialog is
not inside a router context. This causes a full reload but is acceptable for the
uncommon create-and-navigate path. A future refactor could lift navigation up.

**MangelDetail** (`/office/mangel/:id`): one protocol + all its Mängel.

*Abnahme header section*: shows datum, art, abnehmer, vorbehalte in a read-only
card with an inline edit toggle (PUT /api/abnahmeprotokoll/{id} with row_version).
The protokoll_document_id field is preserved on update but not editable in the UI
(document attachment deferred to directive 04 full object store round).

*Mängel table*: Beschreibung (line-clamp-2), Ort/Raum, Schwere badge, Frist,
Behoben am, Status badge, Actions (edit always; delete only for `offen`).

*Schwere badges*: gering → blue, mittel → orange, schwer → red.

*Status badges*: offen → yellow, behoben → green, abgelehnt → red.

*Overdue frist*: frist shown in red if status is `offen` and frist < today
(client-side; purely cosmetic, no server validation).

*Create Mangel dialog*: beschreibung (required), ort, schwere select, frist.
Status defaults to `offen` server-side; not settable on create.

*Edit Mangel dialog*: all fields including status and behoben_am. behoben_am
field only shown when status = "behoben". Calls PUT /api/mangel/{id} with
row_version. Includes status select (offen/behoben/abgelehnt) so the user
can update status and description in one step.

*Delete*: only shown for `offen` entries. Soft-delete via DELETE /api/mangel/{id}.
Dialog warns user that the action is final. Directives do not require immutability
on Mangel (unlike financial records) but soft-delete is used for consistency.

*Status filter*: client-side filter on the already-loaded Mängel list for a
given protocol. Counts (offen/behoben/abgelehnt) shown in the section header.

## Abnahmeart values

`foermlich` / `fiktiv` / `konkludent` / `bgb` — these are VOB/BGB acceptance
categories. The label for `fiktiv` cites §640 BGB explicitly as a reminder of
the legal basis. The Steuerberater/Rechtsanwalt reviews whether the selected art
is correct; the system records what the user enters.

## Assumption

`protokoll_document_id` (the uploaded acceptance protocol PDF) is stored as a
UUID FK to the `document` table. The UI currently ignores this field (shows nothing,
preserves it on PUT). Full document attachment belongs to the directive 04 object
store round. What would invalidate: if a court challenge requires the signed PDF to
be produced from the system, the attachment field must be populated.
