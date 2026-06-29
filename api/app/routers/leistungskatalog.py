from __future__ import annotations

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile
from psycopg import Connection

from ..deps import Principal, db_session, get_principal
from ..errors import db_errors, require_row
from ..katalog.spreadsheet import SpreadsheetResult, auto_code, parse_spreadsheet
from ..schemas.leistungskatalog import LeistungskatalogCreate, LeistungskatalogRead, LeistungskatalogUpdate

log = logging.getLogger(__name__)

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


# ── Spreadsheet import ────────────────────────────────────────────────────────

@router.post("/{id}/import-spreadsheet")
def import_spreadsheet(
    id: UUID,
    file: UploadFile = File(...),
    principal: Principal = Depends(get_principal),
    conn: Connection = Depends(db_session),
):
    """Batch-import Leistungen from an xlsx or csv file.

    Columns (case-insensitive, German + abbreviated names accepted):
      code / pos → code (auto-generated from kurztext if absent)
      kurztext / bezeichnung / beschreibung → kurztext  [required]
      langtext → langtext
      einheit / me → einheit  [required]
      einheitspreis / ep / preis → einheitspreis

    Rows missing kurztext or einheit are silently skipped.
    Rows whose code already exists in this catalog are skipped (idempotent).

    Returns {imported, skipped_empty, skipped_duplicate, errors}.
    """
    _require_katalog(conn, id)

    content = file.file.read()
    if not content:
        raise HTTPException(400, "empty file")

    filename = file.filename or "upload.csv"
    try:
        result: SpreadsheetResult = parse_spreadsheet(content, filename)
    except ValueError as exc:
        raise HTTPException(422, f"could not parse spreadsheet: {exc}") from exc

    log.info("katalog.import: katalog=%s  parsed=%d  skipped_empty=%d",
             id, len(result.rows), result.skipped)

    # Per-catalog codes: for idempotent re-import detection.
    catalog_codes: set[str] = {
        str(r["code"])
        for r in conn.execute(
            "select code from leistung where leistungskatalog_id=%s and deleted_at is null",
            (str(id),),
        ).fetchall()
    }
    # Tenant-wide codes: needed only for auto_code to avoid the unique(tenant_id,code) constraint.
    tenant_codes: set[str] = {
        str(r["code"])
        for r in conn.execute("select code from leistung where deleted_at is null").fetchall()
    }

    imported = 0
    skipped_dup = 0
    errors: list[str] = list(result.parse_errors)
    for row in result.rows:
        explicit_code = row.code
        code = explicit_code or auto_code(row.kurztext, tenant_codes)
        # Already in this catalog — idempotent skip.
        if code in catalog_codes:
            skipped_dup += 1
            continue
        catalog_codes.add(code)
        tenant_codes.add(code)
        try:
            conn.execute("savepoint sp_lei")
            conn.execute(
                "insert into leistung(tenant_id, leistungskatalog_id, code, kurztext, "
                "langtext, einheit, einheitspreis, aktiv) values (%s,%s,%s,%s,%s,%s,%s,true)",
                (
                    str(principal.tenant_id), str(id),
                    code, row.kurztext, row.langtext, row.einheit, row.einheitspreis,
                ),
            )
            conn.execute("release savepoint sp_lei")
        except Exception:
            conn.execute("rollback to savepoint sp_lei")
            errors.append(f"code {code!r} conflicts with an existing entry in another catalog")
            skipped_dup += 1
            continue
        imported += 1

    return {
        "imported": imported,
        "skipped_empty": result.skipped,
        "skipped_duplicate": skipped_dup,
        "errors": errors,
    }


# ── Extract from Angebote ─────────────────────────────────────────────────────

@router.post("/{id}/extract-from-angebote")
def extract_from_angebote(
    id: UUID,
    principal: Principal = Depends(get_principal),
    conn: Connection = Depends(db_session),
):
    """Mine confirmed lv_positions not yet in the catalog to create new entries.

    Scans all lv_positions in this tenant where:
    - match_status = 'confirmed'
    - matched_leistung_id IS NULL (manually priced, not from a catalog entry)
    - kurztext, einheit, einheitspreis are all set

    Deduplicates by (lower(kurztext), lower(einheit)), takes the most recently
    updated price for each group. Skips entries already in this catalog
    (matched on lower(kurztext) + lower(einheit)).

    Returns {imported, skipped_already_in_catalog, candidates_found}.
    """
    _require_katalog(conn, id)

    # Collect confirmed manually-priced positions, deduplicated.
    candidates = conn.execute(
        """
        select distinct on (lower(kurztext), lower(einheit))
            kurztext, langtext, einheit, einheitspreis
        from lv_position
        where match_status = 'confirmed'
          and matched_leistung_id is null
          and kurztext is not null
          and einheit is not null
          and einheitspreis is not null
          and deleted_at is null
        order by lower(kurztext), lower(einheit), updated_at desc
        """,
    ).fetchall()

    if not candidates:
        return {"imported": 0, "skipped_already_in_catalog": 0, "candidates_found": 0}

    # Existing entries in this catalog (for duplicate check)
    existing = {
        (str(r["kurztext"]).lower(), str(r["einheit"]).lower())
        for r in conn.execute(
            "select kurztext, einheit from leistung "
            "where leistungskatalog_id=%s and deleted_at is null",
            (str(id),),
        ).fetchall()
    }
    # Tenant-wide codes for auto_code uniqueness; unique constraint is (tenant_id, code).
    existing_codes: set[str] = {
        str(r["code"])
        for r in conn.execute("select code from leistung where deleted_at is null").fetchall()
    }

    imported = 0
    skipped = 0
    for cand in candidates:
        key = (str(cand["kurztext"]).lower(), str(cand["einheit"]).lower())
        if key in existing:
            skipped += 1
            continue
        existing.add(key)

        code = auto_code(str(cand["kurztext"]), existing_codes)
        with db_errors():
            conn.execute(
                "insert into leistung(tenant_id, leistungskatalog_id, code, kurztext, "
                "langtext, einheit, einheitspreis, aktiv) values (%s,%s,%s,%s,%s,%s,%s,true)",
                (
                    str(principal.tenant_id), str(id),
                    code, cand["kurztext"], cand["langtext"],
                    cand["einheit"], cand["einheitspreis"],
                ),
            )
        imported += 1

    log.info("katalog.extract: katalog=%s  imported=%d  skipped=%d", id, imported, skipped)
    return {
        "imported": imported,
        "skipped_already_in_catalog": skipped,
        "candidates_found": len(candidates),
    }


def _require_katalog(conn: Connection, id: UUID) -> None:
    row = conn.execute(
        "select id from leistungskatalog where id=%s and deleted_at is null", (str(id),)
    ).fetchone()
    if row is None:
        raise HTTPException(404, "leistungskatalog not found")
