"""Background jobs that run in the FastAPI lifespan.

Each job is a plain asyncio coroutine that loops forever. Sync DB calls are
offloaded to asyncio.to_thread so the event loop stays responsive.
"""
from __future__ import annotations

import asyncio
import logging

from .db import pool

log = logging.getLogger(__name__)


def _expire_gewaehrleistung() -> int:
    with pool.connection() as conn:
        row = conn.execute("SELECT core.expire_gewaehrleistung()").fetchone()
        return row["expire_gewaehrleistung"] if row else 0


async def expire_gewaehrleistung_loop() -> None:
    """Flip laufend → abgelaufen for Gewährleistung whose frist_ende has passed.

    Runs once at startup (catches anything that slipped through while the
    server was down), then every 24 hours.
    """
    while True:
        try:
            count = await asyncio.to_thread(_expire_gewaehrleistung)
            if count:
                log.info("expire_gewaehrleistung: %d row(s) expired", count)
        except Exception:
            log.exception("expire_gewaehrleistung: error")
        await asyncio.sleep(24 * 60 * 60)
