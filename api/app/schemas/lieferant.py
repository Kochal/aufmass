from __future__ import annotations
from .common import _Base, ReadBase


class LieferantCreate(_Base):
    name: str
    ust_idnr: str | None = None
    zahlungsziel_tage: int | None = None


class LieferantUpdate(_Base):
    row_version: int
    name: str
    ust_idnr: str | None = None
    zahlungsziel_tage: int | None = None


class LieferantRead(ReadBase):
    name: str
    ust_idnr: str | None = None
    zahlungsziel_tage: int | None = None
