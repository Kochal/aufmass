#!/usr/bin/env bash
# Apply the foundation migrations and run the guarantee test suite.
#
# Connection comes from the standard libpq env vars; set them for the target DB:
#   PGHOST=... PGPORT=... PGUSER=... PGDATABASE=... tests/run.sh
#
# Run against a FRESH database. Migrations must run as a superuser or
# migration_role: they create roles and SECURITY DEFINER functions. The test
# itself SETs ROLE app_role to exercise RLS, so the connecting role must be able
# to do so (superuser, or a member of app_role that is not itself BYPASSRLS).
set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)"
PSQL=(psql -v ON_ERROR_STOP=1 --no-psqlrc -q)

echo "== applying migrations =="
for f in "$DIR"/migrations/*.sql; do
  echo "-- $(basename "$f")"
  "${PSQL[@]}" -f "$f" >/dev/null
done

echo "== running foundation (02) guarantee suite =="
"${PSQL[@]}" -f "$DIR/tests/foundation_test.sql"

echo "== running operational (05) guarantee suite =="
"${PSQL[@]}" -f "$DIR/tests/operations_test.sql"

echo "== running quotation (06) guarantee suite =="
"${PSQL[@]}" -f "$DIR/tests/quotation_test.sql"
