---
date: 2026-06-29
area: ui
---

# Auftraggeber screen

## What was built

Two-page client management screen:

**AuftraggeberList** (`/office/auftraggeber`):
- Table: Kd.-Nr. (mono), Name (link to detail), Typ, Leitweg-ID
- "Neu anlegen" button → CreateDialog (name + typ; eas_scheme defaults to "EM")
- Empty state CTA

**AuftraggeberDetail** (`/office/auftraggeber/:id`):
- Three sections: Stammdaten (name, kundennummer, typ, ust_idnr), Adresse
  (strasse, adresszusatz, plz, ort, land), Rechnungsdaten (leitweg_id,
  elektronische_adresse, eas_scheme)
- Single "Speichern" button; saves address first (creates if new, updates if
  existing), then updates Auftraggeber with the adresse_id
- Soft-delete via Trash2 button → confirmation dialog → redirect to list

## Address upsert pattern

Auftraggeber has an `adresse_id` FK to a separate `adresse` row (normalised per
directive 02). The save mutation handles the two-step transparently:

1. If address fields have content and `adresse_id` is NULL → POST /api/adresse →
   capture new adresse_id
2. If `adresse_id` exists → PUT /api/adresse/{id} with existing `row_version`
3. PUT /api/auftraggeber/{id} with the resulting adresse_id

No address row is created for clients with no address content (e.g. contacts
entered only with a name). This matches the schema: `adresse_id` is nullable.

## Invoice-relevant fields (Rechnungsdaten section)

- `leitweg_id` (BT-10 Buyer Reference): mandatory for B2G (öffentliche
  Auftraggeber). The prüfen check on XRechnung will fail if this is missing for
  that Typ. Helper text on the form points the user to request it from the client.
- `elektronische_adresse` (BT-49): e-delivery address, often same as contact email
  for B2B; for B2G usually assigned by the purchasing portal.
- `eas_scheme` (BT-49-1): defaults to "EM" (email). Other values: "9930" (IBAN),
  "0204" (Leitweg-ID routing), etc.

## Navigation

AppShell: `stub: true` removed from Auftraggeber nav item — now a live link.
Routes: `ComingSoon` replaced with `AuftraggeberList` + nested `AuftraggeberDetail`
at `/:id`.

## Assumption

The `eas_scheme` field is required by the TS schema (no default in the openapi
spec even though the backend has a Python default). Always pass "EM" on creation.
What would invalidate: if the firm uses PEPPOL routing (eas_scheme "0088") for
B2B — can be set in the detail form at any time.
