from __future__ import annotations
from uuid import UUID
from pydantic import BaseModel


class AppUserRead(BaseModel):
    id: UUID
    tenant_id: UUID
    email: str
    display_name: str | None = None
    role: str
    status: str
