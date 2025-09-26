# Cloud Run Deploy

1. Create secrets: `OPENAI_API_KEY`, `SHOPIFY_ACCESS_TOKEN`, `META_ACCESS_TOKEN`.
2. Edit variables in `deploy.sh` (project/region/redis URL + Shopify/Meta IDs).
3. Run `bash cloudrun/deploy.sh`.
4. Put the printed API URL into `frontend/.env.local` as `NEXT_PUBLIC_API_BASE_URL` and redeploy frontend if needed.

## Persistent uploads (/uploads) via Cloud Storage

Cloud Run instances have an ephemeral filesystem. To keep pre‑Shopify images and other flow assets reliable between restarts, mount a GCS bucket at `/app/uploads` so existing endpoints continue to work.

Steps:

- Create a bucket (once):
  ```bash
  gsutil mb -l europe-west1 gs://ptos-uploads-yourid
  ```
- Grant your service account object admin on the bucket (after first deploy or if you know the SA):
  ```bash
  SA_EMAIL=$(gcloud run services describe pto-api \
    --region europe-west1 --project YOUR_PROJECT \
    --format='value(spec.template.spec.serviceAccountName)')
  gcloud storage buckets add-iam-policy-binding gs://ptos-uploads-yourid \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="roles/storage.objectAdmin"
  ```
- In `deploy.sh`, set:
  ```bash
  UPLOADS_BUCKET="ptos-uploads-yourid"
  ```
  Then redeploy: `bash cloudrun/deploy.sh`.

All files written to `/app/uploads` will now persist in that bucket and be served by the same `/uploads/...` URLs.

## Optional: auto‑cleanup lifecycle for temporary uploads

To avoid unbounded growth from abandoned temp files, set a lifecycle rule (example: delete objects older than 14 days):

```bash
cat > lifecycle.json <<'JSON'
{
  "rule": [
    {
      "action": { "type": "Delete" },
      "condition": { "age": 14 }
    }
  ]
}
JSON
gsutil lifecycle set lifecycle.json gs://ptos-uploads-yourid
rm lifecycle.json
```

You can tune `age` or add prefix conditions to restrict cleanup to a subfolder.