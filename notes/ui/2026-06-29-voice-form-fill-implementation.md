# 2026-06-29 — Voice form-fill: implementation decisions

/ area: ui / status: implemented — POST /api/voice/intent live; wired into EntryCard /

## What was decided and why

### Form-level dictation over per-field mic

The worker speaks one dictation for the whole form ("Bauteil Boden, Messwert drei
achtzig, Einheit Quadratmeter") rather than tapping a mic per field. The LLM
receives the list of allowed fields and routes each phrase.

Tradeoff: more expressive for the worker (one recording per form section), but the
LLM can misroute. The confirm-before-commit strip makes misrouting visible and safe.
The backend is sent the field list so the LLM cannot invent fields that don't exist.

### Shared ASR module (app/voice/asr.py)

Both the Aufmaß pipeline (07b, aufmass/voice_client.py) and the form-fill endpoint
(10, routers/voice.py) now share a single `transcribe()` call in `app.voice.asr`.
The Aufmaß path uses the segment timestamps; the intent path ignores them. A single
swap from OpenAI API to faster-whisper in `asr.py` updates both callers.

### First landing: EntryCard correction form

The only built form in the app today. The EntryCard correction edit block (Aufmaß
entry review) now has a mic button. The hook lives in EntryCard; VoiceFillButton is
a pure presenter. The confirmation strip ("Erkannt — übernehmen?") is shown above
Speichern; Übernehmen populates the inputs, Speichern persists via the existing
unmodified correct mutation.

### PoC divergence from directive 07b

The directive says ASR should be self-hosted (faster-whisper, egress-free). The PoC
uses the OpenAI Whisper API (US egress, no DPA in place). This is the same known
divergence as the Aufmaß voice client. The ASR is isolated in `app.voice.asr._call_whisper_api`
(placeholder name in the comment) — production swap requires only that module.

## What would invalidate this

- Workers find form-level dictation confusing (expected per-field mic) — field trial.
- LLM misroutes more than ~15% in real conditions — switch to per-field mic (simpler,
  no routing logic needed; each mic tap sends only that field's spec).
- OpenAI Whisper German accuracy too low for field conditions — accelerates the
  move to self-hosted `large-v3`.

## Confidence

High for the architecture (two-gate confirm-before-commit, shared ASR module).
Medium for form-level routing accuracy — depends on real-world German dictation.

## Related

- [[07b-voice-aufmass]] (Aufmaß voice pipeline, shares ASR module)
- [[2026-06-29-voice-form-filling]] (design decisions from the spec round)
- [[2026-06-29-aufmass-field-surface]] (the surface this voice feature extends)
