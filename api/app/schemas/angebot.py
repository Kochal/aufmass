from __future__ import annotations

from decimal import Decimal
from uuid import UUID

from .common import ReadBase, _Base


class AngebotCreate(_Base):
    auftraggeber_id: UUID
    projekt_id: UUID | None = None
    waehrung: str = "EUR"


class AngebotUpdate(_Base):
    row_version: int
    auftraggeber_id: UUID
    projekt_id: UUID | None = None
    waehrung: str = "EUR"


class AngebotBerechnen(_Base):
    """Body for the /berechnen action: supply the discount/surcharge adjustments."""
    row_version: int
    nachlass_betrag: Decimal | None = None
    zuschlag_betrag: Decimal | None = None


class AngebotRead(ReadBase):
    auftraggeber_id: UUID
    projekt_id: UUID | None = None
    angebotsnummer: str | None = None
    status: str
    document_group_id: UUID
    version_no: int
    supersedes_id: UUID | None = None
    steuer_behandlung: str | None = None
    ust_satz: Decimal | None = None
    kleinunternehmer: bool | None = None
    summe_netto: Decimal | None = None
    nachlass_betrag: Decimal | None = None
    zuschlag_betrag: Decimal | None = None
    summe_brutto: Decimal | None = None
    waehrung: str
