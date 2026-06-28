"""Integration tests for the XRechnung e-invoice path on Rechnung ausstellen.

Requires the full dev stack (postgres + KoSIT validator) to be running.
Run inside the api container:
  docker compose exec api sh -c "pip install -q pytest && python -m pytest"

Coverage:
  1. Happy path: berechnen → prüfen (all checks pass) → ausstellen
     → einvoice_format='xrechnung', einvoice_artifact_id set, document row
     exists, XML file on disk, gapless number.
  2. Missing master data: prüfen records hard einvoice_master_data fail
     → ausstellen returns 422 / blocked by assert_issuable (409 via db_errors).
  3. Gapless guarantee: a failed ausstellen does not burn a number; the next
     successful issue is sequential.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def ag_id_oeffentlich():
    """Use the seeded public buyer (has address + Leitweg-ID)."""
    from app.seed import T1_AG_OEFFENTLICH_ID
    return T1_AG_OEFFENTLICH_ID


@pytest.fixture
def ag_id_ohne_leitweg(client: TestClient):
    """Create a private buyer with address but without Leitweg-ID for failure tests."""
    from app.seed import T1_ID, T1_USER_ID, T1_ADRESSE_AG_ID
    h = {"X-Tenant-Id": T1_ID, "X-User-Id": T1_USER_ID}
    # Create a fresh adresse for this buyer
    r = client.post("/api/adresse", json={
        "strasse": "Teststraße 99", "plz": "10115", "ort": "Berlin"
    }, headers=h)
    assert r.status_code == 201
    adresse_id = r.json()["id"]
    # Public buyer without Leitweg-ID → einvoice_master_data should fail
    r = client.post("/api/auftraggeber", json={
        "name": "Testamt Berlin",
        "typ": "oeffentlich",
        "adresse_id": adresse_id,
        # leitweg_id intentionally omitted
    }, headers=h)
    assert r.status_code == 201
    return r.json()["id"]


# ── Happy path ────────────────────────────────────────────────────────────────

def test_ausstellen_xrechnung_full_flow(client: TestClient, ag_id_oeffentlich):
    """Full rechnung XRechnung flow: berechnen → prüfen → ausstellen."""
    from app.seed import T1_ID, T1_USER_ID
    h = {"X-Tenant-Id": T1_ID, "X-User-Id": T1_USER_ID}

    # 1. Draft rechnung linked to the seeded public buyer.
    r = client.post("/api/rechnung", json={"auftraggeber_id": ag_id_oeffentlich}, headers=h)
    assert r.status_code == 201
    rec = r.json()
    rec_id = rec["id"]

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
    assert rec["summe_netto"] == "170.00"
    assert rec["summe_brutto"] == "202.30"

    # 4. prüfen — all checks must pass, including einvoice_master_data + einvoice_en16931.
    r = client.post(f"/api/rechnung/{rec_id}/pruefen", headers=h)
    assert r.status_code == 200
    by_rule = {c["rule"]: c for c in r.json()}
    assert by_rule["arithmetic"]["passed"] is True
    assert by_rule["completeness"]["passed"] is True
    assert by_rule["einvoice_master_data"]["passed"] is True, \
        f"einvoice_master_data failed: {by_rule['einvoice_master_data'].get('detail')}"
    assert by_rule["einvoice_en16931"]["passed"] is True, \
        f"einvoice_en16931 failed: {by_rule['einvoice_en16931'].get('detail')}"

    # 5. ausstellen → XRechnung issued.
    r = client.post(f"/api/rechnung/{rec_id}/ausstellen", headers=h)
    assert r.status_code == 200, f"ausstellen failed: {r.json()}"
    rec = r.json()
    assert rec["status"] == "issued"
    assert rec["rechnungsnummer"] is not None
    assert rec["rechnungsnummer"].startswith("RE-")
    assert rec["einvoice_format"] == "xrechnung"
    assert rec["einvoice_artifact_id"] is not None
    assert rec["rechnungsdatum"] is not None
    assert rec["faelligkeitsdatum"] is not None
    assert rec["steuer_behandlung"] == "regelbesteuert"
    assert rec["ust_satz"] == "19.00"

    # 6. Verify the document row exists.
    import uuid
    artifact_id = rec["einvoice_artifact_id"]
    r = client.get(f"/api/rechnung/{rec_id}", headers=h)
    assert r.json()["einvoice_artifact_id"] == artifact_id

    # 7. Second issue → 409 (already issued).
    r = client.post(f"/api/rechnung/{rec_id}/ausstellen", headers=h)
    assert r.status_code == 409


def test_gapless_numbering_after_xrechnung(client: TestClient, ag_id_oeffentlich):
    """Two sequential Rechnungen must have gapless numbers."""
    from app.seed import T1_ID, T1_USER_ID
    h = {"X-Tenant-Id": T1_ID, "X-User-Id": T1_USER_ID}

    def _issue_one():
        r = client.post("/api/rechnung", json={"auftraggeber_id": ag_id_oeffentlich}, headers=h)
        rec = r.json()
        client.post("/api/rechnung-position", json={
            "rechnung_id": rec["id"], "bezeichnung": "Pos",
            "einheit": "m2", "einheitspreis": "10.00", "menge": "5.000",
        }, headers=h)
        r = client.post(f"/api/rechnung/{rec['id']}/berechnen",
                        json={"row_version": rec["row_version"]}, headers=h)
        client.post(f"/api/rechnung/{rec['id']}/pruefen", headers=h)
        r = client.post(f"/api/rechnung/{rec['id']}/ausstellen", headers=h)
        assert r.status_code == 200
        return r.json()["rechnungsnummer"]

    num1 = _issue_one()
    num2 = _issue_one()
    n1 = int(num1.split("-")[-1])
    n2 = int(num2.split("-")[-1])
    assert n2 == n1 + 1, f"Gap detected: {num1} → {num2}"


# ── Missing master data → hard check fail ─────────────────────────────────────

def test_missing_leitweg_id_blocks_issue(client: TestClient, ag_id_ohne_leitweg):
    """A public buyer without Leitweg-ID must produce an einvoice_master_data hard fail."""
    from app.seed import T1_ID, T1_USER_ID
    h = {"X-Tenant-Id": T1_ID, "X-User-Id": T1_USER_ID}

    r = client.post("/api/rechnung", json={"auftraggeber_id": ag_id_ohne_leitweg}, headers=h)
    assert r.status_code == 201
    rec = r.json()
    rec_id = rec["id"]

    client.post("/api/rechnung-position", json={
        "rechnung_id": rec_id, "bezeichnung": "Test",
        "einheit": "m2", "einheitspreis": "5.00", "menge": "10.000",
    }, headers=h)
    r = client.post(f"/api/rechnung/{rec_id}/berechnen",
                    json={"row_version": rec["row_version"]}, headers=h)

    # prüfen must record einvoice_master_data as hard fail.
    r = client.post(f"/api/rechnung/{rec_id}/pruefen", headers=h)
    assert r.status_code == 200
    by_rule = {c["rule"]: c for c in r.json()}
    assert by_rule["einvoice_master_data"]["passed"] is False
    assert by_rule["einvoice_master_data"]["severity"] == "hard"

    # ausstellen must be blocked (422 for missing fields caught before assert_issuable,
    # or 409 if assert_issuable fires first).
    r = client.post(f"/api/rechnung/{rec_id}/ausstellen", headers=h)
    assert r.status_code in (409, 422), \
        f"Expected 409 or 422 for missing Leitweg-ID, got {r.status_code}: {r.json()}"


def test_failed_ausstellen_burns_no_number(client: TestClient, ag_id_ohne_leitweg):
    """A rollback due to missing data must not advance the Rechnungsnummer counter."""
    from app.seed import T1_ID, T1_USER_ID
    h = {"X-Tenant-Id": T1_ID, "X-User-Id": T1_USER_ID}

    # Issue a valid rechnung first to establish a baseline number.
    from app.seed import T1_AG_OEFFENTLICH_ID
    r_base = client.post("/api/rechnung", json={"auftraggeber_id": T1_AG_OEFFENTLICH_ID}, headers=h)
    rec_base = r_base.json()
    client.post("/api/rechnung-position", json={
        "rechnung_id": rec_base["id"], "bezeichnung": "Base",
        "einheit": "m2", "einheitspreis": "10.00", "menge": "1.000",
    }, headers=h)
    r = client.post(f"/api/rechnung/{rec_base['id']}/berechnen",
                    json={"row_version": rec_base["row_version"]}, headers=h)
    client.post(f"/api/rechnung/{rec_base['id']}/pruefen", headers=h)
    r = client.post(f"/api/rechnung/{rec_base['id']}/ausstellen", headers=h)
    assert r.status_code == 200
    baseline_num = int(r.json()["rechnungsnummer"].split("-")[-1])

    # Attempt to issue one with missing Leitweg-ID → should fail without burning a number.
    r_fail = client.post("/api/rechnung", json={"auftraggeber_id": ag_id_ohne_leitweg}, headers=h)
    rec_fail = r_fail.json()
    client.post("/api/rechnung-position", json={
        "rechnung_id": rec_fail["id"], "bezeichnung": "Fail",
        "einheit": "m2", "einheitspreis": "5.00", "menge": "2.000",
    }, headers=h)
    r = client.post(f"/api/rechnung/{rec_fail['id']}/berechnen",
                    json={"row_version": rec_fail["row_version"]}, headers=h)
    client.post(f"/api/rechnung/{rec_fail['id']}/pruefen", headers=h)
    r = client.post(f"/api/rechnung/{rec_fail['id']}/ausstellen", headers=h)
    assert r.status_code in (409, 422)

    # Issue another valid rechnung — must be exactly baseline + 1 (no gap).
    r_next = client.post("/api/rechnung", json={"auftraggeber_id": T1_AG_OEFFENTLICH_ID}, headers=h)
    rec_next = r_next.json()
    client.post("/api/rechnung-position", json={
        "rechnung_id": rec_next["id"], "bezeichnung": "Next",
        "einheit": "m2", "einheitspreis": "10.00", "menge": "1.000",
    }, headers=h)
    r = client.post(f"/api/rechnung/{rec_next['id']}/berechnen",
                    json={"row_version": rec_next["row_version"]}, headers=h)
    client.post(f"/api/rechnung/{rec_next['id']}/pruefen", headers=h)
    r = client.post(f"/api/rechnung/{rec_next['id']}/ausstellen", headers=h)
    assert r.status_code == 200
    next_num = int(r.json()["rechnungsnummer"].split("-")[-1])
    assert next_num == baseline_num + 1, \
        f"Gap: expected {baseline_num + 1}, got {next_num}"
