from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response
from psycopg import Connection

from ..deps import Principal, db_session, get_principal
from ..errors import db_errors, require_row
from ..schemas.leistungskatalog import LeistungskatalogCreate, LeistungskatalogRead, LeistungskatalogUpdate

router = APIRouter(prefix="/api/leistungskatalog", tags=["Leistungskatalog"])

_SELECT_ALIVE = "select * from leistungskatalog where deleted_at is null"


@router.get("", response_model=list[LeistungskatalogRead])
def list_leistungskatalog(conn: Connection = Depends(db_session)):
    return conn.execute(f"{_SELECT_ALIVE} order by name").fetchall()


@router.get("/{id}", response_model=LeistungskatalogRead)
def get_leistungskatalog(id: UUID, conn: Connection = Depends(db_session)):
    row = conn.execute(f"{_SELECT_ALIVE} and id=%s", (str(id),)).fetchone()
    if row is None:
        raise HTTPException(404)
    return row


@router.post("", response_model=LeistungskatalogRead, status_code=201)
def create_leistungskatalog(
    body: LeistungskatalogCreate,
    principal: Principal = Depends(get_principal),
    conn: Connection = Depends(db_session),
):
    with db_errors():
        row = conn.execute(
            "insert into leistungskatalog(tenant_id, name, aktiv) values (%s,%s,%s) returning *",
            (str(principal.tenant_id), body.name, body.aktiv),
        ).fetchone()
    return row


@router.put("/{id}", response_model=LeistungskatalogRead)
def update_leistungskatalog(
    id: UUID, body: LeistungskatalogUpdate, conn: Connection = Depends(db_session)
):
    with db_errors():
        row = conn.execute(
            "update leistungskatalog set name=%s, aktiv=%s "
            "where id=%s and deleted_at is null and row_version=%s returning *",
            (body.name, body.aktiv, str(id), body.row_version),
        ).fetchone()
    require_row(row, conn, "leistungskatalog", id)
    return row


@router.delete("/{id}", status_code=204)
def delete_leistungskatalog(id: UUID, conn: Connection = Depends(db_session)):
    with db_errors():
        cur = conn.execute(
            "update leistungskatalog set deleted_at=now(), deleted_by=core.current_actor() "
            "where id=%s and deleted_at is null", (str(id),)
        )
    if cur.rowcount == 0:
        raise HTTPException(404)
    return Response(status_code=204)
