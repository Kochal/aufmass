"""Vision extraction client for Aufmaß sheets (directive 07a).

Sends a prepared image to Mistral Document AI and returns structured
extraction candidates. Does no arithmetic, rounding, or validation —
that is the reconciler's job (directive 07).

Compliance: Mistral Document AI is on the named EU-native processor allowlist
(directive 03). A signed DPA and no-training tier are required before first
production call — status: pending (directive 09).
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

_TIMEOUT = 300_000   # ms
_RETRY_DELAYS = [5.0, 15.0, 45.0]

# Pre-built once at import time; stable for the lifetime of the process.
_ANNOTATION_FORMAT = ResponseFormat(
    type="json_schema",
    json_schema=JSONSchema(
        name="AufmassExtractionResult",
        schema_definition=AufmassExtractionResult.model_json_schema(),
        strict=True,
    ),
)

_ANNOTATION_PROMPT = """\
You are reading a German handwritten Aufmaß (measurement) sheet from a painter or
floor layer (Maler/Bodenleger).

EXTRACT: every handwritten measurement, calculation, dimension, and label.
IGNORE: all printed column headers and grid lines — e.g. Länge, Breite, Höhe, Stück,
Menge, Anzahl, Pos., Nr., and their abbreviations. These are pre-printed form elements.

Rules:
- Do NOT compute arithmetic. Record what is written: operands and operator separately.
  Example: "3,86 × 0,74" → op="*", args with value "3,86" and "0,74".
- German decimal commas: preserve exactly as written ("3,86" not "3.86").
- Where a digit or decimal comma is ambiguous, list every plausible reading in the
  leaf's candidates list.
