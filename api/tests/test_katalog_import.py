"""Tests for Leistungskatalog import paths (spreadsheet + extract-from-angebote).

Unit tests: spreadsheet parser (csv, xlsx-like).
Integration tests: import-spreadsheet endpoint, extract-from-angebote endpoint.
"""
from __future__ import annotations

import uuid
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient


# ── Sample CSV ────────────────────────────────────────────────────────────────

# Static CSV for parser unit tests (never touches DB — codes don't matter).
_PARSER_CSV = (
    "Code;Kurztext;Einheit;Einheitspreis;Langtext\n"
    "STR-01;Waende streichen;m2;12,50;Waende 2x streichen mit Dispersionsfarbe\n"
    "STR-02;Decke streichen;m2;14,00;\n"
    "BOD-01;Parkett verlegen;m2;45,00;Parkett verlegen inkl. Unterlagsmatte\n"
    ";Spacer-Row;;\n"  # should be skipped (no einheit)
).encode("utf-8")

# Integration CSV uses per-run unique codes to avoid DB state pollution
# across pytest sessions (the dev DB is persistent on Hetzner).
_RUN = uuid.uuid4().hex[:4].upper()
SAMPLE_CSV = (
    f"Code;Kurztext;Einheit;Einheitspreis;Langtext\n"
    f"I{_RUN}01;Waende streichen;m2;12,50;Waende 2x streichen mit Dispersionsfarbe\n"
    f"I{_RUN}02;Decke streichen;m2;14,00;\n"
    f"I{_RUN}03;Parkett verlegen;m2;45,00;Parkett verlegen inkl. Unterlagsmatte\n"
    f";Spacer-Row;;\n"
).encode("utf-8")

# CSV with German decimal "." thousands and "," decimal
SAMPLE_CSV_GERMAN_DECIMAL = (
    "Bezeichnung;ME;EP\n"
    "Fliesen verlegen;m2;\"85,00\"\n"
    "Grundierung;m2;3,50\n"
).encode("utf-8")

# CSV without code column (should auto-generate codes)
SAMPLE_CSV_NO_CODE = (
    "Bezeichnung;Einheit;Preis\n"
    "Tapete ankleben;m2;8,00\n"
    "Rahmen streichen;lfm;6,50\n"
).encode("utf-8")


# ── Parser unit tests ─────────────────────────────────────────────────────────

def test_parse_csv_basic():
    from app.katalog.spreadsheet import parse_spreadsheet

    result = parse_spreadsheet(_PARSER_CSV, "test.csv")
    assert len(result.rows) == 3
    assert result.skipped == 1  # spacer row

    r0 = result.rows[0]
    assert r0.code == "STR-01"
    assert r0.kurztext == "Waende streichen"
    assert r0.einheit == "m2"
    assert r0.einheitspreis == Decimal("12.50")
    assert "Dispersionsfarbe" in (r0.langtext or "")

    r1 = result.rows[1]
    assert r1.code == "STR-02"
    assert r1.langtext is None


def test_parse_csv_german_decimal():
    from app.katalog.spreadsheet import parse_spreadsheet

    result = parse_spreadsheet(SAMPLE_CSV_GERMAN_DECIMAL, "test.csv")
    assert len(result.rows) == 2
    assert result.rows[0].einheitspreis == Decimal("85.00")
    assert result.rows[1].einheitspreis == Decimal("3.50")


def test_parse_csv_no_code_column():
    from app.katalog.spreadsheet import parse_spreadsheet

    result = parse_spreadsheet(SAMPLE_CSV_NO_CODE, "test.csv")
    assert len(result.rows) == 2
    # Codes should be None here (auto-generation happens at insert time)
    assert result.rows[0].code is None
    assert result.rows[0].kurztext == "Tapete ankleben"


def test_parse_xlsx():
    """Build a minimal xlsx in memory and parse it."""
    openpyxl = pytest.importorskip("openpyxl")
    import io

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(["Code", "Kurztext", "Einheit", "Einheitspreis"])
    ws.append(["BOD-01", "Laminat verlegen", "m2", 32.00])
    ws.append(["", "", "", ""])  # empty row → skipped
    ws.append(["BOD-02", "Sockelleiste", "lfm", 8.50])

    buf = io.BytesIO()
    wb.save(buf)
    content = buf.getvalue()

    from app.katalog.spreadsheet import parse_spreadsheet

    result = parse_spreadsheet(content, "katalog.xlsx")
    assert len(result.rows) == 2
    assert result.rows[0].code == "BOD-01"
    assert result.rows[0].einheitspreis == Decimal("32")
    assert result.rows[1].code == "BOD-02"


def test_auto_code_unique():
    from app.katalog.spreadsheet import auto_code

    existing: set[str] = set()
    c1 = auto_code("Wände streichen", existing)
    c2 = auto_code("Wände streichen", existing)
    assert c1 != c2
    assert c1 in existing
    assert c2 in existing


# ── Integration tests ─────────────────────────────────────────────────────────

def _headers():
    from app.seed import T1_ID, T1_USER_ID
    return {"X-Tenant-Id": T1_ID, "X-User-Id": T1_USER_ID}


@pytest.fixture
def katalog_id(client: TestClient):
    """Fresh test catalog."""
    r = client.post(
        "/api/leistungskatalog",
        json={"name": "Testimport-Katalog", "aktiv": True},
        headers=_headers(),
    )
    assert r.status_code == 201
    return r.json()["id"]


