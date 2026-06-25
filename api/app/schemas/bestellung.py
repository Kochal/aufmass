from __future__ import annotations
from datetime import date
from decimal import Decimal
from typing import Literal
from uuid import UUID
from .common import _Base, ReadBase

BestellungStatus = Literal["entwurf", "bestellt", "teilgeliefert", "geliefert", "storniert"]


class BestellungCreate(_Base):
    lieferant_id: UUID
    projekt_id: UUID | None = None
    bestelldatum: date | None = None
    summe: Decimal | None = None
    auftragsbestaetigung_document_id: UUID | None = None


class BestellungUpdate(_Base):
    row_version: int
    lieferant_id: UUID
    projekt_id: UUID | None = None
    bestelldatum: date | None = None
    summe: Decimal | None = None
    auftragsbestaetigung_document_id: UUID | None = None


class BestellungStatusPatch(_Base):
    status: BestellungStatus
    row_version: int
    reason: str | None = None


class BestellungRead(ReadBase):
    lieferant_id: UUID
    projekt_id: UUID | None = None
    status: BestellungStatus
    bestelldatum: date | None = None
    summe: Decimal | None = None
    auftragsbestaetigung_document_id: UUID | None = None
