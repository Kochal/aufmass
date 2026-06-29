# 09 - Security, Identity, and DSGVO Operations

Who can do what, how the inbound path is secured, how keys are held, and how
the firm meets its DSGVO duties. This directive resolves the forward
references the others leave here: inbound access control (`03`), key custody
(`04`), the erasure-versus-retention workflow (`04`), the Betriebsrat angle
(`01`, `05`), RBAC detail (`02`), AVV with processors (`01`, `03`, `08`), and
the Verfahrensdokumentation (`01`).

Audience: you (Claude Code) and any human contributor.

> Not legal advice (the `01` caveat carries here too). Thresholds and duties
> below are the constraints we design to; material cases get confirmed with
> the firm's Datenschutz and legal advice.

## Changelog
- 2026-06-29: Voice recording compliance added: audio is personal data; Aufmaß
  recordings stored as immutable document per 01/04; form-fill audio transient
  (not stored); voice path is self-hosted (no new processor, no DPA needed);
  dictation is not biometric ID (not Art. 9). Betriebsrat angle flagged.
- 2026-06-28: Mistral Document AI added as a named processor (Aufmaß extraction).
  Processors section updated: DPA + no-training tier required per processor.
  See notes/aufmass/2026-06-28-mistral-document-ai-pivot.md.
- 2026-06-26: Residency tightened to EU/EEA (was "EU residency"); no substantive change —
  content was already correct. See notes/infra/2026-06-26-eu-eea-residency.md.
- 2026-06-22: Initial draft. Identity, RBAC, inbound access, secrets,
  lawful basis, employee data / Betriebsrat, data-subject rights,
  processors / AVV, Verfahrensdokumentation.

-----

## Identity and authentication

- `app_user` per tenant (`02`). After authentication the app sets
  `app.tenant_id` and `app.user_id` on the connection, which is what RLS and
  the audit trigger read (`02`). A request with neither set can touch nothing.
- **Office staff** authenticate via Microsoft Entra ID SSO (the firm is on
  M365, `08`), which keeps identity in one place. **Field workers** on phones
  may need a lighter path; this is an open question below.
- **MFA** on at least the privileged roles. Brute-force and rate limiting on
  the auth endpoint.

## Authorization (RBAC)

- `role` / `permission` (`02`), least privilege. A working role set to start,
  refined with the firm:
  - **Inhaber / Admin**: users, settings, Nummernkreise, tax profile, toggles.
  - **Büro**: Auftraggeber, projects, quotes, orders, invoices.
  - **Buchhaltung**: invoices, e-invoice, exports; read on the rest.
  - **Monteur / Geselle**: own time and mileage, assigned projects, Aufmaß
    capture; no pricing or invoicing.
- **Non-interactive roles** are separate and narrow: the migration role and
  the restricted retention role (`02`, `04`) are the only roles that bypass
  RLS or delete, and only for their defined jobs.

## Inbound access (resolving `03`)

The egress deny in `03` does not secure the inbound path; this does.

- **TLS everywhere**, no plaintext anywhere on the wire.
- **Exposure** through a VPN or a single hardened reverse proxy, not an open
  application port. On-LAN clients reach the server directly; remote clients
  (a Monteur at the Baustelle, the office from home) come through the
  VPN / proxy with authentication.
- Standard hardening: security headers, locked-down CORS, least-privilege
  service accounts, patched OS (the `03` update allowlist).

## Secrets and keys (resolving `04`)

- Encryption keys for backups, the WORM archive, and at-rest data are held in
  a secrets manager / KMS, never in code or config files.
- **Key custody is separate from the data it protects**: lost keys make a
  backup useless, so keys are backed up independently and access to them is
  itself restricted and audited.
- Rotation on a schedule; rotation does not strand older encrypted archives
  (retain the keys needed to read anything still under retention).

## Lawful basis and data minimisation

- **Customer data**: processed for contract performance (Art. 6(1)(b) DSGVO).
- **Employee data**: employment relationship and legal obligations (working
  time, `01`).
- **Minimisation** throughout: collect only what a purpose needs. The
  tracking toggles (`05`) exist partly to avoid collecting location-adjacent
  data a firm has no basis for.

## Employee data and the Betriebsrat (resolving `01`, `05`)

Time and especially mileage are monitoring-adjacent, so they get specific
care:

- **Co-determination.** Where a Betriebsrat exists, introducing a system
  capable of monitoring employee behaviour or performance is
  mitbestimmungspflichtig (Section 87(1) No. 6 BetrVG). Time and mileage
  tracking are not enabled for such a tenant until a **Betriebsvereinbarung**
  is in place.
- **Without a Betriebsrat**, the duties remain: a legal basis, transparency
  (employees are informed what is recorded and why), purpose limitation, and
  no covert surveillance.
- **Mileage stays job-level** (`05`), never continuous location capture, and
  defaults **off** until the above is satisfied. The `mileage_tracking` /
  `time_tracking` toggles (`02`) are gated on these controls existing, not
  merely on someone flipping a switch.

## Data-subject rights and erasure-vs-retention (resolving `04`)

