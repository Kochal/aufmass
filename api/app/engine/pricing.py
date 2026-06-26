"""Deterministic pricing engine (directive 06 Stage 3).

All money arithmetic lives here — nowhere else. The model never computes a price;
the DB stores and gates, but does not compute. Inputs are Decimal (psycopg maps
numeric → Decimal). All amounts use HALF_UP rounding to cent precision.
"""
from __future__ import annotations

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from typing import Sequence

_CENT = Decimal("0.01")


def _q(d: Decimal) -> Decimal:
    return d.quantize(_CENT, rounding=ROUND_HALF_UP)


def price_position(menge: Decimal, einheitspreis: Decimal) -> Decimal:
    """gesamtpreis = menge * einheitspreis, rounded to cent."""
    return _q(menge * einheitspreis)


@dataclass
class DocumentTotals:
    summe_netto: Decimal
    nachlass_betrag: Decimal
    zuschlag_betrag: Decimal
    summe_brutto: Decimal


def price_document(
    gesamtpreise: Sequence[Decimal],
    nachlass_betrag: Decimal | None,
    zuschlag_betrag: Decimal | None,
    ust_satz: Decimal,
    kleinunternehmer: bool,
) -> DocumentTotals:
    """Compute document-level totals from position totals and tenant tax profile.

    nachlass/zuschlag are absolute Beträge (numeric(12,2) columns), not percentages.
    v1 does not support percentage-based adjustments.
    """
    nachlass = _q(nachlass_betrag or Decimal("0.00"))
    zuschlag = _q(zuschlag_betrag or Decimal("0.00"))
    summe_netto = _q(sum(gesamtpreise, Decimal("0.00")))
    netto_adj = summe_netto + zuschlag - nachlass
    if kleinunternehmer:
        summe_brutto = netto_adj
    else:
        summe_brutto = _q(netto_adj * (1 + ust_satz / Decimal("100")))
    return DocumentTotals(
        summe_netto=summe_netto,
        nachlass_betrag=nachlass,
        zuschlag_betrag=zuschlag,
        summe_brutto=summe_brutto,
    )
