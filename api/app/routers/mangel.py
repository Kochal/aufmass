from __future__ import annotations
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response
from psycopg import Connection

from ..deps import Principal, db_session, get_principal
from ..errors import db_errors, require_row
from ..schemas.mangel import MangelCreate, MangelRead, MangelUpdate

router = APIRouter(prefix="/api/mangel", tags=["Mangel"])

_SELECT_ALIVE = "select * from mangel where deleted_at is null"


@router.get("", response_model=list[MangelRead])
def list_mangel(
    abnahmeprotokoll_id: UUID | None = None,
    conn: Connection = Depends(db_session),
):
    if abnahmeprotokoll_id is not None:
        return conn.execute(
            f"{_SELECT_ALIVE} and abnahmeprotokoll_id=%s order by frist nulls last",
            (str(abnahmeprotokoll_id),),
        ).fetchall()
    return conn.execute(f"{_SELECT_ALIVE} order by frist nulls last").fetchall()


@router.get("/{id}", response_model=MangelRead)
def get_mangel(id: UUID, conn: Connection = Depends(db_session)):
    row = conn.execute(f"{_SELECT_ALIVE} and id=%s", (str(id),)).fetchone()
    if row is None:
        raise HTTPException(404)
    return row


@router.post("", response_model=MangelRead, status_code=201)
def create_mangel(
    body: MangelCreate,
    principal: Principal = Depends(get_principal),
    conn: Connection = Depends(db_session),
):
    with db_errors():
        row = conn.execute(
            "insert into mangel(tenant_id, abnahmeprotokoll_id, beschreibung, ort, schwere, frist) "
            "values (%s,%s,%s,%s,%s,%s) returning *",
            (str(principal.tenant_id), str(body.abnahmeprotokoll_id),
             body.beschreibung, body.ort, body.schwere, body.frist),
        ).fetchone()
    return row


@router.put("/{id}", response_model=MangelRead)
def update_mangel(id: UUID, body: MangelUpdate, conn: Connection = Depends(db_session)):
    with db_errors():
        row = conn.execute(
            "update mangel set beschreibung=%s, ort=%s, schwere=%s, frist=%s, status=%s, behoben_am=%s "
            "where id=%s and deleted_at is null and row_version=%s returning *",
            (body.beschreibung, body.ort, body.schwere, body.frist,
             body.status, body.behoben_am, str(id), body.row_version),
        ).fetchone()
    require_row(row, conn, "mangel", id)
    return row


@router.delete("/{id}", status_code=204)
def delete_mangel(id: UUID, conn: Connection = Depends(db_session)):
    with db_errors():
        cur = conn.execute(
            "update mangel set deleted_at=now(), deleted_by=core.current_actor() "
            "where id=%s and deleted_at is null", (str(id),)
        )
    if cur.rowcount == 0:
        raise HTTPException(404)
    return Response(status_code=204)
