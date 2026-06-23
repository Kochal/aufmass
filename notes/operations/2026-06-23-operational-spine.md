# 2026-06-23 — Implementing directive 05 (operational spine)

/ area: operations / status: implemented, migrations 0008–0014 / confidence:
high on mechanics, medium on a few rules flagged for the firm /

Directive 05 materializes the operational slice of `02`'s entity catalog and adds
the deterministic rules its lifecycles imply. Everything inherits the `02`
foundation via `core.register_business_table` — RLS, audit, soft-delete,
no-hard-delete, optimistic concurrency — so this note only records what is *new*.

## What was added

- `0008` `tenant_setting` (+ `core.get_setting` / `core.setting_bool`) and
  `document` (retention-classed originals; full archival is `04`).
- `0009` `projekt` (lifecycle state machine) + `kontakt`, plus reusable
  `core.linear_status_guard()` and `core._reason()`.
- `0010` `abnahmeprotokoll` + `mangel` (structured Abnahme mode).
- `0011` `gewaehrleistung` with a computed `frist_ende`.
- `0012` `lieferant`, `material`, `bestellung` (linear guard) + `bestellposition`.
- `0013` `fahrzeug`, `arbeitszeit`, `fahrt` with freeze-on-approval.
- `0014` the Auftraggeber soft-delete dependency guard.

## Decisions / assumptions, with reasoning

1. **Project numbers auto-allocate on insert** via a BEFORE INSERT trigger
   (`core.assign_projekt_nummer`) calling `core.allocate_number('projekt')` when
   `nummer` is null. Directive 05 says "allocated from the tenant Nummernkreis";
   doing it at creation matches "angelegt: project created" and keeps numbers
   off the application's critical path. A carried-over number can still be passed
   explicitly. Requires a `projekt` `nummernkreis` row per tenant (non-gapless).

2. **Lifecycle as a trigger, not application code.** `projekt` and `bestellung`
   transitions are validated in BEFORE UPDATE triggers so the rule holds on every
   path. Rules enforced: forward free; backward and cancellation require
   `app.reason`; the last main state and the cancel state are terminal; `projekt`
   additionally requires `abnahme_datum` to reach `abgenommen`, and `pausiert`
   remembers/resumes the prior state via a new `status_vor_pause` column.

3. **Derived values use STORED generated columns**, not money math:
   `arbeitszeit.dauer` = `end - start - break`, and `gewaehrleistung.frist_ende`
   = `start + frist_jahre`. These are time arithmetic (`02` itself lists `dauer`
   as computed), not the engine's money/price domain. `frist_jahre` defaults by
   regime (VOB 4y / BGB 5y) via a BEFORE trigger and is overridable.

4. **Freeze-on-approval** (`core.freeze_on_approval`, parameterised by the status
   column + frozen value) makes an approved `arbeitszeit`/`fahrt` immutable the
   way an issued document is. The transition *into* `freigegeben` is allowed; any
   later edit or soft-delete is rejected; corrections are new rows linked by
   `korrektur_von_id`. This is the directive's "audited correction, not a
   rewrite".

5. **Auftraggeber delete guard.** Soft-deleting an Auftraggeber with open
   projects (status not terminal) or unsettled invoices is blocked with an
   explaining error. **"Unsettled" = a `rechnung` in `draft`/`issued`** because
   payment state is not modelled yet — revisit when it is. (This is why
   `foundation_test`'s G5 was updated to soft-delete a dependency-free client.)

6. **Toggles are stored, not enforced in the DB.** `tenant_setting` holds the
   module toggles; *gating the modules in UI/API* is the app layer's job (05).
   The DB just stores and audits the settings and offers the accessors.

## For the firm's review (not decided by us)

- Warranty terms (4y VOB / 5y BGB) are defaults; the "an einem Bauwerk?"
  classification can change them — confirm legally for real projects (`01`).
- "Unsettled invoice" will need a real definition once payment/settlement is
  modelled.

## Verified

`tests/operations_test.sql` (26 checks) + `tests/foundation_test.sql` (22) both
pass via `tests/run.sh` on PostgreSQL 17 against a fresh DB: O1–O8 plus the
foundation guarantees, 48 assertions, exit 0. See
[[2026-06-23-cross-cutting-foundation]] for the inherited patterns.
