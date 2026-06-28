# XRechnung e-invoice path — implementation decisions

Date: 2026-06-28  
Area: quotation

## What was built

The EN 16931 XRechnung generation + KoSIT validation gate wired into
`ausstellen_rechnung`. This is the compliance-critical completion of the
directive-06 billing path: B2G in Germany requires XRechnung today (§ 27a
UStG / EU Directive 2014/55/EU).

**New modules:**
- `api/app/einvoice/ubl.py` — XRechnung UBL 2.1 builder (stdlib XML, no new dep)
- `api/app/einvoice/units.py` — UN/ECE Rec 20 unit code map + `map_einheit()`
- `api/app/einvoice/validator_client.py` — KoSIT HTTP sidecar client (httpx)
- `api/app/storage.py` — write-once filesystem original store (directive 04 slice)
- `migrations/0022_einvoice_master_data.sql` — adresse, bankverbindung,
  tenant_billing_profile, + ALTER auftraggeber + ALTER rechnung +
  `core.rechnung_finalize_issue`

**Routers/schemas:** adresse, bankverbindung, tenant_billing_profile (new);
auftraggeber + rechnung (extended).

## Issue-flow design — why `core.rechnung_finalize_issue`

The freeze trigger (`core.freeze_document`) allows an UPDATE on a draft row
but blocks all field changes once status = 'issued'. The Rechnungsnummer (BT-1)
must appear in the XML. So:
- We can't build the XML before allocating the number (circular dependency).
- We can't write the einvoice fields after the row is frozen.

Solution: orchestrate in Python within ONE transaction. The atomic flip is kept
in a new DB function `core.rechnung_finalize_issue` that re-locks the row,
checks status='draft', and performs the single UPDATE (status + number + dates +
tax snapshot + einvoice fields) in one shot. The `allocate_number` counter is
part of the same transaction; if any later step raises (XML invalid, validator
unreachable), the txn rolls back and the counter reverts — **no burned number**.

The existing `core.issue_rechnung` is retained for backward compat with tests
that don't go through the XRechnung path.

## Party master data gap

A valid EN 16931 invoice needs fields not present in the v1 schema:

| Field | Source | EN 16931 |
|---|---|---|
| Seller postal address | `adresse` ← `tenant_billing_profile` | BG-5 (mandatory) |
| Seller IBAN | `bankverbindung` ← `tenant_billing_profile` | BT-84 (SEPA credit transfer) |
| Seller electronic address | `tenant_billing_profile.elektronische_adresse` | BT-34 |
| Buyer postal address | `adresse` ← `auftraggeber` | BG-8 (mandatory) |
| **Leitweg-ID** | `auftraggeber.leitweg_id` | BT-10 (mandatory for B2G) |

Modeled as normalized tables (`adresse`, `bankverbindung`) rather than columns
on existing tables. Auftraggeber gets `adresse_id`, `leitweg_id`,
`elektronische_adresse`, `eas_scheme`. Rechnung gets `rechnungsdatum`,
`faelligkeitsdatum`, `leistungsdatum` (set atomically at issue).

## Unit codes

`einheit` on `rechnung_position` stays free-text. The builder maps it to
UN/ECE Rec 20 at build time via `units.map_einheit()`. Unknown units → `None`
→ the `einvoice_master_data` check records a hard failure so the reviewer sees
it before attempting issue.

The map covers the Maler/Bodenbelag trade set: `m2→MTK`, `m→MTR`, `lfm→MTR`,
`Stk→H87`, `h→HUR`, `pauschal→C62`, `kg→KGM`, `l→LTR`, `t→TNE`, etc.
Extend as new leistungen are added.

## KoSIT validation in prüfen (preview) vs. ausstellen (final)

- **prüfen** builds a structurally valid preview XML with number="PREVIEW" and
  today's date. Neither BT-1 nor BT-2 affects EN 16931 validity rules. If the
  preview fails, the reviewer sees a hard `einvoice_en16931` check failure.
- **ausstellen** re-validates with the real allocated number. If it fails (e.g.
  due to data changed between prüfen and ausstellen), the txn rolls back and no
  number is burned.

Double-validation is intentional: `prüfen` catches problems early; `ausstellen`
is the legal gate.

## Filesystem original store (directive 04, minimal slice)

Content-addressed: `DOCUMENTS_DIR/{tenant_id}/{sha256hex}`. Atomic write
(tmp+rename). Write-once: if the file exists (same hash), skip the write.
`document` table row recorded; `rechnung.einvoice_artifact_id` → FK to that row.

The validation report is also stored as a `document` row (kind=`einvoice_report`,
retention_class=10). This preserves the evidence of the validation outcome.

The full directive-04 round replaces this with S3/WORM. The module interface
(`store_original(conn, tenant_id, kind, content)`) is stable across backends.

## STEUERBERATER FLAGS (must be reviewed before first production issue)

1. **VAT category for Kleinunternehmer**: current code uses category `E`
   (TaxExemptionReasonCode `VATEX-EU-O`, reason text "§ 19 UStG"). Some
   authorities prefer category `O` (Not subject to VAT per national law). The
   correct code and text depend on the buyer's receiving system and the tax
   advisor's interpretation.
2. **EAS scheme codes** (`eas_scheme`): current default `EM` (email) is commonly
   accepted in XRechnung B2G routing but must be confirmed for each buyer's
   e-invoicing portal (Leitweg-ID routing infrastructure).
3. **Leitweg-ID correctness**: the seeded value `991-12345678-06` is a dev
   placeholder. Each real public buyer must supply their own verified Leitweg-ID.
4. **Payment terms** (`zahlungsziel_tage=30` default): must be agreed per client
   contract. The XRechnung DueDate (BT-9) is derived from this.
5. **§ 19 UStG threshold**: the `kleinunternehmer` flag in `tenant_tax_profile`
   must be reviewed annually if turnover approaches the threshold. Incorrect
   VAT treatment on a real invoice can void it.

## What is NOT built (this round)

- ZUGFeRD / CII hybrid (B2B): deferred.
- GAEB DA import/export + roundtrip check: own round.
- Percentage-based Nachlass/Zuschlag: v1 absolute amounts only.
- Full directive-04 S3/WORM object store.
- Human-readable invoice PDF.
- Leistungsdatum derivation from projekt/auftrag: currently defaults to today.
