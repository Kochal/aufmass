from __future__ import annotations
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response
from psycopg import Connection

from ..deps import Principal, db_session, get_principal
from ..errors import db_errors, require_row
from ..schemas.material import MaterialCreate, MaterialRead, MaterialUpdate

router = APIRouter(prefix="/api/material", tags=["Material"])

_SELECT_ALIVE = "select * from material where deleted_at is null"


@router.get("", response_model=list[MaterialRead])
def list_material(conn: Connection = Depends(db_session)):
    return conn.execute(f"{_SELECT_ALIVE} order by bezeichnung").fetchall()


@router.get("/{id}", response_model=MaterialRead)
def get_material(id: UUID, conn: Connection = Depends(db_session)):
    row = conn.execute(f"{_SELECT_ALIVE} and id=%s", (str(id),)).fetchone()
    if row is None:
        raise HTTPException(404)
    return row


@router.post("", response_model=MaterialRead, status_code=201)
def create_material(
    body: MaterialCreate,
    principal: Principal = Depends(get_principal),
    conn: Connection = Depends(db_session),
):
    with db_errors():
        row = conn.execute(
            "insert into material(tenant_id, bezeichnung, einheit, standard_lieferant_id, standard_preis) "
            "values (%s,%s,%s,%s,%s) returning *",
            (str(principal.tenant_id), body.bezeichnung, body.einheit,
             str(body.standard_lieferant_id) if body.standard_lieferant_id else None,
             body.standard_preis),
        ).fetchone()
    return row


@router.put("/{id}", response_model=MaterialRead)
def update_material(id: UUID, body: MaterialUpdate, conn: Connection = Depends(db_session)):
    with db_errors():
        row = conn.execute(
            "update material set bezeichnung=%s, einheit=%s, standard_lieferant_id=%s, standard_preis=%s "
            "where id=%s and deleted_at is null and row_version=%s returning *",
            (body.bezeichnung, body.einheit,
             str(body.standard_lieferant_id) if body.standard_lieferant_id else None,
             body.standard_preis, str(id), body.row_version),
        ).fetchone()
    require_row(row, conn, "material", id)
    return row


@router.delete("/{id}", status_code=204)
def delete_material(id: UUID, conn: Connection = Depends(db_session)):
    with db_errors():
        cur = conn.execute(
            "update material set deleted_at=now(), deleted_by=core.current_actor() "
            "where id=%s and deleted_at is null", (str(id),)
        )
    if cur.rowcount == 0:
        raise HTTPException(404)
    return Response(status_code=204)
