# 2026-06-26 — Residency widened: German server → EU/EEA (whole stack)

/ area: infra / status: decided / confidence: high on DSGVO; normal on §146 AO procedural step /

## Decision

The self-hosted infrastructure constraint has been widened from "must run on a German server"
to "must run in the EU/EEA." This covers the whole stack: database, application, object store,
and model servers. There is no Germany-specific pin any more.

**Driver**: the GPU host for the `07` vision model is being provisioned on a European server
that is not specifically in Germany.

**Boundary chosen: EU/EEA only.** This includes the 27 EU member states plus Norway, Iceland,
and Liechtenstein. It excludes the UK, Switzerland, and other "adequacy" third countries. Staying
within EU/EEA means no Standard Contractual Clauses or adequacy decisions ever enter the picture,
and the `09` guarantee — "SCCs only if any transfer leaves the EU/EEA; the design avoids that" —
remains true without qualification.

## What is unchanged

- **Self-hosting.** The model serves run on firm-controlled machines. No customer, tender, or price
  data goes to a third-party model API. This is `00` decision 3 and is not loosened by the location
  change.
- **Egress-deny rule.** The `00`/`03` principle that no business data leaves the self-hosted stack
  (other than the deliberate M365 exception) is unchanged.
- **AVV.** An AVV with the EU/EEA hosting provider is still required (`01`, `09`).
- **DSGVO posture.** Intra-EU/EEA data transfers do not require SCCs or adequacy findings. The
  `09` "transfer leaves the EU/EEA → design avoids it" guarantee holds.

## Directives updated (changelog lines added to each)

`00`, `03`, `04`, `06`, `08`, `09`, `10`, `99`. `CLAUDE.md`, `README.md`, `validator/README.md`.

## Flagged for the firm's Steuerberater — do not decide here

Under **§ 146 Abs. 2a AO**, electronic bookkeeping records (GoBD-relevant data) hosted
**outside Germany but within the EU** are generally permitted, but the firm must notify or
apply to the competent Finanzamt before moving to a non-German EU/EEA host. If the database
(which will eventually hold GoBD-relevant records: Rechnungen, Arbeitszeitnachweise, Aufmaße)
runs on a non-German EU/EEA server, that procedural step must be cleared before the system
holds real bookkeeping data. This note flags it; only the firm's Steuerberater can confirm
whether and how to notify.

The firm's **records-retention obligations** (GoBD 8/10/6-year retention, Arbeitszeitgesetz)
remain under German law regardless of where the server sits.

## What would invalidate this decision

Choosing a "European" host outside EU/EEA (e.g. UK post-Brexit or Switzerland) would reopen
the SCC/adequacy question and break the `09` guarantee. The residency rule must be enforced
at hosting-provider selection, not just at design time.
