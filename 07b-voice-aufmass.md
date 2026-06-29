# 07b - Voice Aufmaß Client

The client that turns one spoken Aufmaß recording into the structured candidates
of `07` — the voice counterpart to `07a` (vision). Companion to `07` (which owns
the reconciliation that consumes this client's output), `03` (ASR and structuring
model serving), `02` (`quelle=voice` schema), and `09` (audio as personal data).

Audience: you (Claude Code) and any human contributor.

## Changelog
- 2026-06-29: Initial draft. Voice established as a co-equal capture path alongside
  photo/vision. Pipeline specified: Whisper ASR → self-hosted structuring → same
  AufmassExtractionResult schema → 07 reconciler. Audio-segment-ref as the crop
  analog. See notes/aufmass/2026-06-29-voice-aufmass-design.md.

-----

## What it is

A Python module (lane per `10`) that sends an Aufmaß audio recording through a
two-step ASR + structuring pipeline and returns the same structured candidates
`07a` produces. It is part of the orchestration layer, not the model: it does no
arithmetic and makes no final decision. Every number it returns is a candidate with
a confidence and a source span, handed to the same deterministic reconciler in `07`.

## Co-equal with vision (`07a`)

Photo capture (`07a` / Mistral Document AI) and voice capture (`07b` / Whisper ASR)
are **first-class peers** — the worker chooses per situation:

```
Photo → 07a (Mistral Vision) ──┐
                               ├──> 07 reconciler ──> aufmass_entry rows
Voice → 07b (Whisper ASR)   ──┘
```

Both produce the same `AufmassExtractionResult` shape; the reconciler is
source-agnostic. The worker picks what is natural at the Baustelle — gloves and a
ladder may make photo impractical; background noise may make voice impractical.

**The voice path is also the egress-free path.** Whisper and the structuring model
are fully self-hosted; no audio or transcript leaves the firm's EU/EEA server.
This makes voice a real hedge against vision performance or DPA delays — if Mistral
is unavailable, produces poor results, or the DPA is delayed, voice keeps working
with no dependency on any third-party processor. See
`notes/aufmass/2026-06-29-voice-aufmass-design.md`.

## Configuration (env only, never hardcoded)

- `ASR_ENDPOINT`: self-hosted faster-whisper endpoint (default: `http://localhost:8001`).
- `ASR_MODEL_ID`: pinned, e.g. `whisper-large-v3` (change requires a note +
  changelog line).
- `STRUCTURE_ENDPOINT`: self-hosted text LLM endpoint.
- `STRUCTURE_MODEL_ID`: the structuring model (benchmark to choose; change requires
  a note + changelog line).

## Interface boundary

The voice client is the only place in the codebase that knows how to call the ASR
and structuring endpoints. All callers receive the same `dict` of candidates;
they do not know or care whether extraction came from vision or voice. Swapping
or repointing an endpoint is one module/env change.

## Pipeline

### Step 1 — ASR (Whisper large-v3, faster-whisper, self-hosted)

```python
# Pseudocode — final SDK choice made in the code round
resp = asr_client.transcribe(
    audio_bytes=audio_bytes,
    language="de",
    response_format="verbose_json",  # word/segment timestamps
)
transcript = resp.text
segments   = resp.segments  # [{start, end, text}, ...]
```

- Model: `whisper-large-v3` via `faster-whisper`, German.
- **Segment timestamps** are captured alongside the transcript — these seed the
  audio-segment-ref assignment in step 3.
- Self-hosted on the EU/EEA server (`03`). No audio leaves the server.

### Step 2 — Transcript structuring (self-hosted text LLM)

The transcript is fed to a self-hosted text LLM with a system prompt that describes
German measurement-dictation conventions. The model emits the **same
`AufmassExtractionResult` JSON schema** that `07a` produces — reuse of
`api/app/aufmass/schema.py` (`AufmassExtractionResult`, `AufmassEntry`,
`ExpressionLeaf`, `ExpressionNode`).

**System prompt content:**
- German measurement-dictation patterns: "Wand drei Meter sechsundachtzig mal zwei",
  "Bauteil Decke", "Abzug Fenster", "dito", "Seite zwei".
- Number-word → German decimal mapping: "drei Meter sechsundachtzig" → `3,86`;
  "null Komma sieben vier" → `0,74`; "zweiundvierzig" → `42`.
- **Do not compute** arithmetic — emit operands and operator only.
- Preserve structure: ABZUG → `is_deduction=true`; Bauteil label → `bauteil` field.
- Unrecognised dictation → emit raw_text with low confidence.
- Struck / cancelled measurement → `struck=true` if the speaker says "streichen"
  or "weg".

