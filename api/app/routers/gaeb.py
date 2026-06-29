"""GAEB DA XML import and D84 export endpoints (directive 06 Stages 1 + 6).

POST /api/gaeb/import
  Accepts a GAEB DA XML file (X81 or X83) plus an angebot_id.
  Deterministic parse → gaeb_artifact + lv + lv_position rows.
  Stores the original file write-once (directive 04).
  Returns {gaeb_artifact_id, lv_id, position_count}.

GET /api/gaeb/export/{angebot_id}
  Generates a GAEB DA XML 3.1 D84 (Angebotsabgabe) from the angebot's LV
  positions. Stores the generated XML as a document. Returns the XML.

No model is involved in either path: parsing and generation are deterministic.
"""
from __future__ import annotations

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from psycopg import Connection

from ..deps import Principal, db_session, get_principal
from ..errors import db_errors
from ..gaeb.exporter import build_d84
from ..gaeb.parser import GaebParseError, parse_gaeb
from ..katalog.matcher import best_match
from ..storage import store_original

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/gaeb", tags=["GAEB"])

_ALLOWED_MIME = frozenset({
    "application/xml",
    "text/xml",
    "application/octet-stream",  # common when browser doesn't know the type
})


# ── Import ────────────────────────────────────────────────────────────────────

@router.post("/import", status_code=201)
def import_gaeb(
    angebot_id: UUID = Form(...),
    file: UploadFile = File(...),
    principal: Principal = Depends(get_principal),
    conn: Connection = Depends(db_session),
):
    """Parse a GAEB DA XML file (X81/X83) and create an LV with positions.

    Creates:
    - a gaeb_artifact row (with the file stored write-once as a document)
    - an lv row linked to the angebot
    - one lv_position per parsed position (match_status='review', source='gaeb')

    Returns {gaeb_artifact_id, lv_id, position_count}.
    """
    content = file.file.read()
    if not content:
        raise HTTPException(400, "empty file")

    # Parse before any DB write — like the Aufmaß upload pattern.
    try:
        doc = parse_gaeb(content)
    except GaebParseError as exc:
        log.warning("gaeb.import: parse error: %s", exc)
        raise HTTPException(422, f"GAEB parse error: {exc}") from exc

    log.info(
        "gaeb.import: angebot=%s  phase=%s  positions=%d",
        angebot_id, doc.phase, len(doc.positions),
    )

    # Verify the angebot exists and belongs to this tenant.
    angebot = conn.execute(
        "select id, status from angebot where id=%s and deleted_at is null",
        (str(angebot_id),),
    ).fetchone()
    if angebot is None:
        raise HTTPException(404, "angebot not found")
    if angebot["status"] != "draft":
        raise HTTPException(409, "angebot is not a draft — cannot attach a new LV")

    # Store original file write-once (directive 04).
    doc_id = store_original(conn, principal.tenant_id, "gaeb_source", content)

    with db_errors():
        # gaeb_artifact
        artifact = conn.execute(
            "insert into gaeb_artifact(tenant_id, document_id, phase, gaeb_version) "
            "values (%s,%s,%s,%s) returning id",
            (
                str(principal.tenant_id),
                str(doc_id),
                _normalise_phase(doc.phase),
                doc.version or None,
            ),
        ).fetchone()
        artifact_id = artifact["id"]

        # lv
        lv = conn.execute(
            "insert into lv(tenant_id, angebot_id, source, gaeb_artifact_id) "
            "values (%s,%s,'gaeb',%s) returning id",
            (str(principal.tenant_id), str(angebot_id), str(artifact_id)),
        ).fetchone()
        lv_id = lv["id"]

        # lv_positions
        for pos in doc.positions:
            conn.execute(
                "insert into lv_position("
                "  tenant_id, lv_id, oz, kurztext, langtext,"
                "  menge, einheit, einheitspreis, match_status, source, position_nr"
                ") values (%s,%s,%s,%s,%s,%s,%s,%s,'review','gaeb',%s)",
                (
                    str(principal.tenant_id),
                    str(lv_id),
                    pos.oz,
                    pos.kurztext or None,
                    pos.langtext or None,
                    pos.menge,
                    pos.einheit,
                    pos.einheitspreis,  # None for unpriced incoming tenders
                    pos.position_nr,
                ),
            )

    # Auto-match new positions against the catalog (best-effort; never fails import).
    match_summary = {"auto": 0, "suggested": 0}
    try:
        leistungen = [
            dict(r) for r in conn.execute(
                "select id, kurztext from leistung where aktiv=true and deleted_at is null"
            ).fetchall()
        ]
        if leistungen:
            positions_to_match = conn.execute(
                "select id, kurztext, row_version from lv_position "
                "where lv_id=%s and deleted_at is null and matched_leistung_id is null",
                (str(lv_id),),
            ).fetchall()
            for pos in positions_to_match:
                if not pos["kurztext"]:
                    continue
                result = best_match(pos["kurztext"], leistungen)
                if result.new_status == "unmatched":
                    continue
                conn.execute(
                    "update lv_position set matched_leistung_id=%s, "
                    "match_confidence=%s, match_status=%s "
                    "where id=%s and row_version=%s",
                    (result.leistung_id, str(result.confidence),
                     result.new_status, pos["id"], pos["row_version"]),
                )
                match_summary[result.new_status if result.new_status == "auto" else "suggested"] += 1
    except Exception as exc:
        log.warning("gaeb.import: catalog-match failed (non-fatal): %s", exc)

    return {
        "gaeb_artifact_id": str(artifact_id),
        "lv_id": str(lv_id),
        "position_count": len(doc.positions),
        "project_name": doc.project_name,
        "phase": doc.phase,
        "catalog_match": match_summary,
    }


