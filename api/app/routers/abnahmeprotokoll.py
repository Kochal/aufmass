from __future__ import annotations
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response
from psycopg import Connection

from ..deps import Principal, db_session, get_principal
from ..errors import db_errors, require_row
from ..schemas.abnahmeprotokoll import AbnahmeprotokollCreate, AbnahmeprotokollRead, AbnahmeprotokollUpdate

router = APIRouter(prefix="/api/abnahmeprotokoll", tags=["Abnahmeprotokoll"])

_SELECT_ALIVE = "select * from abnahmeprotokoll where deleted_at is null"


@router.get("", response_model=list[AbnahmeprotokollRead])
def list_abnahmeprotokoll(
    projekt_id: UUID | None = None,
    conn: Connection = Depends(db_session),
):
    if projekt_id is not None:
        return conn.execute(
            f"{_SELECT_ALIVE} and projekt_id=%s order by abnahme_datum desc", (str(projekt_id),)
        ).fetchall()
    return conn.execute(f"{_SELECT_ALIVE} order by abnahme_datum desc").fetchall()


@router.get("/{id}", response_model=AbnahmeprotokollRead)
def get_abnahmeprotokoll(id: UUID, conn: Connection = Depends(db_session)):
    row = conn.execute(f"{_SELECT_ALIVE} and id=%s", (str(id),)).fetchone()
    if row is None:
        raise HTTPException(404)
    return row


@router.post("", response_model=AbnahmeprotokollRead, status_code=201)
def create_abnahmeprotokoll(
    body: AbnahmeprotokollCreate,
    principal: Principal = Depends(get_principal),
    conn: Connection = Depends(db_session),
):
    with db_errors():
        row = conn.execute(
            "insert into abnahmeprotokoll(tenant_id, projekt_id, abnahme_datum, art, abnehmer, "
            "vorbehalte, protokoll_document_id) values (%s,%s,%s,%s,%s,%s,%s) returning *",
            (str(principal.tenant_id), str(body.projekt_id), body.abnahme_datum, body.art,
             body.abnehmer, body.vorbehalte,
             str(body.protokoll_document_id) if body.protokoll_document_id else None),
        ).fetchone()
    return row


@router.put("/{id}", response_model=AbnahmeprotokollRead)
def update_abnahmeprotokoll(id: UUID, body: AbnahmeprotokollUpdate, conn: Connection = Depends(db_session)):
    with db_errors():
        row = conn.execute(
            "update abnahmeprotokoll set abnahme_datum=%s, art=%s, abnehmer=%s, vorbehalte=%s, "
            "protokoll_document_id=%s "
            "where id=%s and deleted_at is null and row_version=%s returning *",
            (body.abnahme_datum, body.art, body.abnehmer, body.vorbehalte,
             str(body.protokoll_document_id) if body.protokoll_document_id else None,
             str(id), body.row_version),
        ).fetchone()
    require_row(row, conn, "abnahmeprotokoll", id)
    return row


@router.delete("/{id}", status_code=204)
def delete_abnahmeprotokoll(id: UUID, conn: Connection = Depends(db_session)):
    with db_errors():
        cur = conn.execute(
            "update abnahmeprotokoll set deleted_at=now(), deleted_by=core.current_actor() "
            "where id=%s and deleted_at is null", (str(id),)
        )
    if cur.rowcount == 0:
        raise HTTPException(404)
    return Response(status_code=204)
