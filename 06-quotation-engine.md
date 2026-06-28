# 06 - Quotation Engine

From an incoming tender (RfP / Ausschreibung) to an issued Angebot, and from
there to an e-invoice-ready Rechnung. This is the most AI-heavy part of the
system and therefore the place the `00` boundary matters most: the model
extracts and matches, deterministic code calculates and validates, and no
number reaches an Angebot or Rechnung without passing a deterministic gate.

Schema in `02`, compliance in `01`, self-hosted models in `03`. This file
states the pipeline, the trust boundary at each stage, and the sense-check
layer.

Audience: you (Claude Code) and any human contributor.

## Changelog
- 2026-06-22: Initial draft. Ingestion (GAEB/PDF), matching, deterministic
  pricing, sense-check layer, review queue, Angebot and Rechnung output.
- 2026-06-22: Billing-quantity rule resolved (measured quantity governs under
  Einheitspreisvertrag, with Pauschal and VOB/B Section 2(3) qualifications);
  Nebenangebote and Bietergemeinschaft confirmed deferred.
- 2026-06-26: Application layer (deterministic core) built: `api/app/engine/`
  (pricing + checks), REST over 9 entities (tenant_tax_profile, leistungskatalog/
  leistung, angebot/lv/lv_position, rechnung/rechnung_position, check_result),
  action endpoints (berechnen/pruefen/ausstellen/version), seed extension, pytest.
  Deferred: XRechnung/KoSIT, GAEB, PDF+matching, plausibility bands. See
  `notes/quotation/2026-06-26-quotation-engine-api.md`.
- 2026-06-28: "Self-hosted models" section updated to cross-reference per-step routing (`03`);
  RfP/PDF extraction routing TBD but not forbidden under the new decision 3.
- 2026-06-26: Residency widened from German server to EU/EEA; self-hosted rule unchanged.
  See notes/infra/2026-06-26-eu-eea-residency.md.
- 2026-06-23: Built the DB-enforceable layer as migrations `0015`–`0019` with a
  test suite (`tests/quotation_test.sql`): tenant_tax_profile, leistungskatalog
  /leistung, gaeb_artifact, lv, lv_position (with match provenance), angebot
  (financial doc: freeze + version chain), check_result + the issue gate
  (`core.assert_issuable`, `core.issue_angebot`, `core.new_angebot_version`),
  and the completed rechnung billing path (tax snapshot, e-invoice fields,
  rechnung_position with traceability + tendered/measured Mengen). Per 02 the
  DB does no money math: committed values are stored, the gate refuses to issue
  over an unresolved hard check or unpriced/in-review positions, and tax is
  snapshotted at issue. DEFERRED to the application layer (blocked on the
  app-stack decision): the deterministic pricing/sense-check engine, GAEB/PDF
  ingestion, Leistungskatalog matching, and XRechnung/ZUGFeRD generation +
  EN 16931 validation. Detail in
  `notes/quotation/2026-06-23-quotation-db-layer.md`.

-----

## Pipeline overview

```
ingest -> extract LV -> match to Leistungskatalog -> price (deterministic)
       -> sense-check (deterministic gate) -> review queue (human)
       -> issue Angebot -> [award] -> Rechnung (XRechnung/ZUGFeRD)
```

Every stage records provenance: a committed price traces back to its LV
position, the catalog entry it matched, the pricing rule applied, and the
checks it passed (`00`, traceability). Nothing is an orphan number.

## The boundary (restated, because this is where it bites)

- **Model side**: turn unstructured or semi-structured input into structured
  candidates with confidence and a source reference. Extraction from PDF,
  semantic matching of a Langtext to a catalog Leistung.
- **Deterministic side**: all arithmetic, tax, plausibility, and the
  decision to accept. The model never multiplies a price, never sums a
  total, never has the final say on a number.
- Low confidence is queued for a human, never silently priced (`00`).

-----

## Stage 1: Ingestion and LV extraction

### GAEB (primary path)

German construction tenders are usually exchanged as GAEB DA files. The
phase is encoded in the extension:

- `.x83` / `.d83` Angebotsaufforderung (request for bid): what the firm
  receives.
- `.x84` / `.d84` Angebotsabgabe (bid submission): what the firm sends back.
- `.x81` / `.d81` the Leistungsverzeichnis itself.

- Parse GAEB DA XML 3.x as the main target; handle older GAEB 90 / 2000 flat
  formats as encountered, since a tender arrives in whatever the issuer used.
- Map directly to `lv` and `lv_position` (`02`): OZ (Ordnungszahl),
  Kurztext, Langtext, Menge, Einheit. **This is deterministic parsing, not
  the model.** The structure is given, so the model has nothing to
  hallucinate here.
- Keep the original GAEB file as an immutable `document` (`04`).

### PDF (fallback path)

- When a tender comes only as PDF, the model extracts positions into the
  same `lv_position` shape, with `source = pdf` and per-field confidence.
- PDF-sourced positions carry lower trust and route more aggressively to
  review. They never skip the sense-check.

-----

## Stage 2: Matching to the Leistungskatalog

Each `lv_position` Langtext is matched to a `leistung` in the firm's
Leistungskatalog (`02`).

- **Method**: vector similarity over catalog Langtext embeddings (stored per
  Leistung), then a model rerank/confirm step, producing ranked candidates
  with a `match_confidence`. Embeddings and matching currently self-hosted
  (`03`); routing TBD. No tender data leaves the EU/EEA.
- **match_status**: `auto` (confidence above the tenant threshold), `review`
  (below), or `confirmed` (a human accepted it). The threshold is a
  per-tenant setting (`02` `tenant_setting`); start conservative and loosen
  as the catalog and history mature.
