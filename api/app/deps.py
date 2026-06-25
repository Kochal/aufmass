"""FastAPI dependencies: identity (Principal) and the DB session.

Kept here (not in main.py) so routers can import without creating a circular
dependency with main.py which imports the routers.
"""
from __future__ import annotations

from uuid import UUID

from fastapi import Depends, Header, HTTPException
from psycopg import Connection

from .config import settings
from .db import tenant_connection


class Principal:
    """Who the request acts as. Real authentication (OIDC / session, field-worker
    auth) is directive 09; this dev stub reads X-Tenant-Id / X-User-Id headers so
    the RLS plumbing can be exercised end to end before auth lands."""

    def __init__(self, tenant_id: UUID, user_id: UUID) -> None:
        self.tenant_id = tenant_id
        self.user_id = user_id


def get_principal(
    x_tenant_id: str | None = Header(default=None),
    x_user_id: str | None = Header(default=None),
) -> Principal:
    if not settings.is_dev:
        raise HTTPException(status_code=501, detail="auth not yet implemented (directive 09)")
    if not x_tenant_id or not x_user_id:
        raise HTTPException(
            status_code=401, detail="X-Tenant-Id and X-User-Id headers required in dev"
        )
    try:
        return Principal(UUID(x_tenant_id), UUID(x_user_id))
    except ValueError:
        raise HTTPException(status_code=400, detail="X-Tenant-Id and X-User-Id must be UUIDs")


def db_session(principal: Principal = Depends(get_principal)) -> Connection:
    with tenant_connection(principal.tenant_id, principal.user_id) as conn:
        yield conn
