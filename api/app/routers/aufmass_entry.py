"""Aufmaß entry router — individual measured quantities (directive 07).

Entries created by the upload pipeline start at review_status='review'.
The field worker / office reviewer then confirms or corrects each one.
"""
from __future__ import annotations

import json
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response
from psycopg import Connection

from ..deps import Principal, db_session, get_principal
from ..errors import db_errors, require_row
from ..schemas.aufmass import (
    AufmassEntryConfirm,
    AufmassEntryCorrect,
    AufmassEntryCreate,
    AufmassEntryRead,
)

router = APIRouter(prefix="/api/aufmass-entry", tags=["Aufmass"])

_SELECT_ALIVE = "select * from aufmass_entry where deleted_at is null"


@router.get("", response_model=list[AufmassEntryRead])
def list_aufmass_entries(
    aufmass_id: UUID,
    conn: Connection = Depends(db_session),
):
    return conn.execute(
        "select * from aufmass_entry"
        " where aufmass_id=%s and deleted_at is null order by created_at",
        (str(aufmass_id),),
    ).fetchall()


@router.get("/{id}", response_model=AufmassEntryRead)
def get_aufmass_entry(id: UUID, conn: Connection = Depends(db_session)):
    row = conn.execute(f"{_SELECT_ALIVE} and id=%s", (str(id),)).fetchone()
    if row is None:
        raise HTTPException(404)
    return row


@router.post("", response_model=AufmassEntryRead, status_code=201)
def create_aufmass_entry(
    body: AufmassEntryCreate,
    principal: Principal = Depends(get_principal),
    conn: Connection = Depends(db_session),
):
    """Add a single entry to a manual aufmass or for testing purposes."""
    candidate_readings = json.dumps({
        "raw_text": body.raw_text,
        "candidates": [],
        "is_deduction": body.is_deduction,
        "struck": False,
    })
    try:
        confidence = Decimal(f"{float(body.confidence):.4f}")
    except (ValueError, Exception):
        confidence = Decimal("0.0000")

    with db_errors():
        row = conn.execute(
            "insert into aufmass_entry("
            "  tenant_id, aufmass_id, bauteil, written_result,"
            "  einheit, confidence, candidate_readings"
            ") values (%s,%s,%s,%s,%s,%s,%s::jsonb) returning *",
            (
                str(principal.tenant_id),
                str(body.aufmass_id),
                body.bauteil,
                body.written_result,
                body.einheit,
                confidence,
                candidate_readings,
            ),
        ).fetchone()
    return row


@router.patch("/{id}/confirm", response_model=AufmassEntryRead)
def confirm_aufmass_entry(
    id: UUID,
    body: AufmassEntryConfirm,
    conn: Connection = Depends(db_session),
):
    """Mark an entry as human-confirmed (review_status → 'confirmed').

    The prüfbarkeit floor trigger blocks confirmation of billing-linked
    foto/voice entries that have no source_crop_ref; that is a 409.
    """
    with db_errors():
        row = conn.execute(
            "update aufmass_entry set review_status='confirmed'"
            " where id=%s and deleted_at is null and row_version=%s returning *",
            (str(id), body.row_version),
        ).fetchone()
    require_row(row, conn, "aufmass_entry", id)
    return row


@router.patch("/{id}/correct", response_model=AufmassEntryRead)
def correct_aufmass_entry(
    id: UUID,
    body: AufmassEntryCorrect,
    conn: Connection = Depends(db_session),
):
    """Apply a human correction and set review_status → 'corrected'.

    Only the fields present in the body (non-None) are updated; existing
    values are preserved for fields not provided.
    """
    with db_errors():
        row = conn.execute(
            "update aufmass_entry set"
            "  review_status='corrected',"
            "  written_result = coalesce(%s, written_result),"
            "  computed_result = coalesce(%s, computed_result),"
            "  bauteil = coalesce(%s, bauteil),"
            "  einheit = coalesce(%s, einheit),"
            "  lv_position_id = coalesce(%s::uuid, lv_position_id)"
            " where id=%s and deleted_at is null and row_version=%s returning *",
            (
                body.written_result,
                body.computed_result,
                body.bauteil,
                body.einheit,
                str(body.lv_position_id) if body.lv_position_id else None,
                str(id),
                body.row_version,
            ),
        ).fetchone()
    require_row(row, conn, "aufmass_entry", id)
    return row


@router.delete("/{id}", status_code=204)
def delete_aufmass_entry(id: UUID, conn: Connection = Depends(db_session)):
    with db_errors():
        cur = conn.execute(
            "update aufmass_entry set deleted_at=now(), deleted_by=core.current_actor()"
            " where id=%s and deleted_at is null",
            (str(id),),
        )
    if cur.rowcount == 0:
        raise HTTPException(404)
    return Response(status_code=204)
