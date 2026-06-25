"""FastAPI application entry point.

Thin: lifespan (pool open/close), CORS, health probe, and router registration.
Feature modules hang off the routers in app/routers/. The OpenAPI schema at
/openapi.json is the source the TypeScript client is generated from
(directive 10, layer contract).
"""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .db import healthcheck, pool
from .routers import (
    abnahmeprotokoll, arbeitszeit, auftraggeber, bestellung, bestellposition,
    fahrt, fahrzeug, gewaehrleistung, kontakt, lieferant, mangel, material, projekt,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    pool.open()
    try:
        yield
    finally:
        pool.close()


app = FastAPI(title="Aufmaß API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"] if settings.is_dev else [],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auftraggeber.router)
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
app.include_router(gewaehrleistung.router)


@app.get("/health", tags=["ops"])
def health() -> dict:
    """Liveness + DB reachability. No tenant context required."""
    return {"status": "ok", "db": healthcheck(), "env": settings.env}
