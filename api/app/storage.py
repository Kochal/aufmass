"""Write-once filesystem original store (directive 04, minimal slice).

Computes SHA-256 of the content, writes the bytes content-addressed to
  DOCUMENTS_DIR / {tenant_id} / {sha256hex}
and records a row in the document table.

Content-addressed write-once: if the file already exists (same hash), the
bytes are NOT overwritten — the existing path is reused. A second INSERT for
the same content_hash is also skipped (idempotent).

This is the dev-phase archival implementation. The production path (S3 / WORM
object store) is directive 04's dedicated round; this module's interface is
designed so the storage backend can be swapped without touching callers.

The document table FK (rechnung.einvoice_artifact_id → document.id) is resolved
inside the same transaction as the rechnung finalize-issue UPDATE, so the
artifact is always present when the invoice is frozen.
"""
from __future__ import annotations

import hashlib
from pathlib import Path
from uuid import UUID

from psycopg import Connection

from .config import settings


def store_original(
    conn: Connection,
    tenant_id: UUID,
    kind: str,
    content: bytes,
    retention_class: int = 10,
) -> UUID:
    """Archive *content* as a write-once original; return the document id.

    Parameters
    ----------
    conn:            psycopg connection (inside the caller's transaction)
    tenant_id:       the owning tenant (for the path and the document row)
    kind:            document kind string, e.g. 'einvoice', 'einvoice_report'
    content:         raw bytes to archive (the actual original)
    retention_class: retention period in years (6 / 8 / 10 per §147 AO / §257 HGB)

    Returns the UUID of the document row (new or pre-existing).
    """
    content_hash = hashlib.sha256(content).hexdigest()

    # ── Filesystem write ───────────────────────────────────────────────────
    base = Path(settings.documents_dir) / str(tenant_id)
    base.mkdir(parents=True, exist_ok=True)
    dest = base / content_hash

    if not dest.exists():
        # Atomic write via temp-file + rename (POSIX atomic; best-effort Windows).
        tmp = dest.with_suffix(".tmp")
        tmp.write_bytes(content)
        tmp.rename(dest)

    # Path stored relative to DOCUMENTS_DIR so the store is relocatable.
    storage_ref = f"{tenant_id}/{content_hash}"

    # ── Document row ───────────────────────────────────────────────────────
    # Idempotent: if a row with this hash already exists, reuse it.
    existing = conn.execute(
        "select id from document where content_hash=%s and deleted_at is null",
        (content_hash,),
    ).fetchone()
    if existing:
        return UUID(str(existing["id"]))

    row = conn.execute(
        "insert into document(tenant_id, kind, content_hash, storage_ref, "
        "original_format, retention_class) "
        "values (core.current_tenant(), %s, %s, %s, true, %s) returning id",
        (kind, content_hash, storage_ref, retention_class),
    ).fetchone()
    return UUID(str(row["id"]))
