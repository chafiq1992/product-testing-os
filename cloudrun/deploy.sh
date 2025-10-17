#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="your-gcp-project"
REGION="europe-west1"
REPO="pto-repo"
# Optional: name of the GCS bucket to persist /app/uploads (set to empty to skip mounting)
# Example: UPLOADS_BUCKET="ptos-uploads-yourid"
UPLOADS_BUCKET=""

CELERY_BROKER_URL="rediss://:<password>@<host>:<port>"
CELERY_RESULT_BACKEND="$CELERY_BROKER_URL"

SHOPIFY_SHOP_DOMAIN="your-store.myshopify.com"
SHOPIFY_API_VERSION="2025-07"
META_AD_ACCOUNT_ID="1234567890"
META_PAGE_ID="1122334455667788"
META_API_VERSION="v23.0"

# OpenAI Agent Builder workflow id for ChatKit sessions
CHATKIT_WORKFLOW_ID=""

API_SVC="pto-api"
WORKER_SVC="pto-worker"
FRONTEND_SVC="pto-frontend"

API_IMG="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/${API_SVC}:$(date +%Y%m%d-%H%M)"
WORKER_IMG="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/${WORKER_SVC}:$(date +%Y%m%d-%H%M)"
FRONTEND_IMG="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/${FRONTEND_SVC}:$(date +%Y%m%d-%H%M)"

gcloud services enable run.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com cloudbuild.googleapis.com logging.googleapis.com monitoring.googleapis.com --project "$PROJECT_ID"

if ! gcloud artifacts repositories describe "$REPO" --location="$REGION" --project "$PROJECT_ID" >/dev/null 2>&1; then
  gcloud artifacts repositories create "$REPO" --repository-format=docker --location="$REGION" --project "$PROJECT_ID"
fi

gcloud builds submit --project "$PROJECT_ID" --region "$REGION" --tag "$API_IMG" backend
gcloud builds submit --project "$PROJECT_ID" --region "$REGION" --tag "$WORKER_IMG" --config=- <<'YAML'
steps:
- name: 'gcr.io/cloud-builders/docker'
  args: ['build','-t','$_IMG','-f','backend/Dockerfile.worker','.']
images: ['$_IMG']
substitutions:
  _IMG: REPLACE_ME
YAML
# Frontend image will be built after API is deployed so we can inject NEXT_PUBLIC_API_BASE_URL

# Secrets must exist with latest versions:
# OPENAI_API_KEY, SHOPIFY_ACCESS_TOKEN, META_ACCESS_TOKEN

API_FLAGS=(
  --project "$PROJECT_ID" --region "$REGION" --image "$API_IMG" --platform managed
  --allow-unauthenticated --port 8000
  --set-env-vars SHOPIFY_SHOP_DOMAIN="$SHOPIFY_SHOP_DOMAIN",SHOPIFY_API_VERSION="$SHOPIFY_API_VERSION",META_AD_ACCOUNT_ID="$META_AD_ACCOUNT_ID",META_PAGE_ID="$META_PAGE_ID",META_API_VERSION="$META_API_VERSION",CELERY_BROKER_URL="$CELERY_BROKER_URL",CELERY_RESULT_BACKEND="$CELERY_RESULT_BACKEND",CHATKIT_WORKFLOW_ID="$CHATKIT_WORKFLOW_ID"
  --set-secrets OPENAI_API_KEY=OPENAI_API_KEY:latest,SHOPIFY_ACCESS_TOKEN=SHOPIFY_ACCESS_TOKEN:latest,META_ACCESS_TOKEN=META_ACCESS_TOKEN:latest
  --min-instances=0 --max-instances=5
)

# If a bucket is provided, mount it at /app/uploads via Cloud Storage FUSE
if [ -n "$UPLOADS_BUCKET" ]; then
  echo "[INFO] Mounting GCS bucket gs://$UPLOADS_BUCKET at /app/uploads"
  API_FLAGS+=(
    --add-volume name=uploads,type=cloud-storage,bucket=$UPLOADS_BUCKET
    --add-volume-mount volume=uploads,mount-path=/app/uploads
  )
fi

gcloud run deploy "$API_SVC" "${API_FLAGS[@]}"

API_URL=$(gcloud run services describe "$API_SVC" --region "$REGION" --project "$PROJECT_ID" --format='value(status.url)')
echo "API deployed at: $API_URL"

gcloud run deploy "$WORKER_SVC" --project "$PROJECT_ID" --region "$REGION" --image "$WORKER_IMG" --platform managed --no-allow-unauthenticated --port 8080  --cpu 1 --memory 1Gi --min-instances=1 --max-instances=1  --set-env-vars CELERY_BROKER_URL="$CELERY_BROKER_URL",CELERY_RESULT_BACKEND="$CELERY_RESULT_BACKEND",SHOPIFY_SHOP_DOMAIN="$SHOPIFY_SHOP_DOMAIN",SHOPIFY_API_VERSION="$SHOPIFY_API_VERSION",META_AD_ACCOUNT_ID="$META_AD_ACCOUNT_ID",META_PAGE_ID="$META_PAGE_ID",META_API_VERSION="$META_API_VERSION"  --set-secrets OPENAI_API_KEY=OPENAI_API_KEY:latest,SHOPIFY_ACCESS_TOKEN=SHOPIFY_ACCESS_TOKEN:latest,META_ACCESS_TOKEN=META_ACCESS_TOKEN:latest

WORKER_URL=$(gcloud run services describe "$WORKER_SVC" --region "$REGION" --project "$PROJECT_ID" --format='value(status.url)')
echo "Worker deployed at: $WORKER_URL (private)"

# Build frontend with API URL baked in
gcloud builds submit --project "$PROJECT_ID" --region "$REGION" --config=- <<YAML
steps:
- name: 'gcr.io/cloud-builders/docker'
  args: ['build','-t','${FRONTEND_IMG}','-f','frontend/Dockerfile','--build-arg','NEXT_PUBLIC_API_BASE_URL=${API_URL}','--build-arg','NEXT_PUBLIC_STUDIO_URL=/studio','.']
images: ['${FRONTEND_IMG}']
YAML

gcloud run deploy "$FRONTEND_SVC" --project "$PROJECT_ID" --region "$REGION" --image "$FRONTEND_IMG" --platform managed --allow-unauthenticated --port 8080 --min-instances=0 --max-instances=3
FRONTEND_URL=$(gcloud run services describe "$FRONTEND_SVC" --region "$REGION" --project "$PROJECT_ID" --format='value(status.url)')
echo "Frontend deployed at: $FRONTEND_URL"
echo "Next: set NEXT_PUBLIC_API_BASE_URL=$API_URL in frontend/.env.local and rebuild if needed."
