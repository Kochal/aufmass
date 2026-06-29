"""Voice extraction client for Aufmaß dictation (directive 07b).

Two-step pipeline:
  1. OpenAI Whisper API (whisper-1) via app.voice.asr.transcribe — German ASR
     → transcript + segment timestamps
  2. Mistral chat (mistral-small-latest) — structures transcript → AufmassExtractionResult

PoC note: ASR uses the OpenAI Whisper API (egress to US, no DPA in place).
Swap app.voice.asr for a faster-whisper call in production (see directive 07b).

Does no arithmetic. On failure raises ExtractionError; the caller routes to manual.
"""
from __future__ import annotations

import logging
import time
from typing import Any

from mistralai.client import Mistral
from mistralai.client.models.jsonschema import JSONSchema
from mistralai.client.models.responseformat import ResponseFormat

from app.aufmass.schema import AufmassExtractionResult
from app.config import settings
from app.voice.asr import ASRError, transcribe as asr_transcribe

log = logging.getLogger(__name__)

_STRUCTURE_MODEL = "mistral-small-latest"
_MISTRAL_TIMEOUT_MS = 120_000
_RETRY_DELAYS = [5.0, 15.0, 45.0]

_STRUCTURE_FORMAT = ResponseFormat(
    type="json_schema",
    json_schema=JSONSchema(
        name="AufmassExtractionResult",
        schema_definition=AufmassExtractionResult.model_json_schema(),
        strict=True,
    ),
)

_VOICE_SYSTEM_PROMPT = """\
Du extrahierst strukturierte Messdaten aus einem gesprochenen deutschen Aufmaß
eines Malers oder Bodenlegers. Du bekommst ein Transkript der Sprachaufnahme.

Zahlen: Wandle gesprochene Zahlwörter in deutsche Dezimalschreibweise um.
  "drei Meter sechsundachtzig"  → 3,86
  "null Komma sieben vier"      → 0,74
  "zwei mal drei achtzig"       → 2 x 3,80
  "fünfzehn"                    → 15
  "ein Komma drei eins"         → 1,31

Operatoren: "mal" oder "x" → *; "plus" → +; "minus" → -; "geteilt durch" → /
  "drei achtzig mal zwei" → Ausdruck: 3,80 × 2
  "plus null achtzig"     → Ausdruck: + 0,80 (falls vorheriger Ausdruck unvollständig)

Bauteil-Labels: "Wand", "Decke", "Boden", "Schräge", "Flur", "Bad", "Leiste",
  "Links", "Rechts", "vorne", "hinten" und Kombinationen — als bauteil-Feld übernehmen.

Abzüge: "Abzug", "abziehen", "minus Tür", "minus Fenster" → is_deduction: true
Gestrichen: "streichen", "weg", "nicht mehr", "stimmt nicht" → struck: true
"dito" oder "nochmal": Bauteil-Kontext des vorherigen Eintrags wiederholen.

Regeln:
- Rechne NICHT. Gib Operanden und Operator zurück, kein Ergebnis.
- Jede eigenständige Messung oder Berechnung = ein Entry.
- Bewahre deutsche Dezimalkommas: "3,86" nicht "3.86".
- Unklare Stelle → trotzdem ausgeben mit niedrigem confidence (0.1–0.3).
- Wenn ein Bauteil mehrfach vorkommt, gleicher bauteil-Wert für alle zugehörigen Einträge.
- Ignoriere Füllwörter ("ähm", "also", "dann"), Lachgeräusche, Hintergrundgeräusche.
- is_deduction: true NUR für explizite Abzüge (Fenster, Tür, Aussparung).
- unit: "m2" für Flächen, "lfm" für Längen/Leisten, "stk" für Stückzahlen, sonst null.

Für jede Messung:
- raw_text: die Messung wörtlich, wie gesprochen (Zahlwörter beibehalten)
- bauteil: Bauteil-Label oder null
- bauteil_confidence: 0..1
- expression: Ausdrucksbaum. Blatt: {"value":"3,86","candidates":[]}
  Knoten: {"op":"+|-|*|/","args":[...]}
- written_result: null (gesprochene Aufmaße haben kein handgeschriebenes Ergebnis)
- unit: "m2" | "lfm" | "stk" | "psch" | null
- is_deduction: true/false
- struck: true/false
- bbox: null (wird serverseitig durch Segment-Referenzen ersetzt)
- confidence: 0..1 Gesamtverständlichkeit
- notes: kurze Notiz bei Besonderheiten, sonst null
"""


class ExtractionError(Exception):
    """Raised when ASR or structuring fails after retries. Caller routes to manual review."""


