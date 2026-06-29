from __future__ import annotations
from typing import Literal
from uuid import UUID
from .common import _Base, ReadBase

AuftraggeberTyp = Literal["privat", "gewerblich", "oeffentlich"]


class AuftraggeberCreate(_Base):
    name: str
    kundennummer: str | None = None
    typ: AuftraggeberTyp | None = None
    ust_idnr: str | None = None
    telefon: str | None = None
    adresse_id: UUID | None = None
    leitweg_id: str | None = None          # BT-10 Buyer Reference (mandatory for B2G)
    elektronische_adresse: str | None = None  # BT-49
    eas_scheme: str = "EM"                 # BT-49-1


class AuftraggeberUpdate(_Base):
    row_version: int
    name: str
    kundennummer: str | None = None
    typ: AuftraggeberTyp | None = None
    ust_idnr: str | None = None
    telefon: str | None = None
    adresse_id: UUID | None = None
    leitweg_id: str | None = None
    elektronische_adresse: str | None = None
    eas_scheme: str = "EM"


class AuftraggeberRead(ReadBase):
    name: str
    kundennummer: str | None = None
    typ: AuftraggeberTyp | None = None
    ust_idnr: str | None = None
    telefon: str | None = None
    adresse_id: UUID | None = None
    leitweg_id: str | None = None
    elektronische_adresse: str | None = None
    eas_scheme: str
