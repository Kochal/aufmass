from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from psycopg import Connection

from ..deps import Principal, db_session, get_principal
from ..errors import db_errors
from ..schemas.tenant_tax_profile import TenantTaxProfileRead, TenantTaxProfileUpsert

router = APIRouter(prefix="/api/tenant-tax-profile", tags=["TenantTaxProfile"])


@router.get("", response_model=TenantTaxProfileRead)
def get_tax_profile(conn: Connection = Depends(db_session)):
    row = conn.execute(
        "select * from tenant_tax_profile where deleted_at is null"
    ).fetchone()
    if row is None:
        raise HTTPException(404, detail="no tax profile configured for this tenant")
    return row


@router.put("", response_model=TenantTaxProfileRead)
def upsert_tax_profile(
    body: TenantTaxProfileUpsert,
    principal: Principal = Depends(get_principal),
    conn: Connection = Depends(db_session),
):
    with db_errors():
        row = conn.execute(
            "insert into tenant_tax_profile("
            "  tenant_id, kleinunternehmer, ust_treatment, ust_satz,"
            "  ust_idnr, steuernummer, turnover_band, einvoice_issue_required_from"
            ") values (%s,%s,%s,%s,%s,%s,%s,%s)"
            " on conflict (tenant_id) do update set"
            "  kleinunternehmer=excluded.kleinunternehmer,"
            "  ust_treatment=excluded.ust_treatment,"
            "  ust_satz=excluded.ust_satz,"
            "  ust_idnr=excluded.ust_idnr,"
            "  steuernummer=excluded.steuernummer,"
            "  turnover_band=excluded.turnover_band,"
            "  einvoice_issue_required_from=excluded.einvoice_issue_required_from"
            " returning *",
            (
                str(principal.tenant_id),
                body.kleinunternehmer,
                body.ust_treatment,
                body.ust_satz,
                body.ust_idnr,
                body.steuernummer,
                body.turnover_band,
                body.einvoice_issue_required_from,
            ),
        ).fetchone()
    return row
