---
date: 2026-06-29
area: ui
---

# Owner dashboard

## What was built

### Backend — `GET /api/dashboard`

Single DB round-trip: one `WITH ... SELECT` CTE query across all tenant-scoped
tables, scoped by the RLS session context set per-request.

Counts returned:
- **Projekte**: in_ausfuehrung / kalkulation / beauftragt / gewaehrleistung
- **Mängel**: offen (all), offen+schwer, überfällig (offen + frist < today)
- **Gewährleistung**: laufend / expiring_soon (laufend, frist_ende ≤ 90 days) /
  überfällig (laufend, frist_ende < today — these are laufend entries where the
  clock ran out; the background job that flips them to 'abgelaufen' is not yet
  built, so they pile up here)
- **Rechnungen**: entwurf / ausgestellt / summe_brutto of issued
- **Angebote**: entwurf count
- **Arbeitszeit** and **Fahrt**: freigabe_status='offen' counts (pending approval)
- **Bestellungen**: status IN (entwurf/bestellt/teilgeliefert) = "active" count

Schema: `DashboardSummary` in `api/app/schemas/dashboard.py`.
Router: `api/app/routers/dashboard.py` — registered in `main.py`.

### Frontend — `web/src/surfaces/dashboard/index.tsx`

Replaced `DashboardStub` with `Dashboard`. Removed `stub: true` from the
"Übersicht" nav item in `AppShell.tsx`.

**Layout:** 4 sections with `Section` + `StatCard` components.
- **Projekte**: 4 cards, one per status bucket. Grey when count = 0.
- **Handlungsbedarf**: 7 cards covering the actionable items with urgency
  colouring. Red for danger (überfällig), orange for warn (entwurf items,
  freigabe-queue), grey when zero.
- **Gewährleistung**: 4 cards (überfällig, ablaufend bald, laufend, Mängel offen).
- **Finanzen**: 4 cards (Rechnungen ausgestellt + summe, Entwurf count, Angebote offen).

Every card that is actionable links to its source screen (`to` prop → `<Link>`).
Auto-refresh every 60 seconds via `refetchInterval`.

**Urgency rules:**
- `danger` (red bg/text): count > 0 for überfällig items
- `warn` (orange bg/text): count > 0 for items requiring action (entwurf, queue)
- `muted` (grey): count = 0 (nothing to act on right now)
- `normal`: counts that are informational positives (things running)

Money display: `fmtMoney` (de-DE locale, 2dp, € suffix). Shows "—" when null
(no issued invoices yet).

## Open design note

Gewährleistung überfällig counts entries that are still `status='laufend'` but
whose `frist_ende` has passed. A background job that flips them to 'abgelaufen'
does not yet exist — this is a known gap. Until that job is built, the "Überfällig"
card in the Gewährleistung section will grow monotonically and not self-clear when
the Gewährleistung screen marks them as abgelaufen. This is a future task.

## What is NOT on the dashboard (intentionally)

- Per-Mitarbeiter productivity (not useful to the owner at this granularity)
- Chart/graph rendering (stub comment said "not analytics theatre")
- Unbilled work list (would need a join: Projekt with Aufmaß entries but no issued
  Rechnung — deferred)
- Open Forderungen (outstanding invoices ≠ paid) — no payment receipt tracking yet