def extract(audio_bytes: bytes, mime_type: str = "audio/webm") -> dict[str, Any]:
    """Extract structured measurement candidates from one spoken Aufmaß recording.

    Returns same shape as vision_client.extract() — ``{"entries": [...],
    "_asr_model": ..., "_structure_model": ..., "_endpoint": ...}``.
    Each entry has ``bbox`` set to ``{"start_s": x, "end_s": y}`` where a
    segment match was found (stored as ``source_crop_ref`` in the DB).

    Raises ExtractionError on ASR failure or structuring failure after retries.
    """
    try:
        asr = asr_transcribe(audio_bytes, mime_type)
    except ASRError as exc:
        raise ExtractionError(str(exc)) from exc

    if not asr.transcript.strip():
        raise ExtractionError("ASR returned empty transcript")

    result = _structure(asr.transcript)
    out = result.model_dump(mode="json")
    _assign_segment_refs(out["entries"], asr.segments)
    out["_asr_model"] = settings.asr_model_id
    out["_structure_model"] = _STRUCTURE_MODEL
    out["_endpoint"] = "api.openai.com"
    return out


# ---------------------------------------------------------------------------
# Step 2: structuring (Mistral chat)
# ---------------------------------------------------------------------------

def _structure(transcript: str) -> AufmassExtractionResult:
    client = Mistral(api_key=settings.mistral_api_key, timeout_ms=_MISTRAL_TIMEOUT_MS)
    user_content = (
        "Hier ist das transkribierte gesprochene Aufmaß:\n\n"
        f"{transcript}\n\n"
        "Extrahiere alle Messpositionen als JSON."
    )
    last_exc: Exception | None = None
    for attempt, delay in enumerate([0.0] + _RETRY_DELAYS):
        if delay:
            log.info("voice_client: structure retry %d after %.0fs", attempt, delay)
            time.sleep(delay)
        try:
            t0 = time.monotonic()
            resp = client.chat.complete(
                model=_STRUCTURE_MODEL,
                messages=[
                    {"role": "system", "content": _VOICE_SYSTEM_PROMPT},
                    {"role": "user", "content": user_content},
                ],
                response_format=_STRUCTURE_FORMAT,
                temperature=0.0,
            )
            raw_json = resp.choices[0].message.content
            log.info(
                "voice_client: structure %.1fs  %d chars",
                time.monotonic() - t0, len(raw_json),
            )
            return AufmassExtractionResult.model_validate_json(raw_json)
        except Exception as exc:
            status = _status_code(exc)
            if status is not None and 400 <= status < 500:
                raise ExtractionError(f"structure API error {status}: {exc}") from exc
            log.warning("voice_client: structure attempt %d: %s", attempt + 1, exc)
            last_exc = exc
    raise ExtractionError("structure step unreachable after retries") from last_exc


# ---------------------------------------------------------------------------
# Step 3: segment-ref assignment
# ---------------------------------------------------------------------------

def _assign_segment_refs(entries: list[dict], segments: list[dict]) -> None:
    """Map each entry dict to its best-matching audio segment by text token overlap.

    Sets ``entry["bbox"]`` to ``{"start_s": x, "end_s": y}`` (or ``None``).
    Named "bbox" so the router's ``_insert_entry`` stores it as ``source_crop_ref``
    in the DB without any special-casing.
    """
    if not segments:
        return
    assigned = 0
    for entry in entries:
        raw = entry.get("raw_text", "").lower()
        tokens = [t for t in raw.split() if len(t) > 1]
        if not tokens:
            entry["bbox"] = None
            continue
        best_score, best_seg = 0, None
        for seg in segments:
            seg_lower = seg["text"].lower()
            score = sum(1 for t in tokens if t in seg_lower)
            if score > best_score:
                best_score, best_seg = score, seg
        if best_seg and best_score > 0:
            entry["bbox"] = {
                "start_s": round(best_seg["start"], 3),
                "end_s": round(best_seg["end"], 3),
            }
            assigned += 1
        else:
            entry["bbox"] = None
    log.info("voice_client: segment refs assigned %d/%d", assigned, len(entries))


# ---------------------------------------------------------------------------
# Utilities
# ---------------------------------------------------------------------------

def _status_code(exc: Exception) -> int | None:
    for attr in ("status_code", "http_status", "status"):
        v = getattr(exc, attr, None)
        if isinstance(v, int):
            return v
    resp = getattr(exc, "response", None)
    if resp is not None:
        v = getattr(resp, "status_code", None)
        if isinstance(v, int):
            return v
    return None
