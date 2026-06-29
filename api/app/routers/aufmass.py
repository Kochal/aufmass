"""Aufmaß sheet router (directive 07).

Two entry points:
  POST /api/aufmass/upload  — photo upload → Mistral extraction → DB write
  POST /api/aufmass         — manual session (no image, entries added separately)

The upload path calls vision_client.extract() BEFORE opening a DB
transaction so the ~14s Mistral round-trip does not hold a transaction.
psycopg3 starts the transaction on the first SQL command; extraction
runs while the connection is idle (no active txn).
"""
from __future__ import annotations

import json
import logging
from decimal import Decimal, InvalidOperation
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile
from psycopg import Connection

from ..aufmass.vision_client import ExtractionError, extract
from ..config import settings
from ..deps import Principal, db_session, get_principal
from ..errors import db_errors, require_row
from ..schemas.aufmass import AufmassCreate, AufmassEntryRead, AufmassRead
from ..storage import store_original

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/aufmass", tags=["Aufmass"])

_SELECT_ALIVE = "select * from aufmass where deleted_at is null"
_ALLOWED_MIME = frozenset({"image/jpeg", "image/png", "image/webp"})


# ── Photo upload (primary path) ─────────────────────────────────────────────

@router.post("/upload", response_model=AufmassRead, status_code=201)
def upload_aufmass(
    projekt_id: UUID = Form(...),
    image: UploadFile = File(...),
    principal: Principal = Depends(get_principal),
    conn: Connection = Depends(db_session),
):
    """Upload a handwritten Aufmaß sheet photo, run Mistral extraction,
    archive the original and return the aufmass with all extracted entries.

    Requires MISTRAL_API_KEY (returns 503 if absent). The extraction call
    (~14s) runs before any DB write to avoid a long open transaction.
    """
    content_type = image.content_type or "image/jpeg"
    if content_type not in _ALLOWED_MIME:
        raise HTTPException(400, f"unsupported image type {content_type!r}; accept jpeg/png/webp")

    image_bytes = image.file.read()
    if not image_bytes:
        raise HTTPException(400, "empty image file")

    if not settings.mistral_api_key:
        raise HTTPException(503, "MISTRAL_API_KEY not configured")

    # Run extraction BEFORE any DB write — no transaction held during the API call.
    log.info("aufmass.upload: extracting (proj=%s  %dB)", projekt_id, len(image_bytes))
    try:
        extraction = extract(image_bytes, content_type)
    except ExtractionError as exc:
        log.warning("aufmass.upload: extraction failed: %s", exc)
        raise HTTPException(502, f"extraction failed: {exc}") from exc

    # Store original + write aufmass + entries in one transaction.
    doc_id = store_original(conn, principal.tenant_id, "aufmass_foto", image_bytes)

    with db_errors():
        aufmass_row = conn.execute(
            "insert into aufmass(tenant_id, projekt_id, erfasst_von, quelle, source_document_id)"
            " values (%s,%s,%s,'foto',%s) returning *",
            (str(principal.tenant_id), str(projekt_id), str(principal.user_id), str(doc_id)),
        ).fetchone()

    entries = []
    for entry in extraction.get("entries", []):
        row = _insert_entry(conn, aufmass_row["id"], principal.tenant_id, entry)
        entries.append(row)

    result = dict(aufmass_row)
    result["entries"] = entries
    return result


# ── Manual creation ──────────────────────────────────────────────────────────

@router.post("", response_model=AufmassRead, status_code=201)
def create_aufmass(
    body: AufmassCreate,
    principal: Principal = Depends(get_principal),
    conn: Connection = Depends(db_session),
):
    """Create a manual aufmass session. Entries are added separately via
    POST /api/aufmass-entry. No image upload or extraction call is made.
    """
    with db_errors():
        row = conn.execute(
            "insert into aufmass(tenant_id, projekt_id, erfasst_von, quelle)"
            " values (%s,%s,%s,'manual') returning *",
            (str(principal.tenant_id), str(body.projekt_id), str(principal.user_id)),
        ).fetchone()
    result = dict(row)
    result["entries"] = []
    return result


# ── Read endpoints ────────────────────────────────────────────────────────────

