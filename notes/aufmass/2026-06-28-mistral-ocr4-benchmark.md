# 2026-06-28 — Mistral OCR 4 benchmark (mistral-ocr-4-0)

/ area: aufmass / status: pipeline working; bbox gap identified; next: bbox mapping /

## What was tested

- `api/app/aufmass/vision_client.py` (new Mistral client)
- `api/app/aufmass/schema.py` (new Pydantic annotation schema)
- Model: `mistral-ocr-4-0` via `api.mistral.ai`
- Image: `data/Handaufmaß Bsp.1.pdf` page 1, 2× scale JPEG (508 KB, 1191×1684px)
- SDK: `mistralai==2.5.0` (v2 SDK — see SDK notes below)

## Findings

### What works

1. **No hallucination**: 25 meaningful entries vs. 50× dummy `0,86 x 0,24 / Wand`
   from the 7B PoC. Each entry corresponds to real content on the sheet.

2. **Expression tree parsing**: correct nested structure including multi-arg sum
   and triangle (`(a + b + c) × d`), truncated expression flagged ("missing
   operand after 'x'"), "dito" correctly handled as a non-numeric reference.

3. **Deductions**: `is_deduction: true` correctly set on two Abzug entries.

4. **German decimal commas**: preserved throughout ("3,86" not "3.86").

5. **Bauteil labels extracted**: "Schrög Links", "Türwand", "Bad", "Flur", etc.
   Handwritten abbreviations handled ("Bode" → noted as likely "Boden").

6. **Confidence scoring**: sensible per-entry values; unreadable entries
   (`"(cath"`, `"Winkel zu Deppen"`) correctly flagged with low confidence.

7. **Guided decoding via JSON schema**: no fence stripping, no truncation
   salvage, no re-ask needed. 1 API call → valid structured JSON.

### What does not work (gaps)

1. **bbox is null on all 25 entries**: `document_annotation_format` returns
   semantic annotations only — the bounding boxes live in `response.pages[0].blocks`
   (raw OCR output), not in the `document_annotation` field. To wire bboxes:
   - Either: raw OCR pass (blocks) + post-process: text-match each annotation
     entry against the blocks to assign a bbox. Feasible but requires a
     matching step.
   - Or: two-step path (raw OCR → cheap structuring model). Benchmark-gated
     per directive 07a.
   This is a design gap, not a quality failure. The verification UX (source crop)
   requires bboxes; this is on the critical path before `review_status` can be
   auto-populated.

2. **Word-level confidence not surfaced**: same root cause as above —
   `confidence_scores_granularity="word"` populates `response.pages[0].blocks[*].words`
   in the raw OCR, not in the annotation. Would need the same text-match step
   to propagate word confidence to annotation entries.

3. **written_result is null on all entries**: the sample sheet's workers did not
   write pre-computed results next to the formulas; this is correct behaviour.
   Tune when sheets with hand-computed results are tested.

### SDK notes (mistralai v2)

The v1 `from mistralai import Mistral` import path does not exist in v2.
Correct v2 imports:
```python
from mistralai.client import Mistral
from mistralai.client.models.jsonschema import JSONSchema
from mistralai.client.models.responseformat import ResponseFormat
```

`document_annotation_format` takes a `ResponseFormat(type="json_schema", json_schema=JSONSchema(...))`,
not a Pydantic model class directly. The `document_annotation` response field is
a **JSON string**, not a parsed object — parse with `model_validate_json()`.

`confidence_scores_granularity` accepts only `"word"` or `"page"` (not `"block"`).

Dependency pinned to `>=2.0` in pyproject.toml and Dockerfile.

## What this means for open questions

**07a open question 1** (annotation vs two-step quality): annotation works well
for the semantic structure. The two-step path is needed only if we want native
per-entry bboxes without the post-process text-match. Recommend:
- Implement the text-match bbox assignment (map annotation entries → raw OCR
  blocks by string similarity) before deciding whether a two-step fallback is
  necessary.

**07a open question 3** (image size): 508 KB / 1191×1684px processed fine in
a single call. No size limit hit. Monitor for very high-res photos.

**07 open question 1** (confidence thresholds): word confidence is available in
the raw OCR blocks but not yet wired to annotation entries. Until the
text-match step is in place, use the annotation-level `confidence` field for
thresholding.

## Next steps for 07

1. **bbox mapping**: in `_parse_annotation` or a post-processing step, use the
   raw OCR blocks from `response.pages[0].blocks` to assign bboxes to entries
   by matching `entry.raw_text` against block text (fuzzy or substring match).
2. **Benchmark on more sheets**: the sample sheet is a single-page loft/attic
   measurement. Test on sheets with more complex layouts and printed grids.
3. **Annotation prompt tuning**: "D" prefix for Dach/Decke, "W." for Wand
   should be recognised as Bauteil prefixes, not orphan characters.

## Related

- [[2026-06-28-mistral-document-ai-pivot]] (decision to pivot)
- [[2026-06-27-vision-client-poc-benchmark]] (7B baseline this beat)
- [[2026-06-24-aufmass-db-layer]] (schema these entries write into)
