import os, requests, base64, re
from datetime import datetime, timedelta
try:
    from zoneinfo import ZoneInfo  # Python 3.9+
except Exception:  # pragma: no cover
    ZoneInfo = None  # type: ignore
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type
from dotenv import load_dotenv
load_dotenv()

def _normalize_shop_domain(val: str) -> str:
    v = (val or "").strip()
    # remove protocol if provided and any stray whitespace or slashes
    if v.lower().startswith("https://"):
        v = v[8:]
    elif v.lower().startswith("http://"):
        v = v[7:]
    v = v.strip().strip("/\t\n\r ")
    return v

SHOP = _normalize_shop_domain(os.getenv("SHOPIFY_SHOP_DOMAIN", ""))  # your-store.myshopify.com
TOKEN = os.getenv("SHOPIFY_ACCESS_TOKEN", "")
API_KEY = os.getenv("SHOPIFY_API_KEY", "")
PASSWORD = os.getenv("SHOPIFY_PASSWORD", "")
API_VERSION = os.getenv("SHOPIFY_API_VERSION", "2025-07")
GQL = f"https://{SHOP}/admin/api/{API_VERSION}/graphql.json"

headers = {
    "Content-Type": "application/json"
}
if TOKEN:
    headers["X-Shopify-Access-Token"] = TOKEN

# -------- Multi-store helpers --------
def _env_with_suffix(base: str, suffix: str) -> str:
    return os.getenv(f"{base}{suffix}", "")

def _store_suffix(store: str | None) -> str:
    if not store:
        return ""
    s = (store or "").strip()
    if not s:
        return ""
    s = re.sub(r"[^A-Za-z0-9]", "_", s.upper())
    return f"_{s}"

def _get_store_config(store: str | None) -> dict:
    """Resolve credentials and endpoints for the given store (env-suffixed values).

    Precedence:
      - If store provided, read SHOPIFY_*_{STORE} vars; fallback to base SHOPIFY_* when missing
      - If no store provided, use base SHOPIFY_* values
    """
    if store:
        suf = _store_suffix(store)
        shop_raw = _env_with_suffix("SHOPIFY_SHOP_DOMAIN", suf) or os.getenv("SHOPIFY_SHOP_DOMAIN", "")
        token = _env_with_suffix("SHOPIFY_ACCESS_TOKEN", suf) or os.getenv("SHOPIFY_ACCESS_TOKEN", "")
        api_key = _env_with_suffix("SHOPIFY_API_KEY", suf) or os.getenv("SHOPIFY_API_KEY", "")
        password = _env_with_suffix("SHOPIFY_PASSWORD", suf) or os.getenv("SHOPIFY_PASSWORD", "")
        version = _env_with_suffix("SHOPIFY_API_VERSION", suf) or os.getenv("SHOPIFY_API_VERSION", "2025-07")
    else:
        shop_raw = os.getenv("SHOPIFY_SHOP_DOMAIN", "")
        token = os.getenv("SHOPIFY_ACCESS_TOKEN", "")
        api_key = os.getenv("SHOPIFY_API_KEY", "")
        password = os.getenv("SHOPIFY_PASSWORD", "")
        version = os.getenv("SHOPIFY_API_VERSION", "2025-07")
    shop = _normalize_shop_domain(shop_raw)
    if not shop:
        raise RuntimeError("SHOPIFY_SHOP_DOMAIN is not set. Please configure SHOPIFY_SHOP_DOMAIN env var.")
    gql = f"https://{shop}/admin/api/{version}/graphql.json"
    base = f"https://{shop}/admin/api/{version}"
    hdrs = {"Content-Type": "application/json"}
    if token:
        hdrs["X-Shopify-Access-Token"] = token
    return {
        "SHOP": shop,
        "TOKEN": token,
        "API_KEY": api_key,
        "PASSWORD": password,
        "API_VERSION": version,
        "GQL": gql,
        "BASE": base,
        "HEADERS": hdrs,
    }

PRODUCT_CREATE = """
mutation CreateProduct($input: ProductInput!) {
  productCreate(input: $input) {
    product {
      id
      handle
      onlineStoreUrl
      title
      status
      options { name values }
      variants(first: 100) {
        nodes { id inventoryItem { id } }
      }
    }
    userErrors { field message }
  }
}
"""

PAGE_CREATE = """
mutation CreatePage($page: PageCreateInput!) {
  pageCreate(page: $page) {
    page { id handle title }
    userErrors { field message }
  }
}
"""

PRODUCT_UPDATE = """
mutation UpdateProduct($input: ProductInput!) {
  productUpdate(input: $input) {
    product { id handle onlineStoreUrl title status }
    userErrors { field message }
  }
}
"""

PUBLICATIONS_QUERY = """
query ListPublications {
  publications(first: 20) { nodes { id name } }
}
"""

PUBLISH_PRODUCT = """
mutation PublishProduct($id: ID!, $publicationIds: [ID!]!) {
  publishablePublish(id: $id, input: { publicationIds: $publicationIds }) {
    publishable { id }
    userErrors { field message }
  }
}
"""

# Set metafields on owners (e.g., product)
METAFIELDS_SET = """
mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    metafields { id key namespace owner { id } }
    userErrors { field message }
  }
}
"""

# Create a metafield definition so it appears in Admin UI
METAFIELD_DEFINITION_CREATE = """
mutation MetafieldDefinitionCreate($definition: MetafieldDefinitionInput!) {
  metafieldDefinitionCreate(definition: $definition) {
    createdDefinition { id name namespace key type ownerType }
    userErrors { field message }
  }
}
"""

@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, max=8), retry=retry_if_exception_type(requests.exceptions.RequestException))
def _gql(query: str, variables: dict):
    if not SHOP:
        raise RuntimeError("SHOPIFY_SHOP_DOMAIN is not set. Please configure SHOPIFY_SHOP_DOMAIN env var.")
    # Choose auth: prefer Bearer token; else fallback to Basic auth with API key/password
    auth = None
    if not TOKEN:
        if API_KEY and PASSWORD:
            auth = (API_KEY, PASSWORD)
        else:
            raise RuntimeError("Provide either SHOPIFY_ACCESS_TOKEN or both SHOPIFY_API_KEY and SHOPIFY_PASSWORD.")
    r = requests.post(GQL, headers=headers, json={"query": query, "variables": variables}, timeout=60, auth=auth)
    r.raise_for_status()
    j = r.json()
    if "errors" in j:
        raise RuntimeError(f"GraphQL errors: {j['errors']}")
    data = j.get("data")
    ue = (
        (data or {}).get("productCreate", {}).get("userErrors")
        or (data or {}).get("pageCreate", {}).get("userErrors")
        or (data or {}).get("productUpdate", {}).get("userErrors")
        or (data or {}).get("publishablePublish", {}).get("userErrors")
    )
    if ue:
        raise RuntimeError(f"GraphQL userErrors: {ue}")
    return data


def _rest_post(path: str, payload: dict):
    """Minimal REST helper for endpoints not covered by GraphQL (e.g., product images)."""
    if not SHOP:
        raise RuntimeError("SHOPIFY_SHOP_DOMAIN is not set. Please configure SHOPIFY_SHOP_DOMAIN env var.")
    base = f"https://{SHOP}/admin/api/{API_VERSION}"
    url = f"{base}{path}"
    auth = None
    if not TOKEN:
        if API_KEY and PASSWORD:
            auth = (API_KEY, PASSWORD)
        else:
            raise RuntimeError("Provide either SHOPIFY_ACCESS_TOKEN or both SHOPIFY_API_KEY and SHOPIFY_PASSWORD.")
    r = requests.post(url, headers=headers, json=payload, timeout=60, auth=auth)
    r.raise_for_status()
    return r.json() if r.content else {}


@retry(stop=stop_after_attempt(5), wait=wait_exponential(multiplier=0.5, max=8), retry=retry_if_exception_type(requests.exceptions.RequestException))
def _rest_get(path: str):
    if not SHOP:
        raise RuntimeError("SHOPIFY_SHOP_DOMAIN is not set. Please configure SHOPIFY_SHOP_DOMAIN env var.")
    base = f"https://{SHOP}/admin/api/{API_VERSION}"
    url = f"{base}{path}"
    auth = None
    if not TOKEN:
        if API_KEY and PASSWORD:
            auth = (API_KEY, PASSWORD)
        else:
            raise RuntimeError("Provide either SHOPIFY_ACCESS_TOKEN or both SHOPIFY_API_KEY and SHOPIFY_PASSWORD.")
    r = requests.get(url, headers=headers, timeout=60, auth=auth)
    r.raise_for_status()
    return r.json() if r.content else {}


def _rest_put(path: str, payload: dict):
    if not SHOP:
        raise RuntimeError("SHOPIFY_SHOP_DOMAIN is not set. Please configure SHOPIFY_SHOP_DOMAIN env var.")
    base = f"https://{SHOP}/admin/api/{API_VERSION}"
    url = f"{base}{path}"
    auth = None
    if not TOKEN:
        if API_KEY and PASSWORD:
            auth = (API_KEY, PASSWORD)
        else:
            raise RuntimeError("Provide either SHOPIFY_ACCESS_TOKEN or both SHOPIFY_API_KEY and SHOPIFY_PASSWORD.")
    r = requests.put(url, headers=headers, json=payload, timeout=60, auth=auth)
    r.raise_for_status()
    return r.json() if r.content else {}


