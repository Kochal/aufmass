from __future__ import annotations
from uuid import UUID
from .common import ReadBase


class MangelFotoRead(ReadBase):
    mangel_id: UUID
    document_id: UUID
    beschriftung: str | None = None
