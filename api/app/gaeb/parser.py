"""GAEB DA XML parser (directive 06 Stage 1 — deterministic, no model).

Handles GAEB DA XML 3.x files for phases X81 (LV) and X83/D83
(Angebotsaufforderung). The structure is hierarchical (nested sections);
we flatten it to a list of positions ready for lv_position import.

No model is involved: the structure is given by the standard.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from typing import Optional
import xml.etree.ElementTree as ET


@dataclass
class GaebPosition:
    oz: str
    kurztext: str
    langtext: Optional[str]
    menge: Optional[Decimal]
    einheit: Optional[str]
    einheitspreis: Optional[Decimal]
    position_nr: int


@dataclass
class GaebDocument:
    version: str
    phase: str         # '81'|'83'|'84' etc. as found in DP element
    project_name: str
    positions: list[GaebPosition] = field(default_factory=list)


class GaebParseError(ValueError):
    pass


def parse_gaeb(content: bytes) -> GaebDocument:
    """Parse GAEB DA XML bytes → GaebDocument with flattened positions.

    Raises GaebParseError on malformed input.
    """
    try:
        root = ET.fromstring(content)
    except ET.ParseError as exc:
        raise GaebParseError(f"invalid XML: {exc}") from exc

    # Extract namespace from root tag: {http://...}GAEB → http://...
    ns = ""
    if root.tag.startswith("{"):
        ns = root.tag[1:].split("}")[0]

    def t(local: str) -> str:
        return f"{{{ns}}}{local}" if ns else local

    def child_text(elem, local: str) -> str:
        e = elem.find(t(local))
        return (e.text or "").strip() if e is not None else ""

    # GAEBInfo → version + phase
    gaeb_info = root.find(t("GAEBInfo"))
    version = child_text(gaeb_info, "Vers") if gaeb_info is not None else "3.x"
    phase = ""
    if gaeb_info is not None:
        conv = gaeb_info.find(t("Conversion"))
        if conv is not None:
            phase = child_text(conv, "DP")

    # PrjInfo → project name
    prj_info = root.find(t("PrjInfo"))
    project_name = child_text(prj_info, "NamePrj") if prj_info is not None else ""

    # Positions — flattened from the Award > BoQ hierarchy
    positions: list[GaebPosition] = []
    award = root.find(t("Award"))
    if award is not None:
        boq = award.find(t("BoQ"))
        if boq is not None:
            _collect_positions(boq, t("Pos"), positions)

    if not positions:
        raise GaebParseError("no positions found — not a valid LV/Angebotsaufforderung")

    return GaebDocument(
        version=version,
        phase=phase,
        project_name=project_name,
        positions=positions,
    )


def _collect_positions(
    element,
    pos_tag: str,
    results: list[GaebPosition],
) -> None:
    """Recursively walk the BoQ tree, collecting <Pos> leaf elements."""
    for child in element:
        if child.tag == pos_tag:
            pos = _parse_pos(child, pos_tag, len(results) + 1)
            if pos is not None:
                results.append(pos)
        else:
            _collect_positions(child, pos_tag, results)


def _parse_pos(elem, pos_tag: str, position_nr: int) -> GaebPosition | None:
    # Namespace prefix used by sibling elements mirrors what's in pos_tag.
    # Extract ns from pos_tag: {ns}Pos → ns
    ns = ""
    if pos_tag.startswith("{"):
        ns = pos_tag[1:].split("}")[0]

    def t(local: str) -> str:
        return f"{{{ns}}}{local}" if ns else local

    def txt(local: str) -> str:
        e = elem.find(t(local))
        return (e.text or "").strip() if e is not None else ""

    oz = txt("PosNo")
    if not oz:
        return None  # skip malformed or group-header entries

    desc = elem.find(t("Description"))
    kurztext = ""
    langtext = None
    if desc is not None:
        short_el = desc.find(t("Short"))
        kurztext = _element_text(short_el)
        long_el = desc.find(t("Long"))
        langtext = _element_text(long_el) or None

    menge = _decimal(txt("Qty"))
    einheit = txt("QU") or None
    ep_raw = _decimal(txt("UP"))
    # UP=0.00 means "not yet priced" in incoming tenders; store as None
    einheitspreis = ep_raw if (ep_raw is not None and ep_raw > 0) else None

    return GaebPosition(
        oz=oz,
        kurztext=kurztext,
        langtext=langtext,
        menge=menge,
        einheit=einheit,
        einheitspreis=einheitspreis,
        position_nr=position_nr,
    )


def _element_text(elem) -> str:
    """Extract plain text from a possibly DTHTML element."""
    if elem is None:
        return ""
    # ElementTree text-mode serialisation strips all tags.
    raw = ET.tostring(elem, encoding="unicode", method="text")
    # Decode common HTML entities not handled by ET text mode.
    raw = raw.replace("&amp;", "&").replace("&nbsp;", " ")
    return re.sub(r"\s+", " ", raw).strip()


def _decimal(s: str) -> Decimal | None:
    if not s:
        return None
    try:
        return Decimal(s.replace(",", "."))
    except InvalidOperation:
        return None