def _rest_delete(path: str):
    if not SHOP:
        raise RuntimeError("SHOPIFY_SHOP_DOMAIN is not set. Please configure SHOPIFY_SHOP_DOMAIN env var.")
    base = f"https://{SHOP}/admin/api/{API_VERSION}"
    url = f"{base}{path}"
    auth = None
    if not TOKEN:
        if API_KEY and PASSWORD:
            auth = (API_KEY, PASSWORD)
        else:
            raise RuntimeError("Provide either SHOPIFY_ACCESS_TOKEN or both SHOPIFY_API_KEY and SHOPIFY_PASSWORD.")
    r = requests.delete(url, headers=headers, timeout=60, auth=auth)
    r.raise_for_status()
    return r.json() if r.content else {}

# Store-scoped request helpers
@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, max=8), retry=retry_if_exception_type(requests.exceptions.RequestException))
def _gql_store(store: str | None, query: str, variables: dict):
    cfg = _get_store_config(store)
    auth = None
    if not cfg["TOKEN"]:
        if cfg["API_KEY"] and cfg["PASSWORD"]:
            auth = (cfg["API_KEY"], cfg["PASSWORD"])
        else:
            raise RuntimeError("Provide either SHOPIFY_ACCESS_TOKEN or both SHOPIFY_API_KEY and SHOPIFY_PASSWORD for the selected store.")
    r = requests.post(cfg["GQL"], headers=cfg["HEADERS"], json={"query": query, "variables": variables}, timeout=60, auth=auth)
    r.raise_for_status()
    j = r.json()
    if "errors" in j:
        raise RuntimeError(f"GraphQL errors: {j['errors']}")
    data = j.get("data")
    ue = (
        (data or {}).get("productCreate", {}).get("userErrors")
        or (data or {}).get("pageCreate", {}).get("userErrors")
        or (data or {}).get("productUpdate", {}).get("userErrors")
        or (data or {}).get("publishablePublish", {}).get("userErrors")
        or (data or {}).get("metafieldsSet", {}).get("userErrors")
        or (data or {}).get("metafieldDefinitionCreate", {}).get("userErrors")
    )
    if ue:
        raise RuntimeError(f"GraphQL userErrors: {ue}")
    return data

def _rest_post_store(store: str | None, path: str, payload: dict):
    cfg = _get_store_config(store)
    url = f"{cfg['BASE']}{path}"
    auth = None
    if not cfg["TOKEN"]:
        if cfg["API_KEY"] and cfg["PASSWORD"]:
            auth = (cfg["API_KEY"], cfg["PASSWORD"])
        else:
            raise RuntimeError("Provide either SHOPIFY_ACCESS_TOKEN or both SHOPIFY_API_KEY and SHOPIFY_PASSWORD for the selected store.")
    r = requests.post(url, headers=cfg["HEADERS"], json=payload, timeout=60, auth=auth)
    r.raise_for_status()
    return r.json() if r.content else {}

@retry(stop=stop_after_attempt(5), wait=wait_exponential(multiplier=0.5, max=8), retry=retry_if_exception_type(requests.exceptions.RequestException))
def _rest_get_store(store: str | None, path: str):
    cfg = _get_store_config(store)
    url = f"{cfg['BASE']}{path}"
    auth = None
    if not cfg["TOKEN"]:
        if cfg["API_KEY"] and cfg["PASSWORD"]:
            auth = (cfg["API_KEY"], cfg["PASSWORD"])
        else:
            raise RuntimeError("Provide either SHOPIFY_ACCESS_TOKEN or both SHOPIFY_API_KEY and SHOPIFY_PASSWORD for the selected store.")
    r = requests.get(url, headers=cfg["HEADERS"], timeout=60, auth=auth)
    r.raise_for_status()
    return r.json() if r.content else {}


@retry(stop=stop_after_attempt(5), wait=wait_exponential(multiplier=0.5, max=8), retry=retry_if_exception_type(requests.exceptions.RequestException))
def _rest_get_store_raw(store: str | None, path: str):
    cfg = _get_store_config(store)
    url = f"{cfg['BASE']}{path}"
    auth = None
    if not cfg["TOKEN"]:
        if cfg["API_KEY"] and cfg["PASSWORD"]:
            auth = (cfg["API_KEY"], cfg["PASSWORD"])
        else:
            raise RuntimeError("Provide either SHOPIFY_ACCESS_TOKEN or both SHOPIFY_API_KEY and SHOPIFY_PASSWORD for the selected store.")
    r = requests.get(url, headers=cfg["HEADERS"], timeout=60, auth=auth, allow_redirects=False)
    r.raise_for_status()
    return r


def get_shop_timezone(store: str | None = None) -> str:
    try:
        data = _rest_get_store(store, "/shop.json")
        tz = ((data or {}).get("shop") or {}).get("iana_timezone") or ((data or {}).get("shop") or {}).get("timezone")
        if isinstance(tz, str) and tz.strip():
            return tz.strip()
    except Exception:
        pass
    return "UTC"

def _rest_put_store(store: str | None, path: str, payload: dict):
    cfg = _get_store_config(store)
    url = f"{cfg['BASE']}{path}"
    auth = None
    if not cfg["TOKEN"]:
        if cfg["API_KEY"] and cfg["PASSWORD"]:
            auth = (cfg["API_KEY"], cfg["PASSWORD"])
        else:
            raise RuntimeError("Provide either SHOPIFY_ACCESS_TOKEN or both SHOPIFY_API_KEY and SHOPIFY_PASSWORD for the selected store.")
    r = requests.put(url, headers=cfg["HEADERS"], json=payload, timeout=60, auth=auth)
    r.raise_for_status()
    return r.json() if r.content else {}

def _rest_delete_store(store: str | None, path: str):
    cfg = _get_store_config(store)
    url = f"{cfg['BASE']}{path}"
    auth = None
    if not cfg["TOKEN"]:
        if cfg["API_KEY"] and cfg["PASSWORD"]:
            auth = (cfg["API_KEY"], cfg["PASSWORD"])
        else:
            raise RuntimeError("Provide either SHOPIFY_ACCESS_TOKEN or both SHOPIFY_API_KEY and SHOPIFY_PASSWORD for the selected store.")
    r = requests.delete(url, headers=cfg["HEADERS"], timeout=60, auth=auth)
    r.raise_for_status()
    return r.json() if r.content else {}


def count_orders_by_title(title_contains: str, created_at_min: str, created_at_max: str, *, store: str | None = None, include_closed: bool = False) -> int:
    """Count orders created within [created_at_min, created_at_max].

    Behavior:
      - If title_contains is numeric (e.g., "123456789"), treat it as Shopify product_id and count
        orders where any line_item.product_id equals that ID.
      - Otherwise (textual campaign name), ignore and return 0 as requested.

    Includes orders with any financial_status; excludes canceled orders.
    """
    # Ignore textual names entirely per requirement
    ident = (title_contains or "").strip()
    if not ident or not ident.isdigit():
        return 0
    target_pid = int(ident)
    # Paginate REST orders endpoint using created_at range and status filters
    # Shopify REST: /orders.json?status=any&created_at_min=...&created_at_max=...&limit=250
    from urllib.parse import urlencode
    total = 0
    page_info = None
    base_path = "/orders.json"
    # Normalize date window to store's timezone (inclusive day bounds)
    try:
        tzname = get_shop_timezone(store)
    except Exception:
        tzname = "UTC"
    try:
        tz = ZoneInfo(tzname) if ZoneInfo else None
    except Exception:
        tz = None
    try:
        start_dt = datetime.fromisoformat(created_at_min.replace("Z","+00:00"))
        end_dt = datetime.fromisoformat(created_at_max.replace("Z","+00:00"))
        if tz:
            start_dt = start_dt.astimezone(tz)
            end_dt = end_dt.astimezone(tz)
        # Expand end to end-of-second inclusive to avoid off-by-one truncation
        end_dt = end_dt + timedelta(milliseconds=999)
        created_min = start_dt.isoformat()
        created_max = end_dt.isoformat()
    except Exception:
        created_min = created_at_min
        created_max = created_at_max

    qs = {
        "status": ("any" if include_closed else "open"),
        "limit": 250,
        "created_at_min": created_min,
        "created_at_max": created_max,
        # do not restrict fields to ensure line_items include product_id and variant_id
    }
    while True:
        path = base_path + ("?" + urlencode(qs) if qs else "")
        data = _rest_get_store(store, path)
        orders = (data or {}).get("orders") or []
        for o in orders:
            try:
                if o.get("cancelled_at"):
                    continue
                # financial_status can be null; accept any (paid, pending, authorized, etc.)
                items = o.get("line_items") or []
                found = False
                for li in items:
                    pid = (li or {}).get("product_id")
                    vid = (li or {}).get("variant_id")
                    try:
                        if pid is not None and int(pid) == target_pid:
                            found = True
                            break
                        if vid is not None and int(vid) == target_pid:
                            found = True
                            break
                    except Exception:
                        continue
                if found:
                    total += 1
            except Exception:
                continue
        # Basic pagination by page number (fallback when Link headers not available via helper)
        if len(orders) < int(qs["limit"]):
            break
        # Advance page using since_id to avoid overlaps
        try:
            last_id = orders[-1].get("id")
            if not last_id:
                break
            qs["since_id"] = last_id
        except Exception:
            break
    return total


