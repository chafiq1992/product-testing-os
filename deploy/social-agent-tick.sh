#!/usr/bin/env bash
# -> /opt/pto/social-agent-tick.sh   (chmod 750, owned by deploy)
#
# Replaces the Cloud Scheduler job `product-testing-os-social-agent`, which
# POSTed to /api/social-agent/scheduler/tick every 5 minutes.
#
# It runs the tick INSIDE the worker container, deliberately:
#
#   * `web` pins WORKER_LOOPS=0 and answers this endpoint with 503, because it
#     is the tier that may one day run several uvicorn workers and every loop in
#     this app is unguarded. Pointing a scheduler at the public hostname would
#     therefore never run the tick at all.
#   * `worker` is the single process that owns scheduled work, and it is not on
#     the edge network — so it has no public URL to point a cloud scheduler at.
#   * Running it in-container means the shared secret never leaves the box and
#     never appears in a command line.
#
# Installed as a cron entry:
#   */5 * * * * /opt/pto/social-agent-tick.sh
set -euo pipefail

cd /opt/pto

out="$(docker compose exec -T worker python -c '
import json, os, sys, urllib.request, urllib.error

key = (os.getenv("SOCIAL_AGENT_SCHEDULER_SECRET") or "").strip()
if not key:
    sys.exit("SOCIAL_AGENT_SCHEDULER_SECRET is not set in the worker")

req = urllib.request.Request(
    "http://127.0.0.1:8080/api/social-agent/scheduler/tick",
    data=b"{}", method="POST")
req.add_header("Content-Type", "application/json")
req.add_header("X-Social-Agent-Key", key)
try:
    r = urllib.request.urlopen(req, timeout=600)
    body = json.loads(r.read() or b"{}")
except urllib.error.HTTPError as e:
    sys.exit("tick HTTP %s: %s" % (e.code, (e.read() or b"")[:300].decode("utf-8", "replace")))

# Keep the log line short: one entry per store, plus any errors.
stores = (body.get("data") or {}).get("stores") or {}
parts = []
for name, item in sorted(stores.items()):
    if not item.get("enabled"):
        parts.append("%s=off" % name); continue
    bits = []
    if item.get("queued"):    bits.append("queued=%d" % len(item["queued"]))
    if item.get("published"): bits.append("published=%d" % len(item["published"]))
    if item.get("errors"):    bits.append("ERRORS=%d" % len(item["errors"]))
    parts.append("%s[%s]" % (name, ",".join(bits) or "idle"))
print(" ".join(parts) or "no stores configured")
' 2>&1)" || {
  logger -t pto-social-agent -p user.err -- "tick FAILED: ${out}"
  echo "tick FAILED: ${out}" >&2
  exit 1
}

logger -t pto-social-agent -p user.info -- "tick ok: ${out}"
echo "tick ok: ${out}"
