# 99 - Status

Current phase and what is settled versus open. Updated in place.

## Changelog
- 2026-06-22: Initial draft. Phase 0; directive set 00-09 drafted.

-----

## Phase

**Phase 0: directives.** The design is being written down before code. No
implementation yet. The next phase is the `02` schema and migrations, then
the operational spine (`05`), then quotation (`06`) and Aufmaß (`07`).

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
| `07` | Aufmaß capture and OCR         | Drafted                       |
| `08` | M365 integration               | Drafted                       |
| `09` | Security and DSGVO             | Drafted                       |
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

1. Write `02` migrations against the entity catalog and the cross-cutting
   patterns (RLS, audit triggers, soft-delete, immutability, Nummernkreis,
   edit-lock).
2. Stand up `03` (a German GPU host) far enough to run the `07` vision
   benchmark on real sheets.
3. Build the `05` spine as the first working surface.
