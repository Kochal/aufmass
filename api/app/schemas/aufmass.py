from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

from .common import ReadBase, _Base


class AufmassEntryRead(ReadBase):
    aufmass_id: UUID
    bauteil: str | None = None
    expression: Any | None = None          # jsonb: ExpressionLeaf | ExpressionNode
    candidate_readings: Any | None = None  # jsonb: {raw_text, candidates, is_deduction}
    written_result: Decimal | None = None
    computed_result: Decimal | None = None
    einheit: str | None = None
    reconciled: bool
    confidence: Decimal | None = None
    source_crop_ref: Any | None = None     # jsonb: {x1, y1, x2, y2} normalised 0..1
    lv_position_id: UUID | None = None
    review_status: str


class AufmassRead(ReadBase):
    projekt_id: UUID
    erfasst_von: UUID | None = None
    erfasst_am: datetime
    quelle: str
    source_document_id: UUID | None = None
    entries: list[AufmassEntryRead] = []


class AufmassCreate(_Base):
    projekt_id: UUID


class AufmassEntryCreate(_Base):
    """For adding entries to a manual aufmass (quelle='manual').
    Also used by tests to exercise the CRUD + review flow without Mistral.
    """
    aufmass_id: UUID
    bauteil: str | None = None
    written_result: Decimal | None = None
    einheit: str | None = None
    confidence: float = 0.0
    is_deduction: bool = False
    raw_text: str = ""


class AufmassEntryConfirm(_Base):
    row_version: int


class AufmassEntryCorrect(_Base):
    row_version: int
    written_result: Decimal | None = None
    computed_result: Decimal | None = None
    bauteil: str | None = None
    einheit: str | None = None
    lv_position_id: UUID | None = None
