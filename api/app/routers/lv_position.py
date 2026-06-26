from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response
from psycopg import Connection

from ..deps import Principal, db_session, get_principal
from ..errors import db_errors, require_row
from ..schemas.lv_position import LvPositionCreate, LvPositionRead, LvPositionUpdate

router = APIRouter(prefix="/api/lv-position", tags=["LVPosition"])

_SELECT_ALIVE = "select * from lv_position where deleted_at is null"


@router.get("", response_model=list[LvPositionRead])
def list_lv_position(lv_id: UUID | None = None, conn: Connection = Depends(db_session)):
    if lv_id is not None:
        return conn.execute(
            f"{_SELECT_ALIVE} and lv_id=%s order by position_nr nulls last, oz nulls last",
            (str(lv_id),),
        ).fetchall()
    return conn.execute(
        f"{_SELECT_ALIVE} order by lv_id, position_nr nulls last, oz nulls last"
    ).fetchall()


@router.get("/{id}", response_model=LvPositionRead)
def get_lv_position(id: UUID, conn: Connection = Depends(db_session)):
    row = conn.execute(f"{_SELECT_ALIVE} and id=%s", (str(id),)).fetchone()
    if row is None:
        raise HTTPException(404)
    return row


@router.post("", response_model=LvPositionRead, status_code=201)
def create_lv_position(
    body: LvPositionCreate,
    principal: Principal = Depends(get_principal),
    conn: Connection = Depends(db_session),
):
    with db_errors():
        row = conn.execute(
            "insert into lv_position("
            "  tenant_id, lv_id, oz, kurztext, langtext, menge, einheit,"
            "  einheitspreis, matched_leistung_id, match_confidence, match_status,"
            "  source, position_nr"
            ") values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) returning *",
            (
                str(principal.tenant_id),
                str(body.lv_id),
                body.oz,
                body.kurztext,
                body.langtext,
                body.menge,
                body.einheit,
                body.einheitspreis,
                str(body.matched_leistung_id) if body.matched_leistung_id else None,
                body.match_confidence,
                body.match_status,
                body.source,
                body.position_nr,
            ),
        ).fetchone()
    return row


@router.put("/{id}", response_model=LvPositionRead)
def update_lv_position(
    id: UUID, body: LvPositionUpdate, conn: Connection = Depends(db_session)
):
    with db_errors():
        row = conn.execute(
            "update lv_position set oz=%s, kurztext=%s, langtext=%s, menge=%s, einheit=%s,"
            "  einheitspreis=%s, matched_leistung_id=%s, match_confidence=%s, match_status=%s,"
            "  source=%s, position_nr=%s "
            "where id=%s and deleted_at is null and row_version=%s returning *",
            (
                body.oz,
                body.kurztext,
                body.langtext,
                body.menge,
                body.einheit,
                body.einheitspreis,
                str(body.matched_leistung_id) if body.matched_leistung_id else None,
                body.match_confidence,
                body.match_status,
                body.source,
                body.position_nr,
                str(id),
                body.row_version,
            ),
        ).fetchone()
    require_row(row, conn, "lv_position", id)
    return row


@router.delete("/{id}", status_code=204)
def delete_lv_position(id: UUID, conn: Connection = Depends(db_session)):
    with db_errors():
        cur = conn.execute(
            "update lv_position set deleted_at=now(), deleted_by=core.current_actor() "
            "where id=%s and deleted_at is null", (str(id),)
        )
    if cur.rowcount == 0:
        raise HTTPException(404)
    return Response(status_code=204)
