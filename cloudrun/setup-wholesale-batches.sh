#!/usr/bin/env bash
set -euo pipefail

# Run after deploying the wholesale batch feature. Always-allocated CPU and a
# warm instance let the persisted queue drain after the browser/request closes.
# This changes the service's baseline Cloud Run billing.
PROJECT_ID="${PROJECT_ID:-sinuous-bedrock-347205}"
REGION="${REGION:-europe-west1}"
SERVICE="${SERVICE:-product-testing-os-4}"

gcloud run services update "${SERVICE}" \
  --project "${PROJECT_ID}" \
  --region "${REGION}" \
  --no-cpu-throttling \
  --min-instances 1
