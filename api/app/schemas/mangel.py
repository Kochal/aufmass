from __future__ import annotations
from datetime import date
from typing import Literal
from uuid import UUID
from .common import _Base, ReadBase

MangelSchwere = Literal["gering", "mittel", "schwer"]
MangelStatus = Literal["offen", "behoben", "abgelehnt"]


class MangelCreate(_Base):
    abnahmeprotokoll_id: UUID
    beschreibung: str
    ort: str | None = None
    schwere: MangelSchwere | None = None
    frist: date | None = None


class MangelUpdate(_Base):
    row_version: int
    beschreibung: str
    ort: str | None = None
    schwere: MangelSchwere | None = None
    frist: date | None = None
    status: MangelStatus = "offen"
    behoben_am: date | None = None


class MangelRead(ReadBase):
    abnahmeprotokoll_id: UUID
    beschreibung: str
    ort: str | None = None
    schwere: MangelSchwere | None = None
    frist: date | None = None
    status: MangelStatus
    behoben_am: date | None = None