def _parse_link_next(link: str | None) -> str | None:
    if not link:
        return None
    try:
        parts = [p.strip() for p in link.split(",")]
        for p in parts:
            if 'rel="next"' in p:
                seg = p.split(";")[0].strip()
                if seg.startswith("<") and seg.endswith(">"):
                    from urllib.parse import urlparse, parse_qs
                    url = seg[1:-1]
                    q = parse_qs(urlparse(url).query)
                    pi = q.get("page_info", [None])[0]
                    return pi
    except Exception:
        return None
    return None


def count_orders_by_product_processed(product_id: str, processed_min_date: str, processed_max_date: str, *, store: str | None = None, include_closed: bool = False) -> int:
    """Count open orders filtered by processed_at date (YYYY-MM-DD) and product_id, matching Shopify Admin behavior.

    Uses page_info pagination.
    """
    if not (product_id and product_id.isdigit()):
        return 0
    pid = int(product_id)
    from urllib.parse import urlencode
    base_path = "/orders.json"
    params = {
        "status": ("any" if include_closed else "open"),
        "limit": 250,
        "processed_at_min": f"{processed_min_date}T00:00:00",
        "processed_at_max": f"{processed_max_date}T23:59:59",
        "order": "processed_at asc",
    }
    total = 0
    page_info = None
    while True:
        q = params.copy()
        if page_info:
            q = {"page_info": page_info, "limit": 250}
        path = base_path + ("?" + urlencode(q))
        resp = _rest_get_store_raw(store, path)
        data = resp.json() if resp.content else {}
        orders = (data or {}).get("orders") or []
        for o in orders:
            try:
                if o.get("cancelled_at"):
                    continue
                for li in (o.get("line_items") or []):
                    try:
                        if int((li or {}).get("product_id") or 0) == pid:
                            total += 1
                            break
                    except Exception:
                        continue
            except Exception:
                continue
        link = resp.headers.get("Link")
        page_info = _parse_link_next(link)
        if not page_info:
            break
    return total


def count_orders_by_product_or_variant_processed(numeric_id: str, processed_min_date: str, processed_max_date: str, *, store: str | None = None, include_closed: bool = False) -> int:
    """Count open/any orders filtered by processed_at date (YYYY-MM-DD), matching either product_id OR variant_id.

    This handles cases where a numeric identifier refers to a variant rather than a product.
    Uses page_info pagination.
    """
    if not (numeric_id and numeric_id.isdigit()):
        return 0
    target = int(numeric_id)
    from urllib.parse import urlencode
    base_path = "/orders.json"
    # Normalize processed_at window to the shop's timezone, then convert to UTC for the REST API
    try:
        try:
            tzname = get_shop_timezone(store)
        except Exception:
            tzname = "UTC"
        try:
            tz = ZoneInfo(tzname) if ZoneInfo else None
        except Exception:
            tz = None
        start_local = datetime.fromisoformat(f"{processed_min_date}T00:00:00")
        end_local = datetime.fromisoformat(f"{processed_max_date}T23:59:59")
        if tz:
            start_local = start_local.replace(tzinfo=tz)
            end_local = end_local.replace(tzinfo=tz)
        # End-of-day inclusive to avoid truncation at second boundary
        end_local = end_local + timedelta(milliseconds=999)
        # Convert to UTC ISO8601 (Shopify processes timestamps in UTC)
        utc = ZoneInfo("UTC") if ZoneInfo else None
        processed_min_iso = start_local.astimezone(utc).isoformat() if utc else f"{processed_min_date}T00:00:00Z"
        processed_max_iso = end_local.astimezone(utc).isoformat() if utc else f"{processed_max_date}T23:59:59Z"
    except Exception:
        processed_min_iso = f"{processed_min_date}T00:00:00"
        processed_max_iso = f"{processed_max_date}T23:59:59"

    params = {
        "status": ("any" if include_closed else "open"),
        "limit": 250,
        "processed_at_min": processed_min_iso,
        "processed_at_max": processed_max_iso,
        "order": "processed_at asc",
    }
    total = 0
    page_info = None
    while True:
        q = params.copy()
        if page_info:
            q = {"page_info": page_info, "limit": 250}
        path = base_path + ("?" + urlencode(q))
        resp = _rest_get_store_raw(store, path)
        data = resp.json() if resp.content else {}
        orders = (data or {}).get("orders") or []
        for o in orders:
            try:
                if o.get("cancelled_at"):
                    continue
                matched = False
                for li in (o.get("line_items") or []):
                    try:
                        pid = int(((li or {}).get("product_id") or 0))
                        vid = int(((li or {}).get("variant_id") or 0))
                        if pid == target or vid == target:
                            matched = True
                            break
                    except Exception:
                        continue
                if matched:
                    total += 1
            except Exception:
                continue
        link = resp.headers.get("Link")
        page_info = _parse_link_next(link)
        if not page_info:
            break
    return total


def count_orders_total_processed(processed_min_date: str, processed_max_date: str, *, store: str | None = None, include_closed: bool = False) -> int:
    """Count total unique orders within a processed_at date range (YYYY-MM-DD).

    Excludes cancelled orders. Uses page_info pagination and respects include_closed via status=any.
    """
    from urllib.parse import urlencode
    base_path = "/orders.json"
    # Normalize processed_at window to store timezone to mirror Shopify Admin day bounds
    try:
        tzname = get_shop_timezone(store)
    except Exception:
        tzname = "UTC"
    try:
        tz = ZoneInfo(tzname) if ZoneInfo else None
    except Exception:
        tz = None
    try:
        y1, m1, d1 = [int(x) for x in (processed_min_date or "").split("-")]
        y2, m2, d2 = [int(x) for x in (processed_max_date or "").split("-")]
        start_dt = datetime(y1, m1, d1, 0, 0, 0)
        end_dt = datetime(y2, m2, d2, 23, 59, 59)
        if tz:
            start_dt = start_dt.replace(tzinfo=tz)
            end_dt = end_dt.replace(tzinfo=tz)
        processed_min = start_dt.isoformat()
        processed_max = end_dt.isoformat()
    except Exception:
        processed_min = f"{processed_min_date}T00:00:00"
        processed_max = f"{processed_max_date}T23:59:59"
    params = {
        "status": ("any" if include_closed else "open"),
        "limit": 250,
        "processed_at_min": processed_min,
        "processed_at_max": processed_max,
        "order": "processed_at asc",
    }
    total = 0
    page_info = None
    while True:
        q = params.copy()
        if page_info:
            q = {"page_info": page_info, "limit": 250}
        path = base_path + ("?" + urlencode(q))
        resp = _rest_get_store_raw(store, path)
        try:
            data = resp.json() if resp.content else {}
        except Exception:
            data = {}
        orders = (data or {}).get("orders") or []
        for o in orders:
            try:
                if o.get("cancelled_at"):
                    continue
                total += 1
            except Exception:
                continue
        link = resp.headers.get("Link")
        page_info = _parse_link_next(link)
        if not page_info:
            break
    return total


def _parse_utm_from_url(url: str | None) -> tuple[dict, str | None, str | None]:
    """Extract UTM parameters and explicit ad/campaign IDs from a URL.

    Returns (utm_map, ad_id, campaign_id).
    """
    try:
        if not url:
            return ({}, None, None)
        from urllib.parse import urlparse, parse_qs
        pr = urlparse(url)
        q = parse_qs(pr.query or "")
        # Flatten single values
        utm: dict = {}
        for k in ("utm_source","utm_medium","utm_campaign","utm_content","utm_term","utm_id","fbclid","gclid","ad_id","campaign_id"):
            vals = q.get(k) or []
            if vals:
                utm[k] = vals[0]
        # Prefer explicit ad_id/campaign_id params
        ad_id = (q.get("ad_id") or [None])[0]
        campaign_id = (q.get("campaign_id") or [None])[0]
        # Some setups place the ad id in utm_content/utm_term
        if not ad_id:
            ad_id = utm.get("utm_content") or utm.get("utm_term")
        if not campaign_id:
            campaign_id = utm.get("utm_campaign")
        return (utm, ad_id, campaign_id)
    except Exception:
        return ({}, None, None)


