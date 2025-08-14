#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="sinuous-bedrock-347205"
REGION="europe-west1"
REPO="pto-repo"

SERVICE="product-testing-os"
IMAGE_NAME="pto-full"
IMG_TAG="$(date +%Y%m%d-%H%M)"
IMG="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/${IMAGE_NAME}:${IMG_TAG}"

CELERY_BROKER_URL="rediss://default:ASe8AAIjcDEzMDFmODQ4ODI3OGY0MWQxODU0NmYwODIzNDhiMmFkM3AxMA@secure-owl-10172.upstash.io:6379"
CELERY_RESULT_BACKEND="$CELERY_BROKER_URL"

SHOPIFY_SHOP_DOMAIN="nouralibas.myshopify.com"
SHOPIFY_API_VERSION="2025-07"
META_AD_ACCOUNT_ID="4098994280206482"
META_PAGE_ID="100070754486984"
META_API_VERSION="v23.0"

gcloud services enable run.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com cloudbuild.googleapis.com logging.googleapis.com monitoring.googleapis.com --project "$PROJECT_ID"

if ! gcloud artifacts repositories describe "$REPO" --location="$REGION" --project "$PROJECT_ID" >/dev/null 2>&1; then
  gcloud artifacts repositories create "$REPO" --repository-format=docker --location="$REGION" --project "$PROJECT_ID"
fi

# Build combined image from backend/Dockerfile (single container runs frontend+backend via supervisord+nginx)
gcloud builds submit --project "$PROJECT_ID" --region "$REGION" \
  --tag "$IMG" \
  --file backend/Dockerfile \
  .

# Deploy single Cloud Run service
gcloud run deploy "$SERVICE" \
  --project "$PROJECT_ID" --region "$REGION" \
  --image "$IMG" --platform managed --allow-unauthenticated --port 8080 \
  --set-env-vars SHOPIFY_SHOP_DOMAIN="$SHOPIFY_SHOP_DOMAIN",STORE_URL="$SHOPIFY_SHOP_DOMAIN",API_KEY=unused,PASSWORD=unused,SHOPIFY_API_VERSION="$SHOPIFY_API_VERSION",META_AD_ACCOUNT_ID="$META_AD_ACCOUNT_ID",META_PAGE_ID="$META_PAGE_ID",META_API_VERSION="$META_API_VERSION" \
  --set-secrets OPENAI_API_KEY=OPENAI_API_KEY:latest,SHOPIFY_ACCESS_TOKEN=SHOPIFY_ACCESS_TOKEN:latest,ACCESS_TOKEN=SHOPIFY_ACCESS_TOKEN:latest,META_ACCESS_TOKEN=META_ACCESS_TOKEN:latest,CELERY_BROKER_URL=CELERY_BROKER_URL:latest,CELERY_RESULT_BACKEND=CELERY_RESULT_BACKEND:latest

URL=$(gcloud run services describe "$SERVICE" --region "$REGION" --project "$PROJECT_ID" --format='value(status.url)')
echo "Deployed $SERVICE at: $URL"
