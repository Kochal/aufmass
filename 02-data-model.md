# 02 - Data Model and DB Schema

The data model and how the cross-cutting rules from `00` and `01` are
enforced at the table level: tenant isolation, immutability, audit,
versioning, soft-delete, and typed money/law-bearing data.

This directive states the shape of the data and the load-bearing patterns.
The migrations (code) implement it. Where a pattern is a real design
decision (RLS, the audit mechanism, document immutability), the exact
mechanism is pinned here so it is not reinvented per table.

Audience: you (Claude Code) and any human contributor.

## Changelog
- 2026-06-22: Initial draft. Entity catalog, tenancy, audit/immutability
  patterns, tenant tax profile.
- 2026-06-22: Document numbering made a per-tenant configurable Nummernkreis
  (continuous / yearly reset / carried-over external sequence). Open
  questions 1-4 resolved.
- 2026-06-22: Added tenant_setting (module toggles and operational defaults)
  and a concurrency/locking model (optimistic concurrency plus advisory edit
  leases at aggregate granularity).
- 2026-06-22: Added abnahmeprotokoll and mangel entities with an
  `abnahme_mode` toggle (structured defects list vs simple
  date-plus-document).
- 2026-06-22: Added projekt.abrechnungsart (Einheitspreis / Pauschal) to
  drive the Schlussrechnung billing rule (`06`).
- 2026-06-23: Implemented the cross-cutting foundation as migrations
  `0001`–`0007` with a guarantee test suite (`tests/`). Implementation
  decisions now true: RLS is `FORCE`d (not only `ENABLE`d) so owners are bound;
  `core.current_tenant()` reads the missing-ok GUC so "no tenant set" yields
  empty, not an error; one `core.register_business_table()` installs every
  pattern; `created_by`/`updated_by`/`audit_log.actor` are `text` (actor may be
  a job name); `nummernkreis` gains `current_period`, and `start_offset` seeds
  `counter`; `edit_lock` is registered hard-delete-OK (ephemeral). Minimal
  `rechnung` and `auftraggeber` live in the foundation to carry/prove the
  freeze and numbering rules; full versions remain `06`. Rationale in
  `notes/schema/2026-06-23-cross-cutting-foundation.md`.
- 2026-06-23: Materialized the operational catalog (`05`) as migrations
  `0008`–`0014`: `tenant_setting`, `document`, `projekt`, `kontakt`,
  `abnahmeprotokoll`, `mangel`, `gewaehrleistung`, `lieferant`, `material`,
  `bestellung`, `bestellposition`, `fahrzeug`, `arbeitszeit`, `fahrt`. Columns
  added beyond this catalog's prose, all via the standard registration pattern:
  `projekt.status_vor_pause` (pause/resume), `gewaehrleistung.frist_jahre` +
  computed `frist_ende`, `arbeitszeit.dauer` (generated) and
  `arbeitszeit`/`fahrt` `freigabe_status`/`freigegeben_*`/`korrektur_von_id`
  (freeze-on-approval). Closed sets are still `text` + CHECK (consistent with
  the foundation), not enum types. Detail in
  `notes/operations/2026-06-23-operational-spine.md`.
- 2026-06-23: Materialized the quotation/billing catalog (`06`) as migrations
  `0015`–`0019`: `tenant_tax_profile`, `leistungskatalog`, `leistung`,
  `gaeb_artifact`, `lv`, `lv_position`, `angebot` (financial doc), plus
  `check_result` and `rechnung_position`; `rechnung` extended with the tax
  snapshot and e-invoice columns. angebot/rechnung carry a tax-treatment
  snapshot filled at issue; lv_position/rechnung_position carry the match and
  traceability provenance. Honoring "no money math in the database": committed
  values are stored, computed by the engine (`06`, app-layer). Detail in
  `notes/quotation/2026-06-23-quotation-db-layer.md`.
- 2026-06-24: Materialized the Aufmaß catalog (`07`) as migration `0020`:
  `aufmass`, `aufmass_entry`. The reserved shape is now real, with the
  expression-tree / candidate-readings / crop / confidence columns as jsonb +
  typed quantities (`numeric(14,3)`). Columns added beyond this catalog's prose:
  `aufmass_entry.einheit` (drives the magnitude band) and `review_status`. A
  `quelle`-driven CHECK ties foto/voice captures to an archived `document`
  (non-negotiable 4); a `core.check_aufmass_entry_pruefbar` trigger enforces the
  traceability floor (non-negotiable 6) at confirm time. Honoring "no money math
  — and no measurement math — in the database": reconciliation stays app-layer
  (`07`). Detail in `notes/aufmass/2026-06-24-aufmass-db-layer.md`.

