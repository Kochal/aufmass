"""Vision extraction client for Aufmaß sheets (directive 07a).

Extracts structured measurement candidates from a prepared image using a
two-step pipeline:
  1. Mistral OCR (mistral-ocr-4-0) — raw page markdown, table blocks, bboxes
  2. Mistral chat (mistral-small-latest) — structures the full markdown text
     into AufmassExtractionResult JSON

The two-step path is used because the one-step document_annotation_format
treats | table-cell delimiters as expression boundaries, splitting formulas
that workers write across the STCK and LV-POSITION columns. The chat model
reads the full row as a string and correctly joins cross-cell expressions.
See notes/aufmass/2026-06-28-two-step-benchmark.md.

Does no arithmetic, rounding, or validation — that is the reconciler's job
(directive 07). On failure raises ExtractionError; the caller routes to manual
review.
"""
from __future__ import annotations

import base64
import logging
import re
import time
from typing import Any

from mistralai.client import Mistral
from mistralai.client.models.jsonschema import JSONSchema
from mistralai.client.models.responseformat import ResponseFormat

from app.aufmass.schema import AufmassEntry, AufmassExtractionResult, Bbox
from app.config import settings

log = logging.getLogger(__name__)

_TIMEOUT = 300_000           # ms, applied to both API calls
_RETRY_DELAYS = [5.0, 15.0, 45.0]

_OCR_MODEL = settings.mistral_model_id   # "mistral-ocr-4-0"
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
  Bauteil                — building component label (Wand, Decke, Boden, Schrägfläche …)
  LÄNGE                  — primary length dimension
  BREITE                 — width
  HÖHE                   — height
  STCK                   — piece count or additional factor/formula
  ABZUG                  — deduction (window, door, recess to subtract)
  SUMME                  — sum (often empty)
  LV-POSITION/LEISTUNG   — work-item description or formula continuation from STCK

CRITICAL: The table is rendered as markdown with | cell delimiters, but a single
handwritten expression often flows across multiple adjacent cells in one row.
Read the entire row as a unit. If a cell ends with a dangling operator (×, +, -, /)
the next non-empty cell in the same row continues the same expression.

Example row:
  | W. Fächel | 0,74 x 2,84 |  |  | + (2,84 + 0,86) / 2 x |  |  | 1,93 x 2 | 1,81 x 0,1 |
This row contains THREE entries:
  1. 0,74 x 2,84                       (wall area — separate entry)
  2. (2,84 + 0,86) / 2 × 1,93 × 2     (STCK ends with ×, continues in LV-POS)
  3. 1,81 x 0,1                        (Leiste — separate entry in last column)

