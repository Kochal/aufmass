# 99 - Status

Current phase and what is settled versus open. Updated in place.

## Changelog
- 2026-06-22: Initial draft. Phase 0; directive set 00-09 drafted.
- 2026-06-23: Added `10-application-stack.md`; polyglot stack fork resolved.
- 2026-06-24: Aufmaß DB layer landed (migration `0020`, `tests/aufmass_test.sql`).
  The DB layer is now complete across the foundation and every feature module
  (`02`, `05`, `06`, `07`); all four guarantee suites pass on PG17.

-----

## Phase

**Phase 1: data layer + stack.** The directive set is drafted (`00`–`10`) and
the database layer is implemented as migrations with guarantee suites across the
foundation (`02`) and every feature module (`05`, `06`, `07`). The application
stack is decided (`10`) but not yet scaffolded. Next is the app-stack skeleton
(making `docker compose up` real) and the `03` host for the `07` vision
benchmark.

## Directive set

| Dir  | Title                          | State                         |
|------|--------------------------------|-------------------------------|
| `00` | Overview                       | Drafted. Locked decisions set |
| `01` | Compliance baseline            | Drafted                       |
| `02` | Data model and DB schema       | Drafted. Written properly     |
| `03` | Infrastructure / model serving | Drafted                       |
| `04` | Backup and archival            | Drafted                       |
| `05` | Operational modules (spine)    | Drafted. No open questions    |
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

1. Scaffold the `10` dev stack so `docker compose up` actually comes up: the
   `api` / `validator` / `stubs` / `web` service skeletons and a migration
   runner that applies `migrations/*.sql` (the one-shot `migrate` step). This
   settles the parked sub-decisions (React framework specifics, migration-runner
   shape) in a `notes/ops/` note.
2. Stand up `03` (a German GPU host) far enough to run the `07` vision
   benchmark on real sheets.
3. Build the first working API surface on the `05` spine over the migrated
   schema.
