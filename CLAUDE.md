# CLAUDE.md

Project: AI-native operations tool for a German Maler- und
Bodenbelagsbetrieb. Project management, Aufmaß capture, orders, quotations,
working hours, mileage, and the records construction firms must keep. AI
reads RfPs and handwritten Aufmaß; deterministic code owns all money math
and validation.

Audience: you (Claude Code) and any human contributor.

This file is the entry point. Read `00-overview.md` for what we are building
and why, and `01-compliance-baseline.md` for the regulatory constraints that
bind almost everything. Then read the directive named for the area you are
touching. Read the most recent files in `notes/<area>/` for current state and
open issues. Both are mandatory before non-trivial changes.

-----

## How this repo is organized

- **Directive files** (`00-overview.md` … `10-application-stack.md`,
  `99-status.md`): the plans, decided. Live at the **repo root** (not in a
  subdirectory), numbered 00-10 plus 99, revised in place, each with a
  changelog block at the top. Treat as input.
- **`notes/`**: the journal. What was learned, assumed, decided in the
  moment, debugged. Append-only, dated, organized by area. Treat as output.
  Write here liberally. Areas mirror the directives: `compliance/`,
  `schema/`, `infra/`, `archival/`, `operations/`, `quotation/`, `aufmass/`,
  `m365/`, `security/`, `ops/`.
- **`migrations/`**: database migrations. The `02` schema and its
  cross-cutting patterns live here.
- **`tests/`**: mirrors the code layout. The foundation guarantees (below)
  have tests before any feature builds on them.
- **`data/`**: never commit anything under it.

-----

## Non-negotiables

These come from the directives and are restated here so an agent that only
skims still cannot miss them. Each links to where it is specified.

1. **No money math in the model.** Einheitspreis x Menge, surcharges,
   Nachlass, MwSt, totals: deterministic engine only. A model output is a
   candidate with a confidence and a source, never a committed number.
   (`00`, `06`, `07`)
2. **Tenant isolation at the row level.** Every business row carries
   `tenant_id`; access is enforced by row-level security, not application
   code alone. (`00`, `02`)
3. **Records are immutable and audited.** No hard deletes; soft-delete plus
   versioning plus an append-only audit trail. Issued financial documents
   are frozen; a change makes a new version. (`01`, `02`)
4. **Digital originals in original format.** E-invoice XML, GAEB files,
   Aufmaß photos, signed PDFs: archived unaltered, revisionssicher, for the
   full retention period. A rendered PDF is a copy, not the original. (`01`,
   `04`)
5. **Money- and law-bearing data is typed, not freeform.** Anything feeding
   a price, quantity, tax figure, LV position, or statutory record is a
   typed column. (`00`, `02`)
6. **Every committed value is traceable to its source.** A price to an LV
   position and a catalog entry; a measurement to a formula and an image
   crop. No orphan numbers. (`00`, `06`, `07`)
7. **Egress defaults to deny.** No tender, customer, measurement, or price
   data goes to any third-party model service. M365 (mail / calendar) is the
   one named, AVV-covered exception. (`03`, `08`)
8. **Legal figures are design constraints, not sign-off.** The retention
   periods, e-invoice dates, VOB Section 2(3) rule, and DPO / Betriebsrat
   thresholds in `01`, `06`, and `09` are what we design to. They do not
   replace the firm's Steuerberater and Datenschutz review before the system
   issues real invoices or records real working time. (`01`, `09`)

-----

## Foundation first

Before any feature module, the `02` cross-cutting patterns exist as
migrations with tests that prove them. Do not build feature tables (projects,
quotes, Aufmaß) until these pass:

- tenant RLS: a query with no `app.tenant_id` set sees nothing; a
  cross-tenant read returns empty.
- audit: every write to a business table lands a row in `audit_log`.
- immutability: an issued Rechnung rejects an UPDATE; a hard DELETE on a
  business table is refused.
- numbering: a rolled-back invoice issue burns no number (gapless holds).
- the edit_lock table and the optimistic-concurrency `row_version` check.

Every later module inherits these rather than re-asserting them.

-----

## Working norms

### Before changing anything substantial

1. Read `notes/index.md` first — one-line summaries of every note, organised
   by area. Use it to identify which notes are relevant before opening them.
2. Read `00-overview.md` and the directive for the area.
3. Open only the specific notes flagged by the index as relevant to your area.
   If the index is silent on your question, that is signal: write a new note
   as you work and add a row to `notes/index.md`.
4. If you hit a judgment call not covered by directives or notes, **write the
   note first**, then do the work.

### When you make an assumption

Write a note: `notes/<area>/YYYY-MM-DD-<short-slug>.md`. Start with what you
assumed, why, what would invalidate it, and how confident you are. Do not
bury assumptions in code comments.

### When you make a decision that affects the design

Update the relevant directive and add a line to its changelog block. The note
explains *why*; the directive states *what is now true*. Both.

### When you do not know something

Do not guess about regulatory rules, tax treatment, or VOB / DSGVO specifics.
Ask, or write it as an assumption-note flagged for the firm's Steuerberater /
Datenschutz. A wrong assumption here can void a real invoice or a real
working-time record.

-----

## Technical conventions (what is decided)

- **Postgres.** Primary keys UUID. Money `numeric(12,2)`, quantities
  `numeric(14,3)`, never float. Timestamps `timestamptz` in UTC. (`02`)
- **Naming**: German snake_case for domain entities (`auftraggeber`,
  `angebot`, `lv_position`, `aufmass`, `rechnung`), English for technical and
  cross-cutting tables (`tenant`, `app_user`, `audit_log`, `document`,
  `edit_lock`). (`02`)
- **Models are self-hosted** on the firm's own server in the EU/EEA; the app talks only to
  local inference endpoints. (`03`)
- **Originals are content-hashed** and stored write-once. (`04`)

### Stack decisions (resolved in `10-application-stack.md`)

FastAPI + psycopg3 (Python 3.12) for the API; React + TypeScript (Vite) for the
web; psycopg_pool for the connection pool. Make a decision note in `notes/ops/`
before introducing a new framework or language.

-----

## Remote execution

Compute and storage live on the self-hosted EU/EEA server (`03`), not the
local machine; treat local as a thin client.

- One-off commands through `ssh` so output and errors return to the local
  session.
- Long jobs (migrations on large data, fine-tuning, batch extraction) start
  detached (`tmux` / `nohup`) on the remote side; poll for completion.
- Do not assume local paths exist; data and models are remote.

-----

## What lives where (quick reference)

| You want to know...                          | Look in...                       |
|----------------------------------------------|----------------------------------|
| What we are building, the locked decisions   | `00-overview.md`                 |
| The regulatory constraints                   | `01-compliance-baseline.md`      |
| The data model and schema                    | `02-data-model.md`               |
| Infra and model serving                      | `03-infrastructure.md`           |
| Backup and archival                          | `04-backup-archival.md`          |
| Projects, orders, time, mileage, warranty    | `05-operational-modules.md`      |
| RfP ingestion and quotation                  | `06-quotation-engine.md`         |
| Aufmaß capture and OCR                        | `07-aufmass-ocr.md`              |
| M365 integration                             | `08-m365-integration.md`         |
| Security and DSGVO                           | `09-security-dsgvo.md`           |
| Application stack / dev env                  | `10-application-stack.md`        |
| Current status and parked questions          | `99-status.md`                   |
| Why a method or choice was made              | `notes/<area>/`                  |

When in doubt: directives for *what*, notes for *why*, code for *how*.
