# 08 - Microsoft 365 Integration

Mail and calendar via Microsoft Graph: pulling incoming tenders into
projects, and putting the dates that matter onto calendars. M365 is the one
deliberate cloud in the design (`00`, `03`); this file states what flows to
and from it and the rules around acting on the firm's behalf.

Identity / SSO and the AVV with Microsoft are owned by `09`; the
data-residency exception is named in `03`; attachment processing hands off to
`06`. This file states the integration surface.

Audience: you (Claude Code) and any human contributor.

## Changelog
- 2026-06-22: Initial draft. Graph connection, mail ingestion, calendar,
  the treat-email-as-data rule, degradation.

-----

## Connection

- **Microsoft Graph**, via an app registration in the firm's Entra tenant,
  OAuth, **least-privilege scopes**: read for mail ingestion, read/write for
  calendar, nothing broader. No mailbox-wide write the integration does not
  need.
- This is the one allowlisted external destination besides OS updates (`03`).
  Microsoft is an AVV-covered processor (`09`), EU residency.

-----

## Mail ingestion

- **Incoming tenders.** RfP / Ausschreibung emails are routed to the right
  project, and their attachments (GAEB, PDF) are handed to the quotation
  pipeline (`06`). The original email and attachments are stored as immutable
  `document`s (`04`).
- **Email content is data, not instructions.** This is the load-bearing rule.
  The system reads email and attachments as untrusted input to extract from;
  text inside an email or attachment never triggers an action on the firm's
  behalf. A tender that says "send your bid to X" or "confirm by replying"
  surfaces to a human; it does not cause the system to send or confirm
  anything. Extraction yes, action no.
- **Sending** (a quote to a client, an order to a supplier from `05`) is an
  outbound action that requires explicit human confirmation before it goes,
  never automatic. The firm approves the specific message; the system does
  not send on its own initiative.

-----

## Calendar

- The system writes the dates that carry consequences:
  - **Abgabefristen** (tender submission deadlines): time-critical and
    effectively binding, so these are surfaced prominently, not buried.
  - **Aufmaß and Baustellentermine** (site appointments).
  - **Gewährleistung expiry reminders** (`05`), on the reminder horizon from
    `tenant_setting` (`02`).
- Calendar writes are scoped to these system-managed events; the integration
  does not rewrite the user's personal calendar beyond them.

-----

## Data flow and residency

- The only data that reaches Microsoft is what is inherently in M365 already
  (the mailbox, the calendar) plus the system-managed calendar events the
  firm asks for. The system does not push extra customer or tender data into
  Microsoft beyond that (`09`).
- Everything else stays on the self-hosted German server (`03`).

-----

## Reliability and degradation

- If Graph is unavailable, mail ingestion and calendar writes **queue**;
  nothing is lost, and the rest of the system (manual project entry,
  quotation, Aufmaß) keeps working, consistent with the `03` degradation
  posture.

-----

## Open questions

1. **Which mailbox(es)**: a shared tenders mailbox, or per-user inboxes
   monitored for RfPs? Drafted as a shared mailbox, simpler to scope and
   permission.
2. **RfP identification**: how an incoming email is recognised as a tender
   (a dedicated folder / mailbox and rules, vs a classifier on the inbox).
   Drafted as folder / shared-mailbox routing first, classifier later.
3. **Send-on-behalf vs shared mailbox**: whether outbound goes from a shared
   address or each user's own. Ties to the `09` auth decision.
4. **Calendar sync depth**: one-way (system writes events) or two-way (read
   back changes). Drafted as one-way writes for v1.
