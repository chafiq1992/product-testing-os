# Cloud Run Deploy

1. Create secrets: `OPENAI_API_KEY`, `SHOPIFY_ACCESS_TOKEN`, `META_ACCESS_TOKEN`.
2. Edit variables in `deploy.sh` (project/region/redis URL + Shopify/Meta IDs).
3. Run `bash cloudrun/deploy.sh`.
4. Put the printed API URL into `frontend/.env.local` as `NEXT_PUBLIC_API_BASE_URL` and redeploy frontend if needed.
