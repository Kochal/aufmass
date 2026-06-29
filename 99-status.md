# 99 - Status

Current phase and what is settled versus open. Updated in place.

## Changelog
- 2026-06-29 (l): Mängel screen live. MangelList: Abnahmeprotokoll list with
  projekt filter; create navigates to detail. MangelDetail: protocol header
  (inline edit), Mängel CRUD (create/edit/soft-delete for offen entries),
  schwere badges (gering/mittel/schwer), status badges + filter, overdue frist
  highlight, behoben_am field conditional on status. protokoll_document_id
  preserved but attachment deferred to directive 04 round. TS clean.
  See notes/ui/2026-06-29-mangel-screen.md.
- 2026-06-29 (k): Fahrtenbuch + Fahrtzeiten screens live. FahrtenbuchList:
  Fahrzeug CRUD (create/edit/soft-delete), Privatnutzung badge. FahrtzeitenList:
  trip log mirroring Arbeitszeit pattern — freigabe_status/projekt filters,
  Freigeben per row, Korrektur dialog, km total in header. TS clean, 119 tests.
  See notes/ui/2026-06-29-fahrtenbuch-fahrtzeiten-screen.md.
- 2026-06-29 (j): Arbeitszeit screen live (ArbeitszeitList). Filters by
  freigabe_status and projekt. Freigeben per row (PATCH /{id}/freigabe);
  Korrektur dialog for approved entries (POST /{id}/korrektur). Total hours
  in header. GET /api/app-user endpoint added (read-only; user management
  deferred to directive 09 Entra SSO). TS clean, 119 tests green.
  See notes/ui/2026-06-29-arbeitszeit-screen.md.
- 2026-06-29 (i): Rechnungen screen live (RechnungList + RechnungDetail). Full
  berechnen→prüfen→ausstellen workflow in the UI: positions CRUD (draft only),
  Nachlass/Zuschlag inputs, prüfen runs KoSIT+EN16931 checks inline with
  pass/fail display, ausstellen gated on hard-check pass. Issued view shows
  XRechnung artifact ID + rechnungs/faelligkeits/leistungsdatum. ComingSoon
  helper removed from routes.tsx — all office routes are now live.
  See notes/ui/2026-06-29-rechnungen-screen.md.
- 2026-06-29 (h): Projekte screen live (ProjektList + ProjektDetail). Status
  filter on list; color-coded status badges (10 statuses); inline status change
  via PATCH /{id}/status; Projektdaten form (name, auftraggeber, site_adresse,
  regime, abrechnungsart) + Termine (start/end/abnahme); linked Angebote section
  (GET /api/angebot?projekt_id=...) with links into AngebotReview. Nav item added.
  TS clean. See notes/ui/2026-06-29-projekte-screen.md.
- 2026-06-29 (g): Auftraggeber screen live (AuftraggeberList + AuftraggeberDetail).
  Three sections: Stammdaten, Adresse (upsert pattern — creates adresse row on
  first save, updates on subsequent), Rechnungsdaten (leitweg_id/BT-10,
  elektronische_adresse/BT-49, eas_scheme). Stub removed from nav. TS clean.
  See notes/ui/2026-06-29-auftraggeber-screen.md.
- 2026-06-29 (f): Leistungskatalog tool complete + catalog matching wired into
  Angebot LV review. Frontend: KatalogList + KatalogDetail (manual add dialog,
  xlsx/csv spreadsheet import, extract-from-Angebote). Backend:
  `katalog/spreadsheet.py` (delimiter auto-detect, German decimal, auto-code),
  `katalog/matcher.py` (token-Jaccard + SequenceMatcher, thresholds 0.80/0.55),
  `POST /api/leistungskatalog/{id}/import-spreadsheet`,
  `POST /api/leistungskatalog/{id}/extract-from-angebote`,
  `POST /api/lv/{id}/catalog-match` (on-demand scan, "Katalog abgleichen" button
  in AngebotReview header). GAEB import auto-runs the matcher after creating
  positions (best-effort). Full embedding-based matching deferred: needs GPU/DPA-
  covered EU endpoint + populated catalog. 119 tests green.
  See notes/quotation/2026-06-29-catalog-matching.md.
- 2026-06-29 (e): GAEB import/export + roundtrip check complete (directive 06).
  `POST /api/gaeb/import` (X81/X83 → LV + positions, write-once original),
  `GET /api/gaeb/export/{angebot_id}` (D84 XML), `check_gaeb_roundtrip` hard
  check wired into prüfen. 15 tests green.
