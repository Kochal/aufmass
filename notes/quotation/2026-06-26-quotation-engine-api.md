# 2026-06-26 — 06 Quotation engine: application layer (deterministic core)

/ area: quotation / status: implemented; deferred items listed below /
confidence: high on the engine boundary; normal on the check coverage /

## What was built

- `api/app/engine/pricing.py` — deterministic pricing, pure Python `Decimal`/HALF_UP.
- `api/app/engine/checks.py` — sense-check engine writing `CheckRow` dicts.
- REST over 9 entities: `tenant_tax_profile`, `leistungskatalog`/`leistung`,
  `angebot`/`lv`/`lv_position`, `rechnung`/`rechnung_position`, `check_result`.
- Action endpoints: `/berechnen`, `/pruefen`, `/ausstellen`, `/version` for angebot;
  `/berechnen`, `/pruefen`, `/ausstellen` for rechnung.
- Seed extended: angebot+rechnung nummernkreis, tax profiles, dev leistungskatalog.
- pytest: engine units + integration flows + RLS extension.

## Engine boundary

- `pricing.price_position(menge, einheitspreis) -> Decimal`: single-line, single source of truth.
- `pricing.price_document(...)` builds document totals from position totals + tax profile.
  - `nachlass_betrag` and `zuschlag_betrag` are **absolute amounts** (numeric(12,2) columns).
    v1 does not support percentage discounts/surcharges. Add a note if this is needed.
  - `kleinunternehmer=True`: `summe_brutto == summe_netto` (no VAT added).
- `checks.run_checks(doc, positions, ust_satz, kleinunternehmer, leistungen)`:
  - `arithmetic` (hard): re-derives all gesamtpreise and totals from the engine; fails on mismatch.
  - `zero_guard` (hard): no zero/negative einheitspreis.
  - `unit` (soft): position einheit must match matched leistung's einheit.
  - `completeness` (hard): every position priced and match_status not in (review, unmatched).

## Rounding policy

`Decimal.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)` at every step:
- per position (gesamtpreis)
- summe_netto (sum of quantized gesamtpreise)
- summe_brutto (quantize the final product)

Euro-cent precision throughout; no accumulation error from float.

## Ordering contract

`berechnen → pruefen → ausstellen`. The issue gate (`core.issue_angebot` /
`core.issue_rechnung`) enforces its own DB-level checks (unpriced positions, recorded
hard failures) but does **not** recompute totals. The `arithmetic` check in `pruefen`
is the bridge: if the caller issues without pruefen, the gate may pass (no hard
check_result recorded) but any arithmetic error will go uncaught. Document this in
the API README or future UI.

## berechnen: einheitspreis fill-in

If a `lv_position` has no `einheitspreis` but has a `matched_leistung_id`, the engine
fetches the leistung's current `einheitspreis` and writes it back to the position.
This keeps the price traceable: the position carries the value it was priced at, not
a dynamic lookup. A later leistung price change does not rewrite an already-priced position.

## check_result lifecycle

`pruefen` soft-deletes prior unresolved engine-generated results for the document,
then inserts fresh ones. This ensures `ausstellen`'s gate sees only the most recent run.
A reviewer can call `PATCH /api/check-result/{id}/resolve` to clear a soft/failed result
so it no longer blocks issue.

## What is deferred (explicitly)

- **XRechnung / ZUGFeRD (EN 16931) generation + KoSIT validation**: validator container
  is unbuilt (`validator/README.md`). rechnung.einvoice_artifact_id will remain null until
  this round. The `/ausstellen` endpoint issues without it.
- **GAEB DA import** (`.x81`/`.x83` → lv/lv_position) and **D84 export**: deterministic
  but requires a standards-heavy GAEB DA XML parser. Own round.
- **PDF extraction + Leistungskatalog matching** (embeddings, rerank): hard-blocked on the
  GPU/model-host decision (directive 03). Until then, matching is set manually by the client.
- **Plausibility bands** (06 open question 1): needs price history to derive bands.
  Currently, the `plausibility` check rule is not emitted by `run_checks`. Revisit after
  enough priced history exists.
- **gaeb_roundtrip check**: needs the parsed GAEB source linked to the angebot. Not emitted.
- **Percentage-based Nachlass/Zuschlag**: v1 uses absolute Beträge only.

## For the firm's Steuerberater / Datenschutz review

This implementation computes and issues angebot and rechnung numbers. Before using it
for real documents, confirm with the Steuerberater:
- Correct USt treatment and rate per current client/project (not just the tenant default).
- VOB/B Section 2(3) cases (menge_aufmass vs menge_tender > 10% deviation) must be
  reviewed by a human before finalising the Schlussrechnung position price.
