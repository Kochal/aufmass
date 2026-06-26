from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response
from psycopg import Connection

from ..deps import Principal, db_session, get_principal
from ..errors import db_errors, require_row
from ..schemas.lv import LvCreate, LvRead, LvUpdate

router = APIRouter(prefix="/api/lv", tags=["LV"])

_SELECT_ALIVE = "select * from lv where deleted_at is null"


@router.get("", response_model=list[LvRead])
def list_lv(angebot_id: UUID | None = None, conn: Connection = Depends(db_session)):
    if angebot_id is not None:
        return conn.execute(
            f"{_SELECT_ALIVE} and angebot_id=%s order by created_at", (str(angebot_id),)
        ).fetchall()
    return conn.execute(f"{_SELECT_ALIVE} order by created_at").fetchall()


@router.get("/{id}", response_model=LvRead)
def get_lv(id: UUID, conn: Connection = Depends(db_session)):
    row = conn.execute(f"{_SELECT_ALIVE} and id=%s", (str(id),)).fetchone()
    if row is None:
        raise HTTPException(404)
    return row


@router.post("", response_model=LvRead, status_code=201)
def create_lv(
    body: LvCreate,
    principal: Principal = Depends(get_principal),
    conn: Connection = Depends(db_session),
):
    with db_errors():
        row = conn.execute(
            "insert into lv(tenant_id, angebot_id, source, gaeb_artifact_id) "
            "values (%s,%s,%s,%s) returning *",
            (
                str(principal.tenant_id),
                str(body.angebot_id) if body.angebot_id else None,
                body.source,
                str(body.gaeb_artifact_id) if body.gaeb_artifact_id else None,
            ),
        ).fetchone()
    return row


@router.put("/{id}", response_model=LvRead)
def update_lv(id: UUID, body: LvUpdate, conn: Connection = Depends(db_session)):
    with db_errors():
        row = conn.execute(
            "update lv set angebot_id=%s, source=%s, gaeb_artifact_id=%s "
            "where id=%s and deleted_at is null and row_version=%s returning *",
            (
                str(body.angebot_id) if body.angebot_id else None,
                body.source,
                str(body.gaeb_artifact_id) if body.gaeb_artifact_id else None,
                str(id),
                body.row_version,
            ),
        ).fetchone()
    require_row(row, conn, "lv", id)
    return row


@router.delete("/{id}", status_code=204)
def delete_lv(id: UUID, conn: Connection = Depends(db_session)):
    with db_errors():
        cur = conn.execute(
            "update lv set deleted_at=now(), deleted_by=core.current_actor() "
            "where id=%s and deleted_at is null", (str(id),)
        )
    if cur.rowcount == 0:
        raise HTTPException(404)
    return Response(status_code=204)
