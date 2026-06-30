from __future__ import annotations

from decimal import Decimal
from uuid import UUID

from .common import ReadBase, _Base


class LvPositionCreate(_Base):
    lv_id: UUID
    oz: str | None = None
    kurztext: str | None = None
    langtext: str | None = None
    menge: Decimal | None = None
    menge_formel: str | None = None
    einheit: str | None = None
    einheitspreis: Decimal | None = None
    matched_leistung_id: UUID | None = None
    match_confidence: Decimal | None = None
    match_status: str = "review"
    source: str | None = None
    position_nr: int | None = None


class LvPositionUpdate(_Base):
    row_version: int
    oz: str | None = None
    kurztext: str | None = None
    langtext: str | None = None
    menge: Decimal | None = None
    menge_formel: str | None = None
    einheit: str | None = None
    einheitspreis: Decimal | None = None
    matched_leistung_id: UUID | None = None
    match_confidence: Decimal | None = None
    match_status: str = "review"
    source: str | None = None
    position_nr: int | None = None


class LvPositionRead(ReadBase):
    lv_id: UUID
    oz: str | None = None
    kurztext: str | None = None
    langtext: str | None = None
    menge: Decimal | None = None
    menge_formel: str | None = None
    einheit: str | None = None
    einheitspreis: Decimal | None = None
    gesamtpreis: Decimal | None = None
    matched_leistung_id: UUID | None = None
    match_confidence: Decimal | None = None
    match_status: str
    source: str | None = None
    pricing_rule: str | None = None
    position_nr: int | None = None
