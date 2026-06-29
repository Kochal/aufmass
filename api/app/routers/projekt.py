from __future__ import annotations
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response
from psycopg import Connection

from ..db import set_reason
from ..deps import Principal, db_session, get_principal
from ..errors import db_errors, require_row
from ..schemas.projekt import (
    ProjektCreate,
    ProjektRead,
    ProjektStatus,
    ProjektStatusPatch,
    ProjektUpdate,
)

router = APIRouter(prefix="/api/projekt", tags=["Projekt"])

_SELECT_ALIVE = "select * from projekt where deleted_at is null"


@router.get("", response_model=list[ProjektRead])
def list_projekt(
    status: ProjektStatus | None = None,
    auftraggeber_id: UUID | None = None,
    conn: Connection = Depends(db_session),
):
    clauses = ["deleted_at is null"]
    params: list = []
    if status is not None:
        clauses.append("status = %s")
        params.append(status)
    if auftraggeber_id is not None:
        clauses.append("auftraggeber_id = %s")
        params.append(str(auftraggeber_id))
    where = " and ".join(clauses)
    return conn.execute(
        f"select * from projekt where {where} order by created_at desc", params
    ).fetchall()


@router.get("/{id}", response_model=ProjektRead)
def get_projekt(id: UUID, conn: Connection = Depends(db_session)):
    row = conn.execute(f"{_SELECT_ALIVE} and id = %s", (str(id),)).fetchone()
    if row is None:
        raise HTTPException(404)
    return row


@router.post("", response_model=ProjektRead, status_code=201)
def create_projekt(
    body: ProjektCreate,
    principal: Principal = Depends(get_principal),
    conn: Connection = Depends(db_session),
):
    with db_errors():
        row = conn.execute(
            "insert into projekt("
            "  tenant_id, auftraggeber_id, name, nummer, site_adresse, baustellen_adresse_id,"
            "  regime, abrechnungsart, start_datum, end_datum,"
            "  abnahme_datum, abnahme_document_id"
            ") values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) returning *",
            (
                str(principal.tenant_id),
                str(body.auftraggeber_id),
                body.name,
                body.nummer,           # None → trigger allocates
                body.site_adresse,
                str(body.baustellen_adresse_id) if body.baustellen_adresse_id else None,
                body.regime,
                body.abrechnungsart,
                body.start_datum,
                body.end_datum,
                body.abnahme_datum,
                str(body.abnahme_document_id) if body.abnahme_document_id else None,
            ),
        ).fetchone()
    return row


@router.put("/{id}", response_model=ProjektRead)
def update_projekt(
    id: UUID,
    body: ProjektUpdate,
    conn: Connection = Depends(db_session),
):
    with db_errors():
        row = conn.execute(
            "update projekt set "
            "  name=%s, auftraggeber_id=%s, site_adresse=%s, baustellen_adresse_id=%s,"
            "  regime=%s, abrechnungsart=%s, start_datum=%s, end_datum=%s,"
            "  abnahme_datum=%s, abnahme_document_id=%s "
            "where id=%s and deleted_at is null and row_version=%s returning *",
            (
                body.name,
                str(body.auftraggeber_id),
                body.site_adresse,
                str(body.baustellen_adresse_id) if body.baustellen_adresse_id else None,
                body.regime,
                body.abrechnungsart,
                body.start_datum,
                body.end_datum,
                body.abnahme_datum,
                str(body.abnahme_document_id) if body.abnahme_document_id else None,
                str(id),
                body.row_version,
            ),
        ).fetchone()
    require_row(row, conn, "projekt", id)
    return row


@router.patch("/{id}/status", response_model=ProjektRead)
def patch_projekt_status(
    id: UUID,
    body: ProjektStatusPatch,
    conn: Connection = Depends(db_session),
):
    # app.reason must be set before the UPDATE so the guard can read it.
    set_reason(conn, body.reason)
    with db_errors():
        row = conn.execute(
            "update projekt set status=%s "
            "where id=%s and deleted_at is null and row_version=%s returning *",
            (body.status, str(id), body.row_version),
        ).fetchone()
    require_row(row, conn, "projekt", id)
    return row


@router.delete("/{id}", status_code=204)
def delete_projekt(id: UUID, conn: Connection = Depends(db_session)):
    with db_errors():
        cur = conn.execute(
            "update projekt "
            "set deleted_at = now(), deleted_by = core.current_actor() "
            "where id = %s and deleted_at is null",
            (str(id),),
        )
    if cur.rowcount == 0:
        raise HTTPException(404)
    return Response(status_code=204)
