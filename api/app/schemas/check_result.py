from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from .common import ReadBase, _Base


class CheckResultRead(ReadBase):
    target_table: str
    target_id: UUID
    rule: str
    severity: str
    passed: bool
    resolved: bool
    detail: Any | None = None
    checked_at: datetime
