from __future__ import annotations
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response
from psycopg import Connection

from ..deps import Principal, db_session, get_principal
from ..errors import db_errors, require_row
from ..schemas.gewaehrleistung import GewaehrleistungCreate, GewaehrleistungRead, GewaehrleistungUpdate

router = APIRouter(prefix="/api/gewaehrleistung", tags=["Gewährleistung"])

_SELECT_ALIVE = "select * from gewaehrleistung where deleted_at is null"


@router.get("", response_model=list[GewaehrleistungRead])
def list_gewaehrleistung(
    status: str | None = None,
    conn: Connection = Depends(db_session),
):
    if status is not None:
        return conn.execute(
            f"{_SELECT_ALIVE} and status=%s order by frist_ende nulls last", (status,)
        ).fetchall()
    return conn.execute(f"{_SELECT_ALIVE} order by frist_ende nulls last").fetchall()


@router.get("/{id}", response_model=GewaehrleistungRead)
def get_gewaehrleistung(id: UUID, conn: Connection = Depends(db_session)):
    row = conn.execute(f"{_SELECT_ALIVE} and id=%s", (str(id),)).fetchone()
    if row is None:
        raise HTTPException(404)
    return row


@router.post("", response_model=GewaehrleistungRead, status_code=201)
def create_gewaehrleistung(
    body: GewaehrleistungCreate,
    principal: Principal = Depends(get_principal),
    conn: Connection = Depends(db_session),
):
    with db_errors():
        row = conn.execute(
            "insert into gewaehrleistung(tenant_id, projekt_id, regime, start_datum, frist_jahre) "
            "values (%s,%s,%s,%s,%s) returning *",
            (str(principal.tenant_id), str(body.projekt_id), body.regime,
             body.start_datum, body.frist_jahre),
        ).fetchone()
    return row


@router.put("/{id}", response_model=GewaehrleistungRead)
def update_gewaehrleistung(id: UUID, body: GewaehrleistungUpdate, conn: Connection = Depends(db_session)):
    with db_errors():
        row = conn.execute(
            "update gewaehrleistung set frist_jahre=%s, start_datum=%s, status=%s "
            "where id=%s and deleted_at is null and row_version=%s returning *",
            (body.frist_jahre, body.start_datum, body.status, str(id), body.row_version),
        ).fetchone()
    require_row(row, conn, "gewaehrleistung", id)
    return row


@router.delete("/{id}", status_code=204)
def delete_gewaehrleistung(id: UUID, conn: Connection = Depends(db_session)):
    with db_errors():
        cur = conn.execute(
            "update gewaehrleistung set deleted_at=now(), deleted_by=core.current_actor() "
            "where id=%s and deleted_at is null", (str(id),)
        )
    if cur.rowcount == 0:
        raise HTTPException(404)
    return Response(status_code=204)
