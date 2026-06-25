"""Projekt lifecycle tests: nummer allocation, status machine, optimistic lock."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from .conftest import T1


def _auftraggeber(client: TestClient) -> str:
    r = client.post("/api/auftraggeber", json={"name": "Projekt Test AG"}, headers=T1)
    assert r.status_code == 201
    return r.json()["id"]


def test_create_allocates_nummer(client: TestClient):
    ag = _auftraggeber(client)
    r = client.post("/api/projekt", json={"name": "Auto Nummer", "auftraggeber_id": ag}, headers=T1)
    assert r.status_code == 201, r.text
    data = r.json()
    assert data["nummer"] is not None
    assert "P-" in data["nummer"]


def test_status_forward_transition(client: TestClient):
    ag = _auftraggeber(client)
    r = client.post("/api/projekt", json={"name": "Status Test", "auftraggeber_id": ag}, headers=T1)
    p = r.json()

    r2 = client.patch(
        f"/api/projekt/{p['id']}/status",
        json={"status": "kalkulation", "row_version": p["row_version"]},
        headers=T1,
    )
    assert r2.status_code == 200, r2.text
    assert r2.json()["status"] == "kalkulation"


def test_backward_without_reason_rejected(client: TestClient):
    ag = _auftraggeber(client)
    r = client.post("/api/projekt", json={"name": "Back No Reason", "auftraggeber_id": ag}, headers=T1)
    p = r.json()

    # Forward to beauftragt (two hops — first kalkulation, then beauftragt).
    r2 = client.patch(
        f"/api/projekt/{p['id']}/status",
        json={"status": "kalkulation", "row_version": p["row_version"]},
        headers=T1,
    )
    p2 = r2.json()
    r3 = client.patch(
        f"/api/projekt/{p2['id']}/status",
        json={"status": "beauftragt", "row_version": p2["row_version"]},
        headers=T1,
    )
    p3 = r3.json()

    # Backward without reason → 409.
    r4 = client.patch(
        f"/api/projekt/{p3['id']}/status",
        json={"status": "kalkulation", "row_version": p3["row_version"]},
        headers=T1,
    )
    assert r4.status_code == 409, r4.text


def test_backward_with_reason_accepted(client: TestClient):
    ag = _auftraggeber(client)
    r = client.post("/api/projekt", json={"name": "Back With Reason", "auftraggeber_id": ag}, headers=T1)
    p = r.json()

    r2 = client.patch(
        f"/api/projekt/{p['id']}/status",
        json={"status": "kalkulation", "row_version": p["row_version"]},
        headers=T1,
    )
    p2 = r2.json()

    r3 = client.patch(
        f"/api/projekt/{p2['id']}/status",
        json={"status": "angelegt", "row_version": p2["row_version"], "reason": "Kundenwunsch"},
        headers=T1,
    )
    assert r3.status_code == 200, r3.text
    assert r3.json()["status"] == "angelegt"
