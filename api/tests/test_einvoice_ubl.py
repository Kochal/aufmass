"""Unit tests for the XRechnung UBL 2.1 builder (api/app/einvoice/ubl.py).

These tests do NOT call the KoSIT validator — they only verify that the XML
structure is correct and that all mandatory BTs are present. The integration
test (test_rechnung_xrechnung.py) validates the full pipeline against KoSIT.
"""
from __future__ import annotations

import xml.etree.ElementTree as ET
from datetime import date, timedelta
from decimal import Decimal

import pytest

from app.einvoice.ubl import (
    _CAC,
    _CBC,
    _UBL_INV,
    build_xrechnung,
)


@pytest.fixture
def sample_rechnung():
    return {
        "waehrung": "EUR",
        "summe_netto": Decimal("170.00"),
        "summe_brutto": Decimal("202.30"),
        "nachlass_betrag": None,
        "zuschlag_betrag": None,
    }


@pytest.fixture
def sample_positions():
    return [
        {
            "position_nr": 1,
            "bezeichnung": "Wandfläche streichen",
            "einheit": "m2",
            "menge": Decimal("20.000"),
            "einheitspreis": Decimal("8.50"),
            "gesamtpreis": Decimal("170.00"),
        }
    ]


@pytest.fixture
def sample_seller():
    return {
        "tenant_name": "Maler Müller GmbH",
        "rechtsform": "GmbH",
        "ust_idnr": "DE123456789",
        "ust_satz": Decimal("19.00"),
        "kleinunternehmer": False,
        "ust_treatment": "regelbesteuert",
        "seller_elektronische_adresse": "rechnungen@mueller-maler.de",
        "seller_eas_scheme": "EM",
        "seller_strasse": "Musterstraße 1",
        "seller_adresszusatz": None,
        "seller_plz": "80331",
        "seller_ort": "München",
        "seller_land": "DE",
        "iban": "DE89370400440532013000",
        "bic": "COBADEFFXXX",
        "bv_inhaber": "Maler Müller GmbH",
        "kontakt_name": "Max Müller",
        "kontakt_tel": "+49 89 12345678",
        "kontakt_email": "info@mueller-maler.de",
        "zahlungsziel_tage": 30,
    }


@pytest.fixture
def sample_buyer():
    return {
        "buyer_name": "Stadtwerke München GmbH",
        "leitweg_id": "991-12345678-06",
        "buyer_elektronische_adresse": "eingang@stadtwerke-muenchen.de",
        "buyer_eas_scheme": "EM",
        "typ": "oeffentlich",
        "buyer_strasse": "Karl-Scharnagl-Ring 3",
        "buyer_adresszusatz": None,
        "buyer_plz": "80539",
        "buyer_ort": "München",
        "buyer_land": "DE",
    }


def _parse(xml_bytes: bytes) -> ET.Element:
    return ET.fromstring(xml_bytes)


def _find(root: ET.Element, *path: str) -> ET.Element | None:
    """Traverse cbc/cac path from root, returning None if missing."""
    el = root
    for step in path:
        ns = _CAC if step.startswith("cac:") else _CBC
        tag = step.split(":", 1)[-1]
        el = el.find(f"{{{ns}}}{tag}")
        if el is None:
            return None
    return el


def _text(root: ET.Element, *path: str) -> str | None:
    el = _find(root, *path)
    return el.text if el is not None else None


# ── Mandatory envelope elements ───────────────────────────────────────────────

def test_returns_bytes(sample_rechnung, sample_positions, sample_seller, sample_buyer):
    today = date.today()
    result = build_xrechnung(
        sample_rechnung, sample_positions, sample_seller, sample_buyer,
        "RE-2026-00001", today, today + timedelta(days=30), today,
    )
    assert isinstance(result, bytes)
    assert result.startswith(b"<?xml")


def test_customization_id(sample_rechnung, sample_positions, sample_seller, sample_buyer):
    today = date.today()
    root = _parse(build_xrechnung(
        sample_rechnung, sample_positions, sample_seller, sample_buyer,
        "RE-2026-00001", today, today + timedelta(days=30), today,
    ))
    val = _text(root, "cbc:CustomizationID")
    assert val and "xeinkauf.de:kosit:xrechnung_3.0" in val


def test_bt1_invoice_number(sample_rechnung, sample_positions, sample_seller, sample_buyer):
    today = date.today()
    root = _parse(build_xrechnung(
        sample_rechnung, sample_positions, sample_seller, sample_buyer,
        "RE-2026-99999", today, today + timedelta(days=30), today,
    ))
    assert _text(root, "cbc:ID") == "RE-2026-99999"


def test_bt2_issue_date(sample_rechnung, sample_positions, sample_seller, sample_buyer):
    today = date.today()
    root = _parse(build_xrechnung(
        sample_rechnung, sample_positions, sample_seller, sample_buyer,
        "NUM", today, today + timedelta(days=30), today,
    ))
    assert _text(root, "cbc:IssueDate") == today.isoformat()


def test_bt10_buyer_reference(sample_rechnung, sample_positions, sample_seller, sample_buyer):
    today = date.today()
    root = _parse(build_xrechnung(
        sample_rechnung, sample_positions, sample_seller, sample_buyer,
        "NUM", today, today + timedelta(days=30), today,
    ))
    assert _text(root, "cbc:BuyerReference") == "991-12345678-06"


# ── Seller (BG-4) ─────────────────────────────────────────────────────────────

