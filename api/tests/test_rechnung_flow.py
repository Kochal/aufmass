"""Integration tests for the rechnung issue flow.

draft → berechnen → pruefen → ausstellen (gapless number).
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def ag_id(client: TestClient):
    """Create an auftraggeber with postal address + Leitweg-ID.

    Since 0022, ausstellen requires all mandatory XRechnung party data:
    seller billing profile (seeded for T1) + buyer postal address + Leitweg-ID
    (required for public / B2G buyers). Private buyers without a Leitweg-ID
    can still be issued invoices when the einvoice_en16931 check passes.
    We use a public buyer here to exercise the full gate.
    """
    from app.seed import T1_ID, T1_USER_ID
    h = {"X-Tenant-Id": T1_ID, "X-User-Id": T1_USER_ID}
    # Create a postal address for the buyer.
    r = client.post("/api/adresse", json={
        "strasse": "Testgasse 1", "plz": "10115", "ort": "Berlin"
    }, headers=h)
    assert r.status_code == 201
    adresse_id = r.json()["id"]
    # Public buyer with address + Leitweg-ID so XRechnung validation passes.
    r = client.post("/api/auftraggeber", json={
        "name": "Rechnung-Test AG",
        "typ": "oeffentlich",
        "adresse_id": adresse_id,
        "leitweg_id": "991-99999999-06",
        "elektronische_adresse": "rechnungen@rechnung-test.de",
    }, headers=h)
    assert r.status_code == 201
    return r.json()["id"]


def test_rechnung_full_flow(client: TestClient, ag_id):
    from app.seed import T1_ID, T1_USER_ID
    h = {"X-Tenant-Id": T1_ID, "X-User-Id": T1_USER_ID}

    # 1. Draft rechnung.
    r = client.post("/api/rechnung", json={"auftraggeber_id": ag_id}, headers=h)
    assert r.status_code == 201
    rec = r.json()
    rec_id = rec["id"]
    assert rec["status"] == "draft"

    # 2. Add a position.
    r = client.post("/api/rechnung-position", json={
        "rechnung_id": rec_id,
        "bezeichnung": "Wandflächen streichen",
        "einheit": "m2",
        "einheitspreis": "8.50",
        "menge": "20.000",
        "position_nr": 1,
    }, headers=h)
    assert r.status_code == 201

    # 3. berechnen.
    r = client.post(f"/api/rechnung/{rec_id}/berechnen",
                    json={"row_version": rec["row_version"]}, headers=h)
    assert r.status_code == 200
    rec = r.json()
    assert rec["summe_netto"] == "170.00"            # 20 * 8.50
    assert rec["summe_brutto"] == "202.30"           # 170 * 1.19

    # 4. pruefen — all checks pass.
    r = client.post(f"/api/rechnung/{rec_id}/pruefen", headers=h)
    assert r.status_code == 200
    by_rule = {c["rule"]: c for c in r.json()}
    assert by_rule["arithmetic"]["passed"] is True
    assert by_rule["completeness"]["passed"] is True

    # 5. ausstellen — gapless number allocated.
    r = client.post(f"/api/rechnung/{rec_id}/ausstellen", headers=h)
    assert r.status_code == 200
    rec = r.json()
    assert rec["status"] == "issued"
    assert rec["rechnungsnummer"] is not None
    assert rec["rechnungsnummer"].startswith("RE-")
    assert rec["steuer_behandlung"] == "regelbesteuert"
    assert rec["ust_satz"] == "19.00"

    # 6. Second issue attempt → 409 (not draft).
    r = client.post(f"/api/rechnung/{rec_id}/ausstellen", headers=h)
    assert r.status_code == 409

    # 7. Numbers are sequential — issue a second rechnung.
    r2 = client.post("/api/rechnung", json={"auftraggeber_id": ag_id}, headers=h)
    rec2 = r2.json()
    r = client.post("/api/rechnung-position", json={
        "rechnung_id": rec2["id"], "bezeichnung": "Test", "menge": "1.000",
        "einheitspreis": "100.00",
    }, headers=h)
    r = client.post(f"/api/rechnung/{rec2['id']}/berechnen",
                    json={"row_version": rec2["row_version"]}, headers=h)
    r = client.post(f"/api/rechnung/{rec2['id']}/pruefen", headers=h)
    r = client.post(f"/api/rechnung/{rec2['id']}/ausstellen", headers=h)
    assert r.status_code == 200
    num1 = int(rec["rechnungsnummer"].split("-")[-1])
    num2 = int(r.json()["rechnungsnummer"].split("-")[-1])
    assert num2 == num1 + 1, "Rechnungsnummern must be gapless and sequential"
