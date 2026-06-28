# 07 - Aufmaß Capture and OCR

Turning on-site measurements into structured, billable quantities. Most
arrive as handwritten sheets with free-form layout, and the numbers are
financially load-bearing, which makes this the highest hallucination-risk
input in the system. The design assumes the extractor will sometimes misread
and makes errors cheap to catch and correct, rather than chasing an accuracy
it will not reach.

Schema (`aufmass`, `aufmass_entry`) is reserved in `02`; models are served
per `03`; the billing rule this feeds is in `06`; prüfbares Aufmaß and REB
output are required by `01`. This file states the capture modes, the
extraction-and-reconciliation pipeline, and where human review is pointed.

Audience: you (Claude Code) and any human contributor.

## Changelog
- 2026-06-28: Section 2 rewritten: extraction now via Mistral Document AI
  (OCR 4, `mistral-ocr-4-0`) with document_annotation. Native bbox + word
  confidence replaces client-side normalisation. Reconciliation (§3-5)
  unchanged; word confidence seeds candidate-glyph search. Open question 1
  (thresholds) updated — now seedable from word confidence.
- 2026-06-22: Initial draft. Capture modes, expression-tree extraction,
  deterministic reconciliation, verification UX, linkage to billing.
- 2026-06-24: Materialized the Aufmaß schema as migration `0020`
  (`aufmass`, `aufmass_entry`) with a guarantee suite (`tests/aufmass_test.sql`).
  Now true at the DB level: a sheet's `quelle` constrains the archived original
  (foto/voice require one, manual forbids it; non-negotiable 4); `aufmass` is a
  lockable aggregate under the `02` concurrency model (`edit_lock` resource_type
  `aufmass`); the `lv_position` link is nullable so standalone Aufmaß is allowed
  (open question 4); and a **prüfbarkeit floor** refuses to *commit* an
  untraceable measured number — a confirmed, billing-linked entry must carry a
  result and, for foto/voice, a `source_crop_ref` (manual is its own trace via
  the audit actor). The reconciliation arithmetic itself stays app-layer, like
  money math. Columns added beyond `02`'s prose: `einheit` (drives the magnitude
  band) and `review_status` (`review`/`auto_accepted`/`confirmed`/`corrected`).
  Detail in `notes/aufmass/2026-06-24-aufmass-db-layer.md`.

-----

## Principle

Build for fast verification, not zero-touch automation. The bottleneck was
never reading the sheet, it is trusting the read. So the extractor emits
structure plus its own uncertainty, deterministic code reconciles what it can
using the arithmetic already on the sheet, and the human confirms the rest
against an image crop in seconds. Accuracy of 90% with cheap verification
beats a fragile 99% that hides its errors.

-----

## Capture modes (all feed one pipeline)

- **Photo (primary).** The path that needs zero habit change: the crew keeps
  scribbling on whatever paper is to hand, then photographs it. No printed
  template is assumed; builders forget them and use scrap paper (this is why
  the earlier pre-printed-form idea was dropped).
- **Voice (optional).** Self-hosted German ASR (`03`). Lower friction for
  some, but habit change is real and not assumed; offered, not required.
- **Manual entry.** Direct structured entry on a tablet for those who prefer
  it.

All three produce the same `aufmass_entry` rows downstream. The source photo
or audio is stored as an immutable `document` (`04`).

-----

## Extraction pipeline

### 1. Preprocess

- Orientation and deskew first: sheets are photographed at any angle (the
  sample was sideways). Normalise before extraction.
- The original image is never modified; preprocessing operates on a copy.

### 2. Vision-model extraction (Mistral Document AI)

Extraction uses **Mistral Document AI** (`mistral-ocr-4-0`) via
`document_annotation_format` (the entry/expression-tree schema as a Pydantic
model) and `document_annotation_prompt` (handwritten measurements only; ignore
printed column headers; do not compute). Client detail is in `07a`.

The model emits, per handwritten measurement:

- the **expression** as a structured tree, not a string: operands, operator,
  any multiplier (the "x2"), and any **written result** the builder noted;
- **candidate readings** for uncertain glyphs (a 7 that might be a 1, a comma
  that might sit one place over), with a **word-level confidence** score per
  token (native from Mistral OCR 4, floats in [0, 1]);
- an optional **label** (Bauteil) if legible;
- the **source crop** as 0..1 bbox fractions (native from Mistral OCR 4 —
  no client-side normalisation needed).

These populate `aufmass_entry.expression`, `candidate_readings`,
`written_result`, `source_crop_ref`, and `bauteil` (`02`). The model does no
arithmetic and makes no final decision.

