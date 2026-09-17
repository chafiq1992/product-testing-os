#!/usr/bin/env bash
# -> /opt/pto/cutover-rewrite-urls.sh   (chmod 750, owned by deploy)
#
# Repoint absolute Cloud Run URLs stored INSIDE the database at the new host.
#
#   /opt/pto/cutover-rewrite-urls.sh                 dry run (default)
#   /opt/pto/cutover-rewrite-urls.sh --apply         write the changes
#   /opt/pto/cutover-rewrite-urls.sh --revert        put the old host back
#
# Why this is needed: ~175 references across 59 upload filenames are stored as
# absolute `https://...run.app/uploads/<file>` URLs in app_settings,
# wholesale_product_batches, flows and tests. The FILES survive Cloud Run's
# deletion — 56 of 59 live in Postgres as `upload_blob:` rows — but the hostname
# in the stored URL does not. Without this rewrite the ad launcher and wholesale
# history show broken images even though the underlying data is intact.
#
# Each mode runs in ONE transaction. Dry run writes nothing, and --revert is an
# exact inverse, so this stays reversible until something writes a fresh
# run.app URL — which stops happening once BASE_URL moves to the new host.
set -euo pipefail

MODE="${1:---dry-run}"
case "$MODE" in
  --dry-run|--apply|--revert) ;;
  *) echo "usage: $0 [--dry-run|--apply|--revert]" >&2; exit 2 ;;
esac

cd /opt/pto
# NOTE: no `</dev/null` here — the heredoc IS this command's stdin, and a
# redirect after it silently wins, leaving python with nothing to read.
docker compose exec -T -e MODE="$MODE" web python - <<'PY'
import os, re
from sqlalchemy import create_engine, text

MODE = os.environ["MODE"]
NEW = "https://pt.chattbase.site"
# Both hostnames the Cloud Run service answers on. BASE_URL uses the
# project-number form; the shorter form appears wherever a URL was derived from
# the request host instead.
OLD = [
    "https://product-testing-os-4-985002633728.europe-west1.run.app",
    "https://product-testing-os-4-z4sedtia6a-ew.a.run.app",
]
TARGETS = [
    ("app_settings", "value"),
    ("wholesale_product_batches", "payload"),
    ("wholesale_product_batches", "items"),
    ("flows", "product_json"),
    ("tests", "payload_json"),
]

eng = create_engine(os.environ["DATABASE_URL"], future=True)
print("mode       :", MODE)
print("rewriting  :", ("run.app -> " + NEW) if MODE != "--revert" else (NEW + " -> " + OLD[0]))
print()

def count(c, col, table, needle):
    return c.execute(text('SELECT count(*) FROM "%s" WHERE "%s" LIKE :p' % (table, col)),
                     {"p": "%" + needle + "%"}).scalar()

# Surface any run.app host this script does not know about, instead of
# silently leaving it broken.
with eng.connect() as c:
    unknown = set()
    for t, col in TARGETS:
        for (v,) in c.execute(text('SELECT "%s" FROM "%s" WHERE "%s" LIKE :p' % (col, t, col)),
                              {"p": "%run.app%"}).fetchall():
            for m in re.finditer(r"https://[A-Za-z0-9.\-]*\.run\.app", v or ""):
                if m.group(0) not in OLD:
                    unknown.add(m.group(0))
    if unknown:
        print("!! run.app hosts this script does NOT rewrite:")
        for u in sorted(unknown):
            print("     ", u)
        print("   Add them to OLD before applying, or they stay broken.\n")

needle_before = NEW if MODE == "--revert" else "run.app"
total = 0
with eng.connect() as c:
    for t, col in TARGETS:
        n = count(c, col, t, needle_before)
        total += n
        print("%-42s %5d rows" % ("%s.%s" % (t, col), n))
print("\nrows matching:", total)

if MODE == "--dry-run":
    print("\nNothing written. Re-run with --apply once BASE_URL points at the new host.")
    raise SystemExit(0)

pairs = [(NEW, OLD[0])] if MODE == "--revert" else [(o, NEW) for o in OLD]
with eng.begin() as c:
    for t, col in TARGETS:
        for frm, to in pairs:
            c.execute(text('UPDATE "%s" SET "%s" = replace("%s", :frm, :to) WHERE "%s" LIKE :p'
                           % (t, col, col, col)),
                      {"frm": frm, "to": to, "p": "%" + frm + "%"})

needle_after = NEW if MODE == "--apply" else "run.app"
opposite = "run.app" if MODE == "--apply" else NEW
with eng.connect() as c:
    left = sum(count(c, col, t, opposite) for t, col in TARGETS)
    now = sum(count(c, col, t, needle_after) for t, col in TARGETS)
print("\nrows still holding the old host:", left, "(must be 0)")
print("rows now holding the new host  :", now)
print("\ndone.")
PY
