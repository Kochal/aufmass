from __future__ import annotations
from typing import Literal
from .common import _Base, ReadBase

AuftraggeberTyp = Literal["privat", "gewerblich", "oeffentlich"]


class AuftraggeberCreate(_Base):
    name: str
    kundennummer: str | None = None
    typ: AuftraggeberTyp | None = None
    ust_idnr: str | None = None


class AuftraggeberUpdate(_Base):
    row_version: int
    name: str
    kundennummer: str | None = None
    typ: AuftraggeberTyp | None = None
    ust_idnr: str | None = None


class AuftraggeberRead(ReadBase):
    name: str
    kundennummer: str | None = None
    typ: AuftraggeberTyp | None = None
    ust_idnr: str | None = None
