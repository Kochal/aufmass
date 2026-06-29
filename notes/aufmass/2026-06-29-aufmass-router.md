# 2026-06-29 — Aufmaß router + DB write design decisions

Area: aufmass

## What this builds

The API layer connecting `vision_client.extract()` to the `aufmass` /
`aufmass_entry` DB tables (migration 0020). Two routers:

- `POST /api/aufmass/upload` — accepts a photo, runs two-step Mistral
  extraction, stores the original, writes aufmass + all entries, returns
  the full sheet with entries for immediate human review.
- `POST /api/aufmass` — manual capture mode (no image, quelle='manual').
- `GET /api/aufmass`, `GET /api/aufmass/{id}` — read (with embedded entries on get-by-id).
- `DELETE /api/aufmass/{id}` — soft-delete.
- `POST /api/aufmass-entry` — add entry to a manual aufmass.
- `GET /api/aufmass-entry?aufmass_id=`, `GET /api/aufmass-entry/{id}`.
- `PATCH /api/aufmass-entry/{id}/confirm` — human confirms (review_status='confirmed').
- `PATCH /api/aufmass-entry/{id}/correct` — human corrects value(s) (review_status='corrected').
- `DELETE /api/aufmass-entry/{id}` — soft-delete.

## Transaction timing on upload

The Mistral two-step extraction takes ~14s. The `db_session` dependency
wraps the whole request in `conn.transaction()`. To avoid holding the
transaction during the API call, the code calls `extract()` BEFORE the
first DB write. psycopg3 starts the transaction on the first SQL command,
so the 14s wait runs with no open transaction. Once extraction returns,
the document store + aufmass + entries are written in a single short
transaction.

**Assumption**: for this single-firm dev stack (2–5 concurrent field users),
a 14s request is acceptable. If concurrent uploads become a problem, move
extraction to a background task (Celery / ARQ) with job-id polling.

## raw_text and is_deduction storage

The `aufmass_entry` table (migration 0020) has no `raw_text` or
`is_deduction` column. Both are stored in `candidate_readings jsonb` as:
```json
{"raw_text": "3,86 x 3,24", "candidates": [...], "is_deduction": false, "struck": false}
```
The reconciler reads `expression` for arithmetic and `candidate_readings`
for candidate glyph alternatives. `raw_text` in `candidate_readings` is
available to the review UI for human-readable context.

**What would invalidate this**: if the reconciler or review UI needs
`raw_text` or `is_deduction` as typed, queryable columns (e.g. for
filtering or indexing). Then add columns via migration rather than reaching
into jsonb.

## computed_result and reconciled

Both are left at their DB defaults (NULL and false) after extraction.
Setting these is the reconciler's job (directive 07 §3). The review UX
shows `written_result` (what the builder wrote) and `confidence` as the
primary signals; `computed_result` is populated in a later reconcile step.

## German decimal conversion

`AufmassEntry.written_result.value` is a string like "3,86". Conversion:
`Decimal(value.replace(",", "."))`. On parse failure (model emits "?",
"x", or similar non-numeric) the field is stored as SQL NULL. The
reconciler flags NULL `written_result` entries for human review.

## Confidence precision

The DB column is `numeric(5,4)` (max 0.9999). Extracted confidence is a
Python float. Stored as `Decimal(f"{float(val):.4f}")` to avoid float
precision bleed.

## Upload MIME restriction

Accepted: `image/jpeg`, `image/png`, `image/webp`. Content-type from the
browser upload is trusted (it is set by the browser from the file
extension). A real MIME check (python-magic) is out of scope for v1;
the Mistral API will reject invalid binary anyway.

## Tests without Mistral

The upload test is skipped when `MISTRAL_API_KEY` is not set. All other
tests create aufmass rows with `quelle='manual'` and entries via the
`POST /api/aufmass-entry` endpoint, exercising the full CRUD and review
flow without the extraction step.