-----

## Conventions

- **Postgres.** Chosen for row-level security, triggers, JSONB, and
  point-in-time recovery (the `04` archival story depends on the last).
  No second store in v1.
- **Primary keys**: UUID (`uuid` / `gen_random_uuid()`). No natural keys as
  PKs; business identifiers (Kundennummer, Angebotsnummer) are their own
  typed, uniquely-constrained columns.
- **Naming**: German snake_case for domain entities (`auftraggeber`,
  `angebot`, `lv_position`, `aufmass`, `arbeitszeit`, `fahrt`, `rechnung`),
  English for technical and cross-cutting tables (`tenant`, `app_user`,
  `audit_log`, `document`). Stated so it is a decision, not drift.
- **Money**: `numeric(12,2)` for amounts, never float. Quantities
  `numeric(14,3)`. Currency is EUR in v1 but carried as a column, not
  assumed.
- **Time**: `timestamptz`, UTC. Every business row has `created_at`,
  `created_by`, `updated_at`, `updated_by`.
- **Enums**: Postgres enum types for closed sets (document status, tax
  treatment, unit). Open or evolving sets are lookup tables.
- No money math in the database beyond storage. Pricing and totals are
  computed by the deterministic engine (`06`) and written as committed
  values with their provenance (`00`, core principle).

-----

## Tenancy

Every business row carries `tenant_id uuid not null references tenant(id)`.
Isolation is enforced by **row-level security**, not by application code
alone (`00`, non-negotiable 4).

```sql
-- pattern applied to every business table
alter table auftraggeber enable row level security;

create policy tenant_isolation on auftraggeber
  using (tenant_id = current_setting('app.tenant_id')::uuid)
  with check (tenant_id = current_setting('app.tenant_id')::uuid);
```

- The application sets `app.tenant_id` per connection/transaction after
  authenticating the user; it is never taken from client-supplied data in
  the query.
- The migration role and a separate restricted retention role (`04`) are
  the only roles that may bypass RLS, and only for defined maintenance
  jobs.
- Cross-tenant reference is impossible by construction: a foreign key plus
  the policy means a row can only point at rows in its own tenant.

-----

## Immutability, audit, versioning, soft-delete

These four are distinct mechanisms; `01` (GoBD) requires all of them.

### Audit (append-only, trigger-enforced)

A single `audit_log` table, written by an `AFTER INSERT/UPDATE/DELETE`
trigger installed on every business table. Not writable by the application.

```sql
create table audit_log (
  id           bigint generated always as identity primary key,
  tenant_id    uuid        not null,
  table_name   text        not null,
  row_id       uuid        not null,
  op           char(1)     not null,          -- I / U / D
  old_row      jsonb,
  new_row      jsonb,
  actor        text        not null,          -- app_user id or job name
  reason       text,                          -- set for status changes
  at           timestamptz not null default now()
);
```

The trigger captures actor from `current_setting('app.user_id')`. `audit_log`
has no UPDATE/DELETE grants for any role; it only grows. Retention deletion
(`04`) is itself logged.

### Soft-delete and physical deletion

- Business records are **not hard-deleted** by the application. A
  `deleted_at timestamptz` / `deleted_by` marks logical deletion; default
  views filter it out.
- Actual physical removal happens **only** through the retention job (`04`)
  after the lawful period expires, run by the restricted retention role,
  and is audited.
- DELETE grant is revoked from the application role on business tables to
  make this enforceable, not merely conventional.

### Immutability of issued financial documents

- Documents have a `status` (`draft`, `issued`, `cancelled`,
  `superseded`). `draft` is mutable. On transition to `issued`, the row and
  its line items are **frozen**: a trigger rejects UPDATEs to issued rows
  except the controlled status moves (`issued` -> `cancelled` /
  `superseded`).
- A change after issue does not edit the document; it creates a new version
  (see below). This covers Angebot, Auftrag, and Rechnung. An issued
  Rechnung is never altered.

