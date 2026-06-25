"""Shared Pydantic v2 base classes for all entities."""
from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class _Base(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class ReadBase(_Base):
    """Columns present on every business table (added by core.register_business_table)."""
    id: UUID
    tenant_id: UUID
    created_at: datetime
    created_by: str
    updated_at: datetime
    updated_by: str
    row_version: int
    deleted_at: datetime | None = None
