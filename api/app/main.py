"""FastAPI application entry point.

Thin: lifespan (pool open/close), CORS, health probe, and router registration.
Feature modules hang off the routers in app/routers/. The OpenAPI schema at
/openapi.json is the source the TypeScript client is generated from
(directive 10, layer contract).
"""
from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .db import healthcheck, pool
from .jobs import expire_gewaehrleistung_loop
from .routers import (
    abnahmeprotokoll, adresse, angebot, app_user, arbeitszeit, aufmass, aufmass_entry,
    auftraggeber, bankverbindung,
    bestellung, bestellposition, check_result, dashboard, fahrt, fahrzeug, gaeb,
    geocode, gewaehrleistung, kontakt, leistung, leistungskatalog, lieferant, lv,
    lv_position, mangel, mangel_foto, material, projekt, rechnung, rechnung_position,
    tenant_billing_profile, tenant_tax_profile, voice,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    pool.open()
    task = asyncio.create_task(expire_gewaehrleistung_loop())
    try:
        yield
    finally:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
        pool.close()


app = FastAPI(title="Aufmaß API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"] if settings.is_dev else [],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(app_user.router)
app.include_router(aufmass.router)
app.include_router(aufmass_entry.router)
app.include_router(gaeb.router)
app.include_router(auftraggeber.router)
app.include_router(adresse.router)
app.include_router(bankverbindung.router)
app.include_router(tenant_billing_profile.router)
app.include_router(kontakt.router)
app.include_router(projekt.router)
app.include_router(arbeitszeit.router)
app.include_router(fahrzeug.router)
app.include_router(fahrt.router)
app.include_router(lieferant.router)
app.include_router(material.router)
app.include_router(bestellung.router)
app.include_router(bestellposition.router)
app.include_router(abnahmeprotokoll.router)
app.include_router(mangel.router)
app.include_router(mangel_foto.router)
app.include_router(gewaehrleistung.router)
app.include_router(tenant_tax_profile.router)
app.include_router(leistungskatalog.router)
app.include_router(leistung.router)
app.include_router(angebot.router)
app.include_router(lv.router)
app.include_router(lv_position.router)
app.include_router(rechnung.router)
app.include_router(rechnung_position.router)
app.include_router(check_result.router)
app.include_router(dashboard.router)
app.include_router(voice.router)
app.include_router(geocode.router)


@app.get("/health", tags=["ops"])
def health() -> dict:
    """Liveness + DB reachability. No tenant context required."""
    return {"status": "ok", "db": healthcheck(), "env": settings.env}
