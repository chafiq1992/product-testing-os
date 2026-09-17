#!/usr/bin/env bash
# Ship this checkout to /opt/pto/src on the box, where deploy.sh builds it.
#
#   ./deploy/push-source.sh deploy@159.195.204.91
#
# Uses tar over SSH rather than rsync: the machine this is normally run from is
# Windows/Git-Bash, which has tar but no rsync.
#
# The excludes below mirror .dockerignore, plus two that matter more here than
# in a build context:
#   mobile-app/ — a separate Expo app whose android/keystore.properties and
#                 keystore/ must never leave the developer machine.
#   .claude/    — local agent worktrees; they contain full copies of the repo
#                 and would otherwise triple the transfer.
#
# This ships the WORKING TREE, including uncommitted changes, because that is
# what "deploy what I am looking at" means during a migration. deploy.sh records
# the commit it built from in the deploy ledger, so an uncommitted release is
# visible after the fact — it shows the parent commit with a dirty tree.
set -euo pipefail

TARGET="${1:?usage: push-source.sh user@host}"
REMOTE_DIR=/opt/pto/src
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "${HERE}"

echo "→ shipping $(pwd) to ${TARGET}:${REMOTE_DIR}"

ssh "${TARGET}" "mkdir -p ${REMOTE_DIR}"

tar -czf - \
  --exclude='.git' \
  --exclude='.claude' \
  --exclude='.pytest_cache' \
  --exclude='mobile-app' \
  --exclude='node_modules' \
  --exclude='frontend/.next' \
  --exclude='frontend/out' \
  --exclude='__pycache__' \
  --exclude='*.pyc' \
  --exclude='.env' \
  --exclude='venv' \
  --exclude='backend/.venv' \
  --exclude='artifacts' \
  . | ssh "${TARGET}" "tar -xzf - -C ${REMOTE_DIR}"

# .sh files must land with LF endings. Git on Windows can check them out as
# CRLF, and a CR on a shebang line produces "set: pipefail: invalid option
# name" on the server — a failure that reads like a bash version problem and is
# not. .gitattributes pins this repo to LF, but a tree checked out before that
# existed can still carry CRs, so verify rather than trust.
echo "→ checking line endings on the server"
ssh "${TARGET}" "find ${REMOTE_DIR} -name '*.sh' -exec file {} \; | grep -i CRLF" \
  && { echo "✗ CRLF found above — fix with: sed -i 's/\r\$//' <file>" >&2; exit 1; } \
  || echo "  ok: no CRLF"

echo "✓ source is on the box. Next: ssh ${TARGET} /opt/pto/deploy.sh <tag>"