def list_orders_with_utms_processed(processed_min_date: str, processed_max_date: str, *, store: str | None = None, include_closed: bool = True) -> list[dict]:
    """List orders within processed_at range and extract UTM/ad identifiers from landing URLs.

    Output rows include: order_id, name, processed_at, total_price, currency, source_name,
    landing_site, utm (map), ad_id, campaign_id.
    """
    from urllib.parse import urlencode
    base_path = "/orders.json"
    # Normalize processed_at window to store timezone bounds
    try:
        tzname = get_shop_timezone(store)
    except Exception:
        tzname = "UTC"
    try:
        tz = ZoneInfo(tzname) if ZoneInfo else None
    except Exception:
        tz = None
    try:
        y1, m1, d1 = [int(x) for x in (processed_min_date or "").split("-")]
        y2, m2, d2 = [int(x) for x in (processed_max_date or "").split("-")]
        start_dt = datetime(y1, m1, d1, 0, 0, 0)
        end_dt = datetime(y2, m2, d2, 23, 59, 59, 999000)
        if tz:
            start_dt = start_dt.replace(tzinfo=tz)
            end_dt = end_dt.replace(tzinfo=tz)
        processed_min = start_dt.isoformat()
        processed_max = end_dt.isoformat()
    except Exception:
        processed_min = f"{processed_min_date}T00:00:00"
        processed_max = f"{processed_max_date}T23:59:59"

    params = {
        "status": ("any" if include_closed else "open"),
        "limit": 250,
        "processed_at_min": processed_min,
        "processed_at_max": processed_max,
        "order": "processed_at asc",
    }
    out: list[dict] = []
    page_info = None
    while True:
        q = params.copy()
        if page_info:
            q = {"page_info": page_info, "limit": 250}
        path = base_path + ("?" + urlencode(q))
        resp = _rest_get_store_raw(store, path)
        data = resp.json() if resp.content else {}
        orders = (data or {}).get("orders") or []
        for o in orders:
            try:
                if o.get("cancelled_at"):
                    continue
                landing = (o.get("landing_site") or "").strip()
                # Fallbacks: some shops store full URL in a note_attribute named full_url
                if not landing:
                    try:
                        for na in (o.get("note_attributes") or []):
                            if (na or {}).get("name") == "full_url" and (na or {}).get("value"):
                                landing = str((na or {}).get("value"))
                                break
                    except Exception:
                        pass
                utm, ad_id, campaign_id = _parse_utm_from_url(landing)
                # Build output row
                row = {
                    "order_id": o.get("id"),
                    "name": o.get("name"),
                    "processed_at": o.get("processed_at") or o.get("created_at"),
                    "total_price": float(o.get("total_price") or 0),
                    "currency": o.get("currency"),
                    "source_name": o.get("source_name"),
                    "landing_site": landing or None,
                    "utm": utm,
                    "ad_id": ad_id,
                    "campaign_id": campaign_id,
                }
                out.append(row)
            except Exception:
                continue
        link = resp.headers.get("Link")
        page_info = _parse_link_next(link)
        if not page_info:
            break
    return out


def count_orders_total_created(created_min_date: str, created_max_date: str, *, store: str | None = None, include_closed: bool = False) -> int:
    """Count total unique orders within a created_at date range (YYYY-MM-DD).

    Excludes cancelled orders. Uses page_info pagination and respects include_closed via status=any.
    """
    from urllib.parse import urlencode
    base_path = "/orders.json"
    # Build inclusive day bounds
    try:
        y1, m1, d1 = [int(x) for x in (created_min_date or "").split("-")]
        y2, m2, d2 = [int(x) for x in (created_max_date or "").split("-")]
        created_min = f"{y1:04d}-{m1:02d}-{d1:02d}T00:00:00"
        created_max = f"{y2:04d}-{m2:02d}-{d2:02d}T23:59:59"
    except Exception:
        created_min = f"{created_min_date}T00:00:00"
        created_max = f"{created_max_date}T23:59:59"
    params = {
        "status": ("any" if include_closed else "open"),
        "limit": 250,
        "created_at_min": created_min,
        "created_at_max": created_max,
        "order": "created_at asc",
    }
    total = 0
    page_info = None
    while True:
        q = params.copy()
        if page_info:
            q = {"page_info": page_info, "limit": 250}
        path = base_path + ("?" + urlencode(q))
        resp = _rest_get_store_raw(store, path)
        try:
            data = resp.json() if resp.content else {}
        except Exception:
            data = {}
        orders = (data or {}).get("orders") or []
        for o in orders:
            try:
                if o.get("cancelled_at"):
                    continue
                total += 1
            except Exception:
                continue
        link = resp.headers.get("Link")
        page_info = _parse_link_next(link)
        if not page_info:
            break
    return total


def list_product_ids_in_collection(collection_id: str, *, store: str | None = None) -> list[int]:
    """Return product IDs for a given collection.

    Strategy:
      1) Try GraphQL collection(id) pagination (works for custom and smart collections)
      2) Fallback to REST products.json?collection_id=... (current membership)
      3) Fallback to REST collects.json (custom collections only)
    """
    # 1) GraphQL
    out_ids: set[int] = set()
    try:
        gid = f"gid://shopify/Collection/{collection_id}"
        cursor = None
        while True:
            q = (
                "query($id:ID!,$cursor:String){ collection(id:$id){ products(first:250, after:$cursor){ pageInfo{hasNextPage,endCursor} nodes{ id } } } }"
            )
            data = _gql_store(store, q, {"id": gid, "cursor": cursor})
            nodes = (((data or {}).get("collection") or {}).get("products") or {}).get("nodes") or []
            for n in nodes:
                try:
                    gid_prod = (n or {}).get("id") or ""
                    num = _extract_numeric_id_from_gid(gid_prod)
                    if num and num.isdigit():
                        out_ids.add(int(num))
                except Exception:
                    continue
            pi = (((data or {}).get("collection") or {}).get("products") or {}).get("pageInfo") or {}
            if not bool(pi.get("hasNextPage")):
                break
            cursor = (((data or {}).get("collection") or {}).get("products") or {}).get("pageInfo", {}).get("endCursor")
            if not cursor:
                break
    except Exception:
        pass
    # 2) REST products.json fallback
    try:
        since_id = None
        limit = 250
        while True:
            qs = f"limit={limit}&fields=id" + (f"&since_id={since_id}" if since_id else "")
            data = _rest_get_store(store, f"/products.json?collection_id={collection_id}&{qs}")
            products = (data or {}).get("products") or []
            for p in products:
                try:
                    pid = int((p or {}).get("id"))
                    out_ids.add(pid)
                except Exception:
                    continue
            if len(products) < limit:
                break
            try:
                since_id = (products[-1] or {}).get("id")
                if not since_id:
                    break
            except Exception:
                break
    except Exception:
        pass
    # 3) REST collects.json fallback (custom collections only)
    try:
        since_id = None
        limit = 250
        while True:
            qs = f"limit={limit}&fields=product_id" + (f"&since_id={since_id}" if since_id else "")
            data = _rest_get_store(store, f"/collects.json?collection_id={collection_id}&{qs}")
            collects = (data or {}).get("collects") or []
            for c in collects:
                try:
                    pid = int((c or {}).get("product_id"))
                    out_ids.add(pid)
                except Exception:
                    continue
            if len(collects) < limit:
                break
            try:
                since_id = (collects[-1] or {}).get("id")
                if not since_id:
                    break
            except Exception:
                break
    except Exception:
        pass
    return list(out_ids)


def count_orders_by_collection_processed(collection_id: str, processed_min_date: str, processed_max_date: str, *, store: str | None = None, include_closed: bool = False) -> int:
    """Count unique orders whose line_items include any product in the collection within processed_at range (YYYY-MM-DD).

    Notes:
      - Uses product_id match only (variant_id also implies product match)
      - Dedupes orders so one order with multiple collection products counts once
      - Respects include_closed by using status=any
    """
    try:
        product_ids = set(list_product_ids_in_collection(collection_id, store=store))
    except Exception:
        product_ids = set()
    if not product_ids:
        return 0
    from urllib.parse import urlencode
    base_path = "/orders.json"
    # Normalize processed_at window to store timezone to mirror Shopify Admin day bounds
    try:
        tzname = get_shop_timezone(store)
    except Exception:
        tzname = "UTC"
    try:
        tz = ZoneInfo(tzname) if ZoneInfo else None
    except Exception:
        tz = None
    try:
        y1, m1, d1 = [int(x) for x in (processed_min_date or "").split("-")]
        y2, m2, d2 = [int(x) for x in (processed_max_date or "").split("-")]
        start_dt = datetime(y1, m1, d1, 0, 0, 0)
        end_dt = datetime(y2, m2, d2, 23, 59, 59)
        if tz:
            start_dt = start_dt.replace(tzinfo=tz)
            end_dt = end_dt.replace(tzinfo=tz)
        processed_min = start_dt.isoformat()
        processed_max = end_dt.isoformat()
    except Exception:
        processed_min = f"{processed_min_date}T00:00:00"
        processed_max = f"{processed_max_date}T23:59:59"
    params = {
        "status": ("any" if include_closed else "open"),
        "limit": 250,
        "processed_at_min": processed_min,
        "processed_at_max": processed_max,
        "order": "processed_at asc",
    }
    total = 0
    seen_order_ids: set[int] = set()
    page_info = None
    while True:
        q = params.copy()
        if page_info:
            q = {"page_info": page_info, "limit": 250}
        path = base_path + ("?" + urlencode(q))
        resp = _rest_get_store_raw(store, path)
        try:
            data = resp.json() if resp.content else {}
        except Exception:
            data = {}
        orders = (data or {}).get("orders") or []
        for o in orders:
            try:
                if o.get("cancelled_at"):
                    continue
                oid = int(o.get("id")) if o.get("id") else None
                if oid is not None and oid in seen_order_ids:
                    continue
                found = False
                for li in (o.get("line_items") or []):
                    try:
                        pid = int((li or {}).get("product_id") or 0)
                        if pid in product_ids:
                            found = True
                            break
                    except Exception:
                        continue
                if found:
                    if oid is not None:
                        seen_order_ids.add(oid)
                    total += 1
            except Exception:
                continue
        link = resp.headers.get("Link")
        page_info = _parse_link_next(link)
        if not page_info:
            break
    return total


