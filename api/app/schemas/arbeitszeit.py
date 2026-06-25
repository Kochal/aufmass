from __future__ import annotations
from datetime import datetime, timedelta
from typing import Literal
from uuid import UUID
from .common import _Base, ReadBase

FreigabeStatus = Literal["offen", "freigegeben"]


class ArbeitszeitCreate(_Base):
    app_user_id: UUID
    projekt_id: UUID | None = None
    start_zeit: datetime
    end_zeit: datetime | None = None
    pause_minuten: int = 0
    art: str | None = None


class ArbeitszeitUpdate(_Base):
    row_version: int
    start_zeit: datetime
    end_zeit: datetime | None = None
    pause_minuten: int = 0
    art: str | None = None
    projekt_id: UUID | None = None


class ArbeitszeitFreigabe(_Base):
    row_version: int


class ArbeitszeitKorrektur(_Base):
    """Fields for the new correcting row. app_user_id is inherited from the
    original frozen entry so the corrected hours stay attributed to the same
    employee."""
    start_zeit: datetime
    end_zeit: datetime | None = None
    pause_minuten: int = 0
    art: str | None = None
    projekt_id: UUID | None = None


class ArbeitszeitRead(ReadBase):
    app_user_id: UUID
    projekt_id: UUID | None = None
    start_zeit: datetime
    end_zeit: datetime | None = None
    pause_minuten: int
    dauer: timedelta | None = None     # GENERATED ALWAYS, null while end_zeit is null
    art: str | None = None
    freigabe_status: FreigabeStatus
    freigegeben_am: datetime | None = None
    freigegeben_von: str | None = None
    korrektur_von_id: UUID | None = None
