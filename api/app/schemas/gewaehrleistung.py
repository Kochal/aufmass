from __future__ import annotations
from datetime import date
from typing import Literal
from uuid import UUID
from .common import _Base, ReadBase

GewaehrleistungStatus = Literal["laufend", "abgelaufen", "beendet"]
Regime = Literal["bgb", "vob"]


class GewaehrleistungCreate(_Base):
    projekt_id: UUID
    regime: Regime
    start_datum: date | None = None
    frist_jahre: int | None = None   # None → trigger defaults by regime


class GewaehrleistungUpdate(_Base):
    row_version: int
    frist_jahre: int | None = None
    start_datum: date | None = None
    status: GewaehrleistungStatus = "laufend"


class GewaehrleistungRead(ReadBase):
    projekt_id: UUID
    regime: Regime
    start_datum: date | None = None
    frist_jahre: int | None = None
    frist_ende: date | None = None    # GENERATED ALWAYS
    status: GewaehrleistungStatus