- 2026-06-29 (d): Voice form-fill implemented (directive 10). POST /api/voice/intent:
  shared ASR (app/voice/asr.py) + Mistral intent-parse (app/voice/intent.py) routes
  transcript to form fields, returns FieldFill candidates. useVoiceFill hook +
  VoiceFillButton presenter. Wired into Aufmaß-entry correction form (EntryCard):
  confirmation strip before any form state update; Speichern remains the only DB
  gate. 17 tests green. ASR = OpenAI Whisper PoC (known US-egress divergence from
  07b self-hosted goal).
- 2026-06-29 (c): 07b voice Aufmaß client implemented. OpenAI Whisper API for ASR
  (PoC, httpx, no new dep), Mistral mistral-small-latest for structuring, segment-ref
  assignment (source_crop_ref = {start_s, end_s}). Existing _insert_entry() reused;
  POST /api/aufmass/upload-voice added. OpenAI chosen over faster-whisper for PoC
  simplicity (no local model, no ffmpeg); production path remains faster-whisper.
  ASR later extracted to shared app/voice/asr.py module.
- 2026-06-29 (b): Aufmaß backend router + field UI complete. POST /api/aufmass/upload
  (Mistral extraction → DB write), POST /api/aufmass/upload-voice, CRUD endpoints,
  aufmass_entry confirm/correct/delete. _insert_entry() helper reuses schema for both
  photo and voice paths. Field surface UI: AufmassList, AufmassReview, EntryCard
  (correction inline edit with confirm/correct/delete). E2E verified on Hetzner.
- 2026-06-29 (a): Voice Aufmaß added as co-equal capture path. New directive
  `07b-voice-aufmass.md`: Whisper ASR + self-hosted structuring → same
  AufmassExtractionResult schema → 07 reconciler. Egress-free path (no DPA
  needed). No schema migration required (`quelle=voice` + `source_crop_ref` +
  `source_document_id` already in place). Voice form-fill section added to 10.
  Audio compliance added to 09. Directives 02, 03, 07, 09, 10, CLAUDE.md, 99
  updated. Two decision notes written.
- 2026-06-29: 07 vision_client rewrite complete. Two-step pipeline (raw OCR →
  chat structuring) is now the primary and only path; one-step annotation path
  retired. vision_client.py merged (two_step.py deleted). 19 unit tests pass.
  Bbox mapping live (22/27 on sample sheet). Known limits: OCR glyph misread
  and multi-line cell truncation require image-crop human review, not a code fix.
  Directives 07, 07a, 99 updated.
- 2026-06-28: 06 XRechnung e-invoice path complete. Migration 0022 adds adresse,
  bankverbindung, tenant_billing_profile tables + auftraggeber/rechnung extensions
  + core.rechnung_finalize_issue. New modules: einvoice/ubl.py (UBL 2.1 builder,
  stdlib XML), einvoice/validator_client.py (KoSIT HTTP client), storage.py
  (filesystem write-once original store). ausstellen_rechnung now orchestrates the
  full flow: master-data gate → assert_issuable → allocate_number → build XML →
  KoSIT validate → store originals → finalize atomically. pruefen adds two hard
  checks: einvoice_master_data + einvoice_en16931. Gapless guarantee holds: a
  failed ausstellen reverts the counter. New routers: adresse, bankverbindung,
  tenant_billing_profile. Three new test modules. See
  notes/quotation/2026-06-28-xrechnung-einvoice.md for design decisions and
  Steuerberater flags.
- 2026-06-28: Phase A+B frontend complete. shadcn/ui on Tailwind v4, react-router-dom v7,
  react-query v5, openapi-fetch typed client, dev-auth stub (X-Tenant-Id/X-User-Id), role-aware
  three-surface app shell, office quote-matching review screen (two-pane, risk-first, keyboard
  shortcuts, CatalogPicker, berechnen→prüfen→ausstellen gate). Full E2E browser test passed on
  Hetzner dev stack. Bug fixed: `ausstellenMutation.onError` now invalidates angebot cache.
  Vite proxy wired for remote browser access. `nummernkreis` seed requirement documented.
  See notes/ui/2026-06-28-design-system-and-surfaces.md, notes/ui/2026-06-28-e2e-browser-test.md.
- 2026-06-28: Model pivot — Aufmaß extraction moves from self-hosted VLM to Mistral Document
  AI (OCR 4, `mistral-ocr-4-0`). Decision 3 revised to co-equal per-step routing. GPU host
  unblocked from critical path. Directives 00, 01, 03, 06, 07, 07a, 09, CLAUDE.md updated.
  See notes/aufmass/2026-06-28-mistral-document-ai-pivot.md.
- 2026-06-26: Residency widened from German server to EU/EEA (whole stack); directives
  00, 03, 04, 06, 08, 09, 10 updated. See notes/infra/2026-06-26-eu-eea-residency.md.
