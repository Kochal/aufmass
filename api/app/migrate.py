"""Migration runner: applies migrations/*.sql in order, exactly once each.

Run as the one-shot `migrate` Compose service before the api serves traffic
(directive 10: "Migrations on startup ... a fresh clone lands on the current
schema automatically"). Invoked as `python -m app.migrate`.

Design (consistent with notes/ops/2026-06-23-migrations-and-test-tooling.md):
the migrations are plain, forward-only SQL. This runner does NOT reimplement an
ORM migration framework; it tracks which files have been applied in a
schema_migrations table and applies the pending ones with `psql
--single-transaction`, the same tool the guarantee suites use. Dollar-quoted
function bodies make naive ;-splitting wrong, so we hand whole files to psql
rather than parsing SQL ourselves.

Connection roles (the RLS footgun, directive 02 / the tooling note):
  * MIGRATE runs as a superuser / migration_role (DATABASE_URL on the migrate
    service): the migrations CREATE ROLE and install SECURITY DEFINER functions.
  * The API runs as a NON-superuser login role in app_role. In dev only, this
    runner bootstraps that role after migrating, so "clone, up, working" holds
    with real RLS rather than a superuser that would silently bypass it.
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import psycopg
from psycopg import sql

DATABASE_URL = os.environ["DATABASE_URL"]  # superuser / migration_role in dev
MIGRATIONS_DIR = Path(os.environ.get("MIGRATIONS_DIR", "/migrations"))


def _ensure_bookkeeping(conn: psycopg.Connection) -> None:
    conn.execute(
        """
        create table if not exists schema_migrations (
            filename    text primary key,
            applied_at  timestamptz not null default now()
        )
        """
    )
    conn.commit()


def _applied(conn: psycopg.Connection) -> set[str]:
    return {row[0] for row in conn.execute("select filename from schema_migrations")}


def _apply(path: Path) -> None:
    # psql, single transaction, stop on first error — atomic per file.
    proc = subprocess.run(
        ["psql", DATABASE_URL, "--single-transaction",
         "-v", "ON_ERROR_STOP=1", "--no-psqlrc", "-q", "-f", str(path)],
        check=False,
        stdout=subprocess.DEVNULL,  # query result rows are noise; errors go to stderr
    )
    if proc.returncode != 0:
        raise SystemExit(f"migration failed: {path.name} (psql exit {proc.returncode})")


def _bootstrap_dev_app_role(conn: psycopg.Connection) -> None:
    """Dev-only: create the non-superuser login role the API connects as, as a
    member of app_role, so RLS is exercised on a developer's machine exactly as
    in production. No-op outside ENV=dev. Never creates login roles in prod —
    that belongs to the deployment runbook (directive 09)."""
    if os.environ.get("ENV") != "dev":
        return
    user = os.environ.get("APP_DB_USER", "app")
    pw = os.environ.get("APP_DB_PASSWORD", "app_dev")
    # CREATE/ALTER ROLE cannot take query parameters and DO blocks cannot be
    # parameterized, so compose the identifier/literal safely instead.
    ident = sql.Identifier(user)
    exists = conn.execute(
        "select 1 from pg_roles where rolname = %s", (user,)
    ).fetchone()
    if exists:
        conn.execute(
            sql.SQL("alter role {} login password {}").format(ident, sql.Literal(pw))
        )
    else:
        conn.execute(
            sql.SQL(
                "create role {} login nosuperuser nobypassrls inherit password {}"
            ).format(ident, sql.Literal(pw))
        )
    conn.execute(sql.SQL("grant app_role to {}").format(ident))
    conn.commit()
    print(f"migrate: dev app login role '{user}' ensured (member of app_role)")


def main() -> None:
    if not MIGRATIONS_DIR.is_dir():
        raise SystemExit(f"migrations dir not found: {MIGRATIONS_DIR}")
    files = sorted(MIGRATIONS_DIR.glob("*.sql"))
    if not files:
        raise SystemExit(f"no migrations in {MIGRATIONS_DIR}")

    with psycopg.connect(DATABASE_URL, autocommit=False) as conn:
        _ensure_bookkeeping(conn)
        done = _applied(conn)

    pending = [f for f in files if f.name not in done]
    if not pending:
        print(f"migrate: up to date ({len(files)} applied)")
    for f in pending:
        print(f"migrate: applying {f.name}")
        _apply(f)
        with psycopg.connect(DATABASE_URL, autocommit=True) as conn:
            conn.execute("insert into schema_migrations(filename) values (%s)", (f.name,))

    with psycopg.connect(DATABASE_URL, autocommit=False) as conn:
        _bootstrap_dev_app_role(conn)

    print("migrate: done")


if __name__ == "__main__":
    sys.exit(main())
