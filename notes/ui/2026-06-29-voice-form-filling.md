# 2026-06-29 — Voice form/field filling: design decisions

/ area: ui / status: decided — voice form-fill specced in 10; confirm-before-commit is non-negotiable /

## What was decided

Voice input is added as a general app-wide input modality — not just for Aufmaß
capture, but for filling any form field in the PWA. The field worker can speak
instead of type. A new "Voice input" section is added to `10-application-stack.md`.

## Motivation

The Baustelle context makes typing on a phone hard: dirty or gloved hands, poor
lighting, small screen. Voice lowers friction for field data entry across the
app — working-time start/end, material notes, Auftraggeber names, Bauteil labels.
The PWA already targets field-first; voice is the natural complement to the camera
capability.

## The critical constraint: confirm-before-commit

Voice-derived values for **money, quantity, and any statutory record** must be
shown to the user for explicit confirmation before being committed to the database.
No voice input bypasses the confirm-before-commit pattern.

This is the same rule as model output generally (non-negotiable 1 in CLAUDE.md):
a model output — including a voice-derived field value — is a candidate, not a
committed truth. The worker speaks "drei Meter achtzig", the app shows "3,80 m",
and the worker confirms with a tap. The number in the DB is what the human
confirmed, not what the model heard.

Money-bearing fields follow the same rule whether filled by voice or by typing.
The engine computes; the human approves.

## Architecture

```
Worker speaks
    │
    ▼ (PWA MediaRecorder / push-to-talk)
audio blob → POST /api/voice/intent
    │
    ▼ (FastAPI → self-hosted Whisper → self-hosted text LLM)
{field: "laenge", value: "3,80", confidence: 0.94}
    │
    ▼ (frontend shows "Länge: 3,80 m — correct?")
Worker confirms or corrects
    │
    ▼
field value committed to form state (not yet to DB)
    │ (on final form submit)
    ▼
DB write
```

Key points:
- **Audio capture is in the PWA (MediaRecorder)**, not a third-party widget.
- **All processing is in the backend** — the browser sends audio bytes to the
  backend; the backend calls self-hosted Whisper and the structuring model. The
  browser never calls an external ASR or model API directly.
- **Intent = field + value** (not just transcription). "Länge drei achtzig" →
  `{field: "laenge", value: "3,80"}`. The intent parse is part of the structuring
  call.
- **The frontend still never calculates.** A voice-filled quantity field is a
  candidate displayed for confirmation, like any model output.

## Scope: field-capture screens first

Voice form-fill is most valuable on the field-facing screens:
1. **Aufmaß capture** — dictate Bauteil, Länge, Breite etc. (feeds `07b` voice
   pipeline for structured Aufmaß; simpler intent parse for individual field fill).
2. **Arbeitszeit** — "Anfang sieben dreißig, Ende sechzehn" → time record.
3. **Fahrt** — "von Musterstraße nach Baustelle, zwanzig Kilometer".
4. **Bestellung notes** / **Mangel description** — free-text voice.

Office screens (Angebot, Rechnung, Auftraggeber details) are lower priority;
keyboard input is natural there. Implement field-capture first; extend to office
screens in a later pass.

## Compliance note

Voice recordings for form-fill are transient: the audio is sent to the backend,
processed, and the result is returned as text. The audio blob is **not stored** —
unlike Aufmaß recordings (which are archived as immutable `document`s for billing
traceability). Transient processing with no storage means no retention obligation
for form-fill audio.

If Aufmaß capture via voice is active (recording of a measurement session), the
audio IS stored as a `document` per `07b`. The `/api/voice/intent` endpoint for
general form-fill is distinct from the `/api/aufmass/voice/extract` endpoint used
by `07b`.

## What would invalidate this

- Workers do not adopt voice input — feedback from the first field trial shows
  typing is preferred even with gloves (voice feels awkward in client-present
  situations). Signal: low usage rate after rollout.
- German dialect variation or background noise makes ASR accuracy too low for
  useful form-fill. Signal: error rate > 15% in field conditions.

## Confidence

High for the architecture and the confirm-before-commit constraint. Medium for
adoption — depends on real field trial results.

## Related

- [[07b-voice-aufmass]] (the dedicated Aufmaß voice pipeline)
- [[2026-06-29-voice-aufmass-design]] (co-equal capture path decision)
- [[2026-06-28-design-system-and-surfaces]] (the three-surface PWA this voice feature extends)
