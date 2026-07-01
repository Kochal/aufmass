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

## List tables — sort, search, Auftraggeber/Projekt columns

All four main lists now share a uniform interaction pattern:

**Sort**: clicking a column header sorts ascending; clicking again reverses to
descending. The active column shows ↑/↓; inactive columns show ↕ (30% opacity).
Implemented via shared `SortHead` component at
`web/src/components/ui/sort-head.tsx` — takes `col`, `label`, `sortCol`,
`sortDir`, `onSort`, optional `className` and `align` (`"start"` | `"end"`).

**Search**: a search box in each header bar filters the already-loaded data.
Count in the heading shows `n / total` when a search or filter is active.
Fields searched per list:
- Angebote: Angebotsnummer, Auftraggeber name, Projekt name
- Auftraggeber: name, Kundennummer, Leitweg-ID
- Projekte: name, Nummer, Auftraggeber name
- Rechnungen: Rechnungsnummer, Auftraggeber name, Projekt name

**Status filter** (Projekte, Rechnungen): the Combobox dropdown remains but
filtering switched from server-side query param to client-side so it composes
with search and sort without extra API calls. Query key simplified from
`["projekt", statusFilter]` → `["projekt"]` (always fetch all).

**AngebotList new columns**: Auftraggeber and Projekt added as the first two
columns. AngebotList now fetches auftraggeber and projekte alongside angebote
(both already in cache via other screens), builds agMap/projMap for name
resolution, and uses them in both the filter pass and the table rows. Version
column dropped from the list (still visible in detail page).

Default sort: Angebote by `created_at` desc, Auftraggeber by `name` asc,
Projekte by `name` asc, Rechnungen by `rechnungsdatum` desc.

## Per-column filters (replaced global search)

The global search box was replaced with a **filter row** — a second `<TableRow>`
inside `<TableHeader>`, with a filter control under each filterable column.

**Root cause of the global search failure**: status values are stored in
English (`"issued"`, `"draft"`) but displayed in German (`"Ausgestellt"`,
`"Entwurf"`). A text search on the raw data could never match the German terms
the user typed.

**ColFilter** (`ColFilter` component, `table-filters.tsx`): a plain text input
(`h-6 text-xs`) for substring filtering on string columns.

**ColSelect** (`ColSelect` component, `table-filters.tsx`): a native `<select>`
with an "Alle" default option and German labels mapping to English DB values.
Used for:
- Angebote Status: Entwurf/Ausgestellt/Beauftragt/Storniert → draft/issued/awarded/voided
- Auftraggeber Typ: Privat/Gewerblich/Öffentlich → privat/gewerblich/oeffentlich
- Projekte Status: all 10 values, labels from `STATUS_LABELS`
- Rechnungen Status: Entwurf/Ausgestellt/Storniert → draft/issued/storniert

**State**: each list has `filters: Record<string, string>` and a `setFilter(col, val)`
helper. `hasFilter = Object.values(filters).some(v => !!v)` drives the count badge
and the "Filter zurücksetzen" link.

**Removed**: global search `<Input>` in header; status `<Combobox>` from
Projekte and Rechnungen headers (superseded by column filter).
