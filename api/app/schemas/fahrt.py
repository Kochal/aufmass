from __future__ import annotations
from datetime import date, datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID
from .common import _Base, ReadBase

FreigabeStatus = Literal["offen", "freigegeben"]


class FahrtCreate(_Base):
    app_user_id: UUID
    projekt_id: UUID | None = None
    fahrzeug_id: UUID | None = None
    datum: date
    von: str | None = None
    nach: str | None = None
    km: Decimal
    zweck: str | None = None


class FahrtUpdate(_Base):
    row_version: int
    projekt_id: UUID | None = None
    fahrzeug_id: UUID | None = None
    datum: date
    von: str | None = None
    nach: str | None = None
    km: Decimal
    zweck: str | None = None


class FahrtFreigabe(_Base):
    row_version: int


class FahrtKorrektur(_Base):
    """Fields for a correcting row. app_user_id inherited from frozen source."""
    projekt_id: UUID | None = None
    fahrzeug_id: UUID | None = None
    datum: date
    von: str | None = None
    nach: str | None = None
    km: Decimal
    zweck: str | None = None


class FahrtRead(ReadBase):
    app_user_id: UUID
    projekt_id: UUID | None = None
    fahrzeug_id: UUID | None = None
    datum: date
    von: str | None = None
    nach: str | None = None
    km: Decimal
    zweck: str | None = None
    freigabe_status: FreigabeStatus
    freigegeben_am: datetime | None = None
    freigegeben_von: str | None = None
    korrektur_von_id: UUID | None = None
