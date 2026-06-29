"""Shared OpenAI Whisper ASR client (PoC path, directive 07b / 10).

Single place the OpenAI Whisper API call lives. Both the Aufmaß voice pipeline
(07b, aufmass/voice_client.py) and the general form-fill intent endpoint (10,
routers/voice.py) import from here.

Production swap: replace _call_whisper_api() with a faster-whisper local call;
the rest of the callers change nothing.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field

import httpx

from app.config import settings

log = logging.getLogger(__name__)

_ASR_ENDPOINT = "https://api.openai.com/v1/audio/transcriptions"
_TIMEOUT = 120.0
MAX_BYTES = 25 * 1024 * 1024  # OpenAI Whisper API limit

_MIME_TO_FILENAME: dict[str, str] = {
    "audio/webm": "audio.webm",
    "audio/ogg":  "audio.ogg",
    "audio/mp4":  "audio.mp4",
    "audio/mpeg": "audio.mp3",
    "audio/wav":  "audio.wav",
    "audio/x-wav": "audio.wav",
    "audio/x-m4a": "audio.m4a",
}

ALLOWED_MIME: frozenset[str] = frozenset(_MIME_TO_FILENAME)


class ASRError(Exception):
    """Raised when the ASR step fails (size, API error, timeout)."""


@dataclass
class ASRResult:
    transcript: str
    segments: list[dict] = field(default_factory=list)


def transcribe(audio_bytes: bytes, mime_type: str = "audio/webm") -> ASRResult:
    """POST audio to the OpenAI Whisper API; return transcript + segment timestamps.

    Uses ``response_format=verbose_json`` so callers that need segment-level
    timestamps (Aufmaß voice: bbox/source_crop_ref) get them; callers that
    only need the transcript (form-fill intent parse) ignore ``segments``.

    Raises
    ------
    ASRError
        On size limit, HTTP 4xx/5xx, or timeout.
    """
    if len(audio_bytes) > MAX_BYTES:
        raise ASRError(
            f"audio too large ({len(audio_bytes) // 1024 // 1024} MB); "
            "OpenAI Whisper API limit is 25 MB"
        )

    base_mime = mime_type.split(";")[0].strip().lower()
    filename = _MIME_TO_FILENAME.get(base_mime, "audio.webm")

    t0 = time.monotonic()
    try:
        with httpx.Client(timeout=_TIMEOUT) as client:
            resp = client.post(
                _ASR_ENDPOINT,
                headers={"Authorization": f"Bearer {settings.openai_api_key}"},
                files={"file": (filename, audio_bytes, base_mime)},
                data={
                    "model": settings.asr_model_id,
                    "language": "de",
                    "response_format": "verbose_json",
                },
            )
        resp.raise_for_status()
    except httpx.HTTPStatusError as exc:
        raise ASRError(
            f"Whisper API returned {exc.response.status_code}: {exc.response.text[:200]}"
        ) from exc
    except httpx.TimeoutException as exc:
        raise ASRError("Whisper API timed out") from exc

    payload = resp.json()
    segments = [
        {"start": s["start"], "end": s["end"], "text": s["text"].strip()}
        for s in payload.get("segments", [])
    ]
    transcript = payload.get("text", "").strip()
    log.info(
        "asr.transcribe: %.1fs  %d segs  %d chars  model=%s",
        time.monotonic() - t0, len(segments), len(transcript), settings.asr_model_id,
    )
    return ASRResult(transcript=transcript, segments=segments)
