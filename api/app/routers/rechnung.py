from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException, Response
from psycopg import Connection
from psycopg.types.json import Jsonb

from ..deps import Principal, db_session, get_principal
from ..einvoice.ubl import build_xrechnung
from ..einvoice.units import map_einheit
from ..einvoice.validator_client import validate as validate_einvoice
from ..engine import checks as check_engine
from ..engine import pricing
from ..errors import db_errors, require_row
from ..schemas.check_result import CheckResultRead
from ..schemas.rechnung import RechnungBerechnen, RechnungCreate, RechnungRead, RechnungUpdate
from ..storage import store_original

router = APIRouter(prefix="/api/rechnung", tags=["Rechnung"])

_SELECT_ALIVE = "select * from rechnung where deleted_at is null"

# ──────────────────────────────────────────────────────────────────────────────
# Shared helpers: load seller + buyer for e-invoice generation / master-data check
# ──────────────────────────────────────────────────────────────────────────────

_SELLER_QUERY = """
select
  t.name          as tenant_name,
  t.rechtsform,
  ttp.ust_idnr,
  ttp.steuernummer,
  ttp.ust_treatment,
  ttp.ust_satz,
  ttp.kleinunternehmer,
  tbp.elektronische_adresse  as seller_elektronische_adresse,
  tbp.eas_scheme             as seller_eas_scheme,
  tbp.zahlungsziel_tage,
  tbp.kontakt_name,
  tbp.kontakt_tel,
  tbp.kontakt_email,
  a.strasse  as seller_strasse,
  a.adresszusatz as seller_adresszusatz,
  a.plz      as seller_plz,
  a.ort      as seller_ort,
  a.land     as seller_land,
  bv.iban,
  bv.bic,
  bv.inhaber as bv_inhaber
from tenant t
left join tenant_tax_profile ttp
       on ttp.tenant_id = t.id and ttp.deleted_at is null
left join tenant_billing_profile tbp
       on tbp.tenant_id = t.id and tbp.deleted_at is null
left join adresse a
       on a.id = tbp.adresse_id and a.deleted_at is null
left join bankverbindung bv
       on bv.id = tbp.bankverbindung_id and bv.deleted_at is null
where t.id = core.current_tenant()
"""

_BUYER_QUERY = """
select
  ag.name  as buyer_name,
  ag.leitweg_id,
  ag.elektronische_adresse  as buyer_elektronische_adresse,
  ag.eas_scheme             as buyer_eas_scheme,
  ag.typ,
  a.strasse      as buyer_strasse,
  a.adresszusatz as buyer_adresszusatz,
  a.plz          as buyer_plz,
  a.ort          as buyer_ort,
  a.land         as buyer_land
from auftraggeber ag
left join adresse a
       on a.id = ag.adresse_id and a.deleted_at is null
where ag.id = %s and ag.deleted_at is null
"""


def _missing_einvoice_fields(
    seller: dict | None,
    buyer: dict | None,
    positions: list[dict],
) -> list[str]:
    """Return a list of missing mandatory XRechnung fields (empty = all present)."""
    missing: list[str] = []
    if not seller or not seller.get("seller_plz"):
        missing.append("tenant_billing_profile with postal address not configured")
        return missing  # no point checking sub-fields
    if not seller.get("iban"):
        missing.append("seller bankverbindung (IBAN) not configured")
    if not seller.get("seller_elektronische_adresse"):
        missing.append("seller electronic address (BT-34) not configured")
    if not seller.get("ust_idnr"):
        missing.append("seller VAT ID (ust_idnr in tenant_tax_profile) not set")
    # BR-DE-2 / BR-DE-6: BG-6 Seller Contact + BT-42 telephone are mandatory in XRechnung CIUS.
    if not seller.get("kontakt_tel"):
        missing.append("seller contact telephone (kontakt_tel in tenant_billing_profile) required by BR-DE-6")

    if buyer:
        if not buyer.get("buyer_plz"):
            missing.append("buyer postal address (adresse) not configured on auftraggeber")
        # Leitweg-ID is mandatory for B2G invoices (public buyers).
        if buyer.get("typ") == "oeffentlich" and not buyer.get("leitweg_id"):
            missing.append("leitweg_id (BT-10) required for public (B2G) buyers")

    # Unit code check: every position with a menge must have a mappable einheit.
    for p in positions:
        if p.get("menge") is not None and map_einheit(p.get("einheit")) is None:
            nr = p.get("position_nr") or "?"
            missing.append(f"position {nr}: einheit '{p.get('einheit')}' has no UN/ECE Rec 20 code")

    return missing