- Struck-through entries: include with struck=true.
- Unreadable entries: still emit with raw_text and confidence near 0.
- Group numbers by contextual proximity (same Bauteil), not by row or column.
- Windows, doors, openings that are subtracted: is_deduction=true.
"""


class ExtractionError(Exception):
    """Raised when the model is unreachable or returns an unusable response.

    The caller must route the sheet to manual review — never guess.
    """


def extract(image_bytes: bytes, mime_type: str = "image/jpeg") -> dict[str, Any]:
    """Submit one prepared Aufmaß image and return the model's raw candidates.

    Parameters
    ----------
    image_bytes:
        The prepared image (deskewed, oriented). Preprocessing is the
        caller's responsibility (directive 07).
    mime_type:
        MIME type of the image data.

    Returns
    -------
    dict
        ``{"entries": [...], "_model": ..., "_endpoint": ...}``
        Entries match ``AufmassEntry``; bbox (0..1 fractions) is populated
        where the text-match against raw OCR blocks succeeds. Provenance
        keys for traceability (directive 03). The reconciler (directive 07)
        does all arithmetic and confidence-gating.

    Raises
    ------
    ExtractionError
        When the model is unreachable after retries, or the response
        cannot be parsed as a valid annotation.
    """
    data_url = f"data:{mime_type};base64,{base64.b64encode(image_bytes).decode()}"
    client = _make_client()
    result = _call_with_retry(client, data_url)
    out = result.model_dump(mode="json")
    out["_model"] = settings.mistral_model_id
    out["_endpoint"] = "api.mistral.ai"
    return out


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _make_client() -> Mistral:
    return Mistral(api_key=settings.mistral_api_key, timeout_ms=_TIMEOUT)


def _call_with_retry(client: Mistral, data_url: str) -> AufmassExtractionResult:
    last_exc: Exception | None = None

    for attempt, delay in enumerate([0.0] + _RETRY_DELAYS):
        if delay:
            log.info("aufmass.vision_client: retry %d after %.0fs", attempt, delay)
            time.sleep(delay)

        try:
            t0 = time.monotonic()
            response = client.ocr.process(
                model=settings.mistral_model_id,
                document={"type": "image_url", "image_url": data_url},
                document_annotation_format=_ANNOTATION_FORMAT,
                document_annotation_prompt=_ANNOTATION_PROMPT,
                confidence_scores_granularity="word",
                include_blocks=True,
                extract_header=True,
            )
            elapsed = time.monotonic() - t0
            if elapsed > 30:
                log.info("aufmass.vision_client: slow response %.0fs", elapsed)

            result = _parse_annotation(response)
            _assign_bboxes(result.entries, response)
            return result

        except Exception as exc:
            status = _status_code(exc)
            if status is not None and 400 <= status < 500:
                raise ExtractionError(
                    f"Mistral API client error {status}: {exc}"
                ) from exc
            log.warning(
                "aufmass.vision_client: error on attempt %d: %s: %s",
                attempt + 1, type(exc).__name__, exc,
            )
            last_exc = exc
            continue

    raise ExtractionError(
        f"Mistral unreachable after {len(_RETRY_DELAYS) + 1} attempts"
    ) from last_exc


def _parse_annotation(response: Any) -> AufmassExtractionResult:
    """Extract and validate the structured annotation from the OCR response."""
    annotation = getattr(response, "document_annotation", None)
    if not annotation:
        raise ExtractionError(
            "Mistral response has no document_annotation; "
            "check that document_annotation_format was accepted"
        )
    if isinstance(annotation, AufmassExtractionResult):
        return annotation
    if isinstance(annotation, str):
        return AufmassExtractionResult.model_validate_json(annotation)
    if isinstance(annotation, dict):
        return AufmassExtractionResult.model_validate(annotation)
    raise ExtractionError(
        f"Unexpected document_annotation type {type(annotation).__name__}"
    )


# ---------------------------------------------------------------------------
# Bbox mapping: annotation entries → raw OCR table rows
# ---------------------------------------------------------------------------

def _assign_bboxes(entries: list[AufmassEntry], response: Any) -> None:
    """Populate entry.bbox by text-matching against the raw OCR table block.

    Mistral's document_annotation returns semantic structure without bboxes.
    Bboxes live in the raw OCR table block (one block covers the whole
    measurement table). This function estimates a per-row bbox by:
      1. Parsing the page markdown into table rows.
      2. For each annotation entry, finding the table row whose text contains
         the most of the entry's numeric tokens (most-matches wins).
      3. Computing a proportional vertical slice of the table block's bbox.
      4. Normalising pixel coords to 0..1 fractions of page dimensions.

    Entries without numeric tokens (e.g. "dito", unreadable stubs) keep
    bbox=None. The table's horizontal bounds are used as-is for all entries.
    Mutates entries in place.
    """
    pages = getattr(response, "pages", None) or []
    if not pages:
        return
    page = pages[0]

    dims = getattr(page, "dimensions", None)
    if not dims or dims.width <= 0 or dims.height <= 0:
        return

    # All handwritten measurements sit inside the one table block.
    table_block = next(
        (b for b in (getattr(page, "blocks", None) or [])
         if getattr(b, "type", "") == "table"),
        None,
    )
    if not table_block:
        log.debug("aufmass.vision_client: no table block found; bboxes not assigned")
        return

    # Parse markdown into table rows (skip separator lines and blanks).
    md = getattr(page, "markdown", "") or ""
    table_rows = [
        line for line in md.splitlines()
        if line.strip().startswith("|") and "---" not in line
    ]
    n_rows = len(table_rows)
    if n_rows == 0:
        return

    # Normalised table bounds (0..1).
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
            continue  # "dito", labels-only, or unreadable — leave bbox None
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

    log.info(
        "aufmass.vision_client: assigned bboxes to %d/%d entries via table-row match",
        assigned, len(entries),
    )


def _numeric_tokens(text: str) -> list[str]:
    """Return German-decimal numeric tokens from text (e.g. '3,86', '0,74')."""
    return re.findall(r"\d[\d,]*", text)


def _best_row(tokens: list[str], table_rows: list[str]) -> int | None:
    """Return 0-based index of the table row whose text matches the most tokens.

    Returns None if no row contains any token.
    """
    best_score, best_idx = 0, None
    for i, row in enumerate(table_rows):
        score = sum(1 for t in tokens if t in row)
        if score > best_score:
            best_score, best_idx = score, i
    return best_idx if best_score > 0 else None


def _status_code(exc: Exception) -> int | None:
    """Best-effort HTTP status code extraction from an SDK exception."""
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