- Supported rights: access (Auskunft, Art. 15), rectification, erasure
  (Art. 17), restriction (Art. 18), portability. Auskunft means a data
  subject's personal data can be assembled and exported across entities.
- **The collision** `04` flags: an erasure request against a record still
  under an 8 or 10-year retention duty cannot simply delete it. The rule:
  - identify whether the record is under a retention class (`02` `document` /
    `04`);
  - if so, **restrict** the personal data (Einschränkung der Verarbeitung)
    rather than delete, so it is retained but no longer used;
  - the retention job (`04`) removes it once `retention_until` passes.
- This directive owns the decision logic (under retention or not, what
  restriction blocks) and the request workflow (receive, verify the
  requester, action, log). `04` provides the restrict-then-delete mechanism.

## Processors and AVV (resolving `01`, `03`, `08`)

A processor appears here only when: EU/EEA residency is confirmed in writing,
a signed **DPA / AVV** is in place, and a **no-training tier** (data is not
used to train the provider's models) is confirmed in writing. The processor
must not appear on the `03` egress allowlist without all three.

- **Hosting provider** (Hetzner or equivalent): AVV in place. Hosts hardware
  only; does not perform model inference.
- **Microsoft / M365** — mail and calendar (`08`): AVV in place, EU/EEA
  residency, no-training tier confirmed. Microsoft does not receive extra
  customer data beyond what is inherent in M365.
- **Mistral AI** — Aufmaß extraction (`07`, `07a`): DPA + no-training tier
  required before first production call. EU-headquartered (no CLOUD Act
  exposure). Handwritten Aufmaß images are submitted; no other customer data
  is sent. **Status: DPA pending sign-off** — see
  `notes/aufmass/2026-06-28-mistral-document-ai-pivot.md`.
- A **Verzeichnis von Verarbeitungstätigkeiten** (record of processing
  activities, Art. 30) and the technical/organisational measures (TOMs) are
  maintained as part of the documentation set below. Each named processor
  above must appear in the Verzeichnis once its DPA is in place.

## Voice recording compliance

Voice recordings (Aufmaß dictation and general voice form-fill) are **personal
data** under DSGVO. Handling rules:

- **Aufmaß recordings** (`07b`): stored as immutable `document` records
  (`quelle=voice`, `source_document_id`). Retained per `01`/`04` — the audio
  is the traceable source of a billing-feeding measurement, so it is an original,
  not transient. It appears in the Verzeichnis as a processing activity.
- **Form-fill audio** (`10` voice input): transient. The audio blob is sent to
  the backend, processed to extract an intent (field + value), and discarded.
  No audio is stored, so no retention obligation applies to the audio itself.
  The resulting field value is stored in the relevant business record as normal.
- **Self-hosted = egress-free**: Whisper ASR and the voice structuring model
  are self-hosted (`03`, `07b`). No audio, transcript, or derived value leaves
  the firm's EU/EEA server. The voice path adds **no new named processor** and
  requires **no new DPA** — a materially lighter compliance posture than the
  Mistral vision path.
- **Not biometric data**: voice capture is dictation, not voiceprint
  identification. The audio is not stored as a biometric template and is not
  used for speaker recognition or any Art. 9 special-category processing. The
  firm's Datenschutz should confirm this characterisation if customers (not just
  employees) are routinely audible on recordings.
- **Betriebsrat angle**: recording employees at the Baustelle may require a
  Betriebsvereinbarung if a Betriebsrat exists (`09` open question 3). The same
  gate that applies to time/mileage monitoring applies here — the voice-capture
  feature should not be enabled for a tenant until the co-determination status
  is confirmed.

## Verfahrensdokumentation (resolving `01`)

- GoBD requires written documentation of how the system captures, processes,
  and stores records, retained 10 years (`01`). It is a living deliverable,
  not an afterthought, and it folds in: the data model (`02`), the
  process descriptions (`05`, `06`, `07`), the backup / restore runbook
  (`04`), and the DSGVO records above.
- Kept current as directives change; a material design change updates it the
  same way it updates a directive.

## Security logging

- Business-data changes are in `audit_log` (`02`). **Security events**
  (logins and failures, permission and role changes, key access, lease
  overrides, retention-job runs) are logged too, distinct from business
  audit, and retained for review.

-----

## Open questions

1. **Field-worker auth**: Entra SSO for everyone, or a lighter credential for
   Monteure on shared / personal phones? Drafted as SSO for office, open for
   field.
2. **MFA scope**: privileged roles only, or all users? Drafted as privileged
   roles at minimum.
3. **Betriebsrat present?**: a per-tenant fact that decides whether a
   Betriebsvereinbarung gates the tracking toggles. Unknown for the v1 firm;
   confirm.
4. **Datenschutzbeauftragter (DPO)**: German firms need one at roughly 20+
   persons constantly processing personal data (Section 38 BDSG). The v1
   firm may be under the threshold; confirm per tenant rather than assume.
5. **Security review cadence**: penetration test / review schedule before and
   after go-live. Drafted as unset.
