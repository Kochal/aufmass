from __future__ import annotations

from .common import ReadBase, _Base


class LeistungskatalogCreate(_Base):
    name: str
    aktiv: bool = True


class LeistungskatalogUpdate(_Base):
    row_version: int
    name: str
    aktiv: bool = True


class LeistungskatalogRead(ReadBase):
    name: str
    aktiv: bool
