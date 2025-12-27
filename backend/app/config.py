import os

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
CHATKIT_WORKFLOW_ID = os.getenv("CHATKIT_WORKFLOW_ID", "")

SHOPIFY_SHOP_DOMAIN = os.getenv("SHOPIFY_SHOP_DOMAIN", "")
SHOPIFY_ACCESS_TOKEN = os.getenv("SHOPIFY_ACCESS_TOKEN", "")
SHOPIFY_API_VERSION = os.getenv("SHOPIFY_API_VERSION", "2025-07")

# Shopify OAuth (public apps / Dev Dashboard)
SHOPIFY_CLIENT_ID = os.getenv("SHOPIFY_CLIENT_ID", "")  # Dev Dashboard "Client ID"
SHOPIFY_CLIENT_SECRET = os.getenv("SHOPIFY_CLIENT_SECRET", "")  # Dev Dashboard "Secret" (shpss_...)
# Comma-separated scopes. Keep minimal but sufficient for current app features (orders + product/page creation).
SHOPIFY_OAUTH_SCOPES = os.getenv(
    "SHOPIFY_OAUTH_SCOPES",
    "read_orders,write_orders,read_products,write_products,read_content,write_content,read_inventory,write_inventory",
)

META_ACCESS_TOKEN = os.getenv("META_ACCESS_TOKEN", "")
META_AD_ACCOUNT_ID = os.getenv("META_AD_ACCOUNT_ID", "")  # numeric only
META_PAGE_ID = os.getenv("META_PAGE_ID", "")
META_API_VERSION = os.getenv("META_API_VERSION", "v23.0")

# Celery requires an explicit ssl_cert_reqs query param when using `rediss://`.
def _fix_rediss(url: str) -> str:
    if url.startswith("rediss://") and "ssl_cert_reqs=" not in url:
        sep = "&" if "?" in url else "?"
        return f"{url}{sep}ssl_cert_reqs=CERT_NONE"
    return url

CELERY_BROKER_URL = _fix_rediss(os.getenv("CELERY_BROKER_URL", "redis://redis:6379/0"))
CELERY_RESULT_BACKEND = _fix_rediss(os.getenv("CELERY_RESULT_BACKEND", "redis://redis:6379/0"))

BASE_URL = os.getenv("BASE_URL", "")

# Unified uploads directory used by both the static file mount and storage writes
# Default to "/app/uploads" inside the container; allow override via UPLOADS_DIR
UPLOADS_DIR = os.getenv("UPLOADS_DIR", "/app/uploads")