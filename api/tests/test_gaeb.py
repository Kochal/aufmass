"""Tests for the GAEB import/export pipeline (directive 06 Stage 1 + 6).

Unit tests: parser, exporter, roundtrip check — no DB needed.
Integration tests: import endpoint, export endpoint, roundtrip check in pruefen.
"""
from __future__ import annotations

from decimal import Decimal

import pytest
from fastapi.testclient import TestClient


# ── Sample GAEB DA XML 3.1 (X83 Angebotsaufforderung) ────────────────────────

SAMPLE_GAEB_X83 = """<?xml version="1.0" encoding="UTF-8"?>
<GAEB xmlns="http://www.gaeb.de/GAEB_DA_XML/3.1">
  <GAEBInfo>
    <Vers>3.1</Vers>
    <Date>2026-06-29</Date>
    <Conversion>
      <DP>83</DP>
    </Conversion>
  </GAEBInfo>
  <PrjInfo>
    <NamePrj>Renovierung Musterstrasse 1</NamePrj>
  </PrjInfo>
  <Award>
    <BoQ>
      <BoQBody>
        <Pos>
          <PosNo>01.001</PosNo>
          <Description>
            <Short>Untergrundpruefung</Short>
            <Long>Untergrundpruefung und Vorbehandlung der Waende vor dem Streichen.</Long>
          </Description>
          <Qty>1.000</Qty>
          <QU>psch</QU>
          <UP>0.00</UP>
          <T>N</T>
        </Pos>
        <Pos>
          <PosNo>01.002</PosNo>
          <Description>
            <Short>Waende streichen</Short>
            <Long>Waende 2x streichen mit Dispersionsfarbe weiss, Innenbereich.</Long>
          </Description>
          <Qty>250.000</Qty>
          <QU>m2</QU>
          <UP>0.00</UP>
          <T>N</T>
        </Pos>
        <Pos>
          <PosNo>02.001</PosNo>
          <Description>
            <Short>Bodenverlegen</Short>
            <Long>Vinylboden verlegen, inkl. Unterlagsmatte.</Long>
          </Description>
          <Qty>80.500</Qty>
          <QU>m2</QU>
          <UP>0.00</UP>
          <T>N</T>
        </Pos>
      </BoQBody>
    </BoQ>
  </Award>
</GAEB>""".encode("utf-8")

SAMPLE_GAEB_NESTED = """<?xml version="1.0" encoding="UTF-8"?>
<GAEB xmlns="http://www.gaeb.de/GAEB_DA_XML/3.1">
  <GAEBInfo>
    <Vers>3.1</Vers>
    <Date>2026-06-29</Date>
    <Conversion><DP>83</DP></Conversion>
  </GAEBInfo>
  <PrjInfo><NamePrj>Nested Test</NamePrj></PrjInfo>
  <Award>
    <BoQ>
      <BoQBody>
        <BoQCtlPb>
          <Pbp id="01">
            <BoQBody>
              <Pos>
                <PosNo>01.001</PosNo>
                <Description><Short>Position A</Short></Description>
                <Qty>10.000</Qty>
                <QU>m2</QU>
                <UP>0.00</UP>
              </Pos>
              <BoQCtlPb>
                <Pbp id="01.01">
                  <BoQBody>
                    <Pos>
                      <PosNo>01.01.001</PosNo>
                      <Description><Short>Position B (nested)</Short></Description>
                      <Qty>5.500</Qty>
                      <QU>lfm</QU>
                      <UP>0.00</UP>
                    </Pos>
                  </BoQBody>
                </Pbp>
              </BoQCtlPb>
            </BoQBody>
          </Pbp>
        </BoQCtlPb>
      </BoQBody>
    </BoQ>
  </Award>
</GAEB>""".encode("utf-8")


# ── Parser unit tests ─────────────────────────────────────────────────────────

def test_parser_flat():
    from app.gaeb.parser import parse_gaeb

    doc = parse_gaeb(SAMPLE_GAEB_X83)
    assert doc.phase == "83"
    assert doc.version == "3.1"
    assert doc.project_name == "Renovierung Musterstrasse 1"
    assert len(doc.positions) == 3

    p0 = doc.positions[0]
    assert p0.oz == "01.001"
    assert p0.kurztext == "Untergrundpruefung"
    assert "Vorbehandlung" in (p0.langtext or "")
    assert p0.menge == Decimal("1.000")
    assert p0.einheit == "psch"
    assert p0.einheitspreis is None  # 0.00 → None

    p1 = doc.positions[1]
    assert p1.oz == "01.002"
    assert p1.menge == Decimal("250.000")
    assert p1.einheit == "m2"


