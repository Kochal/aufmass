---
date: 2026-07-02
area: quotation
---

# XRechnung EN 16931 UBL serialiser — bugs found and fixed

## Background

All EN 16931 errors were caught by the KoSIT validator during `prüfen`
(preview XML, number = "PREVIEW"). The bugs were structural in
`api/app/einvoice/ubl.py`, not in the pricing engine or data.

## Bugs and fixes

### 1. Wrong element order in LegalMonetaryTotal (BR-CO-13 regression from prior fix)

Previous fix moved `AllowanceTotalAmount` / `ChargeTotalAmount` after
`TaxExclusiveAmount`, which is correct per UBL 2.1 XSD sequence. But the
fix in the prior session was: AllowanceTotal/ChargeTotal were BEFORE
TaxExclusive. Fixed: order is now
`LineExtension → TaxExclusive → TaxInclusive → AllowanceTotal → ChargeTotal → Payable`.

### 2. TaxExclusiveAmount (BT-109) and TaxableAmount (BT-116) used raw line sum

`summe_netto` stored on the rechnung = Σ `gesamtpreise` (the line extension
sum, BT-106). EN 16931 rules require:

```
BT-109 = BT-106 - BT-107 + BT-108     (BR-CO-13)
BT-117 = round(BT-116 × BT-119 / 100) (BR-CO-17)
```

When nachlass (BT-107) or zuschlag (BT-108) are non-zero,
`BT-109 = netto_adj = summe_netto - nachlass + zuschlag`, NOT `summe_netto`.
We were emitting `summe_netto` for both BT-109 and BT-116, so BR-CO-13 and
BR-CO-17 failed whenever doc-level adjustments were present.

Fix: compute `netto_adj = summe_netto - nachlass + zuschlag` and use it for
both BT-109 (`TaxExclusiveAmount`) and BT-116 (`TaxableAmount`). Derive
`tax_amount = summe_brutto - netto_adj`.

### 3. Missing AllowanceCharge elements (BR-CO-12)

We emitted `ChargeTotalAmount` / `AllowanceTotalAmount` in `LegalMonetaryTotal`
when zuschlag/nachlass were non-zero, but never emitted the corresponding
`cac:AllowanceCharge` elements (BT-99). BR-CO-12 requires
`BT-108 = Σ AllowanceCharge.Amount where ChargeIndicator=true`.

Fix: emit `cac:AllowanceCharge` before `TaxTotal` (the UBL 2.1 sequence
requires it there) when nachlass or zuschlag are non-zero. Each includes
`ChargeIndicator`, `Amount`, and a nested `TaxCategory`.

### 4. Empty elements

Several `_cbc(el, name, value or "")` patterns produced empty XML elements
when the value was None/empty. EN 16931 rule "Document MUST not contain
empty elements" rejects any empty element.

Fix: added `_cbc_if()` helper that only creates the element when the value
is non-empty. `_cbc()` now asserts non-empty to catch future regressions.
All optional fields (CityName, PostalZone, StreetName, etc.) switched to
`_cbc_if()`.

### 5. Missing buyer electronic address (BT-49) — BR-DE-19

`EndpointID` on `AccountingCustomerParty` was only emitted when
`auftraggeber.elektronische_adresse` was explicitly set. XRechnung requires
it. Fix: fall back to `leitweg_id` with `schemeID="0204"` (German Leitweg-ID
scheme) if no explicit endpoint is configured. `_missing_einvoice_fields`
now gates on at least one of the two being present.

### 6. BuyerReference (BT-10) emitted empty — BR-DE-15

`BuyerReference` was `buyer.get("leitweg_id") or ""` → emitted as an empty
element when leitweg_id was unset. BR-DE-15 requires it to be non-empty.

Fix: use `leitweg_id` if set, fall back to `buyer_name` as a routing
reference. For production B2G invoices, leitweg_id is required and
`_missing_einvoice_fields` enforces it.

## Invariants to maintain

- `BT-109 = BT-106 - BT-107 + BT-108` always holds post-fix because
  netto_adj is computed from the same stored values that populate BT-107/108.
- `BT-117 = round(BT-116 × BT-119/100, 2)` holds because the pricing engine
  computes `summe_brutto = _q(netto_adj × (1 + ust/100))`, so
  `summe_brutto - netto_adj = _q(netto_adj × ust/100)` for 2-decimal inputs.
- Never call `_cbc()` with an empty string — the assert will catch it.
