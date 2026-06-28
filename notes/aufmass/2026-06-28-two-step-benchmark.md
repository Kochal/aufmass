# 2026-06-28 — Two-step benchmark: raw OCR + chat structuring vs one-step annotation

/ area: aufmass / status: two-step fixes expression split; recommend as primary path /

## Setup

| | One-step | Two-step |
|---|---|---|
| Step 1 | `ocr.process` + `document_annotation_format` | `ocr.process` (no annotation) → raw markdown |
| Step 2 | (none) | `chat.complete` with `mistral-small-latest` + `ResponseFormat` JSON schema |
| Structuring model | `mistral-ocr-4-0` annotation head | `mistral-small-latest` |
| Time (sample sheet) | ~7s | ~14s (0.4s OCR + 13.4s structuring) |

Code: `api/app/aufmass/two_step.py`. Reuses `_assign_bboxes()` from `vision_client.py`.

## Results on the three known failure cases

### 1. `0,80` → `0,5` misread

Both paths produce `0,5`. Confirmed: the raw OCR text already has `0,5`;
neither approach recovers `0,80` from text alone.

**Conclusion**: Cannot be fixed by path choice. Requires reconciler flag or image
re-read of the specific cell (a third, targeted step not yet prototyped).

### 2. Cross-cell expression join — FIXED by two-step

One-step emits two entries:
```
Entry A: "(2,84 + 0,86) / 2 x"  — expression tree with leaf {value:"x"}
Entry B: "1,93 x 2"             — separate entry
```

Two-step emits one entry:
```
"+ (2,84 + 0,86) / 2 x 1,93 x 2"
expression: (* (/ (+ 2,84 0,86) 2) 1,93 2)   ← correct 3-factor product
```

The structuring model read the full row string, saw the dangling `x`, and
correctly joined the continuation from the next cell. This is the fundamental
correctness fix: wrong expression trees produce wrong totals.

### 3. Truncated sub-entries (`1,31 x 0,10`, `1,34 x 0,10`)

Both paths return 0 matches. The raw OCR markdown already omits these lines — the
OCR collapsed the multi-line LV-POSITION cell to one line. The structuring model
in step 2 cannot recover what the OCR dropped.

**Conclusion**: Cannot be fixed by either path. Requires either higher-DPI pass
targeting that specific cell, or a manual review flag when a LV-POSITION cell
looks like it may be multi-line (length heuristic).

## Other observations

| | One-step | Two-step |
|---|---|---|
| Entry count | 25 | 26 |
| candidates populated | Yes (dot/comma variants) | No (empty lists) |
| km/h handling | Absorbed into notes on a row entry | Separate entry, confidence=0.1 |
| is_deduction correct | Yes | Yes |
| Bauteil grouping | Correct | Correct |
| Bbox assignment | 22/25 | 21/26 (km/h stub entries don't match) |

**candidates gap**: `mistral-small-latest` with the current system prompt does not
populate candidates. Fixable by adding explicit candidates instruction to the
structuring system prompt.

**km/h entry**: The OCR reads `km/h` in the STCK column of the "Schrög Licks" and
"rechts" rows. Two-step surfaces this as a separate low-confidence entry; one-step
buries it in a note. The two-step handling is arguably better (surfaced for review).

## Recommendation

**Use two-step as the primary extraction path.**

The cross-cell expression split is a correctness issue, not a quality issue — a
split expression produces wrong arithmetic in the reconciler (the two halves evaluate
to wrong subtotals). The one-step path will produce systematically wrong results for
any sheet where a worker writes a formula across the STCK + LV-POSITION columns,
which is a common pattern.

The 2× latency (14s vs 7s) is acceptable for a human-in-the-loop review workflow.

Required before switching production path:
1. Add candidates instruction to the two-step structuring system prompt
2. Unit-test expression completeness: entry expression tree should have no empty-value leaves
3. Confirm `mistral-small-latest` is covered by the same DPA as `mistral-ocr-4-0`
   (both are Mistral EU-native endpoints — same DPA applies, but verify in writing)

The remaining two failure cases (OCR misread, cell truncation) require work at the
OCR layer, not the structuring layer, and are tracked as separate open questions.

## Related

- [[2026-06-28-ocr-quality-findings]] (the three failure cases this benchmarks)
- [[2026-06-28-mistral-ocr4-benchmark]] (first benchmark: 25 entries, bbox)
- [[2026-06-28-mistral-document-ai-pivot]] (original decision: annotation-first, two-step gated)
- [[07a-vision-client]] (open question: annotation vs two-step)
