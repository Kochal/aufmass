# 2026-06-24 — Aufmaß DB layer (migration 0020 + guarantee suite)

/ area: aufmass / status: implemented, DB slice verified on PG17 /

## What was built

Migration `0020_aufmass.sql` materializes the schema `02` reserved for `07`:
`aufmass` (a capture session / sheet) and `aufmass_entry` (one measured thing).
Guarantee suite `tests/aufmass_test.sql` (tags AF1–AF8), wired into `run.sh`.
The full migration set + all four suites pass on a throwaway PostgreSQL 17
cluster; the AF8 trigger was teeth-checked (dropping it lets the blocked write
through).

## The line: what the DB owns vs the engine

`07`'s reconciliation — formula-as-checksum, candidate-glyph search, magnitude
bands, geometric cross-checks — is the deterministic *engine*, and it is
application-layer, exactly as money math is (`02`: "No money math in the
database"; the same logic applies to measurement math). So the migration stores
what the engine produces (`expression`, `candidate_readings`, `computed_result`,
`reconciled`, `confidence`, `source_crop_ref`) and the DB enforces only the
row-level guarantees plus one domain rule it *can* own: traceability at commit.

This is the deliberate division. The DB does not evaluate `3,86 x 3,02`; it
refuses to let an untraceable result be *committed* to billing.

## Decisions made here (beyond the directive prose)

- **`quelle`-driven original constraint.** `aufmass_original_present` CHECK:
  `foto`/`voice` must reference a `document` (the archived photo/audio), `manual`
  must not. This pins non-negotiable 4 (digital originals) at the row level.
  *Assumption:* the original `document` row exists before/at sheet creation. If
  capture turns out to create the sheet before the upload finishes, relax this
  to a deferred check or enforce only at confirm. Confidence: medium — revisit
  when the capture endpoint is built.
- **Prüfbarkeit floor as a trigger, not a blanket CHECK.**
  `core.check_aufmass_entry_pruefbar` fires only when an entry is *both*
  `lv_position_id`-linked *and* `review_status in ('confirmed','corrected')` —
  i.e. about to feed billing. Then it requires a result and (for foto/voice) a
  `source_crop_ref`; `manual` is its own trace via the audit actor. Entries in
  capture/review or not yet linked are deliberately free, so the capture and
  review workflows are never blocked. This enforces non-negotiable 6
  (traceability) and `01` prüfbares Aufmaß without touching the open *tuning*
  questions (thresholds, multi-candidate). Confidence: high.
- **Columns added beyond `02`'s catalog:** `aufmass_entry.einheit` (the magnitude
  band is per measurement type/unit, and a standalone entry needs a unit before
  any `lv_position` exists) and `review_status`
  (`review`/`auto_accepted`/`confirmed`/`corrected`) to carry the verification-UX
  state. Documented in the `02` and `07` changelogs.
- **`source_crop_ref` is jsonb** (crop box `{x,y,w,h}`), not a text ref — the
  directive calls it "crop coordinates", and the verification UX shows each
  number next to its crop, so coordinates are the useful shape.
- **`projekt_id` is NOT NULL.** Aufmaß always attaches to a Baustelle.
  "Standalone" in `07` means *no LV/tender yet* (`lv_position_id` null), not no
  project — so the nullable link is on `aufmass_entry.lv_position_id`, and the
  project link stays mandatory.

## What the suite proves (and what it deliberately does not)

Proven: RLS+audit inheritance, capture-mode integrity, the nullable/standalone
billing link, cross-tenant invisibility of a foreign `lv_position`, the
`aufmass` edit-lease, audited corrections, optimistic concurrency, soft-delete,
and the prüfbarkeit floor.

Not tested here (because it is not DB-owned): the reconciliation arithmetic, the
band/geometry plausibility checks, confidence-to-action thresholds. Those land
with the engine (`07` open questions 1–3) and get their own app-layer tests on
real sheets.

## Cross-tenant linking — the honest version

`02` claims cross-tenant reference is "impossible by construction (FK + policy)".
The suite tests the *realistic* property: under RLS T1 cannot even *see* T2's
`lv_position`, so it can never obtain the id to link (AF3). It does **not** assert
that a raw INSERT with a known foreign uuid is blocked at the FK level —
PostgreSQL RI checks do not run under the querying role's RLS, so that path may
not be blocked by FK+RLS alone. If we ever need to harden against a malicious
known-uuid insert, add a same-tenant CHECK/trigger on the link. Flagged, not
fixed.

Related: [[2026-06-23-quotation-db-layer]] (the `lv_position` this links to),
[[2026-06-23-cross-cutting-foundation]] (the inherited guarantees),
[[2026-06-23-migrations-and-test-tooling]] (why plain SQL + psql).
