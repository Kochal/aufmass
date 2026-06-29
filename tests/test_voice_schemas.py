"""Unit tests for voice schema (de)serialization and router guard logic.

No API key, no audio, no network — pure Python/Pydantic.
"""
import pytest
from pydantic import ValidationError

from app.schemas.voice import FieldFill, FieldSpec, VoiceIntentResponse


class TestFieldSpec:
    def test_round_trip(self):
        spec = FieldSpec(name="bauteil", label="Bauteil", hint="Text")
        assert FieldSpec.model_validate(spec.model_dump()) == spec

    def test_hint_optional(self):
        spec = FieldSpec(name="x", label="X")
        assert spec.hint is None

    def test_list_round_trip(self):
        from pydantic import TypeAdapter
        ta = TypeAdapter(list[FieldSpec])
        raw = '[{"name":"bauteil","label":"Bauteil"},{"name":"messwert","label":"Messwert","hint":"Dezimalzahl"}]'
        specs = ta.validate_json(raw)
        assert len(specs) == 2
        assert specs[1].hint == "Dezimalzahl"


class TestFieldFill:
    def test_valid(self):
        fill = FieldFill(field="messwert", value="3,80", confidence=0.94)
        assert fill.field == "messwert"

    def test_confidence_bounds(self):
        with pytest.raises(ValidationError):
            FieldFill(field="x", value="y", confidence=1.1)
        with pytest.raises(ValidationError):
            FieldFill(field="x", value="y", confidence=-0.1)

    def test_zero_confidence_allowed(self):
        fill = FieldFill(field="x", value="?", confidence=0.0)
        assert fill.confidence == 0.0


class TestVoiceIntentResponse:
    def test_round_trip(self):
        resp = VoiceIntentResponse(
            transcript="Bauteil Boden Messwert drei achtzig",
            fills=[FieldFill(field="bauteil", value="Boden", confidence=0.95)],
            asr_model="whisper-1",
            structure_model="mistral-small-latest",
            endpoint="api.openai.com+api.mistral.ai",
        )
        data = resp.model_dump()
        assert data["fills"][0]["value"] == "Boden"
        assert data["transcript"].startswith("Bauteil")

    def test_empty_fills_allowed(self):
        resp = VoiceIntentResponse(
            transcript="ähm",
            fills=[],
            asr_model="whisper-1",
            structure_model="mistral-small-latest",
            endpoint="api.openai.com",
        )
        assert resp.fills == []
