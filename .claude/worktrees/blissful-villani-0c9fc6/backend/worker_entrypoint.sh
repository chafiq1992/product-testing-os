#!/usr/bin/env bash
set -euo pipefail

celery -A app.tasks worker --loglevel=info --concurrency=2 &
exec uvicorn app.worker_health:app --host 0.0.0.0 --port ${PORT:-8080}
