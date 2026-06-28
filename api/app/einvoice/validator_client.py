"""KoSIT EN 16931 validator client.

Sends an XML document to the internal KoSIT sidecar (HTTP POST /) and parses
the VARL 1.0 response report.

The validator is reachable only from the backend over the internal Docker
network. It is NEVER a hosted external service (directive 06 / 10).

The KoSIT daemon in Daemon mode (java -jar validationtool.jar -D) accepts:
  POST /
  Content-Type: application/xml
  Body: the raw XML invoice bytes

Response: a VARL XML report. The root element carries a `valid` attribute.

VARL namespace: http://www.xoev.de/de/validator/varl/1
Root element:   <rep:report valid="true|false" ...>
"""
from __future__ import annotations

import xml.etree.ElementTree as ET
from dataclasses import dataclass, field

import httpx

from ..config import settings

_VARL_NS = "http://www.xoev.de/de/validator/varl/1"


@dataclass
class ValidationResult:
    valid: bool
    report_bytes: bytes
    messages: list[str] = field(default_factory=list)


def validate(xml_bytes: bytes) -> ValidationResult:
    """POST *xml_bytes* to the KoSIT validator and return a ValidationResult.

    The KoSIT validator uses HTTP status codes to signal document processing:
      200 — scenario matched, document valid or invalid (check report's `valid`).
      406 — no scenario matched for this document type.  Still returns a valid
            VARL report body; we parse it and treat it as valid=false.
      Other 4xx/5xx — network/server failure; raises httpx.HTTPStatusError
                       (caller maps to 503).
    """
    response = httpx.post(
        settings.validator_url,
        content=xml_bytes,
        headers={"Content-Type": "application/xml"},
        timeout=30.0,
    )
    if response.status_code == 406:
        # No scenario matched — the document type is not recognised by the
        # configured validator.  Parse the VARL body as a failure report.
        return _parse_report(response.content)
    response.raise_for_status()
    report_bytes = response.content
    return _parse_report(report_bytes)


def _parse_report(report_bytes: bytes) -> ValidationResult:
    """Parse a VARL 1.0 validation report; extract valid flag and messages."""
    try:
        root = ET.fromstring(report_bytes)
    except ET.ParseError as exc:
        return ValidationResult(
            valid=False,
            report_bytes=report_bytes,
            messages=[f"Could not parse validator report: {exc}"],
        )

    # The root <rep:report> element carries valid="true" or valid="false".
    valid_str = root.get("valid", "false").lower()
    is_valid = valid_str == "true"

    # Collect human-readable messages from the report for error detail.
    # VARL messages are <rep:message level="error" code="BR-DE-2">text...</rep:message>
    messages: list[str] = []
    for msg_el in root.iter(f"{{{_VARL_NS}}}message"):
        level = msg_el.get("level", "")
        if level in ("error", "warning"):
            text = (msg_el.text or "").strip()
            if text:
                messages.append(text)
    # Fallback: if no message elements found, include a generic hint.
    if not messages and not is_valid:
        messages.append("EN 16931 validation failed (see report for details)")

    return ValidationResult(
        valid=is_valid,
        report_bytes=report_bytes,
        messages=messages,
    )
