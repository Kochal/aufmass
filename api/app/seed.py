"""Idempotent dev seed: tenants, users, and nummernkreis for the dev stack.

Fixed UUIDs survive restarts. Runs as the migrate superuser after migrations
complete (ENV=dev only). ON CONFLICT DO NOTHING makes it safe to re-run.

Use these values for the dev header-stub auth:
  T1: X-Tenant-Id: 11111111-0000-0000-0000-000000000001
      X-User-Id:   11111111-0000-0000-0000-000000000002
  T2: X-Tenant-Id: 22222222-0000-0000-0000-000000000001
      X-User-Id:   22222222-0000-0000-0000-000000000002
"""
from __future__ import annotations

import os

import psycopg

T1_ID = "11111111-0000-0000-0000-000000000001"
T1_USER_ID = "11111111-0000-0000-0000-000000000002"
T2_ID = "22222222-0000-0000-0000-000000000001"
T2_USER_ID = "22222222-0000-0000-0000-000000000002"

_DATABASE_URL = os.environ.get("DATABASE_URL", "")


def run() -> None:
    if not _DATABASE_URL:
        print("migrate: seed skipped (DATABASE_URL not set)")
        return
    with psycopg.connect(_DATABASE_URL, autocommit=False) as conn:
        # Set actor for audit triggers (session-level, not transaction-local).
        conn.execute("select set_config('app.user_id', 'dev-seed', false)")

        # Tenants (tenant.id IS the tenant scope, so no tenant_id column).
        conn.execute(
            "insert into tenant(id, name) values (%s, %s) on conflict do nothing",
            (T1_ID, "Maler Müller GmbH (dev T1)"),
        )
        conn.execute(
            "insert into tenant(id, name) values (%s, %s) on conflict do nothing",
            (T2_ID, "Boden Schmidt KG (dev T2)"),
        )

        # App users.
        conn.execute(
            "insert into app_user(id, tenant_id, email, display_name, role) "
            "values (%s,%s,%s,%s,'inhaber') on conflict do nothing",
            (T1_USER_ID, T1_ID, "admin@mueller-maler.de", "Admin T1"),
        )
        conn.execute(
            "insert into app_user(id, tenant_id, email, display_name, role) "
            "values (%s,%s,%s,%s,'inhaber') on conflict do nothing",
            (T2_USER_ID, T2_ID, "admin@schmidt-boden.de", "Admin T2"),
        )

        # Nummernkreis for projekt (unique on tenant_id, doc_type).
        for tid in (T1_ID, T2_ID):
            conn.execute(
                "insert into nummernkreis(tenant_id, doc_type, format, reset_policy) "
                "values (%s, 'projekt', 'P-{YYYY}-{SEQ:4}', 'none') "
                "on conflict (tenant_id, doc_type) do nothing",
                (tid,),
            )

        conn.commit()

    print("migrate: dev seed applied")
    print(f"  T1: X-Tenant-Id: {T1_ID}  X-User-Id: {T1_USER_ID}")
    print(f"  T2: X-Tenant-Id: {T2_ID}  X-User-Id: {T2_USER_ID}")
