"""Unit tests for the deterministic pricing engine (no DB, no network)."""
from __future__ import annotations

from decimal import Decimal

import pytest

from app.engine.pricing import DocumentTotals, price_document, price_position


def test_price_position_basic():
    assert price_position(Decimal("10.000"), Decimal("8.50")) == Decimal("85.00")


def test_price_position_rounding_half_up():
    # 3.333 * 1.005 = 3.349965 → rounds to 3.35
    assert price_position(Decimal("3.333"), Decimal("1.005")) == Decimal("3.35")


def test_price_position_zero_menge():
    assert price_position(Decimal("0.000"), Decimal("8.50")) == Decimal("0.00")


def test_price_document_regelbesteuert():
    totals = price_document(
        [Decimal("100.00"), Decimal("50.00")],
        nachlass_betrag=None,
        zuschlag_betrag=None,
        ust_satz=Decimal("19.00"),
        kleinunternehmer=False,
    )
    assert totals.summe_netto == Decimal("150.00")
    assert totals.nachlass_betrag == Decimal("0.00")
    assert totals.zuschlag_betrag == Decimal("0.00")
    # 150 * 1.19 = 178.50
    assert totals.summe_brutto == Decimal("178.50")


def test_price_document_kleinunternehmer():
    totals = price_document(
        [Decimal("200.00")],
        nachlass_betrag=None,
        zuschlag_betrag=None,
        ust_satz=Decimal("19.00"),
        kleinunternehmer=True,
    )
    assert totals.summe_netto == Decimal("200.00")
    assert totals.summe_brutto == Decimal("200.00")  # no tax


def test_price_document_with_nachlass():
    totals = price_document(
        [Decimal("1000.00")],
        nachlass_betrag=Decimal("100.00"),
        zuschlag_betrag=None,
        ust_satz=Decimal("19.00"),
        kleinunternehmer=False,
    )
    assert totals.summe_netto == Decimal("1000.00")
    assert totals.nachlass_betrag == Decimal("100.00")
    # netto_adj = 1000 - 100 = 900; brutto = 900 * 1.19 = 1071.00
    assert totals.summe_brutto == Decimal("1071.00")


def test_price_document_with_zuschlag():
    totals = price_document(
        [Decimal("500.00")],
        nachlass_betrag=None,
        zuschlag_betrag=Decimal("50.00"),
        ust_satz=Decimal("19.00"),
        kleinunternehmer=False,
    )
    # netto_adj = 550; brutto = 550 * 1.19 = 654.50
    assert totals.summe_brutto == Decimal("654.50")


def test_price_document_empty_positions():
    totals = price_document(
        [],
        nachlass_betrag=None,
        zuschlag_betrag=None,
        ust_satz=Decimal("19.00"),
        kleinunternehmer=False,
    )
    assert totals.summe_netto == Decimal("0.00")
    assert totals.summe_brutto == Decimal("0.00")
