---
date: 2026-06-30
area: ui
---

# Angebot manual workflow — decisions and fixes

## What was built (2026-06-29 → 2026-06-30)

### Manual Angebot creation (AngebotList)
"Neues Angebot" button opens a dialog: pick Auftraggeber (required) + Projekt
(optional) → POST /api/angebot → navigate immediately to the review screen.
Empty state also shows the button.

### Manual position add (AngebotReview)
"Position" button in the header (always visible) + "Position hinzufügen" in the
empty state → dialog with Kurztext (required), Menge, Einheit, EP. If no LV exists
for the Angebot yet, one is created first (POST /api/lv with source="manual").
Position is created with match_status="review" and source="manual".

### Position field editing (PositionCard pencil → AngebotReview EditPositionDialog)
Hover-reveal pencil icon on the LEFT pane of each PositionCard (the source/LV side).
"Korrigieren" on the RIGHT pane remains the catalog picker. This distinction is
intentional: left pane = edit raw position data; right pane = pick catalog match.

Editing always resets match_status to "review" so the position re-enters the
queue. For manual positions without a catalog match, the user can then click
"Annehmen" directly (see below).

### Delete position
Trash button in EditPositionDialog footer; requires a two-click confirm
("Wirklich löschen?" → "Ja, löschen"). Soft-delete via
DELETE /api/lv-position/{id}.

## Bugs fixed

### Input cursor loss after first keystroke (Einheit field)
The Input component conditionally rendered `<input>` (empty) vs `<div><input>` (non-empty).
React saw these as different elements and unmounted/remounted the input on the first
character, dropping keyboard focus. Fix: always render the wrapper div when onChange
is present and type is text-like; toggle the X button with `invisible` (not display:none)
so the DOM structure never changes.

### "manual" label shown in English
PositionCard source badge now maps: gaeb→"GAEB", pdf→"PDF", manual→"Manuell".

### "Annehmen" disabled for manual positions without catalog match
The confirm button was gated on `isUnmatched` (no matched_leistung_id). Manual
positions (source="manual") don't need a catalog link to be confirmed — they were
entered by a human who already knows what the position is. Fix: `isUnmatched &&
position.source !== "manual"` for the disabled check.

## match_status semantics for manual positions

"confirmed" means "a human has approved this position; it is correct". For GAEB/PDF
positions this also validates the AI-chosen catalog match. For manual entries there
is no AI match to validate, so confirmed simply means "ready to price".

Editing any position (regardless of source) resets to "review" because the changed
data may no longer match the catalog entry or the previously computed price. The
user re-confirms with "Annehmen" after editing.

Voice/scan autofill: confirmed status IS meaningful even for manual positions — the
voice workflow might backfill menge/einheit on an existing position and the user
still needs to sign off.