The structuring model routing is self-hosted preferred (egress-free); a named
EU-native API model may be benchmarked as an alternative per `03`'s per-step
routing framework. Benchmark result determines final model choice; document the
decision as a note + changelog line.

### Step 3 — Segment-ref assignment

Map each extracted `AufmassEntry` to the audio segment(s) from which it was
read — the voice analog of `07a`'s image-crop bbox. Written to
`source_crop_ref` in `aufmass_entry`.

Assignment approach: match each entry's text tokens against the segment list
(most-matches wins), record the `{start_s, end_s}` span. Entries with no
token matches (e.g. "dito") keep `source_crop_ref=None`.

## Verification UX

Each extracted measurement is shown next to an **audio playback control** spanning
the matched segment — the voice counterpart to vision's image crop. The reviewer
confirms or corrects in seconds by listening to the clip, not by reading the full
transcript. This is the same `07` review workflow generalised: source crop = image
crop for photo entries, audio segment for voice entries.

## Output (candidate, not truth)

`extract()` returns the same `dict` shape as `07a.extract()`, plus provenance keys:

- `_asr_model`: e.g. `whisper-large-v3`.
- `_structure_model`: the self-hosted structuring model id.
- `_endpoint`: `self-hosted` (or the endpoint URL).

The reconciler (`07`) does all arithmetic, band checks, and accept/queue decisions.
The voice client must not compute, round, or "fix" anything.

## Retry and error handling

- Retry with exponential backoff on network errors and 5xx for both ASR and
  structuring steps.
- 4xx: non-retryable, raise `ExtractionError` immediately.
- On persistent failure: raise `ExtractionError`; the sheet routes to manual entry
  (`07`). The firm is never fully blocked by a voice endpoint outage (`03`).
- No fallback to vision: routing between capture modes is the worker's choice
  at capture time, not a silent fallback at extraction time.

## No schema change needed

The `02` schema already accommodates the voice path:
- `aufmass.quelle = 'voice'` — the enum already includes `voice`.
- `aufmass.source_document_id` — points to the immutable audio `document` (`04`).
- `aufmass_entry.source_crop_ref` — generalised to audio segment span.
- `aufmass_entry.expression`, `confidence`, `review_status` — source-agnostic.

**No migration is required.** The DB layer is complete.

## Compliance

Voice recordings of workers and any audible persons at the Baustelle are **personal
data**. The audio original is stored as an immutable `document` (`quelle=voice`,
`source_document_id`) and retained per `01`/`04` — it is the traceable source of
a billing-feeding measurement.

**The voice path is egress-free.** Whisper and the structuring model are
self-hosted; no audio, no transcript, and no entry leaves the firm's EU/EEA server.
No new named processor is added; no new DPA is required for this path.

Voice capture is **dictation**, not voiceprint identification. The audio is not
stored as a biometric template and is not used for speaker recognition. It is
therefore not special-category data under Art. 9 DSGVO (no biometric processing
in the Art. 9 sense). Confirm with the firm's Datenschutz if the firm records
customer voices (e.g. a client present on site). See `09`.

The Verzeichnis von Verarbeitungstätigkeiten (Art. 30) must list voice-capture
as a processing activity once this path is in production. See `09`.

-----

## Open questions

1. **Number-word → decimal reliability**: how accurately does Whisper + the
   structuring model convert German spoken numbers to the German decimal notation
   the reconciler expects? Benchmark on real Baustelle recordings before commit.
2. **German dictation conventions**: do workers actually dictate in a consistent
   pattern, or is free-form too ambiguous (e.g. does "mal" always mean ×, or
   sometimes a label)? The free-form approach is the plan; revisit if a first
   recording session shows systematic ambiguity.
3. **Segment-ref granularity**: word-level vs segment-level timestamps? Segment
   is simpler; word-level is more precise for multi-entry clips. Decide in the
   code round based on ASR output quality.
4. **Structuring model choice**: which self-hosted text LLM? Size / quality
   trade-off vs available server resources. Benchmark at least one German-capable
   model (e.g. a Llama 3.1 or Mistral variant, self-hosted). Document result.
5. **One-pass vs two-pass**: can Whisper + a post-processor handle structuring in
   one step (e.g. via a Whisper-based fine-tuned model), or is the two-step
   (ASR transcript → LLM structuring) the stable path? Two-step is the plan;
   revisit when real recordings are available.
6. **Customer audio at Baustelle**: if a customer is audible on the recording,
   their voice is also personal data. Does the firm routinely record in customer
   presence? Confirm with Datenschutz before go-live.
