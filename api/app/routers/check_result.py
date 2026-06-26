from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from psycopg import Connection

from ..deps import db_session
from ..errors import require_row
from ..schemas.check_result import CheckResultRead

router = APIRouter(prefix="/api/check-result", tags=["CheckResult"])

_SELECT_ALIVE = "select * from check_result where deleted_at is null"


@router.get("", response_model=list[CheckResultRead])
def list_check_result(
    target_table: str | None = None,
    target_id: UUID | None = None,
    conn: Connection = Depends(db_session),
):
    clauses = ["deleted_at is null"]
    params: list = []
    if target_table is not None:
        clauses.append("target_table=%s"); params.append(target_table)
    if target_id is not None:
        clauses.append("target_id=%s"); params.append(str(target_id))
    where = " and ".join(clauses)
    return conn.execute(
        f"select * from check_result where {where} order by checked_at desc", params
    ).fetchall()


@router.get("/{id}", response_model=CheckResultRead)
def get_check_result(id: UUID, conn: Connection = Depends(db_session)):
    row = conn.execute(f"{_SELECT_ALIVE} and id=%s", (str(id),)).fetchone()
    if row is None:
        raise HTTPException(404)
    return row


@router.patch("/{id}/resolve", response_model=CheckResultRead)
def resolve_check_result(id: UUID, row_version: int, conn: Connection = Depends(db_session)):
    """Mark a soft/failed check as resolved by a reviewer."""
    row = conn.execute(
        "update check_result set resolved=true "
        "where id=%s and deleted_at is null and row_version=%s returning *",
        (str(id), row_version),
    ).fetchone()
    require_row(row, conn, "check_result", id)
    return row
