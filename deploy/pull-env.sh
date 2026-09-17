#!/usr/bin/env bash
# Build /opt/pto/app.env on the box from the LIVE Cloud Run revision.
#
#   ./deploy/pull-env.sh deploy@159.195.204.91
#   ./deploy/pull-env.sh deploy@159.195.204.91 --dry-run    # names only, no values
#
# Run it from a shell where `gcloud auth list` already shows your account.
#
# Unlike the delivery app, most of this service's configuration is NOT in Secret
# Manager — it sits as plaintext environment variables on the revision, secrets
# and all. So this does not read a hand-written list of secret names: it reads
# the revision itself and reproduces it, resolving the handful of
# secretKeyRef entries as it goes. That also means it stays correct when someone
# adds a variable in the Cloud Run console without telling anyone.
#
# Values are piped over SSH. Nothing is printed and nothing is written locally.
set -euo pipefail

TARGET="${1:?usage: pull-env.sh user@host [--dry-run]}"
MODE="${2:-}"
PROJECT=sinuous-bedrock-347205
REGION=europe-west1
SERVICE=product-testing-os-4
REMOTE_FILE=/opt/pto/app.env

# The SERVING revision, which is not the same thing as the service's latest
# template: this service has several tagged revisions and the one taking 100% of
# traffic is an older tag than the newest created.
REVISION="$(gcloud run services describe "${SERVICE}" \
  --project "${PROJECT}" --region "${REGION}" --format=json \
  | python -c '
import json, sys
svc = json.load(sys.stdin)
for t in svc.get("status", {}).get("traffic", []):
    if t.get("percent") == 100:
        print(t["revisionName"]); break
')"

if [ -z "${REVISION}" ]; then
  echo "✗ could not determine the revision serving 100% of traffic" >&2
  exit 1
fi
echo "→ reading revision ${REVISION}" >&2

# stdout carries the env file and goes straight into ssh; every diagnostic goes
# to stderr. No value is ever written to local disk, not even to a temp file.
render() {
gcloud run revisions describe "${REVISION}" \
  --project "${PROJECT}" --region "${REGION}" --format=json \
| python -u -c '
import json, subprocess, sys

# This script is normally run from Windows/Git-Bash, where print() writes CRLF.
# Those \r characters end up inside app.env. Docker Compose strips them when it
# parses env_file, so the app never notices — but every shell tool that reads
# the file with `grep | cut` gets a value with a trailing \r. That is how
# DATABASE_URL turned into a dbname of "postgres\r" and pg_dump failed with
# `database "postgres" does not exist`. Force LF on the way out.
sys.stdout.reconfigure(newline="\n")

PROJECT = "'"${PROJECT}"'"
DRY = "'"${MODE}"'" == "--dry-run"

rev = json.load(sys.stdin)
container = rev["spec"]["containers"][0]
entries = container.get("env") or []

# Variables /opt/pto/compose.yaml sets for itself. Writing them here too would
# leave a working Upstash URL in app.env: if the compose `environment:` block
# were ever removed, the app would silently reconnect to Upstash over the public
# internet instead of failing loudly. They are deliberately not carried over.
OWNED_BY_COMPOSE = {
    "CELERY_BROKER_URL",
    "CELERY_RESULT_BACKEND",
    "UPLOADS_DIR",
    "STATIC_DIR",
    "USE_CELERY",
    "WORKER_LOOPS",
}

out: "dict[str, str]" = {}
notes: "list[str]" = []


# On Windows/Git-Bash `gcloud` is a .cmd shim, which CreateProcess will not find
# from a bare name, so resolve it up front rather than relying on shell=True.
import shutil
GCLOUD = shutil.which("gcloud") or shutil.which("gcloud.cmd") or "gcloud"


def secret(name: str, version: str) -> str:
    return subprocess.run(
        [GCLOUD, "secrets", "versions", "access", version,
         "--secret", name, "--project", PROJECT],
        check=True, capture_output=True, text=True,
    ).stdout


for item in entries:
    raw_name = item.get("name", "")
    name = raw_name.strip()

    # Two entries on this revision have a trailing TAB in the KEY itself:
    # "SHOPIFY_STORE_URL\t" and "SHOPIFY_ACCESS_TOKEN\t". Because the code reads
    # os.getenv("SHOPIFY_ACCESS_TOKEN"), that Shopify token has never actually
    # reached the app — the default store runs on SHOPIFY_API_KEY +
    # SHOPIFY_PASSWORD basic auth instead (shopify_client.py:340).
    #
    # DECISION: do not repair them. Writing the cleaned key would activate a
    # credential path that has been dead in production, flipping the default
    # store from basic auth to token auth. A hosting migration must not change
    # which credentials talk to Shopify. Revisit deliberately, later, on its own.
    if raw_name != name:
        notes.append(f"SKIPPED {name!r}: key had trailing whitespace on the revision "
                     f"(it never reached the app; not repaired on purpose)")
        continue

    if name in OWNED_BY_COMPOSE:
        notes.append(f"skipped {name}: set by compose.yaml instead")
        continue

    if "value" in item:
        value = item["value"]
        src = "literal"
    else:
        ref = item["valueFrom"]["secretKeyRef"]
        # Honour the pinned version: META_ACCESS_TOKEN is pinned to version 6,
        # not latest. Resolving it as latest would swap in a different token.
        #
        # Note for anyone editing this block: it is embedded in a single-quoted
        # shell string, so a single quote ANYWHERE in this Python silently ends
        # that string and mangles the code. Use double quotes only.
        sname, skey = ref["name"], ref["key"]
        value = secret(sname, skey)
        src = f"secret {sname}:{skey}"

    value = value.strip()
    if "\n" in value or "\r" in value:
        sys.exit(f"✗ {name} contains a newline; an env file cannot hold it")

    if name in out:
        notes.append(f"DUPLICATE {name}: defined more than once on the revision; "
                     f"taking the last definition, matching Cloud Run")
    out[name] = value
    if DRY:
        notes.append(f"  {name} <- {src} ({len(value)} chars)")

for n in notes:
    print(n, file=sys.stderr)
print(f"→ {len(out)} variables", file=sys.stderr)

if not DRY:
    for k, v in out.items():
        print(f"{k}={v}")
'
}

if [ "${MODE}" = "--dry-run" ]; then
  # Prints only names and lengths, on stderr. stdout stays empty.
  render
  echo "✓ dry run — nothing written" >&2
  exit 0
fi

# A failure anywhere in render() must not truncate app.env on the box, so the
# remote file is only replaced once the whole stream has arrived: write to a
# sibling temp file and rename, which is atomic on the same filesystem.
# `tr -d \r` is a second line of defence for the CRLF problem described above:
# if this ever runs through a shell or Python build that reintroduces them, the
# file on the box is still clean. No legitimate value here contains a CR.
render | ssh "${TARGET}" \
  "umask 077 && tr -d '\\r' > ${REMOTE_FILE}.new && chmod 600 ${REMOTE_FILE}.new && mv ${REMOTE_FILE}.new ${REMOTE_FILE}"

echo "✓ wrote ${TARGET}:${REMOTE_FILE}" >&2
echo >&2
echo "  Verify WITHOUT printing values:" >&2
echo "    ssh ${TARGET} 'cut -d= -f1 ${REMOTE_FILE} | sort | uniq -d'   # must be empty" >&2
echo "    ssh ${TARGET} 'grep -c . ${REMOTE_FILE}'" >&2
echo "    ssh ${TARGET} 'cut -d= -f1 ${REMOTE_FILE} | sort'" >&2
