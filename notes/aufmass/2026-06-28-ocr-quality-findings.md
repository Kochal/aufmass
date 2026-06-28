# 2026-06-28 — OCR quality findings: table-format limitations

/ area: aufmass / status: three structural problems identified; two-step approach now load-bearing /

## What was found

User review of the extraction output against the physical sheet revealed three problems,
all confirmed to originate in the raw OCR layer (not the annotation step).

### 1. `0,80` consistently misread as `0,5`

LV-POSITION cell for "Baum rechts" row: `Boden 4,72 x 3,86 / 1,83 x 0,80`
OCR reads: `Bode 4,72 x 3,86 / 1,83 x 0,5`

Tested at both 2× (508 KB) and 4× (1320 KB) scale — identical misread at both.
This is not a resolution problem. The `8` glyph in `0,80` is being read as `5`,
or `0,80` is being compressed to `0,5` (trailing `0` fused with comma or clipped).
The annotation model inherits this from the OCR text and cannot self-correct.

**Consequence**: The candidate list for `0,5` must include `0,80` as a plausible
alternative. A human reviewer must confirm. The reconciler should flag any leaf
`value` ending in `,5` or `,50` where `,80` or `,8` would give a more round result.

### 2. Expression split at cell boundary

Row "W. Fächel" has this across two cells:
```
STCK cell:           (2,84 + 0,86) / 2 x
LV-POSITION cell:    1,93 x 2
```

The complete expression is `(2,84 + 0,86) / 2 × 1,93 × 2`.
The third value in that row, `1,81 x 0,1`, is a separate entry (Leiste molding).

The OCR table format uses `|` as cell delimiter. The annotation model, reading the
OCR markdown, treats `|` as an expression boundary. The annotation prompt instruction
"expressions may span cells" does not override this because the model is working from
OCR text, not re-reading the image at expression level.

**Consequence**: Any expression that a worker wrote continuously across two printed
columns will be split into two entries, with the first flagged as "incomplete" (ends
with dangling operator). The reconciler should detect this: if an entry's expression
has a leaf with an empty value or the entry's notes say "incomplete", look for the
next entry in the same Bauteil group and attempt to join them.

### 3. Multi-line cell content truncated

LV-POSITION cell for "Baum rechts" row contains three sub-entries:
```
Boden 4,72 x 3,86 / 1,83 x 0,80
      1,31 x 0,10
      1,34 x 0,10
```
(The `4,72 x 3,86` context repeats implicitly for the two sub-entries.)

OCR returns only the first line. The sub-entries `1,31 x 0,10` and `1,34 x 0,10`
are completely absent from the annotation — they do not appear even with lower
confidence.

**Consequence**: Multi-line LV-POSITION cells are a common pattern on Aufmaß sheets
(different trades or sub-measurements for the same Bauteil entry). Every one of them
will silently drop sub-entries. The reconciler cannot detect what it was never given.

## What stays the same

- 2× scale (508 KB) is the right choice. 4× (1320 KB) slightly improves some
  spellings (Bode → Boden) but regresses others (Leiste measurement drops to "Leiste
  und auf", km/h reads as "Küche"). Not a worthwhile trade.
- The annotation step itself (expression trees, Bauteil grouping, deductions,
  confidence) works correctly on what the OCR gives it. The annotation quality
  problems identified earlier are all inherited from OCR.

## What this means for the two-step question

These three problems are structural, not edge cases:

- Cell-boundary splits will occur whenever a worker uses the STCK column for part of
  a formula and the LV-POSITION column for the rest — a standard pattern.
- Multi-line cell truncation will occur whenever a Bauteil row has more than one
  sub-measurement in the LV-POSITION column — also standard.

The two-step approach (raw OCR text → structuring model) was benchmarked only against
annotation quality, treating both as alternatives. It is now load-bearing for
correctness:

- The raw OCR markdown gives us the page text **without table-cell truncation** —
  all handwritten text is present, just not structured. A structuring step reading
  the raw markdown (or better, the raw page text) would see the full cell content.
- Cross-cell expression joining is easier in the structuring step, which can look at
  the full row context as a string rather than cell-by-cell.

**Recommended next step**: prototype the two-step path using the raw page markdown
as input to a cheap structuring call (Mistral text model), and benchmark it against
the current annotation path on the three failing cases above.

## Related

- [[2026-06-28-mistral-ocr4-benchmark]] (first benchmark; bbox mapping)
- [[2026-06-28-mistral-document-ai-pivot]] (decision: annotation-first, two-step benchmark-gated)
- [[07a-vision-client]] (open question: annotation vs two-step)
