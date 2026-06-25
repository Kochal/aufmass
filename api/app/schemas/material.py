from __future__ import annotations
from decimal import Decimal
from uuid import UUID
from .common import _Base, ReadBase


class MaterialCreate(_Base):
    bezeichnung: str
    einheit: str
    standard_lieferant_id: UUID | None = None
    standard_preis: Decimal | None = None


class MaterialUpdate(_Base):
    row_version: int
    bezeichnung: str
    einheit: str
    standard_lieferant_id: UUID | None = None
    standard_preis: Decimal | None = None


class MaterialRead(ReadBase):
    bezeichnung: str
    einheit: str
    standard_lieferant_id: UUID | None = None
    standard_preis: Decimal | None = None