def test_parser_nested_sections():
    from app.gaeb.parser import parse_gaeb

    doc = parse_gaeb(SAMPLE_GAEB_NESTED)
    assert len(doc.positions) == 2
    assert doc.positions[0].oz == "01.001"
    assert doc.positions[1].oz == "01.01.001"
    assert doc.positions[1].menge == Decimal("5.500")
    assert doc.positions[1].einheit == "lfm"


def test_parser_position_with_price():
    xml = b"""<?xml version="1.0" encoding="UTF-8"?>
<GAEB xmlns="http://www.gaeb.de/GAEB_DA_XML/3.1">
  <GAEBInfo><Vers>3.1</Vers><Date>2026-01-01</Date>
    <Conversion><DP>84</DP></Conversion></GAEBInfo>
  <PrjInfo><NamePrj>Test</NamePrj></PrjInfo>
  <Award><BoQ><BoQBody>
    <Pos>
      <PosNo>01.001</PosNo>
      <Description><Short>Streichen</Short></Description>
      <Qty>100.000</Qty><QU>m2</QU><UP>12.50</UP>
    </Pos>
  </BoQBody></BoQ></Award>
</GAEB>"""
    from app.gaeb.parser import parse_gaeb

    doc = parse_gaeb(xml)
    assert doc.positions[0].einheitspreis == Decimal("12.50")


def test_parser_invalid_xml():
    from app.gaeb.parser import GaebParseError, parse_gaeb

    with pytest.raises(GaebParseError, match="invalid XML"):
        parse_gaeb(b"not xml at all <<<<")


def test_parser_no_positions():
    from app.gaeb.parser import GaebParseError, parse_gaeb

    xml = b"""<?xml version="1.0" encoding="UTF-8"?>
<GAEB xmlns="http://www.gaeb.de/GAEB_DA_XML/3.1">
  <GAEBInfo><Vers>3.1</Vers><Date>2026-01-01</Date></GAEBInfo>
  <Award><BoQ><BoQBody></BoQBody></BoQ></Award>
</GAEB>"""
    with pytest.raises(GaebParseError, match="no positions"):
        parse_gaeb(xml)


def test_parser_namespace_detection():
    """Parser handles older 200407 namespace without changes."""
    xml = b"""<?xml version="1.0" encoding="UTF-8"?>
<GAEB xmlns="http://www.gaeb.de/GAEB_DA_XML/200407">
  <GAEBInfo><Vers>3.0</Vers><Date>2026-01-01</Date>
    <Conversion><DP>83</DP></Conversion></GAEBInfo>
  <PrjInfo><NamePrj>Old Format</NamePrj></PrjInfo>
  <Award><BoQ><BoQBody>
    <Pos>
      <PosNo>01.001</PosNo>
      <Description><Short>Test</Short></Description>
      <Qty>10.000</Qty><QU>m2</QU><UP>0.00</UP>
    </Pos>
  </BoQBody></BoQ></Award>
</GAEB>"""
    from app.gaeb.parser import parse_gaeb

    doc = parse_gaeb(xml)
    assert doc.version == "3.0"
    assert len(doc.positions) == 1


# ── Exporter unit tests ───────────────────────────────────────────────────────

def test_exporter_basic():
    import xml.etree.ElementTree as ET

    from app.gaeb.exporter import build_d84

    angebot = {"summe_netto": Decimal("3125.00"), "angebotsnummer": "ANG-2026-0001"}
    positions = [
        {
            "oz": "01.001", "kurztext": "Streichen", "langtext": "2x streichen",
            "menge": Decimal("250.000"), "einheit": "m2",
            "einheitspreis": Decimal("12.50"), "gesamtpreis": Decimal("3125.00"),
            "position_nr": 1,
        }
    ]
    xml_bytes = build_d84(angebot, positions, "Testprojekt")

    assert xml_bytes.startswith(b"<?xml")
    root = ET.fromstring(xml_bytes)

    ns = "http://www.gaeb.de/GAEB_DA_XML/3.1"
    # Phase = 84
    dp = root.find(f"{{{ns}}}GAEBInfo/{{{ns}}}Conversion/{{{ns}}}DP")
    assert dp is not None and dp.text == "84"

    # Project name
    prj = root.find(f"{{{ns}}}PrjInfo/{{{ns}}}NamePrj")
    assert prj is not None and prj.text == "Testprojekt"

    # Position
    pos = root.find(f"{{{ns}}}Award/{{{ns}}}BoQ/{{{ns}}}BoQBody/{{{ns}}}Pos")
    assert pos is not None
    assert pos.find(f"{{{ns}}}PosNo").text == "01.001"
    assert pos.find(f"{{{ns}}}UP").text == "12.50"
    assert pos.find(f"{{{ns}}}Qty").text == "250.000"
    assert pos.find(f"{{{ns}}}QU").text == "m2"

    # Total
    tot = root.find(f"{{{ns}}}Award/{{{ns}}}BoQ/{{{ns}}}BoQTotal/{{{ns}}}TotGP")
    assert tot is not None and tot.text == "3125.00"


