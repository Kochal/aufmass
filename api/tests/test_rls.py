"""RLS isolation: T2 tenant cannot see T1 rows."""
from __future__ import annotations

from fastapi.testclient import TestClient

from .conftest import T1, T2


def test_t1_row_invisible_to_t2(client: TestClient):
    r = client.post("/api/auftraggeber", json={"name": "RLS Secret"}, headers=T1)
    assert r.status_code == 201
    id_ = r.json()["id"]

    # T2 list should not include this row.
    r2 = client.get("/api/auftraggeber", headers=T2)
    assert r2.status_code == 200
    ids = [x["id"] for x in r2.json()]
    assert id_ not in ids

    # T2 direct get should 404.
    r3 = client.get(f"/api/auftraggeber/{id_}", headers=T2)
    assert r3.status_code == 404

    # T2 update attempt should 409 (stale) not 200.
    r4 = client.put(
        f"/api/auftraggeber/{id_}",
        json={"name": "Hijack", "row_version": 1},
        headers=T2,
    )
    assert r4.status_code in (404, 409)


def test_angebot_invisible_to_other_tenant(client: TestClient):
    """An angebot created by T1 must not be visible to T2."""
    # Need an auftraggeber for T1 first.
    ag = client.post("/api/auftraggeber", json={"name": "RLS AG T1"}, headers=T1).json()
    r = client.post("/api/angebot", json={"auftraggeber_id": ag["id"]}, headers=T1)
    assert r.status_code == 201
    ang_id = r.json()["id"]

    # T2 list must not contain it.
    r2 = client.get("/api/angebot", headers=T2)
    assert r2.status_code == 200
    assert ang_id not in [x["id"] for x in r2.json()]

    # T2 direct get must 404.
    r3 = client.get(f"/api/angebot/{ang_id}", headers=T2)
    assert r3.status_code == 404
