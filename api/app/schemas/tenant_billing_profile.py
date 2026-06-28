from __future__ import annotations

from uuid import UUID

from .common import ReadBase, _Base


class TenantBillingProfileCreate(_Base):
    adresse_id: UUID | None = None
    bankverbindung_id: UUID | None = None
    elektronische_adresse: str | None = None
    eas_scheme: str = "EM"
    kontakt_name: str | None = None
    kontakt_tel: str | None = None
    kontakt_email: str | None = None
    zahlungsziel_tage: int = 30


class TenantBillingProfileUpdate(_Base):
    row_version: int
    adresse_id: UUID | None = None
    bankverbindung_id: UUID | None = None
    elektronische_adresse: str | None = None
    eas_scheme: str = "EM"
    kontakt_name: str | None = None
    kontakt_tel: str | None = None
    kontakt_email: str | None = None
    zahlungsziel_tage: int = 30


class TenantBillingProfileRead(ReadBase):
    tenant_id: UUID
    adresse_id: UUID | None = None
    bankverbindung_id: UUID | None = None
    elektronische_adresse: str | None = None
    eas_scheme: str
    kontakt_name: str | None = None
    kontakt_tel: str | None = None
    kontakt_email: str | None = None
    zahlungsziel_tage: int
