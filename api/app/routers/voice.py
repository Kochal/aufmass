"""Voice form-fill router (directive 10).

POST /api/voice/intent
  Accepts an audio file + a JSON list of allowed fields.
  Runs ASR (OpenAI Whisper) + intent parse (Mistral), returns candidate fills.
  The frontend must display the fills for explicit human confirmation before
  writing to form state. Audio is transient — this endpoint stores nothing.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import TypeAdapter

from ..config import settings
from ..deps import Principal, get_principal
from ..schemas.voice import FieldSpec, VoiceIntentResponse
from ..voice.asr import ALLOWED_MIME, ASRError, transcribe
from ..voice.intent import IntentError, parse_intent, _STRUCTURE_MODEL

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/voice", tags=["Voice"])

_FIELDS_ADAPTER: TypeAdapter[list[FieldSpec]] = TypeAdapter(list[FieldSpec])


@router.post("/intent", response_model=VoiceIntentResponse)
def voice_intent(
    audio: UploadFile = File(...),
    fields: str = Form(..., description="JSON array of FieldSpec"),
    principal: Principal = Depends(get_principal),
):
    """Transcribe audio and parse it into form field candidates.

    The worker speaks e.g. "Bauteil Boden, Messwert drei achtzig" and the
    response contains fills like ``[{field: "bauteil", value: "Boden", ...},
    {field: "messwert", value: "3,80", ...}]``.

    **Confirm-before-commit**: the caller must show these candidates to the user
    for explicit confirmation before populating any form field. This endpoint
    persists nothing — no document, no DB row.

    Requires ``OPENAI_API_KEY`` (ASR) and ``MISTRAL_API_KEY`` (intent parse).
    """
    if not settings.openai_api_key:
        raise HTTPException(503, "OPENAI_API_KEY not configured")
    if not settings.mistral_api_key:
        raise HTTPException(503, "MISTRAL_API_KEY not configured")

    content_type = (audio.content_type or "audio/webm").split(";")[0].strip()
    if content_type not in ALLOWED_MIME:
        raise HTTPException(
            400,
            f"unsupported audio type {content_type!r}; "
            "accept webm/ogg/mp4/mpeg/wav/m4a",
        )

    audio_bytes = audio.file.read()
    if not audio_bytes:
        raise HTTPException(400, "empty audio file")

    try:
        field_specs = _FIELDS_ADAPTER.validate_json(fields)
    except Exception as exc:
        raise HTTPException(400, f"invalid fields JSON: {exc}") from exc

    if not field_specs:
        raise HTTPException(400, "fields must not be empty")

    log.info(
        "voice.intent: %dB  %s  %d fields  tenant=%s",
        len(audio_bytes), content_type, len(field_specs), principal.tenant_id,
    )

    try:
        asr = transcribe(audio_bytes, content_type)
    except ASRError as exc:
        raise HTTPException(502, f"ASR failed: {exc}") from exc

    if not asr.transcript.strip():
        raise HTTPException(422, "ASR returned empty transcript — nothing was spoken")

    try:
        fills = parse_intent(asr.transcript, field_specs)
    except IntentError as exc:
        raise HTTPException(502, f"intent parse failed: {exc}") from exc

    log.info("voice.intent: %d fills from %d chars transcript", len(fills), len(asr.transcript))

    return VoiceIntentResponse(
        transcript=asr.transcript,
        fills=fills,
        asr_model=settings.asr_model_id,
        structure_model=_STRUCTURE_MODEL,
        endpoint="api.openai.com+api.mistral.ai",
    )