# ── Roundtrip check unit tests ────────────────────────────────────────────────

def test_roundtrip_check_passes():
    from app.engine.checks import check_gaeb_roundtrip
    from app.gaeb.parser import parse_gaeb

    doc = parse_gaeb(SAMPLE_GAEB_X83)
    current = [
        {"oz": p.oz, "menge": p.menge, "einheit": p.einheit}
        for p in doc.positions
    ]
    result = check_gaeb_roundtrip(current, doc.positions)
    assert result["passed"] is True
    assert result["rule"] == "gaeb_roundtrip"
    assert result["severity"] == "hard"


def test_roundtrip_check_dropped_position():
    from app.engine.checks import check_gaeb_roundtrip
    from app.gaeb.parser import parse_gaeb

    doc = parse_gaeb(SAMPLE_GAEB_X83)
    current = [
        {"oz": p.oz, "menge": p.menge, "einheit": p.einheit}
        for p in doc.positions[:2]  # drop last position
    ]
    result = check_gaeb_roundtrip(current, doc.positions)
    assert result["passed"] is False
    issues = result["detail"]["issues"]
    types = {i["type"] for i in issues}
    assert "position_dropped" in types or "count_mismatch" in types


def test_roundtrip_check_menge_changed():
    from app.engine.checks import check_gaeb_roundtrip
    from app.gaeb.parser import parse_gaeb

    doc = parse_gaeb(SAMPLE_GAEB_X83)
    current = [
        {"oz": p.oz, "menge": p.menge, "einheit": p.einheit}
        for p in doc.positions
    ]
    # Tamper with menge on position 1
    current[1] = dict(current[1], menge=Decimal("999.000"))
    result = check_gaeb_roundtrip(current, doc.positions)
    assert result["passed"] is False
    types = {i["type"] for i in result["detail"]["issues"]}
    assert "menge_changed" in types


# ── Integration tests ─────────────────────────────────────────────────────────

@pytest.fixture
def gaeb_ag_id(client: TestClient):
    """Fresh auftraggeber for GAEB tests."""
    from app.seed import T1_ID, T1_USER_ID
    h = {"X-Tenant-Id": T1_ID, "X-User-Id": T1_USER_ID}
    r = client.post("/api/auftraggeber", json={"name": "GAEB-Test GmbH", "typ": "oeffentlich"}, headers=h)
    assert r.status_code == 201
    return r.json()["id"]


@pytest.fixture
def gaeb_angebot_id(client: TestClient, gaeb_ag_id):
    """Draft angebot for GAEB tests."""
    from app.seed import T1_ID, T1_USER_ID
    h = {"X-Tenant-Id": T1_ID, "X-User-Id": T1_USER_ID}
    r = client.post("/api/angebot", json={"auftraggeber_id": gaeb_ag_id}, headers=h)
    assert r.status_code == 201
    return r.json()["id"]


def _headers():
    from app.seed import T1_ID, T1_USER_ID
    return {"X-Tenant-Id": T1_ID, "X-User-Id": T1_USER_ID}