### Versioning

- Versioned documents (Angebot, Rechnung) chain by
  `(document_group_id, version_no)`. The group id is stable across versions;
  each issue increments `version_no` and points `supersedes_id` at the
  prior. The current version is the highest `version_no` not `superseded`.
- Non-document entities that change legitimately (e.g. an Auftraggeber's
  address) rely on `audit_log` for history rather than a version chain.

### Number allocation (Nummernkreise)

Each tenant sets its own scheme per document type via `nummernkreis`, so a
firm can continue the numbering its previous software used (`start_offset`),
reset yearly or monthly, or run continuously.

- **Gapless types (Rechnung).** German invoice numbers are expected to run
  without unexplained gaps. A plain Postgres sequence is unsuitable because
  it gaps on rollback. Instead the counter row is locked
  (`select ... for update` on the `nummernkreis` row), incremented, and the
  number assigned **inside the same transaction that issues the document**,
  at the `draft -> issued` transition, never at draft creation. A rolled-back
  issue therefore burns no number.
- **Non-gapless types (Angebot, Auftrag).** Same mechanism, but gaplessness
  is not legally required, so the lock can be released earlier if contention
  matters.
- **Kundennummer** may be assigned by the same allocator or set manually on
  carryover; uniqueness is enforced by `unique (tenant_id, kundennummer)`
  regardless.
- Allocation events are audited. The format and reset policy are read from
  config at allocation time, never hardcoded.

-----

## Concurrency and locking

The app is multi-user per tenant. Several people legitimately touch one
Baustelle at once: one records Aufmaß, another logs hours, another preps the
Angebot. So locking is at the level of the **editable aggregate**, never the
whole project. Locking a whole project would block that normal parallel work
and is wrong for this domain.

Two layers, and the second leans on the first:

### Optimistic concurrency (always on, the correctness floor)

- Every mutable business row carries `row_version int`. A write is
  conditional on the version that was read; if the row changed underneath,
  the write is rejected with a conflict and the client re-reads.
- This guarantees no silent overwrite even when a soft lock is absent, lost,
  or overridden. Issued financial documents are already frozen (see
  Immutability), so this matters for drafts and mutable entities.

### Advisory edit leases (the "it is locked" experience)

- When a user opens an editable aggregate (an Angebot with its LV, an Aufmaß
  sheet with its entries, a Bestellung) the app takes a lease in `edit_lock`:
  `(tenant_id, resource_type, resource_id, owner_user_id, acquired_at,
  expires_at)`, unique on `(tenant_id, resource_type, resource_id)`.
- Others see the aggregate read-only with "in Bearbeitung von X". The lease
  is renewed by heartbeat while the editor is open and **auto-expires** after
  a short idle timeout, so a closed laptop never locks a record forever.
- Release on save, on close, on expiry, or by an admin override. Overrides
  are audited.
- The lease is advisory: it shapes the UX and prevents collisions, but the
  optimistic-concurrency check above is the hard guarantee underneath.

### Granularity

- Lockable aggregates: Angebot (plus positions), Aufmaß sheet (plus entries),
  Bestellung.
- A user's own Arbeitszeit and Fahrt entries are personal, so contention is
  rare and optimistic concurrency alone covers them; no soft lock.
- `edit_lock` rows are per tenant and isolated by RLS like everything else.

-----

## Entity catalog

Grouped by area. Each lists purpose, the columns that carry meaning, and key
relationships. Standard audit/tenant/timestamp columns are implied on every
business table and not repeated.

### Identity and tenant config

- **tenant**: the firm. `id`, `name`, legal identifiers, status. Root of
  isolation.
- **tenant_tax_profile**: per-tenant regulatory state the engines branch on
  (`01`). `tenant_id`, `kleinunternehmer bool`, `ust_treatment` (regelbesteuert
  / kleinunternehmer), `ust_idnr`, `steuernummer`, `turnover_band` (drives
  the e-invoice sending date: >=800k -> 2027, <800k -> 2028),
  `einvoice_issue_required_from date` (derived, stored for auditability).
  v1 row: not Kleinunternehmer, regelbesteuert, band >=800k.