# ── Export ────────────────────────────────────────────────────────────────────

@router.get("/export/{angebot_id}")
def export_d84(
    angebot_id: UUID,
    principal: Principal = Depends(get_principal),
    conn: Connection = Depends(db_session),
):
    """Generate a GAEB DA XML 3.1 D84 (Angebotsabgabe) for the angebot.

    Loads the angebot + LV positions, builds the XML, stores it as a
    write-once document, and returns the XML bytes with appropriate headers.

    The GAEB D84 is the artifact of record when submitting via GAEB exchange
    (directive 06 Stage 6).
    """
    angebot = conn.execute(
        "select * from angebot where id=%s and deleted_at is null",
        (str(angebot_id),),
    ).fetchone()
    if angebot is None:
        raise HTTPException(404, "angebot not found")

    lv = conn.execute(
        "select * from lv where angebot_id=%s and deleted_at is null limit 1",
        (str(angebot_id),),
    ).fetchone()
    if lv is None:
        raise HTTPException(422, "angebot has no LV — nothing to export")

    positions = conn.execute(
        "select * from lv_position where lv_id=%s and deleted_at is null "
        "order by position_nr, oz",
        (str(lv["id"]),),
    ).fetchall()
    if not positions:
        raise HTTPException(422, "LV has no positions")

    # Project name: join to projekt if available.
    project_name = ""
    if angebot["projekt_id"]:
        proj = conn.execute(
            "select name from projekt where id=%s and deleted_at is null",
            (str(angebot["projekt_id"]),),
        ).fetchone()
        if proj:
            project_name = proj["name"]

    xml_bytes = build_d84(dict(angebot), [dict(p) for p in positions], project_name)

    # Store as a write-once document (directive 04 — the D84 is an artifact of record).
    store_original(conn, principal.tenant_id, "gaeb_d84", xml_bytes)

    # Filename hint for download.
    num = angebot["angebotsnummer"] or str(angebot_id)[:8]
    filename = f"angebot_{num}.d84"

    return Response(
        content=xml_bytes,
        media_type="application/xml",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _normalise_phase(phase: str) -> str | None:
    """Map DP value ('83') to the gaeb_artifact.phase check constraint ('x83')."""
    mapping = {
        "81": "x81", "82": "x83",  # 82 = simplified Angebotsaufforderung → treat as x83
        "83": "x83", "84": "x84",
        "d83": "d83", "d84": "d84", "d81": "d81",
        "x81": "x81", "x83": "x83", "x84": "x84",
    }
    return mapping.get(str(phase).lower())
