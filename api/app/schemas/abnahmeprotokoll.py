from __future__ import annotations
from datetime import date
from typing import Literal
from uuid import UUID
from .common import _Base, ReadBase

AbnahmeArt = Literal["foermlich", "fiktiv", "konkludent", "bgb"]


class AbnahmeprotokollCreate(_Base):
    projekt_id: UUID
    abnahme_datum: date
    art: AbnahmeArt
    abnehmer: str | None = None
    vorbehalte: str | None = None
    protokoll_document_id: UUID | None = None


class AbnahmeprotokollUpdate(_Base):
    row_version: int
    abnahme_datum: date
    art: AbnahmeArt
    abnehmer: str | None = None
    vorbehalte: str | None = None
    protokoll_document_id: UUID | None = None


class AbnahmeprotokollRead(ReadBase):
    projekt_id: UUID
    abnahme_datum: date
    art: AbnahmeArt
    abnehmer: str | None = None
    vorbehalte: str | None = None
    protokoll_document_id: UUID | None = None
