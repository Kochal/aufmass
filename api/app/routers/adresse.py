from __future__ import annotations
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response
from psycopg import Connection

from ..deps import Principal, db_session, get_principal
from ..errors import db_errors, require_row
from ..schemas.adresse import AdresseCreate, AdresseRead, AdresseUpdate

router = APIRouter(prefix="/api/adresse", tags=["Adresse"])

_SELECT_ALIVE = "select * from adresse where deleted_at is null"


@router.get("", response_model=list[AdresseRead])
def list_adresse(conn: Connection = Depends(db_session)):
    return conn.execute(f"{_SELECT_ALIVE} order by ort, strasse").fetchall()


@router.get("/{id}", response_model=AdresseRead)
def get_adresse(id: UUID, conn: Connection = Depends(db_session)):
    row = conn.execute(f"{_SELECT_ALIVE} and id=%s", (str(id),)).fetchone()
    if row is None:
        raise HTTPException(404)
    return row


@router.post("", response_model=AdresseRead, status_code=201)
def create_adresse(
    body: AdresseCreate,
    principal: Principal = Depends(get_principal),
    conn: Connection = Depends(db_session),
):
    with db_errors():
        row = conn.execute(
            "insert into adresse(tenant_id, strasse, adresszusatz, plz, ort, land) "
            "values (%s,%s,%s,%s,%s,%s) returning *",
            (str(principal.tenant_id), body.strasse, body.adresszusatz,
             body.plz, body.ort, body.land),
        ).fetchone()
    return row


@router.put("/{id}", response_model=AdresseRead)
def update_adresse(id: UUID, body: AdresseUpdate, conn: Connection = Depends(db_session)):
    with db_errors():
        row = conn.execute(
            "update adresse set strasse=%s, adresszusatz=%s, plz=%s, ort=%s, land=%s "
            "where id=%s and deleted_at is null and row_version=%s returning *",
            (body.strasse, body.adresszusatz, body.plz, body.ort, body.land,
             str(id), body.row_version),
        ).fetchone()
    require_row(row, conn, "adresse", id)
    return row


@router.delete("/{id}", status_code=204)
def delete_adresse(id: UUID, conn: Connection = Depends(db_session)):
    with db_errors():
        cur = conn.execute(
            "update adresse set deleted_at=now(), deleted_by=core.current_actor() "
            "where id=%s and deleted_at is null", (str(id),)
        )
    if cur.rowcount == 0:
        raise HTTPException(404)
    return Response(status_code=204)
