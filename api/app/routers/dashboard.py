from fastapi import APIRouter, Depends
from psycopg import Connection

from ..deps import db_session
from ..schemas.dashboard import DashboardSummary

router = APIRouter(prefix="/api/dashboard", tags=["Dashboard"])


@router.get("", response_model=DashboardSummary)
def get_dashboard(conn: Connection = Depends(db_session)):
    row = conn.execute("""
        WITH
        proj AS (
            SELECT
                count(*) FILTER (WHERE status = 'in_ausfuehrung')   AS in_ausfuehrung,
                count(*) FILTER (WHERE status = 'kalkulation')      AS kalkulation,
                count(*) FILTER (WHERE status = 'beauftragt')       AS beauftragt,
                count(*) FILTER (WHERE status = 'gewaehrleistung')  AS gewaehrleistung
            FROM projekt WHERE deleted_at IS NULL
        ),
        mng AS (
            SELECT
                count(*) FILTER (WHERE status = 'offen')                                          AS offen,
                count(*) FILTER (WHERE status = 'offen' AND schwere = 'schwer')                   AS offen_schwer,
                count(*) FILTER (WHERE status = 'offen' AND frist IS NOT NULL AND frist < CURRENT_DATE) AS ueberfaellig
            FROM mangel WHERE deleted_at IS NULL
        ),
        gw AS (
            SELECT
                count(*) FILTER (WHERE status = 'laufend')                                                              AS laufend,
                count(*) FILTER (WHERE status = 'laufend' AND frist_ende >= CURRENT_DATE AND frist_ende <= CURRENT_DATE + INTERVAL '90 days') AS expiring_soon,
                count(*) FILTER (WHERE status = 'laufend' AND frist_ende < CURRENT_DATE)                                AS ueberfaellig
            FROM gewaehrleistung WHERE deleted_at IS NULL
        ),
        rech AS (
            SELECT
                count(*) FILTER (WHERE status = 'draft')   AS entwurf,
                count(*) FILTER (WHERE status = 'issued')  AS ausgestellt,
                sum(summe_brutto) FILTER (WHERE status = 'issued') AS summe_brutto
            FROM rechnung WHERE deleted_at IS NULL
        ),
        az AS (
            SELECT count(*) AS offen FROM arbeitszeit WHERE deleted_at IS NULL AND freigabe_status = 'offen'
        ),
        ft AS (
            SELECT count(*) AS offen FROM fahrt WHERE deleted_at IS NULL AND freigabe_status = 'offen'
        ),
        bs AS (
            SELECT count(*) AS offen FROM bestellung WHERE deleted_at IS NULL AND status IN ('entwurf', 'bestellt', 'teilgeliefert')
        ),
        ang AS (
            SELECT count(*) AS entwurf FROM angebot WHERE deleted_at IS NULL AND status = 'draft'
        )
        SELECT
            (SELECT in_ausfuehrung  FROM proj),
            (SELECT kalkulation     FROM proj),
            (SELECT beauftragt      FROM proj),
            (SELECT gewaehrleistung FROM proj),
            (SELECT offen           FROM mng),
            (SELECT offen_schwer    FROM mng),
            (SELECT ueberfaellig    FROM mng),
            (SELECT laufend         FROM gw),
            (SELECT expiring_soon   FROM gw),
            (SELECT ueberfaellig    FROM gw),
            (SELECT entwurf         FROM rech),
            (SELECT ausgestellt     FROM rech),
            (SELECT summe_brutto    FROM rech),
            (SELECT offen           FROM az),
            (SELECT offen           FROM ft),
            (SELECT offen           FROM bs),
            (SELECT entwurf         FROM ang)
    """).fetchone()

    (
        p_in_ausfuehrung, p_kalkulation, p_beauftragt, p_gewaehrleistung,
        m_offen, m_schwer, m_ueberfaellig,
        gw_laufend, gw_soon, gw_ueberfaellig,
        r_entwurf, r_ausgestellt, r_summe,
        az_offen, ft_offen, bs_offen, ang_entwurf,
    ) = row

    return DashboardSummary(
        projekte_in_ausfuehrung=p_in_ausfuehrung or 0,
        projekte_kalkulation=p_kalkulation or 0,
        projekte_beauftragt=p_beauftragt or 0,
        projekte_gewaehrleistung=p_gewaehrleistung or 0,
        maengel_offen=m_offen or 0,
        maengel_offen_schwer=m_schwer or 0,
        maengel_ueberfaellig=m_ueberfaellig or 0,
        gewaehrleistung_laufend=gw_laufend or 0,
        gewaehrleistung_expiring_soon=gw_soon or 0,
        gewaehrleistung_ueberfaellig=gw_ueberfaellig or 0,
        rechnungen_entwurf=r_entwurf or 0,
        rechnungen_ausgestellt=r_ausgestellt or 0,
        rechnungen_summe_brutto=r_summe,
        arbeitszeit_offen=az_offen or 0,
        fahrt_offen=ft_offen or 0,
        bestellungen_offen=bs_offen or 0,
        angebote_entwurf=ang_entwurf or 0,
    )
