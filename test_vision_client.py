"""Smoke-test for the 07a vision client against Mistral Document AI.

Run from the repo root (where .env lives):
    pip install pymupdf mistralai   # one-time, if not installed
    python test_vision_client.py

Requires MISTRAL_API_KEY in .env or the environment. If not set the script
prints a note and exits — the Mistral DPA must be in place before production
use (directive 09).

The script converts page 1 of the sample Aufmaß PDF to JPEG and calls
extract(), printing the structured annotation result.
"""
import json
import sys
import os
import logging

logging.basicConfig(level=logging.INFO, format="%(name)s: %(message)s")

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "api"))

try:
    import fitz  # pymupdf
except ImportError:
    sys.exit("pymupdf not found — run:  pip install pymupdf")

from app.config import settings

print(f"model    : {settings.mistral_model_id}")
print(f"endpoint : api.mistral.ai")
print()

if not settings.mistral_api_key:
    sys.exit(
        "MISTRAL_API_KEY not set.\n"
        "Set it in .env once the Mistral DPA is signed (directive 09).\n"
        "Until then, use manual Aufmaß entry."
    )

PDF_PATH = os.path.join(os.path.dirname(__file__), "data", "Handaufmaß Bsp.1.pdf")
if not os.path.exists(PDF_PATH):
    sys.exit(f"Sample PDF not found: {PDF_PATH}")

doc = fitz.open(PDF_PATH)
page = doc[0]
# 2× scale (~150 dpi) — enough detail for handwriting; increase if model struggles
pix = page.get_pixmap(matrix=fitz.Matrix(2, 2))
image_bytes = pix.tobytes("jpeg")
print(f"image    : {len(image_bytes) // 1024} KB  ({pix.width}×{pix.height}px)")
print()

from app.aufmass.vision_client import extract, ExtractionError

print("=== Mistral Document AI extraction ===")
try:
    result = extract(image_bytes, mime_type="image/jpeg")
    entries = result.get("entries", [])
    print(f"entries  : {len(entries)}")
    print(json.dumps(result, ensure_ascii=False, indent=2))
except ExtractionError as e:
    sys.exit(f"ExtractionError: {e}")