# ──────────────────────────────────────────────────────────────────────────────
# Standard CRUD
# ──────────────────────────────────────────────────────────────────────────────

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


# ──────────────────────────────────────────────────────────────────────────────
# Action endpoints: berechnen → pruefen → ausstellen
# ──────────────────────────────────────────────────────────────────────────────

@router.post("/{id}/berechnen", response_model=RechnungRead)
def berechnen_rechnung(
    id: UUID,
    body: RechnungBerechnen,
    conn: Connection = Depends(db_session),
):
    """Price all rechnung_positions and compute summe_netto/summe_brutto.

    Ordering contract: berechnen → pruefen → ausstellen.
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
    """Run deterministic sense-checks + e-invoice pre-validation; store and return results.

    Pure engine checks (arithmetic, completeness, etc.) run first. Then two
    additional hard checks are appended:
      - einvoice_master_data: all mandatory XRechnung party fields are present
        and every einheit maps to a UN/ECE Rec 20 code.
      - einvoice_en16931: build a preview XML (placeholder number) and validate
        it against the KoSIT sidecar. Matches the berechnen→prüfen→ausstellen
        contract; ausstellen re-validates with the real allocated number.
    """
    rechnung = conn.execute(f"{_SELECT_ALIVE} and id=%s", (str(id),)).fetchone()
    if rechnung is None:
        raise HTTPException(404)

    positions = conn.execute(
        "select * from rechnung_position where rechnung_id=%s and deleted_at is null",
        (str(id),),
    ).fetchall()

    leistung_ids = {str(p["leistung_id"]) for p in positions if p.get("leistung_id")}
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

    # ── Pure engine checks ──────────────────────────────────────────────────
    results = check_engine.run_checks(
        dict(rechnung), list(positions), ust_satz, kleinunternehmer, leistungen
    )

    # ── E-invoice master-data check ─────────────────────────────────────────
    seller = conn.execute(_SELLER_QUERY).fetchone()
    buyer = None
    if rechnung.get("auftraggeber_id"):
        buyer = conn.execute(_BUYER_QUERY, (str(rechnung["auftraggeber_id"]),)).fetchone()

    missing = _missing_einvoice_fields(seller, buyer, list(positions))
    results.append({
        "rule": "einvoice_master_data",
        "severity": "hard",
        "passed": len(missing) == 0,
        "detail": {"missing": missing} if missing else None,
    })

    # ── E-invoice EN 16931 validation (preview XML) ─────────────────────────
    en16931_passed = False
    en16931_detail: dict | None = None
    if not missing and seller and buyer:
        try:
            # Build a structurally valid preview XML (placeholder number, today's date).
            # BT-1 number is not assigned yet; neither affects EN 16931 validity.
            zahlungsziel = int(seller.get("zahlungsziel_tage") or 30)
            today = date.today()
            preview_xml = build_xrechnung(
                rechnung=dict(rechnung),
                positions=list(positions),
                seller=dict(seller),
                buyer=dict(buyer),
                rechnungsnummer="PREVIEW",
                rechnungsdatum=today,
                faelligkeitsdatum=today + timedelta(days=zahlungsziel),
                leistungsdatum=today,
            )
            val_result = validate_einvoice(preview_xml)
            en16931_passed = val_result.valid
            if not val_result.valid:
                en16931_detail = {"messages": val_result.messages[:20]}
        except httpx.HTTPError as exc:
            en16931_detail = {"error": f"validator unreachable: {exc}"}
        except Exception as exc:
            en16931_detail = {"error": f"preview build failed: {exc}"}
    else:
        en16931_detail = {"note": "skipped — master data incomplete"}

    results.append({
        "rule": "einvoice_en16931",
        "severity": "hard",
        "passed": en16931_passed,
        "detail": en16931_detail,
    })

    # ── Soft-delete prior unresolved results, insert fresh ones ─────────────
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
def ausstellen_rechnung(
    id: UUID,
    principal: Principal = Depends(get_principal),
    conn: Connection = Depends(db_session),
):
    """Issue the rechnung with a KoSIT-validated XRechnung e-invoice.

    Flow (all within one DB transaction — a rollback after step 3 reverts the
    allocated counter, burning no number):
      1. Load rechnung, positions, seller, buyer.
      2. Validate mandatory master data → 422 if missing (before any number is
         allocated, so no gap risk).
      3. assert_issuable → 409 if unresolved hard check failures.
      4. allocate_number → gapless Rechnungsnummer.
      5. build_xrechnung → UBL 2.1 XML bytes.
      6. KoSIT validate → 422 if invalid (txn rolls back, number reverts).
      7. store_original → document row + file on mounted volume.
      8. rechnung_finalize_issue → atomic draft→issued UPDATE.
    """
    # ── 1. Load rechnung ────────────────────────────────────────────────────
    rechnung = conn.execute(f"{_SELECT_ALIVE} and id=%s", (str(id),)).fetchone()
    if rechnung is None:
        raise HTTPException(404)
    if rechnung["status"] != "draft":
        raise HTTPException(409, detail=f"rechnung is '{rechnung['status']}' — only drafts can be issued")

    positions = conn.execute(
        "select * from rechnung_position where rechnung_id=%s and deleted_at is null",
        (str(id),),
    ).fetchall()

    seller = conn.execute(_SELLER_QUERY).fetchone()
    buyer = None
    if rechnung.get("auftraggeber_id"):
        buyer = conn.execute(_BUYER_QUERY, (str(rechnung["auftraggeber_id"]),)).fetchone()

    # ── 2. Validate master data BEFORE allocating a number ─────────────────
    missing = _missing_einvoice_fields(seller, buyer, list(positions))
    if missing:
        raise HTTPException(422, detail={"einvoice_master_data": missing})

    # ── 3. Deterministic gate: no unresolved hard check failures ───────────
    with db_errors():
        conn.execute("select core.assert_issuable('rechnung', %s)", (str(id),))

    # ── 4. Allocate gapless number (counter incremented in this txn) ────────
    v_num = conn.execute(
        "select core.allocate_number('rechnung') as num"
    ).fetchone()["num"]

    # ── 5. Compute dates ────────────────────────────────────────────────────
    rechnungsdatum = date.today()
    zahlungsziel = int(seller.get("zahlungsziel_tage") or 30)
    faelligkeitsdatum = rechnungsdatum + timedelta(days=zahlungsziel)
    leistungsdatum = rechnungsdatum  # default; TODO: derive from projekt/auftrag

    # ── 6. Build XRechnung and validate ─────────────────────────────────────
    xml_bytes = build_xrechnung(
        rechnung=dict(rechnung),
        positions=list(positions),
        seller=dict(seller),
        buyer=dict(buyer),
        rechnungsnummer=v_num,
        rechnungsdatum=rechnungsdatum,
        faelligkeitsdatum=faelligkeitsdatum,
        leistungsdatum=leistungsdatum,
    )

    try:
        val_result = validate_einvoice(xml_bytes)
    except httpx.HTTPError as exc:
        raise HTTPException(503, detail=f"KoSIT validator unreachable: {exc}")

    if not val_result.valid:
        # Invalid XML → txn rolls back → number reverts (no gap).
        raise HTTPException(
            422,
            detail={
                "rule": "einvoice_en16931",
                "messages": val_result.messages[:20],
            },
        )

    # ── 7. Archive originals (within same txn → FK consistent on finalize) ──
    artifact_id = store_original(
        conn, principal.tenant_id, "einvoice", xml_bytes, retention_class=10
    )
    store_original(
        conn, principal.tenant_id, "einvoice_report",
        val_result.report_bytes, retention_class=10,
    )

    # ── 8. Atomic draft→issued UPDATE (re-locks row; freeze trigger allows it) ──
    tax = seller
    conn.execute(
        "select core.rechnung_finalize_issue(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
        (
            str(id),
            v_num,
            rechnungsdatum,
            faelligkeitsdatum,
            leistungsdatum,
            tax.get("ust_treatment"),
            tax.get("ust_satz"),
            tax.get("kleinunternehmer"),
            "xrechnung",
            str(artifact_id),
        ),
    )

    row = conn.execute(f"{_SELECT_ALIVE} and id=%s", (str(id),)).fetchone()
    if row is None:
        raise HTTPException(404)
    return row
