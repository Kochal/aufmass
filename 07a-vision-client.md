# 07a - Vision Extraction Client

The client that turns one prepared Aufmaß image into the structured
candidates of `07`, by calling the served vision model behind an
OpenAI-compatible endpoint. Companion to `07` (which owns the reconciliation
that consumes this client's output) and `03` / `10` (serving and lanes).

Audience: you (Claude Code) and any human contributor.

## Changelog
- 2026-06-23: Initial draft.

-----

## What it is

A Python module (lane per `10`) that sends an image plus the extraction
prompt to the model and returns parsed candidates. It is part of the
orchestration layer, not the model: it does no arithmetic and makes no final
decision. Every number it returns is a candidate with a confidence and a
source box, handed to the deterministic reconciler in `07`.

## Configuration (env only, never hardcoded)

- `MODEL_ENDPOINT`: the OpenAI-compatible base URL (ends in `/openai/v1`).
- `MODEL_API_KEY`: the bearer token (the RunPod key in the PoC; read from
  `.env`, which is gitignored).
- `MODEL_NAME`: the served model id (e.g. `Qwen/Qwen2.5-VL-7B-Instruct`).

## Interface boundary (the reason this is a module)

The client knows only an OpenAI-compatible base URL. No RunPod-specific
calls. Swapping the PoC endpoint for the German host later (`03`) is one env
change, not a code change. Use the OpenAI client pointed at `MODEL_ENDPOINT`.

## Request

- `chat.completions`, `model = MODEL_NAME`, `temperature = 0`.
- One image as a base64 data URL plus the extraction prompt
  (`aufmass-extraction-prompt.md`).
- Force valid JSON with structured output (guided JSON / `response_format`
  against the prompt's schema) so the reply parses deterministically.

## Timeout and retry (cold start is real)

Serverless scales to zero and may download the model on a cold start, so the
first call after idle is slow.

- Generous request timeout (start ~300s) so a warming worker is not read as a
  failure.
- Retry with backoff on timeout, connection error, and 5xx. The call is
  idempotent (temperature 0, no side effects), so retry is safe.
- Distinguish a cold-start delay from a real error in logs, so a slow first
  call does not look like a bug.

## Output handling (candidate, not truth)

- Parse the JSON. On parse failure, one re-ask, then route the sheet to manual
  review rather than guessing.
- Never trust a value. The client returns the structure as-is; the
  reconciler (`07`) does the math, the band checks, and the accept/queue
  decision. The client must not compute, round, or "fix" anything.
- Image preprocessing (deskew, orientation, downscale to the `max_pixels`
  budget) happens before the call (`07`); the client receives a prepared
  image.

## Provenance and failure

- Record `MODEL_NAME` and endpoint with the result (`03` traceability); store
  the source image as an immutable `document` (`04`); keep each entry's bbox
  and confidence (`07`).
- If the model is down, the call fails cleanly and the sheet queues; manual
  Aufmaß entry still works (`03` degradation).

## Open questions

1. **bbox convention**: confirm during benchmarking whether the model returns
   boxes as 0..1 fractions as the prompt asks, or pixel coords; normalise in
   the client if needed.
2. **Timeout / retry numbers**: tune against observed cold-start times.
