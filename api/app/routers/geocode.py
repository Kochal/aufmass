"""Nominatim geocoding proxy (UI round 3).

Proxies address-search queries server-side to nominatim.openstreetmap.org so
the browser never calls the external API directly (no user-IP leak; proper
User-Agent; swappable to self-hosted Photon with one config change).

DATENSCHUTZ CAVEAT: typed address text is sent to OSMF (UK, no DPA in place).
Acceptable for dev/demo; resolve before production (see
notes/infra/2026-06-29-nominatim-geocoding.md).

No tenant auth required — this is a utility endpoint over public geocoding data.
The response contains no PII; it is a structured address suggestion.
"""
from __future__ import annotations

import httpx
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from ..config import settings

router = APIRouter(tags=["Geocode"])

_TIMEOUT = 5.0  # seconds — public Nominatim can be slow under load


class GeocodeResult(BaseModel):
    label: str
    strasse: str | None = None
    hausnummer: str | None = None
    plz: str | None = None
    ort: str | None = None
    land: str | None = None  # ISO 3166-1 alpha-2


@router.get("/api/geocode", response_model=list[GeocodeResult])
def geocode(
    q: str = Query(..., min_length=3, max_length=200),
    countrycodes: str = Query(default="de,at,ch"),
) -> list[GeocodeResult]:
    """Forward address query to Nominatim; return trimmed suggestions.

    Parameters
    ----------
    q            free-text address query
    countrycodes comma-separated ISO alpha-2 codes to bias results (default: DACH)
    """
    try:
        resp = httpx.get(
            f"{settings.nominatim_url}/search",
            params={
                "q": q,
                "format": "jsonv2",
                "addressdetails": "1",
                "limit": "6",
                "countrycodes": countrycodes,
            },
            headers={"User-Agent": settings.nominatim_user_agent},
            timeout=_TIMEOUT,
        )
        resp.raise_for_status()
    except httpx.TimeoutException:
        raise HTTPException(504, "geocoding service timed out")
    except httpx.HTTPStatusError as exc:
        raise HTTPException(502, f"geocoding service error: {exc.response.status_code}")
    except httpx.RequestError as exc:
        raise HTTPException(502, f"geocoding service unreachable: {exc}")

    results: list[GeocodeResult] = []
    for hit in resp.json():
        addr = hit.get("address", {})
        road = addr.get("road") or addr.get("pedestrian") or addr.get("path")
        house = addr.get("house_number")
        postcode = addr.get("postcode")
        city = (
            addr.get("city")
            or addr.get("town")
            or addr.get("village")
            or addr.get("municipality")
        )
        country_code = (addr.get("country_code") or "de").upper()

        label = hit.get("display_name", "")
        results.append(GeocodeResult(
            label=label,
            strasse=road,
            hausnummer=house,
            plz=postcode,
            ort=city,
            land=country_code,
        ))

    return results
