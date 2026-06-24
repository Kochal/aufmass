"""Database access and the per-request RLS session context.

Directive 10, app-layer non-negotiable 1: "Every request sets app.tenant_id and
app.user_id with SET LOCAL inside its transaction, so RLS (02) sees the right
tenant and the audit trigger records the right actor. The connection pooler must
not leak that context across requests."

How that guarantee is made real here:
  * The app connects as a non-superuser login role in app_role, so RLS binds
    (see config.database_url / 0001_foundation_roles.sql).
  * Each request runs inside ONE transaction, and the tenant/user are set with
    `set_config(key, value, is_local => true)` — the function form of SET LOCAL.
    Because the setting is transaction-local, it is discarded automatically when
    the transaction ends. A pooled connection therefore cannot carry one
    request's tenant into the next: there is nothing to leak.

Money note: amounts read/written here are decimal.Decimal, never float
(directive 10, non-negotiable 2). psycopg maps numeric -> Decimal by default.
"""
from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator
from uuid import UUID

from psycopg import Connection
from psycopg_pool import ConnectionPool

from .config import settings

# Opened in the FastAPI lifespan (main.py), not at import time.
pool = ConnectionPool(settings.database_url, min_size=1, max_size=10, open=False)


@contextmanager
def tenant_connection(tenant_id: UUID, user_id: str) -> Iterator[Connection]:
    """Yield a connection bound to one tenant/user for the life of one
    transaction. Commits on clean exit, rolls back on exception."""
    with pool.connection() as conn:
        with conn.transaction():
            conn.execute(
                "select set_config('app.tenant_id', %s, true)", (str(tenant_id),)
            )
            conn.execute(
                "select set_config('app.user_id', %s, true)", (str(user_id),)
            )
            yield conn


def healthcheck() -> bool:
    """A tenant-less liveness probe: can we reach the DB at all?"""
    with pool.connection() as conn:
        return conn.execute("select 1").fetchone() == (1,)