def test_seller_name(sample_rechnung, sample_positions, sample_seller, sample_buyer):
    today = date.today()
    root = _parse(build_xrechnung(
        sample_rechnung, sample_positions, sample_seller, sample_buyer,
        "NUM", today, today + timedelta(days=30), today,
    ))
    asp = root.find(f"{{{_CAC}}}AccountingSupplierParty")
    party = asp.find(f"{{{_CAC}}}Party")
    pn = party.find(f"{{{_CAC}}}PartyName")
    assert pn.find(f"{{{_CBC}}}Name").text == "Maler Müller GmbH"


def test_seller_iban(sample_rechnung, sample_positions, sample_seller, sample_buyer):
    today = date.today()
    root = _parse(build_xrechnung(
        sample_rechnung, sample_positions, sample_seller, sample_buyer,
        "NUM", today, today + timedelta(days=30), today,
    ))
    pm = root.find(f"{{{_CAC}}}PaymentMeans")
    pfa = pm.find(f"{{{_CAC}}}PayeeFinancialAccount")
    assert pfa.find(f"{{{_CBC}}}ID").text == "DE89370400440532013000"


# ── VAT (regelbesteuert, S category) ─────────────────────────────────────────

def test_vat_category_S(sample_rechnung, sample_positions, sample_seller, sample_buyer):
    today = date.today()
    root = _parse(build_xrechnung(
        sample_rechnung, sample_positions, sample_seller, sample_buyer,
        "NUM", today, today + timedelta(days=30), today,
    ))
    tt = root.find(f"{{{_CAC}}}TaxTotal")
    tst = tt.find(f"{{{_CAC}}}TaxSubtotal")
    tc = tst.find(f"{{{_CAC}}}TaxCategory")
    assert tc.find(f"{{{_CBC}}}ID").text == "S"
    assert tc.find(f"{{{_CBC}}}Percent").text == "19.00"


def test_vat_category_E_kleinunternehmer(
    sample_rechnung, sample_positions, sample_buyer
):
    seller_klein = {
        "tenant_name": "Kleinstbetrieb UG",
        "rechtsform": "UG",
        "ust_idnr": None,
        "ust_satz": Decimal("0.00"),
        "kleinunternehmer": True,
        "ust_treatment": "kleinunternehmer",
        "seller_elektronische_adresse": "info@kleinstbetrieb.de",
        "seller_eas_scheme": "EM",
        "seller_strasse": "Teststraße 1",
        "seller_adresszusatz": None,
        "seller_plz": "12345",
        "seller_ort": "Berlin",
        "seller_land": "DE",
        "iban": "DE89370400440532013000",
        "bic": None,
        "bv_inhaber": None,
        "kontakt_name": None,
        "kontakt_tel": None,
        "kontakt_email": None,
        "zahlungsziel_tage": 30,
    }
    rechnung_zero_vat = {
        "waehrung": "EUR",
        "summe_netto": Decimal("170.00"),
        "summe_brutto": Decimal("170.00"),  # no VAT for Kleinunternehmer
        "nachlass_betrag": None,
        "zuschlag_betrag": None,
    }
    today = date.today()
    root = _parse(build_xrechnung(
        rechnung_zero_vat, sample_positions, seller_klein, sample_buyer,
        "NUM", today, today + timedelta(days=30), today,
    ))
    tt = root.find(f"{{{_CAC}}}TaxTotal")
    tst = tt.find(f"{{{_CAC}}}TaxSubtotal")
    tc = tst.find(f"{{{_CAC}}}TaxCategory")
    assert tc.find(f"{{{_CBC}}}ID").text == "E"
    # No Percent element for exempt category
    assert tc.find(f"{{{_CBC}}}Percent") is None
    # Exemption reason text present
    reason = tc.find(f"{{{_CBC}}}TaxExemptionReason")
    assert reason is not None and "§ 19 UStG" in reason.text


# ── Totals (BG-22) ────────────────────────────────────────────────────────────

def test_totals(sample_rechnung, sample_positions, sample_seller, sample_buyer):
    today = date.today()
    root = _parse(build_xrechnung(
        sample_rechnung, sample_positions, sample_seller, sample_buyer,
        "NUM", today, today + timedelta(days=30), today,
    ))
    lmt = root.find(f"{{{_CAC}}}LegalMonetaryTotal")
    assert lmt.find(f"{{{_CBC}}}TaxExclusiveAmount").text == "170.00"
    assert lmt.find(f"{{{_CBC}}}TaxInclusiveAmount").text == "202.30"
    assert lmt.find(f"{{{_CBC}}}PayableAmount").text == "202.30"


# ── Invoice lines (BG-25) ─────────────────────────────────────────────────────

def test_invoice_line_count(sample_rechnung, sample_positions, sample_seller, sample_buyer):
    today = date.today()
    root = _parse(build_xrechnung(
        sample_rechnung, sample_positions, sample_seller, sample_buyer,
        "NUM", today, today + timedelta(days=30), today,
    ))
    lines = root.findall(f"{{{_CAC}}}InvoiceLine")
    assert len(lines) == 1


def test_invoice_line_unit_code(sample_rechnung, sample_positions, sample_seller, sample_buyer):
    today = date.today()
    root = _parse(build_xrechnung(
        sample_rechnung, sample_positions, sample_seller, sample_buyer,
        "NUM", today, today + timedelta(days=30), today,
    ))
    line = root.find(f"{{{_CAC}}}InvoiceLine")
    qty = line.find(f"{{{_CBC}}}InvoicedQuantity")
    assert qty.get("unitCode") == "MTK"   # m2 → MTK
