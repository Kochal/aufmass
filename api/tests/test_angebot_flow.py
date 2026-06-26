"""Integration tests for the full angebot issue flow.

berechnen → pruefen → ausstellen; gate enforcement; version chain.
Requires the dev stack (docker compose up -d) and seeded tenants.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.seed import T1_KATALOG_ID, T1_LEISTUNG_STREICHEN_ID, T1_LEISTUNG_VERLEGEN_ID


def _headers(client):
    """Return T1 headers from conftest T1 fixture."""
    from app.seed import T1_ID, T1_USER_ID
    return {"X-Tenant-Id": T1_ID, "X-User-Id": T1_USER_ID}


@pytest.fixture
def ag_id(client: TestClient):
    """A fresh auftraggeber for this test module."""
    from app.seed import T1_ID, T1_USER_ID
    h = {"X-Tenant-Id": T1_ID, "X-User-Id": T1_USER_ID}
    r = client.post("/api/auftraggeber", json={"name": "Angebot-Test GmbH", "typ": "gewerblich"}, headers=h)
    assert r.status_code == 201
    return r.json()["id"]


def test_angebot_full_flow(client: TestClient, ag_id):
    from app.seed import T1_ID, T1_USER_ID
    h = {"X-Tenant-Id": T1_ID, "X-User-Id": T1_USER_ID}

    # 1. Create draft angebot.
    r = client.post("/api/angebot", json={"auftraggeber_id": ag_id}, headers=h)
    assert r.status_code == 201
    ang = r.json()
    ang_id = ang["id"]
    assert ang["status"] == "draft"

    # 2. Create an LV linked to the angebot.
    r = client.post("/api/lv", json={"angebot_id": ang_id, "source": "manual"}, headers=h)
    assert r.status_code == 201
    lv_id = r.json()["id"]

    # 3. Add two positions (one with einheitspreis preset, one needing it from the leistung).
    r = client.post("/api/lv-position", json={
        "lv_id": lv_id,
        "oz": "01",
        "kurztext": "Wände streichen",
        "menge": "20.000",
        "einheit": "m2",
        "einheitspreis": "8.50",
        "matched_leistung_id": T1_LEISTUNG_STREICHEN_ID,
        "match_status": "confirmed",
        "source": "manual",
        "position_nr": 1,
    }, headers=h)
    assert r.status_code == 201
    pos1_id = r.json()["id"]

    r = client.post("/api/lv-position", json={
        "lv_id": lv_id,
        "oz": "02",
        "kurztext": "Laminat verlegen",
        "menge": "15.000",
        "einheit": "m2",
        # No einheitspreis — engine should fill from matched leistung (22.00)
        "matched_leistung_id": T1_LEISTUNG_VERLEGEN_ID,
        "match_status": "confirmed",
        "source": "manual",
        "position_nr": 2,
    }, headers=h)
    assert r.status_code == 201
    pos2_id = r.json()["id"]

    # 4. berechnen.
    r = client.post(f"/api/angebot/{ang_id}/berechnen",
                    json={"row_version": ang["row_version"]}, headers=h)
    assert r.status_code == 200
    ang = r.json()
    # pos1: 20 * 8.50 = 170.00; pos2: 15 * 22.00 = 330.00; netto = 500.00
    assert ang["summe_netto"] == "500.00"
    # brutto = 500 * 1.19 = 595.00
    assert ang["summe_brutto"] == "595.00"

    # Confirm pos2 got its einheitspreis filled in.
    r2 = client.get(f"/api/lv-position/{pos2_id}", headers=h)
    assert r2.json()["einheitspreis"] == "22.00"
    assert r2.json()["gesamtpreis"] == "330.00"
    assert r2.json()["pricing_rule"] == "menge*einheitspreis"

    # 5. ausstellen before pruefen should fail (unresolved? no — the gate only checks
    #    hard check_result rows; if no checks recorded it passes. So we need to pruefen first
    #    to get check_results, then verify the gate behavior).

    # 5a. pruefen — all checks should pass (positions are priced and confirmed).
    r = client.post(f"/api/angebot/{ang_id}/pruefen", headers=h)
    assert r.status_code == 200
    checks = r.json()
    by_rule = {c["rule"]: c for c in checks}
    assert by_rule["arithmetic"]["passed"] is True
    assert by_rule["zero_guard"]["passed"] is True
    assert by_rule["completeness"]["passed"] is True

    # 6. ausstellen.
    r = client.post(f"/api/angebot/{ang_id}/ausstellen", headers=h)
    assert r.status_code == 200
    ang = r.json()
    assert ang["status"] == "issued"
    assert ang["angebotsnummer"] is not None
    assert ang["angebotsnummer"].startswith("A-")
    assert ang["steuer_behandlung"] == "regelbesteuert"
    assert ang["ust_satz"] == "19.00"

    # 7. PUT on issued angebot → 409 (financial freeze).
    r = client.put(f"/api/angebot/{ang_id}",
                   json={"auftraggeber_id": ag_id, "waehrung": "EUR", "row_version": ang["row_version"]},
                   headers=h)
    assert r.status_code == 409

    # 8. neue version → v2 draft.
    r = client.post(f"/api/angebot/{ang_id}/version", headers=h)
    assert r.status_code == 201
    v2 = r.json()
    assert v2["status"] == "draft"
    assert v2["version_no"] == 2
    assert v2["supersedes_id"] == ang_id
    assert v2["document_group_id"] == ang["document_group_id"]


def test_ausstellen_unpriced_blocked(client: TestClient, ag_id):
    """Issue is blocked when a position is still unpriced (no gesamtpreis)."""
    from app.seed import T1_ID, T1_USER_ID
    h = {"X-Tenant-Id": T1_ID, "X-User-Id": T1_USER_ID}

    r = client.post("/api/angebot", json={"auftraggeber_id": ag_id}, headers=h)
    ang = r.json(); ang_id = ang["id"]

    r = client.post("/api/lv", json={"angebot_id": ang_id, "source": "manual"}, headers=h)
    lv_id = r.json()["id"]

    # Position with no einheitspreis and no matched leistung → will remain unpriced.
    client.post("/api/lv-position", json={
        "lv_id": lv_id, "oz": "01", "menge": "10.000", "einheit": "m2",
        "match_status": "review", "source": "manual",
    }, headers=h)

    # ausstellen must fail: unpriced/in-review position.
    r = client.post(f"/api/angebot/{ang_id}/ausstellen", headers=h)
    assert r.status_code == 409


def test_ausstellen_hard_check_failure_blocked(client: TestClient, ag_id):
    """Issue is blocked when a hard check failure is recorded."""
    from app.seed import T1_ID, T1_USER_ID
    h = {"X-Tenant-Id": T1_ID, "X-User-Id": T1_USER_ID}

    r = client.post("/api/angebot", json={"auftraggeber_id": ag_id}, headers=h)
    ang = r.json(); ang_id = ang["id"]

    r = client.post("/api/lv", json={"angebot_id": ang_id, "source": "manual"}, headers=h)
    lv_id = r.json()["id"]
    client.post("/api/lv-position", json={
        "lv_id": lv_id, "oz": "01", "menge": "10.000", "einheit": "m2",
        "einheitspreis": "8.50", "gesamtpreis": "99.00",  # wrong — arithmetic will fail
        "match_status": "confirmed", "source": "manual",
    }, headers=h)

    # berechnen with a deliberately wrong existing value.
    # Instead, manually set a wrong total and pruefen to record a failing check.
    # We set summe_netto wrong by calling berechnen then corrupting summe_netto via PUT.
    # Actually: just pruefen without berechnen — positions have gesamtpreis but netto is null.
    # arithmetic check: no stored netto → will only check positions. Let's force it by
    # manually inserting a check_result with passed=false.
    # Simplest: call pruefen on an angebot where the stored gesamtpreis doesn't match.
    # Position has gesamtpreis=99.00 but 10*8.50=85.00 → arithmetic will fail.
    r = client.post(f"/api/angebot/{ang_id}/pruefen", headers=h)
    assert r.status_code == 200
    checks = r.json()
    by_rule = {c["rule"]: c for c in checks}
    assert by_rule["arithmetic"]["passed"] is False

    # ausstellen must fail: unresolved hard check.
    r = client.post(f"/api/angebot/{ang_id}/ausstellen", headers=h)
    assert r.status_code == 409


def test_stale_row_version_berechnen(client: TestClient, ag_id):
    from app.seed import T1_ID, T1_USER_ID
    h = {"X-Tenant-Id": T1_ID, "X-User-Id": T1_USER_ID}

    r = client.post("/api/angebot", json={"auftraggeber_id": ag_id}, headers=h)
    ang = r.json(); ang_id = ang["id"]

    r = client.post(f"/api/angebot/{ang_id}/berechnen",
                    json={"row_version": ang["row_version"] + 99}, headers=h)
    assert r.status_code == 409
