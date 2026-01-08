# Product Testing OS (MVP)

FastAPI  + Celery backend, Next.js frontend wizard, and Cloud Run deploy scripts.

## Local
1) `cp .env.example .env` and fill values
2) `docker compose up --build`
3) POST to `/api/tests` as shown in the canvas

## Cloud Run
See `cloudrun/README.md`.

## Confirmation page (order confirmation team)

The frontend route is `"/confirmation"` (link available on Home).

## Shopify (multi-store)

This app talks to the **Shopify Admin API** and expects an **Admin API access token** (sent as `X-Shopify-Access-Token`).

### Environment variables

For single-store you can set base vars:

- `SHOPIFY_SHOP_DOMAIN` (example: `your-store.myshopify.com`)
- `SHOPIFY_ACCESS_TOKEN` (example: `shpat_...`)
- `SHOPIFY_API_VERSION` (default: `2025-07`)

For multi-store (recommended here), the backend supports store-specific overrides using a suffix derived from the UI store value:

- Store `"irrakids"` → suffix `_IRRAKIDS`
- Store `"irranova"` → suffix `_IRRANOVA`

So you can configure:

- `SHOPIFY_SHOP_DOMAIN_IRRAKIDS`, `SHOPIFY_ACCESS_TOKEN_IRRAKIDS`
- `SHOPIFY_SHOP_DOMAIN_IRRANOVA`, `SHOPIFY_ACCESS_TOKEN_IRRANOVA`

### Where to get the access token

- **Custom app (single store, fastest for internal tools)**: create a custom app in the store Admin, set scopes (at least `read_orders` / `read_customers` as needed), install it, then copy the generated **Admin API access token** (`shpat_...`) into the env var above.
- **Public app (Dev Dashboard, client ID/secret)**: the Dev Dashboard shows `Client ID` + `Secret`, but **does not give you a store access token directly**. A store access token is minted only after you run the OAuth install flow for a specific shop (supported in this repo; see below).

### Public app OAuth (Option B) — now supported in this repo

Set these env vars for the backend:

- `SHOPIFY_CLIENT_ID`: from Dev Dashboard app credentials
- `SHOPIFY_CLIENT_SECRET`: from Dev Dashboard app credentials (starts with `shpss_...`)
- `SHOPIFY_OAUTH_STORES`: comma-separated store labels that should use OAuth tokens (default behavior: only `irranova`)
- `SHOPIFY_OAUTH_SCOPES`: comma-separated scopes (defaults are already set in code)
- `BASE_URL`: your public backend base URL (recommended in Cloud Run) so redirect URIs are correct

In the Dev Dashboard app settings, set the **redirect URI** to:

- `{BASE_URL}/api/shopify/oauth/callback`

Then install/connect per store:

- Open `"/shopify-connect"` in the UI, choose your store label (e.g. `irranova`), enter `irranova.myshopify.com`, click **Connect (OAuth install)**.

The minted token is stored in the DB under `AppSetting(store, "shopify_oauth")`.

Mixed-mode setups (your case):

- **`irrakids`**: keep the old method → set `SHOPIFY_ACCESS_TOKEN_IRRAKIDS` / `SHOPIFY_SHOP_DOMAIN_IRRAKIDS` and do *not* include `irrakids` in `SHOPIFY_OAUTH_STORES`
- **`irranova`**: use OAuth → include `irranova` in `SHOPIFY_OAUTH_STORES` (or omit `SHOPIFY_OAUTH_STORES` because default is only `irranova`)

### Configure login users

Set `CONFIRMATION_USERS` as JSON (either a map or an array):

- Map form:
  - `{"agent1@example.com":"password1","agent2@example.com":"password2"}`
- Array form:
  - `[{"email":"agent1@example.com","password":"password1","name":"Agent 1"}]`

Optionally, set a signing secret for login tokens:

- `CONFIRMATION_AUTH_SECRET`: random string used to sign session tokens

### Admin dashboard (manage agents + analytics)

Frontend route: `"/confirmation-admin"`

Set admin users in env (JSON map or array):

- `CONFIRMATION_ADMIN_USERS='{"admin@example.com":"adminpass"}'`
- or `CONFIRMATION_ADMIN_USERS='[{"email":"admin@example.com","password":"adminpass","name":"Admin"}]'`

Set a signing secret (recommended):

- `CONFIRMATION_ADMIN_SECRET`: secret used to sign admin session tokens