def count_items_by_collection_processed(collection_id: str, processed_min_date: str, processed_max_date: str, *, store: str | None = None, include_closed: bool = False) -> int:
    """Sum line item quantities for products in the collection within processed_at range (YYYY-MM-DD).

    Differences from count_orders_by_collection_processed:
      - Sums quantities across line items; does not dedupe per order
      - If an order has multiple items from the collection, all are counted
    """
    try:
        product_ids = set(list_product_ids_in_collection(collection_id, store=store))
    except Exception:
        product_ids = set()
    if not product_ids:
        return 0
    from urllib.parse import urlencode
    base_path = "/orders.json"
    # Normalize processed_at window to store timezone to mirror Shopify Admin day bounds
    try:
        tzname = get_shop_timezone(store)
    except Exception:
        tzname = "UTC"
    try:
        tz = ZoneInfo(tzname) if ZoneInfo else None
    except Exception:
        tz = None
    try:
        y1, m1, d1 = [int(x) for x in (processed_min_date or "").split("-")]
        y2, m2, d2 = [int(x) for x in (processed_max_date or "").split("-")]
        start_dt = datetime(y1, m1, d1, 0, 0, 0)
        end_dt = datetime(y2, m2, d2, 23, 59, 59)
        if tz:
            start_dt = start_dt.replace(tzinfo=tz)
            end_dt = end_dt.replace(tzinfo=tz)
        processed_min = start_dt.isoformat()
        processed_max = end_dt.isoformat()
    except Exception:
        processed_min = f"{processed_min_date}T00:00:00"
        processed_max = f"{processed_max_date}T23:59:59"
    params = {
        "status": ("any" if include_closed else "open"),
        "limit": 250,
        "processed_at_min": processed_min,
        "processed_at_max": processed_max,
        "order": "processed_at asc",
    }
    total_qty = 0
    page_info = None
    while True:
        q = params.copy()
        if page_info:
            q = {"page_info": page_info, "limit": 250}
        path = base_path + ("?" + urlencode(q))
        resp = _rest_get_store_raw(store, path)
        try:
            data = resp.json() if resp.content else {}
        except Exception:
            data = {}
        orders = (data or {}).get("orders") or []
        for o in orders:
            try:
                if o.get("cancelled_at"):
                    continue
                for li in (o.get("line_items") or []):
                    try:
                        pid = int((li or {}).get("product_id") or 0)
                        if pid in product_ids:
                            qty = int((li or {}).get("quantity") or 0)
                            total_qty += max(0, qty)
                    except Exception:
                        continue
            except Exception:
                continue
        link = resp.headers.get("Link")
        page_info = _parse_link_next(link)
        if not page_info:
            break
    return total_qty


def sum_product_order_counts_for_collection(collection_id: str, processed_min_date: str, processed_max_date: str, *, store: str | None = None, include_closed: bool = False) -> int:
    """Sum per-product unique order counts across all products currently in the collection.

    Notes:
      - For each product_id in the collection, count unique orders containing that product (processed_at range)
      - Sums across products; an order containing multiple products from the collection will be counted multiple times
      - This matches a "count per product then sum" aggregation.
    """
    try:
        product_ids = list_product_ids_in_collection(collection_id, store=store)
    except Exception:
        product_ids = []
    if not product_ids:
        return 0
    total = 0
    for pid in product_ids:
        try:
            total += count_orders_by_product_processed(str(pid), processed_min_date, processed_max_date, store=store, include_closed=include_closed)
        except Exception:
            continue
    return total


def sum_product_order_counts_for_collection_created(collection_id: str, created_min_date: str, created_max_date: str, *, store: str | None = None, include_closed: bool = False) -> int:
    """Sum per-product unique order counts across all products in the collection using created_at range.

    Uses count_orders_by_title for numeric product ids which filters by created_at.
    """
    try:
        product_ids = list_product_ids_in_collection(collection_id, store=store)
    except Exception:
        product_ids = []
    if not product_ids:
        return 0
    total = 0
    for pid in product_ids:
        try:
            total += count_orders_by_title(str(pid), created_min_date, created_max_date, store=store, include_closed=include_closed)
        except Exception:
            continue
    return total

def _product_first_image_url(numeric_product_id: str, *, store: str | None = None) -> str | None:
    try:
        data = _rest_get_store(store, f"/products/{numeric_product_id}.json")
        imgs = ((data or {}).get("product") or {}).get("images") or []
        if imgs:
            return (imgs[0] or {}).get("src")
    except Exception:
        return None
    return None


def get_product_brief(numeric_product_id: str, *, store: str | None = None) -> dict:
    """Return a brief for a product: image, total_available, zero_variants.

    - Sums inventory across all inventory levels per variant
    - Counts how many variants have 0 available
    - Picks the first product image as thumbnail
    """
    total_available = 0
    zero_variants = 0
    try:
        variants = _list_variants(numeric_product_id, store=store)
    except Exception:
        variants = []
    inv_map: dict[str, int] = {}
    # Collect inventory_item_ids
    inv_ids: list[str] = []
    for v in variants or []:
        try:
            iid = str((v or {}).get("inventory_item_id"))
            if iid and iid != "None":
                inv_ids.append(iid)
        except Exception:
            continue
    if inv_ids:
        # Query inventory levels in chunks (Shopify limit)
        chunk = 50
        for i in range(0, len(inv_ids), chunk):
            ids = ",".join(inv_ids[i:i+chunk])
            try:
                data = _rest_get_store(store, f"/inventory_levels.json?inventory_item_ids={ids}")
                levels = (data or {}).get("inventory_levels") or []
                for lv in levels:
                    try:
                        iid = str(lv.get("inventory_item_id"))
                        avail = int(lv.get("available") or 0)
                        inv_map[iid] = inv_map.get(iid, 0) + avail
                    except Exception:
                        continue
            except Exception:
                continue
    # Compute totals per variant
    for v in variants or []:
        try:
            iid = str((v or {}).get("inventory_item_id"))
            avail = inv_map.get(iid, 0)
            total_available += max(0, int(avail))
            if int(avail) <= 0:
                zero_variants += 1
        except Exception:
            continue
    image = _product_first_image_url(numeric_product_id, store=store)
    return {"image": image, "total_available": total_available, "zero_variants": zero_variants}


def get_products_brief(numeric_product_ids: list[str], *, store: str | None = None) -> dict:
    out: dict[str, dict] = {}
    for pid in (numeric_product_ids or []):
        try:
            out[pid] = get_product_brief(str(pid), store=store)
        except Exception:
            out[pid] = {"image": None, "total_available": 0, "zero_variants": 0}
    return out


def _extract_numeric_id_from_gid(gid: str) -> str | None:
    try:
        return (gid or "").split("/")[-1] or None
    except Exception:
        return None


def upload_images_to_product(product_gid: str, image_srcs: list[str], alt_texts: list[str] | None = None, *, store: str | None = None) -> list[str]:
    """Attach remote images to a Shopify product and return Shopify CDN URLs.

    Best-effort: continues on individual failures and returns all successful CDN URLs.
    """
    if not image_srcs:
        return []
    numeric_id = _extract_numeric_id_from_gid(product_gid)
    if not numeric_id:
        return []
    cdn_urls: list[str] = []
    for idx, src in enumerate(image_srcs):
        try:
            alt = (alt_texts[idx] if (alt_texts and idx < len(alt_texts)) else None) or "Product image"
            resp = _rest_post_store(store, f"/products/{numeric_id}/images.json", {"image": {"src": src, "alt": alt}})
            try:
                cdn = (resp or {}).get("image", {}).get("src")
                if cdn:
                    cdn_urls.append(cdn)
            except Exception:
                pass
        except Exception:
            # Ignore per-image failures to avoid blocking the flow
            continue
    return cdn_urls


