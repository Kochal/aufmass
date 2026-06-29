# 07a - Vision Extraction Client

The client that turns one prepared Aufmaß image into the structured
candidates of `07`, by calling Mistral Document AI behind the endpoint-interface
boundary. Companion to `07` (which owns the reconciliation that consumes this
client's output) and `03` / `09` (named processor allowlist, DPA).

Audience: you (Claude Code) and any human contributor.

## Changelog
- 2026-06-29: Two-step pipeline promoted to primary (and only) path. One-step
  `document_annotation_format` retired. Rationale: table-cell `|` delimiters
  caused the annotation model to split cross-cell expressions, producing wrong
  arithmetic downstream. Two-step: (1) raw `ocr.process` → markdown; (2)
  `chat.complete` with `mistral-small-latest` + JSON schema for structuring.
  Bbox assignment via token-match against raw OCR table rows (22/27 on sample
  sheet; non-numeric entries expected to miss). `_structure_model` provenance
  key added. `ExtractionError` is the sole degraded path → manual review.
  See notes/aufmass/2026-06-28-two-step-benchmark.md.
- 2026-06-28: Pivoted from OpenAI-compatible self-hosted VLM (RunPod/Qwen2.5-VL-7B,
  proven inadequate in the 2026-06-27 PoC benchmark) to Mistral Document AI OCR 4
  (`mistral-ocr-4-0`). Interface boundary and output contract unchanged; bbox
  normalisation dropped (native from Mistral); SDK changes from `openai` to
  `mistralai`. See notes/aufmass/2026-06-28-mistral-document-ai-pivot.md.
- 2026-06-23: Initial draft (OpenAI-compatible self-hosted VLM shape).

-----

## What it is

A Python module (lane per `10`) that sends a prepared Aufmaß image to Mistral
Document AI and returns structured candidates. It is part of the orchestration
layer, not the model: it does no arithmetic and makes no final decision. Every
number it returns is a candidate with a confidence and a source box, handed to
the deterministic reconciler in `07`.

## Endpoint choice (Mistral Document AI)

Aufmaß extraction requires a model purpose-built for dense handwritten forms:
native bounding boxes, structured output without free-form parsing. The
2026-06-27 PoC showed the 7B self-hosted VLM was fundamentally inadequate
(hallucination, print-vs-handwriting confusion, context overflow). Mistral
Document AI (`mistral-ocr-4-0`) is EU-native (residency + sovereignty for B2G),
has a self-hosting escape hatch, and performs correctly on real sheets (no
hallucination, expression trees parse correctly). Full rationale in
`notes/aufmass/2026-06-28-mistral-document-ai-pivot.md`.

**Fallback**: if Mistral is unavailable or a future benchmark favours a
self-hosted VLM (e.g. Qwen2.5-VL-32B+), the endpoint-interface boundary means
the swap is one module change, not a codebase change.

## Configuration (env only, never hardcoded)

- `MISTRAL_API_KEY`: the Mistral API bearer token.
- `MISTRAL_MODEL_ID`: pinned to `mistral-ocr-4-0` (change requires a note +
  changelog line).
- Structuring model: `mistral-small-latest` (hardcoded in module; change requires
  a note + changelog line).

## Interface boundary (the reason this is a module)

The client is the only place in the codebase that knows how to call Mistral
Document AI. All callers receive the same `dict` of candidates — they do not
know or care whether the extraction came from Mistral or a self-hosted fallback.
Swapping the endpoint is one module change, not a codebase change.

## Pipeline (two-step)

The one-step `document_annotation_format` path is retired. The two-step path is
required because `|` table-cell delimiters cause the annotation model to split
expressions workers write across the STCK and LV-POSITION columns — producing
two wrong entries and wrong arithmetic in the reconciler.

### Step 1 — Raw OCR (`mistral-ocr-4-0`)

```python
from mistralai.client import Mistral

resp = client.ocr.process(
    model="mistral-ocr-4-0",
    document={"type": "image_url", "image_url": data_url},
    include_blocks=True,
    extract_header=True,
)
markdown = resp.pages[0].markdown
```

No `document_annotation_format` or `document_annotation_prompt`. The raw page
markdown preserves the full row text across all cells, allowing the structuring
step to read cross-cell expressions as a unit.

### Step 2 — Chat structuring (`mistral-small-latest`)

```python
resp = client.chat.complete(
    model="mistral-small-latest",
    messages=[
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user",   "content": f"<markdown>\n{markdown}\n</markdown>\nExtract all measurement entries as JSON."},
    ],
    response_format=ResponseFormat(type="json_schema", json_schema=JSONSchema(
        name="AufmassExtractionResult",
        schema_definition=AufmassExtractionResult.model_json_schema(),
        strict=True,
    )),
    temperature=0.0,
)
result = AufmassExtractionResult.model_validate_json(resp.choices[0].message.content)
```

The system prompt describes the column structure (Bauteil, LÄNGE, BREITE, HÖHE,
STCK, ABZUG, SUMME, LV-POSITION/LEISTUNG), instructs the model that expressions
span cells (dangling operator → next cell continues), and includes a worked
example showing the cross-cell join pattern.

### Bbox assignment (post-step)

Bboxes (0..1 fractions) are assigned after structuring by matching each entry's
German-decimal numeric tokens against raw OCR table rows (most-matches wins),
then computing a proportional vertical slice of the table block bbox.
Entries with no numeric tokens (unreadable stubs, "dito") keep `bbox=None`.

### Known OCR-layer limitations (neither step fixes these)

- **Glyph misread** (e.g. `0,80` → `0,5`): consistent across image scales; the
  raw OCR text already has the wrong value. Mitigation: image-crop human review.
- **Multi-line cell truncation**: OCR collapses multi-line LV-POSITION cells to
  one line; sub-entries on additional lines are absent from the markdown.

## Output (candidate, not truth)

`extract()` returns a `dict` matching the `07` entry schema, plus provenance keys:
- `_model`: the OCR model (`MISTRAL_MODEL_ID`).
- `_structure_model`: the structuring model (`mistral-small-latest`).
- `_endpoint`: `api.mistral.ai`.

The reconciler (`07`) does all arithmetic, band checks, and the accept/queue
decision. The client must not compute, round, or "fix" anything.

## Retry and error handling

- Generous timeout (300s) applied to both API calls.
- Retry with exponential backoff (`[5s, 15s, 45s]`) on network errors and 5xx.
- 4xx: non-retryable, raises `ExtractionError` immediately.
- On persistent failure: raise `ExtractionError`; the sheet routes to manual
  review. The firm is never blocked (per `03` degradation).
- No fallback to one-step: one-step produces wrong expression trees for
  cross-cell formulas — wrong math is worse than a loud failure.

## Provenance

Record `MISTRAL_MODEL_ID`, `mistral-small-latest`, and `api.mistral.ai` with
every result. Store the source image as an immutable `document` (`04`). Keep
each entry's bbox and confidence (`07`).

## Compliance

Mistral Document AI is on the `03` named EU-native processor allowlist.
A signed **DPA** and **no-training tier** are required before first production
call. **Status: DPA pending sign-off** (PoC waived) — see
`notes/aufmass/2026-06-28-mistral-document-ai-pivot.md` and `09`.

`mistral-small-latest` is a Mistral EU-native endpoint; the same DPA applies.

Handwritten Aufmaß images are submitted; no other customer data is sent.
Images may contain spatial data (room dimensions, property layouts);
minimise: submit only the image.

-----

## Open questions

1. ~~**Annotation vs two-step quality**~~: **Resolved** (2026-06-29). Two-step is
   the primary path. See notes/aufmass/2026-06-28-two-step-benchmark.md.
2. **Timeout / retry numbers**: tune against observed Mistral API latency on
   real calls. Current: OCR ~0.4s, structuring ~13s on the sample sheet.
3. ~~**Image size budget**~~: **Resolved** (2026-06-28). 508 KB / 1191×1684px
   processed fine in a single call. Monitor for very high-res photos (no limit
   hit so far).
4. **Multi-line cell truncation**: no solution at the structuring layer. Options:
   targeted cell re-read with a cropped image; manual review flag when a
   LV-POSITION cell looks truncated (length heuristic). Tracked as open.
