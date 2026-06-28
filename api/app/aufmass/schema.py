"""Pydantic models for Aufmaß extraction (directive 07a).

Used as ``document_annotation_format`` in the Mistral OCR call (guided
decoding) and as the parse target for the response. These models mirror
the ``aufmass_entry`` columns in the DB (directive 02) — they are the
intermediate representation between the model and the deterministic
reconciler (directive 07).
"""
from __future__ import annotations

from typing import Literal, Optional, Union

from pydantic import BaseModel, Field


class ExpressionLeaf(BaseModel):
    value: str = Field(
        description="Decimal value exactly as written, German comma: '3,86'"
    )
    candidates: list[str] = Field(
        default_factory=list,
        description="Alternative readings when a digit or decimal comma is ambiguous",
    )


class ExpressionNode(BaseModel):
    op: Literal["+", "-", "*", "/"]
    args: list[Union[ExpressionLeaf, "ExpressionNode"]]


ExpressionNode.model_rebuild()

Expression = Union[ExpressionLeaf, ExpressionNode]


class WrittenResult(BaseModel):
    value: str = Field(description="Result the worker wrote by hand, e.g. '2,86'")
    candidates: list[str] = Field(default_factory=list)


class Bbox(BaseModel):
    x1: float = Field(ge=0.0, le=1.0, description="Left edge as fraction of image width")
    y1: float = Field(ge=0.0, le=1.0, description="Top edge as fraction of image height")
    x2: float = Field(ge=0.0, le=1.0, description="Right edge as fraction of image width")
    y2: float = Field(ge=0.0, le=1.0, description="Bottom edge as fraction of image height")


class AufmassEntry(BaseModel):
    raw_text: str = Field(description="Calculation exactly as written on the sheet")
    bauteil: Optional[str] = Field(
        default=None,
        description="Component label if legible, e.g. 'Boden', 'Wand', 'Decke', 'Flur'",
    )
    bauteil_confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    expression: Optional[Expression] = None
    written_result: Optional[WrittenResult] = None
    unit: Optional[Literal["m2", "lfm", "stk", "psch"]] = None
    is_deduction: bool = Field(
        default=False,
        description="True for Abzug entries (windows, doors, openings to subtract)",
    )
    struck: bool = Field(default=False, description="True if the entry is crossed out")
    bbox: Optional[Bbox] = None
    confidence: float = Field(
        default=0.0, ge=0.0, le=1.0,
        description="Overall legibility of this entry, 0..1",
    )
    notes: Optional[str] = None


class AufmassExtractionResult(BaseModel):
    """Root annotation object — one per sheet, regardless of page count."""
    entries: list[AufmassEntry]