def upload_images_to_product_verbose(product_gid: str, image_srcs: list[str], alt_texts: list[str] | None = None, *, store: str | None = None) -> dict:
    """Upload images and return detailed per-image outcomes plus collected CDN URLs."""
    results: list[dict] = []
    cdn_urls: list[str] = []
    numeric_id = _extract_numeric_id_from_gid(product_gid)
    if not (numeric_id and image_srcs):
        return {"cdn_urls": [], "per_image": results}
    for idx, src in enumerate(image_srcs):
        try:
            alt = (alt_texts[idx] if (alt_texts and idx < len(alt_texts)) else None) or "Product image"
            resp = _rest_post_store(store, f"/products/{numeric_id}/images.json", {"image": {"src": src, "alt": alt}})
            cdn = (resp or {}).get("image", {}).get("src")
            if cdn:
                cdn_urls.append(cdn)
            results.append({"src": src, "ok": True, "cdn": cdn, "resp_keys": list((resp or {}).keys())})
        except Exception as e:
            results.append({"src": src, "ok": False, "error": str(e)})
            continue
    return {"cdn_urls": cdn_urls, "per_image": results}


def upload_image_attachments_to_product(product_gid: str, files: list[tuple[str, bytes]], alt_texts: list[str] | None = None, *, store: str | None = None) -> dict:
    """Upload local files as base64 attachments to a Shopify product. Returns cdn_urls and per-image outcomes.

    files: list of (filename, bytes)
    """
    results: list[dict] = []
    cdn_urls: list[str] = []
    numeric_id = _extract_numeric_id_from_gid(product_gid)
    if not (numeric_id and files):
        return {"cdn_urls": [], "per_image": results}
    for idx, (filename, blob) in enumerate(files):
        try:
            b64 = base64.b64encode(blob).decode("ascii")
            alt = (alt_texts[idx] if (alt_texts and idx < len(alt_texts)) else None) or "Product image"
            payload = {"image": {"attachment": b64, "filename": filename, "alt": alt}}
            resp = _rest_post_store(store, f"/products/{numeric_id}/images.json", payload)
            cdn = (resp or {}).get("image", {}).get("src")
            if cdn:
                cdn_urls.append(cdn)
            results.append({"filename": filename, "ok": True, "cdn": cdn, "resp_keys": list((resp or {}).keys())})
        except Exception as e:
            results.append({"filename": filename, "ok": False, "error": str(e)})
            continue
    return {"cdn_urls": cdn_urls, "per_image": results}


def list_product_images(product_gid: str, *, store: str | None = None) -> list[dict]:
    numeric_id = _extract_numeric_id_from_gid(product_gid)
    if not numeric_id:
        return []
    try:
        data = _rest_get_store(store, f"/products/{numeric_id}/images.json")
        return (data or {}).get("images", []) or []
    except Exception:
        return []


def _get_primary_location_id(store: str | None = None) -> str | None:
    try:
        data = _rest_get_store(store, "/locations.json")
        locs = (data or {}).get("locations") or []
        for loc in locs:
            try:
                if loc.get("active", True):
                    return str(loc.get("id"))
            except Exception:
                continue
        # Fallback to first location if none marked active
        if locs:
            return str(locs[0].get("id"))
    except Exception:
        return None
    return None


def _set_inventory_tracked(inventory_item_id: str, tracked: bool = True, *, store: str | None = None) -> None:
    try:
        _rest_put_store(store, f"/inventory_items/{inventory_item_id}.json", {"inventory_item": {"id": int(inventory_item_id), "tracked": bool(tracked)}})
    except Exception:
        # best-effort; do not raise to avoid blocking the flow
        pass


def _set_inventory_level(location_id: str, inventory_item_id: str, available: int, *, store: str | None = None) -> None:
    try:
        _rest_post_store(store, "/inventory_levels/set.json", {
            "location_id": int(location_id),
            "inventory_item_id": int(inventory_item_id),
            "available": int(available)
        })
    except Exception:
        # best-effort; do not raise to avoid blocking the flow
        pass


def _numeric_product_id_from_gid(product_gid: str) -> str | None:
    try:
        return (product_gid or "").split("/")[-1] or None
    except Exception:
        return None


def _update_product_options(numeric_product_id: str, sizes: list[str] | None, colors: list[str] | None, *, store: str | None = None) -> None:
    try:
        options = []
        if sizes:
            options.append({"name": "Size", "values": sizes})
        if colors:
            options.append({"name": "Color", "values": colors})
        if not options:
            return
        _rest_put_store(store, f"/products/{numeric_product_id}.json", {"product": {"id": int(numeric_product_id), "options": options}})
    except Exception:
        pass


def _create_variant(
    numeric_product_id: str,
    option1: str | None,
    option2: str | None,
    price: float | None,
    *,
    sku: str | None = None,
    barcode: str | None = None,
    store: str | None = None,
) -> dict | None:
    try:
        variant: dict = {}
        if option1 is not None:
            variant["option1"] = option1
        if option2 is not None:
            variant["option2"] = option2
        if price is not None:
            variant["price"] = str(price)
        if sku:
            variant["sku"] = sku
        if barcode:
            variant["barcode"] = barcode
        resp = _rest_post_store(store, f"/products/{numeric_product_id}/variants.json", {"variant": variant})
        return (resp or {}).get("variant")
    except Exception:
        return None


def _list_variants(numeric_product_id: str, *, store: str | None = None) -> list[dict]:
    try:
        resp = _rest_get_store(store, f"/products/{numeric_product_id}/variants.json")
        return (resp or {}).get("variants", []) or []
    except Exception:
        return []


def _update_variant_price(variant_id: str, price: float, *, store: str | None = None) -> None:
    try:
        _rest_put_store(store, f"/variants/{variant_id}.json", {"variant": {"id": int(variant_id), "price": str(price)}})
    except Exception:
        pass


def _configure_variants_for_product(
    product_gid: str,
    base_price: float | None,
    sizes: list[str] | None,
    colors: list[str] | None,
    track_quantity: bool | None = None,
    quantity: int | None = None,
    variants: list[dict] | None = None,
    *,
    store: str | None = None,
) -> dict:
    numeric_id = _numeric_product_id_from_gid(product_gid)
    report: dict = {
        "ok": True,
        "options_updated": {"size_count": 0, "color_count": 0},
        "variants_created": 0,
        "inventory_items_updated": 0,
        "skipped": [],
        "errors": [],
    }
    if not numeric_id:
        report["ok"] = False
        report["errors"].append("Invalid product GID")
        return report
    # Location used for inventory level updates (best-effort)
    loc_id = _get_primary_location_id(store)

    # Explicit variants provided: honor per-variant price/sku/qty/track when present
    explicit_variants: list[dict] = [v for v in (variants or []) if isinstance(v, dict)]
    if explicit_variants:
        uniq_sizes: list[str] = []
        uniq_colors: list[str] = []
        for v in explicit_variants:
            try:
                sv = (v.get("size") or "").strip()
                cv = (v.get("color") or "").strip()
                if sv and sv not in uniq_sizes:
                    uniq_sizes.append(sv)
                if cv and cv not in uniq_colors:
                    uniq_colors.append(cv)
            except Exception:
                continue
        if uniq_sizes or uniq_colors:
            _update_product_options(numeric_id, uniq_sizes or None, uniq_colors or None, store=store)
            report["options_updated"] = {"size_count": len(uniq_sizes), "color_count": len(uniq_colors)}
        for v in explicit_variants:
            try:
                sv = (v.get("size") or None)
                cv = (v.get("color") or None)
                price = v.get("price", base_price)
                sku = (v.get("sku") or None)
                barcode = (v.get("barcode") or None)
                created = _create_variant(numeric_id, sv, cv, price, sku=sku if isinstance(sku, str) and sku.strip() else None, barcode=barcode if isinstance(barcode, str) and barcode.strip() else None, store=store)
                if created:
                    report["variants_created"] += 1
                if created and loc_id:
                    inv_item_id = str((created or {}).get("inventory_item_id"))
                    if inv_item_id and inv_item_id != "None":
                        # Per-variant track flag wins; else global; else default True
                        tq_raw = v.get("track_quantity")
                        eff_tq = (bool(tq_raw) if tq_raw is not None else (bool(track_quantity) if track_quantity is not None else True))
                        _set_inventory_tracked(inv_item_id, eff_tq, store=store)
                        # Per-variant quantity wins; else global quantity; else leave as-is (no set)
                        q_raw = v.get("quantity")
                        eff_q = q_raw if (q_raw is not None) else quantity
                        if eff_q is not None:
                            _set_inventory_level(loc_id, inv_item_id, int(eff_q), store=store)
                            report["inventory_items_updated"] += 1
            except Exception as e:
                report["ok"] = False
                report["errors"].append(str(e))
                continue
        return report

    # Fallback: sizes/colors combos with base price
    values_size = [s.strip() for s in (sizes or []) if isinstance(s, str) and s.strip()]
    values_color = [c.strip() for c in (colors or []) if isinstance(c, str) and c.strip()]
    if values_size or values_color:
        # Update product options and create variants for all combinations
        _update_product_options(numeric_id, values_size or None, values_color or None, store=store)
        report["options_updated"] = {"size_count": len(values_size), "color_count": len(values_color)}
        created_variants: list[dict] = []
        if values_size and values_color:
            for sv in values_size:
                for cv in values_color:
                    v = _create_variant(numeric_id, sv, cv, base_price, store=store)
                    if v:
                        created_variants.append(v)
        elif values_size:
            for sv in values_size:
                v = _create_variant(numeric_id, sv, None, base_price, store=store)
                if v:
                    created_variants.append(v)
        elif values_color:
            for cv in values_color:
                v = _create_variant(numeric_id, None, cv, base_price, store=store)
                if v:
                    created_variants.append(v)
        report["variants_created"] = len(created_variants)
        # Enable inventory and set stock per provided quantity (default 2)
        if loc_id:
            for v in created_variants:
                try:
                    inv_item_id = str((v or {}).get("inventory_item_id"))
                    if inv_item_id and inv_item_id != "None":
                        _set_inventory_tracked(inv_item_id, bool(track_quantity) if track_quantity is not None else True, store=store)
                        if quantity is not None:
                            _set_inventory_level(loc_id, inv_item_id, int(quantity), store=store)
                        else:
                            _set_inventory_level(loc_id, inv_item_id, 2, store=store)
                        report["inventory_items_updated"] += 1
                except Exception:
                    continue
        if base_price is None:
            report["skipped"].append({"field": "base_price", "reason": "missing"})
    else:
        # Single default variant: update price and inventory
        variants_list = _list_variants(numeric_id, store=store)
        if variants_list:
            first = variants_list[0]
            try:
                var_id = str(first.get("id"))
                if base_price is not None and var_id:
                    _update_variant_price(var_id, base_price, store=store)
                else:
                    report["skipped"].append({"field": "base_price", "reason": "missing"})
            except Exception:
                pass
            try:
                inv_item_id = str(first.get("inventory_item_id"))
                if loc_id and inv_item_id and inv_item_id != "None":
                    _set_inventory_tracked(inv_item_id, bool(track_quantity) if track_quantity is not None else True, store=store)
                    if quantity is not None:
                        _set_inventory_level(loc_id, inv_item_id, int(quantity), store=store)
                    else:
                        _set_inventory_level(loc_id, inv_item_id, 2, store=store)
                    report["inventory_items_updated"] += 1
            except Exception:
                pass
        else:
            report["skipped"].append({"field": "variants", "reason": "no default variant found"})
    # Mark skipped options when empty inputs were provided
    if sizes is not None and not values_size:
        report["skipped"].append({"field": "sizes", "reason": "empty"})
    if colors is not None and not values_color:
        report["skipped"].append({"field": "colors", "reason": "empty"})
    return report


