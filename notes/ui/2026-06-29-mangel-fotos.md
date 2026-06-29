---
date: 2026-06-29
area: ui
---

# Mängel photos (Round 2)

## What was built

**Migration 0025** (`mangel_foto` table): one Mangel → many photos.
Columns: `id`, `tenant_id`, `mangel_id → mangel`, `document_id → document`,
`beschriftung` (optional caption). Full 02 foundation: RLS, audit, soft-delete,
optimistic concurrency, no-hard-delete trigger.

**Backend `api/app/routers/mangel_foto.py`**:
- `POST /api/mangel/{mangel_id}/foto` — multipart `image` field + optional
  `beschriftung` form field. Validates MIME (jpeg/png/webp/heic/heif). Calls
  `store_original(conn, tenant_id, "mangel_foto", bytes, retention_class=10)`
  then inserts `mangel_foto` row. Both ops in the same transaction.
- `GET /api/mangel/{mangel_id}/foto` — list rows, ordered by `created_at`.
- `GET /api/mangel-foto/{id}/image` — reads `document.storage_ref` → calls
  `read_original()` → streams bytes. Media type sniffed from magic bytes
  (JPEG/PNG/WebP fallback). First image-serving endpoint in the project.
  Egress-free: browser calls the API on the EU server, not external storage.
- `DELETE /api/mangel-foto/{id}` — soft-delete row. The document original is
  never deleted (retention class 10 yr).

**Frontend `MangelDetail.tsx`**:
- `useImageObjectUrl(fotoId)` hook: `fetch` with `getAuthHeaders()` → `blob()`
  → `URL.createObjectURL()`. Cleans up objectURL on unmount/id change. Needed
  because the image endpoint requires auth headers (browser `<img src>` can't
  send custom headers).
- `FotoThumbnail` component: 96×96 px thumbnail, inline delete with
  inline confirm overlay (hover to show X, click → show Yes/No).
- `MangelFotoDialog`: opens on the camera button in the Mangel table row.
  Shows all photos as a flex strip, upload button wired to a hidden
  `<input type="file" accept="image/*" capture="environment">` (mobile offers
  camera, desktop offers file picker). Upload uses native `fetch` + `FormData`
  (not apiClient) — same pattern as Aufmaß photo upload, required for
  multipart where openapi-fetch doesn't handle `File` fields well.
- Camera icon in every Mangel table row → opens the dialog for that Mangel.

## Design decisions

**upload uses native fetch**: The openapi-typescript schema for multipart endpoints
with `File` fields generates body types that don't map cleanly through
openapi-fetch's generic request layer. Native `fetch` + `FormData` is the
established pattern in this codebase (already in aufmass field UI).

**Delete is soft-delete, not instant**: The photo row is soft-deleted so audit
trail is preserved. The underlying document is never deleted; it carries the
retention class and will outlive the row. This matches the project-wide rule
(directive 02 non-negotiable 3).

**retention_class=10**: Mängel photos are legal evidence if a defect dispute
goes to court (VOB § 13 Gewährleistung). 10-year retention is conservative but
defensible; matches directive 01 table for Ausführungsunterlagen.

**No caption UI on upload** (yet): The `beschriftung` field exists in the DB
and schema but the upload dialog doesn't expose it yet. Adding it is a minor UI
change and can be done without a migration. The field is optional and defaults
to NULL so this is a safe deferral.

## What would invalidate

- If courts routinely require metadata (timestamp, GPS, device) with defect
  photos: need EXIF extraction + storage on the row; the document table's
  `content_hash` gives integrity but not metadata.
- If photo count per Mangel gets large (>20): thumbnails load sequentially;
  a lazy-load / pagination approach would be needed.