Word confidence scores seed the deterministic candidate-glyph reconciliation
(§3): when multiple glyph readings reconcile, the one with the highest total
word confidence is preferred, reducing the surface that needs human review.

### 3. Deterministic reconciliation (math as checksum)

Each written calculation is a small equation with a built-in check. The
evaluator uses that redundancy to both catch and often repair misreads:

- **Formula and written result agree** (operands op = result, within
  rounding): lock the value, high confidence.
- **They disagree**: search the small space of candidate glyph readings for
  the combination where operands op = result. Usually exactly one reconciles,
  yielding a **proposed correction**, not just a flag. This is a checksum
  that can fix a single bad symbol, and it catches both transcription errors
  and the builder's own arithmetic slips.
- **Formula present, no written result**: compute it, then fall back to
  magnitude bands.
- **Lone result, no formula**: nothing to cross-check; it stays at raw-OCR
  confidence and routes to review.

Results are written to `computed_result`, `reconciled`, and `confidence`.

### 4. Magnitude bands

The most common German failure mode is the comma: 3,86 vs 386 vs 38,6. Each
measurement type has a plausible range (a room dimension roughly 0,3 to 15 m,
a height roughly 2 to 4 m, and so on). Usually exactly one comma placement
lands in band, which resolves the ambiguity with no human. Bands per type
(length, height, area, lfm) catch the rest.

### 5. Soft geometric cross-checks

Painter measurements are not independent. From a floor of roughly 3,86 by
3,02 the perimeter implies a wall area, against which the wall entries and the
corner deductions (windows, doors) should roughly reconcile. Rooms have
Schrägen and are not perfect boxes, so these are **plausibility flags, not
hard rejects**: a wall sum at double the geometric estimate is almost
certainly a misread and is surfaced for review.

-----

## What the math secures, and what it does not

Reconciliation secures the **values**. It does not secure two things, and
review is pointed precisely at them:

- **Lone results** with no formula behind them have nothing to cross-check.
- **Assignment**: a perfectly read "3,86 x 0,74" still has to be attached to
  the right Bauteil and the right LV position. The free-form layout (numbers
  written wherever there was space, ignoring the sheet's own grid) is exactly
  where this bites. Absolute position on the page is treated as noise, not
  signal.

So the reviewer's attention goes to **grouping and labels**, not to
re-reading digits the math already locked.

-----

## Verification UX

- Each extracted number is shown next to its **source crop**. The reviewer
  confirms or corrects in about two seconds by glancing at the crop, instead
  of re-keying the page.
- Reconciled, in-band values are pre-accepted and shown for a quick scan;
  proposed corrections show both the read and the reconciled value;
  low-confidence and lone-result items are highlighted.
- The real interaction is confirming which Bauteil / LV position each cluster
  of numbers belongs to. Corrections and confirmations are audited (`02`).
- An Aufmaß sheet is a lockable aggregate: editing it takes an edit lease
  under the concurrency model (`02`).

-----

## Linkage to billing

- A confirmed `aufmass_entry` links to its `lv_position` (`02`). The
  reconciled quantity becomes the measured Menge.
- This is the measured quantity that **governs the Schlussrechnung** under a
  unit-price contract (`06`): measured wins over tendered, subject to the
  Pauschal and VOB/B Section 2(3) qualifications resolved there. Both the
  tendered and measured Mengen are retained so the delta is visible.
- For B2G the result must be a **prüfbares Aufmaß** (`01`): every billed
  quantity traces to a formula, a reconciled value, and a source crop, and
  the measurement exports to the REB (VB 23.003) quantity format so it flows
  into VOB-conform Abrechnung.

-----

## Open questions

1. **Confidence-to-action thresholds**: the exact cutoffs for auto-accept vs
   review (reconciled-and-in-band, reconciled-but-out-of-band, lone result).
   Drafted as: auto-accept only reconciled-and-in-band; everything else to
   review. Word-level confidence from Mistral OCR 4 provides a seed for
   per-glyph weighting; tune the thresholds on real sheets.
2. **Multi-candidate reconciliation**: when more than one glyph combination
   reconciles to the written result, do we surface all and force a choice, or
   pick the highest-prior reading and flag? Drafted as surface-and-choose.
3. **Voice grammar**: free-form dictation parsed by the model, or a light
   structured prompt ("Raum, Bauteil, Länge mal Breite")? Drafted as
   free-form to keep friction low; revisit if accuracy on site is poor.
4. **Standalone Aufmaß**: measurements taken before any LV exists (small
   private jobs with no tender). Drafted as allowed, with the
   `lv_position` link left null until a quote is built.
