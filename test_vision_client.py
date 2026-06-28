"""Quick smoke-test for the 07a vision client against the live model endpoint.

Run from the repo root (where .env lives):
    pip install pymupdf          # one-time, if not installed
    python test_vision_client.py

The script first sends a plain-text ping to confirm the endpoint is up, then
converts page 1 of the sample Aufmaß PDF to JPEG and calls the vision client.
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

import openai
from app.config import settings

print(f"endpoint : {settings.model_endpoint}")
print(f"model    : {settings.model_name}")
print()

client = openai.OpenAI(
    base_url=settings.model_endpoint,
    api_key=settings.model_api_key or "unused",
    timeout=300.0,
)

# --- 1. Plain-text ping ---------------------------------------------------
print("=== text-only ping ===")
try:
    resp = client.chat.completions.create(
        model=settings.model_name,
        messages=[{"role": "user", "content": "Reply with the single word: pong"}],
        temperature=0,
        max_tokens=10,
    )
    print("response:", resp.choices[0].message.content)
except Exception as e:
    print(f"FAILED: {e}")

print()

# --- 2. Vision call with downscaled image ---------------------------------
print("=== vision extraction ===")
PDF_PATH = os.path.join(os.path.dirname(__file__), "data", "Handaufmaß Bsp.1.pdf")

doc = fitz.open(PDF_PATH)
page = doc[0]
# 1× scale (~75 dpi) — smaller payload; increase if model struggles to read
pix = page.get_pixmap(matrix=fitz.Matrix(1, 1))
image_bytes = pix.tobytes("jpeg")
print(f"image: {len(image_bytes) // 1024} KB  ({pix.width}×{pix.height}px)")

from app.aufmass.vision_client import extract, ExtractionError
try:
    result = extract(image_bytes, mime_type="image/jpeg")
    print(json.dumps(result, ensure_ascii=False, indent=2))
except ExtractionError as e:
    sys.exit(f"ExtractionError: {e}")