- **app_user**: `tenant_id`, identity, `role`, status. Actor in `audit_log`.
- **role / permission**: RBAC, detailed in `09`.
- **nummernkreis**: per-tenant, per-document-type numbering config (`08`'s
  invoicing and `05`'s projects/orders draw from it). `tenant_id`,
  `doc_type` (rechnung / angebot / auftrag / projekt / auftraggeber),
  `format` (template with prefix, optional year/month token, zero-padding
  width, separators), `reset_policy` (`none` / `yearly` / `monthly`),
  `counter` (current value), `start_offset` (to continue a sequence carried
  over from prior software), `gapless bool`. See Number allocation below.
- **tenant_setting**: per-tenant operational configuration the modules read
  instead of hardcoding. Typed keys, audited on change. Covers module
  toggles (`time_tracking`, `mileage_tracking` on/off, gating whole modules
  in UI and API), approval granularity (`05`), material costing method
  (`05`), the `abnahme_mode` (structured / simple, `05`), and reminder
  horizons (e.g. Gewährleistung expiry). Feature toggles and operational
  defaults live here, not in code.

### Parties

- **auftraggeber**: the firm's client (`00` terminology). `tenant_id`,
  `kundennummer` (typed, `unique (tenant_id, kundennummer)`, settable,
  carried over from prior software), `typ` (privat / gewerblich /
  oeffentlich), name, `ust_idnr` (for gewerblich/B2B), addresses, default
  payment terms. The `oeffentlich` flag plus B2G drives XRechnung on the
  billing side (`01`).
- **kontakt**: people at an Auftraggeber. `auftraggeber_id`, name, role,
  channel details.

### Project spine (detailed in `05`)

- **projekt** (Baustelle): the unit everything attaches to. `tenant_id`,
  `auftraggeber_id`, `nummer`, name, site address, `status`, `regime`
  (BGB / VOB, drives the Gewährleistung term), `abrechnungsart`
  (einheitspreis / pauschal, drives the Schlussrechnung billing rule in
  `06`), dates.
- **abnahmeprotokoll**: the acceptance record (structured mode, `05`).
  `projekt_id`, `abnahme_datum`, `art` (förmlich / fiktiv / konkludent for
  VOB/B; BGB equivalent), accepting person, `vorbehalte` (reservations),
  signed protocol as a `document`. Present only when `abnahme_mode` is
  structured; in simple mode the project carries `abnahme_datum` plus an
  attached document instead.
- **mangel**: a defect, hanging off an Abnahmeprotokoll. `abnahmeprotokoll_id`,
  description, location, severity, `frist` (remedy deadline), `status`
  (offen / behoben / abgelehnt), `behoben_am`. Same shape can later carry
  warranty-period defects; v1 scopes it to Abnahme.
- **gewaehrleistung**: warranty tracking per project/Auftrag. `projekt_id`,
  `regime` (VOB/B vs BGB), `start`, `frist_ende` (computed), status. Queryable
  for expiry (`01`, `05`).

### Catalog

- **leistungskatalog** / **leistung**: the firm's own priced services that
  LV positions are matched against (`06`). `tenant_id`, code, `kurztext`,
  `langtext`, `einheit`, current `einheitspreis`, active flag. Price changes
  are versioned/audited so historical quotes remain reconstructable.

### Tendering and quotation (detailed in `06`)

- **angebot**: a quotation. `tenant_id`, `auftraggeber_id`, `projekt_id`,
  `angebotsnummer` (`unique (tenant_id, angebotsnummer)`), `status`,
  `document_group_id`, `version_no`, `supersedes_id`, totals (committed by
  the engine), tax treatment snapshot (from tax profile at issue).
- **lv** (Leistungsverzeichnis): the bill of quantities, per Angebot or
  per incoming tender. `angebot_id` nullable (a received tender may exist
  before a quote), source (`gaeb` / `pdf` / `manual`), `gaeb_artifact_id`.
- **lv_position**: `lv_id`, `oz` (Ordnungszahl), `kurztext`, `langtext`,
  `menge`, `einheit`, `einheitspreis`, `gesamtpreis` (engine-computed),
  `matched_leistung_id`, `match_confidence`, `match_status`
  (auto / review / confirmed). Low confidence is queued, never auto-priced
  (`00`).
- **gaeb_artifact** / **document** reference: the original GAEB/PDF kept
  unaltered (`04`).

### Aufmaß (detailed in `07`; shape reserved here)

The schema must already hold what `07` produces, per `00`.

- **aufmass**: a measurement session/sheet. `tenant_id`, `projekt_id`,
  `erfasst_von`, `erfasst_am`, `quelle` (`foto` / `voice` / `manual`),
  `source_document_id` (the photo). Free-form layout is expected; structure
  comes from the entries, not the sheet grid.
- **aufmass_entry**: one measured thing. `aufmass_id`, `bauteil` (label,
  may be low-confidence), `expression` (jsonb: the parsed formula tree with
  operands, operator, multipliers), `candidate_readings` (jsonb: alternative
  glyph reads for reconciliation), `written_result`, `computed_result`,
  `reconciled bool`, `confidence`, `source_crop_ref`, `lv_position_id`
  (nullable link back to the position it fills), `review_status`. This is
  the home for the expression-tree + candidate + crop + confidence design
  from the OCR discussion.

### Orders and materials (detailed in `05`)

- **lieferant**: supplier. `tenant_id`, name, identifiers, terms.
- **bestellung**: order. `tenant_id`, `projekt_id`, `lieferant_id`, status,
  dates, totals.
- **bestellposition** / **material**: line items and the material master.

### Time and mileage (detailed in `05`, employee-data rules in `09`)

- **arbeitszeit**: working-time record. `tenant_id`, `app_user_id`,
  `projekt_id`, `start`, `ende`, `dauer` (computed), `art`. Tamper-evident
  via the standard audit path (`01`, min 2-year retention). Captured start/end,
  not a free total.
- **fahrt**: trip/mileage at the job level (`01`, `09`). `tenant_id`,
  `app_user_id`, `projekt_id`, `datum`, `von`, `nach`, `km`, `fahrzeug_id`,
  `zweck`. Not continuous location tracking.
- **fahrzeug**: vehicle master.

### Billing (detailed in `06`)

- **rechnung**: invoice. `tenant_id`, `auftraggeber_id`, `projekt_id`,
  `rechnungsnummer` (`unique (tenant_id, rechnungsnummer)`, gapless per
  legal requirement), `status`, version chain, tax treatment snapshot,
  totals, `einvoice_format` (xrechnung / zugferd / sonstige), `einvoice_artifact_id`.
- **rechnung_position**: line items, traceable to LV positions / Aufmaß /
  catalog.

### Documents and archive (detailed in `04`)

- **document**: every original-format artifact (incoming e-invoice XML,
  outgoing XRechnung XML, GAEB files, Aufmaß photos, signed PDFs).
  `tenant_id`, `kind`, `content_hash`, object-store ref, `retention_class`
  (8 / 10 / 6 year per `01`), `retention_until` (computed), `original_format`
  flag. Originals are immutable; deletion only via the retention job.

-----

## Relationship overview

- `tenant` 1-* everything.
- `auftraggeber` 1-* `projekt`; `projekt` 1-* (`aufmass`, `bestellung`,
  `arbeitszeit`, `fahrt`, `angebot`, `rechnung`, `gewaehrleistung`).
- `angebot` 1-1 `lv` (typical) ; `lv` 1-* `lv_position`.
- `lv_position` *-1 `leistung` (the match), nullable until confirmed.
- `aufmass` 1-* `aufmass_entry`; `aufmass_entry` *-1 `lv_position`
  (nullable; the residual human-review link).
- `rechnung` *-1 `projekt`; positions trace to `lv_position` / `aufmass_entry`
  / `leistung`.
- Every immutable original hangs off `document` with a retention class.

-----

## Resolved decisions (were open questions)

1. **Rechnungsnummer / numbering**: per-tenant configurable Nummernkreis
   (continuous, yearly, or monthly reset), able to continue a carried-over
   external sequence via `start_offset`. Gapless types allocate under a row
   lock at issue time. See Number allocation above.
2. **Received tender vs Angebot**: modelled as an `lv` with no `angebot`
   until the firm decides to quote. No separate `ausschreibung` entity in
   v1. Revisit only if `06` needs tender-level state the `lv` cannot carry.
3. **Leistungskatalog history**: reconstructed from `audit_log` rather than
   a dedicated price-history table. Promote to a history table only if quote
   reconstruction needs frequent point-in-time price reads.
4. **Tenant tax profile derived dates**: computed and stored on
   turnover-band change (write time), with an audit entry, not recomputed on
   read.
