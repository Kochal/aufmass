"""Simple string-similarity catalog matcher.

Compares LV-position Kurztext to Leistung Kurztext using a combined score of
token-Jaccard overlap and difflib SequenceMatcher ratio.  No embeddings, no
model.  This is explicitly a *partial* implementation: it handles exact-ish
phrasing ("Wände streichen 2×" → "Wände streichen") but will miss synonyms
and domain abbreviations ("WF anstr." → "Wandfläche anstreichen").  The full
implementation requires sentence embeddings trained on German construction
vocabulary; that is deferred until the GPU pipeline is live.

Thresholds chosen conservatively so reviewers rarely see a bad auto-match:
  ≥ 0.80  → match_status = 'auto'    (high confidence, system suggestion)
  ≥ 0.55  → match_status = 'review'  (has suggestion, reviewer decides)
  < 0.55  → leave unmatched

The reviewer must still confirm every position (even 'auto').  No price or
quantity is committed without human confirmation.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from difflib import SequenceMatcher
from decimal import Decimal
from typing import Optional


_PUNCT = re.compile(r"[^\w\s]")
_WS = re.compile(r"\s+")

# Stop-words frequent in German construction that add noise to similarity.
_STOP = {
    "und", "oder", "mit", "ohne", "nach", "din", "ral", "inkl",
    "einschl", "je", "pro", "zzgl", "ca", "gem", "entspr",
}


def _normalize(text: str) -> str:
    t = _PUNCT.sub(" ", text.lower())
    t = _WS.sub(" ", t).strip()
    return t


def _token_overlap(a: str, b: str) -> float:
    """Jaccard similarity on non-stop word sets."""
    wa = {w for w in _normalize(a).split() if w not in _STOP and len(w) > 1}
    wb = {w for w in _normalize(b).split() if w not in _STOP and len(w) > 1}
    if not wa or not wb:
        return 0.0
    return len(wa & wb) / len(wa | wb)


def _seq_ratio(a: str, b: str) -> float:
    return SequenceMatcher(None, _normalize(a), _normalize(b)).ratio()


def score(pos_kurztext: str, lei_kurztext: str) -> float:
    """Combined similarity: average of token-Jaccard and sequence ratio."""
    return (_token_overlap(pos_kurztext, lei_kurztext) +
            _seq_ratio(pos_kurztext, lei_kurztext)) / 2


AUTO_THRESHOLD = 0.80
REVIEW_THRESHOLD = 0.55


@dataclass
class MatchResult:
    leistung_id: Optional[str]
    confidence: Optional[Decimal]
    new_status: str   # 'auto' | 'review' | 'unmatched'
    method: str       # 'string_similarity' | 'none'


def best_match(pos_kurztext: str, leistungen: list[dict]) -> MatchResult:
    """Find the best-scoring catalog entry for *pos_kurztext*.

    *leistungen* is a list of dicts with at least 'id' and 'kurztext'.
    """
    if not leistungen or not pos_kurztext:
        return MatchResult(None, None, "unmatched", "none")

    best_id: Optional[str] = None
    best_score: float = 0.0
    for l in leistungen:
        s = score(pos_kurztext, l["kurztext"] or "")
        if s > best_score:
            best_score = s
            best_id = l["id"]

    if best_score >= AUTO_THRESHOLD:
        return MatchResult(
            best_id,
            Decimal(str(round(best_score, 4))),
            "auto",
            "string_similarity",
        )
    if best_score >= REVIEW_THRESHOLD:
        return MatchResult(
            best_id,
            Decimal(str(round(best_score, 4))),
            "review",
            "string_similarity",
        )
    return MatchResult(None, None, "unmatched", "none")
