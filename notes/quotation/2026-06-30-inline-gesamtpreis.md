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

## Implementation

`_gesamtpreis(menge, einheitspreis)` helper at the top of `lv_position.py`.
Returns `None` when either operand is `None` (no partial zeroing). Added to
both the INSERT column list and the UPDATE SET clause. `RETURNING *` already
propagates the value back, so the frontend receives the computed gesamtpreis in
the mutation response and the card updates without an extra refetch.
