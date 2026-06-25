"""Postgres → HTTP error translation for all router endpoints."""
from __future__ import annotations

from contextlib import contextmanager
from uuid import UUID

from fastapi import HTTPException
from psycopg import Connection, sql
from psycopg.errors import (
    CheckViolation,
    ForeignKeyViolation,
    IntegrityConstraintViolation,
    RaiseException,
    UniqueViolation,
)


@contextmanager
def db_errors():
    """Translate psycopg integrity errors into appropriate HTTP responses.

    Catch order matters: more-specific subclasses first, then the parent.
    """
    try:
        yield
    except UniqueViolation as e:
        raise HTTPException(status_code=409, detail=e.diag.message_primary or "already exists")
    except ForeignKeyViolation as e:
        raise HTTPException(
            status_code=422, detail=e.diag.message_primary or "referenced record not found"
        )
    except CheckViolation as e:
        raise HTTPException(status_code=422, detail=e.diag.message_primary or "invalid value")
    except (RaiseException, IntegrityConstraintViolation) as e:
        # Guard functions (status guards, freeze-on-approval, delete-with-deps) raise
        # integrity_constraint_violation (23000) or raise exception (P0001) with a
        # human-readable message_primary already written in the function body.
        raise HTTPException(status_code=409, detail=e.diag.message_primary or "operation rejected")


def require_row(row: dict | None, conn: Connection, table: str, id: UUID) -> None:
    """After an UPDATE … RETURNING *, raise 404 or 409 if no row came back.

    0 rows from a version-checked UPDATE means either the row doesn't exist /
    is soft-deleted (→ 404) or the row_version was stale (→ 409).
    """
    if row is not None:
        return
    existing = conn.execute(
        sql.SQL("select deleted_at from {} where id = %s").format(sql.Identifier(table)),
        (str(id),),
    ).fetchone()
    if existing is None or existing["deleted_at"] is not None:
        raise HTTPException(status_code=404, detail="not found")
    raise HTTPException(status_code=409, detail="stale row_version – reload and retry")
