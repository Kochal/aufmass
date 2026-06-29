---
date: 2026-06-29
area: ui
---

# Gewährleistung screen

## What was built

**GewaehrleistungList** (`/office/gewaehrleistung`): flat list, no detail route
needed (no child entities).

*Filters*: status (laufend / abgelaufen / beendet) — server-side via
GET /api/gewaehrleistung?status=...

*Table columns*: Projekt, Regime badge (VOB blue / BGB purple), Start, Frist
(Jahre), Fristende (with countdown), Status badge, Actions (edit, delete).

*FristEndeCell*: smart display logic for `laufend` entries —
- frist_ende past today → red warning icon + red date
- frist_ende within 90 days → orange date + "noch N Tage" subtext
- otherwise → date + "noch N Tage" subtext in muted colour
- status != laufend → muted date only

*Header summary*: overdue count (red) and expiring-soon count (orange) shown
inline with the total, computed client-side after the query.

*Create dialog*: Projekt (required), Regime select (VOB/BGB with § citations),
Frist in Jahren (optional — placeholder shows the regime default; leaves null
so the DB trigger sets VOB=4 / BGB=5), Startdatum (optional, hint text
"In der Regel das Abnahmedatum").

*Edit dialog*: same fields (Projekt locked — not settable on PUT endpoint),
plus Status select (laufend/abgelaufen/beendet). Calling PUT with a new
regime would be silently ignored by the server (PUT body has no regime field);
the regime field is shown read-only via the RegimeBadge in the table.

*Delete*: soft-delete on any entry (no immutability constraint on Gewährleistung
in the schema). Confirm dialog names the project.

## frist_ende

GENERATED ALWAYS column on the DB: `start_datum + frist_jahre * interval '1 year'`.
Null if either start_datum or frist_jahre is null. The UI shows "—" in that case
and does not attempt to compute it client-side (avoids divergence from DB logic).

## Regime defaults

The DB trigger (migration 0014) sets:
- `vob` → frist_jahre = 4 (§ 13 Abs. 4 VOB/B)
- `bgb` → frist_jahre = 5 (§ 634a BGB Werkvertrag)

These fire when frist_jahre is null on INSERT. The create dialog placeholder
text communicates the default without hardcoding the value in the UI.

## Assumption

PUT /api/gewaehrleistung/{id} does not accept a `regime` change (the body
schema is GewaehrleistungUpdate which has no `regime` field). This is correct —
the regime determines the default frist_jahre and is set at creation.
If a firm wants to change the regime post-creation, they should delete and
re-create the entry. The edit dialog locks the Projekt field for the same reason.
