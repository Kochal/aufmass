from __future__ import annotations

from decimal import Decimal
from uuid import UUID

from .common import ReadBase, _Base


class LeistungCreate(_Base):
    leistungskatalog_id: UUID
    code: str
    kurztext: str
    langtext: str | None = None
    einheit: str
    einheitspreis: Decimal | None = None
    aktiv: bool = True


class LeistungUpdate(_Base):
    row_version: int
    kurztext: str
    langtext: str | None = None
    einheit: str
    einheitspreis: Decimal | None = None
    aktiv: bool = True


class LeistungRead(ReadBase):
    leistungskatalog_id: UUID
    code: str
    kurztext: str
    langtext: str | None = None
    einheit: str
    einheitspreis: Decimal | None = None
    aktiv: bool
