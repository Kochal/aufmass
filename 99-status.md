# 99 - Status

Current phase and what is settled versus open. Updated in place.

## Changelog
- 2026-06-29: Voice Aufmaß added as co-equal capture path. New directive
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

**Phase 7: Voice modality added (07b spec complete).** Voice is a co-equal,
egress-free Aufmaß capture path alongside photo. `07b` directive written as spec for
the voice client code round. Voice form-fill specced in `10`. All directives
reconciled. Next: field Aufmaß UI (07 backend router + DB write), voice client
code round (07b), Rechnungen UI, real Entra SSO (09).

## Directive set

| Dir  | Title                          | State                         |
|------|--------------------------------|-------------------------------|
| `00` | Overview                       | Drafted. Locked decisions set |
| `01` | Compliance baseline            | Drafted                       |
| `02` | Data model and DB schema       | Drafted. Written properly     |
| `03` | Infrastructure / model serving | Drafted                       |
| `04` | Backup and archival            | Drafted                       |
| `05` | Operational modules (spine)    | **API complete** (2026-06-25) |
| `06` | Quotation engine               | **XRechnung e-invoice complete** (2026-06-28) |
| `07` | Aufmaß capture and OCR         | **Vision client complete** (2026-06-29). DB layer (0020) + tests. Backend router + DB write pending. |
| `07a` | Vision client (photo/Mistral) | **Complete** (2026-06-29). Two-step pipeline live. |
| `07b` | Voice client (Whisper/ASR)    | **Spec written** (2026-06-29). Code round pending. |
| `08` | M365 integration               | Drafted                       |
| `09` | Security and DSGVO             | Drafted                       |
| `10` | Application stack / dev env    | **Frontend live** (2026-06-28) |
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
   review. Next `07` deliverable: backend router + DB write (aufmass/aufmass_entry),
   then field Aufmaß UI.
5. ~~XRechnung round~~ **Done** (2026-06-28). EN 16931 UBL 2.1 generation, KoSIT
   validation gate on both prüfen (preview) and ausstellen (final), filesystem
   write-once original store, party master data schema (adresse/bankverbindung/
   tenant_billing_profile). Gapless guarantee verified (rollback reverts counter).
   STEUERBERATER flags in notes/quotation/2026-06-28-xrechnung-einvoice.md.
6. ~~Phase A+B frontend~~ **Done** (2026-06-28). Three-surface PWA, office review
   screen, full E2E browser test. `nummernkreis` seed required per tenant (documented
   in notes/ui/2026-06-28-e2e-browser-test.md). Next: field Aufmaß UI (needs 07
   backend first), Rechnungen screen, Auftraggeber/Projekte screens, Entra SSO.
