---
date: 2026-06-30
area: ui
---

# Angebot manual workflow — decisions and fixes

## What was built (2026-06-29 → 2026-06-30, session 1)

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
Trash icon appears alongside the pencil in the left-pane hover controls. Clicking
shows inline "Löschen? Ja / Nein" without opening a dialog. Soft-delete via
DELETE /api/lv-position/{id}.

## Bugs fixed (session 1)

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
position.source !== "manual"` for the disabled check. Also fixed: handleAccept in
AngebotReview had the same guard (`if (!pos.matched_leistung_id) return;`) and
was silently blocking the callback even after the button appeared enabled.

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

---

## What was extended (session 2, same date)

### Leistung autosuggest in EditPositionDialog
Search field (≥2 chars, client-side filter by kurztext or code, no API call).
Selecting a leistung fills kurztext/einheit/EP and links matched_leistung_id.
A chip shows the selected leistung; ✕ clears it.

Use case: add a standard catalog leistung but with a custom price (edit EP after
selecting).

### "In Katalog speichern" checkbox (EditPositionDialog)
Only visible when no existing leistung is linked. When checked: auto-generates a
code (max trailing digit + 1, padded 3 digits), catalog picker shown if >1 catalog
exists. On save, POSTs a new Leistung first, then links the position to it via
matched_leistung_id.

Bug fixed: the checkbox silently did nothing when katalogList was still loading
when the dialog opened (newKatalogId was set to "" and the `saveToKatalog &&
newKatalogId && newCode` guard evaluated false). Fix: derive effectiveKatalogId
as `newKatalogId || katalogList[0]?.id || ""` at render time.

### Leistung autosuggest in AddPositionDialog
Same search pattern as EditPositionDialog. When a leistung is selected, the POST
sets matched_leistung_id + match_confidence=1.00 + match_status="confirmed"
(human explicitly chose the entry). Hidden when no leistungen loaded.

### Langtext (Positionstext) field in AddPositionDialog
Simple text input between Kurztext and the Menge/Einheit/EP grid.

### Manual positions right pane: "Eigener Eintrag"
Manual positions (source=manual) without a catalog link previously showed "Kein
Katalogeintrag zugewiesen". Now shows "Eigener Eintrag" + the position's own
kurztext. Non-manual unmatched positions (GAEB/PDF with no match yet) still show
"Kein Katalogeintrag zugewiesen".

### Row sum always visible
PositionCard right pane shows EP/Einheit for any position with einheitspreis.
If the pricing engine has run (gesamtpreis set): shows `= Betrag`.
Otherwise: shows `≈ Betrag` computed client-side from menge × einheitspreis.
The ≈ signals a preview; the engine still owns the committed value.

### Bulk accept ("Alle annehmen")
Button appears in the AngebotReview header when at least one confirmable position
exists (matched or source=manual and not yet confirmed). Fires parallel PUTs to
set match_status="confirmed" on all such positions. Hides once all are confirmed.

### stale_row_version fix
EditPositionDialog previously received the position object captured at pencil-click
time. If lv-position queries refetched between dialog open and save (e.g. triggered
by another mutation), the dialog held a stale row_version → 409.
Fix: store editPositionId (string | null) instead of editPosition; derive the live
position from sortedPositions on each render. The dialog always sends the current
row_version from the query cache.

### Unit warnings in PositionCard
Two amber ⚠ indicators, display-only, no API calls:

1. **Typo warning** (left pane, menge row): fires for units that are genuinely
   unusual in Maler/Bodenbelag work:
   - `m1` → suggest "m oder lm" (no standard unit "m to the first power")
   - `m3` → flag as uncommon ("m³ oder cbm — bitte prüfen")
   - `m2` is accepted keyboard shorthand for m² and does NOT warn.
   Tooltip shows the suggestion. Superscript-drop (m2) is normal keyboard input
   and must not warn — it's awkward to type superscripts.

2. **Unit mismatch** (right pane, below matched leistung): fires when
   position.einheit ≠ matchedLeistung.einheit (case-insensitive, trimmed).
   Shows both values so the reviewer can correct whichever is wrong.
