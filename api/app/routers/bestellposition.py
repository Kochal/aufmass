from __future__ import annotations
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response
from psycopg import Connection

from ..deps import Principal, db_session, get_principal
from ..errors import db_errors, require_row
from ..schemas.bestellposition import BestellpositionCreate, BestellpositionRead, BestellpositionUpdate

router = APIRouter(prefix="/api/bestellposition", tags=["Bestellposition"])

_SELECT_ALIVE = "select * from bestellposition where deleted_at is null"


@router.get("", response_model=list[BestellpositionRead])
def list_bestellposition(
    bestellung_id: UUID | None = None,
    conn: Connection = Depends(db_session),
):
    if bestellung_id is not None:
        return conn.execute(
            f"{_SELECT_ALIVE} and bestellung_id=%s order by position_nr nulls last",
            (str(bestellung_id),),
        ).fetchall()
    return conn.execute(f"{_SELECT_ALIVE} order by bestellung_id, position_nr nulls last").fetchall()


@router.get("/{id}", response_model=BestellpositionRead)
def get_bestellposition(id: UUID, conn: Connection = Depends(db_session)):
    row = conn.execute(f"{_SELECT_ALIVE} and id=%s", (str(id),)).fetchone()
    if row is None:
        raise HTTPException(404)
    return row


@router.post("", response_model=BestellpositionRead, status_code=201)
def create_bestellposition(
    body: BestellpositionCreate,
    principal: Principal = Depends(get_principal),
    conn: Connection = Depends(db_session),
):
    with db_errors():
        row = conn.execute(
            "insert into bestellposition(tenant_id, bestellung_id, material_id, bezeichnung, "
            "menge, einheit, einzelpreis, position_nr) values (%s,%s,%s,%s,%s,%s,%s,%s) returning *",
            (str(principal.tenant_id), str(body.bestellung_id),
             str(body.material_id) if body.material_id else None,
             body.bezeichnung, body.menge, body.einheit, body.einzelpreis, body.position_nr),
        ).fetchone()
    return row


@router.put("/{id}", response_model=BestellpositionRead)
def update_bestellposition(id: UUID, body: BestellpositionUpdate, conn: Connection = Depends(db_session)):
    with db_errors():
        row = conn.execute(
            "update bestellposition set material_id=%s, bezeichnung=%s, menge=%s, einheit=%s, "
            "einzelpreis=%s, position_nr=%s "
            "where id=%s and deleted_at is null and row_version=%s returning *",
            (str(body.material_id) if body.material_id else None,
             body.bezeichnung, body.menge, body.einheit, body.einzelpreis, body.position_nr,
             str(id), body.row_version),
        ).fetchone()
    require_row(row, conn, "bestellposition", id)
    return row


@router.delete("/{id}", status_code=204)
def delete_bestellposition(id: UUID, conn: Connection = Depends(db_session)):
    with db_errors():
        cur = conn.execute(
            "update bestellposition set deleted_at=now(), deleted_by=core.current_actor() "
            "where id=%s and deleted_at is null", (str(id),)
        )
    if cur.rowcount == 0:
        raise HTTPException(404)
    return Response(status_code=204)
