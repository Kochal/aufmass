---
date: 2026-06-29
area: ui
---

# Arbeitszeit screen

## What was built

**GET /api/app-user (new endpoint):** Read-only list + get of active app_users
for the tenant. No create/update/delete — user management is deferred to the
real Entra SSO integration (directive 09). Added `api/app/routers/app_user.py` +
`api/app/schemas/app_user.py`, registered in `main.py`. Required to display
Mitarbeiter names in the Arbeitszeit table; showing raw UUIDs was not useful.

**ArbeitszeitList** (`/office/arbeitszeit`): single-page management view.

*Filters*: freigabe_status (offen / freigegeben) and projekt — both applied
server-side via GET /api/arbeitszeit query params.

*Table columns*: Datum, Mitarbeiter (display_name or email from app-user map),
Projekt, Beginn, Ende, Dauer (formatted from "HH:MM:SS" interval), Art, Status
badge (offen/freigegeben with icons), Actions.

*Actions per row*:
- `offen` → "Freigeben" button → PATCH /{id}/freigabe (row_version passed).
  Freeze trigger fires server-side; the row becomes immutable.
- `freigegeben` (not itself a Korrektur) → "Korrektur" button → Korrektur dialog.
  Entries that are already corrections (`korrektur_von_id IS NOT NULL`) show an
  italic "Korrektur" label instead.

*Total hours*: sum of dauer across the current filter shown in the header
(client-side, from the dauer GENERATED column returned by the API).

**Create dialog**: Mitarbeiter (required, from app-user list), Projekt (optional),
Beginn (required, datetime-local), Ende (optional), Pause in minutes, Art
(free text). Converts local datetime-local values to UTC ISO before posting.

**Korrektur dialog**: pre-fills from the frozen entry. Posts to
POST /{id}/korrektur which creates a new row with `korrektur_von_id` set.
The original stays immutable.

## Freigabe workflow

`offen` → Freigeben → `freigegeben` (immutable). The backend's
`freeze_on_approval` trigger blocks further UPDATEs and DELETEs on freigegeben
entries. Only corrections are allowed. The UI enforces this by hiding the
Freigeben button on already-approved entries and showing Korrektur instead.

## dauer formatting

PostgreSQL returns the GENERATED ALWAYS `dauer` column (end_zeit − start_zeit −
pause_minuten * interval '1 min') as a string like "8:30:00" or "08:30:00".
The `fmtDauer` helper parses "HH:MM:SS" → "8 h 30 min". If end_zeit is null,
dauer is null and shows as "—".

## Datetime handling

The `<input type="datetime-local">` produces values like "2026-06-29T08:00".
`localToISO()` calls `new Date(val).toISOString()` to convert to UTC. The
displayed times (Beginn/Ende) use `toLocaleTimeString("de-DE", ...)` from the
UTC ISO strings stored in the DB, which correctly round-trips through the
browser's local timezone.

## Assumption

App users are displayed by `display_name ?? email`. If neither is set (edge
case), the UUID is truncated to 8 chars. What would invalidate: once real Entra
SSO is wired (directive 09), `display_name` will always come from AAD and this
fallback becomes irrelevant.

The `freigabe_status` filter passes the exact enum value to the server. If the
backend adds a third status value (e.g. "abgelehnt"), the filter select needs
a new option.
