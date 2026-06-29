from __future__ import annotations
from decimal import Decimal
from pydantic import BaseModel


class DashboardSummary(BaseModel):
    # Projekte
    projekte_in_ausfuehrung: int
    projekte_kalkulation: int
    projekte_beauftragt: int
    projekte_gewaehrleistung: int

    # Mängel
    maengel_offen: int
    maengel_offen_schwer: int
    maengel_ueberfaellig: int

    # Gewährleistung
    gewaehrleistung_laufend: int
    gewaehrleistung_expiring_soon: int   # laufend, frist_ende ≤ 90 days
    gewaehrleistung_ueberfaellig: int    # laufend, frist_ende < today

    # Rechnungen
    rechnungen_entwurf: int
    rechnungen_ausgestellt: int
    rechnungen_summe_brutto: Decimal | None

    # Freigabe queue
    arbeitszeit_offen: int
    fahrt_offen: int

    # Bestellungen (active = entwurf/bestellt/teilgeliefert)
    bestellungen_offen: int

    # Angebote im Entwurf
    angebote_entwurf: int