- **No match**: a position with no acceptable candidate is flagged for manual
  pricing and offered as a candidate new catalog entry. It is never
  auto-priced.
- The firm's historical priced quotes feed both the matcher (which Leistung
  a Langtext maps to) and the plausibility bands below. The system gets
  better as it is used.

-----

## Stage 3: Pricing (deterministic only)

- `einheitspreis` comes from the matched `leistung` (or a human-entered value
  for manual positions). `gesamtpreis = menge * einheitspreis`, computed in
  `numeric` (`02`), never by the model.
- Zuschläge, Nachlass, and MwSt are applied by the engine. The tax treatment
  (regelbesteuert vs Kleinunternehmer, rate) is read from the tenant tax
  profile and **snapshotted onto the Angebot at issue** (`01`, `02`), so a
  later profile change does not rewrite an issued quote.
- The result is a set of committed values, each tagged with the rule that
  produced it.

-----

## Stage 4: Sense-check (the deterministic gate)

The point the firm cares about: a layer of deterministic rules stands
between extraction/matching and an issued Angebot, so a model slip cannot
quietly distort a quote. Every rule records pass/fail with detail; nothing
passes silently.

- **Completeness**: every mandatory LV position is priced; no missing
  positions versus the source LV.
- **GAEB round-trip**: the output structure matches the input. No positions
  added or dropped, OZ order preserved, Mengen and Einheiten unchanged from
  the tender. (The firm prices the tender; it does not silently restructure
  it.)
- **Unit consistency**: a position's Einheit matches the matched Leistung's
  Einheit (m2 vs lfm vs Stck vs psch). A unit mismatch is a likely bad match,
  not a price to trust.
- **Plausibility bands**: price per unit falls within the band for that
  Leistung or category, derived from the firm's history. Out-of-band prices
  are flagged, not blocked outright (genuine outliers exist).
- **Arithmetic integrity**: positions sum to subtotals and subtotals to the
  total; surcharge, discount, and tax math re-derived independently.
- **Zero / absurd guard**: no zero or implausibly small unit price on a
  priced position; no absurd magnitudes.

A hard failure (completeness, round-trip, arithmetic) blocks issue. A soft
failure (out-of-band price, unit mismatch) routes to review. The check
results are stored and auditable.

-----

## Stage 5: Review queue (human)

- Holds: low-confidence matches, unmatched positions, and soft sense-check
  flags. The reviewer confirms or corrects each.
- The UI shows each item against its source (the LV position, and for PDF the
  source region), so confirmation is fast and every committed value stays
  traceable (`00`).
- Reviewer actions are audited (`02`). Confirming a match can also write back
  to the Leistungskatalog (a new or refined entry), improving future runs.

-----

## Stage 6: Angebot issue

- Assemble `angebot` + `lv` + `lv_position` and move `draft -> issued`. At
  issue the Angebotsnummer is allocated from the Nummernkreis and the
  document is frozen and versioned (`02`). A later change creates a new
  version, it does not edit the issued quote.
- **GAEB D84 export**: the quote response goes back in the tender's own
  format (Angebotsabgabe), so it slots into the issuer's system cleanly.
- A human-readable PDF is rendered as a copy; when GAEB is the exchange, the
  GAEB file is the artifact of record.

-----

## Rechnung (invoicing path)

On award and after delivery (and Aufmaß, `07`, for measured quantities):

- Build `rechnung` from the Auftrag and the measured Mengen. Pricing and tax
  run through the same deterministic engine and sense-check as the Angebot.
- **E-invoice generation**: produce XRechnung or ZUGFeRD (EN 16931) and
  **validate against EN 16931 before issue**; an invalid invoice does not
  issue. B2G requires XRechnung today (`01`).
- The structured XML is the original and is archived unaltered (`04`); a PDF
  is only a rendering.
- Rechnungsnummer is allocated gaplessly at issue (`02`). Kleinunternehmer
  tenants get no-VAT invoices with the Section 19 note; all driven by the
  tenant tax profile (`01`).

-----

## Model routing for quotation steps (`03`)

Embedding and matching currently run self-hosted on the EU/EEA server. PDF
extraction routing is TBD — self-hosted text LLM or an EU-native model API
are co-equal options under `00` decision 3; decide when the step is built and
benchmark results are available. Deterministic stages (pricing, checks,
Angebot/Rechnung issue) depend on no model endpoint.

-----

## Resolved decisions (were open questions)

- **Nebenangebote / Varianten**: deferred. v1 does not model variant sets.
- **Bietergemeinschaft / subcontractor splits**: deferred. v1 assumes a
  single bidder.
- **Billing quantity (Schlussrechnung)**: the actually measured quantity
  governs billing under a unit-price contract (Einheitspreisvertrag): the
  Aufmaß quantity, not the tendered Menge, is invoiced. Two qualifications
  the engine honours, branching on `projekt.abrechnungsart` (`02`):
  - **Pauschalvertrag**: the agreed lump sum stands regardless of measured
    quantity; no override.
  - **VOB/B Section 2(3)**: where the actual quantity deviates from the
    tendered Mengenansatz by more than 10%, an adjusted Einheitspreis may be
    demanded for the part beyond the threshold. The engine computes the
    deviation and flags a past-threshold case for a priced decision rather
    than auto-applying the original unit price.
  Tendered and measured Mengen are both retained and the delta is shown on
  the Schlussrechnung. Legal nuance; confirm material cases per the `01`
  caveat. Mechanics of the measured quantity live in `07`.

## Open questions

1. **Plausibility-band cold start**: with little history, bands are wide and
   most prices pass. Seed bands from catalog price plus a percentage, or run
   review-heavy until history accrues? Drafted as review-heavy with a
   configurable threshold.
