---
date: 2026-06-30
area: quotation
---

# Inline gesamtpreis on position save

## Decision

`lv_position` router now computes `gesamtpreis = ROUND(menge × einheitspreis, 2)`
(Python `Decimal`, `ROUND_HALF_UP`) on every INSERT and UPDATE, instead of
leaving it NULL until "Berechnen" is clicked.

## Why

The "Berechnen" button runs the full pricing engine (Angebot-level: surcharges,
Nachlass, MwSt, totals). For individual positions the gesamtpreis is always
`menge × einheitspreis` — there are no position-level surcharges in the current
schema. Deferring this to an explicit button click was a UX friction with no
benefit: the client-side `≈ Betrag` preview on each card already showed the same
value.

## Boundary: what Berechnen still owns

- Angebot-level `gesamtpreis_netto`, `mwst_betrag`, `gesamtpreis_brutto` — summing
  all positions and applying global Nachlass and MwSt.
- If position-level surcharges (Aufschläge per Position) are ever introduced,
  Berechnen will overwrite `gesamtpreis` with the surcharge-adjusted value. The
  inline value from the router becomes an optimistic intermediate until Berechnen
  is run. Card can be updated to show `≈` for positions where the engine value
  differs, but this is a future concern.

## Implementation (phase 1 — position gesamtpreis)

`_gesamtpreis(menge, einheitspreis)` helper at the top of `lv_position.py`.
Returns `None` when either operand is `None` (no partial zeroing). Added to
both the INSERT column list and the UPDATE SET clause. `RETURNING *` already
propagates the value back, so the frontend receives the computed gesamtpreis in
the mutation response and the card updates without an extra refetch.

## Bug: arithmetic check blocked Ausstellen after position edit

After phase 1, the workflow `Berechnen → edit position → Prüfen → Ausstellen`
failed with "1 unresolved hard check failure". Root cause: editing a position
after Berechnen updated `lv_position.gesamtpreis` inline but left
`angebot.summe_netto` stale. The `_check_arithmetic` function in
`engine/checks.py` compares stored `summe_netto` to the sum of current position
gesamtpreise — a stale total triggers a hard FAIL, and `core.assert_issuable`
blocks Ausstellen while any unresolved hard FAIL exists.

## Fix (phase 2 — angebot totals refresh on position save)

Added `_refresh_angebot_totals(conn, lv_id)` to `lv_position.py`, called after
every INSERT, UPDATE, and soft-DELETE. It:
1. Fetches `angebot.id`, `nachlass_betrag`, `zuschlag_betrag` and the tenant's
   `ust_satz` / `kleinunternehmer` via a join `lv → angebot → tenant_tax_profile`.
2. Sums all non-deleted position `gesamtpreis` values for that LV.
3. Calls `pricing.price_document(gesamtpreise, nachlass, zuschlag, ust, klu)`.
4. Writes `summe_netto` and `summe_brutto` back to angebot (no row_version check
   — this is an internal recompute, not a user edit). Only acts on `status='draft'`
   angebote; issued documents are never touched.

Because the angebot's `row_version` bumps on each position save (via trigger),
the frontend must invalidate its angebot cache after position mutations so that
Berechnen sends the fresh row_version. Added
`qc.invalidateQueries({ queryKey: ["angebot", angebotId] })` to all position
mutation `onSuccess` (and 409 `onError`) handlers in `AngebotReview.tsx`.

For any angebot already stuck in the stale state before this fix: run Berechnen
once to resync the totals, then Prüfen + Ausstellen work normally. The check
engine soft-deletes old check_result rows on each Prüfen run, so re-running
Prüfen after Berechnen clears the stale FAIL.
