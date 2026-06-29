"""Voice extraction client for Aufmaß dictation (directive 07b).

Two-step pipeline:
  1. Whisper (faster-whisper, self-hosted) — German ASR → transcript + segment timestamps
  2. Mistral chat (mistral-small-latest) — structures transcript → AufmassExtractionResult

The ASR step is fully self-hosted: audio never leaves the server. The structuring
step currently uses Mistral; replace with a self-hosted text LLM once benchmarked
(07b open question 4). See notes/aufmass/2026-06-29-voice-aufmass-design.md.

Does no arithmetic. On failure raises ExtractionError; the caller routes to manual.
"""
from __future__ import annotations

import logging
import os
import tempfile
import time
from typing import Any

from mistralai.client import Mistral
from mistralai.client.models.jsonschema import JSONSchema
from mistralai.client.models.responseformat import ResponseFormat

from app.aufmass.schema import AufmassExtractionResult
from app.config import settings

log = logging.getLogger(__name__)

_STRUCTURE_MODEL = "mistral-small-latest"
_TIMEOUT = 120_000
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


# Module-level Whisper singleton — loaded once on first call, reused per process.
_whisper: Any = None


def _get_whisper() -> Any:
    global _whisper
    if _whisper is None:
        try:
            from faster_whisper import WhisperModel  # type: ignore[import]
        except ImportError as exc:
            raise ExtractionError(
                "faster-whisper not installed; add it to pyproject.toml"
            ) from exc
        log.info(
            "voice_client: loading Whisper %s  device=%s  compute=%s",
            settings.asr_model_id, settings.asr_device, settings.asr_compute_type,
        )
        t0 = time.monotonic()
        _whisper = WhisperModel(
            settings.asr_model_id,
            device=settings.asr_device,
            compute_type=settings.asr_compute_type,
        )
        log.info("voice_client: Whisper loaded in %.1fs", time.monotonic() - t0)
    return _whisper


def extract(audio_bytes: bytes, mime_type: str = "audio/webm") -> dict[str, Any]:
    """Extract structured measurement candidates from one spoken Aufmaß recording.

    Parameters
    ----------
    audio_bytes:
        Raw audio data (webm/opus, mp4, ogg, wav). ffmpeg must be installed.
    mime_type:
        MIME type hint for the temp-file suffix.

    Returns
    -------
    dict
        Same shape as vision_client.extract() — ``{"entries": [...],
        "_asr_model": ..., "_structure_model": ..., "_endpoint": ...}``.
        Each entry has ``bbox`` set to ``{"start_s": x, "end_s": y}`` where
        a segment match was found (stored as ``source_crop_ref`` in the DB).

    Raises
    ------
    ExtractionError
        On ASR load failure, ffmpeg error, or structuring API failure after retries.
    """
    transcript, segments = _transcribe(audio_bytes, mime_type)
    if not transcript.strip():
        raise ExtractionError("ASR returned empty transcript")

    result = _structure(transcript)
    out = result.model_dump(mode="json")
    _assign_segment_refs(out["entries"], segments)
    out["_asr_model"] = settings.asr_model_id
    out["_structure_model"] = _STRUCTURE_MODEL
    out["_endpoint"] = "self-hosted"
    return out


# ---------------------------------------------------------------------------
# Step 1: ASR (faster-whisper, self-hosted)
# ---------------------------------------------------------------------------

_MIME_TO_SUFFIX: dict[str, str] = {
    "audio/webm": ".webm",
    "audio/ogg": ".ogg",
    "audio/mp4": ".mp4",
    "audio/mpeg": ".mp3",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "audio/x-m4a": ".m4a",
}


def _transcribe(audio_bytes: bytes, mime_type: str) -> tuple[str, list[dict]]:
    """Run faster-whisper on raw audio bytes. Returns (transcript, segments).

    Segments are dicts with ``start``, ``end`` (seconds), and ``text`` keys.
    ffmpeg must be on PATH for non-WAV formats.
    """
    model = _get_whisper()
    base_mime = mime_type.split(";")[0].strip().lower()
    suffix = _MIME_TO_SUFFIX.get(base_mime, ".webm")

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
        f.write(audio_bytes)
        tmp_path = f.name

    try:
        t0 = time.monotonic()
        seg_iter, info = model.transcribe(
            tmp_path,
            language="de",
            task="transcribe",
            beam_size=5,
            vad_filter=True,
        )
        segments = [
            {"start": s.start, "end": s.end, "text": s.text.strip()}
            for s in seg_iter
        ]
        transcript = " ".join(s["text"] for s in segments).strip()
        log.info(
            "voice_client: ASR %.1fs  audio=%.1fs  %d segs  %d chars transcript",
            time.monotonic() - t0, info.duration, len(segments), len(transcript),
        )
        return transcript, segments
    finally:
        os.unlink(tmp_path)


# ---------------------------------------------------------------------------
# Step 2: transcript structuring (Mistral chat)
# ---------------------------------------------------------------------------

def _structure(transcript: str) -> AufmassExtractionResult:
    client = Mistral(api_key=settings.mistral_api_key, timeout_ms=_TIMEOUT)
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
            entry["bbox"] = {"start_s": round(best_seg["start"], 3), "end_s": round(best_seg["end"], 3)}
            assigned += 1
        else:
            entry["bbox"] = None
    log.info("voice_client: segment refs assigned %d/%d", assigned, len(entries))


# ---------------------------------------------------------------------------
# Shared utilities
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
