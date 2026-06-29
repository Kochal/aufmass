"""GAEB DA XML D84 (Angebotsabgabe) exporter (directive 06 Stage 6).

Generates a GAEB DA XML 3.1 bid-submission document from the lv_position rows
of an issued or draft Angebot. The XML is stored as a write-once original
(document table) and returned to the caller as bytes.

The GAEB D84 is the artifact of record when GAEB is the exchange format
(directive 06); a human-readable PDF is only a rendering.
"""
from __future__ import annotations

import xml.etree.ElementTree as ET
from datetime import date
from decimal import Decimal
from typing import Any


_GAEB_NS = "http://www.gaeb.de/GAEB_DA_XML/3.1"


def build_d84(
    angebot: dict[str, Any],
    positions: list[dict[str, Any]],
    project_name: str = "",
) -> bytes:
    """Build a GAEB DA XML 3.1 D84 document and return it as UTF-8 XML bytes.

    Parameters
    ----------
    angebot:      angebot row (for totals and number)
    positions:    lv_position rows, ordered by position_nr / oz
    project_name: optional project name for PrjInfo
    """
    ET.register_namespace("", _GAEB_NS)
    root = ET.Element(f"{{{_GAEB_NS}}}GAEB")

    # ── GAEBInfo ─────────────────────────────────────────────────────────────
    gaeb_info = ET.SubElement(root, f"{{{_GAEB_NS}}}GAEBInfo")
    _sub(gaeb_info, "Vers", "3.1")
    _sub(gaeb_info, "Date", date.today().isoformat())
    conv = ET.SubElement(gaeb_info, f"{{{_GAEB_NS}}}Conversion")
    _sub(conv, "DP", "84")

    # ── PrjInfo ──────────────────────────────────────────────────────────────
    if project_name:
        prj = ET.SubElement(root, f"{{{_GAEB_NS}}}PrjInfo")
        _sub(prj, "NamePrj", project_name)

    # ── Award > BoQ ──────────────────────────────────────────────────────────
    award = ET.SubElement(root, f"{{{_GAEB_NS}}}Award")
    boq = ET.SubElement(award, f"{{{_GAEB_NS}}}BoQ")
    boq_body = ET.SubElement(boq, f"{{{_GAEB_NS}}}BoQBody")

    total_gp = Decimal("0.00")
    for p in positions:
        pos_el = ET.SubElement(boq_body, f"{{{_GAEB_NS}}}Pos")
        _sub(pos_el, "PosNo", p.get("oz") or str(p.get("position_nr", "")))

        desc = ET.SubElement(pos_el, f"{{{_GAEB_NS}}}Description")
        if p.get("kurztext"):
            _sub(desc, "Short", p["kurztext"])
        if p.get("langtext"):
            _sub(desc, "Long", p["langtext"])

        if p.get("menge") is not None:
            _sub(pos_el, "Qty", f"{Decimal(str(p['menge'])):.3f}")
        if p.get("einheit"):
            _sub(pos_el, "QU", p["einheit"])

        ep = Decimal(str(p["einheitspreis"])) if p.get("einheitspreis") is not None else Decimal("0.00")
        _sub(pos_el, "UP", f"{ep:.2f}")

        gp = Decimal(str(p["gesamtpreis"])) if p.get("gesamtpreis") is not None else Decimal("0.00")
        _sub(pos_el, "GP", f"{gp:.2f}")
        total_gp += gp

        _sub(pos_el, "T", "N")

    # ── BoQ totals ───────────────────────────────────────────────────────────
    boq_total = ET.SubElement(boq, f"{{{_GAEB_NS}}}BoQTotal")
    if angebot.get("summe_netto") is not None:
        _sub(boq_total, "TotGP", f"{Decimal(str(angebot['summe_netto'])):.2f}")
    else:
        _sub(boq_total, "TotGP", f"{total_gp:.2f}")

    _indent(root)
    return b'<?xml version="1.0" encoding="UTF-8"?>\n' + ET.tostring(
        root, encoding="unicode"
    ).encode("utf-8")


def _sub(parent, local: str, text: str) -> ET.Element:
    el = ET.SubElement(parent, f"{{{_GAEB_NS}}}{local}")
    el.text = text
    return el


def _indent(elem: ET.Element, level: int = 0) -> None:
    """Add pretty-print indentation in-place (Python 3.9+ has ET.indent; use manual fallback)."""
    try:
        ET.indent(elem, space="  ")
    except AttributeError:
        # Python < 3.9 fallback
        pad = "\n" + "  " * level
        if len(elem):
            elem.text = pad + "  "
            elem.tail = pad
            for child in elem:
                _indent(child, level + 1)
            child.tail = pad  # type: ignore[possibly-undefined]
        else:
            elem.tail = pad
