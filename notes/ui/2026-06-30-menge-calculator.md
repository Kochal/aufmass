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
  normalised to dot). Any other character returns a German error string.
- Guards: division-by-zero, unbalanced parens, non-finite result.
- Result rounded to 3 decimals (matches DB `numeric(14,3)`).
- Exports: `evaluateExpression(input) → { value, error }` and
  `isExpression(input) → boolean` (true when the string contains an operator
  outside a plain number — used to decide whether to show the preview and
  persist the formula).

### `MengeInput.tsx` — controlled wrapper (`web/src/surfaces/office/quotes/`)
Wraps the existing `Input` component (text type — gets the clear-X for free).
Local `expr` state for what the user is typing; seeded from `formula ?? value`
on mount. On each keystroke:
- empty → `onChange("", null)`
- plain number → `onChange(number, null)` (no formula stored)
- valid expression → `onChange(result, expr)` + shows `= 11,333` muted preview
- invalid → amber error line + `onChange("", null)` (prevents stale number)

Caller provides `key={position.id}` in EditPositionDialog so re-opening for a
different position resets the seed.

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
  forwarded so confirming/matching does not null out the stored formula.

## Decision: persist both formula and result

The user explicitly chose formula + result over result-only. Rationale: the
formula is the source for the menge value and must be traceable (non-negotiable
#6). The pricing engine (`engine/pricing.py`) only ever reads the numeric
`menge`; `menge_formel` is purely for human audit and re-editing.

## What `menge_formel = NULL` means
A null formula means the menge was entered as a plain number (or set by
GAEB/OCR import). No warning, no re-display. Only manual-entry positions will
typically have a non-null formula.

## Edge cases
- German comma `3,5 * 2` → parser normalises → `menge = 7`, `menge_formel = "3,5 * 2"`.
- Negative leading factor `-2 * 5` → `menge = -10` (deduction use case).
- `2*(8+9)/3` → `menge = 11.333`, `menge_formel = "2*(8+9)/3"`.
- Incomplete expression `2 * (` → error, menge cleared, save stores empty menge.
  User must fix before saving.
