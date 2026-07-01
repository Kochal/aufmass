# 99 - Status

Current phase and what is settled versus open. Updated in place.

## Changelog
- 2026-07-01 (z): match_status fix — manual entries always confirmed; edits
  preserve status. `AddPositionDialog` changed from `selectedLeistungId ?
  "confirmed" : "review"` to always `"confirmed"` (source=manual, user wrote
  it intentionally). `EditPositionDialog` save changed from always `"review"`
  to `position.match_status`, except when a new catalog assignment fires
  (different leistung_id or saveToKatalog) → `"confirmed"`. "Annehmen" is
  semantically for confirming system-suggested GAEB/OCR matches only.
  See notes/ui/2026-07-01-workflow-ux-improvements.md.
- 2026-07-01 (y): Workflow UX: nav reorder, inline creation, Auftraggeber
  create-and-navigate. Sidebar order is now Auftraggeber → Projekte → Angebote
  → Rechnungen → Katalog (workflow order). "Neues Angebot" dialog has inline
  "Neu" buttons for Auftraggeber and Projekt (inline name input, auto-select on
  success, Escape to cancel; Projekt picker filtered by selected Auftraggeber).
  Auftraggeber "Neu anlegen" now POSTs immediately with placeholder name and
  navigates directly to the full AuftraggeberDetail page — no 2-field dialog.
  See notes/ui/2026-07-01-workflow-ux-improvements.md.
- 2026-07-01 (x): Neue Rechnung dialog — filter pickers by active Angebote.
  Auftraggeber picker shows only companies with an active (non-cancelled,
  non-superseded) Angebot. Projekt picker shows only projects with an active
  Angebot under the selected Auftraggeber. Direktrechnung checkbox removes both
  filters. See notes/ui/2026-07-01-workflow-ux-improvements.md.
- 2026-06-30 (w): Auto-refresh angebot totals on position save. Added
  `_refresh_angebot_totals(conn, lv_id)` to `lv_position.py`: after every
  INSERT, UPDATE, or soft-DELETE it re-sums position gesamtpreise and rewrites
  `angebot.summe_netto/summe_brutto` using `pricing.price_document()` (draft
  only, no row_version check). Fixes "1 unresolved hard check failure" on
  Ausstellen after editing a position post-Berechnen — the arithmetic check
  now always sees current totals. Frontend: all position mutation success (and
  409 error) handlers now also invalidate `["angebot", angebotId]` so Berechnen
  gets a fresh row_version after position saves. Existing stale angebote: run
  Berechnen once to resync, then Prüfen + Ausstellen work.
  See notes/quotation/2026-06-30-inline-gesamtpreis.md.
- 2026-06-30 (v): Inline gesamtpreis on position save. lv_position router now
  computes gesamtpreis = ROUND(menge × einheitspreis, 2) (Python Decimal,
  ROUND_HALF_UP) on every INSERT and UPDATE. Card shows = Betrag immediately
  after saving a position — no Berechnen click needed for position-level sums.
  Berechnen still owns Angebot-level netto/MwSt/brutto totals and will
  overwrite gesamtpreis if position-level surcharges are introduced later.
- 2026-06-30 (u): Menge calculator follow-up fixes. (1) MengeInput: useEffect
  that re-seeded expr from value/formula props caused field to clear mid-typing
  when evaluator returned error on incomplete expression (e.g. "16,419*") —
  removed; expr is now fully local state. (2) MengeInput switched from single-line
  Input to resizable textarea (rows=3, resize-y, monospace) supporting multi-line
  expressions; newlines treated as whitespace by tokeniser. Layout: Menge
  full-width above Einheit+EP row. (3) EP field: type="number" → type="text"
  with German comma normalisation (display . as ,, store as .). (4) Initial
  preview: lazy useState initialisers evaluate the seed formula on mount so
  "= 41,704" appears immediately when reopening a saved formula. (5)
  berechnenMutation.onSuccess: added invalidateQueries(["lv-position"]) — the
  engine writes gesamtpreis back to lv_position rows (bumps row_version), so
  without this the cards didn't refresh and subsequent PUTs threw stale_row_version.
  See notes/ui/2026-06-30-menge-calculator.md.
