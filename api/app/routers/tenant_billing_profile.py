"""Tenant billing profile — seller-party identity for e-invoice generation.

1:1 with tenant; upserted (create or update) via POST /api/tenant-billing-profile.
The profile is always referenced by tenant_id, not by its own UUID, since there
is at most one per tenant.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from psycopg import Connection

from ..deps import Principal, db_session, get_principal
from ..errors import db_errors
from ..schemas.tenant_billing_profile import (
    TenantBillingProfileCreate,
    TenantBillingProfileRead,
    TenantBillingProfileUpdate,
)

router = APIRouter(prefix="/api/tenant-billing-profile", tags=["TenantBillingProfile"])

_SELECT_ALIVE = "select * from tenant_billing_profile where deleted_at is null"


@router.get("", response_model=TenantBillingProfileRead)
def get_billing_profile(conn: Connection = Depends(db_session)):
    """Return the current tenant's billing profile (404 if not yet configured)."""
    row = conn.execute(f"{_SELECT_ALIVE}").fetchone()
    if row is None:
        raise HTTPException(404, detail="billing profile not configured")
    return row


@router.post("", response_model=TenantBillingProfileRead, status_code=201)
def create_billing_profile(
    body: TenantBillingProfileCreate,
    principal: Principal = Depends(get_principal),
    conn: Connection = Depends(db_session),
):
    """Create the billing profile. Returns 409 if one already exists (use PUT)."""
    with db_errors():
        row = conn.execute(
            "insert into tenant_billing_profile("
            "  tenant_id, adresse_id, bankverbindung_id, elektronische_adresse,"
            "  eas_scheme, kontakt_name, kontakt_tel, kontakt_email, zahlungsziel_tage"
            ") values (%s,%s,%s,%s,%s,%s,%s,%s,%s) returning *",
            (
                str(principal.tenant_id),
                str(body.adresse_id) if body.adresse_id else None,
                str(body.bankverbindung_id) if body.bankverbindung_id else None,
                body.elektronische_adresse,
                body.eas_scheme,
                body.kontakt_name,
                body.kontakt_tel,
                body.kontakt_email,
                body.zahlungsziel_tage,
            ),
        ).fetchone()
    return row


@router.put("", response_model=TenantBillingProfileRead)
def update_billing_profile(
    body: TenantBillingProfileUpdate,
    conn: Connection = Depends(db_session),
):
    """Update the billing profile (optimistic concurrency via row_version)."""
    with db_errors():
        row = conn.execute(
            "update tenant_billing_profile "
            "set adresse_id=%s, bankverbindung_id=%s, elektronische_adresse=%s,"
            "    eas_scheme=%s, kontakt_name=%s, kontakt_tel=%s, kontakt_email=%s,"
            "    zahlungsziel_tage=%s "
            "where deleted_at is null and row_version=%s returning *",
            (
                str(body.adresse_id) if body.adresse_id else None,
                str(body.bankverbindung_id) if body.bankverbindung_id else None,
                body.elektronische_adresse,
                body.eas_scheme,
                body.kontakt_name,
                body.kontakt_tel,
                body.kontakt_email,
                body.zahlungsziel_tage,
                body.row_version,
            ),
        ).fetchone()
    if row is None:
        raise HTTPException(409, detail="stale row_version – reload and retry")
    return row
