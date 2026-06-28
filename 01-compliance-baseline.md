# 01 - Compliance Baseline

The regulatory constraints that bind the rest of the system. These change
rarely and touch almost every module, so they live in one referenceable
place instead of being repeated. Other directives cite this one rather than
restating it.

This is the domain half of the non-negotiables in `00`. The schema (`02`),
the archive (`04`), the quotation engine (`06`), and the invoicing path all
inherit from here.

Audience: you (Claude Code) and any human contributor.

> Not legal advice. These are the constraints we design to. Material doubt
> on a specific obligation gets a note and, where it affects money or
> statutory records, confirmation from the firm's Steuerberater before we
> rely on it.

## Changelog
- 2026-06-22: Initial draft (bullet depth). Figures current as of mid-2026.
- 2026-06-22: E-Rechnung and tax status made per-tenant; Kleinunternehmer
  (Section 19 UStG) path added. v1 tenant is over 800k and not a
  Kleinunternehmer. Tenant tax profile defined in `02`.
- 2026-06-28: DSGVO section updated: self-hosting is one control, not the
  only one; named DPA-covered EU-native processors (M365, Mistral) are bounded
  exceptions. See notes/aufmass/2026-06-28-mistral-document-ai-pivot.md.

-----

## GoBD (how digital business records must be kept)

- **Unveränderbarkeit.** Records cannot be silently altered. No hard
  deletes of business records; soft-delete plus versioning plus an
  append-only audit trail (who, what, when). Drives schema-level design in
  `02`.
- **Nachvollziehbarkeit und Nachprüfbarkeit.** Every record is traceable
  and a third party (Betriebsprüfung) can follow it end to end.
- **Maschinelle Auswertbarkeit.** Records must be machine-evaluable and
  exportable for audit. This is why money- and law-bearing data is typed,
  not freeform (`00`, non-negotiable 5).
- **Original format for originally-digital documents.** A digital original
  is kept in its original form; a printout is only a copy. Drives `04`.
- **Verfahrensdokumentation.** GoBD itself requires written documentation
  of how the system captures, processes, and stores records. We maintain
  it as a deliverable; it is retained 10 years. Owned in `09`.

## Retention periods

- **8 years**: Buchungsbelege (Rechnungen, receipts, payment and delivery
  documents, Auftragsbestätigungen). Reduced from 10 by BEG IV.
- **10 years**: Jahresabschlüsse, Inventare, Bücher, and the
  Verfahrensdokumentation itself.
- **6 years**: ordinary business correspondence (e.g. an order email that
  is not itself a booking document).
- The clock starts at the end of the calendar year of the document's last
  entry. Retention rules and lawful deletion are enforced in `04`; until a
  period expires, deletion is blocked.

## E-Rechnung

Obligations are evaluated **per tenant**, from the tenant tax profile (`02`),
not assumed globally.

- **Receiving** structured e-invoices (EN 16931: XRechnung, ZUGFeRD >=
  2.0.1) has been mandatory for all firms since 1 Jan 2025, including
  Kleinunternehmer. v1 must receive, validate, visualise, and archive them.
- **Sending** (non-Kleinunternehmer): mandatory from 1 Jan 2027 for a
  tenant above 800,000 EUR prior-year turnover, and for all B2B from
  1 Jan 2028. Paper / PDF are "sonstige Rechnungen" only within the
  transition window and only with recipient consent. The binding date is
  derived per tenant from the turnover band on the tax profile.
- **Kleinunternehmer (Section 19 UStG).** Exempt from the obligation to
  *issue* e-invoices (Section 34a UStDV permits sonstige Rechnungen), but
  not from receiving them. Their invoices carry no USt and must bear the
  Section 19 note. The invoicing engine reads the tenant flag and suppresses
  VAT lines, adds the note, and relaxes the issuance requirement while still
  allowing e-invoice output.
- **B2G already requires XRechnung today.** Since B2G is in scope (`00`),
  the invoicing path supports XRechnung generation and EN 16931 validation
  from the start, regardless of the tenant's B2B sending date.
- **v1 tenant**: over 800k, not a Kleinunternehmer, so e-invoice sending
  binds from 2027 and full VAT handling applies. The other paths exist for
  future tenants.
- A PDF is no longer an e-invoice. The structured XML is the original and
  is archived as such (`04`).

## Arbeitszeiterfassung

- Recording working time (start, end, duration) is an employer duty
  following the 2022 BAG ruling. Construction carries heightened
  documentation duties (Mindestlohn record-keeping; short-deadline
  recording under the Schwarzarbeitsbekämpfung rules).
- Time records are kept at least 2 years and must be tamper-evident. The
  time module (`05`) writes through the same immutable/audited path as
  everything else.

## VOB and B2G

- Construction contracts run under VOB (A/B/C); tenders and awards
  reference it. The quotation and order flow (`06`, `05`) must accommodate
  VOB terms.
- **Prüfbares Aufmaß.** Public contracts can require auditable measurement.
  The Aufmaß module (`07`) keeps each figure traceable (formula, result,
  source crop, confidence) and supports a standardised digital quantity
  format on output (REB, VB 23.003) so measurements flow into VOB-conform
  Abrechnung.
- **Gewährleistung.** Warranty periods differ (VOB/B vs BGB for Bauwerke).
  Tracked per project so warranty expiry is queryable (`05`).

## DSGVO

- **EU-bounded processing is the control.** No customer or RfP data leaves
  the EU/EEA or reaches a processor without a signed DPA/AVV (`00`,
  decision 3). Self-hosting is one form of this control; named, DPA-covered
  EU-native model APIs (M365 / Graph for mail; Mistral Document AI for
  Aufmaß) are the bounded, individually justified exceptions. Each named
  processor requires: EU residency confirmed, DPA/AVV in place, no-training
  tier confirmed in writing. Full list in `03`.
- **Data minimisation** across the board; personal data only where there is
  a legal basis.
- **Employee data is sensitive.** Working-hour and mileage records, and
  especially anything location-derived, carry heightened duties. If a
  Betriebsrat exists, such recording is co-determination-relevant
  (Section 87 BetrVG). Mileage is captured at the trip/job level, not as
  continuous location surveillance. Detailed handling in `09`.

-----

## What this binds (quick map)

| Constraint                         | Lands in                          |
|------------------------------------|-----------------------------------|
| Immutability, audit, typed data    | `02` schema, all write paths      |
| Retention periods, lawful deletion | `04` archival                     |
| Original-format archival           | `04`                              |
| E-Rechnung receive/send/validate   | `06` quotation/invoicing          |
| Arbeitszeiterfassung               | `05` time module                  |
| Prüfbares Aufmaß, REB output       | `07` Aufmaß                       |
| VOB terms, Gewährleistung          | `05`, `06`                        |
| AVV, EU residency, employee data   | `09` security/DSGVO               |
| Verfahrensdokumentation            | `09`, maintained as a deliverable |
