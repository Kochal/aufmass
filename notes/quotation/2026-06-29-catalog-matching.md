---
date: 2026-06-29
area: quotation
---

# Catalog matching — partial implementation and deferred path

## What is implemented

**Manual matching (fully live):**
The CatalogPicker in AngebotReview lets a reviewer search the catalog by code,
Kurztext, or Langtext and assign a Leistung to any LV position.  Keyboard
shortcut `c` opens the picker on the active position.  `setMatchMutation` writes
`matched_leistung_id`, `match_confidence=1.00`, `match_status='confirmed'` to the
DB.  This path is production-ready.

**Automatic string-similarity scan (partial, live):**
`api/app/katalog/matcher.py` implements a combined score:

```
score = (Jaccard(token sets) + SequenceMatcher ratio) / 2
```

Token sets exclude German stop-words (`und`, `oder`, `inkl`, …) and single chars.
Thresholds:

| Score | Effect |
|-------|--------|
| ≥ 0.80 | `match_status='auto'`, `matched_leistung_id` set |
| ≥ 0.55 | `match_status='review'` with suggestion set |
| < 0.55 | unchanged (unmatched) |

The matcher runs:
1. **Automatically on GAEB import** — immediately after positions are created,
   best-effort (a matcher failure does not fail the import).
2. **On demand via `POST /api/lv/{id}/catalog-match`** — triggered by the
   "Katalog abgleichen" button in AngebotReview (visible only when unmatched
   positions exist).

Even `match_status='auto'` positions still require the reviewer to press `a`
(Accept) before they are `'confirmed'`.  No position is confirmed without human
action (directive 00 engine boundary).

## What makes this partial

String similarity handles *near-exact phrasing* well:
- "Wände streichen 2× Dispersionsfarbe" → "Wände streichen" ✓
- "Decke weiß streichen" → "Decke streichen" ✓

It breaks on synonyms and German construction abbreviations:
- "WF anstr." → "Wandfläche anstreichen" ✗ (score ~ 0.15)
- "Bodenbelag verlegen" → "Parkett verlegen" ✗ (different words, same concept)
- "1K-EP" → "Einkomponenten-Epoxid" ✗

**What would raise confidence:**
Sentence embeddings trained (or fine-tuned) on German construction vocabulary
would capture semantic similarity across abbreviations and synonyms.  This is the
full `06` PDF-extraction + catalog-matching path from directive 06.

## Why the full path is deferred

Two blockers from directive 06 / 03:
1. **Model hosting**: embedding inference needs a GPU or a DPA-covered hosted
   endpoint.  The GPU pipeline is not yet allocated.  EU/EEA-hosted embedding
   APIs exist (e.g., Mistral Embed) but need DPA sign-off per directive 09.
2. **Cold-start data**: the catalog is new.  Recall rates are meaningless without
   hundreds of entries.  String similarity is the right first step — it adds value
   immediately and seeds the catalog review feedback loop.

## Confidence threshold rationale

0.80 for auto, 0.55 for review are conservative.  In a 40-entry construction
catalog the token-overlap score distribution clusters around 0.0–0.3 for non-
matches and 0.6–0.95 for correct matches.  The 0.55 floor cuts the tail where
a single shared word (e.g. "verlegen") causes a false positive.

If the catalog grows and false-positive rates become measurable, lower 0.55
cautiously.  Do not raise 0.80 — the reviewer catches everything at `a` anyway.

## Assumption

The matcher is tenant-scoped via RLS; no cross-tenant leakage is possible.
The `best_match()` function is pure (no DB I/O) and can be unit-tested without
a database.

What would invalidate this: if German construction vocabulary is too abbreviated
for string overlap to ever reach 0.55 reliably.  In that case move the 0.55
threshold down or replace with embedding cosine similarity entirely.

**Confidence: medium.**  The approach is sound for near-exact phrasing.
The full-embedding path remains the design target from directive 06.
