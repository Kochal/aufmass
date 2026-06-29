from __future__ import annotations
from datetime import date
from typing import Literal
from uuid import UUID
from .common import _Base, ReadBase

ProjektStatus = Literal[
    "angelegt", "kalkulation", "beauftragt", "in_ausfuehrung",
    "abgenommen", "abgerechnet", "gewaehrleistung", "abgeschlossen",
    "pausiert", "storniert",
]
Regime = Literal["bgb", "vob"]
Abrechnungsart = Literal["einheitspreis", "pauschal"]


class ProjektCreate(_Base):
    auftraggeber_id: UUID
    name: str
    nummer: str | None = None          # auto-allocated when None
    site_adresse: str | None = None
    baustellen_adresse_id: UUID | None = None
    regime: Regime | None = None
    abrechnungsart: Abrechnungsart | None = None
    start_datum: date | None = None
    end_datum: date | None = None
    abnahme_datum: date | None = None
    abnahme_document_id: UUID | None = None


class ProjektUpdate(_Base):
    row_version: int
    name: str
    auftraggeber_id: UUID
    site_adresse: str | None = None
    baustellen_adresse_id: UUID | None = None
    regime: Regime | None = None
    abrechnungsart: Abrechnungsart | None = None
    start_datum: date | None = None
    end_datum: date | None = None
    abnahme_datum: date | None = None
    abnahme_document_id: UUID | None = None


class ProjektStatusPatch(_Base):
    status: ProjektStatus
    row_version: int
    reason: str | None = None


class ProjektRead(ReadBase):
    auftraggeber_id: UUID
    nummer: str | None = None
    name: str
    site_adresse: str | None = None
    baustellen_adresse_id: UUID | None = None
    status: ProjektStatus
    status_vor_pause: str | None = None
    regime: Regime | None = None
    abrechnungsart: Abrechnungsart | None = None
    abnahme_datum: date | None = None
    abnahme_document_id: UUID | None = None
    start_datum: date | None = None
    end_datum: date | None = None
