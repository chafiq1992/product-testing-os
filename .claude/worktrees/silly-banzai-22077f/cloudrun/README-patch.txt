Replace the WORKER build section in cloudrun/deploy.sh with:

gcloud builds submit --project "$PROJECT_ID" --region "$REGION"   --tag "$WORKER_IMG" --file backend/Dockerfile.worker .
