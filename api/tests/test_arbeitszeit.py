"""Arbeitszeit: dauer computed, freeze-on-approval, korrektur."""
from __future__ import annotations

from fastapi.testclient import TestClient

from app.seed import T1_USER_ID
from .conftest import T1


def _entry(client: TestClient) -> dict:
    r = client.post(
        "/api/arbeitszeit",
        json={
            "app_user_id": T1_USER_ID,
            "start_zeit": "2026-06-25T07:00:00Z",
            "end_zeit": "2026-06-25T15:00:00Z",
            "pause_minuten": 30,
        },
        headers=T1,
    )
    assert r.status_code == 201, r.text
    return r.json()


def test_create_computes_dauer(client: TestClient):
    az = _entry(client)
    # 8h total − 30 min pause = 7.5h = 27000s
    # Pydantic v2 serializes timedelta as ISO 8601 duration. 8h − 30 min = 7h30m.
    assert az["dauer"] == "PT7H30M"


def test_freigabe_freezes_entry(client: TestClient):
    az = _entry(client)

    # Approve it.
    r2 = client.patch(
        f"/api/arbeitszeit/{az['id']}/freigabe",
        json={"row_version": az["row_version"]},
        headers=T1,
    )
    assert r2.status_code == 200, r2.text
    approved = r2.json()
    assert approved["freigabe_status"] == "freigegeben"

    # Attempt to update the frozen entry → 409.
    r3 = client.put(
        f"/api/arbeitszeit/{az['id']}",
        json={
            "start_zeit": "2026-06-25T08:00:00Z",
            "end_zeit": "2026-06-25T16:00:00Z",
            "pause_minuten": 0,
            "row_version": approved["row_version"],
        },
        headers=T1,
    )
    assert r3.status_code == 409, r3.text


def test_korrektur_creates_linked_row(client: TestClient):
    az = _entry(client)

    # Approve first.
    r2 = client.patch(
        f"/api/arbeitszeit/{az['id']}/freigabe",
        json={"row_version": az["row_version"]},
        headers=T1,
    )
    approved = r2.json()

    # Korrektur.
    r3 = client.post(
        f"/api/arbeitszeit/{az['id']}/korrektur",
        json={
            "start_zeit": "2026-06-25T08:00:00Z",
            "end_zeit": "2026-06-25T16:00:00Z",
            "pause_minuten": 0,
        },
        headers=T1,
    )
    assert r3.status_code == 201, r3.text
    kor = r3.json()
    assert kor["korrektur_von_id"] == az["id"]
    assert kor["app_user_id"] == az["app_user_id"]


def test_korrektur_requires_approved_source(client: TestClient):
    az = _entry(client)
    # Source is still 'offen' → 422.
    r = client.post(
        f"/api/arbeitszeit/{az['id']}/korrektur",
        json={"start_zeit": "2026-06-25T08:00:00Z", "end_zeit": "2026-06-25T16:00:00Z"},
        headers=T1,
    )
    assert r.status_code == 422
