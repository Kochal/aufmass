from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response
from psycopg import Connection

from ..deps import Principal, db_session, get_principal
from ..errors import db_errors, require_row
from ..schemas.leistung import LeistungCreate, LeistungRead, LeistungUpdate

router = APIRouter(prefix="/api/leistung", tags=["Leistung"])

_SELECT_ALIVE = "select * from leistung where deleted_at is null"


@router.get("", response_model=list[LeistungRead])
def list_leistung(
    leistungskatalog_id: UUID | None = None,
    conn: Connection = Depends(db_session),
):
    if leistungskatalog_id is not None:
        return conn.execute(
            f"{_SELECT_ALIVE} and leistungskatalog_id=%s order by code",
            (str(leistungskatalog_id),),
        ).fetchall()
    return conn.execute(f"{_SELECT_ALIVE} order by code").fetchall()


@router.get("/{id}", response_model=LeistungRead)
def get_leistung(id: UUID, conn: Connection = Depends(db_session)):
    row = conn.execute(f"{_SELECT_ALIVE} and id=%s", (str(id),)).fetchone()
    if row is None:
        raise HTTPException(404)
    return row


@router.post("", response_model=LeistungRead, status_code=201)
def create_leistung(
    body: LeistungCreate,
    principal: Principal = Depends(get_principal),
    conn: Connection = Depends(db_session),
):
    with db_errors():
        row = conn.execute(
            "insert into leistung(tenant_id, leistungskatalog_id, code, kurztext, langtext, "
            "einheit, einheitspreis, aktiv) values (%s,%s,%s,%s,%s,%s,%s,%s) returning *",
            (
                str(principal.tenant_id),
                str(body.leistungskatalog_id),
                body.code,
                body.kurztext,
                body.langtext,
                body.einheit,
                body.einheitspreis,
                body.aktiv,
            ),
        ).fetchone()
    return row


@router.put("/{id}", response_model=LeistungRead)
def update_leistung(id: UUID, body: LeistungUpdate, conn: Connection = Depends(db_session)):
    with db_errors():
        row = conn.execute(
            "update leistung set kurztext=%s, langtext=%s, einheit=%s, einheitspreis=%s, aktiv=%s "
            "where id=%s and deleted_at is null and row_version=%s returning *",
            (body.kurztext, body.langtext, body.einheit, body.einheitspreis, body.aktiv,
             str(id), body.row_version),
        ).fetchone()
    require_row(row, conn, "leistung", id)
    return row


@router.delete("/{id}", status_code=204)
def delete_leistung(id: UUID, conn: Connection = Depends(db_session)):
    with db_errors():
        cur = conn.execute(
            "update leistung set deleted_at=now(), deleted_by=core.current_actor() "
            "where id=%s and deleted_at is null", (str(id),)
        )
    if cur.rowcount == 0:
        raise HTTPException(404)
    return Response(status_code=204)
