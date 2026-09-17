#!/usr/bin/env bash
# -> /opt/pto/deploy.sh   (chmod 750, owned by deploy)
#
# Release product-testing-os on this box.
#   /opt/pto/deploy.sh <tag>     build and release that tag
#   /opt/pto/deploy.sh           re-release as :latest
#
# The image is built here from /opt/pto/src rather than pulled: this repo has no
# CI publishing anywhere we can pull from (the Cloud Run revisions were built
# from a source zip by hand), and pulling from Artifact Registry would mean
# putting long-lived GCP credentials on this box. Push the source first with
# deploy/push-source.sh from a checkout.
set -euo pipefail
cd /opt/pto

TAG="${1:-latest}"
SRC=/opt/pto/src

if [ ! -f "${SRC}/Dockerfile" ]; then
  echo "✗ no source at ${SRC} — run deploy/push-source.sh from a checkout first" >&2
  exit 1
fi

if [ ! -s /opt/pto/app.env ]; then
  echo "✗ /opt/pto/app.env is missing or empty — run deploy/pull-env.sh first" >&2
  exit 1
fi

sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=${TAG}/" /opt/pto/.env

echo "→ building product-testing-os:${TAG}"
docker build -t "product-testing-os:${TAG}" -t "product-testing-os:latest" "${SRC}"

# Fail-closed database gate.
#
# This app has no migration command: five modules call Base.metadata.create_all()
# at IMPORT time, so the schema is applied by the act of starting the container.
# That makes two things true, and this step exists for both:
#
#   1. There is no chance to catch a bad database *after* `up -d` without having
#      already replaced the running container. So the check runs first, in a
#      throwaway container, and a non-zero exit leaves the live one untouched.
#   2. With DATABASE_URL unset, db.py falls back to sqlite:////app/data/app.db
#      and create_all cheerfully builds an empty schema. The app then looks
#      perfectly healthy while holding none of the real data. Asserting the
#      dialect is the only way to catch that before it serves a request.
#
# It deliberately does NOT import the app — importing is itself a schema write,
# and this must stay a read-only probe.
echo "→ database preflight"
docker compose run --rm --no-deps web python -c '
import os, sys
from sqlalchemy import create_engine, text

url = (os.getenv("DATABASE_URL") or "").strip()
if not url:
    sys.exit("DATABASE_URL is empty — the app would silently run on the ephemeral SQLite fallback")

eng = create_engine(url, future=True, pool_pre_ping=True)
if eng.dialect.name != "postgresql":
    sys.exit(f"DATABASE_URL resolves to {eng.dialect.name!r}, expected postgresql")

with eng.connect() as c:
    c.execute(text("SELECT 1"))
    host, db = c.execute(text("SELECT inet_server_addr(), current_database()")).one()
print(f"  ok: postgresql {db} @ {host}")
'

# --wait blocks on the healthcheck, and that healthcheck parses /health's body
# rather than its status code (/health answers 200 even when degraded). A
# container that cannot reach its database therefore never silently replaces a
# working one. Caddy's lb_try_duration holds requests across the swap instead of
# returning 502.
echo "→ restarting"
docker compose up -d --wait

docker image prune -f

# Deploy ledger — the thing Cloud Run's revision list used to give us. One JSON
# line per successful release, written into the uploads volume so it survives
# container replacement. Written only after `up --wait` succeeds, so it records
# releases that actually came up healthy, not ones merely attempted.
REL_COMMIT="$(git -C "${SRC}" rev-parse --short HEAD 2>/dev/null || echo '')"
REL_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
REL_BY="${SUDO_USER:-${USER:-unknown}}"
REL_JSON="$(printf '{"at":"%s","tag":"%s","commit":"%s","by":"%s","worker_loops":"%s"}' \
  "${REL_AT}" "${TAG}" "${REL_COMMIT}" "${REL_BY}" \
  "$(grep -m1 '^WORKER_LOOPS=' /opt/pto/.env | cut -d= -f2)")"
docker compose exec -T web sh -c \
  "mkdir -p /app/uploads/.deploy && printf '%s\n' '${REL_JSON}' >> /app/uploads/.deploy/releases.jsonl" \
  2>/dev/null || echo "  (could not write deploy ledger — not fatal)"

echo "✓ released ${TAG}"
echo

# Scheduled work is the one thing that must never be on in two places at once,
# so the release prints where it actually stands rather than where .env says.
echo "  worker loops (.env):  $(grep -E '^WORKER_LOOPS=' /opt/pto/.env)"
for svc in web worker; do
  reported="$(docker compose exec -T "${svc}" python -c \
    "import json,urllib.request; print(json.load(urllib.request.urlopen('http://127.0.0.1:8080/health',timeout=8)).get('worker_loops_detail'))" \
    2>/dev/null || echo '?')"
  echo "  reported by ${svc}:     ${reported}"
done
echo
echo "  Cloud Run still owns scheduled work until the Cloud Scheduler job"
echo "  'product-testing-os-social-agent' is paused. Both lines above must read"
echo "  'disabled' until then."
