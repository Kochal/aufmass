"""Deterministic sense-check engine (directive 06 Stage 4).

Runs DB-independently; each result is returned as a dict ready for INSERT into
check_result. Both angebot and rechnung use summe_netto/summe_brutto (standardised
in migration 0021); no per-table column aliasing needed.

Implemented:
  arithmetic  (hard) — re-derives every gesamtpreis and the document totals.
  zero_guard  (hard) — no zero/negative einheitspreis on a priced position.
  unit        (soft) — position einheit matches the matched leistung's einheit.
  completeness (hard) — every position is priced and not in review/unmatched.

Deferred (not emitted here):
  gaeb_roundtrip — needs the parsed GAEB source; deferred to GAEB-import round.
  plausibility   — needs price history; deferred to cold-start resolution.
"""
from __future__ import annotations

from decimal import Decimal
from typing import Any, TypedDict

from .pricing import price_document, price_position


class CheckRow(TypedDict):
    rule: str
    severity: str
    passed: bool
    detail: dict[str, Any] | None


def _check_arithmetic(
    positions: list[dict],
    doc: dict,
    ust_satz: Decimal,
    kleinunternehmer: bool,
) -> CheckRow:
    mismatches: list[dict] = []
    gesamtpreise: list[Decimal] = []

    for p in positions:
        if p.get("einheitspreis") is not None and p.get("menge") is not None:
            expected = price_position(
                Decimal(str(p["menge"])), Decimal(str(p["einheitspreis"]))
            )
            stored = Decimal(str(p["gesamtpreis"])) if p.get("gesamtpreis") is not None else None
            if stored != expected:
                mismatches.append({
                    "oz": p.get("oz") or p.get("position_nr"),
                    "expected": str(expected),
                    "stored": str(stored),
                })
            gesamtpreise.append(expected)
        elif p.get("gesamtpreis") is not None:
            gesamtpreise.append(Decimal(str(p["gesamtpreis"])))

    totals = price_document(
        gesamtpreise,
        Decimal(str(doc["nachlass_betrag"])) if doc.get("nachlass_betrag") else None,
        Decimal(str(doc["zuschlag_betrag"])) if doc.get("zuschlag_betrag") else None,
        ust_satz,
        kleinunternehmer,
    )
    stored_netto = doc.get("summe_netto")
    stored_brutto = doc.get("summe_brutto")
    if stored_netto is not None and Decimal(str(stored_netto)) != totals.summe_netto:
        mismatches.append({
            "field": "summe_netto",
            "expected": str(totals.summe_netto),
            "stored": str(stored_netto),
        })
    if stored_brutto is not None and Decimal(str(stored_brutto)) != totals.summe_brutto:
        mismatches.append({
            "field": "summe_brutto",
            "expected": str(totals.summe_brutto),
            "stored": str(stored_brutto),
        })

    passed = len(mismatches) == 0
    return CheckRow(
        rule="arithmetic",
        severity="hard",
        passed=passed,
        detail={"mismatches": mismatches} if mismatches else None,
    )


def _check_zero_guard(positions: list[dict]) -> CheckRow:
    bad = [
        {"oz": p.get("oz") or p.get("position_nr")}
        for p in positions
        if p.get("einheitspreis") is not None and Decimal(str(p["einheitspreis"])) <= 0
    ]
    return CheckRow(
        rule="zero_guard",
        severity="hard",
        passed=len(bad) == 0,
        detail={"positions": bad} if bad else None,
    )


def _check_unit(positions: list[dict], leistungen: dict[str, dict]) -> CheckRow:
    mismatches = [
        {
            "oz": p.get("oz") or p.get("position_nr"),
            "position_einheit": p["einheit"],
            "leistung_einheit": leistungen[str(p["matched_leistung_id"])]["einheit"],
        }
        for p in positions
        if (
            p.get("matched_leistung_id")
            and str(p["matched_leistung_id"]) in leistungen
            and p.get("einheit")
            and leistungen[str(p["matched_leistung_id"])].get("einheit")
            and p["einheit"] != leistungen[str(p["matched_leistung_id"])]["einheit"]
        )
    ]
    return CheckRow(
        rule="unit",
        severity="soft",
        passed=len(mismatches) == 0,
        detail={"mismatches": mismatches} if mismatches else None,
    )


def _check_completeness(positions: list[dict]) -> CheckRow:
    incomplete = [
        {"oz": p.get("oz") or p.get("position_nr"), "match_status": p.get("match_status")}
        for p in positions
        if p.get("gesamtpreis") is None or p.get("match_status") in ("review", "unmatched")
    ]
    return CheckRow(
        rule="completeness",
        severity="hard",
        passed=len(incomplete) == 0,
        detail={"incomplete": incomplete} if incomplete else None,
    )


def run_checks(
    doc: dict,
    positions: list[dict],
    ust_satz: Decimal,
    kleinunternehmer: bool,
    leistungen: dict[str, dict] | None = None,
) -> list[CheckRow]:
    """Run all applicable deterministic checks for an angebot or rechnung.

    leistungen: {str(leistung_id): leistung_row} for the unit check; pass empty
    dict if no matched leistungen are loaded (unit check will trivially pass).
    """
    return [
        _check_arithmetic(positions, doc, ust_satz, kleinunternehmer),
        _check_zero_guard(positions),
        _check_unit(positions, leistungen or {}),
        _check_completeness(positions),
    ]
