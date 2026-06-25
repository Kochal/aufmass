from __future__ import annotations
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response
from psycopg import Connection

from ..deps import Principal, db_session, get_principal
from ..errors import db_errors, require_row
from ..schemas.fahrzeug import FahrzeugCreate, FahrzeugRead, FahrzeugUpdate

router = APIRouter(prefix="/api/fahrzeug", tags=["Fahrzeug"])

_SELECT_ALIVE = "select * from fahrzeug where deleted_at is null"


@router.get("", response_model=list[FahrzeugRead])
def list_fahrzeug(conn: Connection = Depends(db_session)):
    return conn.execute(f"{_SELECT_ALIVE} order by kennzeichen").fetchall()


@router.get("/{id}", response_model=FahrzeugRead)
def get_fahrzeug(id: UUID, conn: Connection = Depends(db_session)):
    row = conn.execute(f"{_SELECT_ALIVE} and id = %s", (str(id),)).fetchone()
    if row is None:
        raise HTTPException(404)
    return row


@router.post("", response_model=FahrzeugRead, status_code=201)
def create_fahrzeug(
    body: FahrzeugCreate,
    principal: Principal = Depends(get_principal),
    conn: Connection = Depends(db_session),
):
    with db_errors():
        row = conn.execute(
            "insert into fahrzeug(tenant_id, kennzeichen, typ, privat_genutzt) "
            "values (%s,%s,%s,%s) returning *",
            (str(principal.tenant_id), body.kennzeichen, body.typ, body.privat_genutzt),
        ).fetchone()
    return row


@router.put("/{id}", response_model=FahrzeugRead)
def update_fahrzeug(id: UUID, body: FahrzeugUpdate, conn: Connection = Depends(db_session)):
    with db_errors():
        row = conn.execute(
            "update fahrzeug set kennzeichen=%s, typ=%s, privat_genutzt=%s "
            "where id=%s and deleted_at is null and row_version=%s returning *",
            (body.kennzeichen, body.typ, body.privat_genutzt, str(id), body.row_version),
        ).fetchone()
    require_row(row, conn, "fahrzeug", id)
    return row


@router.delete("/{id}", status_code=204)
def delete_fahrzeug(id: UUID, conn: Connection = Depends(db_session)):
    with db_errors():
        cur = conn.execute(
            "update fahrzeug set deleted_at=now(), deleted_by=core.current_actor() "
            "where id=%s and deleted_at is null", (str(id),)
        )
    if cur.rowcount == 0:
        raise HTTPException(404)
    return Response(status_code=204)
