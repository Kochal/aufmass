from __future__ import annotations
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response
from psycopg import Connection

from ..deps import Principal, db_session, get_principal
from ..errors import db_errors, require_row
from ..schemas.lieferant import LieferantCreate, LieferantRead, LieferantUpdate

router = APIRouter(prefix="/api/lieferant", tags=["Lieferant"])

_SELECT_ALIVE = "select * from lieferant where deleted_at is null"


@router.get("", response_model=list[LieferantRead])
def list_lieferant(conn: Connection = Depends(db_session)):
    return conn.execute(f"{_SELECT_ALIVE} order by name").fetchall()


@router.get("/{id}", response_model=LieferantRead)
def get_lieferant(id: UUID, conn: Connection = Depends(db_session)):
    row = conn.execute(f"{_SELECT_ALIVE} and id=%s", (str(id),)).fetchone()
    if row is None:
        raise HTTPException(404)
    return row


@router.post("", response_model=LieferantRead, status_code=201)
def create_lieferant(
    body: LieferantCreate,
    principal: Principal = Depends(get_principal),
    conn: Connection = Depends(db_session),
):
    with db_errors():
        row = conn.execute(
            "insert into lieferant(tenant_id, name, ust_idnr, zahlungsziel_tage) "
            "values (%s,%s,%s,%s) returning *",
            (str(principal.tenant_id), body.name, body.ust_idnr, body.zahlungsziel_tage),
        ).fetchone()
    return row


@router.put("/{id}", response_model=LieferantRead)
def update_lieferant(id: UUID, body: LieferantUpdate, conn: Connection = Depends(db_session)):
    with db_errors():
        row = conn.execute(
            "update lieferant set name=%s, ust_idnr=%s, zahlungsziel_tage=%s "
            "where id=%s and deleted_at is null and row_version=%s returning *",
            (body.name, body.ust_idnr, body.zahlungsziel_tage, str(id), body.row_version),
        ).fetchone()
    require_row(row, conn, "lieferant", id)
    return row


@router.delete("/{id}", status_code=204)
def delete_lieferant(id: UUID, conn: Connection = Depends(db_session)):
    with db_errors():
        cur = conn.execute(
            "update lieferant set deleted_at=now(), deleted_by=core.current_actor() "
            "where id=%s and deleted_at is null", (str(id),)
        )
    if cur.rowcount == 0:
        raise HTTPException(404)
    return Response(status_code=204)
