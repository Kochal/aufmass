from __future__ import annotations

from datetime import date
from decimal import Decimal

from .common import ReadBase, _Base


class TenantTaxProfileUpsert(_Base):
    kleinunternehmer: bool = False
    ust_treatment: str = "regelbesteuert"
    ust_satz: Decimal = Decimal("19.00")
    ust_idnr: str | None = None
    steuernummer: str | None = None
    turnover_band: str | None = None
    einvoice_issue_required_from: date | None = None


class TenantTaxProfileRead(ReadBase):
    kleinunternehmer: bool
    ust_treatment: str
    ust_satz: Decimal
    ust_idnr: str | None = None
    steuernummer: str | None = None
    turnover_band: str | None = None
    einvoice_issue_required_from: date | None = None
