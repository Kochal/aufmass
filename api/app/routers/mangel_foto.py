"""Mängel photo router (directive 05 / UI round 2).

Photos are stored write-once on the EU server via storage.py. The document row
carries the content-hash + storage_ref; the mangel_foto row is the business FK.

Soft-delete on mangel_foto hides the photo from the UI while the underlying
document is never deleted (retention class 10 yr — same as the parent Mangel).

Image serving (GET /api/mangel-foto/{id}/image) reads the bytes from the
filesystem via read_original() and streams them with the detected media type.
The browser never calls external storage; egress-free (EU server, no DPA needed).
"""
from __future__ import annotations

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile
from fastapi.responses import Response as FastAPIResponse
from psycopg import Connection

from ..deps import Principal, db_session, get_principal
from ..errors import db_errors
from ..schemas.mangel_foto import MangelFotoRead
from ..storage import read_original, store_original

log = logging.getLogger(__name__)

router = APIRouter(tags=["MangelFoto"])

_ALLOWED_MIME = frozenset({
    "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif",
})
_SELECT_ALIVE = "select * from mangel_foto where deleted_at is null"


# ── Upload ────────────────────────────────────────────────────────────────────

@router.post("/api/mangel/{mangel_id}/foto", response_model=MangelFotoRead, status_code=201)
def upload_mangel_foto(
    mangel_id: UUID,
    image: UploadFile = File(...),
    beschriftung: str | None = Form(default=None),
    principal: Principal = Depends(get_principal),
    conn: Connection = Depends(db_session),
):
    """Upload a photo for a Mangel. Validates image MIME, archives the original
    write-once, creates a mangel_foto row, returns the row."""
    # Verify mangel exists and belongs to this tenant (RLS enforces tenant;
    # 404 if deleted or cross-tenant).
    mangel = conn.execute(
        "select id from mangel where id=%s and deleted_at is null", (str(mangel_id),)
    ).fetchone()
    if mangel is None:
        raise HTTPException(404, "mangel not found")

    content_type = (image.content_type or "image/jpeg").split(";")[0].strip()
    if content_type not in _ALLOWED_MIME:
        raise HTTPException(
            400,
            f"unsupported image type {content_type!r}; accept jpeg/png/webp/heic",
        )

    image_bytes = image.file.read()
    if not image_bytes:
        raise HTTPException(400, "empty image file")

    log.info("mangel_foto.upload: mangel=%s  %dB  %s", mangel_id, len(image_bytes), content_type)

    # Archive original then insert mangel_foto in the same transaction.
    doc_id = store_original(
        conn, principal.tenant_id, "mangel_foto", image_bytes, retention_class=10
    )

    with db_errors():
        row = conn.execute(
            "insert into mangel_foto(tenant_id, mangel_id, document_id, beschriftung) "
            "values (%s,%s,%s,%s) returning *",
            (str(principal.tenant_id), str(mangel_id), str(doc_id), beschriftung),
        ).fetchone()
    return row


# ── List ──────────────────────────────────────────────────────────────────────

@router.get("/api/mangel/{mangel_id}/foto", response_model=list[MangelFotoRead])
def list_mangel_fotos(
    mangel_id: UUID,
    conn: Connection = Depends(db_session),
):
    return conn.execute(
        f"{_SELECT_ALIVE} and mangel_id=%s order by created_at",
        (str(mangel_id),),
    ).fetchall()


# ── Image serving ─────────────────────────────────────────────────────────────

@router.get("/api/mangel-foto/{id}/image")
def serve_mangel_foto(id: UUID, conn: Connection = Depends(db_session)):
    """Stream the archived image bytes for a mangel_foto row.

    Reads document.storage_ref → filesystem via read_original(). The browser
    never fetches from external storage — all traffic stays on the EU server.
    """
    row = conn.execute(
        f"{_SELECT_ALIVE} and id=%s", (str(id),)
    ).fetchone()
    if row is None:
        raise HTTPException(404)

    doc = conn.execute(
        "select storage_ref, content_hash from document where id=%s and deleted_at is null",
        (str(row["document_id"]),),
    ).fetchone()
    if doc is None:
        raise HTTPException(404, "document record missing")

    try:
        data = read_original(doc["storage_ref"])
    except FileNotFoundError:
        raise HTTPException(404, "image file not found in store")

    # Guess media type from first bytes (magic bytes) as a fallback.
    media_type = _sniff_media_type(data)
    return FastAPIResponse(content=data, media_type=media_type)


def _sniff_media_type(data: bytes) -> str:
    if data[:2] == b"\xff\xd8":
        return "image/jpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if data[:4] in (b"RIFF", b"WEBP"):
        return "image/webp"
    return "image/jpeg"


# ── Soft-delete ───────────────────────────────────────────────────────────────

@router.delete("/api/mangel-foto/{id}", status_code=204)
def delete_mangel_foto(id: UUID, conn: Connection = Depends(db_session)):
    """Soft-delete a mangel_foto row. The document original is never deleted."""
    with db_errors():
        cur = conn.execute(
            "update mangel_foto set deleted_at=now(), deleted_by=core.current_actor() "
            "where id=%s and deleted_at is null",
            (str(id),),
        )
    if cur.rowcount == 0:
        raise HTTPException(404)
    return Response(status_code=204)