- 2026-06-26: 06 quotation engine API landed: deterministic pricing engine
  (`engine/pricing.py`), sense-check engine (`engine/checks.py`), REST over 9 new
  entities (tenant_tax_profile, leistungskatalog/leistung, angebot/lv/lv_position,
  rechnung/rechnung_position, check_result), action endpoints (berechnen/pruefen/
  ausstellen/version). Seed extended (tax profile, catalog, angebot+rechnung
  nummernkreis). Engine unit tests + integration flows. Deferred: XRechnung/KoSIT
  (validator unbuilt as standalone round), GAEB import/export, PDF extraction +
  matching (GPU-host blocked), plausibility bands.
- 2026-06-22: Initial draft. Phase 0; directive set 00-09 drafted.
- 2026-06-23: Added `10-application-stack.md`; polyglot stack fork resolved.
- 2026-06-24: Aufmaß DB layer landed (migration `0020`, `tests/aufmass_test.sql`).
  The DB layer is now complete across the foundation and every feature module
  (`02`, `05`, `06`, `07`); all four guarantee suites pass on PG17.
- 2026-06-25: 05 API core slice landed: auftraggeber, kontakt, projekt (lifecycle),
  arbeitszeit (freeze-on-approval + korrektur) in `api/app/routers/`. Pydantic v2
  schemas, shared `db_errors()` PG→HTTP mapper, optimistic concurrency, dict-row
  pool, dev seed (two tenants + nummernkreis). 13 pytest tests green on Hetzner.
  TypeScript client regenerated (`web/src/api/schema.ts`, 1487 lines, tsc clean).
  Notes: `notes/operations/2026-06-25-api-layer-decisions.md`.
- 2026-06-25: 05 API fan-out: fahrzeug, fahrt, lieferant, material, bestellung,
  bestellposition, abnahmeprotokoll, mangel, gewaehrleistung. All 05 entities
  covered. Test suite extended; stack rebuilt on Hetzner.
- 2026-06-24: Scaffolded the `10` dev stack (`api`, `web`, `validator`, `stubs`)
  so `docker compose up` is the entry point. The migration runner, the dev `app`
  role bootstrap, and the per-request RLS session context are verified on PG17.
  Docker builds and the KoSIT `validator` image are not yet built/run.
- 2026-06-25: Remote instance stood up on Hetzner (`/root/aufmass/`). Fixed the
  validator Dockerfile (wrong KoSIT jar prefix and config zip filename). All 5
  images build; `docker compose up` confirmed green: all 20 migrations applied,
  validator healthy, API `/health` returns `{"status":"ok","db":true,"env":"dev"}`,
  React dev server responding.

-----

## Phase

**Phase 15: Mängel screen live.** All operational office screens now complete:
Angebote, Katalog, Rechnungen, Auftraggeber, Projekte, Arbeitszeit, Fahrtenbuch,
Fahrtzeiten, Mängel. Two-level hierarchy (Abnahmeprotokoll→Mangel) with protocol
inline edit, Mangel CRUD, schwere/status badges, overdue frist, status filter.
Next: Gewährleistung screen, real Entra SSO (09), swap ASR to self-hosted
faster-whisper, vector embedding matching.
faster-whisper for production, vector embedding matching.

## Directive set

| Dir  | Title                          | State                         |
|------|--------------------------------|-------------------------------|
| `00` | Overview                       | Drafted. Locked decisions set |
| `01` | Compliance baseline            | Drafted                       |
| `02` | Data model and DB schema       | Drafted. Written properly     |
| `03` | Infrastructure / model serving | Drafted                       |
| `04` | Backup and archival            | Drafted                       |
| `05` | Operational modules (spine)    | **API complete** (2026-06-25) |
| `06` | Quotation engine               | **Catalog matching + GAEB complete** (2026-06-29). XRechnung e-invoice, GAEB import/export, Leistungskatalog tool, string-similarity scan. Deferred: embedding matching (GPU/DPA), plausibility bands (price history). |
| `07` | Aufmaß capture and OCR         | **Complete** (2026-06-29). DB layer, vision + voice clients, backend router (upload/voice/CRUD), field UI, entry confirm/correct/delete. |
| `07a` | Vision client (photo/Mistral) | **Complete** (2026-06-29). Two-step pipeline, bbox token-match, 19 unit tests. |
| `07b` | Voice client (Whisper/ASR)    | **Complete** (2026-06-29). OpenAI Whisper PoC ASR (shared asr.py) + Mistral structuring. Swap to faster-whisper for production. |
| `08` | M365 integration               | Drafted                       |
| `09` | Security and DSGVO             | Drafted                       |
| `10` | Application stack / dev env    | **Voice form-fill live** (2026-06-29). Three-surface PWA, voice intent endpoint + PWA hook, wired into Aufmaß-entry correction. |
| `99` | Status                         | This file                     |

