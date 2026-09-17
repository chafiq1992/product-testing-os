#!/usr/bin/env bash
# -> /opt/pto/cutover-switch-db.sh   (chmod 750, owned by deploy)
#
# Point this app at the box's Postgres instead of Supabase.
#
#   I_HAVE_STOPPED_CLOUD_RUN=yes /opt/pto/cutover-switch-db.sh
#
# Run this only AFTER /opt/pto/cutover-migrate-db.sh has completed against the
# real `pto` database and reported matching row counts.
#
# This is the point of no return for data: from here, writes go to the box and
# Supabase stops receiving them. Rolling back means either accepting the loss of
# everything written since the switch, or migrating back the other way.
set -euo pipefail

if [ "${I_HAVE_STOPPED_CLOUD_RUN:-}" != "yes" ]; then
  cat >&2 <<'MSG'
✗ refusing to switch while Cloud Run may still be serving.

  Both deployments share the Supabase database today. Switching this one to a
  local database while Cloud Run still writes to Supabase splits your data in
  two with no way to merge it back.

  Stop Cloud Run first:
    gcloud run services update product-testing-os-4 --region europe-west1 \
      --project sinuous-bedrock-347205 --ingress=internal
    gcloud scheduler jobs pause product-testing-os-social-agent \
      --location europe-west1 --project sinuous-bedrock-347205
MSG
  exit 1
fi

cd /opt/postgres
PGPW="$(cat /opt/postgres/.superuser_password)"
APPPW="$(cat /opt/pto/.dbpassword)"
psu() { docker compose exec -T -e PGPASSWORD="$PGPW" postgres psql -U postgres -v ON_ERROR_STOP=1 "$@" </dev/null; }

# The target must actually hold the migrated data. Switching to an empty
# database would "work": create_all would build a fresh empty schema at import
# and the app would come up healthy with no data at all.
tables="$(psu -tAd pto -c 'select count(*) from pg_stat_user_tables' | tr -d '[:space:]')"
if [ "${tables:-0}" -lt 10 ]; then
  echo "✗ database 'pto' holds only ${tables} tables — run cutover-migrate-db.sh first." >&2
  echo "  Switching to an empty database does not fail loudly: the app would" >&2
  echo "  create an empty schema at import and report itself healthy." >&2
  exit 1
fi
rows="$(psu -tAd pto -c 'select count(*) from app_settings' | tr -d '[:space:]')"
echo "target 'pto' holds ${tables} tables, app_settings=${rows} rows"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
cp -a /opt/pto/app.env "/opt/pto/app.env.pre-dbswitch.${STAMP}"
chmod 600 "/opt/pto/app.env.pre-dbswitch.${STAMP}"
echo "backed up app.env -> app.env.pre-dbswitch.${STAMP}"

# `postgres-shared` is the network alias, never the bare service name — another
# app on pgnet may reuse `postgres`.
NEW="postgresql://pto:${APPPW}@postgres-shared:5432/pto"
python3 - "$NEW" <<'PY'
import sys, pathlib
new = sys.argv[1]
p = pathlib.Path("/opt/pto/app.env")
lines = p.read_text().splitlines()
out, replaced = [], False
for line in lines:
    if line.startswith("DATABASE_URL="):
        out.append("DATABASE_URL=" + new)
        replaced = True
    else:
        out.append(line)
if not replaced:
    out.append("DATABASE_URL=" + new)
# LF only: a \r here becomes part of the dbname for every shell tool that reads
# this file, which is how pg_dump once failed with 'database "postgres" does
# not exist'. Compose strips them, so the app would not have told you.
p.write_text("\n".join(out) + "\n", newline="\n")
print("DATABASE_URL rewritten (%s)" % ("replaced" if replaced else "appended"))
PY
chmod 600 /opt/pto/app.env

echo "-- restarting health-gated --"
cd /opt/pto
docker compose up -d --wait

echo
echo "-- verify --"
docker compose exec -T web python -c "
import json, urllib.request, os
from sqlalchemy import create_engine, text
h = json.load(urllib.request.urlopen('http://127.0.0.1:8080/health', timeout=15))
print('health status  :', h.get('status'))
print('db dialect     :', h.get('checks', {}).get('database', {}).get('dialect'))
eng = create_engine(os.environ['DATABASE_URL'], future=True)
with eng.connect() as c:
    print('database       :', c.execute(text('select current_database()')).scalar())
    print('connected as   :', c.execute(text('select current_user')).scalar())
    print('app_settings   :', c.execute(text('select count(*) from app_settings')).scalar())
"

echo
echo "✓ switched to the box's Postgres."
echo
echo "  Rollback (only valid if nothing important has been written since):"
echo "    cp -a /opt/pto/app.env.pre-dbswitch.${STAMP} /opt/pto/app.env"
echo "    cd /opt/pto && docker compose up -d --wait"
echo
echo "  Supabase still holds the pre-switch data. Do not delete that project"
echo "  until this box has been the source of truth long enough to trust, and"
echo "  until a backup of the local database exists (/opt/postgres/backup.sh)."
