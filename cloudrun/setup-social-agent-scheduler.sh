#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-sinuous-bedrock-347205}"
REGION="${REGION:-europe-west1}"
SERVICE="${SERVICE:-product-testing-os-4}"
JOB="${JOB:-product-testing-os-social-agent}"
SECRET_NAME="${SECRET_NAME:-SOCIAL_AGENT_SCHEDULER_SECRET}"

gcloud services enable cloudscheduler.googleapis.com secretmanager.googleapis.com \
  --project "${PROJECT_ID}"

if ! gcloud secrets describe "${SECRET_NAME}" --project "${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud secrets create "${SECRET_NAME}" --replication-policy=automatic --project "${PROJECT_ID}"
fi

if ! gcloud secrets versions access latest --secret "${SECRET_NAME}" --project "${PROJECT_ID}" >/dev/null 2>&1; then
  python -c 'import secrets; print(secrets.token_urlsafe(48))' | \
    gcloud secrets versions add "${SECRET_NAME}" --data-file=- --project "${PROJECT_ID}"
fi

gcloud run services update "${SERVICE}" \
  --project "${PROJECT_ID}" \
  --region "${REGION}" \
  --update-secrets "SOCIAL_AGENT_SCHEDULER_SECRET=${SECRET_NAME}:latest" \
  --timeout 900

SERVICE_URL="$(gcloud run services describe "${SERVICE}" --project "${PROJECT_ID}" --region "${REGION}" --format='value(status.url)')"
SCHEDULER_KEY="$(gcloud secrets versions access latest --secret "${SECRET_NAME}" --project "${PROJECT_ID}")"

COMMON_ARGS=(
  --project "${PROJECT_ID}"
  --location "${REGION}"
  --schedule "*/5 * * * *"
  --time-zone "Africa/Casablanca"
  --uri "${SERVICE_URL}/api/social-agent/scheduler/tick"
  --http-method POST
  --headers "Content-Type=application/json,X-Social-Agent-Key=${SCHEDULER_KEY}"
  --message-body '{}'
  --attempt-deadline 900s
)

if gcloud scheduler jobs describe "${JOB}" --project "${PROJECT_ID}" --location "${REGION}" >/dev/null 2>&1; then
  gcloud scheduler jobs update http "${JOB}" "${COMMON_ARGS[@]}"
else
  gcloud scheduler jobs create http "${JOB}" "${COMMON_ARGS[@]}"
fi

echo "Social-agent scheduler is active: ${JOB} -> ${SERVICE_URL}"
