"""Validate the current Google secret and update only Netcup's OpenAI key.

Run from an authenticated gcloud workstation. Secret values stay in subprocess
pipes and the server's mode-0600 runtime env file; they are never logged.
Recreate the app containers (or run the usual release) to load the new key.
"""
import argparse
import json
import shlex
import shutil
import subprocess
import sys


VALIDATE = '''import sys,json
from openai import OpenAI
try:
    models = list(OpenAI(api_key=sys.stdin.read().strip(), timeout=25, max_retries=0).models.list())
    print(json.dumps({"validated": True, "models": len(models)}))
except Exception as exc:
    print(json.dumps({"validated": False, "error": type(exc).__name__, "status": getattr(exc, "status_code", None)}))
    sys.exit(1)
'''

UPDATE = '''import sys,os,tempfile
from pathlib import Path
key = sys.stdin.read().strip()
if not key or "\\n" in key or "\\r" in key:
    sys.exit("Invalid secret payload")
path = Path("/opt/pto/app.env")
lines = [line for line in path.read_text().splitlines() if not line.startswith("OPENAI_API_KEY=")]
lines.append("OPENAI_API_KEY=" + key)
fd, temporary = tempfile.mkstemp(prefix=".openai-env-", dir=path.parent)
try:
    os.fchmod(fd, 0o600)
    with os.fdopen(fd, "w") as stream:
        stream.write("\\n".join(lines) + "\\n")
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)
finally:
    if os.path.exists(temporary):
        os.unlink(temporary)
print("Updated OPENAI_API_KEY from Google Secret Manager; other runtime settings preserved.")
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", default="deploy@159.195.204.91")
    parser.add_argument("--project", default="sinuous-bedrock-347205")
    args = parser.parse_args()
    gcloud = shutil.which("gcloud") or shutil.which("gcloud.cmd")
    if not gcloud:
        sys.exit("gcloud is required")
    secret = subprocess.run([gcloud, "secrets", "versions", "access", "latest", "--secret", "OPENAI_API_KEY", "--project", args.project], capture_output=True, text=True)
    if secret.returncode:
        sys.exit("Could not access OPENAI_API_KEY in Google Secret Manager; check gcloud login and permissions.")
    key = secret.stdout.strip()
    ssh = ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", args.target]
    validation = subprocess.run([*ssh, "docker exec -i pto-web-1 python -c " + shlex.quote(VALIDATE)], input=key, capture_output=True, text=True)
    try:
        result = json.loads(validation.stdout)
    except ValueError:
        sys.exit("Server credential validation could not complete; runtime configuration was not changed.")
    print(json.dumps(result))
    if validation.returncode or not result.get("validated"):
        sys.exit("OpenAI rejected the current secret; runtime configuration was not changed.")
    update = subprocess.run([*ssh, "python3 -c " + shlex.quote(UPDATE)], input=key, capture_output=True, text=True)
    if update.returncode:
        sys.exit("Runtime credential update failed.")
    print(update.stdout.strip())


if __name__ == "__main__":
    main()
