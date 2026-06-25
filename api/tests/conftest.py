"""pytest configuration for the API test suite.

Runs against the real compose postgres using the seeded dev tenants.
Start the stack first: docker compose up -d
Run inside the api container: docker compose exec api sh -c "pip install -q pytest && python -m pytest"
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.seed import T1_ID, T1_USER_ID, T2_ID, T2_USER_ID

T1 = {"X-Tenant-Id": T1_ID, "X-User-Id": T1_USER_ID}
T2 = {"X-Tenant-Id": T2_ID, "X-User-Id": T2_USER_ID}


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:
        yield c
