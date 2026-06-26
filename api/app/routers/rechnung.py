from __future__ import annotations

from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response
from psycopg import Connection
from psycopg.types.json import Jsonb

from ..deps import Principal, db_session, get_principal
from ..engine import checks as check_engine
from ..engine import pricing
from ..errors import db_errors, require_row
from ..schemas.check_result import CheckResultRead
from ..schemas.rechnung import RechnungBerechnen, RechnungCreate, RechnungRead, RechnungUpdate

router = APIRouter(prefix="/api/rechnung", tags=["Rechnung"])

_SELECT_ALIVE = "select * from rechnung where deleted_at is null"


@router.get("", response_model=list[RechnungRead])
def list_rechnung(
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
        f"select * from rechnung where {where} order by created_at desc", params
    ).fetchall()


@router.get("/{id}", response_model=RechnungRead)
def get_rechnung(id: UUID, conn: Connection = Depends(db_session)):
    row = conn.execute(f"{_SELECT_ALIVE} and id=%s", (str(id),)).fetchone()
    if row is None:
        raise HTTPException(404)
    return row


@router.post("", response_model=RechnungRead, status_code=201)
def create_rechnung(
    body: RechnungCreate,
    principal: Principal = Depends(get_principal),
    conn: Connection = Depends(db_session),
):
    with db_errors():
        row = conn.execute(
            "insert into rechnung(tenant_id, auftraggeber_id, projekt_id, waehrung) "
            "values (%s,%s,%s,%s) returning *",
            (
                str(principal.tenant_id),
                str(body.auftraggeber_id) if body.auftraggeber_id else None,
                str(body.projekt_id) if body.projekt_id else None,
                body.waehrung,
            ),
        ).fetchone()
    return row


@router.put("/{id}", response_model=RechnungRead)
def update_rechnung(id: UUID, body: RechnungUpdate, conn: Connection = Depends(db_session)):
    with db_errors():
        row = conn.execute(
            "update rechnung set auftraggeber_id=%s, projekt_id=%s, waehrung=%s "
            "where id=%s and deleted_at is null and row_version=%s returning *",
            (
                str(body.auftraggeber_id) if body.auftraggeber_id else None,
                str(body.projekt_id) if body.projekt_id else None,
                body.waehrung,
                str(id),
                body.row_version,
            ),
        ).fetchone()
    require_row(row, conn, "rechnung", id)
    return row


@router.delete("/{id}", status_code=204)
def delete_rechnung(id: UUID, conn: Connection = Depends(db_session)):
    with db_errors():
        cur = conn.execute(
            "update rechnung set deleted_at=now(), deleted_by=core.current_actor() "
            "where id=%s and deleted_at is null", (str(id),)
        )
    if cur.rowcount == 0:
        raise HTTPException(404)
    return Response(status_code=204)


@router.post("/{id}/berechnen", response_model=RechnungRead)
def berechnen_rechnung(
    id: UUID,
    body: RechnungBerechnen,
    conn: Connection = Depends(db_session),
):
    """Price all rechnung_positions and compute summe_netto/summe_brutto.

    Ordering contract: berechnen → pruefen → ausstellen.
    E-invoice generation/validation is deferred to a later round.
    """
    rechnung = conn.execute(f"{_SELECT_ALIVE} and id=%s", (str(id),)).fetchone()
    if rechnung is None:
        raise HTTPException(404)
    if rechnung["status"] != "draft":
        raise HTTPException(409, detail=f"rechnung is '{rechnung['status']}' — only drafts can be recalculated")

    positions = conn.execute(
        "select * from rechnung_position where rechnung_id=%s and deleted_at is null",
        (str(id),),
    ).fetchall()

    for p in positions:
        if p.get("einheitspreis") is None or p.get("menge") is None:
            continue
        gp = pricing.price_position(Decimal(str(p["menge"])), Decimal(str(p["einheitspreis"])))
        conn.execute(
            "update rechnung_position set gesamtpreis=%s where id=%s and deleted_at is null",
            (gp, str(p["id"])),
        )

    positions_updated = conn.execute(
        "select * from rechnung_position where rechnung_id=%s and deleted_at is null",
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
            "update rechnung set summe_netto=%s, nachlass_betrag=%s, zuschlag_betrag=%s, "
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
    require_row(row, conn, "rechnung", id)
    return row


@router.post("/{id}/pruefen", response_model=list[CheckResultRead])
def pruefen_rechnung(
    id: UUID,
    principal: Principal = Depends(get_principal),
    conn: Connection = Depends(db_session),
):
    """Run deterministic sense-checks; store and return the results."""
    rechnung = conn.execute(f"{_SELECT_ALIVE} and id=%s", (str(id),)).fetchone()
    if rechnung is None:
        raise HTTPException(404)

    positions = conn.execute(
        "select * from rechnung_position where rechnung_id=%s and deleted_at is null",
        (str(id),),
    ).fetchall()

    leistung_ids = {
        str(p["leistung_id"])
        for p in positions
        if p.get("leistung_id")
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
        dict(rechnung), list(positions), ust_satz, kleinunternehmer, leistungen
    )

    conn.execute(
        "update check_result set deleted_at=now(), deleted_by=core.current_actor() "
        "where target_table='rechnung' and target_id=%s and resolved=false and deleted_at is null",
        (str(id),),
    )

    new_rows = []
    for r in results:
        row = conn.execute(
            "insert into check_result(tenant_id, target_table, target_id, rule, severity, "
            "passed, resolved, detail) values (%s,'rechnung',%s,%s,%s,%s,false,%s) returning *",
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


@router.post("/{id}/ausstellen", response_model=RechnungRead)
def ausstellen_rechnung(id: UUID, conn: Connection = Depends(db_session)):
    """Issue the rechnung: enforce the gate, allocate the gapless Rechnungsnummer, snapshot tax, freeze.

    E-invoice generation is deferred; the issued rechnung has no einvoice_artifact_id yet.
    """
    with db_errors():
        conn.execute("select core.issue_rechnung(%s)", (str(id),))
    row = conn.execute(f"{_SELECT_ALIVE} and id=%s", (str(id),)).fetchone()
    if row is None:
        raise HTTPException(404)
    return row
