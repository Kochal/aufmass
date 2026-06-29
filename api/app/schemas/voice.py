"""Pydantic schemas for the voice form-fill endpoint (directive 10)."""
from __future__ import annotations

from pydantic import BaseModel, Field


class FieldSpec(BaseModel):
    """Describes one form field the worker may fill by voice."""
    name: str = Field(description="Internal field name, e.g. 'bauteil'")
    label: str = Field(description="German display label, e.g. 'Bauteil'")
    hint: str | None = Field(default=None, description="Type hint for the LLM, e.g. 'Text' or 'Dezimalzahl'")


class FieldFill(BaseModel):
    """One voice-extracted field value, pending human confirmation."""
    field: str = Field(description="Matches FieldSpec.name")
    value: str = Field(description="Extracted value, numbers in German decimal format")
    confidence: float = Field(ge=0.0, le=1.0)


class VoiceIntentResponse(BaseModel):
    """Response from POST /api/voice/intent."""
    transcript: str = Field(description="Raw ASR transcript")
    fills: list[FieldFill] = Field(description="Extracted field fills, pending confirmation")
    asr_model: str
    structure_model: str
    endpoint: str
