# 00 - Overview

Project: AI-native operations tool for a German Maler- und
Bodenbelagsbetrieb. Project management, Aufmaß capture, orders, quotations,
working hours, mileage, plus the records construction firms are obliged to
keep. AI reads RfPs and drafts quotations; deterministic code owns all
money math and validation.

Audience: you (Claude Code) and any human contributor.

This file is the entry point. It states scope, the locked decisions, the
one core principle the whole system obeys, and the non-negotiables. Read
`01-compliance-baseline.md` next; it binds the schema, the archive, and the
invoicing. Then the directive named for the area you are touching.

## Changelog
- 2026-06-22: Initial draft (bullet depth).
- 2026-06-23: Added locked decision 6 (polyglot application stack) and the
  `10-application-stack.md` map entry.

-----

## What we are building

- A single tool covering the firm's working life: Auftraggeber and
  projects, Aufmaß (on-site measurement) capture, material orders,
  quotation drafting against tendered bills of quantities, working-hour
  and mileage records, invoicing, and warranty tracking.
- The AI layer does two things only: read incoming RfPs (Ausschreibungen)
  and draft the quotation, and read handwritten Aufmaß sheets into
  structured measurements. Everything with a price, quantity, tax figure,
  or legal record attached is checked by deterministic code.
- v1 onboards one firm (Maler Berger). The data model is multi-tenant from
  day one regardless (see Locked decisions).

## Non-goals (v1)

- Full accounting / DATEV replacement. We produce GoBD-conform records and
  e-invoices and hand off, we do not run the books.
- Payroll. We record working hours; payroll is downstream.
- A public self-service product with customer-defined fields. Dropped for
  now (see Locked decisions).

-----

## Locked decisions

These are settled. Reopen only via a note plus a changelog line here.

1. **Email and calendar: Microsoft 365.** Graph API. No second provider in
   v1.
2. **Public-sector work (B2G) is in scope.** This forces XRechnung,
   prüfbare Aufmaße, and VOB-conform output from the start, not as a later
   bolt-on. See `01-compliance-baseline.md`.
3. **The LLM is self-hosted on a German server.** No customer or RfP data
   leaves to a third-party model API. Chosen for DSGVO and client trust.
4. **Single firm now, multi-tenant boundary from day one.** Every business
   row carries a tenant id; row-level security enforces isolation. v1
   onboards one firm. Retrofitting tenancy later is the one change we
   refuse to risk. *(Assumption pending your explicit confirmation; flagged
   in chat.)*
5. **Customer-defined fields: dropped for v1.** Everything with business or
   regulatory meaning is a typed core column.
6. **Application stack: polyglot, each language in its lane.** Python /
   FastAPI backend and deterministic engines, React + TypeScript browser PWA,
   exactly one Java instance (the KoSIT e-invoice validator, as a sidecar),
   Postgres as the calculation and integrity authority. See
   `10-application-stack.md`.

-----

## Core principle

**The LLM extracts and matches; deterministic code calculates and
validates.**

- The model turns unstructured input (an RfP PDF/GAEB file, a handwritten
  Aufmaß) into structured candidates with confidence and a traceable
  source (a GAEB position, an image crop).
- All arithmetic, pricing, tax, plausibility checks, and the final say on
  what is accepted live in deterministic code. The model never does math
  and never has the last word on a number.
- Low-confidence output is queued for a human, never silently accepted.
  Every accepted value is traceable back to its source.

-----

## Non-negotiables

1. **No money math in the model.** Einheitspreis x Menge, surcharges,
   Nachlass, MwSt, totals: deterministic engine only. A model-produced
   number is a candidate, never a committed value.
2. **Records are immutable and audited.** No hard deletes of business
   records. Soft-delete plus versioning plus an append-only audit trail of
   who changed what, when. This is a GoBD requirement, not a preference.
   See `01`.
3. **Digital originals are kept in original format.** E-invoice XML,
   received e-invoices, signed documents: archived unaltered for the full
   retention period. A rendered PDF is a copy, not the original. See `01`
   and `04`.
4. **Tenant isolation is enforced at the row level.** Every business row
   has a tenant id; access is filtered by row-level security, not by
   application code alone.
5. **Money- and law-bearing data is typed, not freeform.** Anything that
   feeds a price, quantity, tax figure, LV position, or statutory record is
   a typed column the deterministic layer and the audit can reason about.
6. **Every committed value is traceable to its source.** A quoted price
   traces to an LV position and a catalog entry; a measurement traces to a
   formula and an image crop. No orphan numbers.

-----

## Terminology (the words are overloaded; pin them here)

- **Tenant / the firm**: the Maler-/Bodenbelagsbetrieb using the tool.
  Maler Berger in v1. The unit of isolation.
- **Auftraggeber**: the firm's own client (private person, GU, public
  body). What a layperson calls "the customer".
- **Kundennummer**: the firm's own identifier for an Auftraggeber, settable
  and unique per tenant (firms carry over an existing range), printed on
  Angebot and Rechnung.
- **LV (Leistungsverzeichnis)**: the bill of quantities in a tender. Made
  of Positionen (OZ, Kurztext, Langtext, Menge, Einheit).
- **Leistungskatalog**: the firm's own catalog of priced services we match
  LV Positionen against.
- **Aufmaß**: on-site measurement of actual quantities. Feeds Mengen into
  positions and, for B2G, into prüfbare Abrechnung.
- **GAEB**: the German construction data-exchange format for LVs (.d8x/.x8x).
  D84 is the quote response.
- **Angebot / Auftrag / Rechnung**: quote / awarded order / invoice.

-----

## Directive map

| You want to know...                              | Look in...                          |
|--------------------------------------------------|-------------------------------------|
| What we are building, the locked decisions       | `00-overview.md` (this file)        |
| The regulatory constraints that bind everything  | `01-compliance-baseline.md`         |
| The data model and DB schema                     | `02-data-model.md`                  |
| The self-hosted infra and model serving          | `03-infrastructure.md`              |
| Backup, archival, disaster recovery              | `04-backup-archival.md`             |
| The operational spine (projects, orders, time)   | `05-operational-modules.md`         |
| RfP ingestion and the quotation engine           | `06-quotation-engine.md`            |
| Aufmaß capture and OCR                            | `07-aufmass-ocr.md`                 |
| Microsoft 365 integration                        | `08-m365-integration.md`            |
| Security, identity, DSGVO operations             | `09-security-dsgvo.md`              |
| The application stack and dev environment        | `10-application-stack.md`           |
| Current status and open issues                   | `99-status.md`                      |
| Why a method or choice was made                  | `notes/<area>/`                     |

Build order tracks the numbering: the operational spine (05) comes before
quotation (06) and Aufmaß (07), because both attach to a project and have
nothing to hang on without it. Directives 00 and 01 are written first
because 02 inherits retention, immutability, and audit straight from them.

When in doubt: directives for *what*, notes for *why*, code for *how*.
