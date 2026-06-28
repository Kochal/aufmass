"""Two-step prototype benchmark: one-step annotation vs two-step OCR+structuring.

Run from repo root:
    python test_two_step.py

Prints both results and a side-by-side diff focused on the three known failure
cases from notes/aufmass/2026-06-28-ocr-quality-findings.md:
  1. 0,80 vs 0,5 misread
  2. Cross-cell expression join: (2,84 + 0,86) / 2 × 1,93 × 2
  3. Multi-line cell truncation: 1,31 x 0,10 and 1,34 x 0,10
"""
import json
import logging
import os
import sys
import time

logging.basicConfig(level=logging.INFO, format="%(name)s: %(message)s")
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "api"))

try:
    import fitz
except ImportError:
    sys.exit("pymupdf not found — pip install pymupdf")

from app.config import settings

if not settings.mistral_api_key:
    sys.exit("MISTRAL_API_KEY not set")

PDF_PATH = os.path.join(os.path.dirname(__file__), "data",
                        [f for f in os.listdir("data") if "Bsp" in f][0])
doc = fitz.open(PDF_PATH)
pix = doc[0].get_pixmap(matrix=fitz.Matrix(2, 2))
image_bytes = pix.tobytes("jpeg")
print(f"image: {len(image_bytes)//1024}KB  {pix.width}×{pix.height}px\n")

from app.aufmass.vision_client import extract as one_step_extract, ExtractionError
from app.aufmass import two_step

# ─── One-step ────────────────────────────────────────────────────────────────
print("=" * 60)
print("ONE-STEP (document_annotation_format)")
print("=" * 60)
t0 = time.monotonic()
one = one_step_extract(image_bytes)
print(f"entries: {len(one['entries'])}  ({time.monotonic()-t0:.1f}s)\n")

# ─── Two-step ─────────────────────────────────────────────────────────────────
print("=" * 60)
print(f"TWO-STEP (raw OCR -> {two_step._STRUCTURE_MODEL})")
print("=" * 60)
t0 = time.monotonic()
two = two_step.extract(image_bytes)
print(f"entries: {len(two['entries'])}  ({time.monotonic()-t0:.1f}s)\n")

# ─── Focused comparison on the three known failure cases ──────────────────────
print("=" * 60)
print("FOCUSED COMPARISON — three known failure cases")
print("=" * 60)

def find_entries(result, *keywords):
    """Return entries whose raw_text contains any of the keywords."""
    return [
        e for e in result["entries"]
        if any(k.lower() in e["raw_text"].lower() for k in keywords)
    ]

def show_expression(entry):
    raw = entry.get("raw_text", "")
    expr = entry.get("expression")
    bbox = entry.get("bbox")
    bbox_str = f"({bbox['y1']:.3f}–{bbox['y2']:.3f})" if bbox else "None"
    return f"  raw='{raw}'  bbox={bbox_str}\n  expr={json.dumps(expr, ensure_ascii=False)}"

print("\n1. 0,80 vs 0,5 misread  (expected: 0,80 in Boden entry)")
for label, result in [("one-step", one), ("two-step", two)]:
    hits = find_entries(result, "4,72", "3,86", "1,83")
    print(f"\n  [{label}] {len(hits)} match(es):")
    for e in hits:
        print(show_expression(e))

print("\n2. Cross-cell expression  (expected: (2,84+0,86)/2 × 1,93 × 2 as ONE entry)")
for label, result in [("one-step", one), ("two-step", two)]:
    hits = find_entries(result, "2,84", "0,86", "1,93")
    print(f"\n  [{label}] {len(hits)} match(es):")
    for e in hits:
        print(show_expression(e))

print("\n3. Truncated sub-entries  (expected: 1,31 x 0,10 and 1,34 x 0,10)")
for label, result in [("one-step", one), ("two-step", two)]:
    hits = find_entries(result, "1,31", "1,34")
    print(f"\n  [{label}] {len(hits)} match(es)  {'FOUND' if hits else '(still missing)'}")
    for e in hits:
        print(show_expression(e))

# ─── Full two-step output ─────────────────────────────────────────────────────
print("\n" + "=" * 60)
print("FULL TWO-STEP OUTPUT")
print("=" * 60)
print(json.dumps(two, ensure_ascii=False, indent=2))
