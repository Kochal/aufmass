"""Intent parse: route a voice transcript to form field values (directive 10).

Given a transcript and a list of allowed fields, extracts which values the worker
spoke for which fields. Uses Mistral chat with a German system prompt.

Does no arithmetic. Raises IntentError on persistent API failure.
"""
from __future__ import annotations

import logging
import time

from mistralai.client import Mistral
from mistralai.client.models.jsonschema import JSONSchema
from mistralai.client.models.responseformat import ResponseFormat
from pydantic import BaseModel

from app.config import settings
from app.schemas.voice import FieldFill, FieldSpec

log = logging.getLogger(__name__)

_STRUCTURE_MODEL = "mistral-small-latest"
_TIMEOUT_MS = 60_000
_RETRY_DELAYS = [5.0, 15.0]


class IntentError(Exception):
    """Raised when intent parse fails after retries."""


class _IntentResult(BaseModel):
    fills: list[FieldFill]


_INTENT_FORMAT = ResponseFormat(
    type="json_schema",
    json_schema=JSONSchema(
        name="IntentResult",
        schema_definition=_IntentResult.model_json_schema(),
        strict=True,
    ),
)

_SYSTEM_PROMPT = """\
Du bist ein Formular-Assistent für eine Handwerker-App (Maler / Bodenleger).

Du bekommst ein Transkript einer gesprochenen Formulareingabe und eine Liste
erlaubter Felder mit Labels und Hinweisen.

Aufgabe:
- Identifiziere, welche Felder im Transkript erwähnt werden
- Extrahiere den Wert für jedes erkannte Feld
- Normalisiere Zahlen in deutsche Dezimalschreibweise:
    "drei achtzig" → "3,80"
    "sieben dreißig" (Uhrzeit) → "07:30"
    "fünfzehn" → "15"
    "zwanzig Kilometer" → "20"
- Gib NUR Felder zurück, die sicher im Transkript vorkommen
- Erfinde keine Felder und keine Werte, die nicht gesprochen wurden
- Rechne NICHT — gib Zahlen so zurück wie gehört, kein Ergebnis berechnen
- confidence: 0..1 — wie sicher du dir bei diesem Wert bist

Antworte NUR mit dem JSON-Objekt, kein erklärender Text.
"""


def parse_intent(transcript: str, fields: list[FieldSpec]) -> list[FieldFill]:
    """Parse transcript into field fills given the allowed fields.

    Parameters
    ----------
    transcript:
        Raw ASR output from app.voice.asr.transcribe().
    fields:
        The form's fields — limits what the LLM may fill.

    Returns
    -------
    list[FieldFill]
        Zero or more fills. Each must be confirmed by the user before use.

    Raises
    ------
    IntentError
        After retries exhaust on API error.
    """
    fields_description = "\n".join(
        f"- name={f.name!r}  label={f.label!r}"
        + (f"  hint={f.hint!r}" if f.hint else "")
        for f in fields
    )
    user_content = (
        f"Transkript: {transcript!r}\n\n"
        f"Erlaubte Felder:\n{fields_description}\n\n"
        "Extrahiere die Formulardaten als JSON."
    )

    client = Mistral(api_key=settings.mistral_api_key, timeout_ms=_TIMEOUT_MS)
    last_exc: Exception | None = None

    for attempt, delay in enumerate([0.0] + _RETRY_DELAYS):
        if delay:
            log.info("voice.intent: retry %d after %.0fs", attempt, delay)
            time.sleep(delay)
        try:
            t0 = time.monotonic()
            resp = client.chat.complete(
                model=_STRUCTURE_MODEL,
                messages=[
                    {"role": "system", "content": _SYSTEM_PROMPT},
                    {"role": "user", "content": user_content},
                ],
                response_format=_INTENT_FORMAT,
                temperature=0.0,
            )
            raw_json = resp.choices[0].message.content
            result = _IntentResult.model_validate_json(raw_json)
            log.info(
                "voice.intent: %.1fs  %d fills  model=%s",
                time.monotonic() - t0, len(result.fills), _STRUCTURE_MODEL,
            )
            return result.fills
        except Exception as exc:
            status = _http_status(exc)
            if status is not None and 400 <= status < 500:
                raise IntentError(f"intent API error {status}: {exc}") from exc
            log.warning("voice.intent: attempt %d: %s", attempt + 1, exc)
            last_exc = exc

    raise IntentError("intent step unreachable after retries") from last_exc


def _http_status(exc: Exception) -> int | None:
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
