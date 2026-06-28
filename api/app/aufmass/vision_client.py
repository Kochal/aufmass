"""Vision extraction client for Aufmaß sheets (directive 07a).

Sends a prepared image to the OpenAI-compatible model endpoint and returns
raw extraction candidates. Does no arithmetic, rounding, or validation —
that is the reconciler's job (directive 07).
"""
from __future__ import annotations

import base64
import json
import logging
import time
from pathlib import Path
from typing import Any

import openai

from app.config import settings

log = logging.getLogger(__name__)

_PROMPT = (Path(__file__).parent / "extraction_prompt.md").read_text(encoding="utf-8")

_TIMEOUT = 300.0          # generous: cold-start model download can be slow
_RETRY_DELAYS = [5.0, 15.0, 45.0]  # backoff between network-error retries


class ExtractionError(Exception):
    """Raised when the model is unreachable or its output cannot be parsed.

    The caller must route the sheet to manual review — never guess.
    """


def extract(image_bytes: bytes, mime_type: str = "image/jpeg") -> dict[str, Any]:
    """Submit one prepared Aufmaß image and return the model's raw JSON.

    Parameters
    ----------
    image_bytes:
        The prepared image (deskewed, oriented, within max_pixels budget).
        Preprocessing is the caller's responsibility (directive 07).
    mime_type:
        MIME type of the image data.

    Returns
    -------
    dict
        Parsed extraction JSON as returned by the model, plus provenance keys
        ``_model`` and ``_endpoint`` for traceability (directive 03).

    Raises
    ------
    ExtractionError
        When the model is unreachable after retries, or its output cannot be
        parsed as valid JSON even after one re-ask.
    """
    data_url = f"data:{mime_type};base64,{base64.b64encode(image_bytes).decode()}"
    client = _make_client()
    result = _call_with_retry(client, data_url)
    result["_model"] = settings.model_name
    result["_endpoint"] = settings.model_endpoint
    return result


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _salvage_truncated(raw: str) -> dict[str, Any] | None:
    """Recover complete entries from a JSON response cut off mid-entry."""
    text = _strip_fences(raw)
    # Walk backwards to find the last complete entry (ends with '}')
    # then close the entries array and root object.
    for cut in (text.rfind("},"), text.rfind("}")):
        if cut == -1:
            continue
        candidate = text[: cut + 1] + "\n  ]\n}"
        try:
            parsed = json.loads(candidate)
            n = len(parsed.get("entries", []))
            log.warning("aufmass.vision_client: salvaged %d entries from truncated response", n)
            return parsed
        except ValueError:
            continue
    return None


def _strip_fences(text: str) -> str:
    """Remove markdown code fences that models add despite being told not to."""
    text = text.strip()
    if text.startswith("```"):
        text = text[text.index("\n") + 1:] if "\n" in text else text[3:]
    if text.endswith("```"):
        text = text[: text.rfind("```")]
    return text.strip()


def _make_client() -> openai.OpenAI:
    return openai.OpenAI(
        base_url=settings.model_endpoint,
        api_key=settings.model_api_key or "unused",
        timeout=_TIMEOUT,
    )


def _build_messages(data_url: str) -> list[dict[str, Any]]:
    return [
        {
            "role": "user",
            "content": [
                {"type": "image_url", "image_url": {"url": data_url}},
                {"type": "text", "text": _PROMPT},
            ],
        }
    ]


def _completion(client: openai.OpenAI, messages: list[dict[str, Any]]) -> tuple[str, str]:
    """Returns (content, finish_reason)."""
    t0 = time.monotonic()
    kwargs: dict[str, Any] = {}
    if settings.model_guided_json:
        kwargs["response_format"] = {"type": "json_object"}
    resp = client.chat.completions.create(
        model=settings.model_name,
        messages=messages,  # type: ignore[arg-type]
        temperature=0,
        **kwargs,
    )
    elapsed = time.monotonic() - t0
    if elapsed > 60:
        log.info("aufmass.vision_client: slow response %.0fs (cold start?)", elapsed)
    choice = resp.choices[0]
    finish_reason = choice.finish_reason or "stop"
    if finish_reason == "length":
        log.warning(
            "aufmass.vision_client: output truncated (finish_reason=length) — "
            "model hit context limit; partial entries will be salvaged"
        )
    raw = choice.message.content or ""
    return raw, finish_reason


def _call_with_retry(client: openai.OpenAI, data_url: str) -> dict[str, Any]:
    messages = _build_messages(data_url)
    last_exc: Exception | None = None

    for attempt, delay in enumerate([0.0] + _RETRY_DELAYS):
        if delay:
            log.info("aufmass.vision_client: retry %d after %.0fs", attempt, delay)
            time.sleep(delay)

        try:
            raw, finish_reason = _completion(client, messages)
        except (openai.APITimeoutError, openai.APIConnectionError) as exc:
            log.warning("aufmass.vision_client: %s on attempt %d", type(exc).__name__, attempt + 1)
            last_exc = exc
            continue
        except openai.APIStatusError as exc:
            if exc.status_code < 500:
                raise
            log.warning(
                "aufmass.vision_client: HTTP %d on attempt %d: %s",
                exc.status_code, attempt + 1, exc.message,
            )
            last_exc = exc
            continue

        try:
            return json.loads(_strip_fences(raw))
        except ValueError:
            if finish_reason == "length":
                # Don't re-ask: sending the huge truncated response back would overflow context.
                recovered = _salvage_truncated(raw)
                if recovered is not None:
                    return recovered
                raise ExtractionError("Output truncated and JSON unrecoverable; reduce image size or use larger model")
            log.warning("aufmass.vision_client: parse failure on attempt %d, re-asking once", attempt + 1)
            follow_up = messages + [
                {"role": "assistant", "content": raw},
                {"role": "user", "content": "Return only valid JSON matching the schema. No prose, no markdown."},
            ]
            try:
                raw2, _ = _completion(client, follow_up)
                return json.loads(_strip_fences(raw2))
            except ValueError:
                raise ExtractionError(f"Unparseable JSON after re-ask: {raw[:200]!r}")
            except (openai.APITimeoutError, openai.APIConnectionError, openai.APIStatusError) as exc:
                last_exc = exc
                continue  # fall back into retry loop

    raise ExtractionError(
        f"Model unreachable after {len(_RETRY_DELAYS) + 1} attempts"
    ) from last_exc