def publish_product_all_channels(product_gid: str, *, store: str | None = None) -> dict:
    """Publish a product to all available sales channels (publications)."""
    try:
        pubs = _gql_store(store, PUBLICATIONS_QUERY, {})
        nodes = ((pubs or {}).get("publications") or {}).get("nodes") or []
        pids = [n.get("id") for n in nodes if isinstance(n, dict) and n.get("id")]
        if not pids:
            return {"ok": True, "published": 0}
        _gql_store(store, PUBLISH_PRODUCT, {"id": product_gid, "publicationIds": pids})
        return {"ok": True, "published": len(pids)}
    except Exception as e:
        # best-effort; return error but do not raise
        return {"ok": False, "error": str(e)}


def publish_page_all_channels(page_gid: str, *, store: str | None = None) -> dict:
    """Publish a page to all available sales channels (publications)."""
    try:
        pubs = _gql_store(store, PUBLICATIONS_QUERY, {})
        nodes = ((pubs or {}).get("publications") or {}).get("nodes") or []
        pids = [n.get("id") for n in nodes if isinstance(n, dict) and n.get("id")]
        if not pids:
            return {"ok": True, "published": 0}
        _gql_store(store, PUBLISH_PRODUCT, {"id": page_gid, "publicationIds": pids})
        return {"ok": True, "published": len(pids)}
    except Exception as e:
        # best-effort; return error but do not raise
        return {"ok": False, "error": str(e)}


def configure_variants_for_product(
    product_gid: str,
    base_price: float | None,
    sizes: list[str] | None,
    colors: list[str] | None,
    track_quantity: bool | None = None,
    quantity: int | None = None,
    variants: list[dict] | None = None,
    *,
    store: str | None = None,
) -> dict:
    """Public wrapper to configure options/variants/pricing/inventory for a product.

    Returns a small summary describing what was attempted.
    """
    try:
        rep = _configure_variants_for_product(product_gid, base_price, sizes, colors, track_quantity, quantity, variants, store=store)
        return rep
    except Exception as e:
        return {"ok": False, "errors": [str(e)]}


def create_product_only(
    title: str,
    description_html: str | None = None,
    status: str = "ACTIVE",
    price: float | None = None,
    sizes: list[str] | None = None,
    colors: list[str] | None = None,
    product_type: str | None = None,
    *,
    track_quantity: bool | None = None,
    quantity: int | None = None,
    variants: list[dict] | None = None,
    store: str | None = None,
) -> dict:
    inp: dict = {
        "title": title or "Offer",
        "status": status,
    }
    if description_html:
        inp["descriptionHtml"] = description_html
    if product_type:
        # Shopify product organization: productType (string)
        inp["productType"] = product_type
    data = _gql_store(store, PRODUCT_CREATE, {"input": inp})
    prod = data["productCreate"]["product"]
    # Configure variants and inventory via REST
    config_report: dict | None = None
    try:
        config_report = _configure_variants_for_product(prod["id"], price, sizes, colors, track_quantity, quantity, variants, store=store)
    except Exception as e:
        config_report = {"ok": False, "errors": [str(e)]}
    # Publish to all sales channels (best-effort)
    try:
        publish_product_all_channels(prod["id"], store=store)
    except Exception:
        pass
    return {"product": prod, "report": (config_report or {"ok": True})}


def create_product_and_page(payload: dict, angles: list, creatives: list, landing_copy: dict | None = None, *, store: str | None = None) -> dict:
    cfg = _get_store_config(store)
    title = payload.get("title") or (angles and angles[0].get("titles", ["Offer"])[0]) or "Offer"
    ksp = (angles[0].get("ksp") if angles else [])[:3]
    # Prefer structured landing HTML if provided; otherwise derive a short feature list
    structured_html = (landing_copy or {}).get("html") if landing_copy else None
    desc_html = structured_html or ("<ul>" + "".join([f"<li>{p}</li>" for p in ksp]) + "</ul>" if ksp else "")

    # Collate image URLs requested for upload: prefer uploaded images from payload; otherwise fall back to creatives
    requested_images = (payload.get("uploaded_images") or []) or [c.get("image_url") for c in (creatives or []) if c.get("image_url")]

    # Do not set description at product creation time.
    product_in: dict = {
        "title": title,
        "status": "ACTIVE",
    }
    # Include product organization type when provided in payload
    try:
        ptype = (payload or {}).get("product_type")
        if ptype:
            product_in["productType"] = ptype
    except Exception:
        pass

    pdata = _gql_store(store, PRODUCT_CREATE, {"input": product_in})["productCreate"]["product"]
    # Attach images via REST after creation and capture Shopify CDN URLs
    shopify_image_urls: list[str] = []
    alt_texts: list[str] = []
    if requested_images:
        # Prepare alt texts from landing copy sections or description/title
        sections = (landing_copy or {}).get("sections") or []
        base_title = title
        base_desc = (payload.get("description") or "")
        for idx, _ in enumerate(requested_images):
            sec = sections[idx] if idx < len(sections) else {}
            sec_title = sec.get("title") or "Product image"
            sec_body = sec.get("body") or base_desc
            alt_texts.append(f"{base_title} — {sec_title}: {sec_body[:80]}")
        # Perform upload step and prefer returned Shopify CDN URLs
        shopify_image_urls = upload_images_to_product(pdata["id"], requested_images, alt_texts, store=store)

    # Build landing page body using the common responsive builder (ensures only provided images are embedded)
    page_body_html = _build_page_body_html(title, landing_copy, shopify_image_urls or requested_images, alt_texts)

    handle = f"offer-{pdata['id'].split('/')[-1]}"
    page_in = {
        "title": f"{title} – Offer",
        "handle": handle,
        "templateSuffix": "product_test",
        "body": page_body_html
    }

    page = _gql_store(store, PAGE_CREATE, {"page": page_in})["pageCreate"]["page"]
    page_url = f"https://{cfg['SHOP']}/pages/{page['handle']}"

    # After landing page is generated, update product description HTML to match the provided/generated content
    try:
        final_desc = structured_html or page_body_html or ""
        if final_desc:
            update_product_description(pdata["id"], final_desc, store=store)
    except Exception:
        pass

    # Configure pricing/variants/inventory via REST after product creation
    try:
        base_price = payload.get("base_price")
        sizes = payload.get("sizes")
        colors = payload.get("colors")
        track_quantity = payload.get("track_quantity")
        quantity = payload.get("quantity")
        variants = payload.get("variants")
        _configure_variants_for_product(pdata["id"], base_price, sizes, colors, track_quantity, quantity, variants, store=store)
    except Exception:
        pass

    # Publish to all sales channels (best-effort)
    try:
        publish_product_all_channels(pdata["id"], store=store)
    except Exception:
        pass

    # Try to link landing page to product via a product metafield (best-effort)
    try:
        _link_product_landing_page(pdata["id"], page["id"], store=store)
    except Exception:
        pass

    # Publish page to all sales channels (best-effort)
    try:
        publish_page_all_channels(page["id"], store=store)
    except Exception:
        pass

    # Include Shopify CDN image URLs used/attached so the UI can display them later
    return {
        "product_gid": pdata["id"],
        "page_gid": page["id"],
        "url": page_url,
        "image_urls": shopify_image_urls or requested_images or [],
    }


