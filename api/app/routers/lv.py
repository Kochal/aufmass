from __future__ import annotations

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response
from psycopg import Connection

from ..deps import Principal, db_session, get_principal
from ..errors import db_errors, require_row
from ..katalog.matcher import best_match
from ..schemas.lv import LvCreate, LvRead, LvUpdate

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/lv", tags=["LV"])

_SELECT_ALIVE = "select * from lv where deleted_at is null"


@router.get("", response_model=list[LvRead])
def list_lv(angebot_id: UUID | None = None, conn: Connection = Depends(db_session)):
    if angebot_id is not None:
        return conn.execute(
            f"{_SELECT_ALIVE} and angebot_id=%s order by created_at", (str(angebot_id),)
        ).fetchall()
    return conn.execute(f"{_SELECT_ALIVE} order by created_at").fetchall()


@router.get("/{id}", response_model=LvRead)
def get_lv(id: UUID, conn: Connection = Depends(db_session)):
    row = conn.execute(f"{_SELECT_ALIVE} and id=%s", (str(id),)).fetchone()
    if row is None:
        raise HTTPException(404)
    return row


@router.post("", response_model=LvRead, status_code=201)
def create_lv(
    body: LvCreate,
    principal: Principal = Depends(get_principal),
    conn: Connection = Depends(db_session),
):
    with db_errors():
        row = conn.execute(
            "insert into lv(tenant_id, angebot_id, source, gaeb_artifact_id) "
            "values (%s,%s,%s,%s) returning *",
            (
                str(principal.tenant_id),
                str(body.angebot_id) if body.angebot_id else None,
                body.source,
                str(body.gaeb_artifact_id) if body.gaeb_artifact_id else None,
            ),
        ).fetchone()
    return row


@router.put("/{id}", response_model=LvRead)
def update_lv(id: UUID, body: LvUpdate, conn: Connection = Depends(db_session)):
    with db_errors():
        row = conn.execute(
            "update lv set angebot_id=%s, source=%s, gaeb_artifact_id=%s "
            "where id=%s and deleted_at is null and row_version=%s returning *",
            (
                str(body.angebot_id) if body.angebot_id else None,
                body.source,
                str(body.gaeb_artifact_id) if body.gaeb_artifact_id else None,
                str(id),
                body.row_version,
            ),
        ).fetchone()
    require_row(row, conn, "lv", id)
    return row


@router.delete("/{id}", status_code=204)
def delete_lv(id: UUID, conn: Connection = Depends(db_session)):
    with db_errors():
        cur = conn.execute(
            "update lv set deleted_at=now(), deleted_by=core.current_actor() "
            "where id=%s and deleted_at is null", (str(id),)
        )
    if cur.rowcount == 0:
        raise HTTPException(404)
    return Response(status_code=204)


@router.post("/{id}/catalog-match")
def catalog_match(
    id: UUID,
    conn: Connection = Depends(db_session),
):
    """Run the string-similarity catalog matcher over unmatched positions in this LV.

    Scans positions where matched_leistung_id IS NULL against all active catalog
    Leistungen for the tenant.  Updates in place:
      score >= 0.80 → match_status='auto',   matched_leistung_id set
      score >= 0.55 → match_status='review', matched_leistung_id set (suggestion)
      score < 0.55  → unchanged

    This is a *partial implementation*: token + sequence-ratio similarity handles
    near-exact phrasing but misses synonyms and domain abbreviations.  Full
    implementation requires sentence embeddings (deferred, GPU pipeline pending).

    Confirmed positions (match_status='confirmed') are never touched.
    Already-matched positions (matched_leistung_id IS NOT NULL) are skipped.

    Returns {auto, suggested, unmatched, skipped_confirmed}.
    """
    if conn.execute("select id from lv where id=%s and deleted_at is null",
                    (str(id),)).fetchone() is None:
        raise HTTPException(404, "lv not found")

    # Load only unmatched positions (confirmed are always skipped)
    positions = conn.execute(
        """
        select id, kurztext, match_status, row_version
        from lv_position
        where lv_id = %s
          and deleted_at is null
          and matched_leistung_id is null
          and match_status != 'confirmed'
        """,
        (str(id),),
    ).fetchall()

    skipped_confirmed = conn.execute(
        "select count(*) from lv_position "
        "where lv_id=%s and deleted_at is null and match_status='confirmed'",
        (str(id),),
    ).fetchone()[0]

    if not positions:
        return {"auto": 0, "suggested": 0, "unmatched": 0,
                "skipped_confirmed": skipped_confirmed}

    # Load all active leistungen for this tenant (RLS enforces tenant scope)
    leistungen = [
        dict(r) for r in conn.execute(
            "select id, kurztext from leistung where aktiv = true and deleted_at is null"
        ).fetchall()
    ]

    auto_count = suggested_count = unmatched_count = 0

    for pos in positions:
        if not pos["kurztext"]:
            unmatched_count += 1
            continue

        result = best_match(pos["kurztext"], leistungen)

        if result.new_status == "unmatched":
            unmatched_count += 1
            continue

        conn.execute(
            """
            update lv_position
            set matched_leistung_id = %s,
                match_confidence    = %s,
                match_status        = %s
            where id = %s and row_version = %s
            """,
            (
                result.leistung_id,
                str(result.confidence),
                result.new_status,
                pos["id"],
                pos["row_version"],
            ),
        )
        if result.new_status == "auto":
            auto_count += 1
        else:
            suggested_count += 1

    log.info(
        "catalog-match lv=%s auto=%d suggested=%d unmatched=%d",
        id, auto_count, suggested_count, unmatched_count,
    )
    return {
        "auto": auto_count,
        "suggested": suggested_count,
        "unmatched": unmatched_count,
        "skipped_confirmed": skipped_confirmed,
    }
