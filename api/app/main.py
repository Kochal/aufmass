"""FastAPI application entry point.

Kept deliberately thin: this scaffold stands up the server, the connection pool,
the per-request RLS session context, and a health probe, plus one example
tenant-scoped endpoint that demonstrates RLS actually binding. Feature modules
(05 spine, 06 quotation, 07 Aufmaß) hang off this.

The OpenAPI schema FastAPI emits at /openapi.json is the source the TypeScript
client is generated from (directive 10, layer contract): the frontend and
backend cannot drift on shapes.
"""
from __future__ import annotations

from contextlib import asynccontextmanager
from uuid import UUID

from fastapi import Depends, FastAPI, Header, HTTPException
from psycopg import Connection

from .config import settings
from .db import healthcheck, pool, tenant_connection


@asynccontextmanager
async def lifespan(app: FastAPI):
    pool.open()
    try:
        yield
    finally:
        pool.close()


app = FastAPI(title="Aufmaß API", version="0.1.0", lifespan=lifespan)


class Principal:
    """Who the request acts as. Real authentication (OIDC / session, field-worker
    auth) is directive 09; this dev stub takes the tenant and user from headers so
    the RLS plumbing can be exercised end to end before auth lands."""

    def __init__(self, tenant_id: UUID, user_id: str):
        self.tenant_id = tenant_id
        self.user_id = user_id


def get_principal(
    x_tenant_id: str | None = Header(default=None),
    x_user_id: str | None = Header(default=None),
) -> Principal:
    if not settings.is_dev:
        # Outside dev, identity must come from authenticated session, not headers.
        raise HTTPException(status_code=501, detail="auth not yet implemented (directive 09)")
    if not x_tenant_id or not x_user_id:
        raise HTTPException(status_code=401, detail="X-Tenant-Id and X-User-Id headers required in dev")
    try:
        return Principal(UUID(x_tenant_id), x_user_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="X-Tenant-Id must be a UUID")


def db_session(principal: Principal = Depends(get_principal)) -> Connection:
    with tenant_connection(principal.tenant_id, principal.user_id) as conn:
        yield conn


@app.get("/health")
def health() -> dict:
    """Liveness + DB reachability. No tenant context required."""
    return {"status": "ok", "db": healthcheck(), "env": settings.env}


@app.get("/api/auftraggeber")
def list_auftraggeber(conn: Connection = Depends(db_session)) -> list[dict]:
    """Example tenant-scoped read. Returns only the caller's tenant's rows
    because RLS filters them — the endpoint never adds a tenant_id WHERE clause."""
    rows = conn.execute(
        "select id, name, typ from auftraggeber where deleted_at is null order by name"
    ).fetchall()
    return [{"id": str(r[0]), "name": r[1], "typ": r[2]} for r in rows]