Rules:
- Do NOT compute arithmetic. Record operands and operator only.
- German decimal commas: preserve exactly as written ("3,86" not "3.86").
- Struck-through entries: struck=true.
- Unreadable entries: emit with raw_text and confidence near 0.
- ABZUG column values: is_deduction=true.
- Bauteil column: use as the bauteil field for all entries in that row group.
- Seite column: page/face context — record in notes if present.
- Ignore printed column-header labels (LÄNGE, BREITE, HÖHE, STCK, ABZUG, SUMME).
"""


class ExtractionError(Exception):
    """Raised when OCR or structuring is unreachable or returns unusable output.

    The caller must route the sheet to manual review — never guess.
    """


def extract(image_bytes: bytes, mime_type: str = "image/jpeg") -> dict[str, Any]:
    """Extract structured measurement candidates from one prepared Aufmaß image.

    Parameters
    ----------
    image_bytes:
        Prepared image (deskewed, oriented). Preprocessing is the caller's
        responsibility (directive 07).
    mime_type:
        MIME type of the image data.

    Returns
    -------
    dict
        ``{"entries": [...], "_model": ..., "_structure_model": ..., "_endpoint": ...}``
        Entries match ``AufmassEntry``; bbox (0..1 fractions) populated where
        text-match against raw OCR table rows succeeds. Provenance keys for
        traceability (directive 03). The reconciler does all arithmetic.

    Raises
    ------
    ExtractionError
        When either API step is unreachable after retries, or the response
        cannot be parsed as valid AufmassExtractionResult.
    """
    data_url = f"data:{mime_type};base64,{base64.b64encode(image_bytes).decode()}"
    client = _make_client()

    ocr_response = _ocr(client, data_url)
    markdown = ocr_response.pages[0].markdown
    result = _structure(client, markdown)
    _assign_bboxes(result.entries, ocr_response)

    out = result.model_dump(mode="json")
    out["_model"] = _OCR_MODEL
    out["_structure_model"] = _STRUCTURE_MODEL
    out["_endpoint"] = "api.mistral.ai"
    return out


# ---------------------------------------------------------------------------
# Step 1: raw OCR
# ---------------------------------------------------------------------------

def _ocr(client: Mistral, data_url: str) -> Any:
    last_exc: Exception | None = None
    for attempt, delay in enumerate([0.0] + _RETRY_DELAYS):
        if delay:
            log.info("vision_client: OCR retry %d after %.0fs", attempt, delay)
            time.sleep(delay)
        try:
            t0 = time.monotonic()
            resp = client.ocr.process(
                model=_OCR_MODEL,
                document={"type": "image_url", "image_url": data_url},
                include_blocks=True,
                extract_header=True,
            )
            log.info(
                "vision_client: OCR %.1fs  markdown %d chars",
                time.monotonic() - t0, len(resp.pages[0].markdown),
            )
            return resp
        except Exception as exc:
            status = _status_code(exc)
            if status is not None and 400 <= status < 500:
                raise ExtractionError(f"OCR API error {status}: {exc}") from exc
            log.warning("vision_client: OCR attempt %d: %s", attempt + 1, exc)
            last_exc = exc
    raise ExtractionError("OCR unreachable after retries") from last_exc


# ---------------------------------------------------------------------------
# Step 2: chat structuring
# ---------------------------------------------------------------------------

def _structure(client: Mistral, markdown: str) -> AufmassExtractionResult:
    user_content = (
        "Here is the OCR output from a German handwritten Aufmaß sheet:\n\n"
        f"{markdown}\n\n"
        "Extract all measurement entries as JSON."
    )
    last_exc: Exception | None = None
    for attempt, delay in enumerate([0.0] + _RETRY_DELAYS):
        if delay:
            log.info("vision_client: structure retry %d after %.0fs", attempt, delay)
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
            raw_json = resp.choices[0].message.content
            log.info(
                "vision_client: structure %.1fs  %d chars",
                time.monotonic() - t0, len(raw_json),
            )
            return AufmassExtractionResult.model_validate_json(raw_json)
        except Exception as exc:
            status = _status_code(exc)
            if status is not None and 400 <= status < 500:
                raise ExtractionError(f"structure API error {status}: {exc}") from exc
            log.warning("vision_client: structure attempt %d: %s", attempt + 1, exc)
            last_exc = exc
    raise ExtractionError("structure step unreachable after retries") from last_exc


# ---------------------------------------------------------------------------
# Bbox mapping: entries → raw OCR table rows
# ---------------------------------------------------------------------------

def _assign_bboxes(entries: list[AufmassEntry], ocr_response: Any) -> None:
    """Populate entry.bbox by matching numeric tokens against raw OCR table rows.

    Estimates a per-row bbox by finding which table row in the page markdown
    contains the most of an entry's German-decimal numeric tokens, then
    computing a proportional vertical slice of the table block's pixel bbox
    and normalising to 0..1 fractions of page dimensions.

    Entries with no numeric tokens (e.g. "dito", unreadable stubs) keep
    bbox=None. Mutates entries in place.
    """
    pages = getattr(ocr_response, "pages", None) or []
    if not pages:
        return
    page = pages[0]

    dims = getattr(page, "dimensions", None)
    if not dims or dims.width <= 0 or dims.height <= 0:
        return

    table_block = next(
        (b for b in (getattr(page, "blocks", None) or [])
         if getattr(b, "type", "") == "table"),
        None,
    )
    if not table_block:
        log.debug("vision_client: no table block; bboxes not assigned")
        return

    md = getattr(page, "markdown", "") or ""
    table_rows = [
        line for line in md.splitlines()
        if line.strip().startswith("|") and "---" not in line
    ]
    n_rows = len(table_rows)
    if n_rows == 0:
        return

    w, h = dims.width, dims.height
    tbl_x1 = table_block.top_left_x / w
    tbl_y1 = table_block.top_left_y / h
    tbl_x2 = table_block.bottom_right_x / w
    tbl_y2 = table_block.bottom_right_y / h
    row_h = (tbl_y2 - tbl_y1) / n_rows

    assigned = 0
    for entry in entries:
        tokens = _numeric_tokens(entry.raw_text)
        if not tokens:
            continue
        row_idx = _best_row(tokens, table_rows)
        if row_idx is None:
            continue
        y1 = tbl_y1 + row_idx * row_h
        y2 = y1 + row_h
        entry.bbox = Bbox(
            x1=round(tbl_x1, 4),
            y1=round(max(0.0, y1), 4),
            x2=round(tbl_x2, 4),
            y2=round(min(1.0, y2), 4),
        )
        assigned += 1

    log.info("vision_client: assigned bboxes %d/%d", assigned, len(entries))


def _numeric_tokens(text: str) -> list[str]:
    """Return German-decimal numeric tokens from text (e.g. '3,86', '0,74')."""
    return re.findall(r"\d[\d,]*", text)


def _best_row(tokens: list[str], table_rows: list[str]) -> int | None:
    """Return 0-based index of the table row matching the most tokens."""
    best_score, best_idx = 0, None
    for i, row in enumerate(table_rows):
        score = sum(1 for t in tokens if t in row)
        if score > best_score:
            best_score, best_idx = score, i
    return best_idx if best_score > 0 else None


# ---------------------------------------------------------------------------
# Shared utilities
# ---------------------------------------------------------------------------

def _make_client() -> Mistral:
    return Mistral(api_key=settings.mistral_api_key, timeout_ms=_TIMEOUT)


def _status_code(exc: Exception) -> int | None:
    for attr in ("status_code", "http_status", "status"):
        v = getattr(exc, attr, None)
        if isinstance(v, int):
            return v
    resp = getattr(exc, "response", None)
    if resp is not None:
        v = getattr(resp, "status_code", None)
        if isinstance(v, int):
            return v
    return None
