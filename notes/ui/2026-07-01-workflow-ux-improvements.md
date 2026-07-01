---
date: 2026-07-01
area: ui
---

# Workflow UX improvements — Rechnungen, Angebote, Auftraggeber, match_status

## Neue Rechnung dialog — filter by active Angebote

The "Neue Rechnung" dialog Auftraggeber picker now only shows companies that
have at least one active Angebot (status != cancelled/superseded). The Projekt
picker shows only projects that have an active Angebot for the selected
Auftraggeber. A **Direktrechnung** checkbox removes both filters, restoring the
unfiltered pickers for jobs that skip the quotation step.

Previously the pickers were unfiltered (all companies/projects). The first
attempt filtered by `status='issued'` only, which produced an empty list when
all Angebote were still in draft — broadened to all active Angebote.

## Nav reorder — workflow order in sidebar

Left-pane order changed from Angebote → Rechnungen → Auftraggeber → Projekte
to **Auftraggeber → Projekte → Angebote → Rechnungen → Katalog**, reflecting
the natural creation order. Previously the sidebar forced users to navigate
backwards through the workflow.

## Inline Auftraggeber/Projekt creation in Neues Angebot dialog

The "Neues Angebot" dialog now has **"Neu" links** next to the Auftraggeber and
Projekt pickers. Clicking one expands a small inline input below the picker:

- **Auftraggeber Neu**: name input + "Anlegen" (Enter also works). On success:
  invalidates auftraggeber cache, auto-selects the new entry, clears Projekt.
- **Projekt Neu**: same, disabled until an Auftraggeber is selected. Uses the
  selected Auftraggeber as the `auftraggeber_id` for the POST.

Both support Escape to cancel. This removes the forced navigation: previously
the user had to leave the Angebot context, create an Auftraggeber, then come
back.

The Projekt picker now filters by the selected Auftraggeber (previously showed
all projects regardless of company).

## Auftraggeber "Neu anlegen" — skip dialog, open full detail

Previously: "Neu anlegen" opened a 2-field dialog (name + type) → submit →
return to list → find the new row → click to open detail.

Now: clicking "Neu anlegen" immediately POSTs with a placeholder name
("Neuer Auftraggeber") and navigates directly to the full `AuftraggeberDetail`
page where all fields are available (Stammdaten, Adresse, Rechnungsdaten,
Kontakte). The user overwrites the placeholder name and fills in the rest
in one place, then saves.

Risk: if the user navigates away without saving, an "Auftraggeber" record with
the placeholder name remains in the DB. This is a minor, acceptable trade-off.

## match_status fix — "Annehmen" is for system-suggested matches only

"Annehmen" exists to let a human confirm a **system-suggested** catalog match
(GAEB/OCR import with confidence < 1.0). It was incorrectly required for
manually created positions, causing unnecessary friction.

Two bugs fixed in `AngebotReview.tsx`:

1. **AddPositionDialog**: previously `match_status: selectedLeistungId ?
   "confirmed" : "review"`. Changed to always `"confirmed"` for manual
   entries (`source='manual'`). The user typed every field themselves — no
   confirmation step needed.

2. **EditPositionDialog save**: previously always set `match_status: "review"`,
   meaning every edit of a confirmed position required re-clicking "Annehmen".
   Now preserves `position.match_status`, EXCEPT when a new catalog assignment
   is made (different `matched_leistung_id` or `saveToKatalog` fires) → sets
   `"confirmed"`.

Semantic after fix:
- GAEB/OCR position with suggested match → `review` → "Annehmen" required
- Manual position (any price, with or without catalog) → `confirmed` immediately
- Editing menge/EP on a confirmed position → stays `confirmed`
- Reassigning catalog entry on any position → `confirmed`
