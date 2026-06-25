from __future__ import annotations
from .common import _Base, ReadBase


class FahrzeugCreate(_Base):
    kennzeichen: str
    typ: str | None = None
    privat_genutzt: bool = False


class FahrzeugUpdate(_Base):
    row_version: int
    kennzeichen: str
    typ: str | None = None
    privat_genutzt: bool = False


class FahrzeugRead(ReadBase):
    kennzeichen: str
    typ: str | None = None
    privat_genutzt: bool