- 2026-06-30 (t): Menge calculator. Migration 0026 adds lv_position.menge_formel
  (text, additive). Backend: menge_formel in LvPositionCreate/Update/Read,
  INSERT+UPDATE SQL wired. Frontend: calc.ts — safe recursive-descent parser
  (no eval/Function), German comma normalised, guards div-by-zero + unbalanced
  parens, rounds to 3dp. MengeInput.tsx — text Input wrapper; evaluates on
  every keystroke; shows "= 11,333" preview for expressions, amber error for
  invalid. Plain numbers: formula=null, no preview. acceptMutation,
  setMatchMutation, bulkAcceptMutation all preserve menge_formel so confirming
  a position does not null out the formula. TS clean.
  See notes/ui/2026-06-30-menge-calculator.md.
- 2026-06-30 (s): AngebotReview position UX — second pass. Delete moved from
  EditPositionDialog to PositionCard left-pane hover controls (inline Ja/Nein
  confirm, no dialog). EditPositionDialog: Leistung autosuggest (client-side,
  ≥2 chars, no API call), "In Katalog speichern" checkbox (auto-generated code,
  catalog picker if >1 catalog, POST Leistung then link position). AddPositionDialog:
  same Leistung autosuggest, Langtext (Positionstext) field added; selecting a
  catalog entry sets match_status=confirmed on POST. Manual positions right pane
  now shows "Eigener Eintrag" + kurztext (previously "Kein Katalogeintrag"). Row
  sum always visible: = Betrag from engine if available, ≈ Betrag preview
  (menge×EP) otherwise. Bulk accept "Alle annehmen" button (parallel PUTs, hides
  when all confirmed). stale_row_version fix: EditPositionDialog now stores
  editPositionId and looks up the live position from query cache on each render.
  Save-to-catalog race fix: effectiveKatalogId falls back to katalogList[0] when
  newKatalogId unset (katalogList loads after dialog opens). Unit warnings (amber ⚠,
  display-only): m1/m3 flagged as unusual (m2 is accepted shorthand for m² — no
  warning); unit mismatch between position.einheit and matched catalog einheit.
  TS clean. See notes/ui/2026-06-30-angebot-position-editing.md.
