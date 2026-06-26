from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response
from psycopg import Connection

from ..deps import Principal, db_session, get_principal
from ..errors import db_errors, require_row
from ..schemas.rechnung_position import (
    RechnungPositionCreate, RechnungPositionRead, RechnungPositionUpdate,
)

router = APIRouter(prefix="/api/rechnung-position", tags=["RechnungPosition"])

_SELECT_ALIVE = "select * from rechnung_position where deleted_at is null"


@router.get("", response_model=list[RechnungPositionRead])
def list_rechnung_position(
    rechnung_id: UUID | None = None, conn: Connection = Depends(db_session)
):
    if rechnung_id is not None:
        return conn.execute(
            f"{_SELECT_ALIVE} and rechnung_id=%s order by position_nr nulls last",
            (str(rechnung_id),),
        ).fetchall()
    return conn.execute(
        f"{_SELECT_ALIVE} order by rechnung_id, position_nr nulls last"
    ).fetchall()


@router.get("/{id}", response_model=RechnungPositionRead)
def get_rechnung_position(id: UUID, conn: Connection = Depends(db_session)):
    row = conn.execute(f"{_SELECT_ALIVE} and id=%s", (str(id),)).fetchone()
    if row is None:
        raise HTTPException(404)
    return row


@router.post("", response_model=RechnungPositionRead, status_code=201)
def create_rechnung_position(
    body: RechnungPositionCreate,
    principal: Principal = Depends(get_principal),
    conn: Connection = Depends(db_session),
):
    with db_errors():
        row = conn.execute(
            "insert into rechnung_position("
            "  tenant_id, rechnung_id, position_nr, bezeichnung, einheit,"
            "  einheitspreis, menge_tender, menge_aufmass, menge, vob_2_3_flag,"
            "  lv_position_id, leistung_id"
            ") values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) returning *",
            (
                str(principal.tenant_id),
                str(body.rechnung_id),
                body.position_nr,
                body.bezeichnung,
                body.einheit,
                body.einheitspreis,
                body.menge_tender,
                body.menge_aufmass,
                body.menge,
                body.vob_2_3_flag,
                str(body.lv_position_id) if body.lv_position_id else None,
                str(body.leistung_id) if body.leistung_id else None,
            ),
        ).fetchone()
    return row


@router.put("/{id}", response_model=RechnungPositionRead)
def update_rechnung_position(
    id: UUID, body: RechnungPositionUpdate, conn: Connection = Depends(db_session)
):
    with db_errors():
        row = conn.execute(
            "update rechnung_position set position_nr=%s, bezeichnung=%s, einheit=%s,"
            "  einheitspreis=%s, menge_tender=%s, menge_aufmass=%s, menge=%s,"
            "  vob_2_3_flag=%s, lv_position_id=%s, leistung_id=%s "
            "where id=%s and deleted_at is null and row_version=%s returning *",
            (
                body.position_nr,
                body.bezeichnung,
                body.einheit,
                body.einheitspreis,
                body.menge_tender,
                body.menge_aufmass,
                body.menge,
                body.vob_2_3_flag,
                str(body.lv_position_id) if body.lv_position_id else None,
                str(body.leistung_id) if body.leistung_id else None,
                str(id),
                body.row_version,
            ),
        ).fetchone()
    require_row(row, conn, "rechnung_position", id)
    return row


@router.delete("/{id}", status_code=204)
def delete_rechnung_position(id: UUID, conn: Connection = Depends(db_session)):
    with db_errors():
        cur = conn.execute(
            "update rechnung_position set deleted_at=now(), deleted_by=core.current_actor() "
            "where id=%s and deleted_at is null", (str(id),)
        )
    if cur.rowcount == 0:
        raise HTTPException(404)
    return Response(status_code=204)
