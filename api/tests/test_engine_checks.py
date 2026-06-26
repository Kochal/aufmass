"""Unit tests for the deterministic sense-check engine (no DB, no network)."""
from __future__ import annotations

from decimal import Decimal

from app.engine.checks import run_checks


def _pos(oz, menge, ep, gp, status="confirmed", einheit="m2", matched_leistung_id=None):
    return {
        "oz": oz,
        "menge": Decimal(str(menge)) if menge is not None else None,
        "einheitspreis": Decimal(str(ep)) if ep is not None else None,
        "gesamtpreis": Decimal(str(gp)) if gp is not None else None,
        "match_status": status,
        "einheit": einheit,
        "matched_leistung_id": matched_leistung_id,
        "position_nr": None,
    }


def _doc(netto, brutto, nachlass=None, zuschlag=None):
    return {"summe_netto": netto, "summe_brutto": brutto,
            "nachlass_betrag": nachlass, "zuschlag_betrag": zuschlag}


UST = Decimal("19.00")


def test_all_pass():
    positions = [_pos("01", 10, 8.50, 85.00)]
    doc = _doc(Decimal("85.00"), Decimal("101.15"))
    results = run_checks(doc, positions, UST, False)
    assert all(r["passed"] for r in results)


def test_arithmetic_mismatch_fails_hard():
    # gesamtpreis stored wrong: 85 but should be 85.00
    positions = [_pos("01", 10, 8.50, 99.00)]  # wrong gesamtpreis
    doc = _doc(Decimal("99.00"), Decimal("117.81"))  # built from wrong value
    results = {r["rule"]: r for r in run_checks(doc, positions, UST, False)}
    assert results["arithmetic"]["passed"] is False
    assert results["arithmetic"]["severity"] == "hard"


def test_zero_guard_fails_hard():
    positions = [_pos("01", 10, 0, 0.00)]
    doc = _doc(Decimal("0.00"), Decimal("0.00"))
    results = {r["rule"]: r for r in run_checks(doc, positions, UST, False)}
    assert results["zero_guard"]["passed"] is False
    assert results["zero_guard"]["severity"] == "hard"


def test_negative_price_fails_zero_guard():
    positions = [_pos("01", 10, -5.00, -50.00)]
    doc = _doc(Decimal("-50.00"), Decimal("-59.50"))
    results = {r["rule"]: r for r in run_checks(doc, positions, UST, False)}
    assert results["zero_guard"]["passed"] is False


def test_unit_mismatch_soft():
    lid = "aaaaaaaa-0000-0000-0000-000000000001"
    positions = [_pos("01", 10, 8.50, 85.00, einheit="lfm", matched_leistung_id=lid)]
    doc = _doc(Decimal("85.00"), Decimal("101.15"))
    leistungen = {lid: {"einheit": "m2"}}
    results = {r["rule"]: r for r in run_checks(doc, positions, UST, False, leistungen)}
    assert results["unit"]["passed"] is False
    assert results["unit"]["severity"] == "soft"


def test_unit_match_passes():
    lid = "aaaaaaaa-0000-0000-0000-000000000001"
    positions = [_pos("01", 10, 8.50, 85.00, einheit="m2", matched_leistung_id=lid)]
    doc = _doc(Decimal("85.00"), Decimal("101.15"))
    leistungen = {lid: {"einheit": "m2"}}
    results = {r["rule"]: r for r in run_checks(doc, positions, UST, False, leistungen)}
    assert results["unit"]["passed"] is True


def test_completeness_gap_fails_hard():
    positions = [_pos("01", 10, 8.50, 85.00), _pos("02", None, None, None, status="review")]
    doc = _doc(Decimal("85.00"), Decimal("101.15"))
    results = {r["rule"]: r for r in run_checks(doc, positions, UST, False)}
    assert results["completeness"]["passed"] is False
    assert results["completeness"]["severity"] == "hard"


def test_completeness_unmatched_fails():
    positions = [_pos("01", 10, 8.50, 85.00, status="unmatched")]
    doc = _doc(Decimal("85.00"), Decimal("101.15"))
    results = {r["rule"]: r for r in run_checks(doc, positions, UST, False)}
    assert results["completeness"]["passed"] is False


def test_kleinunternehmer_arithmetic():
    positions = [_pos("01", 10, 8.50, 85.00)]
    doc = _doc(Decimal("85.00"), Decimal("85.00"))  # no tax
    results = {r["rule"]: r for r in run_checks(doc, positions, UST, True)}
    assert results["arithmetic"]["passed"] is True
