---
date: 2026-06-29
area: ui
---

# Fahrtenbuch & Fahrtzeiten screens

## What was built

**FahrtenbuchList** (`/office/fahrtenbuch`): Fahrzeug (vehicle) management.

- Table: Kennzeichen (mono), Fahrzeugtyp, Privatnutzung badge.
- Create dialog: Kennzeichen (forced uppercase), Fahrzeugtyp, Privat-Checkbox.
  Kennzeichen is the business key so it is auto-uppercased in onChange.
- Edit dialog: same fields pre-filled from loaded row, PUT /{id} with row_version.
- Delete: soft-delete via DELETE /{id} with confirmation dialog. The dialog
  explicitly states that existing Fahrten are retained (they carry the fahrzeug_id
  FK but the vehicle record is soft-deleted, not hard-deleted).
- Privat-genutzt badge: amber "Ja" / plain "Nein". The flag has tax relevance
  (§6 Abs. 1 Nr. 4 EStG geldwerter Vorteil / Privatanteil) — directive 05 records
  the need; the Steuerberater determines the treatment.

**FahrtzeitenList** (`/office/fahrtzeiten`): driving log, mirror of Arbeitszeit.

- Filters: freigabe_status (offen / freigegeben), projekt — server-side via
  GET /api/fahrt query params.
- Table: Datum, Mitarbeiter, Fahrzeug (kennzeichen from fahrzeug map), Projekt,
  Von → Nach (combined), km (de-DE formatted), Zweck, Status badge, Actions.
- Total km across the current filter shown in the header (client-side sum).
- Per-row actions identical to Arbeitszeit: Freigeben (PATCH /{id}/freigabe)
  for `offen`; Korrektur dialog (POST /{id}/korrektur) for `freigegeben` originals.
  Entries that are themselves corrections show "Korrektur" label.
- Create dialog: Mitarbeiter (required, app-user list), Fahrzeug (optional),
  Datum (required, date input, defaults to today), Projekt (optional), Von/Nach,
  km (required, numeric step 0.1), Zweck.
- Korrektur dialog: same fields without Mitarbeiter (inherited server-side from
  the source entry). Pre-fills from the frozen entry.

## Shared FahrtFields component

A single `FahrtFields` component is shared by CreateDialog and KorrekturDialog.
It accepts a `showUser` prop (default true) so the Korrektur dialog can hide the
Mitarbeiter select (the server inherits app_user_id from the source entry).

## km type handling

The API schema marks `km` as `number` (numeric). The form holds it as a string
(from the input). The POST/PUT body passes `km as unknown as number` to satisfy
TS strict — the actual string value is accepted by openapi-fetch → JSON →
FastAPI Pydantic (`Decimal`). This is the same pattern used for menge/ep in
Rechnung positions.

## freigabe workflow

Same as Arbeitszeit: `offen` → Freigeben → `freigegeben` (immutable via
freeze_on_approval trigger). Only Korrektur allowed after that, which creates a
new row with `korrektur_von_id` set. The server validates that the source entry
is `freigegeben` before accepting a Korrektur request.

## Assumption

The fahrzeug FK on a Fahrt is nullable. If a Fahrzeug is soft-deleted after trips
have been logged against it, `fzMap.get(f.fahrzeug_id)` returns undefined and the
cell shows "—". The trips remain valid. A future improvement could keep a snapshot
of the Kennzeichen on the Fahrt row itself, but that would denormalize.
