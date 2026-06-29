# Aufmaß field surface — implementation notes

**Date:** 2026-06-29
**Area:** ui
**Status:** shipped

---

## What was built

`/field` — `AufmassList`: project picker (GET /api/projekt), session list per
project, "Foto hochladen" (multipart upload), "Manuell erfassen" (POST /api/aufmass).
Creates a session and navigates immediately to the review screen.

`/field/:aufmassId` — `AufmassReview`: loads session with embedded entries
(GET /api/aufmass/{id}). Three-column EntryCard: confidence band (green ≥85%,
amber 60–84%, red <60%), bauteil + written_result + raw OCR text, actions.
Sorted risk-first: `review` → `corrected` → `confirmed`. Header counter tracks
progress. Confirm (PATCH /confirm) dims the card and shows "✓ Bestätigt Ändern".
Correct (PATCH /correct) opens an inline edit form (no modal) for Bauteil /
Einheit / Messwert.

---

## Bug found: DevLogin preset UUIDs didn't match seed

The initial DevLogin presets were placeholder values:
- `tenantId: "00000000-0000-0000-0000-000000000001"`
- `userId: "00000000-0000-0000-0000-000000000010"`

The seed (`api/app/seed.py`) uses:
- `T1_ID = "11111111-0000-0000-0000-000000000001"`
- `T1_USER_ID = "11111111-0000-0000-0000-000000000002"`

Everything appeared to work (the app loaded, the shell rendered) because the
backend RLS just filtered to zero rows for the wrong tenant — no error, just empty
lists. Symptom: project picker loaded but had no options despite the API returning
HTTP 200.

**Fix:** Updated `web/src/auth/DevLogin.tsx` presets to the real seed values.

---

## Auth state uses two separate localStorage keys

`AuthContext.tsx` writes the full `Principal` object under `"dev-auth-principal"`.
`api.ts` / `persistAuth()` writes just `{ tenantId, userId }` under `"dev-auth"`.

On mount, `AuthContext` reads `"dev-auth-principal"` and then the `useEffect` that
syncs calls `persistAuth()`, which **overwrites** `"dev-auth"` from the principal's
in-memory state. This means manually patching only `"dev-auth"` in localStorage
is useless — it gets overwritten on the next render.

**To fix auth in a live browser session:** update `"dev-auth-principal"` (the
source of truth), then hard-reload. Or just use the DevLogin screen.

---

## Multipart file upload: use native fetch, not apiClient.POST

`openapi-fetch` JSON-serialises the body by default. For multipart form data it
needs a custom `bodySerializer: (b) => b`, and the generated TypeScript body type
for multipart endpoints is awkward. Native fetch with a `FormData` body lets the
browser set the correct `Content-Type: multipart/form-data; boundary=…` header
automatically.

Pattern used in `AufmassList.tsx`:

```ts
import { getAuthHeaders } from "@/lib/api"; // exported for this purpose

const formData = new FormData();
formData.append("projekt_id", projektId);
formData.append("image", file);
const resp = await fetch(`${import.meta.env.VITE_API_URL ?? ""}/api/aufmass/upload`, {
  method: "POST",
  headers: getAuthHeaders(), // injects x-tenant-id / x-user-id only; no Content-Type
  body: formData,
});
```

`getAuthHeaders()` was made `export` in `api.ts` specifically to support this.

---

## What would invalidate these decisions

- **openapi-fetch multipart support improves**: if the library adds a `bodySerializer`
  that handles `FormData` transparently, revert to `apiClient.POST` for consistency.
- **Entra SSO** (directive 09): replace the DevLogin screen. The `getAuthHeaders()`
  export becomes unused (the Entra middleware handles it). Remove both localStorage
  keys and the `persistAuth`/`clearAuth` functions.
