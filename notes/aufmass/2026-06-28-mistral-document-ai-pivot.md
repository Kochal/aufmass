# 2026-06-28 — Mistral Document AI pivot (Aufmaß extraction)

/ area: aufmass / status: directive reconciliation complete; DPA pending; code round next /

## What was decided

Aufmaß extraction moves from the self-hosted VLM path (OpenAI-compatible
endpoint) to **Mistral Document AI** (`mistral-ocr-4-0`). This required
relaxing locked decision 3 from "self-hosted LLM only" to **co-equal
per-step routing**: self-hosted (EU/EEA server) and named, DPA-covered
EU-native model APIs are first-class options, each chosen on its merits per
step.

Affected directives: `00` (decision 3), `01` (DSGVO), `03` (infrastructure),
`06` (quotation), `07` (Aufmaß pipeline), `07a` (client spec), `09`
(processors/AVV), `CLAUDE.md`, `99-status.md`.

## Why

The 7B self-hosted VLM PoC failed on all four dimensions that matter for
handwritten Aufmaß sheets (see [[2026-06-27-vision-client-poc-benchmark]]):

1. **Hallucination**: generated ~50× dummy entries not on the sheet.
2. **Print-vs-handwriting**: read printed column headers as measurements.
3. **Context overflow**: sheet exceeded the 8192-token limit mid-output;
   `finish_reason=length` on every complex sheet.
4. **Bbox coordinates**: ignored the "0..1 fractions" instruction; returned
   pixel coords requiring client-side normalisation.

A self-hosted model adequate for this task (Qwen2.5-VL-32B with 32k context)
requires A100-class GPU hardware (~€2–4k/month on EU cloud). For a single
Maler-/Bodenbelagsbetrieb with bursty, human-in-the-loop Aufmaß workload,
that is cost-prohibitive. Serverless GPU adds cold-start latency of 60-100s
per call, which also does not fit.

**Mistral OCR 4** solves all four problems: purpose-built for dense handwritten
forms; `document_annotation_format` (Pydantic guided decoding) removes
free-form parsing; native 0..1 bboxes; word-level confidence per token;
EU-headquartered (no CLOUD Act exposure — residency **and** sovereignty, viable
for B2G). It also has a self-hosting escape hatch (Mistral enterprise / on-prem
deploy) if requirements change.

## Compliance posture change

This is a DSGVO posture change. The previous rule was "no data leaves to a
third-party model service." The new rule is "egress deny-by-default; named,
DPA-covered, EU-native model APIs are individually justified exceptions."

**What is required before first production call** (design constraints per
CLAUDE.md non-negotiable 8 — confirm with the firm's Datenschutz):

- [ ] Signed **DPA** with Mistral AI.
- [ ] **No-training tier** confirmed in writing (data used for OCR is not
  used to train Mistral's models).
- [ ] **EU residency** of processing confirmed in writing (inference in EU
  datacenters, not US).
- [ ] **Verzeichnis von Verarbeitungstätigkeiten** (Art. 30) updated to list
  Mistral as a processor for Aufmaß extraction.
- [ ] Customer **transparency** notice updated (Aufmaß images processed by
  Mistral AI).

Until all five hold: the `03` allowlist entry for `api.mistral.ai` must not
route production traffic. The existing manual Aufmaß entry path remains the
production path in the meantime.

## What would invalidate this decision

1. **Mistral DPA negotiations fail** — no acceptable no-training tier or EU
   residency guarantee. Fall back to procuring a self-hosted VLM (32B+).
2. **Mistral benchmark underperforms on real sheets** — annotation quality
   worse than expected; structured output hallucinations. Try the two-step
   fallback (raw OCR + cheap text model) first; if still poor, procure
   self-hosted.
3. **B2G client rejects the processing chain** — public sector client
   contracts sometimes prohibit any cloud processing. Mistral's self-hosting
   escape hatch resolves this; or route those specific tenants through a
   self-hosted fallback.
4. **Mistral changes pricing or data terms** — the model-id pin
   (`mistral-ocr-4-0`) and the endpoint-interface boundary (`07a`) make
   switching one module change.

## Confidence

High that Mistral OCR 4 is the right tool for this task. Medium that the
Mistral DPA terms will be fully acceptable. Low risk of lock-in (endpoint
boundary + self-host escape hatch).

## Technical shape (for the code round)

- SDK: `mistralai` Python SDK, `client.ocr.process(...)`.
- `document_annotation_format` = `AufmassExtractionResult` Pydantic model
  (new `api/app/aufmass/schema.py`).
- `document_annotation_prompt` = "handwritten only; ignore printed headers;
  no arithmetic."
- `confidence_scores_granularity="word"`, `include_blocks=True`,
  `extract_header=True`.
- Drop bbox normalisation (native 0..1).
- Drop truncation-salvage hack (guided decoding → no free-form parsing).
- Env: `MISTRAL_API_KEY`, `MISTRAL_MODEL_ID` (default `mistral-ocr-4-0`).
- Benchmark: re-run against `data/Handaufmaß Bsp.1.pdf`; record entry count,
  bbox precision, word confidence distribution.
- Two-step fallback (raw OCR → text model): benchmark first, build only if
  annotation underperforms.

## Related

- [[2026-06-27-vision-client-poc-benchmark]] (what failed and why)
- [[2026-06-24-aufmass-db-layer]] (schema the extraction writes into)
- [[2026-06-26-eu-eea-residency]] (residency rule this builds on)
