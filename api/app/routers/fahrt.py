from __future__ import annotations
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response
from psycopg import Connection

from ..deps import Principal, db_session, get_principal
from ..errors import db_errors, require_row
from ..schemas.fahrt import (
    FahrtCreate, FahrtFreigabe, FahrtKorrektur, FahrtRead, FahrtUpdate, FreigabeStatus
)

router = APIRouter(prefix="/api/fahrt", tags=["Fahrt"])

_SELECT_ALIVE = "select * from fahrt where deleted_at is null"


@router.get("", response_model=list[FahrtRead])
def list_fahrt(
    projekt_id: UUID | None = None,
    app_user_id: UUID | None = None,
    freigabe_status: FreigabeStatus | None = None,
    conn: Connection = Depends(db_session),
):
    clauses = ["deleted_at is null"]
    params: list = []
    if projekt_id is not None:
        clauses.append("projekt_id = %s"); params.append(str(projekt_id))
    if app_user_id is not None:
        clauses.append("app_user_id = %s"); params.append(str(app_user_id))
    if freigabe_status is not None:
        clauses.append("freigabe_status = %s"); params.append(freigabe_status)
    where = " and ".join(clauses)
    return conn.execute(f"select * from fahrt where {where} order by datum desc", params).fetchall()


@router.get("/{id}", response_model=FahrtRead)
def get_fahrt(id: UUID, conn: Connection = Depends(db_session)):
    row = conn.execute(f"{_SELECT_ALIVE} and id = %s", (str(id),)).fetchone()
    if row is None:
        raise HTTPException(404)
    return row


@router.post("", response_model=FahrtRead, status_code=201)
def create_fahrt(
    body: FahrtCreate,
    principal: Principal = Depends(get_principal),
    conn: Connection = Depends(db_session),
):
    with db_errors():
        row = conn.execute(
            "insert into fahrt(tenant_id, app_user_id, projekt_id, fahrzeug_id, datum, von, nach, km, zweck) "
            "values (%s,%s,%s,%s,%s,%s,%s,%s,%s) returning *",
            (str(principal.tenant_id), str(body.app_user_id),
             str(body.projekt_id) if body.projekt_id else None,
             str(body.fahrzeug_id) if body.fahrzeug_id else None,
             body.datum, body.von, body.nach, body.km, body.zweck),
        ).fetchone()
    return row


@router.put("/{id}", response_model=FahrtRead)
def update_fahrt(id: UUID, body: FahrtUpdate, conn: Connection = Depends(db_session)):
    with db_errors():
        row = conn.execute(
            "update fahrt set projekt_id=%s, fahrzeug_id=%s, datum=%s, von=%s, nach=%s, km=%s, zweck=%s "
            "where id=%s and deleted_at is null and row_version=%s returning *",
            (str(body.projekt_id) if body.projekt_id else None,
             str(body.fahrzeug_id) if body.fahrzeug_id else None,
             body.datum, body.von, body.nach, body.km, body.zweck,
             str(id), body.row_version),
        ).fetchone()
    require_row(row, conn, "fahrt", id)
    return row


@router.patch("/{id}/freigabe", response_model=FahrtRead)
def approve_fahrt(
    id: UUID,
    body: FahrtFreigabe,
    principal: Principal = Depends(get_principal),
    conn: Connection = Depends(db_session),
):
    with db_errors():
        row = conn.execute(
            "update fahrt set freigabe_status='freigegeben', freigegeben_am=now(), freigegeben_von=%s "
            "where id=%s and deleted_at is null and freigabe_status='offen' and row_version=%s returning *",
            (str(principal.user_id), str(id), body.row_version),
        ).fetchone()
    if row is None:
        existing = conn.execute(
            "select freigabe_status, deleted_at from fahrt where id=%s", (str(id),)
        ).fetchone()
        if existing is None or existing["deleted_at"] is not None:
            raise HTTPException(404)
        if existing["freigabe_status"] == "freigegeben":
            raise HTTPException(409, detail="already approved")
        raise HTTPException(409, detail="stale row_version – reload and retry")
    return row


@router.post("/{id}/korrektur", response_model=FahrtRead, status_code=201)
def korrektur_fahrt(
    id: UUID,
    body: FahrtKorrektur,
    principal: Principal = Depends(get_principal),
    conn: Connection = Depends(db_session),
):
    source = conn.execute(
        "select app_user_id, freigabe_status from fahrt where id=%s and deleted_at is null", (str(id),)
    ).fetchone()
    if source is None:
        raise HTTPException(404)
    if source["freigabe_status"] != "freigegeben":
        raise HTTPException(422, detail="only approved entries can have corrections")
    with db_errors():
        row = conn.execute(
            "insert into fahrt(tenant_id, app_user_id, projekt_id, fahrzeug_id, datum, von, nach, km, zweck, korrektur_von_id) "
            "values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) returning *",
            (str(principal.tenant_id), str(source["app_user_id"]),
             str(body.projekt_id) if body.projekt_id else None,
             str(body.fahrzeug_id) if body.fahrzeug_id else None,
             body.datum, body.von, body.nach, body.km, body.zweck, str(id)),
        ).fetchone()
    return row


@router.delete("/{id}", status_code=204)
def delete_fahrt(id: UUID, conn: Connection = Depends(db_session)):
    with db_errors():
        cur = conn.execute(
            "update fahrt set deleted_at=now(), deleted_by=core.current_actor() "
            "where id=%s and deleted_at is null", (str(id),)
        )
    if cur.rowcount == 0:
        raise HTTPException(404)
    return Response(status_code=204)
