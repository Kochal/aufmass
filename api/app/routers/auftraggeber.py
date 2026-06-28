from __future__ import annotations
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response
from psycopg import Connection

from ..deps import Principal, db_session, get_principal
from ..errors import db_errors, require_row
from ..schemas.auftraggeber import AuftraggeberCreate, AuftraggeberRead, AuftraggeberUpdate

router = APIRouter(prefix="/api/auftraggeber", tags=["Auftraggeber"])

_SELECT_ALIVE = "select * from auftraggeber where deleted_at is null"


@router.get("", response_model=list[AuftraggeberRead])
def list_auftraggeber(conn: Connection = Depends(db_session)):
    return conn.execute(f"{_SELECT_ALIVE} order by name").fetchall()


@router.get("/{id}", response_model=AuftraggeberRead)
def get_auftraggeber(id: UUID, conn: Connection = Depends(db_session)):
    row = conn.execute(f"{_SELECT_ALIVE} and id = %s", (str(id),)).fetchone()
    if row is None:
        raise HTTPException(404)
    return row


@router.post("", response_model=AuftraggeberRead, status_code=201)
def create_auftraggeber(
    body: AuftraggeberCreate,
    principal: Principal = Depends(get_principal),
    conn: Connection = Depends(db_session),
):
    with db_errors():
        row = conn.execute(
            "insert into auftraggeber(tenant_id, name, kundennummer, typ, ust_idnr,"
            "  adresse_id, leitweg_id, elektronische_adresse, eas_scheme) "
            "values (%s, %s, %s, %s, %s, %s, %s, %s, %s) returning *",
            (
                str(principal.tenant_id), body.name, body.kundennummer, body.typ, body.ust_idnr,
                str(body.adresse_id) if body.adresse_id else None,
                body.leitweg_id, body.elektronische_adresse, body.eas_scheme,
            ),
        ).fetchone()
    return row


@router.put("/{id}", response_model=AuftraggeberRead)
def update_auftraggeber(
    id: UUID,
    body: AuftraggeberUpdate,
    conn: Connection = Depends(db_session),
):
    with db_errors():
        row = conn.execute(
            "update auftraggeber set name=%s, kundennummer=%s, typ=%s, ust_idnr=%s,"
            "  adresse_id=%s, leitweg_id=%s, elektronische_adresse=%s, eas_scheme=%s "
            "where id=%s and deleted_at is null and row_version=%s returning *",
            (
                body.name, body.kundennummer, body.typ, body.ust_idnr,
                str(body.adresse_id) if body.adresse_id else None,
                body.leitweg_id, body.elektronische_adresse, body.eas_scheme,
                str(id), body.row_version,
            ),
        ).fetchone()
    require_row(row, conn, "auftraggeber", id)
    return row


@router.delete("/{id}", status_code=204)
def delete_auftraggeber(id: UUID, conn: Connection = Depends(db_session)):
    with db_errors():
        cur = conn.execute(
            "update auftraggeber "
            "set deleted_at = now(), deleted_by = core.current_actor() "
            "where id = %s and deleted_at is null",
            (str(id),),
        )
    if cur.rowcount == 0:
        raise HTTPException(404)
    return Response(status_code=204)
