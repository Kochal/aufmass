from __future__ import annotations

from .common import ReadBase, _Base


class BankverbindungCreate(_Base):
    iban: str
    inhaber: str | None = None
    bic: str | None = None
    bank_name: str | None = None


class BankverbindungUpdate(_Base):
    row_version: int
    iban: str
    inhaber: str | None = None
    bic: str | None = None
    bank_name: str | None = None


class BankverbindungRead(ReadBase):
    iban: str
    inhaber: str | None = None
    bic: str | None = None
    bank_name: str | None = None
