from __future__ import annotations
from decimal import Decimal
from uuid import UUID
from .common import _Base, ReadBase


class BestellpositionCreate(_Base):
    bestellung_id: UUID
    bezeichnung: str
    menge: Decimal
    einheit: str
    material_id: UUID | None = None
    einzelpreis: Decimal | None = None
    position_nr: int | None = None


class BestellpositionUpdate(_Base):
    row_version: int
    bezeichnung: str
    menge: Decimal
    einheit: str
    material_id: UUID | None = None
    einzelpreis: Decimal | None = None
    position_nr: int | None = None


class BestellpositionRead(ReadBase):
    bestellung_id: UUID
    material_id: UUID | None = None
    bezeichnung: str
    menge: Decimal
    einheit: str
    einzelpreis: Decimal | None = None
    position_nr: int | None = None
