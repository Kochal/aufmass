---
date: 2026-06-30
area: ui
---

# Menge calculator — free-text arithmetic in LV position dialogs

## Why

Quantities on a Maler/Bodenbelag job are nearly always a calculation — a room
area is `length × width`, an irregular wall is `(3.5+4.2) * 2.8 - 0.9*1.2`
(door deduction). The previous `<input type="number">` forced the user to
resolve the arithmetic mentally and type only the result. The formula was then
lost.

## What was built

### `calc.ts` — safe evaluator (`web/src/lib/calc.ts`)
Recursive-descent parser (no `eval` / `new Function`):
- Grammar: `expr → term (('+'|'-') term)*`, `term → factor (('*'|'/') factor)*`,
  `factor → NUMBER | '(' expr ')' | '-' factor`
- Tokenizer accepts digits, `.` and `,` as decimal separator (German comma
  normalised to dot). Whitespace (including `\n`) skipped, enabling multi-line
  expressions. Any other character returns a German error string.
- Guards: division-by-zero, unbalanced parens, non-finite result.
- Result rounded to 3 decimals (matches DB `numeric(14,3)`).
- Exports: `evaluateExpression(input) → { value, error }` and
  `isExpression(input) → boolean` (true when the string contains an operator
  outside a plain number).

### `MengeInput.tsx` — resizable textarea (`web/src/surfaces/office/quotes/`)
Uses a `<textarea>` (rows=3, resize-y, monospace, `min-h-[5rem]`) so multi-line
expressions like:
```
3,5 * 2,8
+ 4,2 * 1,6
- 0,9 * 1,2
```
fit naturally. Newlines are whitespace to the tokenizer, so the above evaluates
as `3.5*2.8 + 4.2*1.6 - 0.9*1.2`. Clear button fixed to top-right corner.

State: `expr` (what the user sees), `preview` (formatted result), `error`.
All three are initialised from the seed (`formula ?? value`) on mount via
lazy `useState` initialisers — so reopening a saved formula shows `= 11,333`
immediately without requiring a keystroke.

The `useEffect` that re-seeded `expr` from `value/formula` props was removed.
It caused the field to clear itself mid-typing: typing `16,419*` produces an
evaluator error → `onChange("", null)` → parent updates `value=""` → old effect
reset `expr` to `""`. Without the effect, `expr` is fully local; the parent
only receives resolved values through `onChange`. `key={position.id}` on the
MengeInput inside EditPositionDialog remounts it when a different position opens.

Behaviour per keystroke:
- empty → `onChange("", null)`
- plain number → `onChange(number_str, null)` — no formula stored
- valid expression → `onChange(result_str, expr)` + `= 11,333` preview
- invalid (intermediate state while typing) → amber error + `onChange("", null)`

### Layout — both dialogs
Menge full-width on top, `grid grid-cols-2` (Einheit | EP) directly below.
Previously all three were side-by-side in `grid grid-cols-3`.

### EP field — German comma
EP was `<Input type="number">` which uses the browser locale (dot). Changed to
`type="text"` with `inputMode="decimal"`. Display: stored dot-decimal with `.`
replaced by `,`. Input: `,` replaced back to `.` before storing. Placeholder
updated to `"12,50"`.

### Migration 0026 (`migrations/0026_lv_position_menge_formel.sql`)
`alter table lv_position add column if not exists menge_formel text;`
Purely additive. The audit trigger picks it up automatically.

### Backend
`menge_formel: str | None = None` added to `LvPositionCreate`, `LvPositionUpdate`,
`LvPositionRead`. Wired into INSERT and UPDATE SQL in `lv_position.py`.

### Frontend integration (`AngebotReview.tsx`)
- `AddPositionDialog` and `EditPositionDialog`: MengeInput replaces
  `<Input type="number">`. `menge_formel` added to form state, seeded from
  `position.menge_formel`. Included in POST/PUT bodies.
- `acceptMutation`, `setMatchMutation`, `bulkAcceptMutation`: `menge_formel`
  forwarded so confirming/matching a position does not null out the stored formula.
- `berechnenMutation.onSuccess`: added `invalidateQueries(["lv-position"])`.
  Without this, the pricing engine's writes to `gesamtpreis`/`einheitspreis`
  (which bump `row_version`) were invisible to the frontend — cards didn't
  refresh, and a subsequent PUT on any position threw a stale_row_version 409.

## Decision: persist both formula and result

The user explicitly chose formula + result over result-only. Rationale: the
formula is the source for the `menge` value and must be traceable
(non-negotiable #6). The pricing engine (`engine/pricing.py`) only ever reads
the numeric `menge`; `menge_formel` is purely for human audit and re-editing.

## What `menge_formel = NULL` means
A null formula means the menge was entered as a plain number (or set by
GAEB/OCR import). No warning, no re-display. Only manual-entry positions will
typically have a non-null formula.

## Edge cases
- German comma `3,5 * 2` → parser normalises → `menge = 7`, `menge_formel = "3,5 * 2"`.
- Negative leading factor `-2 * 5` → `menge = -10` (deduction use case).
- `2*(8+9)/3` → `menge = 11.333`, `menge_formel = "2*(8+9)/3"`.
- Incomplete expression `2 * (` → error shown, menge cleared; save stores empty menge.
  User must finish the expression before saving.
- Positions saved with the old useEffect bug may have wrong `menge` (the partial
  value before the field cleared). Fix: open edit, retype formula, save, then
  run Berechnen to refresh `gesamtpreis`.