## Locked decisions (from `00`)

M365 for mail / calendar; B2G in scope; models routed per step (self-hosted EU/EEA
and named DPA-covered EU-native APIs are co-equal — Aufmaß → Mistral Document AI);
single firm in v1 but multi-tenant from day one; customer-defined fields
dropped for v1.

## Build order

`02` schema first (it inherits retention, immutability, audit from `00`/`01`),
then `05` spine, then `06` and `07` (both attach to a project), with `03`
infra and `04` archival standing up alongside, and `08` / `09` as the
integration and control layer. The directive numbers track this order.

## Open questions still parked

By directive, none blocking the build:

- `03`: GPU class / VLM fallback (parked — no longer critical path); co-locate
  vs split; on-prem vs hosted; fine-tune cadence (moot until fallback live);
  RfP/PDF extraction routing (deferred).
- `04`: RPO / RTO targets, offsite location, backup retention window, WORM
  mechanism.
- `06`: plausibility-band cold start (seed vs review-heavy).
- `07`: confidence-to-action thresholds, multi-candidate reconciliation,
  voice grammar, standalone Aufmaß. Parked for tuning on real sheets.
- `08`: which mailbox(es), RfP identification, send-on-behalf vs shared,
  calendar sync depth.
- `09`: field-worker auth, MFA scope, Betriebsrat present?, DPO threshold,
  security-review cadence.

Several of these are per-tenant facts (turnover band, Betriebsrat, DPO
threshold) or procurement calls (GPU, offsite) that resolve with the firm and
a sizing benchmark, not at the design stage.

## Next

1. ~~Confirm `docker compose up` on a real Docker host~~ **Done** (2026-06-25,
   Hetzner, `/root/aufmass/`). KoSIT validator fixed (v1.6.2), smoke-tested:
   `POST /` raw XML → `valid="true"`, scenario `EN16931 XRechnung (UBL Invoice)`
   matched. Pinned by digest.
2. ~~Build the first working API surface on the `05` spine (real endpoints +
   generated TS client)~~ **Done** (2026-06-25). All 13 `05` entities. 13 pytest
   tests green on Hetzner. `web/src/api/schema.ts` regenerated (tsc clean).
3. ~~Build the `06` quotation engine API~~ **Done** (2026-06-26). Deterministic
   core: pricing/check engine, 9 new entities, berechnen+pruefen+ausstellen+
   version endpoints, pytest green. Deferred: XRechnung+KoSIT, GAEB, PDF/matching.
4. ~~Stand up `03` GPU host for `07` vision benchmark~~ **Unblocked** (2026-06-28).
   ~~Rewrite vision_client.py~~ **Done** (2026-06-29). Two-step pipeline (raw OCR +
   mistral-small structuring), bbox token-match (22/27), 19 unit tests green.
   Known limits: OCR glyph misread + multi-line cell truncation → image-crop human
   review.
5. ~~XRechnung round~~ **Done** (2026-06-28). EN 16931 UBL 2.1 generation, KoSIT
   validation gate on both prüfen (preview) and ausstellen (final), filesystem
   write-once original store, party master data schema (adresse/bankverbindung/
   tenant_billing_profile). Gapless guarantee verified (rollback reverts counter).
   STEUERBERATER flags in notes/quotation/2026-06-28-xrechnung-einvoice.md.
6. ~~Phase A+B frontend~~ **Done** (2026-06-28). Three-surface PWA, office review
   screen, full E2E browser test. `nummernkreis` seed required per tenant (documented
   in notes/ui/2026-06-28-e2e-browser-test.md).
7. ~~07b voice Aufmaß client code round~~ **Done** (2026-06-29). OpenAI Whisper
   PoC ASR + Mistral structuring. Shared app/voice/asr.py. POST /api/aufmass/upload-voice
   live. Known divergence: ASR is OpenAI (US egress) not self-hosted faster-whisper;
   close before production.
8. ~~Field Aufmaß UI~~ **Done** (2026-06-29). AufmassList, AufmassReview, EntryCard
   (confirm/correct/delete for each entry). Source badge shows foto/voice/manual.
9. ~~Voice form-fill (directive 10)~~ **Done** (2026-06-29). POST /api/voice/intent,
   useVoiceFill hook, VoiceFillButton, confirmation strip in EntryCard correction
   form. Two-gate: voice→confirm→form inputs→Speichern→DB.
10. **Next: Rechnungen UI, Auftraggeber/Projekte screens, Arbeitszeit/Fahrt/Mangel
    field screens with voice fill, real Entra SSO (09), swap ASR to self-hosted
    faster-whisper (production), GAEB import/export, M365 integration (08).**
