from __future__ import annotations
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response
from psycopg import Connection

from ..deps import Principal, db_session, get_principal
from ..errors import db_errors, require_row
from ..schemas.arbeitszeit import (
    ArbeitszeitCreate,
    ArbeitszeitFreigabe,
    ArbeitszeitKorrektur,
    ArbeitszeitRead,
    ArbeitszeitUpdate,
    FreigabeStatus,
)

router = APIRouter(prefix="/api/arbeitszeit", tags=["Arbeitszeit"])

_SELECT_ALIVE = "select * from arbeitszeit where deleted_at is null"


@router.get("", response_model=list[ArbeitszeitRead])
def list_arbeitszeit(
    projekt_id: UUID | None = None,
    app_user_id: UUID | None = None,
    freigabe_status: FreigabeStatus | None = None,
    conn: Connection = Depends(db_session),
):
    clauses = ["deleted_at is null"]
    params: list = []
    if projekt_id is not None:
        clauses.append("projekt_id = %s")
        params.append(str(projekt_id))
    if app_user_id is not None:
        clauses.append("app_user_id = %s")
        params.append(str(app_user_id))
    if freigabe_status is not None:
        clauses.append("freigabe_status = %s")
        params.append(freigabe_status)
    where = " and ".join(clauses)
    return conn.execute(
        f"select * from arbeitszeit where {where} order by start_zeit desc", params
    ).fetchall()


@router.get("/{id}", response_model=ArbeitszeitRead)
def get_arbeitszeit(id: UUID, conn: Connection = Depends(db_session)):
    row = conn.execute(f"{_SELECT_ALIVE} and id = %s", (str(id),)).fetchone()
    if row is None:
        raise HTTPException(404)
    return row


@router.post("", response_model=ArbeitszeitRead, status_code=201)
def create_arbeitszeit(
    body: ArbeitszeitCreate,
    principal: Principal = Depends(get_principal),
    conn: Connection = Depends(db_session),
):
    with db_errors():
        row = conn.execute(
            "insert into arbeitszeit("
            "  tenant_id, app_user_id, projekt_id, start_zeit, end_zeit, pause_minuten, art"
            ") values (%s,%s,%s,%s,%s,%s,%s) returning *",
            (
                str(principal.tenant_id),
                str(body.app_user_id),
                str(body.projekt_id) if body.projekt_id else None,
                body.start_zeit,
                body.end_zeit,
                body.pause_minuten,
                body.art,
            ),
        ).fetchone()
    return row


@router.put("/{id}", response_model=ArbeitszeitRead)
def update_arbeitszeit(
    id: UUID,
    body: ArbeitszeitUpdate,
    conn: Connection = Depends(db_session),
):
    # freeze_on_approval fires as a trigger; a frozen entry raises 23000 → db_errors maps to 409.
    with db_errors():
        row = conn.execute(
            "update arbeitszeit set "
            "  start_zeit=%s, end_zeit=%s, pause_minuten=%s, art=%s, projekt_id=%s "
            "where id=%s and deleted_at is null and row_version=%s returning *",
            (
                body.start_zeit,
                body.end_zeit,
                body.pause_minuten,
                body.art,
                str(body.projekt_id) if body.projekt_id else None,
                str(id),
                body.row_version,
            ),
        ).fetchone()
    require_row(row, conn, "arbeitszeit", id)
    return row


@router.patch("/{id}/freigabe", response_model=ArbeitszeitRead)
def approve_arbeitszeit(
    id: UUID,
    body: ArbeitszeitFreigabe,
    principal: Principal = Depends(get_principal),
    conn: Connection = Depends(db_session),
):
    with db_errors():
        row = conn.execute(
            "update arbeitszeit "
            "set freigabe_status='freigegeben', freigegeben_am=now(), freigegeben_von=%s "
            "where id=%s and deleted_at is null and freigabe_status='offen' and row_version=%s "
            "returning *",
            (str(principal.user_id), str(id), body.row_version),
        ).fetchone()
    if row is None:
        # Either missing, already approved, or stale version — check which.
        existing = conn.execute(
            "select freigabe_status, deleted_at from arbeitszeit where id = %s", (str(id),)
        ).fetchone()
        if existing is None or existing["deleted_at"] is not None:
            raise HTTPException(404)
        if existing["freigabe_status"] == "freigegeben":
            raise HTTPException(409, detail="already approved")
        raise HTTPException(409, detail="stale row_version – reload and retry")
    return row


@router.post("/{id}/korrektur", response_model=ArbeitszeitRead, status_code=201)
def korrektur_arbeitszeit(
    id: UUID,
    body: ArbeitszeitKorrektur,
    principal: Principal = Depends(get_principal),
    conn: Connection = Depends(db_session),
):
    source = conn.execute(
        "select app_user_id, freigabe_status from arbeitszeit where id=%s and deleted_at is null",
        (str(id),),
    ).fetchone()
    if source is None:
        raise HTTPException(404)
    if source["freigabe_status"] != "freigegeben":
        raise HTTPException(422, detail="only approved entries can have corrections")

    with db_errors():
        row = conn.execute(
            "insert into arbeitszeit("
            "  tenant_id, app_user_id, projekt_id, start_zeit, end_zeit,"
            "  pause_minuten, art, korrektur_von_id"
            ") values (%s,%s,%s,%s,%s,%s,%s,%s) returning *",
            (
                str(principal.tenant_id),
                str(source["app_user_id"]),
                str(body.projekt_id) if body.projekt_id else None,
                body.start_zeit,
                body.end_zeit,
                body.pause_minuten,
                body.art,
                str(id),
            ),
        ).fetchone()
    return row


@router.delete("/{id}", status_code=204)
def delete_arbeitszeit(id: UUID, conn: Connection = Depends(db_session)):
    # freeze_on_approval also guards DELETE → db_errors maps 23000 to 409.
    with db_errors():
        cur = conn.execute(
            "update arbeitszeit "
            "set deleted_at = now(), deleted_by = core.current_actor() "
            "where id = %s and deleted_at is null",
            (str(id),),
        )
    if cur.rowcount == 0:
        raise HTTPException(404)
    return Response(status_code=204)
