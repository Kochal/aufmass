"""Unit tests for the UN/ECE Rec 20 unit-code mapping (api/app/einvoice/units.py)."""
from __future__ import annotations

import pytest

from app.einvoice.units import map_einheit


@pytest.mark.parametrize("einheit,expected", [
    # Area
    ("m2",       "MTK"),
    ("m²",       "MTK"),
    ("qm",       "MTK"),
    # Volume
    ("m3",       "MTQ"),
    ("m³",       "MTQ"),
    # Length
    ("m",        "MTR"),
    ("lfm",      "MTR"),
    ("lm",       "MTR"),
    # Pieces
    ("Stk",      "H87"),
    ("stck",     "H87"),
    ("Stück",    "H87"),
    # Lump-sum
    ("pauschal", "C62"),
    ("Pau",      "C62"),
    ("EP",       "C62"),
    ("psch",     "C62"),
    # Time
    ("h",        "HUR"),
    ("Std",      "HUR"),
    # Mass / volume
    ("kg",       "KGM"),
    ("t",        "TNE"),
    ("l",        "LTR"),
    # One (catch-all)
    ("1",        "C62"),
    ("ea",       "C62"),
])
def test_known_units(einheit: str, expected: str) -> None:
    assert map_einheit(einheit) == expected


def test_case_insensitive() -> None:
    assert map_einheit("M2") == "MTK"
    assert map_einheit("LFM") == "MTR"
    assert map_einheit("STK") == "H87"


def test_strips_whitespace() -> None:
    assert map_einheit("  m2  ") == "MTK"


def test_null_einheit_returns_C62() -> None:
    """Positions with no einheit are treated as a count of one (pauschal)."""
    assert map_einheit(None) == "C62"
    assert map_einheit("") == "C62"


def test_unknown_returns_none() -> None:
    """An unmapped unit must return None (→ hard check failure, not silent fallback)."""
    assert map_einheit("Fass") is None
    assert map_einheit("xyz") is None
    assert map_einheit("Doppelzentner") is None
