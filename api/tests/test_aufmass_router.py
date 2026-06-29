"""Tests for the Aufmaß routers (aufmass + aufmass_entry).

All tests use manual capture mode so no Mistral API key is required.
The upload test is marked skipif to run only when MISTRAL_API_KEY is set.
"""
from __future__ import annotations

import os

import pytest
from starlette.testclient import TestClient

from app.seed import T1_ID, T1_USER_ID

H = {"X-Tenant-Id": T1_ID, "X-User-Id": T1_USER_ID}


# ── Fixtures ─────────────────────────────────────────────────────────────────

@pytest.fixture
def projekt_id(client: TestClient) -> str:
    r = client.post("/api/auftraggeber", json={"name": "Aufmass-Test AG"}, headers=H)
    assert r.status_code == 201, r.text
    ag_id = r.json()["id"]
    r = client.post(
        "/api/projekt",
        json={"auftraggeber_id": ag_id, "name": "Aufmass-Baustelle"},
        headers=H,
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


@pytest.fixture
def aufmass_id(client: TestClient, projekt_id: str) -> str:
    r = client.post("/api/aufmass", json={"projekt_id": projekt_id}, headers=H)
    assert r.status_code == 201, r.text
    return r.json()["id"]


@pytest.fixture
def entry(client: TestClient, aufmass_id: str) -> dict:
    r = client.post(
        "/api/aufmass-entry",
        json={
            "aufmass_id": aufmass_id,
            "bauteil": "Boden",
            "written_result": "12.500",
            "einheit": "m2",
            "confidence": 0.9,
            "raw_text": "3,86 x 3,24",
        },
        headers=H,
    )
    assert r.status_code == 201, r.text
    return r.json()


# ── Aufmaß CRUD ──────────────────────────────────────────────────────────────

def test_create_manual_aufmass(client: TestClient, projekt_id: str):
    r = client.post("/api/aufmass", json={"projekt_id": projekt_id}, headers=H)
    assert r.status_code == 201
    data = r.json()
    assert data["quelle"] == "manual"
    assert data["source_document_id"] is None
    assert data["entries"] == []
    assert data["projekt_id"] == projekt_id


def test_list_aufmass_by_projekt(client: TestClient, projekt_id: str):
    client.post("/api/aufmass", json={"projekt_id": projekt_id}, headers=H)
    r = client.get("/api/aufmass", params={"projekt_id": projekt_id}, headers=H)
    assert r.status_code == 200
    ids = [a["id"] for a in r.json()]
    assert len(ids) >= 1


def test_get_aufmass_without_entries(client: TestClient, aufmass_id: str):
    r = client.get(f"/api/aufmass/{aufmass_id}", headers=H)
    assert r.status_code == 200
    data = r.json()
    assert data["id"] == aufmass_id
    assert data["entries"] == []


def test_get_aufmass_with_entries(client: TestClient, aufmass_id: str, entry: dict):
    r = client.get(f"/api/aufmass/{aufmass_id}", headers=H)
    assert r.status_code == 200
    assert len(r.json()["entries"]) >= 1


def test_delete_aufmass(client: TestClient, projekt_id: str):
    r = client.post("/api/aufmass", json={"projekt_id": projekt_id}, headers=H)
    am_id = r.json()["id"]
    r = client.delete(f"/api/aufmass/{am_id}", headers=H)
    assert r.status_code == 204
    r = client.get(f"/api/aufmass/{am_id}", headers=H)
    assert r.status_code == 404


def test_delete_aufmass_not_found(client: TestClient):
    r = client.delete("/api/aufmass/00000000-0000-0000-0000-000000000099", headers=H)
    assert r.status_code == 404


# ── Entry CRUD ────────────────────────────────────────────────────────────────

def test_create_entry_basic(client: TestClient, aufmass_id: str):
    r = client.post(
        "/api/aufmass-entry",
        json={"aufmass_id": aufmass_id, "raw_text": "3,86"},
        headers=H,
    )
    assert r.status_code == 201
    data = r.json()
    assert data["review_status"] == "review"
    assert data["reconciled"] is False


def test_create_entry_with_fields(client: TestClient, entry: dict):
    assert entry["bauteil"] == "Boden"
    assert entry["einheit"] == "m2"
    assert entry["review_status"] == "review"
    # candidate_readings stores raw_text
    assert entry["candidate_readings"]["raw_text"] == "3,86 x 3,24"


def test_list_entries(client: TestClient, aufmass_id: str, entry: dict):
    r = client.get("/api/aufmass-entry", params={"aufmass_id": aufmass_id}, headers=H)
    assert r.status_code == 200
    assert any(e["id"] == entry["id"] for e in r.json())


def test_get_entry(client: TestClient, entry: dict):
    r = client.get(f"/api/aufmass-entry/{entry['id']}", headers=H)
    assert r.status_code == 200
    assert r.json()["id"] == entry["id"]


def test_delete_entry(client: TestClient, aufmass_id: str):
    r = client.post(
        "/api/aufmass-entry",
        json={"aufmass_id": aufmass_id, "raw_text": "to-delete"},
        headers=H,
    )
    eid = r.json()["id"]
    r = client.delete(f"/api/aufmass-entry/{eid}", headers=H)
    assert r.status_code == 204
    r = client.get(f"/api/aufmass-entry/{eid}", headers=H)
    assert r.status_code == 404


# ── Review actions ────────────────────────────────────────────────────────────

def test_confirm_entry(client: TestClient, entry: dict):
    r = client.patch(
        f"/api/aufmass-entry/{entry['id']}/confirm",
        json={"row_version": entry["row_version"]},
        headers=H,
    )
    assert r.status_code == 200
    data = r.json()
    assert data["review_status"] == "confirmed"
    assert data["row_version"] == entry["row_version"] + 1


def test_confirm_stale_version_rejected(client: TestClient, entry: dict):
    r = client.patch(
        f"/api/aufmass-entry/{entry['id']}/confirm",
        json={"row_version": entry["row_version"] - 1},
        headers=H,
    )
    assert r.status_code == 409


def test_correct_entry_values(client: TestClient, entry: dict):
    r = client.patch(
        f"/api/aufmass-entry/{entry['id']}/correct",
        json={
            "row_version": entry["row_version"],
            "written_result": "13.000",
            "bauteil": "Boden-korrigiert",
        },
        headers=H,
    )
    assert r.status_code == 200
    data = r.json()
    assert data["review_status"] == "corrected"
    assert data["bauteil"] == "Boden-korrigiert"
    from decimal import Decimal
    assert Decimal(data["written_result"]) == Decimal("13.000")


def test_correct_preserves_untouched_fields(client: TestClient, entry: dict):
    """Passing None for a field keeps the existing value (coalesce pattern)."""
    r = client.patch(
        f"/api/aufmass-entry/{entry['id']}/correct",
        json={"row_version": entry["row_version"], "bauteil": "NeuerBauteil"},
        headers=H,
    )
    assert r.status_code == 200
    data = r.json()
    assert data["bauteil"] == "NeuerBauteil"
    assert data["einheit"] == "m2"          # unchanged
    assert data["review_status"] == "corrected"


# ── Upload test (requires MISTRAL_API_KEY) ───────────────────────────────────

@pytest.mark.skipif(
    not os.environ.get("MISTRAL_API_KEY"),
    reason="MISTRAL_API_KEY not set — live Mistral upload test skipped",
)
def test_upload_missing_key_check(client: TestClient, projekt_id: str):
    # When API key IS set this validates that the endpoint path exists and
    # responds (it may fail with 502 if the image is too small for Mistral).
    import base64
    tiny = base64.b64decode(
        "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8U"
        "HRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgN"
        "DRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIy"
        "MjL/wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAA"
        "AAAAAAAAAAAAAAP/EABQBAQAAAAAAAAAAAAAAAAAAAAD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA"
        "/9oADAMBAAIRAxEAPwCwABmX/9k="
    )
    files = {"image": ("test.jpg", tiny, "image/jpeg")}
    data = {"projekt_id": projekt_id}
    r = client.post("/api/aufmass/upload", data=data, files=files, headers=H)
    assert r.status_code in (201, 502)  # 502 acceptable: Mistral may reject a 1×1 image
