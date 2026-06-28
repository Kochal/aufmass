"""Two-step Aufmaß extraction: raw OCR → chat-model structuring (directive 07a).

Motivation: the one-step annotation path (document_annotation_format) sees the
page as a markdown table and treats | cell delimiters as expression boundaries.
Expressions that a worker wrote across two columns (e.g. formula in STCK, factors
in LV-POSITION) are split into separate entries.

This module implements the alternative:
  1. OCR without annotation_format → raw page markdown (full row as one string)
  2. Chat completion with the raw markdown → AufmassExtractionResult JSON

The structuring model in step 2 receives the full table row as plain text, so it
can join cross-cell expressions. Bbox mapping reuses _assign_bboxes() from the
one-step client.

Limitations (same as one-step):
  - Multi-line cell content truncated by OCR is not recovered.
  - OCR misreads (e.g. 0,80 → 0,5) propagate unchanged.

Compliance: uses mistral-small-latest as the structuring model. This is also an
EU-native Mistral endpoint; the same DPA/no-training-tier as mistral-ocr-4-0
covers it. Do not call in production until the DPA is signed (directive 09).
"""
from __future__ import annotations

import base64
import json
import logging
import time
from typing import Any

from mistralai.client import Mistral
from mistralai.client.models.jsonschema import JSONSchema
from mistralai.client.models.responseformat import ResponseFormat

from app.aufmass.schema import AufmassExtractionResult
from app.aufmass.vision_client import (
    ExtractionError,
    _assign_bboxes,
    _make_client,
    _RETRY_DELAYS,
)
from app.config import settings

log = logging.getLogger(__name__)

_STRUCTURE_MODEL = "mistral-small-latest"

_STRUCTURE_FORMAT = ResponseFormat(
    type="json_schema",
    json_schema=JSONSchema(
        name="AufmassExtractionResult",
        schema_definition=AufmassExtractionResult.model_json_schema(),
        strict=True,
    ),
)

_SYSTEM_PROMPT = """\
You are extracting structured measurement data from a German handwritten Aufmaß
(measurement) sheet for a painter or floor layer (Maler/Bodenleger).

The sheet is formatted as a printed table. Column meanings (left to right):
  Bauteil        — building component label (e.g. Wand, Decke, Boden, Schrägfläche)
  LÄNGE          — primary length dimension
  BREITE         — width
  HÖHE           — height
  STCK           — piece count or additional factor/formula
  ABZUG          — deduction (window, door, recess to subtract)
  SUMME          — sum (usually empty; filled by worker sometimes)
  LV-POSITION/LEISTUNG — work item description or continuation of formula from STCK

CRITICAL: The table is rendered as markdown with | cell delimiters, but a single
handwritten expression often flows across multiple adjacent cells in one row.
Read the entire row as a unit. If a cell ends with a dangling operator (×, +, -, /)
the next non-empty cell in the same row continues the same expression.

Example row:
  | W. Fächel | 0,74 x 2,84 |  |  | + (2,84 + 0,86) / 2 x |  |  | 1,93 x 2 | 1,81 x 0,1 |
This row contains THREE entries:
  1. 0,74 x 2,84                           (Wand area)
  2. (2,84 + 0,86) / 2 × 1,93 × 2         (STCK cell ends with 'x', continues in LV-POS)
  3. 1,81 x 0,1                            (Leiste, separate entry in last column)

Rules:
- Do NOT compute arithmetic. Record operands and operator only.
- German decimal commas: preserve exactly as written ("3,86" not "3.86").
- Ambiguous glyphs: list alternatives in candidates (most-likely first).
- Struck-through entries: struck=true.
- Unreadable entries: emit with raw_text and confidence near 0.
- ABZUG column values: is_deduction=true.
- Ignore printed column headers (LÄNGE, BREITE, HÖHE, STCK, ABZUG, SUMME).
  Use Bauteil column for the bauteil field of all entries in that row group.
"""


def extract(image_bytes: bytes, mime_type: str = "image/jpeg") -> dict[str, Any]:
    """Two-step extraction: raw OCR → chat structuring.

    Returns the same dict shape as vision_client.extract() so callers can
    swap paths without interface changes:
        {"entries": [...], "_model": ..., "_structure_model": ..., "_endpoint": ...}

    Raises ExtractionError on OCR or structuring failure.
    """
    data_url = f"data:{mime_type};base64,{base64.b64encode(image_bytes).decode()}"
    client = _make_client()

    # Step 1: raw OCR
    raw_response = _ocr_raw(client, data_url)

    # Step 2: chat structuring
    markdown = raw_response.pages[0].markdown
    result = _structure(client, markdown)

    # Bbox mapping reuses the same raw OCR response
    _assign_bboxes(result.entries, raw_response)

    out = result.model_dump(mode="json")
    out["_model"] = settings.mistral_model_id
    out["_structure_model"] = _STRUCTURE_MODEL
    out["_endpoint"] = "api.mistral.ai"
    return out


def _ocr_raw(client: Mistral, data_url: str) -> Any:
    """Step 1: plain OCR, no annotation format."""
    last_exc: Exception | None = None
    for attempt, delay in enumerate([0.0] + _RETRY_DELAYS):
        if delay:
            time.sleep(delay)
        try:
            t0 = time.monotonic()
            resp = client.ocr.process(
                model=settings.mistral_model_id,
                document={"type": "image_url", "image_url": data_url},
                include_blocks=True,
                extract_header=True,
            )
            log.info(
                "two_step: OCR step %.1fs, markdown %d chars",
                time.monotonic() - t0, len(resp.pages[0].markdown),
            )
            return resp
        except Exception as exc:
            log.warning("two_step: OCR attempt %d failed: %s", attempt + 1, exc)
            last_exc = exc
    raise ExtractionError(f"OCR step unreachable after retries") from last_exc


def _structure(client: Mistral, markdown: str) -> AufmassExtractionResult:
    """Step 2: chat model structures the raw OCR markdown."""
    user_content = (
        "Here is the OCR output from a German handwritten Aufmaß sheet:\n\n"
        f"{markdown}\n\n"
        "Extract all measurement entries as JSON."
    )

    last_exc: Exception | None = None
    for attempt, delay in enumerate([0.0] + _RETRY_DELAYS):
        if delay:
            time.sleep(delay)
        try:
            t0 = time.monotonic()
            resp = client.chat.complete(
                model=_STRUCTURE_MODEL,
                messages=[
                    {"role": "system", "content": _SYSTEM_PROMPT},
                    {"role": "user", "content": user_content},
                ],
                response_format=_STRUCTURE_FORMAT,
                temperature=0.0,
            )
            elapsed = time.monotonic() - t0
            raw_json = resp.choices[0].message.content
            log.info(
                "two_step: structure step %.1fs, %d chars",
                elapsed, len(raw_json),
            )
            return AufmassExtractionResult.model_validate_json(raw_json)
        except Exception as exc:
            log.warning(
                "two_step: structure attempt %d failed: %s", attempt + 1, exc
            )
            last_exc = exc
    raise ExtractionError("structure step unreachable after retries") from last_exc
