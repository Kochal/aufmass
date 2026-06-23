# 2026-06-23 — Directive 06: the DB-enforceable layer (and what is deferred)

/ area: quotation / status: DB layer implemented (0015–0019); engine + ingestion
+ matching + e-invoice deferred to the app layer / confidence: high on the DB
slice, the rest is blocked on the app-stack decision /

## The split this directive forces

Directive 06 is the most AI-heavy part, but its own boundary (and 02) divides it
cleanly:

- **Model side** (self-hosted, 03): PDF extraction, embedding, semantic matching.
- **Deterministic engine** (application code): all arithmetic, tax application,
  the sense-check re-derivations, EN 16931 generation/validation. 02 is explicit:
  **"No money math in the database beyond storage."** So the engine is *not* the
  DB and *not* plpgsql.
- **Database**: stores committed values + provenance, and enforces the
  *boundary* — freeze/version/number an issued document, and refuse to issue one
  that has not passed the gate.

So the DB-appropriate slice is what I built; the engine is correctly absent from
the DB.

## What was built (migrations 0015–0019)

- `tenant_tax_profile` (0015) — tax *state*, snapshotted at issue.
- `leistungskatalog` + `leistung` (0016) — the firm's priced catalog.
- `gaeb_artifact`, `lv`, `lv_position`, `angebot` (0017) — angebot is a financial
  document (freeze + version chain); lv_position carries the match provenance and
  a stored, engine-computed `gesamtpreis`.
- `check_result` + `core.assert_issuable` + `core.issue_angebot` +
  `core.new_angebot_version` (0018) — sense-check results are stored and
  auditable; the issue gate refuses to issue over an unresolved hard failure or
  an unpriced/in-review position; issue snapshots tax + allocates the
  (non-gapless) Angebotsnummer; versioning chains the document group.
- `rechnung` completion: tax snapshot + e-invoice fields, `rechnung_position`
  with traceability and the tendered/measured Mengen for the billing-quantity
  rule; `issue_rechnung` re-issued with the same gate + snapshot (0019).

## Decisions / assumptions

1. **The gate is "no known hard failure", not "checks must exist".** The DB
   cannot know whether the engine ran; it enforces *don't issue over a recorded
   hard failure* and *don't issue unpriced/in-review positions*. "Checks must
   run / completeness" is the engine's responsibility. This is why the minimal
   foundation rechnung flow still issues with no checks present.
2. **`issue_rechnung` was enhanced, not replaced** — it keeps the gapless number
   + freeze from 0006 and adds the gate + tax snapshot. With no checks and no tax
   profile the behaviour is unchanged (foundation_test still passes). I used
   `coalesce` on the snapshot columns so an engine-set value is never overwritten.
3. **Versioning clones the header only.** `new_angebot_version` chains the
   document group and supersedes the prior; duplicating the LV content into the
   new draft is engine/app work (it is where the recalculation happens anyway).
4. **Committed money values are stored, never computed in SQL.** Tests supply
   `gesamtpreis`/totals as the engine would, to keep the boundary honest.

## Deferred — BLOCKED on the application-stack decision

These are directive-06 deliverables that cannot be built until the app language/
framework is chosen (CLAUDE.md, "Not yet decided"; decide in `notes/ops/`):

- the deterministic pricing/tax **engine** (Stage 3) and the sense-check
  **re-derivations** (Stage 4: arithmetic, plausibility bands, unit, zero-guard);
- **GAEB DA** parsing (deterministic) and **PDF** extraction (model, 03);
- **matching** to the Leistungskatalog (embeddings + rerank, 03), incl. the
  `leistung` embedding column and a vector index (pgvector?) — a storage choice
  that depends on the stack;
- **GAEB D84 export** and **XRechnung/ZUGFeRD (EN 16931)** generation +
  validation before issue.

Recommendation: make the app-stack decision next; it unblocks the 06 engine and
the 07 OCR pipeline both. See [[2026-06-23-migrations-and-test-tooling]].

## For the firm's review

- Plausibility-band cold start (06 open question 1) is an engine/policy choice.
- VOB/B Section 2(3) and the measured-quantity billing rule are legal nuance
  (01 caveat); the DB stores tendered+measured Mengen and a flag, the engine
  decides. Confirm material cases legally.

## Verified

`tests/quotation_test.sql` (19 checks: Q1–Q8) passes via `tests/run.sh` on
PostgreSQL 17 alongside the foundation (22) and operational (26) suites — 67
assertions, exit 0. See [[2026-06-23-operational-spine]].
