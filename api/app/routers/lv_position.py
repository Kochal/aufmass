from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response
from psycopg import Connection

from ..deps import Principal, db_session, get_principal
from ..engine import pricing
from ..errors import db_errors, require_row
from ..schemas.lv_position import LvPositionCreate, LvPositionRead, LvPositionUpdate

router = APIRouter(prefix="/api/lv-position", tags=["LVPosition"])

_CENT = Decimal("0.01")


def _gesamtpreis(menge: Decimal | None, einheitspreis: Decimal | None) -> Decimal | None:
    if menge is None or einheitspreis is None:
        return None
    return (menge * einheitspreis).quantize(_CENT, rounding=ROUND_HALF_UP)


def _refresh_angebot_totals(conn: Connection, lv_id: UUID) -> None:
    """After a position save/delete, recompute and store angebot-level totals.

    Only acts on draft angebote — issued documents are frozen. No row_version
    check: this is an internal recompute, not a user-edited field. The angebot
    row_version bumps via trigger so the frontend must invalidate its angebot
    query after position saves.
    """
    meta = conn.execute(
        "select a.id, a.nachlass_betrag, a.zuschlag_betrag, "
        "       t.ust_satz, t.kleinunternehmer "
        "from lv l "
        "join angebot a on a.id = l.angebot_id "
        "left join tenant_tax_profile t "
        "       on t.tenant_id = a.tenant_id and t.deleted_at is null "
        "where l.id = %s and l.deleted_at is null "
        "  and a.deleted_at is null and a.status = 'draft'",
        (str(lv_id),),
    ).fetchone()
    if meta is None:
        return

    gp_rows = conn.execute(
        "select p.gesamtpreis from lv_position p "
        "join lv l on l.id = p.lv_id "
        "where l.id = %s and p.deleted_at is null and p.gesamtpreis is not null",
        (str(lv_id),),
    ).fetchall()

    gesamtpreise = [Decimal(str(r["gesamtpreis"])) for r in gp_rows]
    ust_satz = Decimal(str(meta["ust_satz"])) if meta["ust_satz"] else Decimal("19.00")
    kleinunternehmer = bool(meta["kleinunternehmer"]) if meta["kleinunternehmer"] is not None else False

    totals = pricing.price_document(
        gesamtpreise,
        meta["nachlass_betrag"],
        meta["zuschlag_betrag"],
        ust_satz,
        kleinunternehmer,
    )
    conn.execute(
        "update angebot set summe_netto=%s, summe_brutto=%s where id=%s and deleted_at is null",
        (totals.summe_netto, totals.summe_brutto, str(meta["id"])),
    )


_SELECT_ALIVE = "select * from lv_position where deleted_at is null"


@router.get("", response_model=list[LvPositionRead])
def list_lv_position(lv_id: UUID | None = None, conn: Connection = Depends(db_session)):
    if lv_id is not None:
        return conn.execute(
            f"{_SELECT_ALIVE} and lv_id=%s order by position_nr nulls last, oz nulls last",
            (str(lv_id),),
        ).fetchall()
    return conn.execute(
        f"{_SELECT_ALIVE} order by lv_id, position_nr nulls last, oz nulls last"
    ).fetchall()


@router.get("/{id}", response_model=LvPositionRead)
def get_lv_position(id: UUID, conn: Connection = Depends(db_session)):
    row = conn.execute(f"{_SELECT_ALIVE} and id=%s", (str(id),)).fetchone()
    if row is None:
        raise HTTPException(404)
    return row


@router.post("", response_model=LvPositionRead, status_code=201)
def create_lv_position(
    body: LvPositionCreate,
    principal: Principal = Depends(get_principal),
    conn: Connection = Depends(db_session),
):
    with db_errors():
        row = conn.execute(
            "insert into lv_position("
            "  tenant_id, lv_id, oz, kurztext, langtext, menge, menge_formel, einheit,"
            "  einheitspreis, gesamtpreis, matched_leistung_id, match_confidence,"
            "  match_status, source, position_nr"
            ") values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) returning *",
            (
                str(principal.tenant_id),
                str(body.lv_id),
                body.oz,
                body.kurztext,
                body.langtext,
                body.menge,
                body.menge_formel,
                body.einheit,
                body.einheitspreis,
                _gesamtpreis(body.menge, body.einheitspreis),
                str(body.matched_leistung_id) if body.matched_leistung_id else None,
                body.match_confidence,
                body.match_status,
                body.source,
                body.position_nr,
            ),
        ).fetchone()
    _refresh_angebot_totals(conn, body.lv_id)
    return row


@router.put("/{id}", response_model=LvPositionRead)
def update_lv_position(
    id: UUID, body: LvPositionUpdate, conn: Connection = Depends(db_session)
):
    with db_errors():
        row = conn.execute(
            "update lv_position set oz=%s, kurztext=%s, langtext=%s, menge=%s, menge_formel=%s,"
            "  einheit=%s, einheitspreis=%s, gesamtpreis=%s, matched_leistung_id=%s,"
            "  match_confidence=%s, match_status=%s, source=%s, position_nr=%s "
            "where id=%s and deleted_at is null and row_version=%s returning *",
            (
                body.oz,
                body.kurztext,
                body.langtext,
                body.menge,
                body.menge_formel,
                body.einheit,
                body.einheitspreis,
                _gesamtpreis(body.menge, body.einheitspreis),
                str(body.matched_leistung_id) if body.matched_leistung_id else None,
                body.match_confidence,
                body.match_status,
                body.source,
                body.position_nr,
                str(id),
                body.row_version,
            ),
        ).fetchone()
    require_row(row, conn, "lv_position", id)
    _refresh_angebot_totals(conn, row["lv_id"])
    return row


@router.delete("/{id}", status_code=204)
def delete_lv_position(id: UUID, conn: Connection = Depends(db_session)):
    pos = conn.execute(
        "select lv_id from lv_position where id=%s and deleted_at is null", (str(id),)
    ).fetchone()
    if pos is None:
        raise HTTPException(404)
    with db_errors():
        conn.execute(
            "update lv_position set deleted_at=now(), deleted_by=core.current_actor() "
            "where id=%s and deleted_at is null", (str(id),)
        )
    _refresh_angebot_totals(conn, pos["lv_id"])
    return Response(status_code=204)