def test_import_csv(client: TestClient, katalog_id):
    r = client.post(
        f"/api/leistungskatalog/{katalog_id}/import-spreadsheet",
        files={"file": ("test.csv", SAMPLE_CSV, "text/csv")},
        headers=_headers(),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["imported"] == 3
    assert body["skipped_empty"] == 1
    assert body["skipped_duplicate"] == 0

    # Verify leistungen in DB
    r2 = client.get(f"/api/leistung?leistungskatalog_id={katalog_id}", headers=_headers())
    leistungen = r2.json()
    assert len(leistungen) == 3
    codes = {l["code"] for l in leistungen}
    assert f"I{_RUN}01" in codes
    assert f"I{_RUN}03" in codes


def test_import_idempotent(client: TestClient, katalog_id):
    """Second import of same file skips existing codes."""
    for _ in range(2):
        client.post(
            f"/api/leistungskatalog/{katalog_id}/import-spreadsheet",
            files={"file": ("test.csv", SAMPLE_CSV, "text/csv")},
            headers=_headers(),
        )
    r = client.post(
        f"/api/leistungskatalog/{katalog_id}/import-spreadsheet",
        files={"file": ("test.csv", SAMPLE_CSV, "text/csv")},
        headers=_headers(),
    )
    body = r.json()
    assert body["imported"] == 0
    assert body["skipped_duplicate"] == 3


def test_import_no_code_column(client: TestClient, katalog_id):
    """Rows without a code column get auto-generated codes."""
    r = client.post(
        f"/api/leistungskatalog/{katalog_id}/import-spreadsheet",
        files={"file": ("test.csv", SAMPLE_CSV_NO_CODE, "text/csv")},
        headers=_headers(),
    )
    assert r.status_code == 200
    assert r.json()["imported"] == 2

    leistungen = client.get(
        f"/api/leistung?leistungskatalog_id={katalog_id}", headers=_headers()
    ).json()
    assert len(leistungen) == 2
    for l in leistungen:
        assert l["code"]  # must have a code


def test_import_missing_katalog(client: TestClient):
    import uuid
    r = client.post(
        f"/api/leistungskatalog/{uuid.uuid4()}/import-spreadsheet",
        files={"file": ("test.csv", SAMPLE_CSV, "text/csv")},
        headers=_headers(),
    )
    assert r.status_code == 404


def test_extract_from_angebote(client: TestClient, katalog_id):
    """Confirmed positions without matched_leistung_id are extracted to the catalog."""
    from app.seed import T1_ID, T1_USER_ID
    h = _headers()

    # 1. Create an auftraggeber + angebot + lv + two positions
    ag = client.post(
        "/api/auftraggeber",
        json={"name": "Extract-Test AG", "typ": "gewerblich"},
        headers=h,
    ).json()
    ang = client.post(
        "/api/angebot",
        json={"auftraggeber_id": ag["id"]},
        headers=h,
    ).json()
    lv = client.post(
        "/api/lv",
        json={"angebot_id": ang["id"], "source": "manual"},
        headers=h,
    ).json()

    for kurztext, einheit, ep in [
        ("Sonderposition A", "m2", "55.00"),
        ("Sonderposition B", "psch", "200.00"),
    ]:
        client.post(
            "/api/lv-position",
            json={
                "lv_id": lv["id"],
                "kurztext": kurztext,
                "einheit": einheit,
                "einheitspreis": ep,
                "gesamtpreis": ep,
                "menge": "1.000",
                "match_status": "confirmed",
                "source": "manual",
            },
            headers=h,
        )

    # 2. Extract from angebote
    r = client.post(
        f"/api/leistungskatalog/{katalog_id}/extract-from-angebote",
        headers=h,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["candidates_found"] >= 2
    assert body["imported"] >= 2
    assert body["skipped_already_in_catalog"] == 0

    # 3. Verify leistungen created
    leistungen = client.get(
        f"/api/leistung?leistungskatalog_id={katalog_id}", headers=h
    ).json()
    kurztext_set = {l["kurztext"] for l in leistungen}
    assert "Sonderposition A" in kurztext_set
    assert "Sonderposition B" in kurztext_set


def test_extract_skips_already_in_catalog(client: TestClient, katalog_id):
    """Second extract call skips positions already imported to catalog."""
    h = _headers()

    ag = client.post("/api/auftraggeber", json={"name": "Dup-Test AG", "typ": "gewerblich"}, headers=h).json()
    ang = client.post("/api/angebot", json={"auftraggeber_id": ag["id"]}, headers=h).json()
    lv = client.post("/api/lv", json={"angebot_id": ang["id"], "source": "manual"}, headers=h).json()
    client.post("/api/lv-position", json={
        "lv_id": lv["id"], "kurztext": "Duplikat-Pos", "einheit": "m2",
        "einheitspreis": "10.00", "gesamtpreis": "10.00", "menge": "1.000",
        "match_status": "confirmed", "source": "manual",
    }, headers=h)

    r1 = client.post(f"/api/leistungskatalog/{katalog_id}/extract-from-angebote", headers=h)
    r2 = client.post(f"/api/leistungskatalog/{katalog_id}/extract-from-angebote", headers=h)

    assert r1.json()["imported"] >= 1
    # On the second call, Duplikat-Pos should be skipped
    assert r2.json()["skipped_already_in_catalog"] >= 1
