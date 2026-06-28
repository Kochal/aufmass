"""UN/ECE Recommendation 20 unit code mapping for XRechnung line items.

EN 16931 (BT-150) requires each invoice line to carry a UN/ECE Rec 20 unit
code. This module maps the free-text einheit values used in the Maler- und
Bodenbelagsbetrieb trade to the corresponding codes.

If an einheit does not appear in UN_ECE_MAP the calling code should treat it
as a hard check failure (einvoice_master_data) so the reviewer sees it before
attempting issue rather than learning at XML validation time.

Reference: https://unece.org/trade/uncefact/cl-recommendations (Rec 20 Rev 17+)

DECISION (2026-06-28): start with the unit set used in this trade; extend as
new leistungen are added. Unmapped → hard check, NOT a silent fallback to C62,
because the wrong unit code changes the semantics of the quantity field.
"""
from __future__ import annotations

# Canonical form → UN/ECE Rec 20 code.
# Keys are lower-cased and stripped before lookup (see map_einheit()).
UN_ECE_MAP: dict[str, str] = {
    # Area
    "m2":        "MTK",   # square metre (painting, floor covering)
    "m²":        "MTK",
    "qm":        "MTK",
    # Volume
    "m3":        "MTQ",   # cubic metre (bulk materials)
    "m³":        "MTQ",
    # Length / linear metre
    "m":         "MTR",   # metre (generic)
    "lfm":       "MTR",   # Laufmeter / running metre (Sockelleiste, Bordüre)
    "lm":        "MTR",
    # Pieces / each
    "stk":       "H87",   # piece / Stück
    "stck":      "H87",
    "stück":     "H87",
    "st":        "H87",
    "pcs":       "H87",
    # Lump-sum / pauschal (treated as "one" per EN 16931 guidance)
    "pauschal":  "C62",
    "psch":      "C62",
    "pau":       "C62",
    "ep":        "C62",   # Einheitspauschal
    "ls":        "C62",   # lump sum
    # Time
    "h":         "HUR",   # hour
    "std":       "HUR",   # Stunde
    "stunde":    "HUR",
    "min":       "MIN",   # minute
    # Mass
    "kg":        "KGM",   # kilogram
    "t":         "TNE",   # metric ton (tonne)
    "g":         "GRM",   # gram
    # Volume (liquid)
    "l":         "LTR",   # litre (e.g. paint)
    "ltr":       "LTR",
    "ml":        "MLT",   # millilitre
    # Rolls / package
    "rolle":     "RO",    # roll
    "rl":        "RO",
    "pak":       "PA",    # packet
    "sack":      "SA",    # bag/sack
    # One / each (catch-all for discrete countable items not covered above)
    "1":         "C62",
    "ea":        "C62",
}


def map_einheit(einheit: str | None) -> str | None:
    """Return the UN/ECE Rec 20 code for *einheit*, or None if unmapped.

    None means a hard check failure — do not silently substitute.
    An absent / null einheit is treated as 'C62' (one) because some
    pauschal positions carry no explicit unit.
    """
    if not einheit:
        return "C62"
    return UN_ECE_MAP.get(einheit.strip().lower())
