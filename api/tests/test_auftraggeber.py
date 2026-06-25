"""Auftraggeber CRUD + guard tests."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from .conftest import T1


def test_create_and_read(client: TestClient):
    r = client.post("/api/auftraggeber", json={"name": "Test GmbH"}, headers=T1)
    assert r.status_code == 201, r.text
    data = r.json()
    assert data["name"] == "Test GmbH"
    assert data["row_version"] == 1

    r2 = client.get(f"/api/auftraggeber/{data['id']}", headers=T1)
    assert r2.status_code == 200
    assert r2.json()["id"] == data["id"]


def test_update_and_stale_version(client: TestClient):
    r = client.post("/api/auftraggeber", json={"name": "Vers Test"}, headers=T1)
    ag = r.json()
    id_, rv = ag["id"], ag["row_version"]

    r2 = client.put(
        f"/api/auftraggeber/{id_}",
        json={"name": "Vers Test Updated", "row_version": rv},
        headers=T1,
    )
    assert r2.status_code == 200
    assert r2.json()["row_version"] == rv + 1

    # Stale version → 409.
    r3 = client.put(
        f"/api/auftraggeber/{id_}",
        json={"name": "Stale", "row_version": rv},
        headers=T1,
    )
    assert r3.status_code == 409


def test_delete(client: TestClient):
    r = client.post("/api/auftraggeber", json={"name": "Delete Me"}, headers=T1)
    id_ = r.json()["id"]

    r2 = client.delete(f"/api/auftraggeber/{id_}", headers=T1)
    assert r2.status_code == 204

    r3 = client.get(f"/api/auftraggeber/{id_}", headers=T1)
    assert r3.status_code == 404

    # Idempotent second delete → 404 (already gone).
    r4 = client.delete(f"/api/auftraggeber/{id_}", headers=T1)
    assert r4.status_code == 404


def test_delete_blocked_by_open_projekt(client: TestClient):
    """Deleting an Auftraggeber that has a live Projekt raises 409 (guard)."""
    r = client.post("/api/auftraggeber", json={"name": "Has Projekt"}, headers=T1)
    ag_id = r.json()["id"]

    rp = client.post(
        "/api/projekt",
        json={"name": "Guard Test", "auftraggeber_id": ag_id},
        headers=T1,
    )
    assert rp.status_code == 201, rp.text

    rd = client.delete(f"/api/auftraggeber/{ag_id}", headers=T1)
    assert rd.status_code == 409
