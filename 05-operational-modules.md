# 05 - Operational Modules (the spine)

The day-to-day spine the rest of the system hangs on: projects, parties,
orders and materials, working time, mileage, and warranty tracking. This is
what gives quotation (`06`) and Aufmaß (`07`) something to attach to, which
is why it is built first.

This directive states the lifecycles, the events that matter, and the rules
each module follows. The tables already live in `02`; the regulatory
constraints in `01`; employee-data and DSGVO handling in `09`. This file
does not restate those, it points to them.

Audience: you (Claude Code) and any human contributor.

## Changelog
- 2026-06-22: Initial draft. Project lifecycle, parties, orders, time,
  mileage, warranty.
- 2026-06-22: Tracking modules made optional per tenant; approval
  granularity and material costing made per-tenant settings; multi-user
  edit-lease behaviour referenced from `02`.
- 2026-06-22: Abnahme resolved: structured Abnahmeprotokoll with Mängel list
  (default) plus an `abnahme_mode` toggle for simple date-plus-document.

-----

## Projekt (Baustelle): the central entity

Everything operational attaches to a `projekt`. Its lifecycle is the
backbone; other modules react to its state transitions.

### States

```
angelegt -> kalkulation -> beauftragt -> in_ausfuehrung
         -> abgenommen -> abgerechnet -> gewaehrleistung -> abgeschlossen
```

Side states: `pausiert` (re-enters the prior state), `storniert` (terminal,
audited with reason). Transitions are audited; backward moves require a
reason.

- **angelegt**: project created, Auftraggeber and site known.
- **kalkulation**: an Angebot is being prepared (`06`). The project may sit
  here through several Angebot versions.
- **beauftragt**: the firm has an Auftrag. The contract regime (BGB or VOB)
  is fixed here and drives the Gewährleistung term (see Warranty).
- **in_ausfuehrung**: work running. Time, mileage, material orders, and
  Aufmaß accrue against the project.
- **abgenommen**: the pivotal event. **Abnahme** sets the acceptance date,
  starts the Gewährleistung clock, and unlocks the Schlussrechnung. Captured
  per the Abnahme and Mängel section below.
- **abgerechnet**: final invoice issued (`06`/`08`).
- **gewaehrleistung**: warranty period running; project otherwise dormant.
- **abgeschlossen**: warranty expired, project archived (records retained
  per `01`).

### What attaches

`auftraggeber` (one), and many of: `angebot`, `auftrag`, `aufmass`,
`bestellung`, `arbeitszeit`, `fahrt`, `rechnung`, `gewaehrleistung`,
`document`. A project number is allocated from the tenant Nummernkreis (`02`).

-----

## Abnahme and Mängel (defects)

Abnahme is the pivotal project event: it sets the acceptance date, starts
the Gewährleistung clock (Warranty below), and unlocks the Schlussrechnung.
How much structure is captured is a per-tenant choice via the `abnahme_mode`
toggle (`02`).

### Structured mode (default)

- An **abnahmeprotokoll** records the acceptance: date, `art` (VOB/B
  distinguishes förmliche, fiktive, and konkludente Abnahme; BGB its own),
  the accepting person, any `vorbehalte` (reservations, e.g. Vertragsstrafe
  vorbehalten), and the signed protocol as an attached `document`.
- A **mangel** (defect) list hangs off the protocol: each carries a
  description, location, severity, a `frist` to remedy, and a status (`offen`
  / `behoben` / `abgelehnt`) with `behoben_am`. These are the records the
  firm leans on in a later Gewährleistung claim.
- Open defects can qualify the Abnahme (Abnahme unter Vorbehalt) and stay
  trackable until closed.

### Simple mode (toggle)

- Just `abnahme_datum` on the project plus an attached signed document, no
  defect list. For firms that track defects on paper or do not need them in
  the system.

Either way, `abnahme_datum` is what drives the Gewährleistung clock, so
Warranty does not care which mode is in use.

-----

## Auftraggeber and Kontakt

CRUD over the firm's clients (`00` terminology: the firm is the tenant, the
Auftraggeber is its client).

- **Kundennummer** is assigned from the Nummernkreis or entered manually on
  carryover; unique per tenant (`02`). It prints on every Angebot and
  Rechnung.
- **typ** (`privat` / `gewerblich` / `oeffentlich`) carries downstream
  meaning: `gewerblich` expects a USt-IdNr and is B2B for the e-invoice
  sending timeline (`01`); `oeffentlich` is B2G and forces XRechnung on the
  billing side today (`01`).
- Address and contact changes are audited (`02`); history is reconstructable
  from `audit_log`, not a version chain.
- An Auftraggeber with open projects or unsettled invoices cannot be
  soft-deleted; the action is blocked and explained, not silently dropped.

-----

## Orders and materials

Material procurement against a project.

- **lieferant**: supplier master (CRUD).
- **material**: material master (description, unit, optional standard
  supplier and price). Reused across projects.
- **bestellung** lifecycle:

```
entwurf -> bestellt -> teilgeliefert -> geliefert
        -> storniert (audited, reason)
```

- An order optionally links to a `projekt` (some stock orders do not). Lines
  reference `material`.
- Sending an order to a supplier is an outbound action; if it goes out by
  email it routes through `08` and follows the send-confirmation rule there.
- **GoBD note**: an Auftragsbestätigung or a delivery document is a
  Buchungsbeleg (8-year retention, `01`). Such originals are stored as
  `document` with the right retention class, not just as a status flag.

-----

## Working time (Arbeitszeit)

Captures actual worked time per user per project.

- **Optional module, with a caveat.** Working-time tracking is gated by the
  `time_tracking` tenant toggle (`02`). But disabling the in-app module does
  not remove the firm's legal duty to record working time (`01`); it only
  means the firm records it elsewhere. The toggle controls this app's
  feature, not the obligation.
- **Capture model**: explicit `start` and `ende` (and break handling), not a
  free-entered total. Duration is derived. This matches the construction
  recording duties in `01` (start, end, duration; short deadline; min
  2-year retention).
- **Corrections** are made through an audited correction flow with a reason,
  never a silent edit. Once a period is approved for payroll handoff
  (**Freigabe**), entries in it are frozen the way issued documents are
  (`02`); a later fix creates an audited correction, it does not rewrite the
  approved record.
- **Handoff**, not payroll: we export approved hours; we do not run payroll
  (`00` non-goal).
- Employee-data lawfulness, transparency, and the Betriebsrat angle live in
  `09`. This module assumes those controls exist; it does not define them.

-----

## Mileage (Fahrten)

Trip-level distance capture, deliberately not continuous location tracking
(`01`, `09`).

- **Optional, off by default.** Mileage tracking is gated by the
  `mileage_tracking` tenant toggle (`02`) and defaults **off** until the
  tenant has a lawful basis (and, where a Betriebsrat exists, an agreement),
  per `09`. A firm that does not want it never sees it.
- A **fahrt** records `datum`, `von`, `nach`, `km`, `fahrzeug`, `zweck`, and
  links to a `projekt` where applicable. Entered per trip by the user.
- **fahrzeug** is a small master (plate, type, optional whether the vehicle
  is also privately used, which is what would make a Fahrtenbuch relevant on
  the tax side).
- Distances support reimbursement / Reisekosten and project costing. The
  module records facts; it does not compute tax treatment, which is a
  downstream/Steuerberater concern.
- Approval mirrors working time: an approved trip is frozen, corrections are
  audited.
- Privacy posture (job-level granularity, legal basis, no surveillance
  pattern) is owned by `09`; this module must not introduce always-on
  location capture.

-----

## Warranty (Gewährleistung)

Tracked per project so expiry is queryable (`01`).

- The clock starts at **Abnahme** (the project event above), not at invoice.
- **Term by regime**, taken from the contract type fixed at `beauftragt`:
  - VOB/B: commonly 4 years for Bauwerk-related work.
  - BGB: commonly 5 years for work on a Bauwerk.
  These are defaults; the exact classification (is this work "an einem
  Bauwerk"?) can vary, so `frist_ende` is computed from a per-project term
  that defaults by regime and can be overridden, with material doubt
  confirmed legally (`01` caveat).
- `frist_ende` is computed and stored; the system surfaces upcoming
  expiries (a reminder horizon, e.g. 90 days) so the firm can act before
  warranties lapse.
- A project in `gewaehrleistung` retains all its records until expiry, then
  moves to `abgeschlossen` under the retention rules (`01`, `04`).

-----

## Cross-cutting behaviour (inherited, not redefined)

Every module here obeys the `02` patterns rather than its own:

- Tenant isolation via RLS on every row.
- Every write audited via the append-only trigger path.
- No hard deletes; soft-delete only, physical removal only via the
  retention job (`04`).
- Money- and law-bearing fields are typed columns; the deterministic layer
  owns any calculation (`00`).
- Originals (order confirmations, delivery notes, signed Abnahme protocols)
  are stored as `document` with a retention class, not flattened into a
  status.
- Multi-user per tenant is the norm. Editing an aggregate (Angebot, Aufmaß
  sheet, Bestellung) takes an advisory edit lease and runs under optimistic
  concurrency, both defined in `02`. Locking is per aggregate, never the
  whole project, so several people can work one Baustelle at once.

-----

## Resolved decisions (were open questions)

- **Stundenzettel approval granularity**: a per-tenant setting (`02`
  `tenant_setting`). Default stays per user per week.
- **Material costing**: a per-tenant setting. Default stays order price.
- **Tracking modules optional**: time and mileage tracking are per-tenant
  toggles (`02`); mileage defaults off (`09`), time stays subject to the
  legal duty noted above.
- **Abnahme capture**: both modes supported. Structured Abnahmeprotokoll with
  a Mängel list is the default; the `abnahme_mode` toggle (`02`) switches to
  simple date-plus-document. See Abnahme and Mängel above.

## Open questions

None outstanding for 05.
