from __future__ import annotations

from decimal import Decimal
from uuid import UUID

from .common import ReadBase, _Base


class RechnungCreate(_Base):
    auftraggeber_id: UUID | None = None
    projekt_id: UUID | None = None
    waehrung: str = "EUR"


class RechnungUpdate(_Base):
    row_version: int
    auftraggeber_id: UUID | None = None
    projekt_id: UUID | None = None
    waehrung: str = "EUR"


class RechnungBerechnen(_Base):
    """Body for the /berechnen action. No discount/surcharge columns on rechnung v1."""
    row_version: int


class RechnungRead(ReadBase):
    auftraggeber_id: UUID | None = None
    projekt_id: UUID | None = None
    rechnungsnummer: str | None = None
    status: str
    document_group_id: UUID
    version_no: int
    supersedes_id: UUID | None = None
    waehrung: str
    betrag_netto: Decimal | None = None
    betrag_brutto: Decimal | None = None
    steuer_behandlung: str | None = None
    ust_satz: Decimal | None = None
    kleinunternehmer: bool | None = None
    einvoice_format: str | None = None
    einvoice_artifact_id: UUID | None = None
