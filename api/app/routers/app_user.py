from __future__ import annotations
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from psycopg import Connection

from ..deps import db_session
from ..schemas.app_user import AppUserRead

router = APIRouter(prefix="/api/app-user", tags=["AppUser"])


@router.get("", response_model=list[AppUserRead])
def list_app_user(conn: Connection = Depends(db_session)):
    return conn.execute(
        "select id, tenant_id, email, display_name, role, status "
        "from app_user where deleted_at is null and status='active' order by display_name, email"
    ).fetchall()


@router.get("/{id}", response_model=AppUserRead)
def get_app_user(id: UUID, conn: Connection = Depends(db_session)):
    row = conn.execute(
        "select id, tenant_id, email, display_name, role, status "
        "from app_user where id=%s and deleted_at is null",
        (str(id),),
    ).fetchone()
    if row is None:
        raise HTTPException(404)
    return row