- 2026-06-30 (r): Angebot manual workflow + position editing fixes. Manual
  Angebot creation (Auftraggeber + Projekt picker → navigate to review).
  Manual position add (creates LV if none exists; source="manual";
  match_status="review"). Position field edit via pencil on left pane of
  PositionCard (distinct from "Korrigieren" = catalog picker on right pane);
  editing always resets match_status to "review". Delete in edit dialog with
  two-click confirm. Input cursor loss fixed (wrapper div now always rendered
  when clearable — conditional mount/unmount was dropping focus on first
  keystroke). "manual" badge label germanised to "Manuell". "Annehmen" now
  enabled for manual positions without a catalog match. Katalog: manual entry
  code auto-suggested from highest trailing number in catalog (padded 3 digits).
  Nominatim geocoding: Nominatim policy prohibits autocomplete; replaced
  debounced-per-keystroke with explicit search button. Nominatim User-Agent
  default fixed (example.com placeholder was 403'd). Address search popup now
  closes when query is cleared. TS clean throughout.
  See notes/ui/2026-06-30-angebot-position-editing.md,
  notes/infra/2026-06-29-nominatim-geocoding.md.
- 2026-06-29 (q): UI overhaul round 3 complete (Nominatim geocoding).
  Server-side proxy GET /api/geocode → nominatim.openstreetmap.org. Config:
  NOMINATIM_URL + NOMINATIM_USER_AGENT. AddressFields: explicit search button
  (one request per click; no autocomplete per OSM policy); fills all address
  fields from selected suggestion. TS clean.
- 2026-06-29 (p): UI overhaul rounds 1–2 complete. Round 1a: clickable rows on
  all list screens (useNavigate + onClick on TableRow). Round 1b: all 41 native
  <select> across 14 files replaced with Combobox (Popover+Command, searchable,
  allowClear for filters; @radix-ui/react-popover added). Round 1c: migration
  0024 (hausnummer on adresse, telefon on auftraggeber, adresse_id FK on
  lieferant, baustellen_adresse_id FK on projekt); shared AddressFields component
  + useAdresseUpsert hook; country combobox (ISO 3166-1 alpha-2, DE/AT/CH
  pinned); AuftraggeberDetail: structured address + phone + Ansprechpartner
  section (list/add/edit/delete via /api/kontakt); LieferantList: address in
  create/edit dialog; ProjektDetail: Baustellenadresse section. Round 2: migration
  0025 (mangel_foto table); mangel_foto router (upload/list/image-serve/
  soft-delete); useImageObjectUrl hook (objectURL via fetch+auth headers);
  MangelFotoDialog per row (camera button → photo strip + upload). TS clean.
  See notes/ui/2026-06-29-mangel-fotos.md.
  Round 3 (Nominatim geocoding) pending.
- 2026-06-29 (o): Gewährleistung auto-expiry live. Migration 0023 adds
  core.expire_gewaehrleistung() — SECURITY DEFINER (runs as maler superuser,
  bypasses FORCE RLS), sets actor 'system:expire_gewaehrleistung', cross-tenant
  UPDATE in one shot; audit trigger reads tenant_id from row (always correct).
  api/app/jobs.py + asyncio.create_task in lifespan: runs at startup then every
  24 h. Dashboard "Gewährleistung überfällig" card now self-clears.
  See notes/ops/2026-06-29-gewaehrleistung-expiry-job.md.
- 2026-06-29 (n): Bestellungen screens live. LieferantList (CRUD, USt-IdNr,
  Zahlungsziel). MaterialList (catalog: Bezeichnung/Einheit/Standard-Lieferant/
  Standardpreis). BestellungList (status+projekt filters, create→navigate to
  detail). BestellungDetail: header with full status lifecycle (entwurf→bestellt→
  teilgeliefert/geliefert; Stornieren with audited reason via set_reason());
  Bestellpositionen CRUD locked to entwurf/bestellt, Material lookup pre-fills
  position; client-side Gesamt + Summe row. GoBD document field shown as ref
  (upload deferred to directive 04). TS clean. Directive 05 changelog updated.
  See notes/ui/2026-06-29-bestellungen-screen.md.
- 2026-06-29 (m): Gewährleistung screen live (GewaehrleistungList). Flat list
  with status filter. Regime badges (VOB § 13 / BGB § 634a), fristende countdown
  with overdue (red) / expiring-soon (orange, ≤90 days) highlights. Create uses
  DB trigger defaults for frist_jahre (VOB=4/BGB=5) when left blank. Status
  change in edit dialog (laufend/abgelaufen/beendet). All directive-05 screens
  now live. TS clean. See notes/ui/2026-06-29-gewaehrleistung-screen.md.
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

**Phase 19: UI overhaul rounds 1–2 complete.** Clickable rows everywhere;
searchable Combobox replaces all 41 native selects; structured address with house
number, country combobox, phone on Auftraggeber/Lieferant/Projekt; Ansprechpartner
CRUD on Auftraggeber; Mängel photo upload/view/delete per defect item (camera icon
→ dialog, objectURL serving, write-once archive). Migrations 0024–0025 applied.
TS clean. Next: Round 3 Nominatim geocoding, then real Entra SSO (09), swap ASR
to self-hosted faster-whisper.

**Phase 18: Owner dashboard live.** GET /api/dashboard — single-query CTE endpoint
(projekte by status, Mängel offen/schwer/überfällig, Gewährleistung laufend/
ablaufend/überfällig, Rechnungen/Angebote Entwurf, Freigabe-queue Arbeitszeit +
Fahrt, Bestellungen offen, Finanzsumme). Frontend: 4 sections (Projekte,
Handlungsbedarf, Gewährleistung, Finanzen) — stat cards with urgency colouring
(red/orange/muted for zeros), linked to source screens, auto-refresh 60 s.
Nav "Übersicht" stub removed. TS clean.

**Phase 17: All directive-05 UI complete.** Bestellungen screens live:
LieferantList, MaterialList, BestellungList, BestellungDetail (status lifecycle,
Stornieren with audit reason, Bestellposition CRUD, Material pre-fill).
Full office surface now covers all entities from directives 05 and 06:
Angebote, Katalog, Rechnungen, Auftraggeber, Projekte, Arbeitszeit, Fahrtenbuch,
Fahrtzeiten, Mängel, Gewährleistung, Lieferanten, Material, Bestellungen. TS clean.

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
