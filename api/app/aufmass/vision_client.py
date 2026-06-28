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
import time
from typing import Any

from mistralai import Mistral

from app.aufmass.schema import AufmassExtractionResult
from app.config import settings

log = logging.getLogger(__name__)

_TIMEOUT = 300.0
_RETRY_DELAYS = [5.0, 15.0, 45.0]

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
- Where a digit or decimal comma is ambiguous, list every plausible reading in
  the leaf's candidates list.
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
        Entries match ``AufmassEntry``; includes provenance keys for
        traceability (directive 03). The reconciler (directive 07) does
        all arithmetic and confidence-gating; this function returns raw
        candidates only.

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
    return Mistral(api_key=settings.mistral_api_key, timeout_ms=int(_TIMEOUT * 1000))


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
                document_annotation_format=AufmassExtractionResult,
                document_annotation_prompt=_ANNOTATION_PROMPT,
                confidence_scores_granularity="word",
                include_blocks=True,
                extract_header=True,
            )
            elapsed = time.monotonic() - t0
            if elapsed > 30:
                log.info("aufmass.vision_client: slow response %.0fs", elapsed)

            return _parse_annotation(response)

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
    if annotation is None:
        raise ExtractionError(
            "Mistral response has no document_annotation; "
            "check that document_annotation_format was accepted"
        )
    if isinstance(annotation, AufmassExtractionResult):
        return annotation
    if isinstance(annotation, dict):
        return AufmassExtractionResult.model_validate(annotation)
    raise ExtractionError(
        f"Unexpected document_annotation type {type(annotation).__name__}"
    )


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
