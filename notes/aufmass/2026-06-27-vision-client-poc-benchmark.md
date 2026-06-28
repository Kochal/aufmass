# 2026-06-27 — Vision client PoC benchmark (RunPod / Qwen2.5-VL-7B)

/ area: aufmass / status: pipeline working, model undersized /

## What was built and tested

- `api/app/aufmass/extraction_prompt.md` — the extraction system prompt
- `api/app/aufmass/vision_client.py` — OpenAI-compatible client (directive 07a)
- `test_vision_client.py` — smoke-test script (repo root, not for production)

Tested end-to-end against RunPod serverless endpoint:
`Qwen/Qwen2.5-VL-7B-Instruct`, `max_model_len=8192`.

## Findings

### What works
- Auth (RUNPOD_API_KEY accepted via AliasChoices alongside MODEL_API_KEY)
- Markdown fence stripping (`_strip_fences`) — model wraps JSON in ```json despite instructions
- Truncation recovery (`_salvage_truncated`) — context limit hit on every complex sheet;
  client salvages complete entries and skips the cut-off last one
- Re-ask logic (parse failure → one follow-up, then ExtractionError)
- Provenance keys `_model` / `_endpoint` on every result

### What does not work at this model/context size
1. **Hallucination**: 7B generates repetitive dummy entries (~50× `0,86 x 0,24 / Wand`)
   that do not exist on the sheet. It cannot hold the full layout in context.
2. **Print vs. handwriting**: Model reads the printed form column headers ("Lange",
   "Breite", "Höhe", "Stck"…) as handwritten measurements — cannot distinguish the two.
3. **Context window too small**: A single complex sheet fills all 6959 output tokens
   (prompt uses 1233, total cap 8192). The model runs out of context before finishing.
4. **Bboxes in pixel coordinates**: Model ignores the "fractions of image width/height
   (0..1)" instruction and returns pixel coords instead. Needs client-side normalisation
   or a model that follows this instruction.

### vLLM model name case sensitivity
RunPod serves the model as `qwen/qwen2.5-vl-7b-instruct` (lowercase).
Sending `Qwen/Qwen2.5-VL-7B-Instruct` caused 500 errors until corrected.
Config default and .env MODEL_NAME must match the served model ID exactly.

## What this means for directive 07 open questions

**Open question 3 (confidence-to-action thresholds):** Moot at 7B — the raw extraction
quality is too low to calibrate thresholds against.

**GPU class / model sizing (directive 03 open question):** The 7B is definitively
inadequate for this task. Recommendation:
- Minimum target: Qwen2.5-VL-32B with 32k context window
- Preferred: Qwen2.5-VL-72B with 32k context
- GPU requirement: A100 80GB (32B fits) or 2×A100/H100 (72B fits)
- The EU/EEA residency constraint (directive 03) limits provider options;
  Hetzner GPU cloud, Scaleway, or OVH are candidates. RunPod EU regions also available.

## Immediate fixes applied to the client

1. `MODEL_GUIDED_JSON=false` default — vLLM without guided decoding enabled returns
   500 if `response_format={"type":"json_object"}` is sent.
2. Fence stripping on every response.
3. No re-ask on `finish_reason=length` — sending truncated response back as context
   causes 500 (context overflow). Salvage instead.
4. `RUNPOD_API_KEY` accepted as alias for `MODEL_API_KEY` (AliasChoices in config).

## What needs fixing before production

1. **Normalise bboxes** in `_call_with_retry` or `extract()`: if max(bbox) > 1, divide
   by image width/height. The client receives image dimensions from the caller.
2. **Larger model**: benchmark Qwen2.5-VL-32B on the same sheet; recalibrate if needed.
3. **Image preprocessing** (deskew, auto-rotate) per directive 07 — currently the
   caller passes raw converted-from-PDF bytes; a preprocessing step is needed.
4. **Move the test script** to `tests/aufmass/` once a proper pytest fixture is set up.

## Related
- [[2026-06-24-aufmass-db-layer]] (schema the engine writes into)
- [[07a-vision-client.md]] (directive for this module)
- [[03-infrastructure.md]] (GPU host decision, EU/EEA residency)
