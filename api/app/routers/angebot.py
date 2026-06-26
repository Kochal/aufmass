from __future__ import annotations

import json
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response
from psycopg import Connection
from psycopg.types.json import Jsonb

from ..deps import Principal, db_session, get_principal
from ..engine import checks as check_engine
from ..engine import pricing
from ..errors import db_errors, require_row
from ..schemas.angebot import AngebotBerechnen, AngebotCreate, AngebotRead, AngebotUpdate
from ..schemas.check_result import CheckResultRead

router = APIRouter(prefix="/api/angebot", tags=["Angebot"])

_SELECT_ALIVE = "select * from angebot where deleted_at is null"


@router.get("", response_model=list[AngebotRead])
def list_angebot(
    status: str | None = None,
    auftraggeber_id: UUID | None = None,
    projekt_id: UUID | None = None,
    conn: Connection = Depends(db_session),
):
    clauses = ["deleted_at is null"]
    params: list = []
    if status is not None:
        clauses.append("status=%s"); params.append(status)
    if auftraggeber_id is not None:
        clauses.append("auftraggeber_id=%s"); params.append(str(auftraggeber_id))
    if projekt_id is not None:
        clauses.append("projekt_id=%s"); params.append(str(projekt_id))
    where = " and ".join(clauses)
    return conn.execute(
        f"select * from angebot where {where} order by created_at desc", params
    ).fetchall()


@router.get("/{id}", response_model=AngebotRead)
def get_angebot(id: UUID, conn: Connection = Depends(db_session)):
    row = conn.execute(f"{_SELECT_ALIVE} and id=%s", (str(id),)).fetchone()
    if row is None:
        raise HTTPException(404)
    return row


@router.post("", response_model=AngebotRead, status_code=201)
def create_angebot(
    body: AngebotCreate,
    principal: Principal = Depends(get_principal),
    conn: Connection = Depends(db_session),
):
    with db_errors():
        row = conn.execute(
            "insert into angebot(tenant_id, auftraggeber_id, projekt_id, waehrung) "
            "values (%s,%s,%s,%s) returning *",
            (
                str(principal.tenant_id),
                str(body.auftraggeber_id),
                str(body.projekt_id) if body.projekt_id else None,
                body.waehrung,
            ),
        ).fetchone()
    return row


@router.put("/{id}", response_model=AngebotRead)
def update_angebot(id: UUID, body: AngebotUpdate, conn: Connection = Depends(db_session)):
    with db_errors():
        row = conn.execute(
            "update angebot set auftraggeber_id=%s, projekt_id=%s, waehrung=%s "
            "where id=%s and deleted_at is null and row_version=%s returning *",
            (
                str(body.auftraggeber_id),
                str(body.projekt_id) if body.projekt_id else None,
                body.waehrung,
                str(id),
                body.row_version,
            ),
        ).fetchone()
    require_row(row, conn, "angebot", id)
    return row


@router.delete("/{id}", status_code=204)
def delete_angebot(id: UUID, conn: Connection = Depends(db_session)):
    with db_errors():
        cur = conn.execute(
            "update angebot set deleted_at=now(), deleted_by=core.current_actor() "
            "where id=%s and deleted_at is null", (str(id),)
        )
    if cur.rowcount == 0:
        raise HTTPException(404)
    return Response(status_code=204)


@router.post("/{id}/berechnen", response_model=AngebotRead)
def berechnen_angebot(
    id: UUID,
    body: AngebotBerechnen,
    conn: Connection = Depends(db_session),
):
    """Price all LV positions and compute document totals.

    Fills einheitspreis from the matched leistung when the position has none.
    Ordering contract: berechnen → pruefen → ausstellen.
    """
    angebot = conn.execute(f"{_SELECT_ALIVE} and id=%s", (str(id),)).fetchone()
    if angebot is None:
        raise HTTPException(404)
    if angebot["status"] != "draft":
        raise HTTPException(409, detail=f"angebot is '{angebot['status']}' — only drafts can be recalculated")

    positions = conn.execute(
        "select p.* from lv_position p join lv l on l.id=p.lv_id "
        "where l.angebot_id=%s and p.deleted_at is null",
        (str(id),),
    ).fetchall()

    # Collect leistungen for positions that need their einheitspreis filled in.
    fill_ids = {
        str(p["matched_leistung_id"])
        for p in positions
        if p.get("matched_leistung_id") and not p.get("einheitspreis")
    }
    leistungen: dict[str, dict] = {}
    if fill_ids:
        rows = conn.execute(
            "select id, einheitspreis, einheit from leistung "
            "where id = any(%s::uuid[]) and deleted_at is null",
            (list(fill_ids),),
        ).fetchall()
        leistungen = {str(r["id"]): r for r in rows}

    for p in positions:
        ep = p.get("einheitspreis")
        if ep is None and p.get("matched_leistung_id"):
            lk = leistungen.get(str(p["matched_leistung_id"]))
            if lk and lk.get("einheitspreis") is not None:
                ep = lk["einheitspreis"]
        if ep is None or p.get("menge") is None:
            continue
        gp = pricing.price_position(Decimal(str(p["menge"])), Decimal(str(ep)))
        conn.execute(
            "update lv_position set einheitspreis=%s, gesamtpreis=%s, "
            "pricing_rule='menge*einheitspreis' "
            "where id=%s and deleted_at is null",
            (ep, gp, str(p["id"])),
        )

    # Re-fetch after position updates.
    positions_updated = conn.execute(
        "select p.* from lv_position p join lv l on l.id=p.lv_id "
        "where l.angebot_id=%s and p.deleted_at is null",
        (str(id),),
    ).fetchall()

    tax = conn.execute(
        "select ust_satz, kleinunternehmer from tenant_tax_profile where deleted_at is null"
    ).fetchone()
    ust_satz = Decimal(str(tax["ust_satz"])) if tax else Decimal("19.00")
    kleinunternehmer = bool(tax["kleinunternehmer"]) if tax else False

    gesamtpreise = [
        Decimal(str(p["gesamtpreis"]))
        for p in positions_updated
        if p.get("gesamtpreis") is not None
    ]
    totals = pricing.price_document(
        gesamtpreise, body.nachlass_betrag, body.zuschlag_betrag, ust_satz, kleinunternehmer
    )

    with db_errors():
        row = conn.execute(
            "update angebot set summe_netto=%s, nachlass_betrag=%s, zuschlag_betrag=%s, "
            "summe_brutto=%s "
            "where id=%s and deleted_at is null and row_version=%s returning *",
            (
                totals.summe_netto,
                totals.nachlass_betrag,
                totals.zuschlag_betrag,
                totals.summe_brutto,
                str(id),
                body.row_version,
            ),
        ).fetchone()
    require_row(row, conn, "angebot", id)
    return row


