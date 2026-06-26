from __future__ import annotations

from decimal import Decimal
from uuid import UUID

from .common import ReadBase, _Base


class RechnungPositionCreate(_Base):
    rechnung_id: UUID
    position_nr: int | None = None
    bezeichnung: str
    einheit: str | None = None
    einheitspreis: Decimal | None = None
    menge_tender: Decimal | None = None
    menge_aufmass: Decimal | None = None
    menge: Decimal | None = None
    vob_2_3_flag: bool = False
    lv_position_id: UUID | None = None
    leistung_id: UUID | None = None


class RechnungPositionUpdate(_Base):
    row_version: int
    position_nr: int | None = None
    bezeichnung: str
    einheit: str | None = None
    einheitspreis: Decimal | None = None
    menge_tender: Decimal | None = None
    menge_aufmass: Decimal | None = None
    menge: Decimal | None = None
    vob_2_3_flag: bool = False
    lv_position_id: UUID | None = None
    leistung_id: UUID | None = None


class RechnungPositionRead(ReadBase):
    rechnung_id: UUID
    position_nr: int | None = None
    bezeichnung: str
    einheit: str | None = None
    einheitspreis: Decimal | None = None
    menge_tender: Decimal | None = None
    menge_aufmass: Decimal | None = None
    menge: Decimal | None = None
    gesamtpreis: Decimal | None = None
    vob_2_3_flag: bool
    lv_position_id: UUID | None = None
    aufmass_entry_id: UUID | None = None
    leistung_id: UUID | None = None
