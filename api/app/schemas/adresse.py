from __future__ import annotations

from .common import ReadBase, _Base


class AdresseCreate(_Base):
    strasse: str | None = None
    adresszusatz: str | None = None
    plz: str | None = None
    ort: str | None = None
    land: str = "DE"


class AdresseUpdate(_Base):
    row_version: int
    strasse: str | None = None
    adresszusatz: str | None = None
    plz: str | None = None
    ort: str | None = None
    land: str = "DE"


class AdresseRead(ReadBase):
    strasse: str | None = None
    adresszusatz: str | None = None
    plz: str | None = None
    ort: str | None = None
    land: str
