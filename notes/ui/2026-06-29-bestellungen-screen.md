---
date: 2026-06-29
area: ui
---

# Bestellungen screen (Lieferant, Material, Bestellung, Bestellposition)

## What was built

Three master-data and transaction screens covering directive 05 "Orders and
materials".

### LieferantList (`/office/lieferanten`)

Simple CRUD. Table: Name, USt-IdNr (mono), Zahlungsziel in Tagen.
Create/Edit dialogs; soft-delete with confirm (warns that existing Bestellungen
are retained).

### MaterialList (`/office/material`)

Material catalog. Table: Bezeichnung, Einheit, Standard-Lieferant (resolved from
lieferant cache), Standardpreis (de-DE). Create/Edit dialogs with:
- Standard-Lieferant select from Lieferanten list
- Standardpreis optional numeric
Soft-delete; warns that existing Bestellpositionen are retained.

### BestellungList (`/office/bestellungen`)

Order list with status filter (all 5 statuses) and Projekt filter, both
server-side. Table: Lieferant, Projekt, Bestelldatum, Summe, Status badge,
Details link. Create dialog navigates directly to BestellungDetail on success
so the user can add positions immediately (same pattern as MangelList →
MangelDetail). Status badges: entwurf gray / bestellt blue / teilgeliefert
orange / geliefert green / storniert red.

### BestellungDetail (`/office/bestellungen/:id`)

Two-section page: header card + positions table.

**Header card (BestellungHeader)**:
- Read mode: Lieferant, Projekt, Bestelldatum, Summe, Status badge.
- Edit mode (visible while non-terminal): PUT /{id} with row_version.
- Status lifecycle buttons: forward transitions only per NEXT_TRANSITIONS map.
  - entwurf → [bestellt]
  - bestellt → [teilgeliefert, geliefert]
  - teilgeliefert → [geliefert]
  - geliefert / storniert → [] (terminal, no buttons)
- Stornieren button (non-terminal only): opens StornierenDialog with a free-text
  reason field. PATCH /{id}/status with `reason` → `set_reason(conn, body.reason)`
  in the router → written to `audit_log.reason` by the existing audit mechanism.
- `auftragsbestaetigung_document_id`: displayed as a truncated UUID reference
  when set; not editable (upload deferred to directive 04 object store round,
  same policy as `protokoll_document_id` in Abnahmeprotokoll).

**Bestellpositionen table**:
- Columns: Pos.-Nr., Bezeichnung, Menge (with Einheit), EP (€), Gesamt (€).
- Gesamt = menge × einzelpreis, client-side display only. No server money math
  for Bestellpositionen (the directive says the deterministic engine owns money
  math for quotes/invoices; order positions are procurement records, not priced
  outputs).
- Summe row at the bottom (sum of all Gesamt values that have an EP).
- Add/Edit/Delete only shown when `bestellung.status ∈ {entwurf, bestellt}`.
  A helper text explains the restriction for other statuses.
- Add/Edit position dialog: optional Material lookup — selecting a material
  pre-fills Bezeichnung, Einheit, and Einzelpreis from the material master. All
  fields remain editable after pre-fill (the pre-fill is a convenience, not a
  binding reference; the `bezeichnung` column is described as a snapshot in the
  migration comment).

## Status lifecycle enforcement

The backend uses `set_reason()` which sets a session variable read by the audit
trigger. The frontend passes `reason: null` for forward transitions and the
user-entered string for Stornieren. The DB trigger enforces forward-only movement
(e.g. entwurf cannot jump to geliefert); the frontend only offers valid next
states to keep the UI honest, but relies on the server for enforcement.

## Material pre-fill vs. snapshot

`bestellposition.bezeichnung` is a snapshot — the migration comment says "in
case material text changes". The pre-fill copies the current material text into
the field; after that the position is independent. If the material master is
later updated, existing positions are not retroactively changed.

## GoBD note

Directive 05 states: "An Auftragsbestätigung or delivery document is a
Buchungsbeleg (8-year retention)." The `auftragsbestaetigung_document_id` FK
exists for this purpose. Until directive 04 document storage is wired, the
field is shown as a reference only. The Steuerberater must confirm that the
current paper-based AB retention practice is sufficient during the interim.

## Assumption

`summe` on Bestellung is user-entered (the order total as stated by the
supplier). It does not auto-derive from Bestellpositionen. Both exist in
parallel: `summe` is the supplier's stated total; position Gesamt values are
a cross-check. No server reconciliation between the two.
