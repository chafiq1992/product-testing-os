# Product Testing OS (MVP)

FastAPI + Celery backend, Next.js frontend wizard, and Cloud Run deploy scripts.

## Local
1. `cp .env.example .env` and fill values
2. `docker compose up --build`
3. POST to `/api/tests` as shown in the canvas

## Cloud Run
See `cloudrun/README.md`.

## Organic social agent

The admin-only page at `/social-agent` runs an autonomous Shopify-to-Meta
workflow for organic Facebook and Instagram posts. It ranks active products by
inventory, Moroccan season fit, media quality, and recent rotation; creates two
OpenAI image candidates per post; requires an independent multimodal review;
publishes approved media from Shopify Files; and feeds Meta performance metrics
back into the next creative brief.

The default schedule is five posts starting at 14:00 and another five starting
at 18:00 in `Africa/Casablanca`. Preview mode is the safe default. Enable live
publishing per store from the page only after its Shopify and Meta connection
checks pass. Exact quantity-offer wording must be approved in page settings;
otherwise only real Shopify compare-at markdowns can be advertised.

Cloud Run scales to zero, so the durable scheduler is an authenticated Cloud
Scheduler call every five minutes. After deploying the app, run:

```bash
bash cloudrun/setup-social-agent-scheduler.sh
```

The script creates/uses `SOCIAL_AGENT_SCHEDULER_SECRET`, maps it into the Cloud
Run service, and creates the `product-testing-os-social-agent` Scheduler job.
All dashboard and manual action routes reuse the existing System Health admin
login (`SYSTEM_ADMIN_USERS`). The operating charter and reviewer rules live in
`backend/app/social_agent/AGENT.md`.

## AI Meta ad launcher

The administrator page at `"/ad-launcher"` creates governed paid creative tests
from an existing Shopify product ID and uploaded media. It uses the existing
System Health administrator login configured by `SYSTEM_ADMIN_USERS`:

- one image creates image ads, one video creates video ads, and 2-10 images
  create a carousel;
- a `gpt-5.6-sol` Agents SDK analyst reads the Shopify product, Arabic storefront
  page, and creative/video frames, then writes two distinct Arabic ad packages;
- an optional mode uses `gpt-image-2` to create two additional, product-faithful
  4:5 image ads, producing four ad sets total;
- a separate structured reviewer plus deterministic checks gates the launch;
- the Meta campaign uses `OUTCOME_SALES`, Purchase optimization, ABO, a shared
  broad manual audience, manual Facebook/Instagram feeds, and one ad per ad set;
- catalog ads, custom/saved/lookalike audiences, campaign-budget allocation,
  Advantage Audience, automatic placements, carousel reordering, and Meta
  creative enhancements are not used;
- the total default budget is USD 9/day, split evenly across the ad sets, and
  the scheduled start is 23:59 in `Africa/Casablanca`.

The launcher creates the campaign, ad sets, creatives, and ads paused. It only
activates them after every child object exists and the independent review passed;
therefore an incomplete Meta API run remains non-spending. Automatic activation
is optional and requires an explicit confirmation in the UI.

Required configuration is `OPENAI_API_KEY`, `META_ACCESS_TOKEN`,
`META_AD_ACCOUNT_ID`, `META_PAGE_ID`, and `META_PIXEL_ID`, plus the existing
Shopify connection and System Health administrator credentials. Set `BASE_URL`
to the public HTTPS backend URL so Meta can
fetch uploaded and generated media; localhost URLs are suitable for preview but
not live delivery. The launcher expects a USD Meta ad account and fails closed
on another account currency rather than silently misinterpreting the USD budget.
Per-store Meta variables use the existing uppercase suffix convention, for
example `META_PIXEL_ID_IRRAKIDS`.

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
- `OAUTH_STATE_SECRET`: stable random secret used to sign OAuth state. Store it in Secret Manager.
- `DATABASE_URL`: shared PostgreSQL database used to persist per-store OAuth tokens across Cloud Run instances and revisions.

`SHOPIFY_OAUTH_STORES` is also the runtime store registry used by the frontend. To add `beitii`, configure:

- `SHOPIFY_OAUTH_STORES=irrakids,irranova,mmd,beitii`
- `SHOPIFY_SHOP_DOMAIN_BEITII=beitii.myshopify.com`
- `SHOPIFY_CLIENT_ID_BEITII=...`
- `SHOPIFY_CLIENT_SECRET_BEITII=...`

Store suffixes are uppercase. The backend temporarily accepts lowercase suffixes for migration and reports a warning on `GET /api/shopify/stores`, but new configuration should always use uppercase names. After the Cloud Run revision is updated, every frontend store selector loads the new label at runtime; a frontend rebuild is not required.

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
