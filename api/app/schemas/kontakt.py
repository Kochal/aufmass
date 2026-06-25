from __future__ import annotations
from uuid import UUID
from .common import _Base, ReadBase


class KontaktCreate(_Base):
    auftraggeber_id: UUID
    name: str
    rolle: str | None = None
    email: str | None = None
    telefon: str | None = None


class KontaktUpdate(_Base):
    row_version: int
    name: str
    rolle: str | None = None
    email: str | None = None
    telefon: str | None = None


class KontaktRead(ReadBase):
    auftraggeber_id: UUID
    name: str
    rolle: str | None = None
    email: str | None = None
    telefon: str | None = None
