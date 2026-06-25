from __future__ import annotations
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response
from psycopg import Connection

from ..db import set_reason
from ..deps import Principal, db_session, get_principal
from ..errors import db_errors, require_row
from ..schemas.bestellung import (
    BestellungCreate, BestellungRead, BestellungStatus, BestellungStatusPatch, BestellungUpdate
)

router = APIRouter(prefix="/api/bestellung", tags=["Bestellung"])

_SELECT_ALIVE = "select * from bestellung where deleted_at is null"


@router.get("", response_model=list[BestellungRead])
def list_bestellung(
    projekt_id: UUID | None = None,
    status: BestellungStatus | None = None,
    conn: Connection = Depends(db_session),
):
    clauses = ["deleted_at is null"]
    params: list = []
    if projekt_id is not None:
        clauses.append("projekt_id = %s"); params.append(str(projekt_id))
    if status is not None:
        clauses.append("status = %s"); params.append(status)
    where = " and ".join(clauses)
    return conn.execute(
        f"select * from bestellung where {where} order by created_at desc", params
    ).fetchall()


@router.get("/{id}", response_model=BestellungRead)
def get_bestellung(id: UUID, conn: Connection = Depends(db_session)):
    row = conn.execute(f"{_SELECT_ALIVE} and id=%s", (str(id),)).fetchone()
    if row is None:
        raise HTTPException(404)
    return row


@router.post("", response_model=BestellungRead, status_code=201)
def create_bestellung(
    body: BestellungCreate,
    principal: Principal = Depends(get_principal),
    conn: Connection = Depends(db_session),
):
    with db_errors():
        row = conn.execute(
            "insert into bestellung(tenant_id, lieferant_id, projekt_id, bestelldatum, summe, "
            "auftragsbestaetigung_document_id) values (%s,%s,%s,%s,%s,%s) returning *",
            (str(principal.tenant_id), str(body.lieferant_id),
             str(body.projekt_id) if body.projekt_id else None,
             body.bestelldatum, body.summe,
             str(body.auftragsbestaetigung_document_id) if body.auftragsbestaetigung_document_id else None),
        ).fetchone()
    return row


@router.put("/{id}", response_model=BestellungRead)
def update_bestellung(id: UUID, body: BestellungUpdate, conn: Connection = Depends(db_session)):
    with db_errors():
        row = conn.execute(
            "update bestellung set lieferant_id=%s, projekt_id=%s, bestelldatum=%s, summe=%s, "
            "auftragsbestaetigung_document_id=%s "
            "where id=%s and deleted_at is null and row_version=%s returning *",
            (str(body.lieferant_id),
             str(body.projekt_id) if body.projekt_id else None,
             body.bestelldatum, body.summe,
             str(body.auftragsbestaetigung_document_id) if body.auftragsbestaetigung_document_id else None,
             str(id), body.row_version),
        ).fetchone()
    require_row(row, conn, "bestellung", id)
    return row


@router.patch("/{id}/status", response_model=BestellungRead)
def patch_bestellung_status(
    id: UUID,
    body: BestellungStatusPatch,
    conn: Connection = Depends(db_session),
):
    set_reason(conn, body.reason)
    with db_errors():
        row = conn.execute(
            "update bestellung set status=%s where id=%s and deleted_at is null and row_version=%s returning *",
            (body.status, str(id), body.row_version),
        ).fetchone()
    require_row(row, conn, "bestellung", id)
    return row


@router.delete("/{id}", status_code=204)
def delete_bestellung(id: UUID, conn: Connection = Depends(db_session)):
    with db_errors():
        cur = conn.execute(
            "update bestellung set deleted_at=now(), deleted_by=core.current_actor() "
            "where id=%s and deleted_at is null", (str(id),)
        )
    if cur.rowcount == 0:
        raise HTTPException(404)
    return Response(status_code=204)
