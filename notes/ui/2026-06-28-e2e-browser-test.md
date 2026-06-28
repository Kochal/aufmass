# E2E browser test — office quote-matching review screen

Date: 2026-06-28  
Area: ui

## What was tested

Full browser walkthrough of the Phase B office quote-review slice on the Hetzner
dev stack (`95.217.218.99:5173`). Covered: DevLogin → Angebot list → two-pane
review → risk-first ordering → keyboard navigation → catalog picker → Berechnen →
Prüfen → Ausstellen.

## Bugs found and fixed

### 1. `ausstellenMutation.onError` did not invalidate the angebot cache

**Symptom:** Ausstellen returned 409 (stale `row_version`), then retrying
immediately returned another 409 because the `onError` handler only showed a
toast without calling `qc.invalidateQueries`. The cached `row_version` stayed
at the pre-Berechnen value indefinitely.

**Root cause:** After `berechnenMutation.onSuccess` invalidates `["angebot", id]`
and the cache refetches, a subsequent `pruefenMutation` can fire before the
refetch completes, and the `ausstellenMutation` then reads a stale `row_version`.
The 409 handler needs to re-fetch the angebot so the next attempt uses the correct
version.

**Fix:** Added `qc.invalidateQueries({ queryKey: ["angebot", id] })` inside
`ausstellenMutation.onError` in `AngebotReview.tsx`. Mirrors the pattern already
used by `acceptMutation.onError`.

### 2. Demo `nummernkreis` seeded with wrong format placeholder

**Symptom:** Ausstellen succeeded (status → issued) but `angebotsnummer` was
`"ANG-2026-{N:04}"` — the counter placeholder was not substituted.

**Root cause:** Seeded the `nummernkreis` with format `'ANG-{YYYY}-{N:04}'` but
`core.allocate_number()` recognises `{SEQ:N}` and `{SEQ}`, not `{N:04}`.

**Fix:** Updated the seeded format to `'ANG-{YYYY}-{SEQ:4}'`. The already-issued
demo angebot keeps its garbled number (the immutability trigger correctly refused
a direct UPDATE on the issued document — see below).

## Confirmed working

- **Immutability trigger:** An attempt to UPDATE `angebotsnummer` on the issued
  angebot raised `"issued document … is immutable (only cancel/supersede allowed)"`.
  This is `core.freeze_document()` working as designed (`02`).

- **Ausstellen gate (DB-side):** The function `core.issue_angebot()` enforces three
  gates before allocating a number: (1) `core.assert_issuable` — no unresolved hard
  check failures; (2) completeness — no position with `gesamtpreis IS NULL` or
  `match_status IN ('review','unmatched')`; (3) tax snapshot from
  `tenant_tax_profile`. The 409 we saw was from gate (3) failing silently on a
  missing `nummernkreis` (the function uses a plain `RAISE EXCEPTION` mapped to 409
  by `db_errors()`).

- **Full review flow:** risk-first ordering, j/k/a/c/x keyboard shortcuts, live
  re-sort after each accept, CatalogPicker search, Berechnen totals update
  (2.252,50 → 2.442,90 € netto after adding 28 m Sockelleisten × 6,80 €),
  Prüfen all green, Ausstellen → "Ausgestellt" badge, action buttons hidden.

## Required seed items for demo tenant

When provisioning a fresh demo tenant, the following must be seeded in addition to
the tenant, app_user, auftraggeber rows already documented:

```sql
-- nummernkreis (one row per doc_type the tenant will issue)
SET app.user_id = 'system';
SET app.tenant_id = '<tenant-uuid>';
INSERT INTO nummernkreis (tenant_id, doc_type, format, reset_policy, gapless)
VALUES ('<tenant-uuid>', 'angebot', 'ANG-{YYYY}-{SEQ:4}', 'yearly', true);
-- Add 'rechnung', 'auftrag', etc. as needed.
```

Without this, `core.allocate_number()` raises and `ausstellen` returns 409 with
the message `"no nummernkreis configured for tenant … doc_type …"`.

## What is NOT yet tested

- Monteur role: field nav hidden, field stub shows
- Cross-tenant RLS (network tab shows only own-tenant data)
- Force a 409 stale-edit and verify the refetch toast (now fixed — was not retestable on issued document)
- Rechnung UI (deferred — no Rechnungen screen built yet)