def _build_page_body_html(title: str, landing_copy: dict | None, requested_images: list[str] | None, alt_texts: list[str] | None) -> str:
    """Build final page HTML.

    Updated preference order (to honor rich HTML produced by the model):
    1) If model provided an HTML blob (landing_copy.html), return it as-is (assumed self-contained per contract).
    2) Else, if structured sections are provided, render them and map images from requested_images by index.
    3) Else, fallback to a simple gallery if nothing else is available.
    """
    html_override = (landing_copy or {}).get("html") if landing_copy else None
    if html_override:
        # Trust the model's HTML when provided (prompt requires self-contained, accessible HTML)
        return str(html_override)

    sections = (landing_copy or {}).get("sections") or []
    headline = (landing_copy or {}).get("headline") or title
    subheadline = (landing_copy or {}).get("subheadline") or ""

    # Responsive CSS (embedded). Keep minimal classes and mobile-first layout.
    style_block = (
        "<style>"
        ".lp-container{max-width:1200px;margin:0 auto;padding:0 16px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a;}"
        ".lp-hero{padding:32px 0;text-align:center;background:linear-gradient(90deg,#ff7e5f,#feb47b);border-radius:16px;color:#fff;margin-top:12px;}"
        ".lp-hero h1,.lp-hero h2{margin:0 0 8px;font-size:30px;line-height:1.2;}"
        ".lp-hero p{margin:0;color:#fffbe8;}"
        ".lp-section{display:grid;grid-template-columns:1fr;gap:18px;align-items:center;padding:18px 0;}"
        ".lp-section h3{margin:0 0 8px;font-size:18px;}"
        ".lp-text p{margin:8px 0 0;line-height:1.6;color:#334155;}"
        ".lp-img{position:relative;}"
        ".lp-img img{width:100%;height:auto;border-radius:12px;display:block;box-shadow:0 6px 20px rgba(0,0,0,0.12);}"
        ".lp-img.placeholder{border:1px dashed #cbd5e1;border-radius:12px;min-height:160px;display:flex;align-items:center;justify-content:center;background:radial-gradient(120px 120px at 50% 50%,rgba(0,74,173,.06),transparent 60%);}"
        ".lp-img.placeholder .lp-ph{font-size:12px;color:#64748b;padding:8px 10px;background:#fff;border-radius:10px;box-shadow:0 2px 6px rgba(0,0,0,0.08);}"
        ".lp-grid{display:grid;grid-template-columns:1fr;gap:12px;}"
        ".cols-2{grid-template-columns:1fr 1fr;}"
        ".cols-3{grid-template-columns:1fr 1fr 1fr;}"
        "@media(min-width:768px){.lp-hero h1,.lp-hero h2{font-size:36px;}}"
        "@media(min-width:1024px){.lp-section{grid-template-columns:1fr 1fr;}.lp-section.alt .lp-img{order:2;}}"
        "</style>"
    )

    body_parts: list[str] = [style_block, "<div class=\"lp-container\">", (
        f"<section class=\"lp-hero\"><h2>{headline}</h2>"
        + (f"<p>{subheadline}</p>" if subheadline else "")
        + "</section>"
    )]

    if sections:
        effective_images = requested_images or []
        for idx, sec in enumerate(sections):
            sec_title = sec.get("title") or ""
            sec_body = sec.get("body") or ""
            specified_img = (sec.get("image_url") or "").strip()
            # Prefer Shopify CDN URLs over any non-Shopify URLs specified by the model
            if specified_img and ("cdn.shopify.com" in specified_img):
                img_url = specified_img
            elif effective_images:
                img_url = effective_images[idx % len(effective_images)]
            else:
                img_url = ""
            alt = (alt_texts[idx % len(alt_texts)] if alt_texts else title) if img_url else title
            img_html = (
                f"<div class=\"lp-img\"><img src=\"{img_url}\" alt=\"{alt}\" loading=\"lazy\"/></div>"
                if img_url else
                "<div class=\"lp-img placeholder\"><div class=\"lp-ph\">Click to add image</div></div>"
            )
            text_html = (
                "<div class=\"lp-text\">"
                + (f"<h3>{sec_title}</h3>" if sec_title else "")
                + (f"<p style=\"margin:8px 0 0;line-height:1.6;color:#334155;\">{sec_body}</p>" if sec_body else "")
                + "</div>"
            )
            alt_class = " alt" if (idx % 2 == 1) else ""
            body_parts.append(f"<section class=\"lp-section{alt_class}\">{img_html}{text_html}</section>")
    else:
        # No sections structured. Fallback to responsive gallery only
        effective_images = (requested_images or [])[:10]
        if effective_images:
            imgs = "".join([
                f"<img src=\"{u}\" alt=\"{title}\" loading=\"lazy\" />" for u in effective_images
            ])
            body_parts.append(f"<div class=\"lp-grid cols-3 lp-gallery\">{imgs}</div>")
        else:
            # No images provided → show a row of placeholders to indicate slots
            ph = "".join(["<div class=\"lp-img placeholder\"><div class=\"lp-ph\">Add image</div></div>" for _ in range(3)])
            body_parts.append(f"<div class=\"lp-grid cols-3 lp-gallery\">{ph}</div>")

    body_parts.append("</div>")  # close .lp-container
    return "".join(body_parts)


def create_page_from_copy(title: str, landing_copy: dict, image_urls: list[str] | None = None, alt_texts: list[str] | None = None, body_html_override: str | None = None, *, store: str | None = None) -> dict:
    # Use precomputed body HTML when provided to avoid building large strings twice
    body_html = body_html_override if body_html_override is not None else _build_page_body_html(title, landing_copy, image_urls or [], alt_texts or [])
    # Generate a deterministic-ish base handle from title, and on collision retry with a short suffix
    handle = f"offer-{abs(hash(title)) % 10_000_000}"
    page_in = {
        "title": f"{title} – Offer",
        "handle": handle,
        # PageCreateInput (Admin API 2025-07+) no longer supports a 'published' flag.
        # Pages are created without an explicit publish toggle here.
        "body": body_html,
    }
    try:
        page = _gql_store(store, PAGE_CREATE, {"page": page_in})["pageCreate"]["page"]
    except RuntimeError as e:
        # Handle collision: 'Handle has already been taken' → append a short random suffix and retry once
        if "Handle has already been taken" in str(e):
            from uuid import uuid4
            page_in["handle"] = f"{handle}-{uuid4().hex[:6]}"
            page = _gql_store(store, PAGE_CREATE, {"page": page_in})["pageCreate"]["page"]
        else:
            raise
    cfg = _get_store_config(store)
    page_url = f"https://{cfg['SHOP']}/pages/{page['handle']}"
    # Best-effort publish page so it's visible in Online Store
    try:
        publish_page_all_channels(page["id"], store=store)
    except Exception:
        pass
    return {"page_gid": page["id"], "url": page_url}


def _link_product_landing_page(product_gid: str, page_gid: str, *, store: str | None = None) -> None:
    """Link a page to a product using a product metafield custom.landing_page (type: page_reference)."""
    try:
        _gql_store(store, METAFIELDS_SET, {
            "metafields": [{
                "ownerId": product_gid,
                "namespace": "custom",
                "key": "landing_page",
                "type": "page_reference",
                "value": page_gid,
            }]
        })
        return
    except RuntimeError as e:
        msg = str(e)
        # If definition missing, create and retry once
        if "definition" in msg.lower():
            _gql_store(store, METAFIELD_DEFINITION_CREATE, {
                "definition": {
                    "name": "Landing page",
                    "namespace": "custom",
                    "key": "landing_page",
                    "type": "page_reference",
                    "ownerType": "PRODUCT",
                    "description": "Landing page associated with this product",
                    "visibleToStorefront": True,
                }
            })
            _gql_store(store, METAFIELDS_SET, {
                "metafields": [{
                    "ownerId": product_gid,
                    "namespace": "custom",
                    "key": "landing_page",
                    "type": "page_reference",
                    "value": page_gid,
                }]
            })
            return
        raise


@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, max=8))
def update_product_description(product_gid: str, description_html: str, *, store: str | None = None) -> dict:
    inp = {
        "id": product_gid,
        "descriptionHtml": description_html or ""
    }
    data = _gql_store(store, PRODUCT_UPDATE, {"input": inp})
    prod = data["productUpdate"]["product"]
    return prod


@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, max=8))
def update_product_title(product_gid: str, title: str, *, store: str | None = None) -> dict:
    inp = {
        "id": product_gid,
        "title": title or "Offer"
    }
    data = _gql_store(store, PRODUCT_UPDATE, {"input": inp})
    prod = data["productUpdate"]["product"]
    return prod