def test_gaeb_import(client: TestClient, gaeb_angebot_id):
    r = client.post(
        "/api/gaeb/import",
        data={"angebot_id": gaeb_angebot_id},
        files={"file": ("test.x83", SAMPLE_GAEB_X83, "application/xml")},
        headers=_headers(),
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["position_count"] == 3
    assert body["phase"] == "83"
    assert body["project_name"] == "Renovierung Musterstrasse 1"
    assert "lv_id" in body
    assert "gaeb_artifact_id" in body

    # lv_positions created in DB
    lv_id = body["lv_id"]
    r2 = client.get(f"/api/lv-position?lv_id={lv_id}", headers=_headers())
    assert r2.status_code == 200
    positions = r2.json()
    assert len(positions) == 3
    ozs = {p["oz"] for p in positions}
    assert "01.001" in ozs
    assert "01.002" in ozs
    assert "02.001" in ozs
    # source must be gaeb; match_status is 'review' initially but may be
    # updated to 'auto' or 'review' (with suggestion) by the catalog matcher
    # that runs immediately after import — both are valid.
    for p in positions:
        assert p["match_status"] in {"review", "auto"}
        assert p["source"] == "gaeb"
    # Menge preserved
    p_streichen = next(p for p in positions if p["oz"] == "01.002")
    assert Decimal(str(p_streichen["menge"])) == Decimal("250.000")


def test_gaeb_import_wrong_angebot(client: TestClient):
    """Import against a non-existent angebot → 404."""
    import uuid
    r = client.post(
        "/api/gaeb/import",
        data={"angebot_id": str(uuid.uuid4())},
        files={"file": ("test.x83", SAMPLE_GAEB_X83, "application/xml")},
        headers=_headers(),
    )
    assert r.status_code == 404


def test_gaeb_import_invalid_xml(client: TestClient, gaeb_angebot_id):
    r = client.post(
        "/api/gaeb/import",
        data={"angebot_id": gaeb_angebot_id},
        files={"file": ("bad.x83", b"this is not xml", "application/xml")},
        headers=_headers(),
    )
    assert r.status_code == 422


def test_gaeb_export_d84(client: TestClient, gaeb_angebot_id):
    from app.seed import T1_LEISTUNG_STREICHEN_ID
    import xml.etree.ElementTree as ET

    h = _headers()

    # Import a GAEB LV
    r = client.post(
        "/api/gaeb/import",
        data={"angebot_id": gaeb_angebot_id},
        files={"file": ("test.x83", SAMPLE_GAEB_X83, "application/xml")},
        headers=h,
    )
    assert r.status_code == 201
    lv_id = r.json()["lv_id"]

    # Set einheitspreis on the positions so they can be priced
    positions_r = client.get(f"/api/lv-position?lv_id={lv_id}", headers=h)
    positions = positions_r.json()

    for p in positions:
        client.put(
            f"/api/lv-position/{p['id']}",
            json={
                "lv_id": lv_id,
                "oz": p["oz"],
                "kurztext": p["kurztext"],
                "menge": p["menge"],
                "einheit": p["einheit"],
                "einheitspreis": "10.00",
                "gesamtpreis": str(Decimal(str(p["menge"] or "0")) * Decimal("10.00")),
                "match_status": "confirmed",
                "source": "gaeb",
                "row_version": p["row_version"],
            },
            headers=h,
        )

    # Export D84
    r2 = client.get(f"/api/gaeb/export/{gaeb_angebot_id}", headers=h)
    assert r2.status_code == 200
    assert "xml" in r2.headers["content-type"]
    assert "d84" in r2.headers.get("content-disposition", "").lower()

    # Validate structure
    root = ET.fromstring(r2.content)
    ns = "http://www.gaeb.de/GAEB_DA_XML/3.1"
    dp = root.find(f"{{{ns}}}GAEBInfo/{{{ns}}}Conversion/{{{ns}}}DP")
    assert dp is not None and dp.text == "84"

    boq_body = root.find(f"{{{ns}}}Award/{{{ns}}}BoQ/{{{ns}}}BoQBody")
    pos_els = list(boq_body)
    assert len(pos_els) == 3
    oz_values = {el.find(f"{{{ns}}}PosNo").text for el in pos_els}
    assert "01.001" in oz_values
    assert "01.002" in oz_values


def test_gaeb_roundtrip_check_in_pruefen(client: TestClient, gaeb_angebot_id):
    """After GAEB import + pruefen, gaeb_roundtrip check appears in results."""
    h = _headers()

    # Import GAEB
    r = client.post(
        "/api/gaeb/import",
        data={"angebot_id": gaeb_angebot_id},
        files={"file": ("test.x83", SAMPLE_GAEB_X83, "application/xml")},
        headers=h,
    )
    assert r.status_code == 201
    lv_id = r.json()["lv_id"]

    # Price all positions (simplified — just set gesamtpreis directly)
    positions_r = client.get(f"/api/lv-position?lv_id={lv_id}", headers=h)
    for p in positions_r.json():
        client.put(
            f"/api/lv-position/{p['id']}",
            json={
                "lv_id": lv_id,
                "oz": p["oz"],
                "kurztext": p["kurztext"],
                "menge": p["menge"],
                "einheit": p["einheit"],
                "einheitspreis": "10.00",
                "gesamtpreis": str(Decimal(str(p["menge"] or "1")) * Decimal("10.00")),
                "match_status": "confirmed",
                "source": "gaeb",
                "row_version": p["row_version"],
            },
            headers=h,
        )

    # berechnen
    ang_r = client.get(f"/api/angebot/{gaeb_angebot_id}", headers=h)
    ang = ang_r.json()
    client.post(
        f"/api/angebot/{gaeb_angebot_id}/berechnen",
        json={"row_version": ang["row_version"]},
        headers=h,
    )

    # pruefen
    r2 = client.post(f"/api/angebot/{gaeb_angebot_id}/pruefen", headers=h)
    assert r2.status_code == 200
    rules = {c["rule"] for c in r2.json()}
    assert "gaeb_roundtrip" in rules

    # With unmodified positions the roundtrip check should pass
    rt = next(c for c in r2.json() if c["rule"] == "gaeb_roundtrip")
    assert rt["passed"] is True