@router.get("", response_model=list[AufmassRead])
def list_aufmass(
    projekt_id: UUID | None = None,
    conn: Connection = Depends(db_session),
):
    """List aufmass sessions. Returns records without embedded entries (use
    GET /api/aufmass/{id} for the full sheet + entries).
    """
    clauses = ["deleted_at is null"]
    params: list = []
    if projekt_id is not None:
        clauses.append("projekt_id = %s")
        params.append(str(projekt_id))
    rows = conn.execute(
        f"select * from aufmass where {' and '.join(clauses)} order by erfasst_am desc",
        params,
    ).fetchall()
    # entries not fetched for the list — avoids N+1
    return [dict(r) | {"entries": []} for r in rows]


@router.get("/{id}", response_model=AufmassRead)
def get_aufmass(id: UUID, conn: Connection = Depends(db_session)):
    """Get an aufmass sheet with all its entries embedded."""
    row = conn.execute(f"{_SELECT_ALIVE} and id=%s", (str(id),)).fetchone()
    if row is None:
        raise HTTPException(404)
    entries = conn.execute(
        "select * from aufmass_entry where aufmass_id=%s and deleted_at is null"
        " order by created_at",
        (str(id),),
    ).fetchall()
    return dict(row) | {"entries": list(entries)}


# ── Soft-delete ──────────────────────────────────────────────────────────────

@router.delete("/{id}", status_code=204)
def delete_aufmass(id: UUID, conn: Connection = Depends(db_session)):
    with db_errors():
        cur = conn.execute(
            "update aufmass set deleted_at=now(), deleted_by=core.current_actor()"
            " where id=%s and deleted_at is null",
            (str(id),),
        )
    if cur.rowcount == 0:
        raise HTTPException(404)
    return Response(status_code=204)


# ── Internal helper ───────────────────────────────────────────────────────────

def _jsonb(value: Any) -> str | None:
    """Return JSON string for a jsonb parameter, or None for SQL NULL."""
    if value is None:
        return None
    return json.dumps(value)


def _parse_german_decimal(raw: Any) -> Decimal | None:
    """Convert a German-decimal string ("3,86") or dict {"value": "3,86"} to Decimal.
    Returns None on any parse failure — stored as SQL NULL.
    """
    if raw is None:
        return None
    if isinstance(raw, dict):
        raw = raw.get("value")
    if raw is None:
        return None
    try:
        return Decimal(str(raw).replace(",", "."))
    except (InvalidOperation, ValueError):
        return None


def _collect_candidates(expr: Any) -> list[str]:
    """Recursively collect leaf candidate strings from a serialised expression tree."""
    if expr is None:
        return []
    if isinstance(expr, dict):
        if "candidates" in expr:          # ExpressionLeaf
            return list(expr.get("candidates") or [])
        if "args" in expr:                 # ExpressionNode
            result: list[str] = []
            for arg in expr.get("args") or []:
                result.extend(_collect_candidates(arg))
            return result
    return []


def _insert_entry(
    conn: Connection,
    aufmass_id: UUID,
    tenant_id: UUID,
    entry: dict,
) -> dict:
    """Insert one model_dump()'d AufmassEntry dict into aufmass_entry."""
    written_result = _parse_german_decimal(entry.get("written_result"))

    candidate_readings = {
        "raw_text": entry.get("raw_text", ""),
        "candidates": _collect_candidates(entry.get("expression")),
        "is_deduction": bool(entry.get("is_deduction", False)),
        "struck": bool(entry.get("struck", False)),
    }

    try:
        confidence = Decimal(f"{float(entry.get('confidence', 0.0)):.4f}")
    except (ValueError, InvalidOperation):
        confidence = Decimal("0.0000")

    row = conn.execute(
        "insert into aufmass_entry("
        "  tenant_id, aufmass_id, bauteil, expression, candidate_readings,"
        "  written_result, einheit, confidence, source_crop_ref"
        ") values (%s,%s,%s,%s::jsonb,%s::jsonb,%s,%s,%s,%s::jsonb) returning *",
        (
            str(tenant_id),
            str(aufmass_id),
            entry.get("bauteil"),
            _jsonb(entry.get("expression")),
            _jsonb(candidate_readings),
            written_result,
            entry.get("unit"),
            confidence,
            _jsonb(entry.get("bbox")),
        ),
    ).fetchone()
    return dict(row)
