# 2026-06-29 — Voice Aufmaß: co-equal capture path decision

/ area: aufmass / status: decided — voice is a first-class capture path; pipeline specced in 07b /

## What was decided

Voice Aufmaß is promoted from "optional" to a **co-equal capture path** alongside
photo/vision. Both feed the same `07` reconciler and produce the same
`aufmass_entry` rows. A new directive `07b-voice-aufmass.md` specifies the pipeline.
No schema migration is needed.

## Why co-equal, not just optional

Three reasons, in order of weight:

**1. Vision performance is uncertain.** Mistral Document AI (`07a`) works on the
sample sheet, but the two-step path has known limitations (OCR glyph misreads,
multi-line cell truncation). Real production sheets may be harder: poor lighting,
extreme angles, ink variations, non-standard grid layouts. Voice is a hedge: if
vision underperforms on a particular sheet or at a particular site, voice is
available as a first-class alternative — not an afterthought retrofit.

**2. The voice path is egress-free.** Whisper ASR + self-hosted structuring model
touch no third-party processor. This means:
- No DPA required for the voice path itself (vs Mistral's pending DPA for vision).
- No egress allowlist entry.
- If Mistral's DPA negotiation stalls or fails, voice provides a working path to
  production.

**3. Baustelle UX.** Gloves, ladders, and cramped corners are real constraints.
Photographing a sheet is easier than it sounds in those conditions. Voice may
actually be lower friction in field conditions for many workers, even if photo is
lower friction in the ideal case.

## What this does not mean

- Voice is **not** the default path. Photo/vision is the zero-habit-change path;
  voice requires the worker to learn dictation conventions and discipline.
- Voice is **not** a fallback that the system switches to silently. Routing between
  capture modes is the worker's choice at capture time.
- Voice still routes through the `07` reconciler. The reconciler is source-agnostic;
  it does not know or care whether an expression came from OCR or ASR.

## Pipeline shape

```
Audio recording
    │
    ▼
Whisper large-v3 (faster-whisper, self-hosted, German)
    │  transcript + word/segment timestamps
    ▼
Self-hosted text LLM (model TBD; benchmark first)
    │  AufmassExtractionResult JSON (same schema as 07a)
    ▼
Segment-ref assignment
    │  source_crop_ref = {start_s, end_s} of matched audio segment
    ▼
07 reconciler (source-agnostic)
    │
    ▼
aufmass_entry rows (quelle=voice, source_document_id=audio doc)
```

The audio clip is played back next to each extracted value during review — exact
parallel to vision's image-crop review.

## What would invalidate this

- German measurement dictation turns out to be too free-form for reliable
  number-word → decimal conversion, even with a well-tuned structuring prompt.
  Signal: first recording-session benchmark shows >20% wrong decimal placement.
- Workers find voice more disruptive than photo at the Baustelle (privacy concern
  about being recorded; background noise makes ASR unworkable). Signal: first
  field trial feedback.
- A self-hosted structuring model of adequate quality cannot fit on the available
  server hardware within budget. Signal: GPU class benchmark.

## Confidence

High for the architecture (co-equal, same schema, same reconciler). Medium for
dictation accuracy on real recordings — that requires a real-recording benchmark,
which is deferred to the code round.

## What was already in place (no schema change needed)

- `aufmass.quelle = 'voice'` — already in the migration `0020` enum.
- `aufmass.source_document_id` — already points to an immutable `document` (`04`).
- `aufmass_entry.source_crop_ref` — already generalised for any source reference;
  audio segment spans write here.
- `aufmass_entry.expression`, `confidence`, `review_status` — source-agnostic.

## Related

- [[07b-voice-aufmass]] (the directive — the "what")
- [[07a-vision-client]] (the vision counterpart)
- [[2026-06-28-two-step-benchmark]] (vision quality findings that motivated voice hedge)
- [[2026-06-28-ocr-quality-findings]] (OCR layer limits that voice avoids entirely)
