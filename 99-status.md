# 99 - Status

Current phase and what is settled versus open. Updated in place.

## Changelog
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

**Phase 2: 05 operational-spine API — complete.** The `05` HTTP surface is fully
built over the migrated schema: all 13 entities (auftraggeber, kontakt, projekt,
arbeitszeit, fahrzeug, fahrt, lieferant, material, bestellung, bestellposition,
abnahmeprotokoll, mangel, gewaehrleistung) have CRUD routers with the full pattern
set (RLS, dict-row, optimistic concurrency, soft-delete guard, lifecycle status
machine, freeze-on-approval, generated columns). Dev seed, pytest suite, and
regenerated TypeScript client. Next: `06` quotation engine API, and GPU host
decision for `03`/`07`.

## Directive set

| Dir  | Title                          | State                         |
|------|--------------------------------|-------------------------------|
| `00` | Overview                       | Drafted. Locked decisions set |
| `01` | Compliance baseline            | Drafted                       |
| `02` | Data model and DB schema       | Drafted. Written properly     |
| `03` | Infrastructure / model serving | Drafted                       |
| `04` | Backup and archival            | Drafted                       |
| `05` | Operational modules (spine)    | **API complete** (2026-06-25) |
| `06` | Quotation engine               | Drafted                       |
| `07` | Aufmaß capture and OCR         | Drafted. DB layer (0020) + tests |
| `08` | M365 integration               | Drafted                       |
| `09` | Security and DSGVO             | Drafted                       |
| `10` | Application stack / dev env    | Drafted. Stack fork resolved  |
| `99` | Status                         | This file                     |

## Locked decisions (from `00`)

M365 for mail / calendar; B2G in scope; self-hosted LLM on a German server;
single firm in v1 but multi-tenant from day one; customer-defined fields
dropped for v1.

## Build order

`02` schema first (it inherits retention, immutability, audit from `00`/`01`),
then `05` spine, then `06` and `07` (both attach to a project), with `03`
infra and `04` archival standing up alongside, and `08` / `09` as the
integration and control layer. The directive numbers track this order.

## Open questions still parked

By directive, none blocking the build:

- `03`: provider / GPU class (benchmark), co-locate vs split, on-prem vs
  hosted, fine-tune cadence.
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
3. Build the `06` quotation engine API (angebot, LV positions, rechnung):
   the core money path, gapless invoice numbering, e-invoice XML generation,
   immutability on issued documents, plausibility stubs.
4. Stand up `03` (a German GPU host) far enough to run the `07` vision
   benchmark on real Aufmaß sheets. Current Hetzner host has no GPU; requires
   a GPU instance decision (provider, class, location in DE).
