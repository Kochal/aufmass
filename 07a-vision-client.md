# 07a - Vision Extraction Client

The client that turns one prepared Aufmaß image into the structured
candidates of `07`, by calling Mistral Document AI behind the endpoint-interface
boundary. Companion to `07` (which owns the reconciliation that consumes this
client's output) and `03` / `09` (named processor allowlist, DPA).

Audience: you (Claude Code) and any human contributor.

## Changelog
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
native bounding boxes, word-level confidence, structured output without
free-form parsing. The 2026-06-27 PoC showed the 7B self-hosted VLM was
fundamentally inadequate (hallucination, print-vs-handwriting confusion,
context overflow, pixel-coord bboxes). Mistral Document AI (`mistral-ocr-4-0`)
is EU-native (residency + sovereignty for B2G), returns native 0..1 bboxes and
word-level confidence, supports guided decoding via Pydantic annotation, and
has a self-hosting escape hatch. Full rationale in
`notes/aufmass/2026-06-28-mistral-document-ai-pivot.md`.

**Fallback**: if Mistral is unavailable or a future benchmark favours a
self-hosted VLM (e.g. Qwen2.5-VL-32B+), the endpoint-interface boundary means
the swap is one module change, not a codebase change.

## Configuration (env only, never hardcoded)

- `MISTRAL_API_KEY`: the Mistral API bearer token.
- `MISTRAL_MODEL_ID`: pinned to `mistral-ocr-4-0` (change requires a note +
  changelog line).

## Interface boundary (the reason this is a module)

The client is the only place in the codebase that knows how to call Mistral
Document AI. All callers receive the same `dict` of candidates — they do not
know or care whether the extraction came from Mistral or a self-hosted fallback.
Swapping the endpoint is one module change, not a codebase change.

## Request shape (Mistral SDK)

Use the official **`mistralai` Python SDK**, `client.ocr.process(...)`:

```python
from mistralai import Mistral

response = client.ocr.process(
    model="mistral-ocr-4-0",
    document={"type": "image_url", "image_url": data_url},
    document_annotation_format=AufmassExtractionResult,   # Pydantic model
    document_annotation_prompt=ANNOTATION_PROMPT,
    confidence_scores_granularity="word",
    include_blocks=True,
    extract_header=True,
)
```

**`document_annotation_format`**: the `07` entry/expression-tree schema as a
Pydantic model (`AufmassExtractionResult` with `entries: list[AufmassEntry]`).
The SDK serialises this to a JSON schema for guided decoding — no free-form
parsing or fence-stripping needed.

**`document_annotation_prompt`**: instructs the model:
> "Extract handwritten measurements only. Ignore all printed column headers
> (Länge / Breite / Höhe / Stück and their variations). Do not compute any
> arithmetic — emit operands and operators as separate fields."

**`confidence_scores_granularity="word"`**: word-level confidence floats in
[0, 1]. These seed the deterministic candidate-glyph reconciliation in `07`.

**`include_blocks=True`, `extract_header=True`**: expose block-level structure
for label (Bauteil) extraction and sheet-header identification.

## Bboxes and confidence (native — no client-side normalisation)

Mistral OCR 4 returns bboxes as 0..1 fractions of image width/height and
word-level confidence as floats in [0, 1]. These are passed through directly
to the reconciler. The pixel-coord normalisation workaround from the 7B PoC
is dropped.

## Output (candidate, not truth)

The `extract()` function returns a `dict` matching the `07` entry schema, plus
provenance keys:
- `_model`: the `MISTRAL_MODEL_ID` used.
- `_endpoint`: `api.mistral.ai` (or the override if a self-hosted fallback is
  active).

The reconciler (`07`) does all arithmetic, band checks, and the accept/queue
decision. The client must not compute, round, or "fix" anything.

## Two-step fallback (benchmark-gated, not pre-built)

If `document_annotation_format` underperforms on real sheets (i.e. the
structured annotation is worse than raw OCR + a text model), a two-step path
can be added:
1. Raw OCR with Mistral OCR 4 (`include_blocks=True`, no annotation).
2. A cheap Mistral text model structures the raw OCR into the entry schema.

This is not pre-built — benchmark the annotation path first. Only add the
two-step variant if the annotation step underperforms.

## Retry and error handling

- Generous timeout (300s) for the API call.
- Retry with exponential backoff (`[5s, 15s, 45s]`) on network errors and 5xx.
- On persistent failure: raise `ExtractionError`; the sheet routes to manual
  review. The firm is never blocked (per `03` degradation).

## Provenance

Record `MISTRAL_MODEL_ID` and `api.mistral.ai` with every result. Store the
source image as an immutable `document` (`04`). Keep each entry's bbox and
confidence (`07`).

## Compliance

Mistral Document AI is on the `03` named EU-native processor allowlist.
A signed **DPA** and **no-training tier** are required before first production
call. **Status: DPA pending sign-off** — see
`notes/aufmass/2026-06-28-mistral-document-ai-pivot.md` and `09`.

Handwritten Aufmaß images are submitted; no other customer data is sent.
Images may contain spatial data (room dimensions, property layouts);
minimise: submit only the image.

-----

## Open questions

1. **Annotation vs two-step quality**: benchmark `document_annotation_format`
   against the raw-OCR + text-model path on real firm sheets before deciding
   whether to pre-build the two-step fallback.
2. **Timeout / retry numbers**: tune against observed Mistral API latency on
   real calls.
3. **Image size budget**: confirm Mistral OCR 4's max image dimensions/bytes
   and whether downscaling preprocessing is needed for high-res photos.
