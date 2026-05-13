# Product Testing OS (MVP)

FastAPI + Celery backend, Next.js frontend wizard, and Cloud Run deploy scripts.

## Local
1. `cp .env.example .env` and fill values
2. `docker compose up --build`
3. POST to `/api/tests` as shown in the canvas

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

- Store `"irrakids"` -> suffix `_IRRAKIDS`
- Store `"irranova"` -> suffix `_IRRANOVA`

So you can configure:

- `SHOPIFY_SHOP_DOMAIN_IRRAKIDS`, `SHOPIFY_ACCESS_TOKEN_IRRAKIDS`
- `SHOPIFY_SHOP_DOMAIN_IRRANOVA`, `SHOPIFY_ACCESS_TOKEN_IRRANOVA`

### Where to get the access token

- **Custom app (single store, fastest for internal tools)**: create a custom app in the store Admin, set scopes as needed, install it, then copy the generated **Admin API access token** (`shpat_...`) into the env var above.
- **Public app (Dev Dashboard, client ID/secret)**: the Dev Dashboard shows `Client ID` + `Secret`, but does not give you a store access token directly. A store access token is minted only after you run the OAuth install flow for a specific shop.

### Public app OAuth (Option B) - now supported in this repo

Set these env vars for the backend:

- `SHOPIFY_CLIENT_ID`: fallback Shopify app client ID
- `SHOPIFY_CLIENT_SECRET`: fallback Shopify app client secret (starts with `shpss_...`)
- `SHOPIFY_CLIENT_ID_IRRAKIDS`: Irrakids-specific Shopify app client ID
- `SHOPIFY_CLIENT_SECRET_IRRAKIDS`: Irrakids-specific Shopify app client secret
- `SHOPIFY_CLIENT_ID_IRRANOVA`: Irranova-specific Shopify app client ID
- `SHOPIFY_CLIENT_SECRET_IRRANOVA`: Irranova-specific Shopify app client secret
- `SHOPIFY_OAUTH_STORES`: comma-separated store labels that should use OAuth tokens (default behavior in code: `irrakids,irranova,mmd`)
- `SHOPIFY_OAUTH_SCOPES`: comma-separated scopes. Defaults now include orders, order edits, products, content/pages, inventory, locations, customers, files, publications, and themes.
- `BASE_URL`: your public backend base URL so redirect URIs are correct

In the Dev Dashboard app settings, set the **redirect URI** to:

- `{BASE_URL}/api/shopify/oauth/callback`

Then install/connect per store:

- Open `"/shopify-connect"` in the UI, choose your store label (for example `irrakids`), enter `irrakids.myshopify.com`, and click **Connect (OAuth install)**.

The minted token is stored in the DB under `AppSetting(store, "shopify_oauth")`.

Mixed-mode setups:

- **`irrakids`**: OAuth is now supported by default. Set `SHOPIFY_CLIENT_ID_IRRAKIDS` / `SHOPIFY_CLIENT_SECRET_IRRAKIDS` and connect through `"/shopify-connect"`. If you prefer the old fixed-token method, you can still use `SHOPIFY_ACCESS_TOKEN_IRRAKIDS` / `SHOPIFY_SHOP_DOMAIN_IRRAKIDS`.
- **`irranova`**: OAuth is also supported by default through `SHOPIFY_CLIENT_ID_IRRANOVA` / `SHOPIFY_CLIENT_SECRET_IRRANOVA`.

Recommended Shopify admin scopes for this app:

- `read_orders`
- `write_orders`
- `read_all_orders`
- `read_order_edits`
- `write_order_edits`
- `read_products`
- `write_products`
- `read_content`
- `write_content`
- `read_inventory`
- `write_inventory`
- `read_locations`
- `read_customers`
- `write_customers`
- `read_files`
- `write_files`
- `read_publications`
- `write_publications`
- `read_themes`
- `write_themes`

Notes:

- For OAuth-enabled stores such as `irrakids`, the backend now requires the matching store-specific client ID and secret. It will not fall back to the default app credentials, which avoids redirecting the store into the wrong Shopify app.
- Order and customer tag updates are covered by `write_orders` and `write_customers`.
- Theme code changes in the app use Shopify theme APIs, so the OAuth scope string should include `read_themes,write_themes`. In some Shopify setups, theme code access can also require Shopify approval or merchant permissions in addition to those scopes.
- The current backend product-media upload flow uploads images onto products; it does not require Shopify Files access unless you want to manage the separate Shopify Files library too.

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