@router.post("/{id}/pruefen", response_model=list[CheckResultRead])
def pruefen_angebot(
    id: UUID,
    principal: Principal = Depends(get_principal),
    conn: Connection = Depends(db_session),
):
    """Run the deterministic sense-checks; store and return the results."""
    angebot = conn.execute(f"{_SELECT_ALIVE} and id=%s", (str(id),)).fetchone()
    if angebot is None:
        raise HTTPException(404)

    positions = conn.execute(
        "select p.* from lv_position p join lv l on l.id=p.lv_id "
        "where l.angebot_id=%s and p.deleted_at is null",
        (str(id),),
    ).fetchall()

    leistung_ids = {
        str(p["matched_leistung_id"])
        for p in positions
        if p.get("matched_leistung_id")
    }
    leistungen: dict[str, dict] = {}
    if leistung_ids:
        rows = conn.execute(
            "select id, einheit from leistung "
            "where id = any(%s::uuid[]) and deleted_at is null",
            (list(leistung_ids),),
        ).fetchall()
        leistungen = {str(r["id"]): r for r in rows}

    tax = conn.execute(
        "select ust_satz, kleinunternehmer from tenant_tax_profile where deleted_at is null"
    ).fetchone()
    ust_satz = Decimal(str(tax["ust_satz"])) if tax else Decimal("19.00")
    kleinunternehmer = bool(tax["kleinunternehmer"]) if tax else False

    results = check_engine.run_checks(
        dict(angebot), list(positions), ust_satz, kleinunternehmer, leistungen
    )

    # Soft-delete prior unresolved engine-generated results for this document.
    conn.execute(
        "update check_result set deleted_at=now(), deleted_by=core.current_actor() "
        "where target_table='angebot' and target_id=%s and resolved=false and deleted_at is null",
        (str(id),),
    )

    new_rows = []
    for r in results:
        row = conn.execute(
            "insert into check_result(tenant_id, target_table, target_id, rule, severity, "
            "passed, resolved, detail) values (%s,'angebot',%s,%s,%s,%s,false,%s) returning *",
            (
                str(principal.tenant_id),
                str(id),
                r["rule"],
                r["severity"],
                r["passed"],
                Jsonb(r["detail"]) if r["detail"] is not None else None,
            ),
        ).fetchone()
        new_rows.append(row)

    return new_rows


@router.post("/{id}/ausstellen", response_model=AngebotRead)
def ausstellen_angebot(id: UUID, conn: Connection = Depends(db_session)):
    """Issue the angebot: enforce the gate, allocate the Angebotsnummer, snapshot tax, freeze."""
    with db_errors():
        conn.execute("select core.issue_angebot(%s)", (str(id),))
    row = conn.execute(f"{_SELECT_ALIVE} and id=%s", (str(id),)).fetchone()
    if row is None:
        raise HTTPException(404)
    return row


@router.post("/{id}/version", response_model=AngebotRead, status_code=201)
def neue_version_angebot(id: UUID, conn: Connection = Depends(db_session)):
    """Create the next version of an issued angebot (the prior becomes superseded)."""
    with db_errors():
        result = conn.execute("select core.new_angebot_version(%s)", (str(id),)).fetchone()
    if result is None:
        raise HTTPException(404)
    new_id = list(result.values())[0]
    row = conn.execute(f"{_SELECT_ALIVE} and id=%s", (str(new_id),)).fetchone()
    if row is None:
        raise HTTPException(404)
    return row
