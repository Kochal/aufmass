from __future__ import annotations
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response
from psycopg import Connection

from ..deps import Principal, db_session, get_principal
from ..errors import db_errors, require_row
from ..schemas.bankverbindung import BankverbindungCreate, BankverbindungRead, BankverbindungUpdate

router = APIRouter(prefix="/api/bankverbindung", tags=["Bankverbindung"])

_SELECT_ALIVE = "select * from bankverbindung where deleted_at is null"


@router.get("", response_model=list[BankverbindungRead])
def list_bankverbindung(conn: Connection = Depends(db_session)):
    return conn.execute(f"{_SELECT_ALIVE} order by inhaber").fetchall()


@router.get("/{id}", response_model=BankverbindungRead)
def get_bankverbindung(id: UUID, conn: Connection = Depends(db_session)):
    row = conn.execute(f"{_SELECT_ALIVE} and id=%s", (str(id),)).fetchone()
    if row is None:
        raise HTTPException(404)
    return row


@router.post("", response_model=BankverbindungRead, status_code=201)
def create_bankverbindung(
    body: BankverbindungCreate,
    principal: Principal = Depends(get_principal),
    conn: Connection = Depends(db_session),
):
    with db_errors():
        row = conn.execute(
            "insert into bankverbindung(tenant_id, iban, inhaber, bic, bank_name) "
            "values (%s,%s,%s,%s,%s) returning *",
            (str(principal.tenant_id), body.iban, body.inhaber, body.bic, body.bank_name),
        ).fetchone()
    return row


@router.put("/{id}", response_model=BankverbindungRead)
def update_bankverbindung(
    id: UUID, body: BankverbindungUpdate, conn: Connection = Depends(db_session)
):
    with db_errors():
        row = conn.execute(
            "update bankverbindung set iban=%s, inhaber=%s, bic=%s, bank_name=%s "
            "where id=%s and deleted_at is null and row_version=%s returning *",
            (body.iban, body.inhaber, body.bic, body.bank_name, str(id), body.row_version),
        ).fetchone()
    require_row(row, conn, "bankverbindung", id)
    return row


@router.delete("/{id}", status_code=204)
def delete_bankverbindung(id: UUID, conn: Connection = Depends(db_session)):
    with db_errors():
        cur = conn.execute(
            "update bankverbindung set deleted_at=now(), deleted_by=core.current_actor() "
            "where id=%s and deleted_at is null", (str(id),)
        )
    if cur.rowcount == 0:
        raise HTTPException(404)
    return Response(status_code=204)
