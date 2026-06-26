from __future__ import annotations

from uuid import UUID

from .common import ReadBase, _Base


class LvCreate(_Base):
    angebot_id: UUID | None = None
    source: str
    gaeb_artifact_id: UUID | None = None


class LvUpdate(_Base):
    row_version: int
    angebot_id: UUID | None = None
    source: str
    gaeb_artifact_id: UUID | None = None


class LvRead(ReadBase):
    angebot_id: UUID | None = None
    source: str
    gaeb_artifact_id: UUID | None = None
