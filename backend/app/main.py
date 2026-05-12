from fastapi import FastAPI, UploadFile, Form, File, Request, BackgroundTasks
from fastapi.responses import StreamingResponse, Response
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.gzip import GZipMiddleware
from starlette.concurrency import run_in_threadpool
from fastapi.staticfiles import StaticFiles
from starlette.responses import RedirectResponse
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from uuid import uuid4
from datetime import datetime
import json, os
import base64, hmac, hashlib
from pathlib import Path
from urllib.parse import quote, urlencode

from app.tasks import pipeline_launch, run_pipeline_sync
from app.integrations.openai_client import gen_angles_and_copy, gen_angles_and_copy_full, gen_title_and_description, gen_landing_copy, gen_product_from_image, analyze_landing_page, translate_texts, gen_clean_wholesale_product_image_openai
from app.integrations.openai_client import marketing_strategist, marketing_copywriter, marketing_media_buyer
from app.agent import run_agent_until_final, run_ads_agent
from app.integrations.gemini_client import gen_ad_images_from_image, gen_promotional_images_from_angles, gen_variant_images_from_image, gen_feature_benefit_images
from app.integrations.gemini_client import analyze_variants_from_image, build_feature_benefit_prompts, _compute_midpoint_size_from_product
from app.integrations.shopify_client import create_product_and_page, upload_images_to_product, create_product_only, create_page_from_copy, list_product_images, upload_images_to_product_verbose, upload_image_attachments_to_product, _link_product_landing_page
from app.integrations.shopify_client import configure_variants_for_product
from app.integrations.shopify_client import count_orders_by_title
from app.integrations.shopify_client import get_products_brief, count_paid_orders_by_product_or_variant_processed_batch, count_paid_orders_by_title
from app.integrations.shopify_client import count_orders_by_product_processed
from app.integrations.shopify_client import count_orders_by_product_or_variant_processed, count_orders_by_product_or_variant_processed_batch
from app.integrations.shopify_client import count_orders_and_paid_by_product_or_variant_processed_batch
from app.integrations.shopify_client import list_product_ids_in_collection
from app.integrations.shopify_client import count_orders_by_collection_processed
from app.integrations.shopify_client import count_items_by_collection_processed
from app.integrations.shopify_client import sum_product_order_counts_for_collection
from app.integrations.shopify_client import sum_product_order_counts_for_collection_created
from app.integrations.shopify_client import update_product_description
from app.integrations.shopify_client import update_product_title
from app.integrations.shopify_client import _build_page_body_html
from app.integrations.shopify_client import count_orders_total_processed, count_orders_total_created
from app.integrations.shopify_client import list_orders_with_utms_processed, list_orders_with_utms_processed_multi
from app.integrations.shopify_client import list_orders_open_unfulfilled, cycle_tag, set_cod_tag, has_cod_tag
from app.integrations.meta_client import create_campaign_with_ads
from app.integrations.meta_client import list_saved_audiences
from app.integrations.meta_client import list_active_campaigns_with_insights
from app.integrations.meta_client import get_campaign_summary
from app.integrations.meta_client import get_ad_account_info, set_campaign_status, list_adsets_with_insights, set_adset_status, campaign_daily_insights, list_ad_accounts
from app.integrations.meta_client import list_ads_for_adsets
from app.integrations.meta_client import create_draft_image_campaign
from app.integrations.meta_client import create_draft_carousel_campaign
from app.integrations.meta_client import get_campaign_ad_creatives
from app.integrations.clarity_client import summarize_for_campaign as summarize_clarity_for_campaign
from app.campaign_analyzer import analyze_campaign as run_campaign_analysis, generate_action_tasks as run_action_task_generation
from app.storage import save_file
from app.config import BASE_URL, UPLOADS_DIR, CHATKIT_WORKFLOW_ID
from app.config import SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET, SHOPIFY_OAUTH_SCOPES
from app import db
import re
import threading
import time
import json as _json
import io
import mimetypes
from urllib.parse import urlparse
import logging
import secrets
import requests
import asyncio
from tenacity import RetryError

# Ensure the OAuth-enabled stores are available by default for the known Shopify installs.
# (This env var is checked by shopify_client._oauth_enabled_for_store)
_oauth_stores = (os.getenv("SHOPIFY_OAUTH_STORES") or "").strip()
_default_oauth_stores = ["irrakids", "irranova", "mmd"]
if _oauth_stores:
    existing = [p.strip() for p in _oauth_stores.split(",") if p.strip()]
    existing_lc = {p.lower() for p in existing}
    merged = existing[:]
    for store_name in _default_oauth_stores:
        if store_name not in existing_lc:
            merged.append(store_name)
    os.environ["SHOPIFY_OAUTH_STORES"] = ",".join(merged)
else:
    os.environ["SHOPIFY_OAUTH_STORES"] = ",".join(_default_oauth_stores)

def _canonical_store_label(store: str | None) -> str | None:
    s = (store or "").strip().lower()
    if not s:
        return None
    return "irrakids" if s == "nouralibas" else s

# Optional ChatKit server-mode support
try:
    from chatkit.server import StreamingResult as _CKStreamingResult  # type: ignore
    from app.chatkit_server import build_default_server as _build_ck_server  # type: ignore
    _CHATKIT_ENABLED = True
except Exception:
    _CKStreamingResult = None  # type: ignore
    _build_ck_server = None  # type: ignore
    _CHATKIT_ENABLED = False

app = FastAPI(title="Product Testing OS", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(GZipMiddleware, minimum_size=1024)

# Basic logger for diagnostics (stdout captured by Cloud Run)
logger = logging.getLogger("app.chatkit")
if not logger.handlers:
    logger.addHandler(logging.StreamHandler())
logger.setLevel(logging.INFO)
shopify_logger = logging.getLogger("app.shopify")
if not shopify_logger.handlers:
    shopify_logger.addHandler(logging.StreamHandler())
shopify_logger.setLevel(logging.INFO)

# ---------------- Small in-memory TTL cache (per Cloud Run instance) ----------------
# Avoid duplicate expensive Meta/Shopify calls when the UI triggers the same request multiple
# times within seconds. Best-effort only; caches reset on new instances.
_API_CACHE: dict[str, tuple[float, object]] = {}
_API_CACHE_LOCK = threading.Lock()
_API_INFLIGHT: dict[str, asyncio.Future] = {}
_API_INFLIGHT_LOCK = asyncio.Lock()


def _stable_json(obj: object) -> str:
    try:
        return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)
    except Exception:
        return json.dumps(str(obj), ensure_ascii=False)


def _cache_key(prefix: str, payload: object) -> str:
    return f"{prefix}:{_stable_json(payload)}"


def _cache_get(key: str) -> object | None:
    now = time.time()
    with _API_CACHE_LOCK:
        hit = _API_CACHE.get(key)
        if not hit:
            return None
        exp, val = hit
        if exp and exp > now:
            return val
        # expired
        _API_CACHE.pop(key, None)
        return None


def _cache_set(key: str, ttl_s: int, value: object) -> None:
    try:
        ttl = int(ttl_s or 0)
    except Exception:
        ttl = 0
    if ttl <= 0:
        return
    exp = time.time() + ttl
    with _API_CACHE_LOCK:
        _API_CACHE[key] = (exp, value)
        # Opportunistic trim
        if len(_API_CACHE) > 512:
            try:
                items = sorted(_API_CACHE.items(), key=lambda kv: kv[1][0])
                for k, _ in items[: max(1, len(items) // 5)]:
                    _API_CACHE.pop(k, None)
            except Exception:
                pass


async def _cached(key: str, ttl_s: int, compute):
    """Async cache with in-flight de-duping (multiple callers await the same work)."""
    hit = _cache_get(key)
    if hit is not None:
        return hit

    owner = False
    async with _API_INFLIGHT_LOCK:
        fut = _API_INFLIGHT.get(key)
        if fut is None:
            loop = asyncio.get_running_loop()
            fut = loop.create_future()
            _API_INFLIGHT[key] = fut
            owner = True

    if not owner:
        return await asyncio.shield(fut)

    try:
        val = await compute()
        _cache_set(key, ttl_s, val)
        try:
            fut.set_result(val)
        except Exception:
            pass
        return val
    except BaseException as e:
        try:
            fut.set_exception(e)
        except Exception:
            pass
        raise
    finally:
        async with _API_INFLIGHT_LOCK:
            _API_INFLIGHT.pop(key, None)


def _invalidate_caches_for_status_change():
    """Invalidate all cached data that contains campaign/adset status info.

    Called after a status toggle to ensure the UI shows the updated state
    immediately instead of serving stale cached data.
    """
    try:
        with _API_CACHE_LOCK:
            keys_to_remove = [
                k for k in _API_CACHE
                if any(prefix in k for prefix in (
                    "meta_campaigns",
                    "meta_campaign_adsets",
                    "ads_mgmt_bundle",
                    "meta_campaign_adset_orders",
                ))
            ]
            for k in keys_to_remove:
                _API_CACHE.pop(k, None)
    except Exception:
        pass

# ---------------- Shopify OAuth (public apps) ----------------
_SHOP_RE = re.compile(r"^[a-z0-9][a-z0-9-]*\.myshopify\.com$")


def _extract_shop_domain(raw: str | None) -> str | None:
    """Extract a valid shop domain from user input.

    Accepts inputs like:
      - fdd92b-2e.myshopify.com
      - https://fdd92b-2e.myshopify.com
      - accidental duplicates like fdd92b-2e.myshopify.comfdd92b-2e.myshopify.com
    """
    try:
        s = (raw or "").strip().lower()
        if not s:
            return None
        # strip protocol and path if pasted as URL
        if s.startswith("https://"):
            s = s[8:]
        elif s.startswith("http://"):
            s = s[7:]
        s = s.split("/", 1)[0].split("?", 1)[0].split("#", 1)[0].strip()
        if _SHOP_RE.match(s):
            return s
        # If user pasted garbage or duplicated host, try extracting the first valid host.
        m = re.findall(r"[a-z0-9][a-z0-9-]*\.myshopify\.com", s)
        if not m:
            return None
        # If duplicated, pick the first; if multiple different, reject.
        uniq = []
        for x in m:
            if x not in uniq:
                uniq.append(x)
        if len(uniq) == 1:
            return uniq[0]
        return None
    except Exception:
        return None


def _is_valid_shop_domain(shop: str | None) -> bool:
    try:
        s = (shop or "").strip().lower()
        return bool(_SHOP_RE.match(s))
    except Exception:
        return False


def _shopify_oauth_scopes() -> str:
    # Shopify expects scopes as comma-separated string.
    try:
        s = (SHOPIFY_OAUTH_SCOPES or "").strip()
        return s or "read_orders,write_orders"
    except Exception:
        return "read_orders,write_orders"


def _verify_shopify_hmac(query_params: dict, client_secret: str) -> bool:
    """Verify Shopify callback query HMAC (SHA256 hex) using app client secret.

    Shopify signs all query parameters except "hmac" and "signature".
    """
    try:
        # Practical note: different implementations canonicalize params slightly differently.
        # We validate against both common Shopify canonicalizations to avoid false negatives:
        #  1) decoded pairs (Shopify docs)
        #  2) raw query (preserve encoding) sorted by decoded key (seen in some SDKs)
        from urllib.parse import parse_qsl, unquote_plus

        raw = str((query_params or {}).get("__raw_query__") or "")
        provided = str((query_params or {}).get("hmac") or "").strip()
        secret = str(client_secret or "").strip()
        if not (raw and provided and secret):
            return False

        # Some dashboards display secrets with a prefix (e.g. "shpss_"). In case Shopify signs using
        # the raw secret material only, try both forms.
        secrets_to_try: list[str] = [secret]
        if secret.startswith("shpss_") and len(secret) > 6:
            secrets_to_try.append(secret.split("shpss_", 1)[1])

        def _digest(msg: str, sec: str) -> str:
            return hmac.new(sec.encode("utf-8"), msg.encode("utf-8"), hashlib.sha256).hexdigest()

        pairs = parse_qsl(raw, keep_blank_values=True)

        def _build_dec_message(exclude_keys: set[str] | None = None) -> str:
            ex = exclude_keys or set()
            items_dec: list[tuple[str, str]] = []
            for k, v in pairs:
                if k in ("hmac", "signature"):
                    continue
                if k in ex:
                    continue
                items_dec.append((str(k), str(v)))
            return "&".join([f"{k}={v}" for (k, v) in sorted(items_dec, key=lambda x: x[0])])

        # (1) decoded pairs (Shopify docs). Try with and without "host" (some installs omit it from HMAC).
        msg_dec = _build_dec_message()
        msg_dec_no_host = _build_dec_message({"host"})
        for sec in secrets_to_try:
            if hmac.compare_digest(_digest(msg_dec, sec), provided):
                return True
            if hmac.compare_digest(_digest(msg_dec_no_host, sec), provided):
                return True

        # (2) raw pairs (preserve raw value encoding), sorted by decoded key
        parts = [p for p in raw.split("&") if p]
        items_raw: list[tuple[str, str]] = []
        for p in parts:
            if "=" in p:
                k_raw, v_raw = p.split("=", 1)
            else:
                k_raw, v_raw = p, ""
            try:
                k_dec = unquote_plus(k_raw)
            except Exception:
                k_dec = k_raw
            if k_dec in ("hmac", "signature"):
                continue
            items_raw.append((k_dec, f"{k_raw}={v_raw}"))
        msg_raw = "&".join([kv for (_k, kv) in sorted(items_raw, key=lambda x: x[0])])
        ok = False
        last_dig_dec = ""
        last_dig_raw = ""
        for sec in secrets_to_try:
            last_dig_dec = _digest(msg_dec, sec)
            last_dig_raw = _digest(msg_raw, sec)
            if hmac.compare_digest(last_dig_raw, provided):
                ok = True
                break
        if not ok:
            try:
                # Do not log secrets or full msg; just enough to debug in Cloud Run.
                logger.info(
                    f"[shopify] invalid_hmac shop={query_params.get('shop')} "
                    f"secret_len={len(secret)} msg_dec_len={len(msg_dec)} msg_raw_len={len(msg_raw)} "
                    f"dig_dec_prefix={last_dig_dec[:10]} dig_raw_prefix={last_dig_raw[:10]}"
                )
            except Exception:
                pass
        return ok
    except Exception:
        return False


def _verify_shopify_hmac_request(request: Request, client_secret: str) -> bool:
    """Verify Shopify callback HMAC from the incoming request."""
    try:
        qp = dict(request.query_params)
        qp["__raw_query__"] = request.url.query or ""
        return _verify_shopify_hmac(qp, client_secret)
    except Exception:
        return False


def _abs_base_url(request: Request) -> str:
    """Compute absolute base URL for redirects.

    In production, prefer the current forwarded request host so OAuth callback URLs
    stay aligned with the live domain the user is actually visiting. Fall back to
    BASE_URL when the incoming request looks local or incomplete.
    """
    try:
        configured_base = (BASE_URL or "").strip().rstrip("/")
        host = (request.headers.get("x-forwarded-host") or request.headers.get("host") or "").strip()
        scheme = (request.headers.get("x-forwarded-proto") or request.url.scheme or "https").strip()
        req_base = f"{scheme}://{host}" if host else str(request.base_url).rstrip("/")
        req_base = req_base.rstrip("/")
        req_host_lc = host.lower()
        req_is_public = bool(req_base and req_host_lc and "localhost" not in req_host_lc and "127.0.0.1" not in req_host_lc)
        if req_is_public:
            return req_base
        if configured_base:
            return configured_base
        return req_base
    except Exception:
        return (BASE_URL or "").rstrip("/")


def _oauth_state_secret() -> bytes:
    # Use a stable secret for signing OAuth state tokens.
    sec = (os.getenv("OAUTH_STATE_SECRET", "") or os.getenv("JWT_SECRET", "") or SHOPIFY_CLIENT_SECRET or "").strip()
    if not sec:
        # Dev-only fallback; production should set OAUTH_STATE_SECRET or JWT_SECRET
        sec = "dev-oauth-state-secret"
    return sec.encode("utf-8")


def _issue_shopify_state(payload: dict) -> str:
    msg = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    body = _b64u_encode(msg)
    sig = _b64u_encode(hmac.new(_oauth_state_secret(), body.encode("ascii"), hashlib.sha256).digest())
    return f"{body}.{sig}"


def _verify_shopify_state(token: str) -> dict | None:
    try:
        tok = (token or "").strip()
        if not tok or "." not in tok:
            return None
        body, sig = tok.split(".", 1)
        exp_sig = _b64u_encode(hmac.new(_oauth_state_secret(), body.encode("ascii"), hashlib.sha256).digest())
        if not hmac.compare_digest(exp_sig, sig):
            return None
        payload = json.loads(_b64u_decode(body).decode("utf-8"))
        if not isinstance(payload, dict):
            return None
        # exp check (unix seconds)
        try:
            exp = int(payload.get("exp") or 0)
            if exp and int(time.time()) > exp:
                return None
        except Exception:
            return None
        return payload
    except Exception:
        return None

# Mount static uploads directory. Use the unified path from config.
Path(UPLOADS_DIR).mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=UPLOADS_DIR), name="uploads")

# Normalize Meta ad account IDs passed from clients (accepts either numeric or 'act_123...').
def _normalize_ad_acct_id(acct: str | None) -> str | None:
    try:
        s = str(acct or '').strip()
        if not s:
            return None
        if s.lower().startswith('act_'):
            s = s.split('_', 1)[1]
        return s
    except Exception:
        return acct

# Serve a minimal favicon to avoid 404 noise
@app.get("/favicon.ico")
async def favicon():
    # 1x1 PNG (transparent)
    import base64
    png_b64 = (
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGMAAQAABQAB"
        "J9mXqQAAAABJRU5ErkJggg=="
    )
    data = base64.b64decode(png_b64)
    return Response(content=data, media_type="image/png")


@app.get("/api/shopify/oauth/status")
async def api_shopify_oauth_status(request: Request, store: str | None = None):
    """Return whether we have a stored OAuth token for this store label."""
    try:
        store = _canonical_store_label(store)
        rec = db.get_app_setting(store, "shopify_oauth") or {}
        if not isinstance(rec, dict):
            rec = {}
        tok = str(rec.get("access_token") or "").strip()
        shop = str(rec.get("shop") or "").strip()
        base_url = _abs_base_url(request)
        return {
            "data": {
                "connected": bool(tok and shop),
                "shop": (shop or None),
                "scopes": rec.get("scopes"),
                "base_url": (base_url or None),
                "callback_url": (f"{base_url}/api/shopify/oauth/callback" if base_url else None),
            }
        }
    except Exception as e:
        return {"error": str(e), "data": {"connected": False}}


@app.get("/api/shopify/debug/status")
async def api_shopify_debug_status(store: str | None = None):
    """Safe Shopify health probe for debugging store/token/API latency.

    Does not return access tokens or secrets.
    """
    store = _canonical_store_label(store)
    started = time.perf_counter()
    data: dict[str, Any] = {
        "store": store,
        "oauth_connected": False,
        "oauth_shop": None,
        "oauth_scopes": None,
        "resolved_shop": None,
        "api_version": None,
        "has_token": False,
        "shop_probe": None,
        "elapsed_ms": None,
    }
    try:
        rec = db.get_app_setting(store, "shopify_oauth") or {}
        if isinstance(rec, dict):
            tok = str(rec.get("access_token") or "").strip()
            shop = str(rec.get("shop") or "").strip()
            data["oauth_connected"] = bool(tok and shop)
            data["oauth_shop"] = shop or None
            data["oauth_scopes"] = rec.get("scopes")
    except Exception as e:
        data["oauth_error"] = str(e)

    try:
        from app.integrations.shopify_client import _get_store_config
        cfg = _get_store_config(store)
        data["resolved_shop"] = cfg.get("SHOP")
        data["api_version"] = cfg.get("API_VERSION")
        data["has_token"] = bool(cfg.get("TOKEN"))
        auth = None
        if not cfg.get("TOKEN") and cfg.get("API_KEY") and cfg.get("PASSWORD"):
            auth = (cfg.get("API_KEY"), cfg.get("PASSWORD"))
        probe_started = time.perf_counter()
        resp = requests.get(
            f"{cfg.get('BASE')}/shop.json",
            headers=cfg.get("HEADERS") or {},
            timeout=8,
            auth=auth,
        )
        probe_ms = int((time.perf_counter() - probe_started) * 1000)
        body: dict[str, Any] = {}
        try:
            body = resp.json() if resp.content else {}
        except Exception:
            body = {}
        shop_info = (body or {}).get("shop") or {}
        data["shop_probe"] = {
            "ok": 200 <= int(resp.status_code) < 300,
            "status": int(resp.status_code),
            "elapsed_ms": probe_ms,
            "call_limit": resp.headers.get("X-Shopify-Shop-Api-Call-Limit"),
            "retry_after": resp.headers.get("Retry-After"),
            "shop_name": shop_info.get("name"),
            "myshopify_domain": shop_info.get("myshopify_domain"),
            "iana_timezone": shop_info.get("iana_timezone"),
        }
    except Exception as e:
        data["shop_probe"] = {
            "ok": False,
            "error": str(e),
        }
    finally:
        data["elapsed_ms"] = int((time.perf_counter() - started) * 1000)
    return {"data": data}


@app.get("/api/shopify/debug/order_search")
async def api_shopify_debug_order_search(
    store: str | None = None,
    product_id: str | None = None,
    start: str | None = None,
    end: str | None = None,
):
    """Safe Shopify order-search probe for product/date query debugging.

    Returns status, latency, and small order samples. Does not return tokens.
    """
    store = _canonical_store_label(store)
    pid = str(product_id or "").strip()
    if not pid.isdigit():
        return {"error": "product_id must be a numeric Shopify product or variant id", "data": {}}
    try:
        from datetime import timedelta
        today = datetime.utcnow().date()
        s_date = (start or str(today - timedelta(days=7))).split("T")[0]
        e_date = (end or str(today)).split("T")[0]
    except Exception:
        s_date = (start or "").split("T")[0]
        e_date = (end or "").split("T")[0]

    def _run_probe():
        from app.integrations.shopify_client import _get_store_config
        cfg = _get_store_config(store)
        auth = None
        if not cfg.get("TOKEN") and cfg.get("API_KEY") and cfg.get("PASSWORD"):
            auth = (cfg.get("API_KEY"), cfg.get("PASSWORD"))

        gql = """
        query DebugOrdersForProduct($query: String!, $first: Int!, $after: String) {
          orders(first: $first, after: $after, query: $query, sortKey: PROCESSED_AT) {
            edges {
              cursor
              node {
                id
                name
                processedAt
                cancelledAt
                closedAt
                displayFinancialStatus
                lineItems(first: 20) {
                  nodes {
                    name
                    quantity
                    product { id }
                    variant { id }
                  }
                }
              }
            }
            pageInfo { hasNextPage endCursor }
          }
        }
        """
        variants = [
            {
                "label": "current_grouped_dates",
                "query": f'product_id:"{pid}" (processed_at:>="{s_date}" AND processed_at:<="{e_date}")',
            },
            {
                "label": "separate_quoted_dates",
                "query": f'product_id:"{pid}" processed_at:>="{s_date}" processed_at:<="{e_date}"',
            },
            {
                "label": "separate_unquoted_dates",
                "query": f"product_id:{pid} processed_at:>={s_date} processed_at:<={e_date}",
            },
            {
                "label": "paid_grouped_dates",
                "query": f'product_id:"{pid}" (processed_at:>="{s_date}" AND processed_at:<="{e_date}") financial_status:"paid"',
            },
            {
                "label": "date_window_only",
                "query": f'(processed_at:>="{s_date}" AND processed_at:<="{e_date}")',
            },
        ]

        def _one_variant(item: dict[str, str]) -> dict[str, Any]:
            started = time.perf_counter()
            after = None
            pages = 0
            total = 0
            sample: list[dict[str, Any]] = []
            call_limit = None
            try:
                while pages < 3:
                    resp = requests.post(
                        cfg.get("GQL"),
                        headers=cfg.get("HEADERS") or {},
                        json={"query": gql, "variables": {"query": item["query"], "first": 50, "after": after}},
                        timeout=12,
                        auth=auth,
                    )
                    call_limit = resp.headers.get("X-Shopify-Shop-Api-Call-Limit") or resp.headers.get("x-shopify-shop-api-call-limit")
                    if resp.status_code >= 400:
                        return {
                            "label": item["label"],
                            "ok": False,
                            "status": resp.status_code,
                            "elapsed_ms": int((time.perf_counter() - started) * 1000),
                            "call_limit": call_limit,
                            "error": (resp.text or "")[:500],
                        }
                    payload = resp.json() if resp.content else {}
                    if payload.get("errors"):
                        return {
                            "label": item["label"],
                            "ok": False,
                            "status": resp.status_code,
                            "elapsed_ms": int((time.perf_counter() - started) * 1000),
                            "call_limit": call_limit,
                            "error": payload.get("errors"),
                        }
                    conn = ((payload.get("data") or {}).get("orders") or {})
                    edges = conn.get("edges") or []
                    pages += 1
                    for edge in edges:
                        node = ((edge or {}).get("node") or {})
                        if node.get("cancelledAt"):
                            continue
                        total += 1
                        if len(sample) < 5:
                            line_items: list[dict[str, Any]] = []
                            try:
                                for li in ((((node.get("lineItems") or {}).get("nodes") or []))[:20]):
                                    product_gid = (((li or {}).get("product") or {}).get("id") or "")
                                    variant_gid = (((li or {}).get("variant") or {}).get("id") or "")
                                    line_items.append({
                                        "name": (li or {}).get("name"),
                                        "quantity": (li or {}).get("quantity"),
                                        "product_id": str(product_gid).split("/")[-1] if product_gid else None,
                                        "variant_id": str(variant_gid).split("/")[-1] if variant_gid else None,
                                    })
                            except Exception:
                                line_items = []
                            sample.append({
                                "id": node.get("id"),
                                "name": node.get("name"),
                                "processed_at": node.get("processedAt"),
                                "closed_at": node.get("closedAt"),
                                "financial_status": node.get("displayFinancialStatus"),
                                "line_items": line_items,
                            })
                    page_info = conn.get("pageInfo") or {}
                    if not page_info.get("hasNextPage"):
                        break
                    after = page_info.get("endCursor")
                    if not after:
                        break
                return {
                    "label": item["label"],
                    "ok": True,
                    "status": 200,
                    "elapsed_ms": int((time.perf_counter() - started) * 1000),
                    "call_limit": call_limit,
                    "pages_checked": pages,
                    "partial_count": total,
                    "has_more": bool(after),
                    "sample": sample,
                }
            except Exception as e:
                return {
                    "label": item["label"],
                    "ok": False,
                    "elapsed_ms": int((time.perf_counter() - started) * 1000),
                    "call_limit": call_limit,
                    "error": str(e),
                }

        return {
            "store": store,
            "resolved_shop": cfg.get("SHOP"),
            "api_version": cfg.get("API_VERSION"),
            "product_id": pid,
            "start": s_date,
            "end": e_date,
            "results": [_one_variant(v) for v in variants],
        }

    try:
        data = await run_in_threadpool(_run_probe)
        return {"data": data}
    except Exception as e:
        return {"error": str(e), "data": {}}


def _oauth_enabled_store_labels() -> set[str]:
    raw = (os.getenv("SHOPIFY_OAUTH_STORES") or "").strip()
    if not raw:
        return set()
    return {part.strip().lower() for part in raw.split(",") if part.strip()}


def _get_shopify_oauth_credentials(store: str) -> tuple[str, str]:
    """Return OAuth credentials for a store.

    For stores explicitly enabled for OAuth, require store-specific credentials so we never
    accidentally redirect a merchant into the wrong Shopify app.
    """
    store_label = (store or "").strip()
    store_upper = store_label.upper()
    store_client_id = os.getenv(f"SHOPIFY_CLIENT_ID_{store_upper}") or ""
    store_client_secret = os.getenv(f"SHOPIFY_CLIENT_SECRET_{store_upper}") or ""

    if store_label.lower() in _oauth_enabled_store_labels():
        return store_client_id, store_client_secret

    client_id = store_client_id or SHOPIFY_CLIENT_ID
    client_secret = store_client_secret or SHOPIFY_CLIENT_SECRET
    return client_id, client_secret


@app.get("/api/shopify/oauth/start")
async def api_shopify_oauth_start(request: Request, store: str, shop: str):
    """Redirect to Shopify OAuth install screen for the given shop.

    Usage:
      /api/shopify/oauth/start?store=irranova&shop=your-shop.myshopify.com
    """
    try:
        store_label = (store or "").strip()
        if not store_label:
            return {"error": "missing_store"}
            
        client_id, client_secret = _get_shopify_oauth_credentials(store_label)
        if not (client_id and client_secret):
            store_upper = store_label.upper()
            return {
                "error": "missing_shopify_client_credentials",
                "store": store_label,
                "required_env": [
                    f"SHOPIFY_CLIENT_ID_{store_upper}",
                    f"SHOPIFY_CLIENT_SECRET_{store_upper}",
                ],
            }
            
        shop = _extract_shop_domain(shop)
        if not _is_valid_shop_domain(shop or ""):
            return {"error": "invalid_shop_domain"}

        # state/nonce to prevent CSRF (signed token, no server-side session required)
        exp = int(time.time()) + 10 * 60
        state = _issue_shopify_state({
            "store": store_label,
            "shop": shop,
            "nonce": secrets.token_urlsafe(16),
            "iat": int(time.time()),
            "exp": exp,
        })

        base_url = _abs_base_url(request)
        redirect_uri = f"{base_url}/api/shopify/oauth/callback"
        try:
            logger.info(f"[shopify] OAuth start store={store_label} shop={shop} base_url={base_url} redirect_uri={redirect_uri}")
        except Exception:
            pass
        scopes = _shopify_oauth_scopes()
        params = {
            "client_id": client_id,
            "scope": scopes,
            "redirect_uri": redirect_uri,
            "state": state,
        }
        url = f"https://{shop}/admin/oauth/authorize?{urlencode(params)}"
        return RedirectResponse(url=url, status_code=302)
    except Exception as e:
        return {"error": str(e)}


@app.get("/api/shopify/oauth/callback")
async def api_shopify_oauth_callback(request: Request):
    """OAuth callback endpoint. Shopify redirects here with code/shop/hmac/state."""
    try:
        qp = dict(request.query_params)
        shop = str(qp.get("shop") or "").strip().lower()
        state = str(qp.get("state") or "").strip()
        code = str(qp.get("code") or "").strip()

        st = _verify_shopify_state(state)
        if not st:
            return {"error": "invalid_state"}
        store_label = str(st.get("store") or "").strip()
        if not store_label:
            return {"error": "missing_store_in_state"}
            
        client_id, client_secret = _get_shopify_oauth_credentials(store_label)
        if not (client_id and client_secret):
            store_upper = store_label.upper()
            return {
                "error": "missing_shopify_client_credentials",
                "store": store_label,
                "required_env": [
                    f"SHOPIFY_CLIENT_ID_{store_upper}",
                    f"SHOPIFY_CLIENT_SECRET_{store_upper}",
                ],
            }
            
        if not _is_valid_shop_domain(shop):
            return {"error": "invalid_shop_domain"}
        if not (state and code):
            return {"error": "missing_state_or_code"}
        # Log if shop doesn't match (Shopify can remap domains), but don't block
        if st.get("shop") and str(st.get("shop")).strip().lower() != shop:
            try:
                logger.warning(f"[shopify] Shop domain changed during OAuth: expected={st.get('shop')} got={shop} store={store_label}")
            except Exception:
                pass

        # Verify Shopify HMAC (recommended). If this fails in your environment, you can temporarily bypass
        # it for internal installs by setting SHOPIFY_OAUTH_SKIP_HMAC=1.
        hmac_ok = _verify_shopify_hmac_request(request, client_secret)
        if not hmac_ok:
            skip = (os.getenv("SHOPIFY_OAUTH_SKIP_HMAC", "") or "").strip().lower() in ("1", "true", "yes", "y")
            if not skip:
                # Return lightweight debug info (no secrets) to help diagnose env/encoding issues.
                try:
                    qp_dbg = dict(request.query_params)
                    qp_dbg["__raw_query__"] = request.url.query or ""
                    raw = qp_dbg.get("__raw_query__") or ""
                    return {
                        "error": "invalid_hmac",
                        "shop": qp_dbg.get("shop"),
                        "keys": sorted([k for k in qp_dbg.keys() if k != "hmac"]),
                        "raw_len": len(str(raw)),
                    }
                except Exception:
                    return {"error": "invalid_hmac"}
            # Skip enabled: proceed, but log loudly.
            try:
                logger.warning(f"[shopify] HMAC verification skipped for shop={shop} store={store_label}")
            except Exception:
                pass

        # Exchange code for token
        token_url = f"https://{shop}/admin/oauth/access_token"
        resp = requests.post(token_url, json={
            "client_id": client_id,
            "client_secret": client_secret,
            "code": code,
        }, timeout=30)
        resp.raise_for_status()
        data = resp.json() if resp.content else {}
        access_token = str((data or {}).get("access_token") or "").strip()
        scopes = (data or {}).get("scope") or (data or {}).get("scopes") or None
        if not access_token:
            return {"error": "missing_access_token_from_shopify", "details": data}

        # Persist per-store
        rec = {
            "shop": shop,
            "access_token": access_token,
            "scopes": scopes,
            "installed_at": int(time.time()),
        }
        db.set_app_setting(store_label, "shopify_oauth", rec)

        # Redirect back to frontend connect page if present; otherwise show JSON
        return RedirectResponse(url=f"/shopify-connect?store={quote(store_label)}&connected=1", status_code=302)
    except requests.HTTPError as e:
        try:
            txt = e.response.text if getattr(e, "response", None) is not None else str(e)
        except Exception:
            txt = str(e)
        return {"error": "token_exchange_failed", "details": txt}
    except Exception as e:
        return {"error": str(e)}

# Initialize ChatKit server (server-mode) if package is available
chatkit_server = None
if _CHATKIT_ENABLED:
    try:
        CK_DB_PATH = os.getenv("CHATKIT_SQLITE_PATH", str(Path(UPLOADS_DIR) / "chatkit.sqlite"))
        CK_FILES_DIR = os.getenv("CHATKIT_FILES_DIR", str(Path(UPLOADS_DIR) / "chatkit_files"))
        Path(CK_FILES_DIR).mkdir(parents=True, exist_ok=True)
        chatkit_server = _build_ck_server(CK_DB_PATH, CK_FILES_DIR)
    except Exception:
        chatkit_server = None

class VariantInput(BaseModel):
    size: Optional[str] = None
    color: Optional[str] = None
    price: Optional[float] = None
    sku: Optional[str] = None
    barcode: Optional[str] = None
    quantity: Optional[int] = None
    track_quantity: Optional[bool] = None


class ProductInput(BaseModel):
    title: Optional[str] = None
    base_price: Optional[float] = None
    currency: str = "MAD"
    audience: str
    benefits: List[str]
    pain_points: List[str]
    sizes: Optional[List[str]] = None
    colors: Optional[List[str]] = None
    product_type: Optional[str] = None
    # UI: gender/target category selector (girl, boy, unisex_kids, men, women, unisex)
    target_category: Optional[str] = None
    niche: Optional[str] = None
    targeting: Optional[dict] = None
    advantage_plus: Optional[bool] = True
    adset_budget: Optional[float] = None
    # Optional variant descriptions provided/approved by user (used for image prompts)
    variant_descriptions: Optional[list[dict]] = None
    # Inventory/variant config
    track_quantity: Optional[bool] = True
    quantity: Optional[int] = None
    variants: Optional[List[VariantInput]] = None

# ---------------- App-wide Prompt Defaults ----------------
class PromptsUpdate(BaseModel):
    angles_prompt: Optional[str] = None
    title_desc_prompt: Optional[str] = None
    landing_copy_prompt: Optional[str] = None
    gemini_ad_prompt: Optional[str] = None
    gemini_variant_style_prompt: Optional[str] = None


@app.get("/api/prompts")
async def api_get_prompts():
    try:
        return db.get_app_prompts()
    except Exception as e:
        return {"error": str(e), "data": {}}


@app.post("/api/prompts")
async def api_set_prompts(req: PromptsUpdate):
    try:
        patch = {k: v for k, v in (req.model_dump().items()) if v is not None}
        out = db.set_app_prompts(patch)
        return out
    except Exception as e:
        return {"error": str(e)}

@app.post("/api/tests")
async def create_test(
    request: Request,
    audience: str = Form(...),
    benefits: str = Form(...),
    pain_points: str = Form(...),
    base_price: Optional[float] = Form(None),
    title: Optional[str] = Form(None),
    images: List[UploadFile] = File([]),
    sizes: Optional[str] = Form(None),
    colors: Optional[str] = Form(None),
    targeting: Optional[str] = Form(None),
    advantage_plus: Optional[bool] = Form(True),
    adset_budget: Optional[float] = Form(9.0),
    model: Optional[str] = Form(None),
    angles_prompt: Optional[str] = Form(None),
    title_desc_prompt: Optional[str] = Form(None),
    landing_copy_prompt: Optional[str] = Form(None),
):
    test_id = str(uuid4())
    payload = ProductInput(
        title=title,
        base_price=base_price,
        audience=audience,
        benefits=json.loads(benefits),
        pain_points=json.loads(pain_points),
        adset_budget=adset_budget,
    ).model_dump()
    # Optional variants (sizes/colors) if provided
    try:
        if sizes:
            payload["sizes"] = [s for s in (json.loads(sizes) or []) if isinstance(s, str) and s.strip()]
    except Exception:
        pass
    try:
        if colors:
            payload["colors"] = [c for c in (json.loads(colors) or []) if isinstance(c, str) and c.strip()]
    except Exception:
        pass
    if model:
        payload["model"] = model
    # Optional prompt overrides from UI "Prompts" tab
    if angles_prompt:
        payload["angles_prompt"] = angles_prompt
    if title_desc_prompt:
        payload["title_desc_prompt"] = title_desc_prompt
    if landing_copy_prompt:
        payload["landing_copy_prompt"] = landing_copy_prompt
    # Optional targeting controls for Meta
    if targeting:
        try:
            payload["targeting"] = json.loads(targeting)
        except Exception:
            # If invalid JSON, ignore and keep default backend targeting
            pass
    if advantage_plus is not None:
        payload["advantage_plus"] = bool(advantage_plus)

    # Save uploaded images (if any) and include absolute URLs in payload
    uploaded_urls: List[str] = []
    # Determine base URL: prefer env BASE_URL if set, otherwise derive from request
    # Build absolute base from forwarded headers to preserve https scheme on Cloud Run
    f_proto = request.headers.get("x-forwarded-proto")
    f_host = request.headers.get("x-forwarded-host")
    host = f_host or request.headers.get("host")
    scheme = f_proto or request.url.scheme
    req_base = f"{scheme}://{host}" if host else str(request.base_url).rstrip("/")
    # Prefer explicit BASE_URL only if it's non-local; otherwise use computed base
    if BASE_URL and ("localhost" not in BASE_URL and "127.0.0.1" not in BASE_URL):
        abs_base = BASE_URL.rstrip("/")
    else:
        abs_base = req_base
    for i, f in enumerate(images or []):
        filename = f"{test_id}_{i}_{f.filename}"
        url_path = save_file(filename, await f.read())  # returns /uploads/...
        # Construct absolute, URL-encoded URL so external services can fetch it directly (no redirects)
        encoded_path = quote(url_path, safe="/:")
        if abs_base.endswith("/"):
            uploaded_urls.append(f"{abs_base[:-1]}{encoded_path}")
        else:
            uploaded_urls.append(f"{abs_base}{encoded_path}")

    if uploaded_urls:
        payload["uploaded_images"] = uploaded_urls

    # Persist initial queued test
    db.create_test_row(test_id, payload)

    # Run synchronously by default unless USE_CELERY is explicitly enabled
    use_celery = os.getenv("USE_CELERY", "false").lower() in ("1", "true", "yes")
    if not use_celery:
        import threading
        threading.Thread(target=run_pipeline_sync, args=(test_id, payload), daemon=True).start()
    else:
        try:
            pipeline_launch.delay(test_id, payload)
        except Exception:
            # If enqueue fails (e.g., no broker), fall back to sync so tests aren't stuck
            import threading
            threading.Thread(target=run_pipeline_sync, args=(test_id, payload), daemon=True).start()

    return {"test_id": test_id, "status": "queued"}


@app.get("/api/tests/{test_id}")
async def get_test(test_id: str, slim: bool | None = False):
    t = db.get_test(test_id)
    if not t:
        return {"error": "not_found"}
    if slim:
        # Return only minimal fields needed for Studio hydration
        return {
            "id": t.get("id"),
            "status": t.get("status"),
            "page_url": t.get("page_url"),
            "created_at": t.get("created_at"),
            "payload": t.get("payload"),
        }
    return t


@app.get("/api/tests")
async def list_tests(limit: int | None = None):
    try:
        # Cap and default limit to keep payload small and fast
        eff_limit = min(max(limit or 48, 1), 100)
        items = db.list_tests_light(limit=eff_limit)

        # Quick regex to find first Shopify CDN image URL without parsing large JSON
        shopify_re = re.compile(r"https://cdn\\.shopify\\.com[^\s\"']+", re.IGNORECASE)

        slim: list[dict] = []
        for it in items:
            image: str | None = None
            try:
                rj = it.get("result_json") or ""
                m = shopify_re.search(rj)
                if m:
                    image = m.group(0)
            except Exception:
                image = None
            # If not found in result, try payload (e.g., saved flow nodes)
            if not image:
                try:
                    pj = it.get("payload_json") or ""
                    m2 = shopify_re.search(pj)
                    if m2:
                        image = m2.group(0)
                except Exception:
                    image = None

            # As a last resort, if still no image, try explicit 'card_image' in payload
            if not image:
                try:
                    p_explicit = it.get("payload_json")
                    if p_explicit:
                        p_obj = json.loads(p_explicit)
                        ci = (p_obj or {}).get("card_image")
                        if isinstance(ci, str) and ci.startswith("https://cdn.shopify.com"):
                            image = ci
                except Exception:
                    pass

            # Extract only the minimal title from payload
            title_only = None
            try:
                p_raw = it.get("payload_json")
                if p_raw:
                    p = json.loads(p_raw)
                    if isinstance(p, dict):
                        title_only = {"title": p.get("title")}
            except Exception:
                title_only = None

            slim.append({
                "id": it.get("id"),
                "status": it.get("status"),
                "page_url": it.get("page_url"),
                "created_at": it.get("created_at"),
                "payload": title_only,
                # Only expose Shopify-hosted images; never local uploads
                "card_image": image,
            })
        return {"data": slim}
    except Exception as e:
        return {"error": str(e), "data": []}


@app.get("/api/meta/audiences")
async def get_saved_audiences():
    try:
        items = list_saved_audiences()
        return {"data": items}
    except Exception as e:
        return {"error": str(e), "data": []}


@app.get("/api/meta/campaigns")
async def get_meta_campaigns(date_preset: str | None = None, ad_account: str | None = None, store: str | None = None, start: str | None = None, end: str | None = None, profit_only: bool | None = False):
    """Return active campaigns with key metrics.

    Query params:
      - date_preset: e.g., 'last_7d', 'last_14d', 'this_month', 'last_30d'
    """
    try:
        acct = _normalize_ad_acct_id(ad_account)
        if not acct:
            try:
                conf = db.get_app_setting(store, "meta_ad_account")
                acct = _normalize_ad_acct_id(((conf or {}).get("id") if isinstance(conf, dict) else None))
            except Exception:
                acct = None
        key = _cache_key("meta_campaigns", {"acct": acct or None, "date_preset": date_preset or "last_7d", "start": start or None, "end": end or None, "store": store or None, "profit_only": bool(profit_only)})

        async def _compute():
            return await run_in_threadpool(
                list_active_campaigns_with_insights,
                date_preset or "last_7d",
                ad_account_id=(acct or None),
                since=start,
                until=end,
                profit_only=bool(profit_only),
            )

        items = await _cached(key, 30, _compute)
        return {"data": items}
    except Exception as e:
        # Unwrap tenacity RetryError to expose the underlying API error message
        try:
            from tenacity import RetryError  # type: ignore
            if isinstance(e, RetryError):
                try:
                    cause = e.last_attempt.exception()  # type: ignore[attr-defined]
                    return {"error": str(cause), "data": []}
                except Exception:
                    pass
        except Exception:
            pass
        return {"error": str(e), "data": []}


class OrdersCountRequest(BaseModel):
    names: list[str]
    start: str  # ISO date/time or YYYY-MM-DD
    end: str    # ISO date/time or YYYY-MM-DD
    store: Optional[str] = None
    include_closed: Optional[bool] = None
    date_field: Optional[str] = None  # 'processed' | 'created'


@app.post("/api/shopify/orders_count_by_title")
async def api_orders_count_by_title(req: OrdersCountRequest):
    started = time.perf_counter()
    try:
        start = req.start
        end = req.end
        store = _canonical_store_label(req.store)
        include_closed = bool(req.include_closed) if req.include_closed is not None else False
        raw_names = [str(x or "").strip() for x in (req.names or []) if str(x or "").strip()]
        # Guardrails: keep requests bounded even if UI sends a lot
        if len(raw_names) > 400:
            raw_names = raw_names[:400]
        # Normalize for cache hit rate: de-duplicate + stable sort
        names = sorted(set(raw_names))
        if not names:
            return {"data": {}}

        df = (req.date_field or "processed").lower()
        key = _cache_key("shopify_orders_count_by_title", {
            "store": store or None,
            "start": start,
            "end": end,
            "include_closed": include_closed,
            "date_field": df,
            "names": names,
        })

        def _compute_sync():
            out: dict[str, int] = {n: 0 for n in names}
            numeric = [n for n in names if n.isdigit()]
            non_numeric = [n for n in names if not n.isdigit()]

            if numeric:
                s_date = (start or "").split("T")[0] if isinstance(start, str) and "-" in start else (start or "")
                e_date = (end or "").split("T")[0] if isinstance(end, str) and "-" in end else (end or "")
                try:
                    if df == "created":
                        for n in numeric:
                            try:
                                out[n] = count_orders_by_title(n, start, end, store=store, include_closed=include_closed)
                            except Exception:
                                out[n] = 0
                    else:
                        batch = count_orders_by_product_or_variant_processed_batch(numeric, s_date, e_date, store=store, include_closed=include_closed)
                        for k, v in (batch or {}).items():
                            out[k] = int(v or 0)
                except Exception:
                    for n in numeric:
                        try:
                            out[n] = count_orders_by_product_or_variant_processed(n, s_date, e_date, store=store, include_closed=include_closed)
                        except Exception:
                            out[n] = 0

            for n in non_numeric:
                try:
                    out[n] = count_orders_by_title(n, start, end, store=store, include_closed=include_closed)
                except Exception:
                    out[n] = 0
            return out

        async def _compute():
            return await run_in_threadpool(_compute_sync)

        out = await asyncio.wait_for(_cached(key, 60, _compute), timeout=28)
        shopify_logger.info(
            "shopify.orders_count_by_title store=%s ids=%s date_field=%s elapsed_ms=%s",
            store,
            len(names),
            df,
            int((time.perf_counter() - started) * 1000),
        )
        # Ensure any original names get a value (including duplicates/truncation)
        shaped: dict[str, int] = {}
        for n in raw_names:
            shaped[n] = int((out or {}).get(n, 0) or 0)
        return {"data": shaped}
    except asyncio.TimeoutError:
        shopify_logger.warning(
            "shopify.orders_count_by_title timeout store=%s names=%s elapsed_ms=%s",
            getattr(req, "store", None),
            len(getattr(req, "names", []) or []),
            int((time.perf_counter() - started) * 1000),
        )
        return {"error": "shopify_orders_count_timeout", "data": {}}
    except Exception as e:
        return {"error": str(e), "data": {}}


@app.post("/api/shopify/orders_count_paid_by_title")
async def api_orders_count_paid_by_title(req: OrdersCountRequest):
    """Count PAID orders for numeric product/variant IDs (and return 0 for non-numeric names).

    Matches the signature of /api/shopify/orders_count_by_title but filters orders by financial_status paid.
    """
    try:
        start = req.start
        end = req.end
        store = _canonical_store_label(req.store)
        include_closed = bool(req.include_closed) if req.include_closed is not None else True
        raw_names = [str(x or "").strip() for x in (req.names or []) if str(x or "").strip()]
        if len(raw_names) > 400:
            raw_names = raw_names[:400]
        names = sorted(set(raw_names))

        df = (req.date_field or "processed").lower()
        key = _cache_key("shopify_orders_count_paid_by_title", {
            "store": store or None,
            "start": start,
            "end": end,
            "include_closed": include_closed,
            "date_field": df,
            "names": names,
        })

        def _compute_sync():
            out: dict[str, int] = {n: 0 for n in names}
            numeric = [n for n in names if n.isdigit()]
            non_numeric = [n for n in names if not n.isdigit()]

            if numeric:
                s_date = (start or "").split("T")[0] if isinstance(start, str) and "-" in start else (start or "")
                e_date = (end or "").split("T")[0] if isinstance(end, str) and "-" in end else (end or "")
                try:
                    if df == "created":
                        for n in numeric:
                            try:
                                out[n] = count_paid_orders_by_title(n, start, end, store=store, include_closed=include_closed)
                            except Exception:
                                out[n] = 0
                    else:
                        batch = count_paid_orders_by_product_or_variant_processed_batch(numeric, s_date, e_date, store=store, include_closed=include_closed)
                        for k, v in (batch or {}).items():
                            out[k] = int(v or 0)
                except Exception:
                    # Best-effort fallback: per-id created-at scan
                    for n in numeric:
                        try:
                            out[n] = count_paid_orders_by_title(n, start, end, store=store, include_closed=include_closed)
                        except Exception:
                            out[n] = 0

            # Ignore textual names entirely (0) to avoid accidental broad matches
            for n in non_numeric:
                out[n] = 0
            return out

        async def _compute():
            return await run_in_threadpool(_compute_sync)

        out = await _cached(key, 60, _compute)
        shaped: dict[str, int] = {}
        for n in raw_names:
            shaped[n] = int((out or {}).get(n, 0) or 0)
        return {"data": shaped}
    except Exception as e:
        return {"error": str(e), "data": {}}


class ProductsBriefRequest(BaseModel):
    ids: list[str]
    store: Optional[str] = None


@app.post("/api/shopify/products_brief")
async def api_products_brief(req: ProductsBriefRequest):
    started = time.perf_counter()
    try:
        ids_raw = [str(x or "").strip() for x in (req.ids or []) if str(x or "").strip()]
        ids = sorted(set(ids_raw))
        if not ids:
            return {"data": {}}
        store = _canonical_store_label(req.store)
        key = _cache_key("shopify_products_brief", {"store": store or None, "ids": ids})

        async def _compute():
            return await run_in_threadpool(get_products_brief, ids, store=store)

        data = await asyncio.wait_for(_cached(key, 300, _compute), timeout=28)
        shopify_logger.info(
            "shopify.products_brief store=%s ids=%s elapsed_ms=%s",
            store,
            len(ids),
            int((time.perf_counter() - started) * 1000),
        )
        return {"data": data}
    except asyncio.TimeoutError:
        shopify_logger.warning(
            "shopify.products_brief timeout store=%s ids=%s elapsed_ms=%s",
            getattr(req, "store", None),
            len(getattr(req, "ids", []) or []),
            int((time.perf_counter() - started) * 1000),
        )
        return {"error": "shopify_products_brief_timeout", "data": {}}
    except Exception as e:
        return {"error": str(e), "data": {}}


class ProductVariantsInventoryRequest(BaseModel):
    product_id: str
    store: Optional[str] = None


@app.post("/api/shopify/product_variants_inventory")
async def api_product_variants_inventory(req: ProductVariantsInventoryRequest):
    """Return variant-level inventory breakdown (sizes x colors matrix) for a product."""
    started = time.perf_counter()
    try:
        pid = (req.product_id or "").strip()
        if not pid or not pid.isdigit():
            return {"data": {"sizes": [], "colors": [], "matrix": {}, "total_available": 0}}
        store = _canonical_store_label(req.store)
        key = _cache_key("shopify_product_variants_inv", {"store": store or None, "id": pid})

        async def _compute():
            from app.integrations.shopify_client import get_product_variants_inventory
            return await run_in_threadpool(get_product_variants_inventory, pid, store=store)

        data = await asyncio.wait_for(_cached(key, 300, _compute), timeout=28)
        return {"data": data}
    except asyncio.TimeoutError:
        shopify_logger.warning(
            "shopify.product_variants_inventory timeout store=%s pid=%s elapsed_ms=%s",
            getattr(req, "store", None),
            getattr(req, "product_id", None),
            int((time.perf_counter() - started) * 1000),
        )
        return {"error": "shopify_product_variants_inventory_timeout", "data": {"sizes": [], "colors": [], "matrix": {}, "total_available": 0}}
    except Exception as e:
        return {"error": str(e), "data": {"sizes": [], "colors": [], "matrix": {}, "total_available": 0}}


class OrdersTotalCountRequest(BaseModel):
    start: Optional[str] = None  # YYYY-MM-DD
    end: Optional[str] = None    # YYYY-MM-DD
    store: Optional[str] = None
    include_closed: Optional[bool] = None
    date_field: Optional[str] = None  # 'processed' | 'created'


@app.post("/api/shopify/orders_count_total")
async def api_orders_count_total(req: OrdersTotalCountRequest):
    started = time.perf_counter()
    try:
        s_date = (req.start or "").split("T")[0] if isinstance(req.start, str) and "-" in (req.start or "") else (req.start or "")
        e_date = (req.end or "").split("T")[0] if isinstance(req.end, str) and "-" in (req.end or "") else (req.end or "")
        include_closed = bool(req.include_closed) if req.include_closed is not None else False
        df = (req.date_field or "processed").lower()
        store = _canonical_store_label(req.store)
        key = _cache_key("shopify_orders_count_total", {"store": store or None, "start": s_date, "end": e_date, "include_closed": include_closed, "date_field": df})

        async def _compute():
            if df == "created":
                return await run_in_threadpool(count_orders_total_created, s_date, e_date, store=store, include_closed=include_closed)
            return await run_in_threadpool(count_orders_total_processed, s_date, e_date, store=store, include_closed=include_closed)

        cnt = await asyncio.wait_for(_cached(key, 60, _compute), timeout=28)
        return {"data": {"count": int(cnt or 0)}}
    except asyncio.TimeoutError:
        shopify_logger.warning(
            "shopify.orders_count_total timeout store=%s elapsed_ms=%s",
            getattr(req, "store", None),
            int((time.perf_counter() - started) * 1000),
        )
        return {"error": "shopify_orders_total_timeout", "data": {"count": 0}}
    except Exception as e:
        return {"error": str(e), "data": {"count": 0}}


class CollectionProductsRequest(BaseModel):
    collection_id: Optional[str] = None
    collection_handle: Optional[str] = None  # reserved for future use
    store: Optional[str] = None


@app.post("/api/shopify/collection_products")
async def api_collection_products(req: CollectionProductsRequest):
    try:
        cid = (req.collection_id or "").strip()
        if not cid:
            return {"data": {"product_ids": []}}
        # Only numeric collection_id supported via REST collects in current implementation
        if not cid.isdigit():
            return {"data": {"product_ids": []}}
        store = _canonical_store_label(req.store)
        ids = list_product_ids_in_collection(cid, store=store)
        return {"data": {"product_ids": [str(i) for i in (ids or [])]}}
    except Exception as e:
        return {"error": str(e), "data": {"product_ids": []}}


class CampaignMappingUpsertRequest(BaseModel):
    campaign_key: str
    kind: str  # 'product' | 'collection'
    id: str
    store: Optional[str] = None


@app.post("/api/campaign_mappings")
async def api_upsert_campaign_mapping(req: CampaignMappingUpsertRequest):
    try:
        key = (req.campaign_key or "").strip()
        kind = (req.kind or "").strip()
        target_id = (req.id or "").strip()
        if not key or not kind or not target_id:
            return {"error": "missing_fields"}
        if kind not in ("product", "collection"):
            return {"error": "invalid_kind"}
        out = db.upsert_campaign_mapping(req.store, key, kind, target_id)
        return {"data": out}
    except Exception as e:
        return {"error": str(e)}


@app.get("/api/campaign_mappings")
async def api_list_campaign_mappings(store: str | None = None):
    try:
        items = db.list_campaign_mappings(store)
        return {"data": items}
    except Exception as e:
        return {"error": str(e), "data": {}}


# -------- Campaign Meta (supplier fields + timeline, stored in AppSetting) --------
class CampaignMetaUpsertRequest(BaseModel):
    campaign_key: str
    supplier_name: Optional[str] = None
    supplier_alt_name: Optional[str] = None  # legacy
    supply_available: Optional[str] = None   # new
    owner: Optional[str] = None
    timeline: Optional[List[Dict[str, Any]]] = None
    product_life_checks: Optional[Dict[str, Any]] = None  # per-campaign phase checks
    store: Optional[str] = None


@app.post("/api/campaign_meta")
async def api_upsert_campaign_meta(req: CampaignMetaUpsertRequest):
    try:
        key = (req.campaign_key or "").strip()
        if not key:
            return {"error": "missing_campaign_key"}
        patch: Dict[str, Any] = {}
        if isinstance(req.supplier_name, str):
            patch["supplier_name"] = req.supplier_name
        if isinstance(req.supplier_alt_name, str):
            patch["supplier_alt_name"] = req.supplier_alt_name
        if isinstance(req.supply_available, str):
            patch["supply_available"] = req.supply_available
        if isinstance(req.owner, str):
            patch["owner"] = req.owner.strip().lower()
        if isinstance(req.timeline, list):
            patch["timeline"] = req.timeline
        if req.product_life_checks is not None:
            patch["product_life_checks"] = req.product_life_checks
        data = db.set_campaign_meta(req.store, key, patch)
        return {"data": data}
    except Exception as e:
        return {"error": str(e)}


@app.get("/api/campaign_meta")
async def api_list_campaign_meta(store: str | None = None):
    try:
        items = db.list_campaign_meta(store)
        return {"data": items}
    except Exception as e:
        return {"error": str(e), "data": {}}


class CampaignTimelineAddRequest(BaseModel):
    campaign_key: str
    text: str
    store: Optional[str] = None


@app.post("/api/campaign_meta/timeline")
async def api_campaign_timeline_add(req: CampaignTimelineAddRequest):
    try:
        key = (req.campaign_key or "").strip()
        if not key or not isinstance(req.text, str) or not req.text.strip():
            return {"error": "invalid_input"}
        data = db.append_campaign_timeline(req.store, key, req.text)
        return {"data": data}
    except Exception as e:
        return {"error": str(e)}

# -------- Campaign Analysis Checks (per-campaign implementation checkmarks) --------
class AnalysisChecksRequest(BaseModel):
    campaign_key: str
    checks: Dict[str, bool]  # { "rec_0": true, "step_1": false, ... }
    store: Optional[str] = None


@app.post("/api/campaign/analysis_checks")
async def api_save_analysis_checks(req: AnalysisChecksRequest):
    """Save analysis checkmarks for a campaign."""
    try:
        key = (req.campaign_key or "").strip()
        if not key:
            return {"error": "missing_campaign_key"}
        data = db.set_campaign_meta(req.store, key, {"analysis_checks": req.checks or {}})
        return {"data": data}
    except Exception as e:
        return {"error": str(e)}


@app.get("/api/campaign/analysis_checks/{campaign_key}")
async def api_get_analysis_checks(campaign_key: str, store: str | None = None):
    """Get saved analysis checkmarks for a campaign."""
    try:
        key = (campaign_key or "").strip()
        if not key:
            return {"data": {}}
        meta = db.get_app_setting(store, f"campaign_meta:{key}")
        if not isinstance(meta, dict):
            return {"data": {}}
        return {"data": meta.get("analysis_checks") or {}}
    except Exception as e:
        return {"error": str(e), "data": {}}



class ProductLifeInstructionsRequest(BaseModel):
    phases: Dict[str, list]  # { "testing": ["instruction1", ...], "action1": [...], ... }
    store: Optional[str] = None


@app.get("/api/product_life/instructions")
async def api_get_product_life_instructions(store: str | None = None):
    try:
        data = db.get_app_setting(store, "product_life_instructions")
        if not isinstance(data, dict):
            data = {"phases": {"testing": [], "action1": [], "micro_scaling": [], "macro_scaling": []}}
        return {"data": data}
    except Exception as e:
        return {"error": str(e), "data": {"phases": {"testing": [], "action1": [], "micro_scaling": [], "macro_scaling": []}}}


@app.post("/api/product_life/instructions")
async def api_set_product_life_instructions(req: ProductLifeInstructionsRequest):
    try:
        data = {"phases": req.phases or {}}
        saved = db.set_app_setting(req.store, "product_life_instructions", data)
        return {"data": saved if isinstance(saved, dict) else data}
    except Exception as e:
        return {"error": str(e)}



# -------- Ads Management Bundle (single-request aggregation) --------
class AdsManagementBundleRequest(BaseModel):
    date_preset: Optional[str] = None
    ad_account: Optional[str] = None
    store: Optional[str] = None
    start: Optional[str] = None
    end: Optional[str] = None
    profit_only: Optional[bool] = False


@app.post("/api/ads-management/bundle")
async def api_ads_management_bundle(req: AdsManagementBundleRequest):
    """Single aggregated endpoint for the ads-management page.

    Fetches Meta campaigns, Shopify product briefs, Shopify order counts,
    store total orders, campaign mappings, and campaign meta ALL in parallel.
    Replaces 6-10+ sequential frontend requests with one backend call.
    """
    return await _ads_management_bundle_impl(
        date_preset=req.date_preset,
        ad_account=req.ad_account,
        store=req.store,
        start=req.start,
        end=req.end,
        profit_only=bool(req.profit_only),
    )


@app.get("/api/ads-management/bundle")
async def api_ads_management_bundle_get(
    date_preset: str | None = None,
    ad_account: str | None = None,
    store: str | None = None,
    start: str | None = None,
    end: str | None = None,
    profit_only: bool | None = False,
):
    """GET variant for browser/CDN cacheability."""
    return await _ads_management_bundle_impl(
        date_preset=date_preset,
        ad_account=ad_account,
        store=store,
        start=start,
        end=end,
        profit_only=bool(profit_only),
    )


async def _ads_management_bundle_impl(
    date_preset: str | None = None,
    ad_account: str | None = None,
    store: str | None = None,
    start: str | None = None,
    end: str | None = None,
    profit_only: bool = False,
):
    try:
        store = store or None
        date_preset = date_preset or "last_7d"
        start = start or None
        end = end or None

        acct = _normalize_ad_acct_id(ad_account)
        ad_account_info: dict = {}
        if not acct:
            try:
                conf = db.get_app_setting(store, "meta_ad_account")
                acct = _normalize_ad_acct_id(((conf or {}).get("id") if isinstance(conf, dict) else None))
                if isinstance(conf, dict):
                    ad_account_info = {"id": conf.get("id"), "name": conf.get("name")}
            except Exception:
                acct = None

        # Use DB-stored name only; never call get_ad_account_info here to avoid
        # blocking the bundle on a slow Meta API call that can cause 504 timeouts.
        if acct and not ad_account_info.get("id"):
            ad_account_info = {"id": acct, "name": ""}

        bundle_key = _cache_key("ads_mgmt_bundle", {
            "acct": acct or None, "date_preset": date_preset,
            "start": start, "end": end, "store": store, "profit_only": bool(profit_only),
        })

        async def _compute_bundle():
            return await _ads_management_bundle_compute(acct, date_preset, start, end, store, profit_only=bool(profit_only))

        result = await _cached(bundle_key, 25, _compute_bundle)
        result["ad_account"] = ad_account_info
        return {"data": result}
    except Exception as e:
        return {"error": str(e), "data": {}}


async def _ads_management_bundle_compute(acct, date_preset, start, end, store, profit_only: bool = False):
    """Fast bundle: only campaigns + mappings + meta (no slow Shopify calls).

    Shopify product briefs and order counts are loaded progressively by the
    frontend in small chunks so results appear gradually.
    """
    campaigns_key = _cache_key("meta_campaigns", {"acct": acct or None, "date_preset": date_preset, "start": start, "end": end, "store": store, "profit_only": bool(profit_only)})

    async def _fetch_campaigns():
        try:
            return await asyncio.wait_for(
                _cached(campaigns_key, 30, lambda: run_in_threadpool(
                    list_active_campaigns_with_insights,
                    date_preset,
                    ad_account_id=(acct or None),
                    since=start,
                    until=end,
                    profit_only=bool(profit_only),
                )),
                timeout=55,
            )
        except asyncio.TimeoutError:
            return []
        except Exception:
            return []

    async def _fetch_mappings():
        try:
            return db.list_campaign_mappings(store)
        except Exception:
            return {}

    async def _fetch_meta():
        try:
            return db.list_campaign_meta(store)
        except Exception:
            return {}

    async def _fetch_product_life_instructions():
        try:
            data = db.get_app_setting(store, "product_life_instructions")
            if not isinstance(data, dict):
                data = {"phases": {"testing": [], "action1": [], "micro_scaling": [], "macro_scaling": []}}
            return data
        except Exception:
            return {"phases": {"testing": [], "action1": [], "micro_scaling": [], "macro_scaling": []}}

    campaigns_result, mappings, campaign_meta, pl_instructions = await asyncio.gather(
        _fetch_campaigns(),
        _fetch_mappings(),
        _fetch_meta(),
        _fetch_product_life_instructions() if not profit_only else asyncio.sleep(0, result={}),
    )

    return {
        "campaigns": campaigns_result or [],
        "mappings": mappings or {},
        "campaign_meta": campaign_meta or {},
        "product_life_instructions": pl_instructions or {},
    }


# -------- Campaign AI Analyzer (async job pattern) --------
# In-memory job store: { job_id: { status, result, error } }
_analysis_jobs: Dict[str, Dict[str, Any]] = {}

class CampaignAnalyzeRequest(BaseModel):
    campaign_id: Optional[str] = None
    campaign_ids: Optional[List[str]] = None  # for group analysis
    campaign_name: Optional[str] = None
    product_id: Optional[str] = None
    store: Optional[str] = None
    ad_account: Optional[str] = None
    date_range: Optional[Dict[str, str]] = None  # { start, end }
    metrics: Optional[Dict[str, Any]] = None
    campaign_age_days: Optional[int] = None  # days since campaign launch (from Product Life)
    campaign_key: Optional[str] = None  # campaign_key for timeline saving


def _clarity_days_for_range(start: str | None, end: str | None) -> int:
    """Map the selected dashboard range to Clarity's 1-3 day export window."""
    try:
        if start and end:
            ds = datetime.fromisoformat(str(start).split("T")[0])
            de = datetime.fromisoformat(str(end).split("T")[0])
            return max(1, min(3, (de.date() - ds.date()).days + 1))
    except Exception:
        pass
    return 3


def _public_store_domains(store: str | None) -> list[str]:
    domains: list[str] = []
    suffix = ""
    try:
        suffix = str(store or "").strip().upper().replace("-", "_")
    except Exception:
        suffix = ""
    keys = ["SHOPIFY_PUBLIC_DOMAIN"]
    if suffix:
        keys.insert(0, f"SHOPIFY_PUBLIC_DOMAIN_{suffix}")
    for key in keys:
        raw = str(os.getenv(key, "") or "").strip()
        if not raw:
            continue
        for part in raw.split(","):
            domain = part.strip().replace("https://", "").replace("http://", "").strip("/")
            if domain and domain not in domains:
                domains.append(domain)
    return domains


def _analysis_landing_urls(ad_creatives: list, product_info: dict, store: str | None = None) -> list[str]:
    urls: list[str] = []
    for cr in ad_creatives or []:
        if isinstance(cr, dict):
            u = str(cr.get("landing_url") or "").strip()
            if u and u not in urls:
                urls.append(u)
    product_url = str((product_info or {}).get("product_url") or "").strip()
    if product_url and product_url not in urls:
        urls.append(product_url)
    handle = str((product_info or {}).get("handle") or "").strip().strip("/")
    if handle:
        for domain in _public_store_domains(store):
            for prefix in ("", "ar/"):
                public_url = f"https://{domain}/{prefix}products/{handle}"
                if public_url not in urls:
                    urls.append(public_url)
    return urls


def _run_analysis_job(job_id: str, req_data: dict):
    """Run the full analysis pipeline in a background thread."""
    try:
        cids = req_data.get("cids", [])
        pid = req_data.get("pid", "")
        store = req_data.get("store")
        s_date = req_data.get("s_date", "")
        e_date = req_data.get("e_date", "")
        campaign_age_days = req_data.get("campaign_age_days")
        campaign_key = req_data.get("campaign_key", "")
        campaign_name = req_data.get("campaign_name", "")

        # 1) Campaign metrics
        campaign_metrics = req_data.get("metrics") or {}
        if not campaign_metrics:
            try:
                if s_date and e_date:
                    summary = get_campaign_summary(cids[0], since=s_date, until=e_date)
                else:
                    summary = get_campaign_summary(cids[0], since="2024-01-01", until="2030-12-31")
                campaign_metrics = {
                    "spend": summary.get("spend", 0),
                    "purchases": summary.get("purchases", 0),
                    "cpp": summary.get("cpp"),
                    "ctr": summary.get("ctr"),
                    "add_to_cart": summary.get("add_to_cart", 0),
                    "status": summary.get("status"),
                }
            except Exception:
                pass

        # 2) Fetch ad creatives + product info
        ad_creatives: list = []
        try:
            for cid in cids[:2]:
                creatives = get_campaign_ad_creatives(cid)
                ad_creatives.extend(creatives or [])
        except Exception:
            pass

        product_info: Dict[str, Any] = {}
        if pid and pid.isdigit():
            try:
                briefs = get_products_brief([pid], store=store)
                brief = (briefs or {}).get(pid) or {}
                product_info["price"] = brief.get("price")
                product_info["image_url"] = brief.get("image") or ""
                product_info["inventory"] = brief.get("total_available")
            except Exception:
                pass
            try:
                from app.integrations.shopify_client import _rest_get_store
                prod_data = _rest_get_store(store, f"/products/{pid}.json?fields=id,title,body_html,handle,status")
                prod = (prod_data or {}).get("product") or {}
                product_info["title"] = prod.get("title") or ""
                product_info["description"] = prod.get("body_html") or ""
                product_info["handle"] = prod.get("handle") or ""
                try:
                    from app.integrations.shopify_client import _get_store_config
                    cfg = _get_store_config(store)
                    shop_domain = cfg.get("SHOP", "")
                    if shop_domain and product_info.get("handle"):
                        product_info["product_url"] = f"https://{shop_domain}/products/{product_info['handle']}"
                except Exception:
                    pass
            except Exception:
                pass

        # 3) Load previous analysis context (for feedback loop)
        previous_analysis_context = None
        try:
            ck = campaign_key or (cids[0] if cids else "")
            if ck:
                meta = db.get_app_setting(store, f"campaign_meta:{ck}")
                if isinstance(meta, dict):
                    # Get saved checks
                    saved_checks = meta.get("analysis_checks") or {}
                    # Find the most recent analysis from timeline
                    timeline = meta.get("timeline") or []
                    prev_analysis = None
                    for entry in reversed(timeline):
                        try:
                            text = entry.get("text", "") if isinstance(entry, dict) else str(entry)
                            parsed = json.loads(text) if isinstance(text, str) else text
                            if isinstance(parsed, dict) and parsed.get("type") == "analysis":
                                prev_analysis = parsed
                                break
                        except Exception:
                            continue
                    
                    if prev_analysis and saved_checks:
                        import json as _json
                        prev_result = prev_analysis.get("analysis") or {}
                        prev_recs = prev_result.get("recommendations") or []
                        prev_steps = (prev_result.get("scaling_plan") or {}).get("next_steps") or []
                        
                        # Build implementation status
                        implemented_recs = []
                        not_implemented_recs = []
                        for idx, rec in enumerate(prev_recs):
                            check_key = f"rec_{idx}"
                            item_desc = f"[P{rec.get('priority', '?')} {rec.get('category', '')}] {rec.get('recommendation', '')}"
                            if saved_checks.get(check_key):
                                implemented_recs.append(item_desc)
                            else:
                                not_implemented_recs.append(item_desc)
                        
                        implemented_steps = []
                        not_implemented_steps = []
                        for idx, step in enumerate(prev_steps):
                            check_key = f"step_{idx}"
                            if saved_checks.get(check_key):
                                implemented_steps.append(step)
                            else:
                                not_implemented_steps.append(step)
                        
                        if implemented_recs or not_implemented_recs:
                            ctx_parts = []
                            ctx_parts.append(f"PREVIOUS ANALYSIS (verdict: {prev_analysis.get('verdict', 'N/A')}, confidence: {prev_analysis.get('confidence', 'N/A')}):")
                            ctx_parts.append(f"Summary: {prev_analysis.get('summary', 'N/A')}")
                            if implemented_recs:
                                ctx_parts.append(f"\n✅ IMPLEMENTED by the user ({len(implemented_recs)} items):")
                                for item in implemented_recs:
                                    ctx_parts.append(f"  - {item}")
                            if not_implemented_recs:
                                ctx_parts.append(f"\n❌ NOT YET IMPLEMENTED ({len(not_implemented_recs)} items):")
                                for item in not_implemented_recs:
                                    ctx_parts.append(f"  - {item}")
                            if implemented_steps:
                                ctx_parts.append(f"\n✅ COMPLETED next steps:")
                                for item in implemented_steps:
                                    ctx_parts.append(f"  - {item}")
                            if not_implemented_steps:
                                ctx_parts.append(f"\n❌ PENDING next steps:")
                                for item in not_implemented_steps:
                                    ctx_parts.append(f"  - {item}")
                            
                            previous_analysis_context = "\n".join(ctx_parts)
                            logger.info("Campaign Analyzer: loaded previous analysis context (%d chars)", len(previous_analysis_context))
        except Exception as ctx_err:
            logger.warning("Failed to load previous analysis context: %s", ctx_err)

        # 4) Run AI analysis
        if campaign_age_days is not None:
            campaign_metrics["campaign_age_days"] = campaign_age_days
        clarity_insights: Dict[str, Any] = {}
        try:
            clarity_insights = summarize_clarity_for_campaign(
                campaign_id=(cids[0] if cids else None),
                campaign_name=campaign_name,
                landing_urls=_analysis_landing_urls(ad_creatives, product_info, store),
                num_days=_clarity_days_for_range(s_date, e_date),
            )
            logger.info(
                "Campaign Analyzer: Clarity summary enabled=%s matched_rows=%s matched_by=%s error=%s urls=%s",
                clarity_insights.get("enabled"),
                clarity_insights.get("matched_rows"),
                clarity_insights.get("matched_by"),
                clarity_insights.get("error"),
                len(clarity_insights.get("landing_urls") or []),
            )
        except Exception as clarity_err:
            logger.warning("Failed to summarize Clarity data: %s", clarity_err)
            clarity_insights = {"enabled": False, "error": str(clarity_err)}
        result = run_campaign_analysis(
            campaign_metrics=campaign_metrics,
            ad_creatives=ad_creatives,
            product_info=product_info,
            clarity_insights=clarity_insights,
            previous_analysis_context=previous_analysis_context,
        )

        # Attach raw inputs
        result["meta_inputs"] = campaign_metrics
        result["ad_creatives_input"] = ad_creatives[:10]
        result["product_info_input"] = {k: v for k, v in product_info.items() if k != "description"}
        result["clarity_insights_input"] = clarity_insights

        # 5) Auto-save analysis to timeline + reset checks for new analysis
        try:
            ck = campaign_key or (cids[0] if cids else "")
            if ck:
                import json as _json
                timeline_text = _json.dumps({
                    "type": "analysis",
                    "verdict": result.get("overall_verdict", ""),
                    "confidence": result.get("confidence_level", ""),
                    "summary": result.get("summary", ""),
                    "age_days": campaign_age_days,
                    "analysis": result,
                }, ensure_ascii=False)
                db.append_campaign_timeline(store, ck, timeline_text)
                # Reset analysis checks for the new analysis
                db.set_campaign_meta(store, ck, {"analysis_checks": {}})
        except Exception as save_err:
            logger.warning("Failed to save analysis to timeline: %s", save_err)

        _analysis_jobs[job_id] = {"status": "done", "result": result}
    except Exception as e:
        import traceback
        traceback.print_exc()
        _analysis_jobs[job_id] = {"status": "error", "error": str(e)}


@app.post("/api/campaign/analyze")
async def api_campaign_analyze(req: CampaignAnalyzeRequest):
    """Start AI-powered campaign analysis as a background job. Returns job_id immediately."""
    import threading
    from uuid import uuid4
    try:
        cids = req.campaign_ids or ([req.campaign_id] if req.campaign_id else [])
        cids = [str(c).strip() for c in cids if str(c or "").strip()]
        if not cids:
            return {"error": "campaign_id or campaign_ids required"}

        job_id = str(uuid4())
        _analysis_jobs[job_id] = {"status": "pending"}

        # Clean old jobs (keep last 50)
        if len(_analysis_jobs) > 60:
            keys = list(_analysis_jobs.keys())
            for old_key in keys[:len(keys) - 50]:
                _analysis_jobs.pop(old_key, None)

        pid = (req.product_id or "").strip()
        store = req.store or None
        dr = req.date_range or {}
        s_date = (dr.get("start") or "").split("T")[0]
        e_date = (dr.get("end") or "").split("T")[0]

        req_data = {
            "cids": cids,
            "pid": pid,
            "store": store,
            "s_date": s_date,
            "e_date": e_date,
            "metrics": req.metrics if isinstance(req.metrics, dict) else None,
            "campaign_age_days": req.campaign_age_days,
            "campaign_key": (req.campaign_key or "").strip(),
            "campaign_name": (req.campaign_name or "").strip(),
        }

        thread = threading.Thread(target=_run_analysis_job, args=(job_id, req_data), daemon=True)
        thread.start()

        return {"job_id": job_id}
    except Exception as e:
        return {"error": str(e)}


@app.get("/api/campaign/analyze/status/{job_id}")
async def api_campaign_analyze_status(job_id: str):
    """Poll for analysis job status. Returns {status: 'pending'|'done'|'error', result?, error?}"""
    job = _analysis_jobs.get(job_id)
    if not job:
        return {"status": "not_found", "error": "Job not found"}
    return job


class ClarityCampaignDebugRequest(BaseModel):
    campaign_id: Optional[str] = None
    campaign_name: Optional[str] = None
    landing_urls: Optional[List[str]] = None
    num_days: Optional[int] = None


@app.post("/api/clarity/campaign_debug")
async def api_clarity_campaign_debug(req: ClarityCampaignDebugRequest):
    """Debug Clarity matching without calling OpenAI. Does not expose the token."""
    try:
        result = summarize_clarity_for_campaign(
            campaign_id=(req.campaign_id or "").strip() or None,
            campaign_name=(req.campaign_name or "").strip() or None,
            landing_urls=req.landing_urls or [],
            num_days=req.num_days,
        )
        return {"data": result}
    except Exception as e:
        return {"error": str(e), "data": {"enabled": False, "error": str(e)}}


# -------- Action Task Agent (generate tasks from multiple analyses) --------
_action_task_jobs: Dict[str, Dict[str, Any]] = {}


class GenerateActionTasksRequest(BaseModel):
    analyses: list  # list of campaign analysis results
    store: Optional[str] = None


def _run_action_task_job(job_id: str, analyses: list, store: str | None):
    """Run the action task generation in a background thread."""
    try:
        result = run_action_task_generation(analyses=analyses)
        # Save tasks to DB
        try:
            db.set_app_setting(store, "action_tasks", result)
        except Exception as save_err:
            logger.warning("Failed to save action tasks: %s", save_err)
        _action_task_jobs[job_id] = {"status": "done", "result": result}
    except Exception as e:
        import traceback
        traceback.print_exc()
        _action_task_jobs[job_id] = {"status": "error", "error": str(e)}


@app.post("/api/campaign/generate_action_tasks")
async def api_generate_action_tasks(req: GenerateActionTasksRequest):
    """Start action task generation as a background job."""
    import threading
    from uuid import uuid4
    try:
        if not req.analyses or not isinstance(req.analyses, list):
            return {"error": "analyses list required"}

        job_id = str(uuid4())
        _action_task_jobs[job_id] = {"status": "pending"}

        # Clean old jobs
        if len(_action_task_jobs) > 30:
            keys = list(_action_task_jobs.keys())
            for old_key in keys[:len(keys) - 20]:
                _action_task_jobs.pop(old_key, None)

        thread = threading.Thread(
            target=_run_action_task_job,
            args=(job_id, req.analyses, req.store),
            daemon=True,
        )
        thread.start()
        return {"job_id": job_id}
    except Exception as e:
        return {"error": str(e)}


@app.get("/api/campaign/generate_action_tasks/status/{job_id}")
async def api_action_task_status(job_id: str):
    """Poll for action task generation status."""
    job = _action_task_jobs.get(job_id)
    if not job:
        return {"status": "not_found", "error": "Job not found"}
    return job


@app.get("/api/campaign/action_tasks")
async def api_get_action_tasks(store: str | None = None):
    """Get saved action tasks for a store."""
    try:
        data = db.get_app_setting(store, "action_tasks")
        if not isinstance(data, dict):
            return {"data": {"summary": "", "urgent_count": 0, "tasks": []}}
        return {"data": data}
    except Exception as e:
        return {"error": str(e), "data": {"summary": "", "urgent_count": 0, "tasks": []}}


class SaveActionTasksRequest(BaseModel):
    tasks: list  # full tasks array with done states
    store: Optional[str] = None


@app.post("/api/campaign/action_tasks/save")
async def api_save_action_tasks(req: SaveActionTasksRequest):
    """Save updated task check states."""
    try:
        existing = db.get_app_setting(req.store, "action_tasks")
        if not isinstance(existing, dict):
            existing = {"summary": "", "urgent_count": 0, "tasks": []}
        existing["tasks"] = req.tasks or []
        try:
            task_states = {
                str(t.get("id")): bool(t.get("done"))
                for t in (req.tasks or [])
                if isinstance(t, dict) and t.get("id")
            }
            db.sync_campaign_timeline_task_states(req.store, task_states)
        except Exception as sync_err:
            logger.warning("Failed to sync timeline task states: %s", sync_err)
        saved = db.set_app_setting(req.store, "action_tasks", existing)
        return {"data": saved if isinstance(saved, dict) else existing}
    except Exception as e:
        return {"error": str(e)}


@app.delete("/api/campaign/action_tasks")
async def api_clear_action_tasks(store: str | None = None):
    """Clear all action tasks for a store."""
    try:
        db.set_app_setting(store, "action_tasks", {"summary": "", "urgent_count": 0, "tasks": []})
        return {"data": {"ok": True}}
    except Exception as e:
        return {"error": str(e), "data": {"ok": False}}


# -------- Bulk Analyze All Active Campaigns (background job, DB-persisted) --------
import re as _re_mod

def _extract_product_id_from_name(name: str | None) -> str | None:
    """Extract a numeric product ID (3+ digits) from a campaign name."""
    try:
        n = str(name or "")
        m = _re_mod.search(r"(\d{3,})", n)
        return m.group(1) if m else None
    except Exception:
        return None


def _run_bulk_analysis_job(job_id: str, store: str | None, ad_accounts: list[str] | None, s_date: str, e_date: str):
    """Run the full analyze-all pipeline in a background thread.
    
    This thread is non-daemon and persists job state to DB, so it
    survives browser close and can be polled later.
    """
    logger = logging.getLogger("bulk_analysis")
    try:
        # --- Step 1: Save initial state ---
        db.save_bulk_analysis_job(store, job_id, {
            "status": "fetching_campaigns",
            "progress": {"done": 0, "total": 0, "phase": "fetching"},
        })

        # --- Step 2: Fetch all campaigns from Meta ---
        accounts: list[str | None] = []
        for raw in (ad_accounts or []):
            acct = _normalize_ad_acct_id(raw)
            if acct and acct not in accounts:
                accounts.append(acct)
        if not accounts:
            try:
                conf = db.get_app_setting(store, "meta_ad_account")
                acct = _normalize_ad_acct_id(((conf or {}).get("id") if isinstance(conf, dict) else None))
                if acct:
                    accounts.append(acct)
            except Exception:
                pass
        if not accounts:
            accounts = [None]

        campaigns: list[dict] = []
        seen_campaigns: set[str] = set()
        for acct in accounts:
            try:
                rows = list_active_campaigns_with_insights(
                    "last_7d",
                    ad_account_id=acct or None,
                    since=s_date,
                    until=e_date,
                ) or []
            except Exception as fetch_err:
                logger.warning("Bulk analysis failed fetching campaigns for account %s: %s", acct, fetch_err)
                rows = []
            for c in rows:
                cid = str((c or {}).get("campaign_id") or (c or {}).get("name") or "")
                dedupe_key = f"{acct or ''}:{cid}"
                if not cid or dedupe_key in seen_campaigns:
                    continue
                seen_campaigns.add(dedupe_key)
                campaigns.append({**c, "_ad_account": acct})

        # --- Step 3: Filter to ACTIVE campaigns ---
        active_campaigns = [
            c for c in campaigns
            if str(c.get("status", "")).upper() == "ACTIVE"
        ]

        if not active_campaigns:
            db.save_bulk_analysis_job(store, job_id, {
                "status": "done",
                "progress": {"done": 0, "total": 0, "phase": "done"},
                "result": {"message": "No active campaigns found", "task_count": 0},
            })
            return

        # --- Step 4: Group campaigns by product ID ---
        mappings = {}
        try:
            mappings = db.list_campaign_mappings(store) or {}
        except Exception:
            pass

        by_pid: dict[str, list] = {}
        ungrouped: list = []
        for c in active_campaigns:
            cid = str(c.get("campaign_id") or "")
            name = str(c.get("name") or "")
            pid = None
            # Check manual mapping first
            for key in (cid, name):
                if not key:
                    continue
                m = mappings.get(key)
                if m and m.get("kind") == "product" and m.get("id"):
                    pid = str(m.get("id") or m.get("target_id") or "")
                    break
            # Fallback to extracting from name
            if not pid:
                pid = _extract_product_id_from_name(name)
            if pid:
                by_pid.setdefault(pid, []).append(c)
            else:
                ungrouped.append(c)

        # For ungrouped campaigns, treat each as its own "group"
        all_groups: list[dict] = []
        for pid, rows in by_pid.items():
            all_groups.append({"product_id": pid, "campaigns": rows})
        for c in ungrouped:
            fake_pid = str(c.get("campaign_id") or c.get("name") or "")
            all_groups.append({"product_id": fake_pid, "campaigns": [c]})

        total_groups = len(all_groups)
        db.save_bulk_analysis_job(store, job_id, {
            "status": "analyzing",
            "progress": {"done": 0, "total": total_groups, "phase": "analyzing"},
        })

        # --- Step 5: Analyze each group ---
        all_analyses: list[dict] = []
        for idx, group in enumerate(all_groups):
            pid = group["product_id"]
            rows = group["campaigns"]
            try:
                # Aggregate metrics across all campaigns in the group
                total_spend = sum(float(c.get("spend", 0) or 0) for c in rows)
                total_purchases = sum(int(c.get("purchases", 0) or 0) for c in rows)
                total_atc = sum(int(c.get("add_to_cart", 0) or 0) for c in rows)
                # Weighted average CTR
                ctr_val = None
                try:
                    ctr_sum = sum(float(c.get("ctr", 0) or 0) * float(c.get("spend", 0) or 0) for c in rows)
                    if total_spend > 0:
                        ctr_val = ctr_sum / total_spend
                except Exception:
                    pass
                cpp_val = (total_spend / total_purchases) if total_purchases > 0 else None

                # Campaign age from first campaign's created_time
                age_days = None
                for c in rows:
                    ct = c.get("created_time")
                    if ct:
                        try:
                            from datetime import datetime as _dt
                            diff = _dt.utcnow() - _dt.fromisoformat(str(ct).replace("Z", "+00:00").replace("+00:00", ""))
                            age_days = max(0, diff.days)
                        except Exception:
                            pass
                        break

                # Fetch ad creatives from first campaign
                ad_creatives = []
                try:
                    cid0 = str(rows[0].get("campaign_id", ""))
                    if cid0:
                        ad_creatives = get_campaign_ad_creatives(cid0) or []
                except Exception:
                    pass

                # Fetch product info
                product_info: dict = {}
                if pid and pid.isdigit():
                    try:
                        briefs = get_products_brief([pid], store=store)
                        brief = (briefs or {}).get(pid) or {}
                        product_info["price"] = brief.get("price")
                        product_info["image_url"] = brief.get("image") or ""
                        product_info["inventory"] = brief.get("total_available")
                    except Exception:
                        pass
                    try:
                        from app.integrations.shopify_client import _rest_get_store
                        prod_data = _rest_get_store(store, f"/products/{pid}.json?fields=id,title,body_html,handle,status")
                        prod = (prod_data or {}).get("product") or {}
                        product_info["title"] = prod.get("title") or ""
                        product_info["description"] = prod.get("body_html") or ""
                        product_info["handle"] = prod.get("handle") or ""
                        try:
                            from app.integrations.shopify_client import _get_store_config
                            cfg = _get_store_config(store)
                            shop_domain = cfg.get("SHOP", "")
                            if shop_domain and product_info.get("handle"):
                                product_info["product_url"] = f"https://{shop_domain}/products/{product_info['handle']}"
                        except Exception:
                            pass
                    except Exception:
                        pass

                # Shopify orders count
                shopify_orders = None
                try:
                    if pid and pid.isdigit():
                        from app.integrations.shopify_client import count_orders_by_product_or_variant_processed_batch
                        oc = count_orders_by_product_or_variant_processed_batch([pid], s_date, e_date, store=store, include_closed=True) or {}
                        shopify_orders = int(oc.get(pid, 0) or 0)
                except Exception:
                    pass

                true_cpp = (total_spend / shopify_orders) if shopify_orders and shopify_orders > 0 else None

                campaign_metrics = {
                    "spend": total_spend,
                    "purchases": total_purchases,
                    "ctr": ctr_val,
                    "cpp": cpp_val,
                    "add_to_cart": total_atc,
                    "shopify_orders": shopify_orders,
                    "true_cpp": true_cpp,
                    "status": "Active",
                }
                if age_days is not None:
                    campaign_metrics["campaign_age_days"] = age_days

                clarity_insights: dict = {}
                try:
                    first_row = rows[0] if rows else {}
                    clarity_insights = summarize_clarity_for_campaign(
                        campaign_id=str(first_row.get("campaign_id") or ""),
                        campaign_name=str(first_row.get("name") or product_info.get("title") or ""),
                        landing_urls=_analysis_landing_urls(ad_creatives, product_info, store),
                        num_days=_clarity_days_for_range(s_date, e_date),
                    )
                except Exception as clarity_err:
                    logger.warning("Failed to summarize Clarity data for bulk group %s: %s", pid, clarity_err)
                    clarity_insights = {"enabled": False, "error": str(clarity_err)}

                # Run AI analysis
                result = run_campaign_analysis(
                    campaign_metrics=campaign_metrics,
                    ad_creatives=ad_creatives,
                    product_info=product_info,
                    clarity_insights=clarity_insights,
                )
                result["meta_inputs"] = campaign_metrics
                result["product_info_input"] = {k: v for k, v in product_info.items() if k != "description"}
                result["clarity_insights_input"] = clarity_insights
                result["campaign_name"] = product_info.get("title") or rows[0].get("name") or pid
                result["campaign_key"] = pid
                result["product_id"] = pid
                result["campaign_ids"] = [str(c.get("campaign_id", "")) for c in rows]

                # Save analysis to group timeline
                try:
                    timeline_text = json.dumps({
                        "type": "analysis",
                        "verdict": result.get("overall_verdict", ""),
                        "confidence": result.get("confidence_level", ""),
                        "summary": result.get("summary", ""),
                        "age_days": age_days,
                        "analysis": result,
                        "source": "bulk_analyze_all",
                        "job_id": job_id,
                    }, ensure_ascii=False)
                    db.append_group_timeline(store, pid, timeline_text)
                except Exception as te:
                    logger.warning("Failed to save bulk analysis to group timeline: %s", te)

                all_analyses.append(result)

            except Exception as e:
                logger.warning("Bulk analysis failed for product group %s: %s", pid, e)
                import traceback
                traceback.print_exc()

            # Update progress
            db.save_bulk_analysis_job(store, job_id, {
                "status": "analyzing",
                "progress": {"done": idx + 1, "total": total_groups, "phase": "analyzing"},
            })

        if not all_analyses:
            db.save_bulk_analysis_job(store, job_id, {
                "status": "done",
                "progress": {"done": total_groups, "total": total_groups, "phase": "done"},
                "result": {"message": "No analyses completed successfully", "task_count": 0},
            })
            return

        # --- Step 6: Generate action tasks from all analyses ---
        db.save_bulk_analysis_job(store, job_id, {
            "status": "generating_tasks",
            "progress": {"done": total_groups, "total": total_groups, "phase": "generating_tasks"},
        })

        try:
            tasks_result = run_action_task_generation(analyses=all_analyses)
        except Exception as te:
            logger.error("Bulk task generation failed: %s", te)
            tasks_result = {"summary": "Task generation failed", "urgent_count": 0, "tasks": []}

        # Save tasks to DB
        try:
            db.set_app_setting(store, "action_tasks", tasks_result)
        except Exception:
            pass

        # --- Step 7: Save tasks to group timelines ---
        tasks = tasks_result.get("tasks") or []
        for task in tasks:
            # Map task.campaigns (names) -> product IDs
            task_campaign_names = task.get("campaigns") or []
            target_pids: set = set()
            for cn in task_campaign_names:
                cn_s = str(cn or "").strip()
                if not cn_s:
                    continue
                # The task agent may reference the group/product name rather than
                # an individual Meta campaign. Match against analysis metadata too.
                for analysis in all_analyses:
                    if (
                        cn_s == str(analysis.get("campaign_name") or "").strip()
                        or cn_s == str(analysis.get("campaign_key") or "").strip()
                        or cn_s == str(analysis.get("product_id") or "").strip()
                        or cn_s in [str(x) for x in (analysis.get("campaign_ids") or [])]
                    ):
                        target_pids.add(str(analysis.get("product_id") or analysis.get("campaign_key") or ""))
                # Find which product group this campaign belongs to
                for g in all_groups:
                    for c in g["campaigns"]:
                        if c.get("name") == cn_s or str(c.get("campaign_id", "")) == cn_s:
                            target_pids.add(g["product_id"])
                            break
            if not target_pids:
                # Fallback: add to all groups
                target_pids = {g["product_id"] for g in all_groups}

            for tpid in target_pids:
                try:
                    task_entry = json.dumps({
                        "type": "task",
                        "id": task.get("id", ""),
                        "priority": task.get("priority"),
                        "urgency": task.get("urgency", ""),
                        "category": task.get("category", ""),
                        "title": task.get("title", ""),
                        "description": task.get("description", ""),
                        "expected_impact": task.get("expected_impact", ""),
                        "campaigns": task.get("campaigns", []),
                        "done": False,
                        "source": "bulk_analyze_all",
                        "job_id": job_id,
                    }, ensure_ascii=False)
                    db.append_group_timeline(store, tpid, task_entry)
                    # Also attach the same task to each concrete campaign in the
                    # group so the campaign-row task icon and timeline are useful
                    # even when the product group is collapsed or unavailable.
                    for g in all_groups:
                        if str(g.get("product_id") or "") != str(tpid):
                            continue
                        for c in (g.get("campaigns") or []):
                            ck = str(c.get("campaign_id") or c.get("name") or "").strip()
                            if ck:
                                db.append_campaign_timeline(store, ck, task_entry)
                except Exception:
                    pass

        # --- Step 8: Mark job done ---
        total_task_count = len(tasks)
        incomplete_count = len([t for t in tasks if not t.get("done")])
        db.save_bulk_analysis_job(store, job_id, {
            "status": "done",
            "progress": {"done": total_groups, "total": total_groups, "phase": "done"},
            "result": {
                "task_count": total_task_count,
                "incomplete_count": incomplete_count,
                "summary": tasks_result.get("summary", ""),
                "analyses_count": len(all_analyses),
                "groups_analyzed": [g["product_id"] for g in all_groups],
            },
        })

        # Refresh campaign meta cache
        try:
            _analysis_cache_buster = f"bulk_done_{job_id}"
        except Exception:
            pass

        logger.info("Bulk analysis job %s completed: %d groups, %d analyses, %d tasks",
                     job_id, total_groups, len(all_analyses), total_task_count)

    except Exception as e:
        import traceback
        traceback.print_exc()
        try:
            db.save_bulk_analysis_job(store, job_id, {
                "status": "error",
                "error": str(e),
                "progress": {"done": 0, "total": 0, "phase": "error"},
            })
        except Exception:
            pass


class BulkAnalyzeRequest(BaseModel):
    store: Optional[str] = None
    ad_account: Optional[str] = None
    ad_accounts: Optional[List[str]] = None
    date_range: Optional[Dict[str, str]] = None  # { start, end }


@app.post("/api/campaign/analyze_all")
async def api_analyze_all_campaigns(req: BulkAnalyzeRequest):
    """Start bulk analysis of all active campaigns.
    
    Runs entirely in the background — survives browser close.
    Job state is persisted to DB for reliable polling.
    """
    from uuid import uuid4
    try:
        job_id = str(uuid4())
        store = req.store or None
        dr = req.date_range or {}
        s_date = (dr.get("start") or "").split("T")[0]
        e_date = (dr.get("end") or "").split("T")[0]

        # Default to last 7 days if no range provided
        if not s_date or not e_date:
            from datetime import timedelta
            now = datetime.utcnow()
            s_date = (now - timedelta(days=7)).strftime("%Y-%m-%d")
            e_date = now.strftime("%Y-%m-%d")

        # Save initial job state
        db.save_bulk_analysis_job(store, job_id, {
            "status": "pending",
            "progress": {"done": 0, "total": 0, "phase": "starting"},
            "date_range": {"start": s_date, "end": e_date},
        })

        # Launch background thread (daemon=False so it survives request lifecycle)
        thread = threading.Thread(
            target=_run_bulk_analysis_job,
            args=(job_id, store, (req.ad_accounts or ([req.ad_account] if req.ad_account else [])), s_date, e_date),
            daemon=False,
            name=f"bulk-analysis-{job_id[:8]}",
        )
        thread.start()

        return {"job_id": job_id}
    except Exception as e:
        return {"error": str(e)}


@app.get("/api/campaign/analyze_all/status/{job_id}")
async def api_analyze_all_status(job_id: str, store: str | None = None):
    """Poll for bulk analysis job status. Reads from DB (not in-memory)."""
    try:
        job = db.get_bulk_analysis_job(store, job_id)
        if not job:
            return {"status": "not_found", "error": "Job not found"}
        return job
    except Exception as e:
        return {"status": "error", "error": str(e)}


@app.get("/api/campaign/analyze_all/latest")
async def api_analyze_all_latest(store: str | None = None):
    """Get the latest bulk analysis job for badge display and state restoration."""
    try:
        job = db.get_latest_bulk_analysis_job(store)
        if not job:
            return {"data": None}
        return {"data": job}
    except Exception as e:
        return {"error": str(e), "data": None}


# -------- Profit Calculator costs (per product, stored in AppSetting) --------
class ProfitCostsUpsertRequest(BaseModel):
    product_id: str
    product_cost: Optional[float] = None
    service_delivery_cost: Optional[float] = None
    store: Optional[str] = None


@app.get("/api/profit_costs")
async def api_list_profit_costs(store: str | None = None):
    try:
        items = db.list_profit_costs(store)
        return {"data": items}
    except Exception as e:
        return {"error": str(e), "data": {}}


@app.post("/api/profit_costs")
async def api_upsert_profit_costs(req: ProfitCostsUpsertRequest):
    try:
        pid = (req.product_id or "").strip()
        if not pid or not pid.isdigit():
            return {"error": "invalid_product_id"}
        patch: Dict[str, Any] = {}
        if req.product_cost is not None:
            patch["product_cost"] = float(req.product_cost)
        if req.service_delivery_cost is not None:
            patch["service_delivery_cost"] = float(req.service_delivery_cost)
        data = db.set_profit_costs(req.store, pid, patch)
        return {"data": data}
    except Exception as e:
        return {"error": str(e)}


# -------- Exchange rate (USD -> MAD) --------
class UsdToMadRateUpsertRequest(BaseModel):
    rate: float
    store: Optional[str] = None


@app.get("/api/exchange/usd_to_mad")
async def api_get_usd_to_mad_rate(store: str | None = None):
    try:
        rate = db.get_usd_to_mad_rate(store)
        if rate is None:
            rate = 10.0
        return {"data": {"rate": float(rate)}}
    except Exception as e:
        return {"error": str(e), "data": {"rate": 10.0}}


@app.post("/api/exchange/usd_to_mad")
async def api_set_usd_to_mad_rate(req: UsdToMadRateUpsertRequest):
    try:
        rate = db.set_usd_to_mad_rate(req.store, float(req.rate))
        return {"data": {"rate": float(rate)}}
    except Exception as e:
        return {"error": str(e)}


# -------- Profit Cards (saved snapshots) --------
def _extract_numeric_id_from_name(name: str | None) -> str | None:
    try:
        n = str(name or "")
        m = re.search(r"(\d{3,})", n)
        return m.group(1) if m else None
    except Exception:
        return None


def _compute_profit_card_snapshot_sync(*, store: str | None, product_id: str, start: str, end: str) -> dict:
    """Compute and return the profit card payload for a single product_id and date range."""
    pid = (product_id or "").strip()
    if not pid or not pid.isdigit():
        raise ValueError("invalid_product_id")
    s_date = (start or "").split("T")[0]
    e_date = (end or "").split("T")[0]
    rate = db.get_usd_to_mad_rate(store)
    if rate is None:
        rate = 10.0
    rate = float(rate)

    # Meta campaigns (ACTIVE+PAUSED) with spend within range
    campaigns = list_active_campaigns_with_insights("last_7d", ad_account_id=None, since=s_date, until=e_date)
    campaigns = [c for c in (campaigns or []) if float(c.get("spend") or 0) > 0]

    # Campaign mappings (optional, to map a campaign to a product id)
    try:
        mappings = db.list_campaign_mappings(store) or {}
    except Exception:
        mappings = {}

    def _matches_product(c: dict) -> bool:
        try:
            cid = str(c.get("campaign_id") or "").strip()
            name = str(c.get("name") or "").strip()
            # 1) Numeric id in name
            if _extract_numeric_id_from_name(name) == pid:
                return True
            # 2) Explicit mapping by campaign_key (campaign_id or name)
            for key in (cid, name):
                if not key:
                    continue
                m = mappings.get(key)
                if m and m.get("kind") == "product" and str(m.get("id") or m.get("target_id") or "") == pid:
                    return True
        except Exception:
            return False
        return False

    matched_campaigns = [c for c in campaigns if _matches_product(c)]

    # Shopify product brief (inventory + price)
    briefs = get_products_brief([pid], store=store) or {}
    brief = (briefs or {}).get(pid) or {}
    price_mad = brief.get("price")
    try:
        price_mad = float(price_mad) if price_mad is not None else None
    except Exception:
        price_mad = None

    inv = brief.get("total_available")
    try:
        inv = int(inv) if inv is not None else None
    except Exception:
        inv = None

    # Shopify orders (processed_at window)
    orders_map = count_orders_by_product_or_variant_processed_batch([pid], s_date, e_date, store=store, include_closed=True) or {}
    paid_map = count_paid_orders_by_product_or_variant_processed_batch([pid], s_date, e_date, store=store, include_closed=True) or {}
    orders_total = int((orders_map or {}).get(pid, 0) or 0)
    paid_total = int((paid_map or {}).get(pid, 0) or 0)

    # Costs (saved per product)
    try:
        costs = db.get_app_setting(store, f"profit_costs:{pid}") or {}
        if not isinstance(costs, dict):
            costs = {}
    except Exception:
        costs = {}
    product_cost = float(costs.get("product_cost") or 0)
    service_delivery_cost = float(costs.get("service_delivery_cost") or 0)

    rows: list[dict] = []
    for c in matched_campaigns:
        spend_usd = float(c.get("spend") or 0)
        spend_mad = spend_usd * rate
        revenue_mad = (float(price_mad or 0) * float(paid_total or 0))
        # Costs are PER PAID ORDER
        total_product_cost = float(product_cost or 0.0) * float(paid_total or 0.0)
        total_service_delivery_cost = float(service_delivery_cost or 0.0) * float(paid_total or 0.0)
        net_profit_mad = revenue_mad - float(spend_mad or 0.0) - total_product_cost - total_service_delivery_cost
        rows.append({
            "campaign_id": c.get("campaign_id"),
            "name": c.get("name"),
            "status": c.get("status"),
            "spend_usd": round(spend_usd, 2),
            "spend_mad": round(spend_mad, 2),
            "orders_total": orders_total,
            "paid_orders_total": paid_total,
            "product_price_mad": price_mad,
            "inventory": inv,
            "product_cost": product_cost,
            "service_delivery_cost": service_delivery_cost,
            "net_profit_mad": round(net_profit_mad, 2),
        })

    # Sort by spend desc
    try:
        rows.sort(key=lambda x: float(x.get("spend_usd") or 0), reverse=True)
    except Exception:
        pass

    return {
        "store": store,
        "product_id": pid,
        "range": {"start": s_date, "end": e_date},
        "currency": {"shopify": "MAD", "meta_spend": "USD", "display": "MAD"},
        "usd_to_mad_rate": rate,
        "product": {
            "image": brief.get("image"),
            "inventory": inv,
            "price_mad": price_mad,
        },
        "shopify": {
            "orders_total": orders_total,
            "paid_orders_total": paid_total,
        },
        "costs": {
            "product_cost": product_cost,
            "service_delivery_cost": service_delivery_cost,
        },
        "campaigns": rows,
    }


class ProfitCardCreateRequest(BaseModel):
    product_id: str
    start: str
    end: str
    store: Optional[str] = None


@app.get("/api/profit_cards")
async def api_list_profit_cards(store: str | None = None):
    try:
        items = db.list_profit_cards(store)
        return {"data": items}
    except Exception as e:
        return {"error": str(e), "data": []}


@app.post("/api/profit_cards")
async def api_create_profit_card(req: ProfitCardCreateRequest):
    try:
        pid = (req.product_id or "").strip()
        s_date = (req.start or "").split("T")[0]
        e_date = (req.end or "").split("T")[0]
        if not pid or not pid.isdigit():
            return {"error": "invalid_product_id"}
        if not s_date or not e_date:
            return {"error": "invalid_range"}
        card_id = str(uuid4())
        key = _cache_key("profit_card_compute", {"store": req.store or None, "pid": pid, "start": s_date, "end": e_date})

        async def _compute():
            return await run_in_threadpool(_compute_profit_card_snapshot_sync, store=req.store, product_id=pid, start=s_date, end=e_date)

        snap = await _cached(key, 10, _compute)
        now = datetime.utcnow().isoformat() + "Z"
        data = {"id": card_id, **(snap or {}), "created_at": now, "updated_at": now}
        saved = db.upsert_profit_card(req.store, card_id, data)
        return {"data": saved}
    except Exception as e:
        return {"error": str(e)}


@app.post("/api/profit_cards/{card_id}/refresh")
async def api_refresh_profit_card(card_id: str, store: str | None = None):
    try:
        existing = db.get_profit_card(store, card_id) or {}
        pid = str((existing or {}).get("product_id") or "").strip()
        rng = (existing or {}).get("range") or {}
        s_date = str((rng or {}).get("start") or "").split("T")[0]
        e_date = str((rng or {}).get("end") or "").split("T")[0]
        if not pid or not pid.isdigit():
            return {"error": "invalid_product_id"}
        if not s_date or not e_date:
            return {"error": "invalid_range"}
        key = _cache_key("profit_card_refresh", {"store": store or None, "card_id": card_id, "pid": pid, "start": s_date, "end": e_date})

        async def _compute():
            return await run_in_threadpool(_compute_profit_card_snapshot_sync, store=store, product_id=pid, start=s_date, end=e_date)

        snap = await _cached(key, 10, _compute)
        merged = dict(existing or {})
        merged.update(snap or {})
        merged["updated_at"] = datetime.utcnow().isoformat() + "Z"
        saved = db.upsert_profit_card(store, card_id, merged)
        return {"data": saved}
    except Exception as e:
        return {"error": str(e)}


@app.delete("/api/profit_cards/{card_id}")
async def api_delete_profit_card(card_id: str, store: str | None = None):
    try:
        ok = db.delete_profit_card(store, card_id)
        return {"data": {"ok": bool(ok)}}
    except Exception as e:
        return {"error": str(e), "data": {"ok": False}}


# -------- Profit Campaign Cards (campaign-centric) --------
class ProfitCampaignCalculateRequest(BaseModel):
    campaign_id: str
    start: str
    end: str
    store: Optional[str] = None
    ad_account: Optional[str] = None
    force: Optional[bool] = None


def _compute_profit_campaign_card_sync(*, store: str | None, ad_account: str | None, campaign_id: str, start: str, end: str) -> dict:
    cid = (campaign_id or "").strip()
    if not cid:
        raise ValueError("invalid_campaign_id")
    acct = _normalize_ad_acct_id((ad_account or "").strip()) or None
    s_date = (start or "").split("T")[0]
    e_date = (end or "").split("T")[0]
    if not s_date or not e_date:
        raise ValueError("invalid_range")

    rate = db.get_usd_to_mad_rate(store) or 10.0
    rate = float(rate)

    # Meta: fetch single campaign summary (much faster than listing insights for all campaigns)
    try:
        row = get_campaign_summary(cid, since=s_date, until=e_date) or {}
    except Exception as e:
        # Unwrap tenacity RetryError to expose the underlying API error message
        try:
            from tenacity import RetryError  # type: ignore
            if isinstance(e, RetryError):
                try:
                    cause = e.last_attempt.exception()  # type: ignore[attr-defined]
                    raise RuntimeError(str(cause)) from cause
                except Exception:
                    raise RuntimeError(str(e)) from e
        except Exception:
            pass
        raise
    name = (row or {}).get("name")
    status = (row or {}).get("status")
    spend_usd = float((row or {}).get("spend") or 0.0)
    spend_mad = spend_usd * rate

    # Resolve product_id via campaign mapping or numeric in name
    pid = None
    try:
        mappings = db.list_campaign_mappings(store) or {}
    except Exception:
        mappings = {}
    try:
        # campaign_key might be campaign_id or campaign name in existing UI
        for k in (cid, str(name or "").strip()):
            if not k:
                continue
            m = (mappings or {}).get(k)
            if m and (m.get("kind") == "product") and str(m.get("id") or "").strip().isdigit():
                pid = str(m.get("id")).strip()
                break
    except Exception:
        pid = None
    if not pid:
        try:
            pid = _extract_numeric_id_from_name(str(name or ""))
        except Exception:
            pid = None

    product = {"id": pid, "image": None, "inventory": None, "price_mad": None}
    shopify = {"orders_total": 0, "paid_orders_total": 0}
    costs = {"product_cost": 0.0, "service_delivery_cost": 0.0}

    if pid and str(pid).isdigit():
        try:
            briefs = get_products_brief([pid], store=store) or {}
            brief = (briefs or {}).get(pid) or {}
            product["image"] = brief.get("image")
            product["inventory"] = int(brief.get("total_available")) if brief.get("total_available") is not None else None
            product["price_mad"] = float(brief.get("price")) if brief.get("price") is not None else None
        except Exception:
            pass
        try:
            both = count_orders_and_paid_by_product_or_variant_processed_batch([pid], s_date, e_date, store=store, include_closed=True) or {}
            rec = (both or {}).get(pid) or {}
            shopify["orders_total"] = int((rec or {}).get("orders_total", 0) or 0)
            shopify["paid_orders_total"] = int((rec or {}).get("paid_orders_total", 0) or 0)
        except Exception:
            pass
        try:
            c = db.get_app_setting(store, f"profit_costs:{pid}") or {}
            if isinstance(c, dict):
                costs["product_cost"] = float(c.get("product_cost") or 0.0)
                costs["service_delivery_cost"] = float(c.get("service_delivery_cost") or 0.0)
        except Exception:
            pass

    price_mad = float(product.get("price_mad") or 0.0)
    paid_total = float(shopify.get("paid_orders_total") or 0.0)
    # Costs are PER PAID ORDER
    profit_per_order = price_mad - float(costs["product_cost"] or 0.0) - float(costs["service_delivery_cost"] or 0.0)
    revenue_mad = price_mad * paid_total
    net_profit_mad = (profit_per_order * paid_total) - float(spend_mad or 0.0)

    return {
        "campaign_id": cid,
        "campaign_name": name,
        "status": status,
        "ad_account": acct,
        "range": {"start": s_date, "end": e_date},
        "usd_to_mad_rate": rate,
        "spend_usd": round(spend_usd, 2),
        "spend_mad": round(spend_mad, 2),
        "product": product,
        "shopify": shopify,
        "costs": costs,
        "revenue_mad": round(revenue_mad, 2),
        "net_profit_mad": round(net_profit_mad, 2),
        "profit_per_paid_order_mad": round(profit_per_order, 2),
    }


@app.get("/api/profit_campaign_cards")
async def api_list_profit_campaign_cards(store: str | None = None, ad_account: str | None = None):
    try:
        items = db.list_profit_campaign_cards(store, ad_account)
        return {"data": items}
    except Exception as e:
        return {"error": str(e), "data": {}}


@app.post("/api/profit_campaign_cards/calculate")
async def api_calculate_profit_campaign_card(req: ProfitCampaignCalculateRequest):
    try:
        cid = (req.campaign_id or "").strip()
        if not cid:
            return {"error": "invalid_campaign_id"}
        s_date = (req.start or "").split("T")[0]
        e_date = (req.end or "").split("T")[0]
        acct = _normalize_ad_acct_id((req.ad_account or "").strip()) or None
        force = bool(req.force) if req.force is not None else False

        # Fast path: if we already have a saved result for the same range, return it immediately (no recompute)
        if not force:
            try:
                existing = db.get_profit_campaign_card(req.store, acct, cid) or {}
                rng = (existing or {}).get("range") or {}
                if isinstance(rng, dict) and str(rng.get("start") or "") == s_date and str(rng.get("end") or "") == e_date:
                    return {"data": existing}
            except Exception:
                pass
        key = _cache_key("profit_campaign_calc", {"store": req.store or None, "ad_account": acct, "campaign_id": cid, "start": s_date, "end": e_date})

        async def _compute():
            return await run_in_threadpool(_compute_profit_campaign_card_sync, store=req.store, ad_account=acct, campaign_id=cid, start=s_date, end=e_date)

        # Cache compute results longer; Shopify order scans are expensive for large ranges.
        snap = await _cached(key, 180, _compute)
        now = datetime.utcnow().isoformat() + "Z"
        existing = db.get_profit_campaign_card(req.store, acct, cid) or {}
        created_at = (existing or {}).get("created_at") or now
        payload = dict(existing or {})
        payload.update(snap or {})
        payload["created_at"] = created_at
        payload["updated_at"] = now
        saved = db.upsert_profit_campaign_card(req.store, acct, cid, payload)
        return {"data": saved}
    except Exception as e:
        # Unwrap tenacity RetryError to expose the underlying API error message
        try:
            from tenacity import RetryError  # type: ignore
            if isinstance(e, RetryError):
                try:
                    cause = e.last_attempt.exception()  # type: ignore[attr-defined]
                    return {"error": str(cause)}
                except Exception:
                    return {"error": str(e)}
        except Exception:
            pass
        return {"error": str(e)}


@app.delete("/api/profit_campaign_cards/{campaign_id}")
async def api_delete_profit_campaign_card(campaign_id: str, store: str | None = None, ad_account: str | None = None):
    try:
        ok = db.delete_profit_campaign_card(store, ad_account, campaign_id)
        return {"data": {"ok": bool(ok)}}
    except Exception as e:
        return {"error": str(e), "data": {"ok": False}}


class OrdersCountByCollectionRequest(BaseModel):
    collection_id: str
    start: str
    end: str
    store: Optional[str] = None
    include_closed: Optional[bool] = None
    aggregate: Optional[str] = None  # 'orders' | 'items' | 'sum_product_orders'
    date_field: Optional[str] = None  # 'processed' | 'created'


@app.post("/api/shopify/orders_count_by_collection")
async def api_orders_count_by_collection(req: OrdersCountByCollectionRequest):
    try:
        cid = (req.collection_id or "").strip()
        if not (cid and cid.isdigit()):
            return {"data": {"count": 0}}
        s_date = (req.start or "").split("T")[0] if isinstance(req.start, str) and "-" in req.start else (req.start or "")
        e_date = (req.end or "").split("T")[0] if isinstance(req.end, str) and "-" in req.end else (req.end or "")
        include_closed = bool(req.include_closed) if req.include_closed is not None else False
        agg = (req.aggregate or "orders").lower()
        df = (req.date_field or "processed").lower()
        store = _canonical_store_label(req.store)

        key = _cache_key("shopify_orders_count_by_collection", {
            "store": store or None,
            "collection_id": cid,
            "start": s_date,
            "end": e_date,
            "include_closed": include_closed,
            "aggregate": agg,
            "date_field": df,
        })

        async def _compute():
            if agg == "items":
                return await run_in_threadpool(count_items_by_collection_processed, cid, s_date, e_date, store=store, include_closed=include_closed)
            if agg == "sum_product_orders":
                if df == "created":
                    return await run_in_threadpool(sum_product_order_counts_for_collection_created, cid, s_date, e_date, store=store, include_closed=include_closed)
                return await run_in_threadpool(sum_product_order_counts_for_collection, cid, s_date, e_date, store=store, include_closed=include_closed)
            return await run_in_threadpool(count_orders_by_collection_processed, cid, s_date, e_date, store=store, include_closed=include_closed)

        cnt = await _cached(key, 60, _compute)
        return {"data": {"count": int(cnt or 0)}}
    except Exception as e:
        return {"error": str(e), "data": {"count": 0}}


# ---------------- Confirmation Team (Order Browser variant) ----------------
def _b64u_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _b64u_decode(s: str) -> bytes:
    pad = "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode((s or "") + pad)


def _confirmation_secret() -> bytes:
    sec = (os.getenv("CONFIRMATION_AUTH_SECRET", "") or os.getenv("JWT_SECRET", "") or "").strip()
    if not sec:
        # Dev-only fallback; production should set CONFIRMATION_AUTH_SECRET
        sec = "dev-secret"
    return sec.encode("utf-8")


def _issue_confirmation_token(payload: dict) -> str:
    msg = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    body = _b64u_encode(msg)
    sig = _b64u_encode(hmac.new(_confirmation_secret(), body.encode("ascii"), hashlib.sha256).digest())
    return f"{body}.{sig}"


def _verify_confirmation_token(token: str) -> dict | None:
    try:
        tok = (token or "").strip()
        if not tok or "." not in tok:
            return None
        body, sig = tok.split(".", 1)
        exp_sig = _b64u_encode(hmac.new(_confirmation_secret(), body.encode("ascii"), hashlib.sha256).digest())
        if not hmac.compare_digest(exp_sig, sig):
            return None
        payload = json.loads(_b64u_decode(body).decode("utf-8"))
        # exp check (unix seconds)
        try:
            exp = int(payload.get("exp") or 0)
            if exp and int(time.time()) > exp:
                return None
        except Exception:
            return None
        return payload if isinstance(payload, dict) else None
    except Exception:
        return None


def _get_confirmation_agent(req: Request) -> dict | None:
    auth = (req.headers.get("authorization") or req.headers.get("Authorization") or "").strip()
    token = ""
    if auth.lower().startswith("bearer "):
        token = auth.split(" ", 1)[1].strip()
    if not token:
        token = (req.headers.get("x-confirmation-token") or "").strip()
    if not token:
        return None
    return _verify_confirmation_token(token)


def _confirmation_tags_list(tags_raw: str | list[str] | None) -> list[str]:
    """Normalize Shopify order tags into a list of strings (trimmed)."""
    try:
        if not tags_raw:
            return []
        if isinstance(tags_raw, list):
            out: list[str] = []
            for t in tags_raw:
                s = str(t or "").strip()
                if s:
                    out.append(s)
            return out
        # Shopify REST returns tags as a comma-separated string
        return [t.strip() for t in str(tags_raw or "").split(",") if t.strip()]
    except Exception:
        return []


def _confirmation_is_fz_agent(agent_email: str | None) -> bool:
    return (agent_email or "").strip().lower() == "fz@conf.com"


def _confirmation_order_assigned_to_agent(order: dict, tags_list: list[str], agent_email: str | None) -> bool:
    """Return True if an order is assigned to the given agent.

    Current rule set (can be extended later):
      - fz@conf.com: only orders tagged 'fz' AND financial_status in {pending, paid}
        (orders are already constrained to open+unfulfilled by list_orders_open_unfulfilled).
    """
    ae = (agent_email or "").strip().lower()
    if not ae:
        return False
    if _confirmation_is_fz_agent(ae):
        tags_lc = {t.strip().lower() for t in (tags_list or []) if str(t).strip()}
        if "fz" not in tags_lc:
            return False
        fs = str((order or {}).get("financial_status") or "").strip().lower()
        if fs not in ("pending", "paid"):
            return False
        return True
    # default: unassigned routing (everyone sees the queue)
    return True


def _load_confirmation_users(store: str | None) -> list[dict]:
    """Resolve confirmation users (email + password + optional name).

    Sources:
      - AppSetting(store, 'confirmation_users') if set
      - env CONFIRMATION_USERS (JSON)
    """
    out: list[dict] = []
    # 1) DB setting per store
    try:
        val = db.get_app_setting(store, "confirmation_users")
        if isinstance(val, list):
            for u in val:
                if isinstance(u, dict) and u.get("email") and u.get("password"):
                    out.append({"email": str(u["email"]).strip().lower(), "password": str(u["password"]), "name": u.get("name")})
        elif isinstance(val, dict):
            # allow {"email":"pw"} map
            for k, v in val.items():
                if k and v:
                    out.append({"email": str(k).strip().lower(), "password": str(v), "name": None})
    except Exception:
        pass
    if out:
        return out
    # 2) ENV fallback
    try:
        raw = (os.getenv("CONFIRMATION_USERS", "") or "").strip()
        if raw:
            parsed = json.loads(raw)
            if isinstance(parsed, list):
                for u in parsed:
                    if isinstance(u, dict) and u.get("email") and u.get("password"):
                        out.append({"email": str(u["email"]).strip().lower(), "password": str(u["password"]), "name": u.get("name")})
            elif isinstance(parsed, dict):
                for k, v in parsed.items():
                    if k and v:
                        out.append({"email": str(k).strip().lower(), "password": str(v), "name": None})
    except Exception:
        pass
    return out


class ConfirmationLoginRequest(BaseModel):
    email: str
    password: str
    store: Optional[str] = None
    remember: Optional[bool] = True


@app.post("/api/confirmation/login")
async def api_confirmation_login(req: ConfirmationLoginRequest):
    try:
        email = (req.email or "").strip().lower()
        pw = (req.password or "")
        if not email or not pw:
            return {"error": "missing_credentials"}
        users = _load_confirmation_users(req.store)
        ok = False
        name = None
        for u in (users or []):
            if str(u.get("email") or "").strip().lower() == email and str(u.get("password") or "") == pw:
                ok = True
                name = u.get("name")
                break
        if not ok:
            return {"error": "invalid_credentials"}
        ttl = 60 * 60 * 24 * (30 if bool(req.remember) else 1)
        now = int(time.time())
        token = _issue_confirmation_token({"sub": email, "name": name, "store": (req.store or None), "iat": now, "exp": now + ttl})
        return {"data": {"token": token, "agent": {"email": email, "name": name}}}
    except Exception as e:
        return {"error": str(e)}


# ---------------- Confirmation Admin ----------------
def _confirmation_admin_secret() -> bytes:
    # Separate secret allows tighter rotation policies
    sec = (os.getenv("CONFIRMATION_ADMIN_SECRET", "") or os.getenv("CONFIRMATION_AUTH_SECRET", "") or os.getenv("JWT_SECRET", "") or "").strip()
    if not sec:
        sec = "dev-admin-secret"
    return sec.encode("utf-8")


def _issue_confirmation_admin_token(payload: dict) -> str:
    msg = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    body = _b64u_encode(msg)
    sig = _b64u_encode(hmac.new(_confirmation_admin_secret(), body.encode("ascii"), hashlib.sha256).digest())
    return f"{body}.{sig}"


def _verify_confirmation_admin_token(token: str) -> dict | None:
    try:
        tok = (token or "").strip()
        if not tok or "." not in tok:
            return None
        body, sig = tok.split(".", 1)
        exp_sig = _b64u_encode(hmac.new(_confirmation_admin_secret(), body.encode("ascii"), hashlib.sha256).digest())
        if not hmac.compare_digest(exp_sig, sig):
            return None
        payload = json.loads(_b64u_decode(body).decode("utf-8"))
        try:
            exp = int((payload or {}).get("exp") or 0)
            if exp and int(time.time()) > exp:
                return None
        except Exception:
            return None
        if not isinstance(payload, dict):
            return None
        if (payload.get("role") or "").lower() != "admin":
            return None
        return payload
    except Exception:
        return None


def _get_confirmation_admin(req: Request) -> dict | None:
    auth = (req.headers.get("authorization") or req.headers.get("Authorization") or "").strip()
    token = ""
    if auth.lower().startswith("bearer "):
        token = auth.split(" ", 1)[1].strip()
    if not token:
        token = (req.headers.get("x-confirmation-admin-token") or "").strip()
    if not token:
        return None
    return _verify_confirmation_admin_token(token)


def _load_confirmation_admin_users() -> list[dict]:
    """Resolve admin users (email + password + optional name) from env only."""
    out: list[dict] = []
    try:
        raw = (os.getenv("CONFIRMATION_ADMIN_USERS", "") or "").strip()
        if not raw:
            return out
        parsed = json.loads(raw)
        if isinstance(parsed, list):
            for u in parsed:
                if isinstance(u, dict) and u.get("email") and u.get("password"):
                    out.append({"email": str(u["email"]).strip().lower(), "password": str(u["password"]), "name": u.get("name")})
        elif isinstance(parsed, dict):
            for k, v in parsed.items():
                if k and v:
                    out.append({"email": str(k).strip().lower(), "password": str(v), "name": None})
    except Exception:
        return out
    return out


def _normalize_email(s: str) -> str:
    return (s or "").strip().lower()


def _sanitize_confirmation_users(users: list[dict]) -> list[dict]:
    """Normalize and de-duplicate by email. Keeps last occurrence."""
    by_email: dict[str, dict] = {}
    for u in (users or []):
        if not isinstance(u, dict):
            continue
        email = _normalize_email(str(u.get("email") or ""))
        pw = str(u.get("password") or "")
        name = u.get("name")
        if not email or not pw:
            continue
        by_email[email] = {"email": email, "password": pw, "name": (str(name).strip() if isinstance(name, str) and name.strip() else None)}
    return list(by_email.values())


def _save_confirmation_users(store: str | None, users: list[dict]) -> list[dict]:
    cleaned = _sanitize_confirmation_users(users)
    try:
        db.set_app_setting(store, "confirmation_users", cleaned)
    except Exception:
        pass
    return cleaned


def _gen_password(n: int = 10) -> str:
    import secrets, string
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(max(8, min(int(n or 10), 32))))


class ConfirmationAdminLoginRequest(BaseModel):
    email: str
    password: str
    remember: Optional[bool] = True


@app.post("/api/confirmation/admin/login")
async def api_confirmation_admin_login(req: ConfirmationAdminLoginRequest):
    try:
        email = _normalize_email(req.email)
        pw = (req.password or "")
        if not email or not pw:
            return {"error": "missing_credentials"}
        users = _load_confirmation_admin_users()
        ok = False
        name = None
        for u in (users or []):
            if _normalize_email(str(u.get("email") or "")) == email and str(u.get("password") or "") == pw:
                ok = True
                name = u.get("name")
                break
        if not ok:
            return {"error": "invalid_credentials"}
        ttl = 60 * 60 * 24 * (30 if bool(req.remember) else 1)
        now = int(time.time())
        token = _issue_confirmation_admin_token({"sub": email, "name": name, "role": "admin", "iat": now, "exp": now + ttl})
        return {"data": {"token": token, "admin": {"email": email, "name": name}}}
    except Exception as e:
        return {"error": str(e)}


@app.get("/api/confirmation/admin/users")
async def api_confirmation_admin_users(req: Request, store: str | None = None):
    try:
        admin = _get_confirmation_admin(req)
        if not admin:
            return {"error": "unauthorized", "data": []}
        users = _load_confirmation_users(store)
        # Never return passwords
        out = [{"email": u.get("email"), "name": u.get("name")} for u in (users or []) if isinstance(u, dict) and u.get("email")]
        # stable sort
        out.sort(key=lambda x: str(x.get("email") or ""))
        return {"data": out}
    except Exception as e:
        return {"error": str(e), "data": []}


class ConfirmationAdminUserUpsertRequest(BaseModel):
    store: Optional[str] = None
    email: str
    name: Optional[str] = None
    password: Optional[str] = None  # if omitted, auto-generate


@app.post("/api/confirmation/admin/users/upsert")
async def api_confirmation_admin_user_upsert(req: Request, body: ConfirmationAdminUserUpsertRequest):
    try:
        admin = _get_confirmation_admin(req)
        if not admin:
            return {"error": "unauthorized"}
        store = body.store
        email = _normalize_email(body.email)
        if not email:
            return {"error": "invalid_email"}
        pw = (body.password or "").strip()
        generated = None
        if not pw:
            generated = _gen_password()
            pw = generated
        name = (body.name or "").strip() if isinstance(body.name, str) else None
        users = _load_confirmation_users(store)
        # Merge/update
        merged = [u for u in (users or []) if isinstance(u, dict) and _normalize_email(str(u.get("email") or "")) != email]
        merged.append({"email": email, "password": pw, "name": (name if name else None)})
        _save_confirmation_users(store, merged)
        return {"data": {"email": email, "name": (name if name else None), "generated_password": generated}}
    except Exception as e:
        return {"error": str(e)}


class ConfirmationAdminUserDeleteRequest(BaseModel):
    store: Optional[str] = None
    email: str


@app.post("/api/confirmation/admin/users/delete")
async def api_confirmation_admin_user_delete(req: Request, body: ConfirmationAdminUserDeleteRequest):
    try:
        admin = _get_confirmation_admin(req)
        if not admin:
            return {"error": "unauthorized"}
        store = body.store
        email = _normalize_email(body.email)
        if not email:
            return {"error": "invalid_email"}
        users = _load_confirmation_users(store)
        kept = [u for u in (users or []) if isinstance(u, dict) and _normalize_email(str(u.get("email") or "")) != email]
        _save_confirmation_users(store, kept)
        return {"data": {"ok": True}}
    except Exception as e:
        return {"error": str(e)}


class ConfirmationAdminUserResetPasswordRequest(BaseModel):
    store: Optional[str] = None
    email: str
    password: Optional[str] = None  # if omitted, auto-generate


@app.post("/api/confirmation/admin/users/reset_password")
async def api_confirmation_admin_user_reset_password(req: Request, body: ConfirmationAdminUserResetPasswordRequest):
    try:
        admin = _get_confirmation_admin(req)
        if not admin:
            return {"error": "unauthorized"}
        store = body.store
        email = _normalize_email(body.email)
        if not email:
            return {"error": "invalid_email"}
        pw = (body.password or "").strip()
        generated = None
        if not pw:
            generated = _gen_password()
            pw = generated
        users = _load_confirmation_users(store)
        found = False
        merged: list[dict] = []
        for u in (users or []):
            if not isinstance(u, dict):
                continue
            if _normalize_email(str(u.get("email") or "")) == email:
                found = True
                merged.append({"email": email, "password": pw, "name": u.get("name")})
            else:
                merged.append(u)
        if not found:
            merged.append({"email": email, "password": pw, "name": None})
        _save_confirmation_users(store, merged)
        return {"data": {"email": email, "generated_password": generated}}
    except Exception as e:
        return {"error": str(e)}


class ConfirmationOrdersRequest(BaseModel):
    store: Optional[str] = None
    limit: Optional[int] = 50
    page_info: Optional[str] = None


@app.post("/api/confirmation/orders")
async def api_confirmation_orders(req: Request, body: ConfirmationOrdersRequest):
    try:
        agent = _get_confirmation_agent(req)
        if not agent:
            return {"error": "unauthorized", "data": {"orders": []}}
        agent_email = str((agent or {}).get("sub") or "").strip().lower()
        fields = ",".join([
            "id", "name", "created_at", "processed_at", "total_price", "currency",
            "tags", "financial_status", "fulfillment_status", "email", "phone",
            "customer", "shipping_address", "billing_address", "line_items",
        ])
        res = list_orders_open_unfulfilled(store=body.store, limit=int(body.limit or 50), page_info=body.page_info, fields=fields)
        orders = (res or {}).get("orders") or []
        out: list[dict] = []
        for o in orders:
            try:
                if not isinstance(o, dict):
                    continue
                # normalize tags to list for UI + filtering
                tags_list = _confirmation_tags_list(o.get("tags"))
                # Exclude confirmed (COD-tagged) orders from the open queue
                if has_cod_tag(tags_list):
                    continue
                # Optional: assignment routing (e.g., fz@conf.com)
                if not _confirmation_order_assigned_to_agent(o, tags_list, agent_email):
                    continue
                cust = o.get("customer") or {}
                ship = o.get("shipping_address") or {}
                bill = o.get("billing_address") or {}

                # Some shops frequently have guest checkouts: `customer` can be null/empty even though
                # `shipping_address` contains the buyer name/phone/address. Derive a usable "customer"
                # view model for the UI from both sources.
                ship_name = (ship.get("name") or "").strip()
                ship_first = (ship.get("first_name") or "").strip()
                ship_last = (ship.get("last_name") or "").strip()
                if (not ship_first or not ship_last) and ship_name and (" " in ship_name):
                    # Best-effort split for display
                    parts = [p for p in ship_name.split(" ") if p]
                    if parts and not ship_first:
                        ship_first = parts[0]
                    if len(parts) > 1 and not ship_last:
                        ship_last = " ".join(parts[1:])

                cust_first = (cust.get("first_name") or "").strip() or ship_first or None
                cust_last = (cust.get("last_name") or "").strip() or ship_last or None
                cust_email = (cust.get("email") or "").strip() or (o.get("email") or "").strip() or None

                # phone preference: order.phone > shipping.phone > customer.phone
                phone = (o.get("phone") or ship.get("phone") or cust.get("phone") or "")
                phone = str(phone).strip() if phone is not None else ""
                cust_phone = (cust.get("phone") or "").strip() or (ship.get("phone") or "").strip() or (o.get("phone") or "").strip() or None
                # slim items
                items = []
                for li in (o.get("line_items") or []):
                    if not isinstance(li, dict):
                        continue
                    items.append({
                        "title": li.get("title"),
                        "variant_title": li.get("variant_title"),
                        "quantity": li.get("quantity"),
                        "sku": li.get("sku"),
                    })
                out.append({
                    "id": str(o.get("id")),
                    "name": o.get("name"),
                    "created_at": o.get("created_at"),
                    "processed_at": o.get("processed_at"),
                    "total_price": o.get("total_price"),
                    "currency": o.get("currency"),
                    "financial_status": o.get("financial_status"),
                    "fulfillment_status": o.get("fulfillment_status"),
                    "email": o.get("email"),
                    "phone": phone,
                    "customer": {
                        "first_name": cust_first,
                        "last_name": cust_last,
                        "email": cust_email,
                        "phone": cust_phone,
                    },
                    "shipping_address": ship,
                    "billing_address": bill,
                    "line_items": items,
                    "tags": tags_list,
                })
            except Exception:
                continue
        return {"data": {"orders": out, "next_page_info": res.get("next_page_info"), "prev_page_info": res.get("prev_page_info")}}
    except Exception as e:
        return {"error": str(e), "data": {"orders": []}}


def _confirmation_agent_order_analytics(store: str | None, agent_email: str) -> dict:
    """Compute tag-based analytics from the open+unfulfilled order set for this store."""
    ae = (agent_email or "").strip().lower()
    if not ae:
        return {}
    # Pull all pages (best-effort) because the UI list is paginated.
    fields = "id,tags,financial_status"
    page_info: str | None = None
    max_pages = 20  # safety guard
    pages = 0

    assigned_total = 0
    n1 = n2 = n3 = 0
    any_n = 0
    no_n = 0
    all_n = 0  # has n1+n2+n3 simultaneously (rare, but supported)

    while True:
        res = list_orders_open_unfulfilled(store=store, limit=250, page_info=page_info, fields=fields)
        orders = (res or {}).get("orders") or []
        for o in (orders or []):
            try:
                if not isinstance(o, dict):
                    continue
                tags_list = _confirmation_tags_list(o.get("tags"))
                if has_cod_tag(tags_list):
                    continue
                if not _confirmation_order_assigned_to_agent(o, tags_list, ae):
                    continue
                assigned_total += 1
                tags_lc = {t.lower() for t in (tags_list or [])}
                has_n1 = "n1" in tags_lc
                has_n2 = "n2" in tags_lc
                has_n3 = "n3" in tags_lc
                if has_n1:
                    n1 += 1
                if has_n2:
                    n2 += 1
                if has_n3:
                    n3 += 1
                has_any_n = has_n1 or has_n2 or has_n3
                if has_any_n:
                    any_n += 1
                else:
                    no_n += 1
                if has_n1 and has_n2 and has_n3:
                    all_n += 1
            except Exception:
                continue
        page_info = (res or {}).get("next_page_info") or None
        if not page_info:
            break
        pages += 1
        if pages >= max_pages:
            break

    return {
        "assigned_total": assigned_total,
        "n1": n1,
        "n2": n2,
        "n3": n3,
        "any_n": any_n,
        "no_n": no_n,
        "all_n": all_n,
        "truncated": bool(page_info),  # True if we bailed early due to max_pages
    }


class ConfirmationOrderActionRequest(BaseModel):
    store: Optional[str] = None
    order_id: str
    action: str  # phone | whatsapp | confirm
    date: Optional[str] = None  # ISO (YYYY-MM-DD) or dd/mm/yy


def _to_ddmmyy(date_str: str) -> str:
    s = (date_str or "").strip()
    if re.match(r"^\d{2}/\d{2}/\d{2}$", s):
        return s
    if re.match(r"^\d{4}-\d{2}-\d{2}$", s):
        y, m, d = s.split("-")
        return f"{d}/{m}/{y[-2:]}"
    raise ValueError("invalid_date")


@app.post("/api/confirmation/order/action")
async def api_confirmation_order_action(req: Request, body: ConfirmationOrderActionRequest):
    try:
        agent = _get_confirmation_agent(req)
        if not agent:
            return {"error": "unauthorized"}
        store = body.store
        oid = (body.order_id or "").strip()
        action = (body.action or "").strip().lower()
        if not oid or not oid.isdigit():
            return {"error": "invalid_order_id"}
        if action == "phone":
            tags = cycle_tag(oid, "n", store=store, max_n=3)
            try:
                db.log_confirmation_event(store, agent.get("sub") or "unknown", oid, "phone")
            except Exception:
                pass
            return {"data": {"tags": tags}}
        if action == "whatsapp":
            tags = cycle_tag(oid, "wtp", store=store, max_n=3)
            try:
                db.log_confirmation_event(store, agent.get("sub") or "unknown", oid, "whatsapp")
            except Exception:
                pass
            return {"data": {"tags": tags}}
        if action == "confirm":
            ddmmyy = _to_ddmmyy(body.date or "")
            tags = set_cod_tag(oid, ddmmyy, store=store)
            try:
                db.log_confirmation_event(store, agent.get("sub") or "unknown", oid, "confirm", meta={"cod": ddmmyy})
            except Exception:
                pass
            return {"data": {"tags": tags, "cod": ddmmyy}}
        return {"error": "invalid_action"}
    except Exception as e:
        return {"error": str(e)}


@app.get("/api/confirmation/stats")
async def api_confirmation_stats(req: Request, store: str | None = None):
    try:
        agent = _get_confirmation_agent(req)
        if not agent:
            return {"error": "unauthorized", "data": {}}
        # For now expose aggregate counts per agent (confirm-only) for the store
        data = db.count_confirmation_events(store, kind="confirm")
        return {"data": data}
    except Exception as e:
        return {"error": str(e), "data": {}}


@app.get("/api/confirmation/agent/analytics")
async def api_confirmation_agent_analytics(req: Request, store: str | None = None):
    """Agent-facing analytics for the confirmation queue."""
    try:
        agent = _get_confirmation_agent(req)
        if not agent:
            return {"error": "unauthorized", "data": {}}
        agent_email = str((agent or {}).get("sub") or "").strip().lower()
        base = _confirmation_agent_order_analytics(store, agent_email)
        # confirmed count from event log (all-time for this store)
        try:
            confirmed_by_agent = db.count_confirmation_events(store, kind="confirm")
            base["confirmed_total"] = int((confirmed_by_agent or {}).get(agent_email, 0) or 0)
        except Exception:
            base["confirmed_total"] = 0
        return {"data": base}
    except Exception as e:
        return {"error": str(e), "data": {}}

@app.get("/api/confirmation/admin/analytics")
async def api_confirmation_admin_analytics(req: Request, store: str | None = None, days: int | None = 30):
    try:
        admin = _get_confirmation_admin(req)
        if not admin:
            return {"error": "unauthorized", "data": {}}
        data = db.confirmation_analytics(store, days=days)
        return {"data": data}
    except Exception as e:
        return {"error": str(e), "data": {}}


# ---------------- LLM step endpoints (interactive flow) ----------------
class AnglesRequest(BaseModel):
    product: ProductInput
    num_angles: Optional[int] = 2
    model: Optional[str] = None
    prompt: Optional[str] = None

@app.post("/api/llm/angles")
async def api_llm_angles(req: AnglesRequest):
    # Return full JSON so callers can use alternative schemas (e.g., offers)
    data = gen_angles_and_copy_full(req.product.model_dump(), model=req.model, prompt_override=req.prompt)
    k = max(1, min(5, req.num_angles or 2))
    try:
        if isinstance(data.get("angles"), list):
            data["angles"] = data["angles"][:k]
    except Exception:
        pass
    return data


class TitleDescRequest(BaseModel):
    product: ProductInput
    angle: dict
    prompt: Optional[str] = None
    model: Optional[str] = None
    image_urls: Optional[List[str]] = None

@app.post("/api/llm/title_desc")
async def api_llm_title_desc(req: TitleDescRequest):
    data = gen_title_and_description(
        req.product.model_dump(),
        req.angle,
        req.prompt,
        model=req.model,
        image_urls=req.image_urls or []
    )
    return data


class LandingCopyRequest(BaseModel):
    product: ProductInput
    angle: Optional[dict] = None
    title: Optional[str] = None
    description: Optional[str] = None
    model: Optional[str] = None
    prompt: Optional[str] = None
    image_urls: Optional[List[str]] = None
    product_url: Optional[str] = None
    product_handle: Optional[str] = None

@app.post("/api/llm/landing_copy")
async def api_llm_landing_copy(req: LandingCopyRequest):
    payload = req.product.model_dump()
    # include title/description in payload if provided to inform landing copy
    if req.title:
        payload["title"] = req.title
    if req.description:
        payload["description"] = req.description
    angles = [req.angle] if req.angle else []
    # Build product URL if provided via handle and we know the shop domain
    product_url = req.product_url
    if not product_url and req.product_handle:
        try:
            from app.integrations.shopify_client import SHOP
            if SHOP and req.product_handle:
                product_url = f"https://{SHOP}/products/{req.product_handle}"
        except Exception:
            product_url = None
    data = gen_landing_copy(payload, angles, model=req.model, image_urls=req.image_urls or [], prompt_override=req.prompt, product_url=product_url)
    return data

# Analyze landing page URL for ad inputs
class AnalyzeLandingRequest(BaseModel):
    url: str
    model: Optional[str] = None
    prompt: Optional[str] = None


@app.post("/api/llm/analyze_landing_page")
async def api_llm_analyze_landing_page(req: AnalyzeLandingRequest):
    try:
        data = analyze_landing_page(req.url, model=req.model, prompt_override=req.prompt)
        return data
    except Exception as e:
        return {"error": str(e), "url": req.url}
 
# ---------------- Agent SDK (experimental, promotion-only) ----------------
class AgentRequest(BaseModel):
    messages: list
    model: Optional[str] = None


@app.post("/api/agent/execute")
async def api_agent_execute(req: AgentRequest):
    try:
        out = run_agent_until_final(req.messages, model=req.model)
        return out
    except Exception as e:
        return {"error": str(e)}


@app.post("/api/agent/ads/execute")
async def api_agent_ads_execute(req: AgentRequest):
    try:
        out = run_ads_agent(req.messages, model=req.model)
        return out
    except Exception as e:
        return {"error": str(e)}

# ---------------- Angles Aggregation (URL/Text -> AgentOutput shape) ----------------
class AgentAnglesRequest(BaseModel):
    url: Optional[str] = None
    text: Optional[str] = None
    model: Optional[str] = None


@app.post("/api/agent/angles")
async def api_agent_angles(req: AgentAnglesRequest):
    try:
        result: list[dict] = []

        # If URL provided, analyze landing page to get angles with headlines/primaries
        if isinstance(req.url, str) and req.url.strip():
            analyzed = analyze_landing_page(req.url.strip(), model=req.model)
            for a in (analyzed.get("angles") or []):
                try:
                    name = (a or {}).get("name") or "Angle"
                    heads = (a or {}).get("headlines") or []
                    prims = (a or {}).get("primaries") or []
                    if isinstance(prims, dict):
                        prims = [prims.get("short"), prims.get("medium"), prims.get("long")]
                    prims = [p for p in prims if isinstance(p, str) and p.strip()]
                    result.append({
                        "angle_title": str(name),
                        "headlines": [str(h) for h in heads if isinstance(h, str) and h.strip()],
                        "ad_copies": prims,
                    })
                except Exception:
                    continue

        # If free-text provided (product description/notes), generate angles/copy
        if isinstance(req.text, str) and req.text.strip():
            payload = {
                "audience": "shoppers",
                "benefits": [],
                "pain_points": [],
                "description": req.text.strip(),
                "title": None,
            }
            full = gen_angles_and_copy_full(payload, model=req.model)
            for a in (full.get("angles") or []):
                try:
                    name = (a or {}).get("name") or "Angle"
                    heads = (a or {}).get("headlines") or []
                    primaries = (a or {}).get("primaries") or []
                    if isinstance(primaries, dict):
                        primaries = [primaries.get("short"), primaries.get("medium"), primaries.get("long")]
                    primaries = [p for p in primaries if isinstance(p, str) and p.strip()]
                    result.append({
                        "angle_title": str(name),
                        "headlines": [str(h) for h in heads if isinstance(h, str) and h.strip()],
                        "ad_copies": primaries,
                    })
                except Exception:
                    continue

        # If nothing produced, return empty default
        return {"angles": result}
    except Exception as e:
        return {"angles": [], "error": str(e)}

# ---------------- OpenAI Agent Builder: generic headless run ----------------
class AgentBuilderRunRequest(BaseModel):
    workflow_id: Optional[str] = None  # overrides env CHATKIT_WORKFLOW_ID
    version: Optional[str] = None      # workflow version (optional)
    input: Optional[dict] = None       # arbitrary input object expected by the workflow
    timeout_seconds: Optional[int] = 60


@app.post("/api/agentbuilder/run")
async def api_agentbuilder_run(req: AgentBuilderRunRequest):
    """Run an OpenAI Agent Builder workflow headlessly and return its raw output.

    - Uses Workflows HTTP API with the required beta header.
    - Accepts arbitrary input expected by your workflow; passthrough.
    - Returns { output, run_id, status } or { error }.
    """
    try:
        import os as _os, time as _time, requests as _requests
        wf = (req.workflow_id or CHATKIT_WORKFLOW_ID or "").strip()
        if not wf:
            return {"error": "missing_workflow_id"}
        headers = {
            "Authorization": f"Bearer {_os.environ.get('OPENAI_API_KEY','')}",
            "Content-Type": "application/json",
            # Allow the beta header value to be overridden without code changes
            "OpenAI-Beta": _os.environ.get("OPENAI_BETA_WORKFLOWS", "workflows=v1"),
        }
        # Optional scoping: project and organization
        _proj = _os.environ.get("OPENAI_PROJECT", "").strip()
        if _proj:
            headers["OpenAI-Project"] = _proj
        _org = _os.environ.get("OPENAI_ORG", "").strip()
        if _org:
            headers["OpenAI-Organization"] = _org
        body: dict = {"workflow": {"id": wf}}
        if isinstance(req.version, str) and req.version.strip():
            body["workflow"]["version"] = req.version.strip()
        if isinstance(req.input, dict):
            body["input"] = req.input

        _wf_base = _os.environ.get("OPENAI_WORKFLOWS_BASE_URL", "https://api.openai.com/v1/workflows").rstrip("/")
        r = _requests.post(f"{_wf_base}/runs", headers=headers, json=body, timeout=30)
        r.raise_for_status()
        run_id = (r.json() or {}).get("id")
        if not run_id:
            return {"error": "no_run_id", "details": r.json()}

        # Poll for completion
        deadline = _time.time() + max(10, int(req.timeout_seconds or 60))
        last = None
        status = "unknown"
        while _time.time() < deadline:
            _time.sleep(1)
            rr = _requests.get(f"{_wf_base}/runs/{run_id}", headers=headers, timeout=20)
            rr.raise_for_status()
            data = rr.json() or {}
            last = data
            status = str(data.get("status") or data.get("state") or "").lower()
            if status in ("completed", "succeeded", "failed", "cancelled", "canceled", "error"):
                break

        # Prefer common output fields
        out = None
        try:
            out = (last or {}).get("output") or (last or {}).get("response", {}).get("output") or (last or {}).get("final_output")
        except Exception:
            out = None
        return {"output": out, "run_id": run_id, "status": status}
    except Exception as e:
        return {"error": str(e)}

# ---------------- ChatKit headless run (UI integration) ----------------
class ChatKitRunRequest(BaseModel):
    mode: Optional[str] = None  # 'url' | 'text'
    url: Optional[str] = None
    text: Optional[str] = None
    model: Optional[str] = None
    workflow_id: Optional[str] = None  # overrides env CHATKIT_WORKFLOW_ID
    version: Optional[str] = None      # optional workflow version
    require_workflow: Optional[bool] = None  # if true, do not fallback
    # Optional: provide exact input object for your Workflow instead of default {url, text}
    workflow_input: Optional[dict] = None
    # Optional: enable verbose diagnostics
    debug: Optional[bool] = None
    # Optional: adjust workflow poll timeout (seconds)
    timeout_seconds: Optional[int] = None


@app.post("/api/chatkit/run")
async def api_chatkit_run(req: ChatKitRunRequest):
    """Headless trigger compatible with the Ads UI.

    First tries to execute the OpenAI Agent Builder workflow headlessly and map
    its final JSON to our AgentOutput shape. If that fails or is not configured,
    falls back to local analysis/generation to keep UX unblocked.
    """
    try:
        debug_enabled = bool(req.debug) or os.getenv("CHATKIT_DEBUG", "").lower() in ("1", "true", "yes", "debug")
        debug_info = {
            "request": {
                "mode": req.mode,
                "has_url": bool(req.url),
                "has_text": bool(req.text),
                "has_workflow_input": isinstance(req.workflow_input, dict),
                "require_workflow": bool(req.require_workflow),
            }
        }
        # 1) Attempt a headless Workflows run via OpenAI HTTP API
        try:
            import os as _os, time as _time, requests as _requests
            wf = (req.workflow_id or CHATKIT_WORKFLOW_ID or "").strip()
            if wf:
                headers = {
                    "Authorization": f"Bearer {_os.environ.get('OPENAI_API_KEY','')}",
                    "Content-Type": "application/json",
                    # Enable Workflows API (beta header name may evolve); allow env override
                    "OpenAI-Beta": _os.environ.get("OPENAI_BETA_WORKFLOWS", "workflows=v1"),
                }
                # Respect optional project/organization scoping
                _proj = _os.environ.get("OPENAI_PROJECT", "").strip()
                if _proj:
                    headers["OpenAI-Project"] = _proj
                _org = _os.environ.get("OPENAI_ORG", "").strip()
                if _org:
                    headers["OpenAI-Organization"] = _org
                # Build workflow input: prefer explicit workflow_input if provided
                input_obj = req.workflow_input if isinstance(req.workflow_input, dict) else {"url": (req.url or None), "text": (req.text or None)}
                body = {
                    "workflow": {"id": wf},
                    "input": input_obj,
                }
                if isinstance(req.version, str) and req.version.strip():
                    body["workflow"]["version"] = req.version.strip()
                if debug_enabled:
                    debug_info["workflow_request"] = {
                        "workflow_id": wf,
                        "version": body["workflow"].get("version"),
                        "input_keys": list((input_obj or {}).keys()),
                    }
                    logger.info("chatkit.run create wf=%s ver=%s keys=%s", wf, body["workflow"].get("version"), list((input_obj or {}).keys()))
                # Create run (configurable base URL for Workflows)
                _wf_base = _os.environ.get("OPENAI_WORKFLOWS_BASE_URL", "https://api.openai.com/v1/workflows").rstrip("/")
                run = _requests.post(f"{_wf_base}/runs", headers=headers, json=body, timeout=30)
                run.raise_for_status()
                run_id = (run.json() or {}).get("id")
                if debug_enabled:
                    debug_info["run_id"] = run_id
                    logger.info("chatkit.run run_id=%s", run_id)
                # Poll for completion (default ~60s, overridable)
                deadline = _time.time() + max(10, int(req.timeout_seconds or 60))
                last = None
                while _time.time() < deadline:
                    _time.sleep(1)
                    r = _requests.get(f"{_wf_base}/runs/{run_id}", headers=headers, timeout=20)
                    r.raise_for_status()
                    data = r.json() or {}
                    last = data
                    status = str(data.get("status") or data.get("state") or "").lower()
                    if status in ("completed", "succeeded", "failed", "cancelled", "canceled", "error"):
                        break
                if debug_enabled:
                    debug_info["run_status"] = str((last or {}).get("status") or (last or {}).get("state"))
                # Extract final output candidates
                out = None
                try:
                    out = (last or {}).get("output") or (last or {}).get("response", {}).get("output") or (last or {}).get("final_output")
                except Exception:
                    out = None
                if debug_enabled:
                    debug_info["output_type"] = type(out).__name__
                    try:
                        debug_info["output_keys"] = list((out or {}).keys()) if isinstance(out, dict) else None
                    except Exception:
                        debug_info["output_keys"] = None
                # Map to normalized outputs for multi-agent flows (angles/title/description/landing_copy/product/images)
                def _map_output(o: dict) -> dict:
                    norm: dict = {"angles": []}
                    if not isinstance(o, dict):
                        return norm
                    # Angles
                    angles_src = o.get("angles") or o.get("ads_angles") or o.get("ad_angles")
                    mapped: list[dict] = []
                    if isinstance(angles_src, list):
                        for a in angles_src:
                            if not isinstance(a, dict):
                                continue
                            title = a.get("angle_title") or a.get("title") or a.get("name") or a.get("angle") or "Untitled Angle"
                            headlines = a.get("headlines") or a.get("titles") or []
                            primaries = a.get("ad_copies") or a.get("copies") or a.get("descriptions") or a.get("primaries") or []
                            if isinstance(primaries, dict):
                                primaries = [primaries.get("short"), primaries.get("medium"), primaries.get("long")]
                            headlines = [str(h) for h in (headlines or []) if isinstance(h, str) and h.strip()]
                            primaries = [str(p) for p in (primaries or []) if isinstance(p, str) and p.strip()]
                            mapped.append({"angle_title": str(title), "headlines": headlines, "ad_copies": primaries})
                    elif any(k in o for k in ("angle_title", "headlines", "ad_copies", "primaries")):
                        try:
                            title = o.get("angle_title") or o.get("title") or o.get("name") or o.get("angle") or "Untitled Angle"
                            headlines = o.get("headlines") or o.get("titles") or []
                            primaries = o.get("ad_copies") or o.get("copies") or o.get("descriptions") or o.get("primaries") or []
                            if isinstance(primaries, dict):
                                primaries = [primaries.get("short"), primaries.get("medium"), primaries.get("long")]
                            headlines = [str(h) for h in (headlines or []) if isinstance(h, str) and h.strip()]
                            primaries = [str(p) for p in (primaries or []) if isinstance(p, str) and p.strip()]
                            mapped.append({"angle_title": str(title), "headlines": headlines, "ad_copies": primaries})
                        except Exception:
                            mapped = []
                    norm["angles"] = mapped
                    # Title/Description
                    norm["title"] = o.get("title") if isinstance(o.get("title"), str) else None
                    norm["description"] = o.get("description") if isinstance(o.get("description"), str) else None
                    # Landing copy
                    lc = o.get("landing_copy") or o.get("lp") or {}
                    norm["landing_copy"] = lc if isinstance(lc, dict) else None
                    # Product snapshot
                    prod = o.get("product") or {}
                    norm["product"] = prod if isinstance(prod, dict) else None
                    # Images
                    imgs = o.get("images") or o.get("image_urls") or []
                    if isinstance(imgs, list):
                        norm["images"] = [u for u in imgs if isinstance(u, str)]
                    else:
                        norm["images"] = []
                    return norm

                if isinstance(out, dict):
                    mapped = _map_output(out)
                    if debug_enabled:
                        logger.info("chatkit.run mapped angles=%d", len(mapped.get("angles") or []))
                    if mapped.get("angles"):
                        if debug_enabled:
                            mapped["debug"] = debug_info
                        return mapped
        except Exception as e:
            # Swallow workflow errors and fallback below
            if debug_enabled:
                debug_info["wf_error"] = str(e)
                try:
                    import requests as _requests
                    status = None
                    if isinstance(e, _requests.HTTPError):
                        try:
                            status = getattr(e.response, "status_code", None)
                        except Exception:
                            status = None
                        msg = f"chatkit.run workflow error status={status}"
                        if status == 404:
                            logger.warning(msg)
                        else:
                            logger.error(msg)
                    else:
                        logger.error("chatkit.run workflow error: %s", str(e))
                except Exception:
                    pass
            pass

        # 2) Fallback: reuse local analysis/generation mapping to AgentOutput
        if req.require_workflow:
            # Explicitly require the workflow; if we got here, return an error
            resp = {"angles": [], "error": "workflow_required_failed"}
            if debug_enabled:
                resp["debug"] = debug_info
                logger.info("chatkit.run failed (require_workflow) debug=%s", json.dumps(debug_info))
            return resp
        result: list[dict] = []
        if (req.mode == "url" and isinstance(req.url, str) and req.url.strip()) or (not req.mode and isinstance(req.url, str) and req.url.strip()):
            analyzed = analyze_landing_page(req.url.strip(), model=req.model)
            for a in (analyzed.get("angles") or []):
                try:
                    name = (a or {}).get("name") or "Angle"
                    heads = (a or {}).get("headlines") or []
                    prims = (a or {}).get("primaries") or []
                    if isinstance(prims, dict):
                        prims = [prims.get("short"), prims.get("medium"), prims.get("long")]
                    prims = [p for p in prims if isinstance(p, str) and p.strip()]
                    result.append({"angle_title": str(name), "headlines": [str(h) for h in heads if isinstance(h, str) and h.strip()], "ad_copies": prims})
                except Exception:
                    continue
        if (req.mode == "text" and isinstance(req.text, str) and req.text.strip()) or (not req.mode and isinstance(req.text, str) and req.text.strip()):
            payload = {"audience": "shoppers", "benefits": [], "pain_points": [], "description": req.text.strip(), "title": None}
            full = gen_angles_and_copy_full(payload, model=req.model)
            for a in (full.get("angles") or []):
                try:
                    name = (a or {}).get("name") or "Angle"
                    heads = (a or {}).get("headlines") or []
                    primaries = (a or {}).get("primaries") or []
                    if isinstance(primaries, dict):
                        primaries = [primaries.get("short"), primaries.get("medium"), primaries.get("long")]
                    primaries = [p for p in primaries if isinstance(p, str) and p.strip()]
                    result.append({"angle_title": str(name), "headlines": [str(h) for h in heads if isinstance(h, str) and h.strip()], "ad_copies": primaries})
                except Exception:
                    continue
        resp = {"angles": result}
        if debug_enabled:
            resp["debug"] = debug_info
            logger.info("chatkit.run fallback angles=%d", len(result))
        return resp
    except Exception as e:
        logger.exception("chatkit.run exception")
        return {"angles": [], "error": str(e)}

# ---------------- ChatKit server-mode endpoint (SSE/JSON) ----------------
@app.post("/chatkit")
async def chatkit_endpoint(request: Request):
    # Only available when chatkit package and our server wrapper are initialized
    if not chatkit_server:
        return Response(content=json.dumps({"error": "chatkit_server_disabled"}), media_type="application/json", status_code=503)
    # Minimal context: attach user hints if present (headers/cookies). Extend as needed.
    try:
        user_hint = request.headers.get("x-user-id") or request.cookies.get("user_id")
    except Exception:
        user_hint = None
    result = await chatkit_server.process(await request.body(), {"userId": user_hint})
    if _CKStreamingResult is not None and isinstance(result, _CKStreamingResult):
        return StreamingResponse(result, media_type="text/event-stream")
    return Response(content=result.json, media_type="application/json")

# ---------------- Translation API ----------------
class TranslateRequest(BaseModel):
    texts: list[str]
    target: str  # e.g., 'ar', 'fr', 'ary' for Moroccan Darija
    locale: Optional[str] = None
    domain: Optional[str] = "ads"
    model: Optional[str] = None


@app.post("/api/translate")
async def api_translate(req: TranslateRequest):
    try:
        out = translate_texts(req.texts or [], req.target, locale=req.locale, domain=req.domain, model=req.model)
        return {"translations": out, "target": req.target}
    except Exception as e:
        return {"translations": [], "error": str(e), "target": req.target}

# ---------------- Gemini image generation ----------------
class GeminiAdImageRequest(BaseModel):
    image_url: str
    prompt: str
    num_images: Optional[int] = 1
    # When true (default), enforce a clean neutral studio background. When false, allow natural scenes.
    neutral_background: Optional[bool] = True


@app.post("/api/gemini/ad_image")
async def api_gemini_ad_image(req: GeminiAdImageRequest):
    try:
        # Optionally enforce background replacement policy on ad-image prompts
        prompt = (req.prompt or "").strip()
        if req.neutral_background is None or bool(req.neutral_background):
            bg_rule = (
                " Always replace the original background with a new clean neutral studio backdrop. "
                "Never reuse the background from any provided or source images."
            )
            prompt = prompt + bg_rule
        imgs = gen_ad_images_from_image(req.image_url, prompt, req.num_images or 1)
        return {"images": imgs, "prompt": prompt, "input_image_url": req.image_url}
    except Exception as e:
        # Graceful error with empty images
        return {"images": [], "error": str(e), "prompt": (req.prompt or ""), "input_image_url": req.image_url}


class GeminiPromoSetRequest(BaseModel):
    product: ProductInput
    angles: List[dict]
    image_url: str
    count: Optional[int] = 4


@app.post("/api/gemini/promotional_set")
async def api_gemini_promotional_set(req: GeminiPromoSetRequest):
    try:
        items = gen_promotional_images_from_angles(req.image_url, req.product.model_dump(), req.angles or [], count=req.count or 4)
        return {"items": items, "model": "gemini-2.5-flash-image-preview", "input_image_url": req.image_url}
    except Exception as e:
        return {"items": [], "error": str(e), "model": "gemini-2.5-flash-image-preview", "input_image_url": req.image_url}
    
# Feature/Benefit close-up set
class GeminiFeatureBenefitRequest(BaseModel):
    product: ProductInput
    image_url: str
    count: Optional[int] = 6


@app.post("/api/gemini/feature_benefit_set")
async def api_gemini_feature_benefit_set(req: GeminiFeatureBenefitRequest):
    try:
        items = gen_feature_benefit_images(req.image_url, req.product.model_dump(), count=req.count or 6)
        return {"items": items, "model": "gemini-2.5-flash-image-preview", "input_image_url": req.image_url}
    except Exception as e:
        return {"items": [], "error": str(e), "model": "gemini-2.5-flash-image-preview", "input_image_url": req.image_url}

# Variant set (per-variant product images + composite)
class GeminiVariantSetRequest(BaseModel):
    image_url: str
    style_prompt: str | None = None
    max_variants: int | None = None
    # When provided, generate one image per provided variant using its description
    variant_descriptions: Optional[list[dict]] = None


@app.post("/api/gemini/variant_set")
async def api_gemini_variant_set(req: GeminiVariantSetRequest):
    try:
        items = gen_variant_images_from_image(
            req.image_url,
            style_prompt=req.style_prompt,
            max_variants=req.max_variants,
            variants_override=(req.variant_descriptions or None),
        )
        return {"items": items, "model": "gemini-2.5-flash-image-preview", "input_image_url": req.image_url}
    except Exception as e:
        return {"items": [], "error": str(e), "model": "gemini-2.5-flash-image-preview", "input_image_url": req.image_url}

# Suggest tailored prompts from an input image (no image generation)
class GeminiSuggestPromptsRequest(BaseModel):
    product: ProductInput
    image_url: str
    include_feature_benefit: Optional[bool] = True
    max_variants: Optional[int] = 5


@app.post("/api/gemini/suggest_prompts")
async def api_gemini_suggest_prompts(req: GeminiSuggestPromptsRequest):
    try:
        product = req.product.model_dump()
        # Base ad-image prompt similar to UI default with optional size hint
        base_prompt = (
            "Ultra eye‑catching ecommerce ad image derived ONLY from the provided product photo.\n"
            "Rules: Do NOT change product identity (colors/materials/shape/branding). No text or logos.\n"
            "Look: premium, high-contrast hero lighting, subtle rim light, soft gradient background, tasteful glow,\n"
            "clean reflections/shadow, product-first composition (rule of thirds/center), social-feed ready."
        )
        mid = _compute_midpoint_size_from_product(product)
        if mid:
            base_prompt = base_prompt + f" Ensure the product shown is size {mid} (midpoint of provided range)."

        # Variant prompts (one per detected variant)
        detected = analyze_variants_from_image(req.image_url, max_variants=req.max_variants)
        variant_prompts: list[dict] = []
        base_style = (
            "Professional ecommerce product photo, clean neutral background, soft studio lighting, crisp focus, "
            "subtle ground shadow, premium look, 45-degree camera angle, 4:5 crop. "
            "CRITICAL: Replace the original background with a new clean neutral studio backdrop; DO NOT reuse the source background."
        )
        for v in detected or []:
            name = (v or {}).get("name") or "Variant"
            desc = (v or {}).get("description") or ""
            prompt = (
                f"Create a clean standalone product image isolating the '{name}' variant from the reference photo. "
                f"Use the visual characteristics described: {desc}. {base_style}"
            )
            variant_prompts.append({"name": name, "description": desc, "prompt": prompt})

        feature_prompts: list[str] = []
        if req.include_feature_benefit:
            feature_prompts = build_feature_benefit_prompts(product, count=6)

        return {
            "input_image_url": req.image_url,
            "ad_prompt": base_prompt,
            "variant_prompts": variant_prompts,
            "feature_prompts": feature_prompts,
        }
    except Exception as e:
        return {
            "input_image_url": req.image_url,
            "ad_prompt": "",
            "variant_prompts": [],
            "feature_prompts": [],
            "error": str(e),
        }

# -------- Product extraction from image --------
class ProductFromImageRequest(BaseModel):
    image_url: str
    model: Optional[str] = None
    target_category: Optional[str] = None


@app.post("/api/llm/product_from_image")
async def api_llm_product_from_image(req: ProductFromImageRequest):
    try:
        data = gen_product_from_image(req.image_url, model=req.model, target_category=req.target_category)
        return {"product": data, "input_image_url": req.image_url}
    except Exception as e:
        return {"product": None, "error": str(e), "input_image_url": req.image_url}

# ---------------- Ads Automation (background) ----------------
class AdsAutomationLaunchRequest(BaseModel):
    flow_id: str
    landing_url: Optional[str] = None
    source_image: Optional[str] = None
    num_angles: Optional[int] = 3
    prompts: Optional[dict] = None  # { analyze_landing_prompt, angles_prompt, headlines_prompt, copies_prompt, gemini_ad_prompt }
    model: Optional[str] = None


def _ads_update(flow_id: str, *, ads: dict | None = None, product: dict | None = None, settings: dict | None = None, status: str | None = None, card_image: str | None = None):
    try:
        db.update_flow_row(flow_id, ads=ads, product=product, settings=settings, status=status, card_image=card_image)
    except Exception:
        pass


def _safe(obj: object, key: str, default):
    try:
        v = (obj or {}).get(key) if isinstance(obj, dict) else None
        return v if v is not None else default
    except Exception:
        return default


def run_ads_automation_sync(flow_id: str, payload: dict):
    """Runs the Ads flow in the background, updating the Flow row after each step.

    payload keys:
      - product: dict (audience, benefits[], pain_points[], title?, sizes?, colors?)
      - landing_url: str
      - source_image: str
      - prompts: dict
      - num_angles: int
      - model: str
    """
    f = db.get_flow(flow_id)
    if not f:
        return
    # Mark as running
    _ads_update(flow_id, status="running")
    try:
        product = (payload or {}).get("product") or (f.get("product") or {}) or {}
        prompts = (payload or {}).get("prompts") or (f.get("prompts") or {}) or {}
        landing_url = (payload or {}).get("landing_url") or f.get("page_url") or None
        source_image = (payload or {}).get("source_image") or _safe(f.get("settings") or {}, "cover_image", None)
        k = max(1, min(5, int((payload or {}).get("num_angles") or 3)))
        model = (payload or {}).get("model") or None

        ads = (f.get("ads") or {}) if isinstance(f.get("ads"), dict) else {}
        if landing_url:
            ads["landing_url"] = landing_url
        ads.setdefault("steps", [])
        _ads_update(flow_id, ads=ads)

        # Step 1: Analyze landing page (optional)
        analyzed_images: list[str] = []
        if landing_url:
            step = {"step": "analyze_landing_page", "status": "running", "started_at": time.time()}
            ads["steps"].append(step)
            _ads_update(flow_id, ads=ads)
            try:
                out = analyze_landing_page(landing_url, model=model, prompt_override=_safe(prompts, "analyze_landing_prompt", None))
                step["status"] = "completed"
                step["ended_at"] = time.time()
                step["response"] = out
                ads["analyze"] = out
                # Prefill product if empty fields
                try:
                    if isinstance(out.get("title"), str) and out.get("title") and not product.get("title"):
                        product["title"] = out.get("title")
                    for key in ("benefits", "pain_points"):
                        if not product.get(key) and isinstance(out.get(key), list):
                            product[key] = out.get(key)
                except Exception:
                    pass
                # Candidate images from analysis
                try:
                    analyzed_images = [u for u in (out.get("images") or []) if isinstance(u, str)]
                except Exception:
                    analyzed_images = []
                _ads_update(flow_id, ads=ads, product=product)
            except Exception as e:
                step["status"] = "failed"
                step["ended_at"] = time.time()
                step["error"] = {"message": str(e)}
                _ads_update(flow_id, ads=ads)

        # Step 2: Angles (prefer analyze angles; else generate)
        angles: list[dict] = []
        try:
            if isinstance(ads.get("analyze", {}).get("angles"), list) and ads.get("analyze", {}).get("angles"):
                angles = ads.get("analyze", {}).get("angles")[:k]
            else:
                step = {"step": "generate_angles", "status": "running", "started_at": time.time()}
                ads["steps"].append(step)
                _ads_update(flow_id, ads=ads)
                data = gen_angles_and_copy_full(product, model=model, prompt_override=_safe(prompts, "angles_prompt", None))
                angles = (data.get("angles") or [])[:k]
                step["status"] = "completed"
                step["ended_at"] = time.time()
                step["response"] = {"angles": angles}
            ads["angles"] = angles
            _ads_update(flow_id, ads=ads)
        except Exception as e:
            try:
                step["status"] = "failed"  # type: ignore
                step["ended_at"] = time.time()  # type: ignore
                step["error"] = {"message": str(e)}  # type: ignore
            except Exception:
                pass
            _ads_update(flow_id, ads=ads, status="failed")
            return

        # Step 3: Per-angle expansions (headlines, copies, images)
        per_angle: list[dict] = []
        ads["per_angle"] = per_angle
        # Select a source image
        src_image = source_image or (analyzed_images[0] if analyzed_images else None)
        for idx, a in enumerate(angles or []):
            item = {"angle": a, "headlines": [], "primaries": [], "images": []}
            per_angle.append(item)
            # Headlines
            try:
                step = {"step": "generate_headlines", "angle_index": idx, "status": "running", "started_at": time.time()}
                ads["steps"].append(step)
                _ads_update(flow_id, ads=ads)
                # Inject ANGLE context into the prompt override
                base = _safe(prompts, "headlines_prompt", None)
                if base:
                    base = str(base).strip() + "\n\nANGLE: " + _json.dumps(a, ensure_ascii=False)
                out = gen_angles_and_copy_full(product, model=model, prompt_override=base)
                arr = out.get("angles") or []
                # Aggregate headlines
                heads: list[str] = []
                for it in arr:
                    hs = it.get("headlines") if isinstance(it.get("headlines"), list) else []
                    for h in hs:
                        if isinstance(h, str) and h.strip() and len(heads) < 12:
                            heads.append(h.strip())
                item["headlines"] = heads[:8]
                step["status"] = "completed"
                step["ended_at"] = time.time()
                step["response"] = {"headlines": item["headlines"]}
                _ads_update(flow_id, ads=ads)
            except Exception as e:
                step["status"] = "failed"  # type: ignore
                step["ended_at"] = time.time()  # type: ignore
                step["error"] = {"message": str(e)}  # type: ignore
                _ads_update(flow_id, ads=ads)

            # Copies
            try:
                step = {"step": "generate_copies", "angle_index": idx, "status": "running", "started_at": time.time()}
                ads["steps"].append(step)
                _ads_update(flow_id, ads=ads)
                base = _safe(prompts, "copies_prompt", None)
                if base:
                    base = str(base).strip() + "\n\nANGLE: " + _json.dumps(a, ensure_ascii=False)
                out = gen_angles_and_copy_full(product, model=model, prompt_override=base)
                arr = out.get("angles") or []
                prims: list[str] = []
                for it in arr:
                    ps = []
                    if isinstance(it.get("primaries"), list):
                        ps = it.get("primaries") or []
                    elif isinstance(it.get("primaries"), dict):
                        cand = [it.get("primaries", {}).get("short"), it.get("primaries", {}).get("medium"), it.get("primaries", {}).get("long")]
                        ps = [p for p in cand if isinstance(p, str)]
                    for p in ps:
                        if isinstance(p, str) and p.strip() and len(prims) < 12:
                            prims.append(p.strip())
                item["primaries"] = prims[:2]
                step["status"] = "completed"
                step["ended_at"] = time.time()
                step["response"] = {"primaries": item["primaries"]}
                _ads_update(flow_id, ads=ads)
            except Exception as e:
                step["status"] = "failed"  # type: ignore
                step["ended_at"] = time.time()  # type: ignore
                step["error"] = {"message": str(e)}  # type: ignore
                _ads_update(flow_id, ads=ads)

            # Images
            try:
                step = {"step": "generate_images", "angle_index": idx, "status": "running", "started_at": time.time()}
                ads["steps"].append(step)
                _ads_update(flow_id, ads=ads)
                src = src_image or (product.get("uploaded_images", [None])[0])
                if not src and isinstance(ads.get("analyze", {}).get("images"), list):
                    arr_imgs = ads.get("analyze", {}).get("images") or []
                    src = arr_imgs[0] if arr_imgs else None
                if src:
                    offer_text = ""
                    try:
                        offers = ads.get("analyze", {}).get("offers") if isinstance(ads.get("analyze"), dict) else []
                        if isinstance(offers, list) and offers:
                            offer_text = f" Emphasize the offer/promotion: {offers[0]}"
                    except Exception:
                        offer_text = ""
                    base_prompt = _safe(prompts, "gemini_ad_prompt", "Create a high\u200a-quality ad image from this product photo. No text, premium look.")
                    angle_suffix = (" Angle: " + str(a.get("name"))) if isinstance(a.get("name"), str) else ""
                    prompt = f"{base_prompt}{offer_text}{angle_suffix}"
                    imgs = gen_ad_images_from_image(src, prompt, num_images=4)
                else:
                    imgs = []
                item["images"] = imgs
                # Opportunistically set card_image to a Shopify CDN URL if present in outputs
                card_image = None
                try:
                    for u in imgs:
                        if isinstance(u, str) and u.startswith("https://cdn.shopify.com"):
                            card_image = u
                            break
                except Exception:
                    card_image = None
                step["status"] = "completed"
                step["ended_at"] = time.time()
                step["response"] = {"images": imgs}
                # Update settings.assets_used.feature_gallery
                settings = f.get("settings") or {}
                try:
                    assets = settings.get("assets_used") or {}
                    gallery = list(assets.get("feature_gallery") or [])
                    for u in imgs:
                        if isinstance(u, str) and u not in gallery:
                            gallery.append(u)
                    assets["feature_gallery"] = gallery
                    settings["assets_used"] = assets
                except Exception:
                    settings = settings or {}
                _ads_update(flow_id, ads=ads, settings=settings, card_image=card_image)
            except Exception as e:
                step["status"] = "failed"  # type: ignore
                step["ended_at"] = time.time()  # type: ignore
                step["error"] = {"message": str(e)}  # type: ignore
                _ads_update(flow_id, ads=ads)

        # Done
        _ads_update(flow_id, ads=ads, status="completed")
    except Exception as e:
        try:
            ads = (db.get_flow(flow_id) or {}).get("ads") or {}
            steps = ads.get("steps") or []
            steps.append({"step": "fatal", "status": "failed", "error": {"message": str(e)}, "ended_at": time.time()})
            ads["steps"] = steps
            _ads_update(flow_id, ads=ads, status="failed")
        except Exception:
            _ads_update(flow_id, status="failed")


@app.post("/api/flows/ads/launch")
async def api_ads_launch(req: AdsAutomationLaunchRequest):
    try:
        f = db.get_flow(req.flow_id)
        if not f:
            return {"error": "not_found"}
        # If already running or completed, don't enqueue a duplicate
        status = f.get("status")
        if status in ("running", "completed"):
            return {"flow_id": req.flow_id, "status": status}
        payload = {
            "product": f.get("product") or {},
            "landing_url": req.landing_url or f.get("page_url"),
            "source_image": req.source_image,
            "prompts": req.prompts or (f.get("prompts") or {}),
            "num_angles": req.num_angles or 3,
            "model": req.model,
        }
        t = threading.Thread(target=run_ads_automation_sync, args=(req.flow_id, payload), daemon=True)
        t.start()
        return {"flow_id": req.flow_id, "status": "queued"}
    except Exception as e:
        return {"error": str(e)}


# ---------------- Agents API ----------------
class AgentCreateRequest(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    instruction: Optional[str] = None
    output_pref: Optional[str] = None


@app.post("/api/agents")
async def api_create_agent(req: AgentCreateRequest):
    try:
        db.create_agent(req.id, req.name, req.description, req.instruction, req.output_pref)
        return {"ok": True, "id": req.id}
    except Exception as e:
        return {"error": str(e)}


@app.get("/api/agents")
async def api_list_agents(limit: int | None = None):
    try:
        return {"data": db.list_agents(limit=limit)}
    except Exception as e:
        return {"error": str(e), "data": []}


# -------- Meta Ad Account (persist per store) --------
class AdAccountSetRequest(BaseModel):
    id: str
    store: Optional[str] = None


@app.get("/api/meta/ad_account")
async def api_get_ad_account(store: str | None = None):
    try:
        conf = db.get_app_setting(store, "meta_ad_account") or {}
        # Enrich with name live from Meta if we have id
        out = {}
        try:
            acct_id = _normalize_ad_acct_id(((conf or {}).get("id") if isinstance(conf, dict) else None))
            if acct_id:
                info = get_ad_account_info(acct_id)
                out = {"id": info.get("id"), "name": info.get("name")}
            else:
                out = {}
        except Exception:
            out = conf if isinstance(conf, dict) else {}
        return {"data": out}
    except Exception as e:
        return {"error": str(e), "data": {}}


@app.post("/api/meta/ad_account")
async def api_set_ad_account(req: AdAccountSetRequest):
    try:
        acct_id = _normalize_ad_acct_id((req.id or "").strip())
        if not acct_id:
            return {"error": "missing_id"}
        # Verify account and get name
        info = get_ad_account_info(acct_id)
        saved = db.set_app_setting(req.store, "meta_ad_account", {"id": info.get("id") or acct_id, "name": info.get("name")})
        return {"data": saved}
    except Exception as e:
        return {"error": str(e)}


@app.get("/api/meta/ad_accounts")
async def api_list_ad_accounts():
    try:
        items = list_ad_accounts()
        # light shape
        data = [{"id": x.get("id"), "name": x.get("name"), "account_status": x.get("account_status")} for x in (items or [])]
        return {"data": data}
    except Exception as e:
        return {"error": str(e), "data": []}


class CampaignStatusUpdateRequest(BaseModel):
    status: str  # ACTIVE | PAUSED


@app.post("/api/meta/campaigns/{campaign_id}/status")
async def api_update_campaign_status(campaign_id: str, req: CampaignStatusUpdateRequest):
    try:
        status = (req.status or "").upper()
        if status not in ("ACTIVE", "PAUSED"):
            return {"error": "invalid_status"}
        res = await run_in_threadpool(set_campaign_status, campaign_id, status)
        # Verify the update succeeded
        if isinstance(res, dict) and res.get("error"):
            return {"error": str(res.get("error"))}
        # Invalidate all caches that contain campaign status data
        _invalidate_caches_for_status_change()
        return {"data": res, "status": status}
    except Exception as e:
        return {"error": str(e)}


@app.get("/api/meta/campaigns/{campaign_id}/adsets")
async def api_get_campaign_adsets(campaign_id: str, date_preset: str | None = None, start: str | None = None, end: str | None = None):
    try:
        key = _cache_key("meta_campaign_adsets", {"campaign_id": campaign_id, "date_preset": date_preset or "last_7d", "start": start or None, "end": end or None})

        async def _compute():
            return await run_in_threadpool(list_adsets_with_insights, campaign_id, date_preset or "last_7d", since=start, until=end)

        items = await _cached(key, 30, _compute)
        return {"data": items}
    except Exception as e:
        return {"error": str(e), "data": []}


@app.get("/api/meta/campaigns/{campaign_id}/adsets/orders")
async def api_campaign_adset_orders(campaign_id: str, start: str, end: str, store: str | None = None, stores: str | None = None):
    """Attribute Shopify orders to ad sets by matching UTM parameters.

    Dual-strategy attribution:
      1) Match orders whose utm_campaign == campaign_id (campaign-level match)
         Then attribute to ad-set via:
         a) explicit ad_id or adset_id UTM param
         b) utm_content matching ad-set name
         c) If no ad-set match, bucket under "__campaign__" (unattributed to specific ad set)
      2) Fallback: match via ad_id -> adset reverse map (legacy behavior)

    Supports multi-store: pass ?stores=store1,store2 or ?store=single_store
    Returns mapping: { adset_id: { count: number, orders: [...] } }
    """
    started = time.perf_counter()
    try:
        # Parse store list: prefer comma-separated ?stores= param, fall back to single ?store=
        store_list: list[str] | None = None
        if stores:
            store_list = [s.strip() for s in stores.split(",") if s.strip()]
        elif store:
            store_list = [store]

        key = _cache_key("meta_campaign_adset_orders_v3", {"campaign_id": campaign_id, "start": start, "end": end, "stores": store_list or None})
        db_cache_key = "cache:" + key
        try:
            cached = db.get_app_setting((store_list or [store or ""])[0], db_cache_key) or {}
            if isinstance(cached, dict):
                ts = float(cached.get("ts") or 0)
                cached_data = cached.get("data")
                if ts > 0 and (time.time() - ts) <= 300 and isinstance(cached_data, dict) and len(cached_data) > 0:
                    return {"data": cached.get("data")}
        except Exception:
            pass

        async def _compute():
            import asyncio

            # 1) List ad sets for campaign and their ads — run in parallel
            async def _fetch_adsets():
                try:
                    return await asyncio.wait_for(run_in_threadpool(list_adsets_with_insights, campaign_id, "last_7d"), timeout=10)
                except Exception:
                    return []

            async def _fetch_orders():
                try:
                    if store_list and len(store_list) > 1:
                        return await asyncio.wait_for(
                            run_in_threadpool(list_orders_with_utms_processed_multi, start, end, stores=store_list, include_closed=True),
                            timeout=32,
                        )
                    single = store_list[0] if store_list else store
                    return await asyncio.wait_for(
                        run_in_threadpool(list_orders_with_utms_processed, start, end, store=single, include_closed=True),
                        timeout=32,
                    )
                except Exception:
                    return []

            adsets, orders = await asyncio.gather(_fetch_adsets(), _fetch_orders())

            adset_ids = [str((a or {}).get("adset_id") or "") for a in (adsets or []) if (a or {}).get("adset_id")]

            # Build ad-set name lookup for utm_content matching
            adset_name_to_id: dict[str, str] = {}
            for a in (adsets or []):
                aid = str((a or {}).get("adset_id") or "")
                name = str((a or {}).get("name") or "").strip()
                if aid and name:
                    adset_name_to_id[name.lower()] = aid

            # Fetch ads for ad-set reverse mapping (ad_id -> adset_id)
            try:
                ads_by_adset = await asyncio.wait_for(run_in_threadpool(list_ads_for_adsets, adset_ids), timeout=8)
            except Exception:
                ads_by_adset = {}
            ad_to_adset: dict[str, str] = {}
            for aid, ad_ids in (ads_by_adset or {}).items():
                for ad in (ad_ids or []):
                    if ad:
                        ad_to_adset[str(ad)] = str(aid)

            # 3) Attribution: dual strategy
            result: dict[str, dict] = {}

            def _add_order(adset_id: str, o: dict, ad_id_used: str | None):
                bucket = result.setdefault(adset_id, {"count": 0, "orders": []})
                bucket["count"] = int(bucket.get("count", 0)) + 1
                bucket["orders"].append({
                    "order_id": o.get("order_id"),
                    "name": o.get("name"),
                    "processed_at": o.get("processed_at"),
                    "total_price": o.get("total_price"),
                    "currency": o.get("currency"),
                    "landing_site": o.get("landing_site"),
                    "utm": o.get("utm") or {},
                    "ad_id": ad_id_used or o.get("ad_id"),
                    "campaign_id": o.get("campaign_id"),
                    "store": o.get("store"),
                })

            campaign_id_str = str(campaign_id).strip()

            # Pre-compute ad-set name variants for fuzzy matching
            # Strip common suffixes like "AdSet", "Ad Set", etc.
            import re as _re
            adset_name_clean: dict[str, str] = {}  # cleaned_name -> adset_id
            adset_name_words: dict[str, str] = {}  # individual significant word -> adset_id (only if unique)
            word_to_adsets: dict[str, list[str]] = {}  # word -> [adset_ids] for uniqueness check
            for name_lower, aid in adset_name_to_id.items():
                # Strip common suffixes
                cleaned = _re.sub(r'\s*(adset|ad\s*set)\s*$', '', name_lower, flags=_re.IGNORECASE).strip()
                if cleaned:
                    adset_name_clean[cleaned] = aid
                # Collect individual words (>= 3 chars, not generic)
                skip_words = {'adset', 'ad', 'set', 'the', 'and', 'for', 'with', 'test', 'campaign'}
                for word in _re.split(r'[\s_\-]+', cleaned):
                    word = word.strip().lower()
                    if word and len(word) >= 3 and word not in skip_words:
                        word_to_adsets.setdefault(word, []).append(aid)
            # Only use word matching when word uniquely identifies one adset
            for word, aids in word_to_adsets.items():
                if len(set(aids)) == 1:
                    adset_name_words[word] = aids[0]

            # Build ad name -> adset mapping (for matching utm_content to ad names)
            ad_name_to_adset: dict[str, str] = {}
            for aid_str in adset_ids:
                try:
                    ad_list = (ads_by_adset or {}).get(aid_str) or []
                    # We need ad names too — fetch them if available
                except Exception:
                    pass

            # Determine if single adset (all campaign orders should go to it)
            single_adset = adset_ids[0] if len(adset_ids) == 1 else None

            for o in (orders or []):
                try:
                    o_campaign_id = str((o or {}).get("campaign_id") or "").strip()
                    o_ad_id = str((o or {}).get("ad_id") or "").strip()
                    o_adset_id_direct = str((o or {}).get("adset_id") or "").strip()
                    utm = (o or {}).get("utm") or {}
                    o_adset_id_utm = str(utm.get("adset_id") or "").strip()
                    o_utm_content = str(utm.get("utm_content") or "").strip()

                    attributed = False
                    adset_ids_set = set(str(x) for x in adset_ids)

                    # ===== STRATEGY 0: Direct adset_id from URL =====
                    # Meta auto-tagging puts adset_id in utm_medium/utm_term
                    # Our parser extracts it as order.adset_id — most reliable match
                    if o_adset_id_direct and o_adset_id_direct in adset_ids_set:
                        _add_order(o_adset_id_direct, o, o_ad_id or None)
                        attributed = True

                    # ===== STRATEGY A: Campaign-level match with sub-attribution =====
                    if not attributed and o_campaign_id and o_campaign_id == campaign_id_str:
                        target_adset = None

                        # A1: Explicit adset_id in UTM query param (our new ad creation includes this)
                        if o_adset_id_utm and o_adset_id_utm in adset_ids_set:
                            target_adset = o_adset_id_utm
                        # A2: ad_id maps to a known ad -> adset
                        elif o_ad_id and o_ad_id in ad_to_adset:
                            target_adset = ad_to_adset[o_ad_id]
                        # A3: utm_content exact match with ad-set name
                        elif o_utm_content and o_utm_content.lower() in adset_name_to_id:
                            target_adset = adset_name_to_id[o_utm_content.lower()]
                        # A4: utm_content matches cleaned ad-set name (without "AdSet" suffix)
                        elif o_utm_content and o_utm_content.lower() in adset_name_clean:
                            target_adset = adset_name_clean[o_utm_content.lower()]
                        else:
                            if o_utm_content:
                                content_lower = o_utm_content.lower().strip()
                                content_cleaned = _re.sub(r'\s*(adset|ad\s*set)\s*$', '', content_lower, flags=_re.IGNORECASE).strip()
                                # A5: Partial match — utm_content within ad-set name or vice-versa
                                for name_lower, aid in adset_name_to_id.items():
                                    if content_cleaned in name_lower or name_lower in content_cleaned:
                                        target_adset = aid
                                        break
                                # A6: Cleaned partial match
                                if not target_adset:
                                    for cleaned, aid in adset_name_clean.items():
                                        if content_cleaned in cleaned or cleaned in content_cleaned:
                                            target_adset = aid
                                            break
                                # A7: Word-level match — any significant word uniquely identifies an adset
                                if not target_adset:
                                    for word in _re.split(r'[\s_\-]+', content_cleaned):
                                        word = word.strip().lower()
                                        if word and word in adset_name_words:
                                            target_adset = adset_name_words[word]
                                            break

                        # A8: If only one adset exists, attribute ALL campaign orders to it
                        if not target_adset and single_adset:
                            target_adset = single_adset

                        if target_adset:
                            _add_order(target_adset, o, o_ad_id or None)
                        else:
                            # Last resort: unattributed campaign-level order
                            _add_order("__campaign__", o, o_ad_id or None)
                        attributed = True

                    # ===== STRATEGY B: Legacy ad_id -> adset reverse lookup =====
                    if not attributed and o_ad_id and o_ad_id in ad_to_adset:
                        _add_order(ad_to_adset[o_ad_id], o, o_ad_id)
                        attributed = True

                except Exception:
                    continue
            return result

        result = await asyncio.wait_for(_cached(key, 60, _compute), timeout=45)
        if result:
            try:
                db.set_app_setting((store_list or [store or ""])[0], db_cache_key, {"ts": time.time(), "data": result or {}})
            except Exception:
                pass
        return {"data": result}
    except asyncio.TimeoutError:
        shopify_logger.warning(
            "meta.campaign_adset_orders timeout campaign_id=%s stores=%s elapsed_ms=%s",
            campaign_id,
            stores or store,
            int((time.perf_counter() - started) * 1000),
        )
        return {"error": "campaign_adset_orders_timeout", "data": {}}
    except Exception as e:
        return {"error": str(e), "data": {}}


class AdsetStatusUpdateRequest(BaseModel):
    status: str


@app.post("/api/meta/adsets/{adset_id}/status")
async def api_update_adset_status(adset_id: str, req: AdsetStatusUpdateRequest):
    try:
        status = (req.status or "").upper()
        if status not in ("ACTIVE", "PAUSED"):
            return {"error": "invalid_status"}
        res = await run_in_threadpool(set_adset_status, adset_id, status)
        # Verify the update succeeded
        if isinstance(res, dict) and res.get("error"):
            return {"error": str(res.get("error"))}
        # Invalidate all caches that contain adset status data
        _invalidate_caches_for_status_change()
        return {"data": res, "status": status}
    except Exception as e:
        return {"error": str(e)}


@app.get("/api/meta/campaigns/{campaign_id}/performance")
async def api_campaign_performance(campaign_id: str, days: int | None = 6, tz: str | None = None):
    try:
        n = int(days or 6)
        items = campaign_daily_insights(campaign_id, n, tz)
        return {"data": {"days": items}}
    except Exception as e:
        return {"error": str(e), "data": {"days": []}}

@app.get("/api/agents/{agent_id}")
async def api_get_agent(agent_id: str):
    try:
        a = db.get_agent(agent_id)
        if not a:
            return {"error": "not_found"}
        return a
    except Exception as e:
        return {"error": str(e)}


class AgentUpdateRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    instruction: Optional[str] = None
    output_pref: Optional[str] = None


@app.put("/api/agents/{agent_id}")
async def api_update_agent(agent_id: str, req: AgentUpdateRequest):
    try:
        ok = db.update_agent(agent_id, name=req.name, description=req.description, instruction=req.instruction, output_pref=req.output_pref)
        return {"ok": ok}
    except Exception as e:
        return {"error": str(e)}


class AgentRunCreateRequest(BaseModel):
    title: Optional[str] = None
    status: Optional[str] = None
    input: Optional[dict] = None


@app.post("/api/agents/{agent_id}/runs")
async def api_create_agent_run(agent_id: str, req: AgentRunCreateRequest):
    from uuid import uuid4 as _uuid4
    try:
        run_id = str(_uuid4())
        db.create_agent_run(agent_id, run_id, title=req.title, status=(req.status or "draft"), input=(req.input or {}))
        return {"id": run_id}
    except Exception as e:
        return {"error": str(e)}


class AgentRunUpdateRequest(BaseModel):
    title: Optional[str] = None
    status: Optional[str] = None
    input: Optional[dict] = None
    output: Optional[dict] = None
    messages: Optional[list] = None


@app.put("/api/agents/{agent_id}/runs/{run_id}")
async def api_update_agent_run(agent_id: str, run_id: str, req: AgentRunUpdateRequest):
    try:
        ok = db.update_agent_run(agent_id, run_id, title=req.title, status=req.status, input=req.input, output=req.output, messages=req.messages)
        return {"ok": ok}
    except Exception as e:
        return {"error": str(e)}


@app.get("/api/agents/{agent_id}/runs")
async def api_list_agent_runs(agent_id: str, limit: int | None = None):
    try:
        return {"data": db.list_agent_runs(agent_id, limit=limit)}
    except Exception as e:
        return {"error": str(e), "data": []}


@app.get("/api/agents/{agent_id}/runs/{run_id}")
async def api_get_agent_run(agent_id: str, run_id: str):
    try:
        r = db.get_agent_run(agent_id, run_id)
        if not r:
            return {"error": "not_found"}
        return r
    except Exception as e:
        return {"error": str(e)}
# ---------------- Flows/Drafts ----------------
class DraftSaveRequest(BaseModel):
    product: ProductInput
    image_urls: Optional[List[str]] = None
    flow: Optional[dict] = None  # { nodes:[], edges:[] }
    ui: Optional[dict] = None    # { pan, zoom, selected }
    prompts: Optional[dict] = None  # { angles_prompt, title_desc_prompt, landing_copy_prompt }
    settings: Optional[dict] = None  # { model, advantage_plus, adset_budget, targeting, countries, saved_audience_id }
    ads: Optional[dict] = None      # Ad inputs state from Ads tab (headline, primary, images, etc.)
    card_image: Optional[str] = None  # Preferred card image (Shopify CDN URL)


@app.post("/api/flows/draft")
async def api_save_draft(req: DraftSaveRequest):
    from uuid import uuid4 as _uuid4
    test_id = str(_uuid4())
    payload = req.product.model_dump()
    if req.image_urls:
        payload["uploaded_images"] = req.image_urls
    # Attach optional extras so the UI can restore a full snapshot
    if req.flow is not None:
        payload["flow"] = req.flow
    if req.ui is not None:
        payload["ui"] = req.ui
    if req.prompts is not None:
        payload["prompts"] = req.prompts
    if req.settings is not None:
        payload["settings"] = req.settings
    if req.card_image:
        payload["card_image"] = req.card_image
    # Legacy: persist in tests for backwards compatibility
    db.create_test_row(test_id, payload, status="draft")
    # Structured: also persist in flows table for fast, reliable loads
    try:
        # Merge uploaded image URLs into product snapshot for structured storage
        prod_struct = req.product.model_dump()
        if req.image_urls:
            prod_struct["uploaded_images"] = req.image_urls
        db.create_flow_row(
            test_id,
            product=prod_struct,
            flow=req.flow,
            ui=req.ui,
            prompts=req.prompts,
            settings=req.settings,
            ads=req.ads,
            status="draft",
            page_url=None,
            card_image=(payload.get("card_image") if isinstance(payload, dict) else None),
        )
    except Exception:
        pass
    return {"id": test_id, "status": "draft"}


@app.put("/api/flows/draft/{test_id}")
async def api_update_draft(test_id: str, req: DraftSaveRequest):
    # Build new payload from request (full snapshot)
    payload = req.product.model_dump()
    if req.image_urls:
        payload["uploaded_images"] = req.image_urls
    if req.flow is not None:
        payload["flow"] = req.flow
    if req.ui is not None:
        payload["ui"] = req.ui
    if req.prompts is not None:
        payload["prompts"] = req.prompts
    if req.settings is not None:
        payload["settings"] = req.settings
    if req.card_image:
        payload["card_image"] = req.card_image
    ok = db.update_test_payload(test_id, payload)
    if not ok:
        # If the draft doesn't exist yet (e.g., deep-link open), create it on first save
        db.create_test_row(test_id, payload, status="draft")
    # Mirror to structured flows table
    try:
        prod_struct = req.product.model_dump()
        if req.image_urls:
            prod_struct["uploaded_images"] = req.image_urls
        updated = db.update_flow_row(
            test_id,
            product=prod_struct,
            flow=req.flow,
            ui=req.ui,
            prompts=req.prompts,
            settings=req.settings,
            ads=req.ads,
            card_image=(payload.get("card_image") if isinstance(payload, dict) else None),
        )
        if not updated:
            db.create_flow_row(
                test_id,
                product=prod_struct,
                flow=req.flow,
                ui=req.ui,
                prompts=req.prompts,
                settings=req.settings,
                ads=req.ads,
                status="draft",
                page_url=None,
                card_image=(payload.get("card_image") if isinstance(payload, dict) else None),
            )
    except Exception:
        pass
    return {"id": test_id, "status": "draft"}


# -------- Flows API (structured) --------
@app.get("/api/flows/{flow_id}")
async def api_get_flow(flow_id: str):
    try:
        f = db.get_flow(flow_id)
        if not f:
            return {"error": "not_found"}
        return f
    except Exception as e:
        return {"error": str(e)}


@app.get("/api/flows")
async def api_list_flows(limit: int | None = None, store: str | None = None):
    try:
        # When no limit provided, return all flows; otherwise cap to 200
        eff = None if (limit is None) else min(max(limit, 1), 200)
        items = db.list_flows_light(limit=eff, store=store)
        return {"data": items}
    except Exception as e:
        return {"error": str(e), "data": []}


@app.delete("/api/flows/{flow_id}")
async def api_delete_flow(flow_id: str):
    """Delete a flow and any locally stored uploads referenced by it.

    Shopify CDN images cannot be deleted from here; only local /uploads files are removed.
    """
    try:
        f = db.get_flow(flow_id)
        # Attempt to delete any local uploads referenced in product.uploaded_images
        try:
            from urllib.parse import urlparse
            uploaded = []
            if isinstance((f or {}).get("product"), dict):
                uploaded = (f.get("product") or {}).get("uploaded_images") or []  # type: ignore
            for u in uploaded or []:
                if not isinstance(u, str):
                    continue
                # Only delete local uploads
                if "/uploads/" in u and (u.startswith("/") or "://" in u):
                    path = urlparse(u).path
                    if path.startswith("/uploads/"):
                        fname = path.split("/uploads/")[-1]
                        try:
                            from pathlib import Path
                            p = Path(UPLOADS_DIR) / fname
                            if p.exists():
                                p.unlink(missing_ok=True)  # type: ignore
                        except Exception:
                            continue
        except Exception:
            pass

        # Delete rows from both structured flows and legacy tests
        try:
            db.delete_flow_row(flow_id)
        except Exception:
            pass
        try:
            db.delete_test_row(flow_id)
        except Exception:
            pass
        return {"ok": True}
    except Exception as e:
        return {"error": str(e)}


class ShopifyCreateRequest(BaseModel):
    product: ProductInput
    angle: Optional[dict] = None
    title: str
    description: str
    landing_copy: dict
    image_urls: Optional[List[str]] = None
    store: Optional[str] = None

@app.post("/api/shopify/create_from_copy")
async def api_shopify_create_from_copy(req: ShopifyCreateRequest):
    payload = req.product.model_dump()
    # include description for image alt text generation on Shopify
    if req.description:
        payload["description"] = req.description
    if req.image_urls:
        payload["uploaded_images"] = req.image_urls
    angles = [req.angle] if req.angle else []
    creatives = []
    page = create_product_and_page(payload, angles, creatives, req.landing_copy, store=req.store)
    # persist minimal row for convenience
    test_id = str(uuid4())
    db.create_test_row(test_id, payload)
    db.set_test_result(test_id, page, None, creatives, angles=angles, trace=[{"step":"shopify","response":{"page":page}}])
    return {"page_url": page.get("url") if isinstance(page, dict) else None, "test_id": test_id}


# Create product immediately after title/description approval
class ShopifyProductCreateRequest(BaseModel):
    product: ProductInput
    angle: Optional[dict] = None
    title: str
    description: Optional[str] = None
    store: Optional[str] = None


@app.post("/api/shopify/product_create_from_title_desc")
async def api_shopify_product_create_from_title_desc(req: ShopifyProductCreateRequest):
    try:
        payload = req.product.model_dump()
        if req.description:
            payload["description"] = req.description
        # Create product with variants/options/pricing when provided. Description is set later via update.
        result = create_product_only(
            req.title,
            description_html=None,
            status="ACTIVE",
            price=payload.get("base_price"),
            sizes=payload.get("sizes") or None,
            colors=payload.get("colors") or None,
            product_type=payload.get("product_type") or None,
            track_quantity=payload.get("track_quantity"),
            quantity=payload.get("quantity"),
            variants=payload.get("variants"),
            store=req.store,
        )
        prod = (result or {}).get("product") or {}
        report = (result or {}).get("report") or {"ok": True}
        return {"product_gid": prod.get("id"), "handle": prod.get("handle"), "report": report}
    except Exception as e:
        return {"error": str(e)}


class ShopifyUpdateDescriptionRequest(BaseModel):
    product_gid: str
    description_html: str
    store: Optional[str] = None


@app.post("/api/shopify/update_description")
async def api_shopify_update_description(req: ShopifyUpdateDescriptionRequest):
    prod = update_product_description(req.product_gid, req.description_html, store=req.store)
    return {"product_gid": prod.get("id"), "handle": prod.get("handle")}


class ShopifyUpdateTitleRequest(BaseModel):
    product_gid: str
    title: str
    store: Optional[str] = None


@app.post("/api/shopify/update_title")
async def api_shopify_update_title(req: ShopifyUpdateTitleRequest):
    prod = update_product_title(req.product_gid, req.title, store=req.store)
    return {"product_gid": prod.get("id"), "handle": prod.get("handle")}


class ShopifyCreatePageFromCopyRequest(BaseModel):
    title: str
    landing_copy: dict
    image_urls: Optional[List[str]] = None
    product_gid: Optional[str] = None
    store: Optional[str] = None


@app.post("/api/shopify/create_page_from_copy")
async def api_shopify_create_page_from_copy(req: ShopifyCreatePageFromCopyRequest):
    # Build simple alt texts if image URLs are provided
    sections = (req.landing_copy or {}).get("sections") or []
    base_title = req.title or "Product"
    alt_texts: List[str] = []
    for idx, _ in enumerate(req.image_urls or []):
        sec = sections[idx] if idx < len(sections) else {}
        sec_title = sec.get("title") or "Product image"
        sec_body = sec.get("body") or ""
        alt_texts.append(f"{base_title} — {sec_title}: {sec_body[:80]}")
    # Build the same HTML body that will be used on the page for optional product description update
    body_html = _build_page_body_html(req.title, req.landing_copy, req.image_urls or [], alt_texts)
    # Pass precomputed body_html to avoid rebuilding large HTML twice
    page = create_page_from_copy(req.title, req.landing_copy, req.image_urls or [], alt_texts, body_html_override=body_html, store=req.store)
    # Optionally update product description to match landing body
    try:
        if req.product_gid:
            update_product_description(req.product_gid, body_html, store=req.store)
            try:
                # Link landing page to product via product metafield for visibility in admin
                _link_product_landing_page(req.product_gid, page.get("page_gid"), store=req.store)
            except Exception:
                pass
    except Exception:
        pass
    return {"page_url": page.get("url")}


# Dedicated endpoint to upload images to a Shopify product and return Shopify CDN URLs
class ShopifyUploadImagesRequest(BaseModel):
    product_gid: str
    image_urls: List[str]
    title: Optional[str] = None
    description: Optional[str] = None
    landing_copy: Optional[dict] = None
    store: Optional[str] = None


@app.post("/api/shopify/upload_images")
async def api_shopify_upload_images(req: ShopifyUploadImagesRequest):
    # Build alt texts using provided landing copy sections or title/description
    sections = (req.landing_copy or {}).get("sections") if req.landing_copy else []
    base_title = req.title or "Product"
    base_desc = req.description or ""
    alt_texts: List[str] = []
    for idx, _ in enumerate(req.image_urls or []):
        sec = (sections[idx] if (sections and idx < len(sections)) else {}) or {}
        sec_title = sec.get("title") or "Product image"
        sec_body = sec.get("body") or base_desc
        alt_texts.append(f"{base_title} — {sec_title}: {sec_body[:80]}")
    verbose = upload_images_to_product_verbose(req.product_gid, req.image_urls or [], alt_texts, store=req.store)
    # Poll for images for a short time to allow Shopify to fetch/process
    images = []
    try:
        import time
        for _ in range(6):  # ~6 seconds total
            images = list_product_images(req.product_gid, store=req.store)
            if images:
                break
            time.sleep(1)
    except Exception:
        pass
    # If we have at least one CDN URL, opportunistically update the flow card_image for the latest flow id if provided in request headers
    try:
        flow_id = None
        import re as _re
        # Allow client to pass a flow id in X-Flow-Id header
        from fastapi import Request as _Req  # type: ignore
    except Exception:
        pass
    return {"urls": verbose.get("cdn_urls", []), "images": images, "per_image": verbose.get("per_image", [])}


# Upload local files directly to Shopify via base64 attachments
@app.post("/api/shopify/upload_files")
async def api_shopify_upload_files(
    request: Request,
    product_gid: str = Form(...),
    files: List[UploadFile] = File(...),
    title: Optional[str] = Form(None),
    description: Optional[str] = Form(None),
    landing_copy: Optional[str] = Form(None),  # JSON string (optional)
    store: Optional[str] = Form(None),
):
    sections = []
    try:
        if landing_copy:
            import json as _json
            sections = (_json.loads(landing_copy) or {}).get("sections") or []
    except Exception:
        sections = []
    base_title = title or "Product"
    base_desc = description or ""
    alt_texts: List[str] = []
    for idx, _ in enumerate(files or []):
        sec = (sections[idx] if (sections and idx < len(sections)) else {}) or {}
        sec_title = sec.get("title") or "Product image"
        sec_body = sec.get("body") or base_desc
        alt_texts.append(f"{base_title} — {sec_title}: {sec_body[:80]}")

    # Read all file bytes
    blobs: List[tuple[str, bytes]] = []
    for f in (files or []):
        blobs.append((f.filename, await f.read()))

    verbose = upload_image_attachments_to_product(product_gid, blobs, alt_texts, store=store)

    # Poll for images
    images = []
    try:
        import time
        for _ in range(8):  # ~8s
            images = list_product_images(product_gid, store=store)
            if images:
                break
            time.sleep(1)
    except Exception:
        pass
    return {"urls": verbose.get("cdn_urls", []), "images": images, "per_image": verbose.get("per_image", [])}


# Simple uploads endpoint to store images and return absolute URLs for multimodal prompts or Shopify
@app.post("/api/uploads")
async def api_uploads(request: Request, files: List[UploadFile] = File(...)):
    upload_id = str(uuid4())
    f_proto = request.headers.get("x-forwarded-proto")
    f_host = request.headers.get("x-forwarded-host")
    host = f_host or request.headers.get("host")
    scheme = f_proto or request.url.scheme
    req_base = f"{scheme}://{host}" if host else str(request.base_url).rstrip("/")
    if BASE_URL and ("localhost" not in BASE_URL and "127.0.0.1" not in BASE_URL):
        abs_base = BASE_URL.rstrip("/")
    else:
        abs_base = req_base
    urls: List[str] = []
    for i, f in enumerate(files or []):
        filename = f"{upload_id}_{i}_{f.filename}"
        url_path = save_file(filename, await f.read())
        encoded_path = quote(url_path, safe="/:")
        if abs_base.endswith("/"):
            urls.append(f"{abs_base[:-1]}{encoded_path}")
        else:
            urls.append(f"{abs_base}{encoded_path}")
    return {"urls": urls}


@app.get("/proxy/image")
async def proxy_image(url: str):
    """Fetch a remote image server-side and return it as same-origin.

    Notes:
      - Only allows http(s) URLs
      - Blocks private/local addresses to avoid SSRF
      - Ensures response is an image (or octet-stream with guessed image type)
    """
    try:
        import requests  # Local import to avoid slowing cold start
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https"):
            return Response(status_code=400, content=b"invalid scheme")
        host = (parsed.hostname or "").lower()
        # Basic SSRF guard: block localhost/private ranges
        forbidden_hosts = {"localhost", "127.0.0.1", "::1"}
        if host in forbidden_hosts:
            return Response(status_code=400, content=b"forbidden host")
        # Block obvious private IPs
        try:
            import ipaddress
            try:
                ip = ipaddress.ip_address(host)
                if ip.is_private or ip.is_loopback or ip.is_link_local:
                    return Response(status_code=400, content=b"forbidden ip")
            except ValueError:
                # host is a domain name; ok to continue
                pass
        except Exception:
            pass

        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
            "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        }
        r = requests.get(url, headers=headers, timeout=20)
        r.raise_for_status()
        ctype = r.headers.get("Content-Type", "").split(";")[0].strip().lower()
        data = r.content
        # Accept image/* or guess when octet-stream
        if not ctype.startswith("image/"):
            # Some CDNs use octet-stream; attempt to guess from URL
            guessed, _ = mimetypes.guess_type(url)
            if guessed and guessed.startswith("image/"):
                ctype = guessed
            else:
                # As a last resort, try to infer PNG to avoid CORB when browsers sniff
                # but reject non-image sizes > 10MB
                if len(data) > 10 * 1024 * 1024:
                    return Response(status_code=415, content=b"unsupported content")
                # Fallback: deny non-image content types explicitly
                return Response(status_code=415, content=b"unsupported content-type")

        resp = StreamingResponse(io.BytesIO(data), media_type=ctype)
        resp.headers["Cache-Control"] = "public, max-age=86400"
        resp.headers["Access-Control-Allow-Origin"] = "*"
        resp.headers["X-Content-Type-Options"] = "nosniff"
        return resp
    except Exception as e:
        return Response(status_code=502, content=str(e).encode("utf-8"))


class MetaLaunchRequest(BaseModel):
    product: ProductInput
    page_url: str
    creatives: Optional[list] = None

@app.post("/api/meta/launch_from_page")
async def api_meta_launch_from_page(req: MetaLaunchRequest):
    # For now delegate to existing helper
    try:
        # legacy path: no angles/creatives provided; we still create a paused campaign with no ads
        campaign = create_campaign_with_ads({"page_url": req.page_url, **req.product.model_dump()}, [], req.creatives or [], req.page_url)
        return {"campaign_id": (campaign or {}).get("campaign_id")}
    except Exception as e:
        return {"error": str(e)}


class MetaDraftImageCampaignRequest(BaseModel):
    headline: str
    primary_text: str
    description: Optional[str] = None
    image_url: str
    landing_url: str
    call_to_action: Optional[str] = "SHOP_NOW"
    adset_budget: Optional[float] = 9.0
    targeting: Optional[dict] = None
    saved_audience_id: Optional[str] = None
    campaign_name: Optional[str] = None
    adset_name: Optional[str] = None
    ad_name: Optional[str] = None
    creative_name: Optional[str] = None
    title: Optional[str] = None


@app.post("/api/meta/draft_image_campaign")
async def api_meta_draft_image_campaign(req: MetaDraftImageCampaignRequest):
    try:
        res = create_draft_image_campaign(req.model_dump())
        return {
            "campaign_id": res.get("campaign_id"),
            "adsets": res.get("adsets"),
            "requests": res.get("requests"),
        }
    except Exception as e:
        return {"error": str(e)}


class MetaDraftCarouselCampaignRequest(BaseModel):
    primary_text: str
    landing_url: str
    cards: List[dict]  # [{ image_url, headline?, description?, link?, call_to_action? }]
    call_to_action: Optional[str] = "SHOP_NOW"
    adset_budget: Optional[float] = 9.0
    targeting: Optional[dict] = None
    saved_audience_id: Optional[str] = None
    campaign_name: Optional[str] = None
    adset_name: Optional[str] = None
    ad_name: Optional[str] = None
    creative_name: Optional[str] = None
    title: Optional[str] = None


@app.post("/api/meta/draft_carousel_campaign")
async def api_meta_draft_carousel_campaign(req: MetaDraftCarouselCampaignRequest):
    try:
        res = create_draft_carousel_campaign(req.model_dump())
        return {
            "campaign_id": res.get("campaign_id"),
            "adsets": res.get("adsets"),
            "requests": res.get("requests"),
        }
    except Exception as e:
        return {"error": str(e)}

@app.get("/health")
async def health():
    return {"ok": True}

# ---------------- ChatKit (OpenAI-hosted) session endpoint ----------------
class ChatKitSessionRequest(BaseModel):
    workflow_id: Optional[str] = None
    user: Optional[str] = None
    version: Optional[str] = None


@app.post("/api/chatkit/session")
async def create_chatkit_session(req: ChatKitSessionRequest):
    try:
        import os as _os, requests as _requests
        wf = (req.workflow_id or CHATKIT_WORKFLOW_ID or "").strip()
        if not wf:
            return {"error": "missing_workflow_id"}
        ver_env = _os.environ.get("CHATKIT_WORKFLOW_VERSION", "").strip()
        ver = (req.version or ver_env or "").strip()
        api_key = _os.environ.get("OPENAI_API_KEY", "").strip()
        if not api_key:
            return {"error": "missing_openai_api_key"}
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            # Required beta header for ChatKit sessions
            "OpenAI-Beta": "chatkit_beta=v1",
        }
        body = {
            "workflow": {"id": wf},
            "user": (req.user or str(uuid4())),
        }
        if ver:
            body["workflow"]["version"] = ver
        r = _requests.post("https://api.openai.com/v1/chatkit/sessions", headers=headers, json=body, timeout=20)
        r.raise_for_status()
        data = r.json() or {}
        secret = data.get("client_secret")
        if not secret:
            return {"error": "no_client_secret", "details": data}
        return {"client_secret": secret}
    except Exception as e:
        return {"error": str(e)}

# Bulk delete all agents (cleanup)
@app.delete("/api/agents")
async def api_delete_all_agents():
    try:
        n = db.delete_all_agents()
        return {"ok": True, "deleted": n}
    except Exception as e:
        return {"error": str(e)}

# Utility endpoint to (re)configure Shopify product variants and inventory
class ShopifyConfigureVariantsRequest(BaseModel):
    product_gid: str
    base_price: Optional[float] = None
    sizes: Optional[List[str]] = None
    colors: Optional[List[str]] = None
    track_quantity: Optional[bool] = None
    quantity: Optional[int] = None
    variants: Optional[List[VariantInput]] = None
    store: Optional[str] = None


@app.post("/api/shopify/configure_variants")
async def api_shopify_configure_variants(req: ShopifyConfigureVariantsRequest):
    res = configure_variants_for_product(
        req.product_gid,
        req.base_price,
        req.sizes,
        req.colors,
        req.track_quantity,
        req.quantity,
        # Pydantic models serialize to dicts when dumped by FastAPI
        [v.model_dump() for v in (req.variants or [])] if isinstance(req.variants, list) else None,
        store=req.store,
    )
    return res


# ===================== Wholesale Vendor Dashboard (MMD Store) =====================

WHOLESALE_STORE = "mmd"  # internal store label for the MMD Shopify store
WHOLESALE_TAG = "wholesale"
WHOLESALE_DASHBOARD_TAG = "wholesale_vendor_dashboard"
WHOLESALE_CUSTOMER_TAG = "wholesale_vendor_customer"


THEME_EDITOR_SWATCH_SNIPPET_KEY = "snippets/ptos-variant-swatches.liquid"
THEME_EDITOR_SWATCH_SECTION_KEY = "sections/ptos-variant-swatches.liquid"
THEME_EDITOR_SWATCH_LAYOUT_MARKER = "<!-- PTOS_THEME_EDITOR_SWATCHES -->"

THEME_EDITOR_SWATCH_SNIPPET = r"""{% comment %}
  Product Testing OS variant swatch upgrade.
  Installed by the app to make mixed color and size bundle variants easier to read.
{% endcomment %}
{% if request.page_type == 'product' %}
<style>
  .ptos-swatch-ready variant-radios fieldset,
  .ptos-swatch-ready variant-selects fieldset,
  .ptos-swatch-ready .product-form__input {
    gap: 10px;
  }

  .ptos-swatch-ready .product-form__input input[type='radio'] + label.ptos-option-label {
    border-radius: 12px;
    border: 1.5px solid #d4d7de;
    background: #fff;
    color: #0f172a;
    min-height: 82px;
    padding: 0;
    overflow: visible;
    box-shadow: 0 4px 14px rgba(15, 23, 42, .04);
    transition: transform .18s ease, border-color .18s ease, box-shadow .18s ease;
  }

  .ptos-swatch-ready .product-form__input input[type='radio'] + label.ptos-option-label:hover {
    transform: translateY(-1px);
    border-color: rgba(15, 23, 42, .28);
    box-shadow: 0 9px 18px rgba(15, 23, 42, .08);
  }

  .ptos-swatch-ready .product-form__input input[type='radio']:checked + label.ptos-option-label {
    border-color: #111827;
    background: #f7f8fa;
    color: #0f172a;
    box-shadow: 0 0 0 1px #111827, 0 9px 18px rgba(15, 23, 42, .10);
  }

  .ptos-swatch-ready .product-form__input input[type='radio']:disabled + label.ptos-option-label {
    opacity: .42;
    transform: none;
  }

  .ptos-swatch-ready .ptos-enhance-size input[type='radio'] + label:not([data-ptos-rendered-size]),
  .ptos-swatch-ready .ptos-enhance-color input[type='radio'] + label:not([data-ptos-rendered-color]) {
    opacity: 0;
  }

  .ptos-swatch-label {
    display: flex;
    flex-direction: column;
    width: 100%;
    min-width: 140px;
    line-height: 1.1;
    font-weight: 800;
    letter-spacing: 0;
  }

  .ptos-size-card {
    position: relative;
    display: grid;
    gap: 9px;
    min-width: 140px;
    padding: 16px 14px 15px;
    text-align: center;
  }

  .ptos-size-row {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 9px;
  }

  .ptos-size-to {
    color: #1f2937;
    font-size: 15px;
    font-weight: 900;
    text-transform: uppercase;
  }

  .ptos-size-eyebrow {
    display: none;
  }

  .ptos-size-range {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: #0f172a;
    font-size: 20px;
    font-weight: 950;
  }

  .ptos-size-pack {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    justify-content: center;
    width: 100%;
    max-width: 100%;
    border-radius: 0;
    background: transparent;
    color: #374151;
    border: 0;
    padding: 0;
    font-size: 14px;
    font-weight: 500;
  }

  .ptos-size-icon {
    display: inline-grid;
    place-items: center;
    width: 17px;
    height: 17px;
    border-radius: 0;
    background: transparent;
    color: #374151;
    font-size: 0;
    font-weight: 950;
    line-height: 1;
  }

  .ptos-size-icon::before {
    content: '';
    width: 10px;
    height: 10px;
    border: 2px solid currentColor;
    border-top: 0;
    border-left: 0;
    transform: rotate(45deg);
  }

  .ptos-swatch-ready .product-form__input input[type='radio'] + label.ptos-color-label,
  .ptos-swatch-ready .product-form__input input[type='radio']:checked + label.ptos-color-label {
    min-height: 0;
    border: 1.5px solid #d4d7de;
    border-radius: 14px;
    background: #fff;
    color: #111827;
    padding: 0;
    box-shadow: 0 4px 14px rgba(15, 23, 42, .04);
    transform: none;
    overflow: hidden;
  }

  .ptos-swatch-ready .product-form__input input[type='radio']:checked + label.ptos-color-label {
    border-color: #111827;
    box-shadow: 0 0 0 1px #111827, 0 9px 18px rgba(15, 23, 42, .10);
  }

  .ptos-color-card {
    display: grid;
    min-width: 154px;
    max-width: 210px;
    line-height: 1.1;
    direction: ltr;
  }

  .ptos-color-title {
    display: block;
    padding: 10px 12px 8px;
    border-bottom: 1px solid #e5e7eb;
    color: #020617;
    font-size: 13px;
    font-weight: 950;
    text-align: center;
    background: #fff;
    white-space: normal;
  }

  .ptos-rtl .ptos-color-title {
    direction: rtl;
  }

  .ptos-color-bars {
    display: grid;
    min-height: 47px;
    width: 100%;
  }

  .ptos-color-bar {
    display: block;
    min-width: 46px;
    box-shadow: inset -1px 0 rgba(15, 23, 42, .13), inset 0 0 0 1px rgba(15, 23, 42, .05);
  }

  .ptos-color-bar:last-child {
    box-shadow: inset 0 0 0 1px rgba(15, 23, 42, .05);
  }

  .ptos-size-check {
    display: none;
  }

  .ptos-swatch-ready .product-form__input input[type='radio']:checked + label.ptos-option-label .ptos-size-check {
    display: none;
  }

  .ptos-swatch-ready .product-form__input input[type='radio']:checked + label.ptos-option-label .ptos-size-range,
  .ptos-swatch-ready .product-form__input input[type='radio']:checked + label.ptos-option-label .ptos-size-pack {
    color: #020617;
  }

  .ptos-price-card {
    margin: 16px 0 18px;
    max-width: 100%;
    border: 1px solid #dde1e7;
    border-radius: 18px;
    background: #f7f8fa;
    padding: 24px 28px;
    box-shadow: 0 1px 2px rgba(15, 23, 42, .04), inset 0 0 0 1px rgba(15, 23, 42, .015);
    direction: ltr;
    text-align: left;
  }

  .ptos-price-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 24px;
    padding-bottom: 20px;
    border-bottom: 1px solid #d8dde5;
  }

  .ptos-price-cell {
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-width: 0;
  }

  .ptos-price-label {
    display: block;
    color: #3f4654;
    font-size: 12px;
    font-weight: 900;
    letter-spacing: .12em;
    text-transform: uppercase;
  }

  .ptos-price-unit {
    color: #020617;
    font-size: clamp(34px, 7vw, 54px);
    font-weight: 950;
    line-height: .95;
    white-space: nowrap;
  }

  .ptos-price-crate {
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  .ptos-price-crate-value {
    color: #020617;
    font-size: clamp(30px, 6vw, 48px);
    font-weight: 950;
    line-height: .95;
    max-width: 12ch;
    word-break: normal;
  }

  .ptos-price-meta {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
    padding-top: 18px;
  }

  .ptos-price-offer {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    flex-wrap: wrap;
  }

  .ptos-price-compare {
    color: #76777d;
    font-size: 14px;
    font-weight: 500;
    text-decoration: line-through;
    white-space: nowrap;
  }

  .ptos-price-save {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 32px;
    padding: 0 14px;
    border-radius: 999px;
    background: #fd761a;
    color: #5c2400;
    font-size: 12px;
    font-weight: 900;
    line-height: 1;
    text-transform: uppercase;
  }

  .ptos-price-stock {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-height: 46px;
    padding: 0 18px;
    border-radius: 999px;
    background: #e6e8ea;
    color: #565e74;
    font-size: 12px;
    font-weight: 900;
    letter-spacing: .04em;
    text-transform: uppercase;
    text-align: center;
  }

  .ptos-price-stock-icon {
    position: relative;
    width: 17px;
    height: 17px;
    border: 2px solid currentColor;
    border-radius: 3px;
    box-sizing: border-box;
  }

  .ptos-price-stock-icon::before {
    content: '';
    position: absolute;
    left: 2px;
    right: 2px;
    top: 4px;
    height: 2px;
    background: currentColor;
  }

  .ptos-price-stock-icon::after {
    content: '';
    position: absolute;
    left: 4px;
    right: 4px;
    bottom: 3px;
    height: 5px;
    border: 2px solid currentColor;
    border-top: 0;
    border-radius: 0 0 2px 2px;
    box-sizing: border-box;
  }

  .ptos-rtl .product__info-container,
  .ptos-rtl .product__info-container h1,
  .ptos-rtl .product__info-container h2,
  .ptos-rtl .product__info-container h3,
  .ptos-rtl .product__info-container p,
  .ptos-rtl .product__info-container legend,
  .ptos-rtl .product__info-container label:not(.ptos-option-label):not(.ptos-color-label),
  .ptos-rtl .product__title,
  .ptos-rtl .price,
  .ptos-rtl .badge {
    direction: rtl;
    text-align: right;
  }

  .ptos-rtl .product__media-wrapper,
  .ptos-rtl slider-component,
  .ptos-rtl .thumbnail-slider,
  .ptos-rtl .product-media-container {
    direction: ltr;
  }

  .ptos-rtl .product,
  .ptos-rtl .product__media-wrapper,
  .ptos-rtl .product__info-wrapper,
  .ptos-rtl .product-form,
  .ptos-rtl variant-radios,
  .ptos-rtl variant-selects,
  .ptos-rtl .product-form__input {
    direction: ltr;
  }

  .ptos-rtl .ptos-price-card,
  .ptos-rtl .ptos-size-card,
  .ptos-rtl .ptos-size-range,
  .ptos-rtl .ptos-size-pack {
    direction: ltr;
  }

  .ptos-rtl .ptos-price-card,
  .ptos-rtl .ptos-price-compare,
  .ptos-rtl .ptos-price-label,
  .ptos-rtl .ptos-price-unit,
  .ptos-rtl .ptos-price-crate-value,
  .ptos-rtl .ptos-price-save,
  .ptos-rtl .ptos-price-stock,
  .ptos-rtl .ptos-color-card {
    text-align: left;
  }

  @media (max-width: 749px) {
    .ptos-swatch-ready .product-form__input input[type='radio'] + label.ptos-option-label {
      width: 100%;
      max-width: 100%;
    }

    .ptos-swatch-label,
    .ptos-size-card {
      min-width: 0;
    }

    .ptos-price-card {
      max-width: 100%;
      padding: 20px 18px;
    }

    .ptos-price-grid {
      gap: 16px;
      padding-bottom: 16px;
    }

    .ptos-price-offer {
      gap: 10px;
    }

    .ptos-price-unit {
      font-size: clamp(30px, 10vw, 42px);
    }

    .ptos-price-crate-value {
      font-size: clamp(24px, 8vw, 38px);
    }
  }
</style>
<script>
  (function () {
    if (window.PTOSVariantSwatchesLoaded) return;
    window.PTOSVariantSwatchesLoaded = true;

    function detectRtl() {
      var html = document.documentElement;
      var lang = (html.getAttribute('lang') || '').toLowerCase();
      var dir = (html.getAttribute('dir') || document.body.getAttribute('dir') || '').toLowerCase();
      var bodyText = (document.querySelector('h1, .product__title, .product__info-container') || document.body).textContent || '';
      if (dir === 'rtl' || lang.indexOf('ar') === 0 || /[\u0600-\u06FF]/.test(bodyText)) {
        html.classList.add('ptos-rtl');
      }
    }

    var colorMap = {
      white: '#ffffff', black: '#111111', pink: '#f7a8c8', red: '#dc2626',
      blue: '#2563eb', navy: '#1e3a8a', green: '#16a34a', yellow: '#facc15',
      orange: '#f97316', purple: '#9333ea', grey: '#9ca3af', gray: '#9ca3af',
      beige: '#d6c6a8', cream: '#f5f0df', brown: '#8b5e34', tan: '#d2b48c',
      gold: '#d4af37', silver: '#c0c0c0', ivory: '#fffff0',
      'off white': '#f8f4e8', 'light pink': '#f9c6d6', 'hot pink': '#ec4899',
      'light blue': '#93c5fd', 'sky blue': '#7dd3fc', 'dark blue': '#1d4ed8',
      'dark green': '#166534', burgundy: '#7f1d1d', khaki: '#b7a57a',
      'أبيض': '#ffffff', 'ابيض': '#ffffff', 'بيضاء': '#ffffff',
      'أسود': '#111111', 'اسود': '#111111', 'سوداء': '#111111',
      'وردي': '#f0a0c2', 'زهري': '#f0a0c2', 'بمبي': '#f0a0c2',
      'أحمر': '#dc2626', 'احمر': '#dc2626', 'أزرق': '#2563eb', 'ازرق': '#2563eb',
      'أخضر': '#16a34a', 'اخضر': '#16a34a', 'رمادي': '#9ca3af', 'بنفسجي': '#9333ea',
      'بيج': '#d6c6a8', 'بني': '#8b5e34'
    };

    function clean(text) {
      return String(text || '')
        .replace(/variant\s+sold\s+out\s+or\s+unavailable/ig, '')
        .replace(/\s+/g, ' ')
        .trim();
    }

    function esc(text) {
      return clean(text).replace(/[&<>"']/g, function (ch) {
        return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
      });
    }

    function optionText(input, label) {
      var value = input && input.value ? input.value : '';
      if (value) return clean(value);
      var clone = label.cloneNode(true);
      Array.prototype.forEach.call(clone.querySelectorAll('.visually-hidden, .hidden, [aria-hidden="true"]'), function (node) {
        node.parentNode && node.parentNode.removeChild(node);
      });
      return clean(clone.textContent);
    }

    function colorFor(name) {
      var key = clean(name).toLowerCase();
      return colorMap[key] || key;
    }

    function optionKind(fieldset) {
      var legend = clean((fieldset.querySelector('legend') || {}).textContent).toLowerCase();
      var labels = Array.prototype.map.call(fieldset.querySelectorAll('input[type="radio"]'), function (input) {
        var label = input.nextElementSibling;
        return optionText(input, label || fieldset);
      }).join(' / ').toLowerCase();
      if (/colou?r|couleur|لون|color/.test(legend) || /\/.+\//.test(labels)) return 'color';
      if (/size|shoe|taille|pointure|الحجم|مقاس|قياس/.test(legend) || /\d+\s*[-\u2013]\s*\d+(?:\s*[*x]\s*\d+\s*(?:pcs?|قطعة|قطع)?)?/.test(labels)) return 'size';
      return '';
    }

    function renderColor(label, text) {
      var raw = clean(text);
      var parts = raw.split(/[\/,+&]+/).map(clean).filter(Boolean).slice(0, 4);
      if (!parts.length) return;
      label.classList.add('ptos-color-label');
      if (label.getAttribute('data-ptos-rendered-color') === raw) return;
      label.setAttribute('data-ptos-rendered-color', raw);
      label.innerHTML =
        '<span class="ptos-color-card">' +
          '<span class="ptos-color-title">' + esc(raw) + '</span>' +
          '<span class="ptos-color-bars" style="grid-template-columns:repeat(' + parts.length + ',minmax(0,1fr))">' +
            parts.map(function (part) {
              return '<span class="ptos-color-bar" title="' + esc(part) + '" style="background:' + esc(colorFor(part)) + '"></span>';
            }).join('') +
          '</span>' +
        '</span>';
    }

    function renderSize(label, text) {
      var raw = clean(text);
      var match = raw.match(/(\d+(?:\.\d+)?)\s*[-\u2013]\s*(\d+(?:\.\d+)?)(?:\s*[*x]\s*(\d+)\s*(?:pcs?|قطعة|قطع)?)?/i);
      if (!match) return;
      var pcs = match[3] || '24';
      label.classList.add('ptos-option-label');
      if (label.getAttribute('data-ptos-rendered-size') === raw) return;
      label.setAttribute('data-ptos-rendered-size', raw);
      label.innerHTML =
        '<span class="ptos-size-card">' +
          '<span class="ptos-size-check" aria-hidden="true"></span>' +
          '<span class="ptos-size-row"><span class="ptos-size-range"><strong>' + esc(match[1]) + '</strong><span class="ptos-size-to">TO</span><strong>' + esc(match[2]) + '</strong></span></span>' +
          '<span class="ptos-size-pack"><span class="ptos-size-icon" aria-hidden="true"></span>' + esc(pcs) + ' pcs / pack</span>' +
        '</span>';
    }

    function currentPackSize() {
      var fieldsets = document.querySelectorAll('variant-radios fieldset, variant-selects fieldset, .product-form__input');
      for (var i = 0; i < fieldsets.length; i += 1) {
        if (optionKind(fieldsets[i]) !== 'size') continue;
        var checked = fieldsets[i].querySelector('input[type="radio"]:checked');
        var text = checked ? optionText(checked, checked.nextElementSibling || fieldsets[i]) : '';
        var match = text.match(/[*x]\s*(\d+)\s*(?:pcs?|قطعة|قطع)?/i);
        if (match) return match[1];
      }
      return '24';
    }

    function findProductRoot() {
      return document.querySelector('.product__info-container') || document.querySelector('product-info') || document.querySelector('.product') || document.body;
    }

    function findCratePriceLine(root) {
      var nodes = root.querySelectorAll('p,div,span,strong,b');
      var best = null;
      for (var i = 0; i < nodes.length; i += 1) {
        var el = nodes[i];
        if (el.closest('.ptos-price-card')) continue;
        var text = clean(el.textContent);
        if (/(crate\s*price|سعر\s*الكرتونة)/i.test(text) && text.length < 220) {
          if (!moneyTokens(cratePriceText(text)).length) continue;
          var candidate = el;
          while (
            candidate.parentElement &&
            candidate.parentElement !== root &&
            candidate.parentElement.children.length <= 8
          ) {
            var parentText = clean(candidate.parentElement.textContent);
            if (!/(crate\s*price|سعر\s*الكرتونة)/i.test(parentText)) break;
            if (!moneyTokens(cratePriceText(parentText)).length) break;
            if (parentText.length > 260) break;
            candidate = candidate.parentElement;
          }
          if (!best || clean(candidate.textContent).length < clean(best.textContent).length) best = candidate;
        }
      }
      return best;
    }

    function findUnitPriceLine(root) {
      var nodes = root.querySelectorAll('p,div,span,strong,b');
      var best = null;
      for (var i = 0; i < nodes.length; i += 1) {
        var el = nodes[i];
        if (el.closest('.ptos-price-card')) continue;
        var text = clean(el.textContent);
        if (/(unit\s*price|سعر\s*الوحدة)/i.test(text) && text.length < 180) {
          if (!moneyTokens(unitPriceText(text)).length) continue;
          var candidate = el;
          while (
            candidate.parentElement &&
            candidate.parentElement !== root &&
            candidate.parentElement.children.length <= 8
          ) {
            var parentText = clean(candidate.parentElement.textContent);
            if (!/(unit\s*price|سعر\s*الوحدة)/i.test(parentText)) break;
            if (!moneyTokens(unitPriceText(parentText)).length) break;
            if (parentText.length > 220) break;
            candidate = candidate.parentElement;
          }
          if (!best || clean(candidate.textContent).length < clean(best.textContent).length) best = candidate;
        }
      }
      return best;
    }

    function moneyTokens(text) {
      var tokens = clean(text).match(/(?:Dh\s*)[\d,]+(?:[.]\d{1,2})?\s*(?:MAD|dh)?|[\d,]+(?:[.]\d{1,2})?\s*(?:MAD|dh)/ig) || [];
      return tokens.map(clean).filter(function (token) { return /\d/.test(token); });
    }

    function cratePriceText(text) {
      var source = clean(text);
      var match = source.match(/(?:crate\s*price|سعر\s*الكرتونة)\s*:?\s*([\s\S]*)/i);
      return clean(match ? match[1] : source);
    }

    function unitPriceText(text) {
      var source = clean(text);
      var match = source.match(/(?:unit\s*price|سعر\s*الوحدة)\s*:?\s*([\s\S]*)/i);
      return clean(match ? match[1] : source);
    }

    function discountPercent(original, current) {
      var parse = function (value) {
        var normalized = String(value || '').replace(/[^\d.,]/g, '').replace(/,/g, '');
        var num = parseFloat(normalized);
        return isFinite(num) ? num : 0;
      };
      var a = parse(original);
      var b = parse(current);
      if (!(a > 0) || !(b > 0) || a <= b) return '';
      return String(Math.round(((a - b) / a) * 100));
    }

    function hideCratePriceSources(root) {
      var nodes = root.querySelectorAll('p,div,span,strong,b');
      Array.prototype.forEach.call(nodes, function (node) {
        if (node.closest('.ptos-price-card')) return;
        var text = clean(node.textContent);
        if (!/(crate\s*price|سعر\s*الكرتونة)/i.test(text)) return;
        if (!moneyTokens(cratePriceText(text)).length) return;
        node.style.display = 'none';
        node.hidden = true;
        node.setAttribute('data-ptos-price-source', 'true');
      });
    }

    function hideUnitPriceSources(root) {
      var nodes = root.querySelectorAll('p,div,span,strong,b');
      Array.prototype.forEach.call(nodes, function (node) {
        if (node.closest('.ptos-price-card')) return;
        var text = clean(node.textContent);
        if (!/(unit\s*price|سعر\s*الوحدة)/i.test(text)) return;
        if (!moneyTokens(unitPriceText(text)).length) return;
        node.style.display = 'none';
        node.hidden = true;
        node.setAttribute('data-ptos-price-source', 'true');
      });
    }

    function enhancePriceCard() {
      var root = findProductRoot();
      var crateLine = findCratePriceLine(root);
      var unitLine = findUnitPriceLine(root);
      if (!crateLine && !unitLine) return;
      var cratePrices = crateLine ? moneyTokens(cratePriceText(crateLine.textContent)) : [];
      var unitPrices = unitLine ? moneyTokens(unitPriceText(unitLine.textContent)) : [];
      if (!cratePrices.length && !unitPrices.length) return;
      var crate = cratePrices.length ? cratePrices[cratePrices.length - 1] : '';
      var compare = cratePrices.length > 1 ? cratePrices[0] : '';
      var unit = unitPrices.length ? unitPrices[0] : '';
      if (compare && unit && clean(compare).toLowerCase() === clean(unit).toLowerCase()) compare = '';
      if (!unit && compare && /dh/i.test(compare) && !/mad/i.test(compare)) {
        unit = compare;
        compare = '';
      }
      if (!unit) unit = crate;
      var card = root.querySelector('.ptos-price-card');
      if (!card) {
        card = document.createElement('div');
        card.className = 'ptos-price-card';
        (unitLine || crateLine).insertAdjacentElement('beforebegin', card);
      }
      var pack = currentPackSize();
      var signature = [unit, crate, compare, pack].join('|');
      if (card.getAttribute('data-ptos-price-signature') === signature) {
        hideCratePriceSources(root);
        hideUnitPriceSources(root);
        return;
      }
      var savePct = discountPercent(compare, crate);
      card.setAttribute('data-ptos-price-signature', signature);
      card.innerHTML =
        '<div class="ptos-price-grid">' +
          '<div class="ptos-price-cell">' +
            '<span class="ptos-price-label">Unit Price</span>' +
            '<span class="ptos-price-unit">' + esc(unit) + '</span>' +
          '</div>' +
          '<div class="ptos-price-cell">' +
            '<span class="ptos-price-label">Crate Price</span>' +
            '<div class="ptos-price-crate"><span class="ptos-price-crate-value">' + esc(crate || unit) + '</span></div>' +
          '</div>' +
        '</div>' +
        '<div class="ptos-price-meta">' +
          (((compare && compare !== crate && compare !== unit) || savePct) ? (
            '<div class="ptos-price-offer">' +
              ((compare && compare !== crate && compare !== unit) ? '<span class="ptos-price-compare">Original: ' + esc(compare) + '</span>' : '') +
              (savePct ? '<span class="ptos-price-save">Save ' + esc(savePct) + '%</span>' : '') +
            '</div>'
          ) : '') +
          '<div class="ptos-price-stock"><span class="ptos-price-stock-icon" aria-hidden="true"></span><span>In Stock &amp; Ready to Ship</span></div>' +
        '</div>';
      hideCratePriceSources(root);
      hideUnitPriceSources(root);
    }

    function enhance() {
      document.documentElement.classList.add('ptos-swatch-ready');
      detectRtl();
      var fieldsets = document.querySelectorAll('variant-radios fieldset, variant-selects fieldset, .product-form__input');
      Array.prototype.forEach.call(fieldsets, function (fieldset) {
        var kind = optionKind(fieldset);
        if (!kind) return;
        fieldset.classList.toggle('ptos-enhance-color', kind === 'color');
        fieldset.classList.toggle('ptos-enhance-size', kind === 'size');
        Array.prototype.forEach.call(fieldset.querySelectorAll('input[type="radio"]'), function (input) {
          var label = input.nextElementSibling;
          if (!label) return;
          var text = optionText(input, label);
          if (!text) return;
          label.setAttribute('data-ptos-option-text', text);
          if (kind === 'color') renderColor(label, text);
          if (kind === 'size') renderSize(label, text);
        });
      });
      enhancePriceCard();
    }

    var enhanceTimer = null;
    function scheduleEnhance() {
      if (enhanceTimer) clearTimeout(enhanceTimer);
      enhanceTimer = setTimeout(enhance, 40);
      setTimeout(enhance, 180);
      setTimeout(enhance, 520);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scheduleEnhance);
    else scheduleEnhance();
    document.addEventListener('shopify:section:load', scheduleEnhance);
    document.addEventListener('change', function (event) {
      if (event.target && event.target.matches && event.target.matches('variant-radios input, variant-selects input, .product-form__input input, select')) {
        scheduleEnhance();
      }
    }, true);
    document.addEventListener('click', function (event) {
      if (event.target && event.target.closest && event.target.closest('variant-radios, variant-selects, .product-form__input')) {
        scheduleEnhance();
      }
    }, true);
    var observedRoot = findProductRoot();
    if (window.MutationObserver && observedRoot) {
      new MutationObserver(scheduleEnhance).observe(observedRoot, { childList: true, subtree: true });
    }
  })();
</script>
{% endif %}
"""

THEME_EDITOR_SWATCH_SECTION = r"""{% comment %}
  Product Testing OS variant swatches.
  Add this section on product templates when you want the app-managed swatch enhancement.
{% endcomment %}
{% render 'ptos-variant-swatches' %}

{% schema %}
{
  "name": "Variant swatches",
  "tag": "section",
  "class": "section ptos-variant-swatches-section",
  "settings": [
    {
      "type": "paragraph",
      "content": "Improves mixed color swatches and size bundle labels on product pages."
    }
  ],
  "presets": [
    {
      "name": "Variant swatches"
    }
  ]
}
{% endschema %}
"""


@app.get("/api/wholesale/debug-store-config")
async def api_wholesale_debug_store_config():
    """Debug endpoint: show how _get_store_config resolves for the MMD store."""
    try:
        from app.integrations.shopify_client import _get_store_config, _store_suffix, _env_with_suffix, _oauth_enabled_for_store
        suf = _store_suffix(WHOLESALE_STORE)
        env_domain = _env_with_suffix("SHOPIFY_SHOP_DOMAIN", suf)
        env_token = _env_with_suffix("SHOPIFY_ACCESS_TOKEN", suf)
        base_domain = os.getenv("SHOPIFY_SHOP_DOMAIN", "")
        oauth_enabled = _oauth_enabled_for_store(WHOLESALE_STORE)
        # Check DB
        db_rec = None
        try:
            db_rec = db.get_app_setting(WHOLESALE_STORE, "shopify_oauth")
        except Exception as e:
            db_rec = {"error": str(e)}
        # Resolve final config
        try:
            cfg = _get_store_config(WHOLESALE_STORE)
            resolved_shop = cfg.get("SHOP", "")
            resolved_has_token = bool(cfg.get("TOKEN"))
        except Exception as e:
            resolved_shop = f"ERROR: {e}"
            resolved_has_token = False
        return {
            "store_label": WHOLESALE_STORE,
            "suffix": suf,
            "env_SHOPIFY_SHOP_DOMAIN_MMD": env_domain or "(not set)",
            "env_SHOPIFY_ACCESS_TOKEN_MMD": "(set)" if env_token else "(not set)",
            "base_SHOPIFY_SHOP_DOMAIN": base_domain,
            "oauth_enabled_for_mmd": oauth_enabled,
            "db_oauth_record": {
                "shop": (db_rec or {}).get("shop") if isinstance(db_rec, dict) else db_rec,
                "has_token": bool((db_rec or {}).get("access_token")) if isinstance(db_rec, dict) else False,
                "scopes": (db_rec or {}).get("scopes") if isinstance(db_rec, dict) else None,
            },
            "resolved_shop": resolved_shop,
            "resolved_has_token": resolved_has_token,
        }
    except Exception as e:
        return {"error": str(e)}


class ThemeEditorStoreRequest(BaseModel):
    store: Optional[str] = None


def _inject_theme_editor_swatch_render(layout_content: str) -> tuple[str, bool]:
    """Add the swatch snippet render to layout/theme.liquid once."""
    content = layout_content or ""
    render_block = (
        f"{THEME_EDITOR_SWATCH_LAYOUT_MARKER}\n"
        "{% render 'ptos-variant-swatches' %}\n"
        f"{THEME_EDITOR_SWATCH_LAYOUT_MARKER}"
    )
    marker_re = re.escape(THEME_EDITOR_SWATCH_LAYOUT_MARKER)
    if THEME_EDITOR_SWATCH_LAYOUT_MARKER in content:
        updated = re.sub(marker_re + r".*?" + marker_re, render_block, content, flags=re.DOTALL)
        return updated, updated != content
    if re.search(r"</body\s*>", content, flags=re.IGNORECASE):
        updated = re.sub(r"</body\s*>", render_block + "\n</body>", content, count=1, flags=re.IGNORECASE)
        return updated, True
    return content.rstrip() + "\n" + render_block + "\n", True


def _install_theme_editor_swatch_theme(store: str | None = None) -> dict:
    from app.integrations.shopify_client import get_active_theme_gid, _gql_store

    theme_gid = get_active_theme_gid(store=store)
    layout_file = "layout/theme.liquid"
    read_query = """
query ThemeFiles($themeId: ID!, $filenames: [String!]!) {
  theme(id: $themeId) {
    files(filenames: $filenames, first: 5) {
      nodes {
        filename
        body { ... on OnlineStoreThemeFileBodyText { content } }
      }
    }
  }
}
"""
    upsert_mutation = """
mutation ThemeFilesUpsert($themeId: ID!, $files: [OnlineStoreThemeFilesUpsertFileInput!]!) {
  themeFilesUpsert(themeId: $themeId, files: $files) {
    upsertedThemeFiles { filename }
    userErrors { field message }
  }
}
"""
    layout_data = _gql_store(store, read_query, {"themeId": theme_gid, "filenames": [layout_file]})
    layout_nodes = ((layout_data or {}).get("theme") or {}).get("files", {}).get("nodes") or []
    layout_content = ""
    for node in layout_nodes:
        if node.get("filename") == layout_file:
            layout_content = (node.get("body") or {}).get("content") or ""
            break
    if not layout_content:
        raise RuntimeError("Could not read layout/theme.liquid from the active theme")

    updated_layout, layout_updated = _inject_theme_editor_swatch_render(layout_content)
    files = [
        {
            "filename": THEME_EDITOR_SWATCH_SNIPPET_KEY,
            "body": {"type": "TEXT", "value": THEME_EDITOR_SWATCH_SNIPPET},
        },
        {
            "filename": THEME_EDITOR_SWATCH_SECTION_KEY,
            "body": {"type": "TEXT", "value": THEME_EDITOR_SWATCH_SECTION},
        },
    ]
    if layout_updated:
        files.append({
            "filename": layout_file,
            "body": {"type": "TEXT", "value": updated_layout},
        })

    upsert_data = _gql_store(store, upsert_mutation, {"themeId": theme_gid, "files": files})
    payload = (upsert_data or {}).get("themeFilesUpsert") or {}
    user_errors = payload.get("userErrors") or []
    if user_errors:
        raise RuntimeError(f"themeFilesUpsert errors: {user_errors}")
    upserted = [item.get("filename") for item in (payload.get("upsertedThemeFiles") or [])]
    return {
        "installed": True,
        "theme_gid": theme_gid,
        "layout_updated": layout_updated,
        "files": upserted,
        "section": THEME_EDITOR_SWATCH_SECTION_KEY,
        "snippet": THEME_EDITOR_SWATCH_SNIPPET_KEY,
    }


def _theme_editor_status(store: str | None = None) -> dict:
    from app.integrations.shopify_client import get_active_theme_gid, _gql_store, _get_store_config

    cfg = _get_store_config(store)
    theme_gid = get_active_theme_gid(store=store)
    filenames = ["layout/theme.liquid", THEME_EDITOR_SWATCH_SNIPPET_KEY, THEME_EDITOR_SWATCH_SECTION_KEY]
    read_query = """
query ThemeFiles($themeId: ID!, $filenames: [String!]!) {
  theme(id: $themeId) {
    files(filenames: $filenames, first: 10) {
      nodes {
        filename
        body { ... on OnlineStoreThemeFileBodyText { content } }
      }
    }
  }
}
"""
    data = _gql_store(store, read_query, {"themeId": theme_gid, "filenames": filenames})
    nodes = ((data or {}).get("theme") or {}).get("files", {}).get("nodes") or []
    by_name = {node.get("filename"): ((node.get("body") or {}).get("content") or "") for node in nodes}
    layout = by_name.get("layout/theme.liquid", "")
    return {
        "connected": True,
        "store": store,
        "shop": cfg.get("SHOP"),
        "theme_gid": theme_gid,
        "swatches_installed": bool(
            THEME_EDITOR_SWATCH_LAYOUT_MARKER in layout
            and by_name.get(THEME_EDITOR_SWATCH_SNIPPET_KEY)
            and by_name.get(THEME_EDITOR_SWATCH_SECTION_KEY)
        ),
        "files": {
            "layout": bool(layout),
            "snippet": bool(by_name.get(THEME_EDITOR_SWATCH_SNIPPET_KEY)),
            "section": bool(by_name.get(THEME_EDITOR_SWATCH_SECTION_KEY)),
        },
    }


@app.get("/api/theme-editor/status")
async def api_theme_editor_status(store: str | None = None):
    """Return active theme connection and installed enhancement status."""
    try:
        resolved_store = (store or "irrakids").strip() or "irrakids"
        result = await run_in_threadpool(_theme_editor_status, resolved_store)
        return {"data": result}
    except Exception as e:
        return {"error": str(e), "data": {"connected": False, "store": store}}


@app.post("/api/theme-editor/swatches/install")
async def api_theme_editor_swatches_install(req: ThemeEditorStoreRequest):
    """Install the Dawn-compatible swatch enhancement on the active theme."""
    try:
        store = (req.store or "irrakids").strip() or "irrakids"
        result = await run_in_threadpool(_install_theme_editor_swatch_theme, store)
        return {"data": result}
    except Exception as e:
        return {"error": str(e)}


THEME_EDITOR_AGENT_DEFAULT_FILES = [
    "layout/theme.liquid",
    "templates/product.json",
    "sections/main-product.liquid",
    "sections/product-template.liquid",
    "sections/featured-product.liquid",
    "sections/ptos-variant-swatches.liquid",
    "snippets/price.liquid",
    "snippets/product-price.liquid",
    "snippets/product-variant-picker.liquid",
    "snippets/buy-buttons.liquid",
    "snippets/ptos-variant-swatches.liquid",
    "assets/base.css",
    "assets/component-price.css",
    "assets/component-product-variant-picker.css",
    "assets/product-info.js",
    "assets/global.js",
]
THEME_EDITOR_AGENT_ALLOWED_PREFIXES = ("layout/", "templates/", "sections/", "snippets/", "assets/", "config/", "locales/")
THEME_EDITOR_AGENT_ALLOWED_EXTENSIONS = (".liquid", ".json", ".js", ".css", ".scss")
THEME_EDITOR_AGENT_MAX_FILES = 10
THEME_EDITOR_AGENT_MAX_FILE_CHARS = 70000
THEME_EDITOR_AGENT_MAX_TOTAL_CHARS = 220000


class ThemeEditorUpsertError(RuntimeError):
    def __init__(self, user_errors: Any):
        super().__init__(f"themeFilesUpsert errors: {user_errors}")
        self.user_errors = user_errors


class ThemeEditorAgentRequest(BaseModel):
    store: Optional[str] = None
    prompt: str
    files: Optional[List[str]] = None


def _theme_editor_candidate_files(prompt: str, requested_files: list[str] | None = None) -> list[str]:
    candidates: list[str] = []

    def add(filename: Any) -> None:
        name = str(filename or "").strip().lstrip("/")
        if not name:
            return
        if not name.startswith(THEME_EDITOR_AGENT_ALLOWED_PREFIXES):
            return
        if not name.endswith(THEME_EDITOR_AGENT_ALLOWED_EXTENSIONS):
            return
        if name not in candidates:
            candidates.append(name)

    for filename in requested_files or []:
        add(filename)
    for match in re.findall(r"(?:layout|templates|sections|snippets|assets|config|locales)/[A-Za-z0-9_.\-/]+", prompt or ""):
        add(match.rstrip(".,;:)"))
    for filename in THEME_EDITOR_AGENT_DEFAULT_FILES:
        add(filename)
    return candidates[:24]


def _theme_editor_explicit_files(prompt: str, requested_files: list[str] | None = None) -> list[str]:
    candidates: list[str] = []

    def add(filename: Any) -> None:
        name = str(filename or "").strip().lstrip("/")
        if not name:
            return
        if not name.startswith(THEME_EDITOR_AGENT_ALLOWED_PREFIXES):
            return
        if not name.endswith(THEME_EDITOR_AGENT_ALLOWED_EXTENSIONS):
            return
        if name not in candidates:
            candidates.append(name)

    for filename in requested_files or []:
        add(filename)
    for match in re.findall(r"(?:layout|templates|sections|snippets|assets|config|locales)/[A-Za-z0-9_.\-/]+", prompt or ""):
        add(match.rstrip(".,;:)"))
    return candidates[:24]


def _theme_editor_list_theme_files(store: str) -> tuple[str, list[str]]:
    from app.integrations.shopify_client import get_active_theme_gid, _gql_store

    theme_gid = get_active_theme_gid(store=store)
    query = """
query ThemeFiles($themeId: ID!, $first: Int!, $after: String) {
  theme(id: $themeId) {
    files(first: $first, after: $after) {
      nodes { filename }
      pageInfo { hasNextPage endCursor }
    }
  }
}
"""
    filenames: list[str] = []
    after: str | None = None
    for _ in range(8):
        data = _gql_store(store, query, {"themeId": theme_gid, "first": 250, "after": after})
        files_conn = ((data or {}).get("theme") or {}).get("files") or {}
        for node in files_conn.get("nodes") or []:
            filename = str((node or {}).get("filename") or "").strip()
            if filename:
                filenames.append(filename)
        page_info = files_conn.get("pageInfo") or {}
        if not page_info.get("hasNextPage"):
            break
        after = page_info.get("endCursor")
        if not after:
            break
    filenames = sorted(dict.fromkeys(filenames))
    return theme_gid, filenames


def _theme_editor_rank_files(prompt: str, all_files: list[str], requested_files: list[str] | None = None) -> list[str]:
    explicit = _theme_editor_explicit_files(prompt, requested_files)
    allowed = [
        filename for filename in all_files
        if filename.startswith(THEME_EDITOR_AGENT_ALLOWED_PREFIXES)
        and filename.endswith(THEME_EDITOR_AGENT_ALLOWED_EXTENSIONS)
    ]
    selected: list[str] = []

    def add(filename: str) -> None:
        if filename in allowed and filename not in selected:
            selected.append(filename)

    for filename in explicit:
        add(filename)

    lower_prompt = (prompt or "").lower()
    is_product_request = any(term in lower_prompt for term in ("product", "buy", "button", "cart", "trust", "wholesale"))
    is_style_request = any(term in lower_prompt for term in ("style", "css", "color", "mobile", "design", "layout", "spacing"))
    weighted_terms = [
        ("product", 6),
        ("main-product", 8),
        ("buy", 7),
        ("button", 7),
        ("price", 7),
        ("pricing", 7),
        ("variant", 5),
        ("cart", 4),
        ("trust", 5),
        ("icon", 4),
        ("wholesale", 6),
    ]
    if "buy" in lower_prompt or "button" in lower_prompt:
        weighted_terms.extend([("buy-buttons", 10), ("product-form", 8), ("add-to-cart", 8)])
    if "price" in lower_prompt or "pricing" in lower_prompt:
        weighted_terms.extend([("price", 10), ("component-price", 8)])

    def score(filename: str) -> tuple[int, str]:
        lower = filename.lower()
        value = 0
        if filename in THEME_EDITOR_AGENT_DEFAULT_FILES:
            value += 2
        for term, weight in weighted_terms:
            if term in lower or term in lower_prompt and term in lower:
                value += weight
        if is_product_request and lower == "sections/main-product.liquid":
            value += 60
        if is_product_request and lower == "snippets/buy-buttons.liquid":
            value += 55
        if is_product_request and lower in ("templates/product.json", "sections/featured-product.liquid"):
            value += 35
        if is_product_request and lower.startswith("assets/") and not is_style_request:
            value -= 25
        if lower.startswith("templates/product"):
            value += 10
        if lower.startswith("sections/") and "product" in lower:
            value += 12
        if lower.startswith("snippets/") and any(term in lower for term in ("product", "price", "buy", "button", "variant")):
            value += 10
        if lower.startswith("assets/") and any(term in lower for term in ("product", "price", "theme", "base", "global")):
            value += 5
        return (-value, filename)

    for filename in sorted(allowed, key=score):
        if len(selected) >= THEME_EDITOR_AGENT_MAX_FILES:
            break
        add(filename)
    return selected[:THEME_EDITOR_AGENT_MAX_FILES]


def _theme_editor_compact_content(filename: str, content: str, prompt: str) -> tuple[str, str | None]:
    body = content or ""
    if len(body) <= THEME_EDITOR_AGENT_MAX_FILE_CHARS:
        return body, None

    lower_body = body.lower()
    lower_prompt = (prompt or "").lower()
    anchors = [
        "buy_buttons",
        "buy-buttons",
        "product-form",
        "add-to-cart",
        "add_to_cart",
        "payment_button",
        "product__info",
        "product-info",
        "price",
        "variant",
        "trust",
        "wholesale",
    ]
    prompt_words = [
        word for word in re.findall(r"[a-z0-9_-]{4,}", lower_prompt)
        if word not in {"that", "with", "from", "this", "have", "want", "need", "please"}
    ][:18]
    matches: list[int] = []
    for term in anchors + prompt_words:
        index = lower_body.find(term)
        if index >= 0:
            matches.append(index)

    if not matches:
        return body[:THEME_EDITOR_AGENT_MAX_FILE_CHARS], f"{filename} was truncated to the first {THEME_EDITOR_AGENT_MAX_FILE_CHARS} characters."

    center = min(matches)
    before = 24000
    start = max(0, center - before)
    end = min(len(body), start + THEME_EDITOR_AGENT_MAX_FILE_CHARS)
    start = max(0, end - THEME_EDITOR_AGENT_MAX_FILE_CHARS)
    excerpt = body[start:end]
    note = (
        f"{filename} was too large, so the model received an exact excerpt around relevant anchors "
        f"(characters {start}-{end} of {len(body)})."
    )
    return excerpt, note


def _theme_editor_read_theme_files(store: str, filenames: list[str], theme_gid: str | None = None) -> tuple[str, dict[str, str]]:
    from app.integrations.shopify_client import get_active_theme_gid, _gql_store

    theme_gid = theme_gid or get_active_theme_gid(store=store)
    query = """
query ThemeFiles($themeId: ID!, $filenames: [String!]!) {
  theme(id: $themeId) {
    files(filenames: $filenames, first: 50) {
      nodes {
        filename
        body { ... on OnlineStoreThemeFileBodyText { content } }
      }
    }
  }
}
"""
    nodes: list[dict[str, Any]] = []
    for start in range(0, len(filenames), 50):
        chunk = filenames[start:start + 50]
        if not chunk:
            continue
        data = _gql_store(store, query, {"themeId": theme_gid, "filenames": chunk})
        nodes.extend(((data or {}).get("theme") or {}).get("files", {}).get("nodes") or [])
    files = {
        str(node.get("filename")): ((node.get("body") or {}).get("content") or "")
        for node in nodes
        if node.get("filename")
    }
    return theme_gid, files


def _theme_editor_upsert_theme_files(store: str, theme_gid: str, files: dict[str, str]) -> list[str]:
    if not files:
        return []
    from app.integrations.shopify_client import _gql_store

    mutation = """
mutation ThemeFilesUpsert($themeId: ID!, $files: [OnlineStoreThemeFilesUpsertFileInput!]!) {
  themeFilesUpsert(themeId: $themeId, files: $files) {
    upsertedThemeFiles { filename }
    userErrors { field message }
  }
}
"""
    payload_files = [
        {"filename": filename, "body": {"type": "TEXT", "value": content}}
        for filename, content in files.items()
    ]
    data = _gql_store(store, mutation, {"themeId": theme_gid, "files": payload_files})
    payload = (data or {}).get("themeFilesUpsert") or {}
    user_errors = payload.get("userErrors") or []
    if user_errors:
        raise ThemeEditorUpsertError(user_errors)
    return [item.get("filename") for item in (payload.get("upsertedThemeFiles") or []) if item.get("filename")]


def _theme_editor_openai_plan(prompt: str, theme_files: dict[str, str], repair_context: dict[str, Any] | None = None) -> dict[str, Any]:
    from app.integrations.openai_client import DEFAULT_LLM_MODEL, client as openai_client

    compact_files: dict[str, str] = {}
    notes: list[str] = []
    total = 0
    for filename, content in theme_files.items():
        body, note = _theme_editor_compact_content(filename, content or "", prompt)
        if note:
            notes.append(note)
        total += len(body)
        if total > THEME_EDITOR_AGENT_MAX_TOTAL_CHARS:
            notes.append("Some later files were omitted because the theme context was too large.")
            break
        compact_files[filename] = body

    system = (
        "You are an expert Shopify theme engineer working inside a production app.\n"
        "Return ONLY a valid JSON object. No markdown.\n"
        "You may edit only the files provided in THEME_FILES unless creating a clearly requested new Shopify theme file.\n"
        "The filenames inside THEME_FILES are the files you can see. Do not ask the user to provide a file that is present in THEME_FILES.\n"
        "If a requested exact location is not present inside the visible content, say the exact block is not visible instead of saying the whole file was not provided.\n"
        "Use exact search/replace edits. The `find` value must be copied exactly from the provided file content.\n"
        "Keep changes tightly scoped to the user's request. Do not remove analytics, checkout, Shopify Liquid objects, or unrelated code.\n"
        "Shopify Liquid syntax is strict: do not use JavaScript/Python-style expressions inside {{ }}.\n"
        "Do not use parentheses in Liquid conditions. Prefer {% assign %}, {% if %}, {% elsif %}, {% for %}, and simple `and`/`or` conditions.\n"
        "Never output expressions like {{ customer and (...) }}. For wholesale checks, use Liquid control flow such as assigning a flag and looping over customer.tags.\n"
        "If the request is unclear or the needed code is not visible, return no edits and put a short question in `message`.\n"
        "Schema: {\"message\":\"short user-facing summary\", \"edits\":[{\"filename\":\"sections/main-product.liquid\", \"find\":\"exact existing text\", \"replace\":\"new text\"}], \"warnings\":[\"optional\"]}.\n"
        "For a new file only, use an empty string for `find` and put the full file content in `replace`."
    )
    user = json.dumps(
        {
            "USER_PROMPT": prompt,
            "THEME_FILES": compact_files,
            "CONTEXT_NOTES": notes,
            "REPAIR_CONTEXT": repair_context or {},
        },
        ensure_ascii=False,
    )
    resp = openai_client.chat.completions.create(
        model=os.getenv("THEME_EDITOR_AGENT_MODEL", DEFAULT_LLM_MODEL),
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        response_format={"type": "json_object"},
    )
    text = resp.choices[0].message.content or "{}"
    data = json.loads(text)
    if not isinstance(data, dict):
        return {"message": "The theme agent returned an invalid response.", "edits": [], "warnings": []}
    if not isinstance(data.get("edits"), list):
        data["edits"] = []
    if not isinstance(data.get("warnings"), list):
        data["warnings"] = []
    data["_context_files"] = list(compact_files.keys())
    data["_context_notes"] = notes
    return data


def _theme_editor_build_updates(plan: dict[str, Any], files: dict[str, str]) -> tuple[dict[str, str], list[dict[str, str]], list[str]]:
    updates: dict[str, str] = {}
    failed: list[dict[str, str]] = []
    actions: list[str] = []

    for raw_edit in plan.get("edits") or []:
        if not isinstance(raw_edit, dict):
            continue
        filename = str(raw_edit.get("filename") or "").strip().lstrip("/")
        find = str(raw_edit.get("find") or "")
        replace = str(raw_edit.get("replace") or "")
        if not filename.startswith(THEME_EDITOR_AGENT_ALLOWED_PREFIXES) or not filename.endswith(THEME_EDITOR_AGENT_ALLOWED_EXTENSIONS):
            failed.append({"filename": filename, "reason": "file path is not allowed"})
            continue
        current = updates.get(filename, files.get(filename, ""))
        if find:
            if find not in current:
                failed.append({"filename": filename, "reason": "exact text to replace was not found"})
                continue
            updated = current.replace(find, replace, 1)
        else:
            if filename in files and current.strip():
                failed.append({"filename": filename, "reason": "empty find is only allowed for new or empty files"})
                continue
            updated = replace
        if updated != current:
            updates[filename] = updated
            actions.append(f"updated {filename}")

    return updates, failed, actions


def _theme_editor_apply_agent_prompt(store: str, prompt: str, requested_files: list[str] | None = None) -> dict[str, Any]:
    theme_gid, all_theme_files = _theme_editor_list_theme_files(store)
    filenames = _theme_editor_rank_files(prompt, all_theme_files, requested_files)
    if not filenames:
        filenames = _theme_editor_candidate_files(prompt, requested_files)
    theme_gid, files = _theme_editor_read_theme_files(store, filenames, theme_gid=theme_gid)
    if not files:
        return {
            "message": "I connected to Shopify, but could not read any matching theme files.",
            "actions": [],
            "theme_gid": theme_gid,
            "theme_file_count": len(all_theme_files),
            "files_considered": filenames,
            "files_sent_to_model": [],
            "files_changed": [],
            "failed_edits": [],
        }

    plan = _theme_editor_openai_plan(prompt, files)
    updates, failed, actions = _theme_editor_build_updates(plan, files)

    repaired = False
    try:
        changed = _theme_editor_upsert_theme_files(store, theme_gid, updates)
    except ThemeEditorUpsertError as exc:
        repair_files = dict(files)
        repair_files.update(updates)
        repair_plan = _theme_editor_openai_plan(
            prompt,
            {filename: repair_files.get(filename, "") for filename in (updates.keys() or repair_files.keys())},
            repair_context={
                "shopify_user_errors": exc.user_errors,
                "previous_message": plan.get("message"),
                "instruction": "The previous edit failed Shopify Liquid validation. Return corrected exact search/replace edits against the attempted file contents. Keep the same user intent.",
            },
        )
        updates, repair_failed, actions = _theme_editor_build_updates(repair_plan, repair_files)
        failed.extend(repair_failed)
        try:
            changed = _theme_editor_upsert_theme_files(store, theme_gid, updates)
        except ThemeEditorUpsertError as retry_exc:
            return {
                "message": "Shopify still rejected the generated Liquid after an automatic repair attempt. I did not save the theme changes.",
                "actions": actions,
                "files_considered": list(files.keys()),
                "files_sent_to_model": repair_plan.get("_context_files") or plan.get("_context_files") or [],
                "context_notes": repair_plan.get("_context_notes") or plan.get("_context_notes") or [],
                "theme_file_count": len(all_theme_files),
                "files_changed": [],
                "failed_edits": failed + [{"filename": ",".join(updates.keys()), "reason": str(retry_exc.user_errors)}],
                "warnings": ["Shopify Liquid parser rejected the edit."],
                "theme_gid": theme_gid,
            }
        plan = repair_plan
        repaired = True
    return {
        "message": str(plan.get("message") or ("Updated theme files." if changed else "No theme files were changed.")) + (" Repaired Shopify Liquid syntax and retried successfully." if repaired else ""),
        "actions": actions,
        "files_considered": list(files.keys()),
        "files_sent_to_model": plan.get("_context_files") or [],
        "context_notes": plan.get("_context_notes") or [],
        "theme_file_count": len(all_theme_files),
        "files_changed": changed,
        "failed_edits": failed,
        "warnings": plan.get("warnings") or [],
        "theme_gid": theme_gid,
    }


@app.post("/api/theme-editor/agent")
async def api_theme_editor_agent(req: ThemeEditorAgentRequest):
    """Use OpenAI to propose exact Shopify theme edits, then apply them to the active theme."""
    try:
        prompt = (req.prompt or "").strip()
        store = (req.store or "irrakids").strip() or "irrakids"
        if not prompt:
            return {"error": "prompt is required"}
        result = await run_in_threadpool(_theme_editor_apply_agent_prompt, store, prompt, req.files)
        return {"data": result}
    except Exception as e:
        return {"error": str(e)}


def _wholesale_vendor_key(vendor_id: str) -> str:
    return f"wholesale_vendor:{vendor_id}"

def _wholesale_vendor_name_tag(vendor_name: str) -> str:
    return f"vendor:{(vendor_name or '').strip()}"

def _wholesale_vendor_id_tag(vendor_id: str) -> str:
    return f"vendor_id:{(vendor_id or '').strip().lower()}"

def _wholesale_tags_csv(vendor_name: str, vendor_id: str, *, include_customer: bool = False) -> str:
    tags = [
        WHOLESALE_TAG,
        WHOLESALE_DASHBOARD_TAG,
        _wholesale_vendor_name_tag(vendor_name),
        _wholesale_vendor_id_tag(vendor_id),
    ]
    if include_customer:
        tags.append(WHOLESALE_CUSTOMER_TAG)
    return ", ".join([t for t in tags if t])

def _wholesale_tags_set(tags_raw: Any) -> set[str]:
    if isinstance(tags_raw, list):
        vals = [str(t).strip().lower() for t in tags_raw if str(t).strip()]
        return set(vals)
    return {t.strip().lower() for t in str(tags_raw or "").split(",") if t.strip()}

def _wholesale_order_matches_vendor(order_obj: dict, vendor_name: str, vendor_id: str) -> bool:
    tags = _wholesale_tags_set((order_obj or {}).get("tags"))
    if not tags:
        return False
    vendor_name_tag = _wholesale_vendor_name_tag(vendor_name).lower()
    vendor_id_tag = _wholesale_vendor_id_tag(vendor_id).lower()
    has_vendor_tag = vendor_name_tag in tags or vendor_id_tag in tags
    has_wholesale_source_tag = WHOLESALE_DASHBOARD_TAG.lower() in tags or WHOLESALE_TAG.lower() in tags
    return has_vendor_tag and has_wholesale_source_tag

def _wholesale_safe_float(v: Any, default: float = 0.0) -> float:
    try:
        return float(v)
    except Exception:
        return default


def _wholesale_normalize_phone(phone_raw: Any) -> str:
    digits = re.sub(r"\D+", "", str(phone_raw or ""))
    if not digits:
        return ""
    if digits.startswith("00"):
        digits = digits[2:]
    if digits.startswith("212") and len(digits) >= 11:
        digits = f"0{digits[3:]}"
    elif len(digits) == 9 and digits[:1] in {"5", "6", "7"}:
        digits = f"0{digits}"
    return digits


def _wholesale_extract_customer_snapshot(order_obj: dict) -> dict[str, Any]:
    order = order_obj or {}
    customer = order.get("customer") or {}
    shipping = order.get("shipping_address") or {}
    billing = order.get("billing_address") or {}

    customer_name = (
        shipping.get("name")
        or billing.get("name")
        or f"{customer.get('first_name', '')} {customer.get('last_name', '')}".strip()
        or "N/A"
    )
    customer_phone = (
        shipping.get("phone")
        or billing.get("phone")
        or customer.get("phone")
        or ""
    ).strip()
    return {
        "customer_id": customer.get("id"),
        "customer_name": customer_name.strip() or "N/A",
        "customer_phone": customer_phone,
        "customer_phone_normalized": _wholesale_normalize_phone(customer_phone),
        "address1": (shipping.get("address1") or billing.get("address1") or "").strip(),
        "city": (shipping.get("city") or billing.get("city") or "").strip(),
        "province": (shipping.get("province") or billing.get("province") or "").strip(),
        "zip": (shipping.get("zip") or billing.get("zip") or "").strip(),
        "country": (shipping.get("country_code") or billing.get("country_code") or "").strip(),
    }


def _wholesale_fetch_shopify_vendor_orders(vendor_name: str, vendor_id: str) -> list[dict]:
    from app.integrations.shopify_client import _rest_get_store

    orders_by_id: dict[str, dict] = {}

    path_dashboard = f"/orders.json?tag={quote(WHOLESALE_DASHBOARD_TAG, safe='')}&status=any&limit=250"
    result_dashboard = _rest_get_store(WHOLESALE_STORE, path_dashboard)
    for order in (result_dashboard or {}).get("orders", []) or []:
        if _wholesale_order_matches_vendor(order, vendor_name, vendor_id):
            orders_by_id[str(order.get("id"))] = order

    path_legacy = f"/orders.json?tag={quote(_wholesale_vendor_name_tag(vendor_name), safe='')}&status=any&limit=250"
    result_legacy = _rest_get_store(WHOLESALE_STORE, path_legacy)
    for order in (result_legacy or {}).get("orders", []) or []:
        if _wholesale_order_matches_vendor(order, vendor_name, vendor_id):
            orders_by_id[str(order.get("id"))] = order

    orders = list(orders_by_id.values())
    orders.sort(key=lambda x: str(x.get("created_at") or ""), reverse=True)
    return orders


def _wholesale_phone_search_candidates(phone_raw: Any) -> list[str]:
    raw = str(phone_raw or "").strip()
    normalized = _wholesale_normalize_phone(raw)
    candidates: list[str] = []

    def add(value: str) -> None:
        v = value.strip()
        if v and v not in candidates:
            candidates.append(v)

    add(raw)
    add(normalized)
    if normalized.startswith("0") and len(normalized) >= 10:
        add(f"+212{normalized[1:]}")
        add(f"212{normalized[1:]}")
    return candidates


def _wholesale_find_existing_customer_by_phone(phone_raw: Any) -> dict[str, Any] | None:
    from app.integrations.shopify_client import _rest_get_store

    for candidate in _wholesale_phone_search_candidates(phone_raw):
        path = (
            "/customers/search.json?"
            + urlencode({
                "query": f"phone:{candidate}",
                "fields": "id,first_name,last_name,phone,default_address",
                "limit": 10,
            })
        )
        try:
            result = _rest_get_store(WHOLESALE_STORE, path)
        except RetryError as exc:
            last_exc = exc.last_attempt.exception()
            if isinstance(last_exc, requests.exceptions.HTTPError):
                status = last_exc.response.status_code if last_exc.response is not None else None
                if status in (401, 403):
                    logger.warning(
                        "Wholesale customer search unavailable for phone lookup (status=%s); falling back to order history only",
                        status,
                    )
                    return None
            raise
        except requests.exceptions.HTTPError as exc:
            status = exc.response.status_code if exc.response is not None else None
            if status in (401, 403):
                logger.warning(
                    "Wholesale customer search unavailable for phone lookup (status=%s); falling back to order history only",
                    status,
                )
                return None
            raise
        for customer in (result or {}).get("customers", []) or []:
            customer_phone = str(customer.get("phone") or "")
            if _wholesale_normalize_phone(customer_phone) != _wholesale_normalize_phone(phone_raw):
                continue

            default_address = customer.get("default_address") or {}
            customer_name = (
                f"{customer.get('first_name', '')} {customer.get('last_name', '')}".strip()
                or default_address.get("name")
                or "N/A"
            )
            return {
                "customer_id": customer.get("id"),
                "customer_name": customer_name.strip() or "N/A",
                "customer_phone": customer_phone.strip(),
                "customer_phone_normalized": _wholesale_normalize_phone(customer_phone),
                "address1": str(default_address.get("address1") or "").strip(),
                "city": str(default_address.get("city") or "").strip(),
                "province": str(default_address.get("province") or "").strip(),
                "zip": str(default_address.get("zip") or "").strip(),
                "country": str(default_address.get("country_code") or "").strip(),
            }
    return None


def _hash_password(pw: str) -> str:
    return hashlib.sha256((pw or "").encode("utf-8")).hexdigest()


WHOLESALE_STORE_TYPES = ["shoes", "clothes", "electronics", "general"]
WHOLESALE_TITLE_DESC_PROMPTS_KEY = "wholesale_title_description_prompts"


WHOLESALE_DEFAULT_TITLE_DESC_PROMPTS: dict[str, str] = {
    "shoes": (
        "You are writing wholesale Shopify product copy for a shoe store in Morocco.\n"
        "Use PRODUCT_INFO, ANGLE, and the image if provided. Generate a title and description that include the detected color variants, size ranges, pieces per crate, and crate quantities when available.\n"
        "The description must mention fast delivery to all cities, the key visible product features, and clear reasons this product will sell well for retailers (easy to stock, broad demand, strong perceived value, practical colors/sizes).\n"
        "Keep the title commercial, specific, and under 70 characters. Keep the description concise but persuasive, 3-5 sentences."
    ),
    "clothes": (
        "You are writing wholesale Shopify product copy for a clothing store in Morocco.\n"
        "Use PRODUCT_INFO, ANGLE, and the image if provided. Generate a title and description that include detected color variants, available sizes, quantities, fabric/style features, and any visible design details.\n"
        "The description must mention fast delivery to all cities and explain why retailers can sell this product easily: attractive colors, useful size spread, everyday demand, styling versatility, and good display appeal.\n"
        "Keep the title commercial, specific, and under 70 characters. Keep the description concise but persuasive, 3-5 sentences."
    ),
    "electronics": (
        "You are writing wholesale Shopify product copy for an electronics/general product store in Morocco.\n"
        "Use PRODUCT_INFO, ANGLE, and the image if provided. Generate a title and description that include configuration/spec details, quantity, SKU context if useful, and concrete product features.\n"
        "The description must mention fast delivery to all cities and explain why this product will sell well: practical use case, clear customer benefit, easy upsell/display value, and strong everyday demand.\n"
        "Keep the title commercial, specific, and under 70 characters. Keep the description concise but persuasive, 3-5 sentences."
    ),
    "general": (
        "You are writing wholesale Shopify product copy for a general wholesale store in Morocco.\n"
        "Use PRODUCT_INFO, ANGLE, and the image if provided. Generate a title and description that include variants such as colors, sizes, pcs/crate, quantities, visible features, and practical use cases.\n"
        "The description must mention fast delivery to all cities and explain why this product will sell well for retailers: broad appeal, useful features, attractive presentation, and easy merchandising.\n"
        "Keep the title commercial, specific, and under 70 characters. Keep the description concise but persuasive, 3-5 sentences."
    ),
}


class WholesaleTitleDescriptionPromptsUpdate(BaseModel):
    prompts: Dict[str, str]


class WholesaleVendorCreate(BaseModel):
    name: str
    username: str
    password: str
    store_type: Optional[str] = "shoes"


class WholesaleProductCreate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    cog_price: Optional[float] = None
    sale_price: Optional[float] = None
    compare_at_price: Optional[float] = None
    segment: Optional[str] = None
    season: Optional[str] = None
    collection: Optional[str] = None
    tags: Optional[List[str]] = None
    colors: Optional[List[str]] = None
    sizes: Optional[List[str]] = None
    product_type: Optional[str] = None
    size_groups: Optional[List[dict]] = None
    image_url: Optional[str] = None
    catalog_image_url: Optional[str] = None
    variant_group_id: Optional[str] = None


class WholesaleInventoryUpdate(BaseModel):
    quantity: int


class WholesaleLogin(BaseModel):
    username: str
    password: str


@app.post("/api/wholesale/vendors")
async def api_wholesale_create_vendor(req: WholesaleVendorCreate):
    """Admin endpoint: create or update a wholesale vendor."""
    try:
        name = (req.name or "").strip()
        username = (req.username or "").strip().lower()
        password = (req.password or "").strip()
        if not (name and username and password):
            return {"error": "name, username, and password are required"}

        vendor_id = username
        key = _wholesale_vendor_key(vendor_id)
        existing = db.get_app_setting(WHOLESALE_STORE, key) or {}
        if not isinstance(existing, dict):
            existing = {}

        raw_type = (req.store_type or "shoes").strip().lower()
        store_type = raw_type if raw_type in WHOLESALE_STORE_TYPES else "shoes"

        vendor_data = {
            "id": vendor_id,
            "name": name,
            "username": username,
            "password_hash": existing.get("password_hash", _hash_password(password)) if password == "UNCHANGED_PLACEHOLDER" else _hash_password(password),
            "store_type": store_type,
            "created_at": existing.get("created_at") or datetime.utcnow().isoformat() + "Z",
            "updated_at": datetime.utcnow().isoformat() + "Z",
        }
        db.set_app_setting(WHOLESALE_STORE, key, vendor_data)
        safe = {k: v for k, v in vendor_data.items() if k != "password_hash"}
        return {"data": safe}
    except Exception as e:
        return {"error": str(e)}


@app.get("/api/wholesale/vendors")
async def api_wholesale_list_vendors():
    """Admin endpoint: list all wholesale vendors."""
    try:
        from sqlalchemy import text as sa_text
        with db.SessionLocal() as session:
            rows = session.query(db.AppSetting).filter(
                db.AppSetting.store == WHOLESALE_STORE,
                db.AppSetting.key.like("wholesale_vendor:%"),
            ).all()
        vendors = []
        for r in rows:
            try:
                val = json.loads(r.value) if r.value else {}
                if isinstance(val, dict):
                    safe = {k: v for k, v in val.items() if k != "password_hash"}
                    vendors.append(safe)
            except Exception:
                continue
        return {"data": vendors}
    except Exception as e:
        return {"error": str(e)}


@app.post("/api/wholesale/login")
async def api_wholesale_login(req: WholesaleLogin):
    """Vendor login: validate credentials and return vendor info."""
    try:
        username = (req.username or "").strip().lower()
        password = (req.password or "").strip()
        if not (username and password):
            return {"error": "username and password are required"}

        vendor_id = username
        key = _wholesale_vendor_key(vendor_id)
        vendor = db.get_app_setting(WHOLESALE_STORE, key)
        if not isinstance(vendor, dict):
            return {"error": "invalid_credentials"}

        stored_hash = vendor.get("password_hash", "")
        if _hash_password(password) != stored_hash:
            return {"error": "invalid_credentials"}

        safe = {k: v for k, v in vendor.items() if k != "password_hash"}
        return {"data": safe}
    except Exception as e:
        return {"error": str(e)}


@app.post("/api/wholesale/upload-image")
async def api_wholesale_upload_image(request: Request, image: UploadFile = File(...)):
    """Upload a product image and return its public URL."""
    try:
        file_id = str(uuid4())
        safe_name = (image.filename or "photo.jpg").replace("/", "_").replace("\\", "_")
        filename = f"wholesale_{file_id}_{safe_name}"
        data = await image.read()
        url_path = save_file(filename, data)
        # Build absolute URL using BASE_URL from config
        base = (BASE_URL or "").rstrip("/")
        encoded_path = quote(url_path, safe="/:")
        abs_url = f"{base}{encoded_path}" if base else encoded_path
        shopify_file_url = ""
        shopify_file_id = ""
        try:
            from app.integrations.shopify_client import upload_remote_image_to_shopify_files

            file_info = await run_in_threadpool(
                upload_remote_image_to_shopify_files,
                abs_url,
                "Wholesale vendor original product image",
                store=WHOLESALE_STORE,
            )
            shopify_file_url = str((file_info or {}).get("url") or "").strip()
            shopify_file_id = str((file_info or {}).get("id") or "").strip()
        except Exception as e:
            logging.getLogger("app.wholesale").exception("Failed to upload wholesale vendor image to Shopify Files: %r", e)
        durable_url = shopify_file_url or abs_url
        return {
            "data": {
                "url": durable_url,
                "filename": filename,
                "source_url": abs_url,
                "shopify_file_url": shopify_file_url or None,
                "shopify_file_id": shopify_file_id or None,
            }
        }
    except Exception as e:
        return {"error": str(e)}


class WholesaleAnalyzeImageRequest(BaseModel):
    image_url: str
    target_category: Optional[str] = None


def _wholesale_title_description_prompts() -> dict[str, str]:
    saved = db.get_app_setting(WHOLESALE_STORE, WHOLESALE_TITLE_DESC_PROMPTS_KEY)
    merged = dict(WHOLESALE_DEFAULT_TITLE_DESC_PROMPTS)
    if isinstance(saved, dict):
        for store_type in WHOLESALE_STORE_TYPES:
            val = saved.get(store_type)
            if isinstance(val, str) and val.strip():
                merged[store_type] = val
    return merged


def _wholesale_title_description_prompt_for(store_type: str | None) -> str:
    st = (store_type or "general").strip().lower()
    if st not in WHOLESALE_STORE_TYPES:
        st = "general"
    return _wholesale_title_description_prompts().get(st) or WHOLESALE_DEFAULT_TITLE_DESC_PROMPTS["general"]


@app.get("/api/wholesale/title-description-prompts")
async def api_wholesale_get_title_description_prompts():
    try:
        return {"data": _wholesale_title_description_prompts(), "store_types": WHOLESALE_STORE_TYPES}
    except Exception as e:
        return {"error": str(e), "data": dict(WHOLESALE_DEFAULT_TITLE_DESC_PROMPTS), "store_types": WHOLESALE_STORE_TYPES}


@app.post("/api/wholesale/title-description-prompts")
async def api_wholesale_set_title_description_prompts(req: WholesaleTitleDescriptionPromptsUpdate):
    try:
        cleaned: dict[str, str] = {}
        incoming = req.prompts or {}
        for store_type in WHOLESALE_STORE_TYPES:
            val = str(incoming.get(store_type) or "").strip()
            cleaned[store_type] = val or WHOLESALE_DEFAULT_TITLE_DESC_PROMPTS[store_type]
        db.set_app_setting(WHOLESALE_STORE, WHOLESALE_TITLE_DESC_PROMPTS_KEY, cleaned)
        return {"data": _wholesale_title_description_prompts(), "store_types": WHOLESALE_STORE_TYPES}
    except Exception as e:
        return {"error": str(e)}


@app.post("/api/wholesale/analyze-image")
async def api_wholesale_analyze_image(req: WholesaleAnalyzeImageRequest):
    """Send a product image to ChatGPT and return AI-generated title and description."""
    """Send a product image to ChatGPT and return AI-generated title and description."""
    try:
        image_url = (req.image_url or "").strip()
        if not image_url:
            return {"error": "image_url is required"}
        data = await run_in_threadpool(gen_product_from_image, image_url, None, req.target_category)
        if isinstance(data, dict):
            org_req = WholesaleProductCreate(
                title=data.get("title"),
                description=". ".join(str(b).strip() for b in (data.get("benefits") or []) if str(b).strip()),
                segment=data.get("segment"),
                season=data.get("season"),
                collection=data.get("collection"),
                product_type=data.get("product_type"),
                tags=[str(t) for t in (data.get("tags") or []) if str(t).strip()],
                colors=[str(c) for c in (data.get("colors") or []) if str(c).strip()],
                sizes=[str(s) for s in (data.get("sizes") or []) if str(s).strip()],
            )
            org = _wholesale_build_product_organization(org_req, store_type=req.target_category)
            for key in ("segment", "season", "collection", "product_type"):
                if org.get(key):
                    data[key] = org.get(key)
            data["tags"] = _wholesale_unique_labels([*(data.get("tags") or []), *(org.get("tags") or [])])
        return {"data": data, "image_url": image_url}
    except Exception as e:
        return {"error": str(e)}


class PageBuilderTranslateRequest(BaseModel):
    slug: str
    store: str | None = None


@app.post("/api/page-builder/translate")
async def api_page_builder_translate(req: PageBuilderTranslateRequest):
    """Translate an AI page's content sections to Arabic and French."""
    import asyncio
    try:
        store = (req.store or "").strip() or None
        result = await asyncio.wait_for(
            run_in_threadpool(
                translate_page_template,
                req.slug,
                store=store,
            ),
            timeout=180,
        )
        return result
    except asyncio.TimeoutError:
        return {"error": "Translation timed out. Please try again."}
    except Exception as e:
        return {"error": str(e)}


def _wholesale_placeholder_title(vendor_name: str) -> str:
    stamp = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    return f"{vendor_name} Product {stamp}"


def _wholesale_build_description_html(description: str | None, segment: str | None, season: str | None) -> str | None:
    desc_html = None
    if description:
        desc_html = f"<p>{description}</p>"
    if segment or season:
        parts = []
        if segment:
            parts.append(f"Segment: {segment}")
        if season:
            parts.append(f"Season: {season}")
        extra = " | ".join(parts)
        desc_html = (desc_html or "") + f"<p><em>{extra}</em></p>"
    return desc_html


def _wholesale_variant_title(size_from: Any, size_to: Any, pcs_per_crate: int) -> str:
    base = f"{size_from}-{size_to}"
    return f"{base}*{pcs_per_crate}pcs" if pcs_per_crate > 0 else base


WHOLESALE_SEGMENTS = {"men": "Men", "mens": "Men", "man": "Men", "women": "Women", "womens": "Women", "woman": "Women", "kids": "Kids", "kid": "Kids", "children": "Kids", "child": "Kids"}
WHOLESALE_SEASONS = {"winter": "Winter", "summer": "Summer", "spring": "Spring", "fall": "Fall", "autumn": "Fall", "all season": "All Season", "all-season": "All Season", "allseason": "All Season"}


def _wholesale_clean_label(value: Any) -> str:
    text = re.sub(r"\s+", " ", str(value or "").strip())
    return text[:80]


def _wholesale_unique_labels(values: list[Any]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for value in values or []:
        label = _wholesale_clean_label(value)
        if not label:
            continue
        key = label.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(label)
    return out


def _wholesale_normalize_segment(value: Any) -> str | None:
    raw = _wholesale_clean_label(value).lower()
    return WHOLESALE_SEGMENTS.get(raw)


def _wholesale_normalize_season(value: Any) -> str | None:
    raw = _wholesale_clean_label(value).lower()
    return WHOLESALE_SEASONS.get(raw)


def _wholesale_size_numbers(size_groups: list[dict] | None, sizes: list[str] | None = None) -> list[float]:
    nums: list[float] = []
    for sg in size_groups or []:
        if not isinstance(sg, dict):
            continue
        for key in ("from", "to", "size"):
            raw = str(sg.get(key) or "")
            nums.extend(float(m.group(1)) for m in re.finditer(r"(\d+(?:\.\d+)?)", raw))
    for raw_size in sizes or []:
        raw = str(raw_size or "")
        nums.extend(float(m.group(1)) for m in re.finditer(r"(\d+(?:\.\d+)?)", raw))
    return nums


def _wholesale_segment_from_sizes(size_groups: list[dict] | None, sizes: list[str] | None = None) -> str | None:
    nums = _wholesale_size_numbers(size_groups, sizes)
    if not nums:
        return None
    min_size = min(nums)
    max_size = max(nums)
    if max_size >= 40:
        return "Men"
    if max_size <= 35:
        return "Kids"
    if 36 <= min_size and max_size <= 41:
        return "Women"
    return None


def _wholesale_collection_for_segment(segment: str | None) -> str | None:
    seg = _wholesale_normalize_segment(segment)
    return seg if seg in {"Men", "Women", "Kids"} else None


def _wholesale_infer_product_type(title: Any, description: Any, tags: list[Any] | None, store_type: str | None) -> str | None:
    text = " ".join([str(title or ""), str(description or ""), " ".join(str(t or "") for t in (tags or []))]).lower()
    audience_prefix = ""
    if any(k in text for k in ("girl", "girls", "fille", "filles")):
        audience_prefix = "Girls"
    elif any(k in text for k in ("boy", "boys", "garcon", "garcons", "garçon", "garçons")):
        audience_prefix = "Boys"
    elif any(k in text for k in ("kid", "kids", "children", "child", "baby", "toddler")):
        audience_prefix = "Kids"
    elif any(k in text for k in ("women", "woman", "ladies")):
        audience_prefix = "Women"
    elif any(k in text for k in ("men", "man", "mens")):
        audience_prefix = "Men"

    def typed(label: str) -> str:
        if audience_prefix and not label.lower().startswith(audience_prefix.lower()):
            return f"{audience_prefix} {label}"
        return label

    matches = [
        (("led", "light up", "light-up", "lights"), "LED Shoes"),
        (("sandale", "sandal", "sandals"), "Sandals"),
        (("slide", "slides"), "Slides"),
        (("flip flop", "flip-flop"), "Flip Flops"),
        (("slipper", "slippers"), "Slippers"),
        (("boot", "boots"), "Boots"),
        (("sneaker", "sneakers", "trainer", "trainers"), "Sneakers"),
        (("sport", "sports", "running"), "Sport Shoes"),
        (("loafer", "loafers"), "Loafers"),
        (("heel", "heels"), "Heels"),
    ]
    for keys, label in matches:
        if any(k in text for k in keys):
            return typed(label)
    if (store_type or "").strip().lower() == "shoes":
        return typed("Shoes")
    return None


def _wholesale_infer_season(season: Any, product_type: Any, tags: list[Any] | None) -> str | None:
    normalized = _wholesale_normalize_season(season)
    if normalized:
        return normalized
    text = " ".join([str(product_type or ""), " ".join(str(t or "") for t in (tags or []))]).lower()
    if any(k in text for k in ("sandal", "sandale", "slide", "flip flop", "flip-flop")):
        return "Summer"
    if any(k in text for k in ("boot", "winter", "fur", "warm")):
        return "Winter"
    return None


def _wholesale_build_product_organization(
    req: WholesaleProductCreate,
    *,
    store_type: str | None,
) -> dict[str, Any]:
    size_segment = _wholesale_segment_from_sizes(req.size_groups, req.sizes)
    segment = size_segment or _wholesale_normalize_segment(req.segment)
    incoming_tags_all = _wholesale_unique_labels(req.tags or [])
    segment_values = {v.lower() for v in WHOLESALE_SEGMENTS.values()}
    incoming_tags = [
        tag for tag in incoming_tags_all
        if not tag.lower().startswith(("segment:", "season:", "collection:"))
        and tag.lower() not in segment_values
    ]
    product_type = _wholesale_clean_label(req.product_type) or _wholesale_infer_product_type(req.title, req.description, incoming_tags, store_type)
    season = _wholesale_infer_season(req.season, product_type, incoming_tags)
    collection = _wholesale_collection_for_segment(segment) if size_segment else (_wholesale_clean_label(req.collection) or _wholesale_collection_for_segment(segment))

    text = " ".join([str(req.title or ""), str(req.description or ""), " ".join(incoming_tags), str(product_type or "")]).lower()
    simple_tags: list[str] = []
    if segment:
        simple_tags.append(segment.lower())
    if season:
        simple_tags.append(season.lower().replace(" ", "-"))
    if collection:
        simple_tags.append(collection.lower())
    if any(k in text for k in ("girl", "girls", "fille", "filles")):
        simple_tags.append("girls")
    if any(k in text for k in ("boy", "boys", "garcon", "garcons", "garçon", "garçons")):
        simple_tags.append("boys")
    if any(k in text for k in ("sandale", "sandal", "sandals")):
        simple_tags.append("sandals")
    if any(k in text for k in ("led", "light up", "light-up", "lights")):
        simple_tags.append("led-shoes")
    if any(k in text for k in ("sneaker", "sneakers", "trainer", "trainers")):
        simple_tags.append("sneakers")
    if any(k in text for k in ("boot", "boots")):
        simple_tags.append("boots")
    if (store_type or "").strip().lower() == "shoes":
        simple_tags.append("shoes")

    extra_tags = [*incoming_tags, *simple_tags]
    if product_type:
        pt_lc = product_type.lower()
        if "sandal" in pt_lc or "sandale" in pt_lc:
            extra_tags.append("sandals")
        if "led" in pt_lc:
            extra_tags.append("led-shoes")
    return {
        "segment": segment,
        "season": season,
        "collection": collection,
        "product_type": product_type,
        "tags": _wholesale_unique_labels(extra_tags),
    }


def _wholesale_attach_product_to_collection(product_gid: str, collection_name: str | None) -> None:
    """Best-effort: add to a manual collection if it exists; smart collections can use the tags."""
    collection = _wholesale_clean_label(collection_name)
    if not (product_gid and collection):
        return
    try:
        from app.integrations.shopify_client import _numeric_product_id_from_gid, _rest_get_store, _rest_post_store

        product_id = _numeric_product_id_from_gid(product_gid)
        if not product_id:
            return
        wanted = collection.strip().lower()
        handles = [
            re.sub(r"[^a-z0-9]+", "-", wanted).strip("-"),
            re.sub(r"[^a-z0-9]+", "-", f"{wanted} shoes").strip("-"),
        ]
        custom_collections: list[dict[str, Any]] = []
        for handle in [h for h in handles if h]:
            try:
                data = _rest_get_store(WHOLESALE_STORE, f"/custom_collections.json?handle={quote(handle, safe='')}&limit=10")
                custom_collections.extend((data or {}).get("custom_collections") or [])
            except Exception:
                continue
        if not custom_collections:
            try:
                data = _rest_get_store(WHOLESALE_STORE, "/custom_collections.json?limit=250")
                custom_collections.extend((data or {}).get("custom_collections") or [])
            except Exception:
                pass
        for coll in custom_collections:
            title = str((coll or {}).get("title") or "").strip().lower()
            handle = str((coll or {}).get("handle") or "").strip().lower()
            if title not in {wanted, f"{wanted} shoes"} and handle not in set(handles):
                continue
            collection_id = coll.get("id")
            if not collection_id:
                continue
            try:
                _rest_post_store(
                    WHOLESALE_STORE,
                    "/collects.json",
                    {"collect": {"product_id": int(product_id), "collection_id": int(collection_id)}},
                )
            except Exception:
                pass
            return
    except Exception:
        return


def _wholesale_decode_data_url_image(data_url: str, fallback_name: str) -> tuple[str, bytes] | None:
    try:
        m = re.match(r"^data:(image/[A-Za-z0-9.+-]+);base64,(.+)$", data_url or "", re.DOTALL)
        if not m:
            return None
        mime = m.group(1).lower()
        ext = mimetypes.guess_extension(mime) or ".png"
        if ext == ".jpe":
            ext = ".jpg"
        return f"{fallback_name}{ext}", base64.b64decode(m.group(2))
    except Exception:
        return None


def _wholesale_store_original_image_metafields(
    product_gid: str,
    image_url: str | None,
    catalog_image_url: str | None,
) -> None:
    """Persist vendor-visible original image URLs immediately after product creation."""
    from app.integrations.shopify_client import set_product_wholesale_image_metafields

    values = {
        "vendor_original_image_url": (image_url or "").strip() or None,
        "vendor_original_catalog_image_url": (catalog_image_url or "").strip() or None,
    }
    set_product_wholesale_image_metafields(product_gid, values, store=WHOLESALE_STORE)


def _wholesale_prepare_storefront_images(
    product_gid: str,
    image_url: str | None,
    catalog_image_url: str | None,
    alt_base: str,
) -> list[tuple[str, bytes]]:
    """Store vendor originals privately and return generated images for product media."""
    from app.integrations.shopify_client import (
        set_product_wholesale_image_metafields,
        upload_remote_image_to_shopify_files,
    )

    generated_files: list[tuple[str, bytes]] = []
    metafields: dict[str, str | None] = {}
    sources = [
        ("vendor_original_image_url", "vendor_original_shopify_file_url", image_url, "primary"),
        ("vendor_original_catalog_image_url", "vendor_original_catalog_shopify_file_url", catalog_image_url, "catalog"),
    ]

    for original_key, file_key, source_url, label in sources:
        source = (source_url or "").strip()
        if not source:
            continue

        metafields[original_key] = source
        try:
            if "cdn.shopify.com" in source.lower():
                metafields[file_key] = source
            else:
                file_info = upload_remote_image_to_shopify_files(source, f"{alt_base} vendor original {label}", store=WHOLESALE_STORE)
                file_url = str((file_info or {}).get("url") or "").strip()
                if file_url:
                    metafields[file_key] = file_url
        except Exception as e:
            logging.getLogger("app.wholesale").warning("Failed to upload vendor original to Shopify Files: %s", e)

        try:
            clean_data_url = gen_clean_wholesale_product_image_openai(source)
            decoded = _wholesale_decode_data_url_image(clean_data_url or "", f"wholesale-clean-{label}-{uuid4().hex[:8]}")
            if decoded:
                generated_files.append(decoded)
            else:
                logging.getLogger("app.wholesale").warning("No generated wholesale image returned for %s", label)
        except Exception as e:
            logging.getLogger("app.wholesale").exception("Failed to generate wholesale image for %s: %r", label, e)

    try:
        set_product_wholesale_image_metafields(product_gid, metafields, store=WHOLESALE_STORE)
    except Exception as e:
        logging.getLogger("app.wholesale").warning("Failed to save wholesale image metafields: %s", e)

    return generated_files


def _wholesale_product_ai_payload(
    *,
    vendor_name: str,
    store_type: str | None,
    title: str | None,
    description: str | None,
    colors: list[str] | None,
    size_groups: list[dict] | None,
    explicit_variants: list[dict] | None,
    sale_price: float | None,
    compare_at_price: float | None,
    segment: str | None,
    season: str | None,
    ai_data: dict | None = None,
) -> dict[str, Any]:
    variants_context: list[dict[str, Any]] = []
    for sg in size_groups or []:
        try:
            fr = sg.get("from")
            to = sg.get("to")
            pcs = int(sg.get("pcs_per_crate") or sg.get("pcs") or 0)
            qty = int(sg.get("crate_quantity") or sg.get("qty") or 0)
            variants_context.append({
                "size": _wholesale_variant_title(fr, to, pcs),
                "from": fr,
                "to": to,
                "pcs_per_crate": pcs,
                "crate_quantity": qty,
                "sku": str(sg.get("sku") or "").strip(),
            })
        except Exception:
            continue

    if not variants_context:
        for v in explicit_variants or []:
            if not isinstance(v, dict):
                continue
            variants_context.append({
                "size": v.get("size") or v.get("option1"),
                "color": v.get("color") or v.get("option2"),
                "quantity": v.get("quantity"),
                "pcs_per_crate": v.get("pcs_per_crate"),
                "sku": v.get("sku"),
                "price": v.get("price"),
            })

    ai_data = ai_data if isinstance(ai_data, dict) else {}
    detected_colors = [str(c).strip() for c in (ai_data.get("colors") or []) if str(c).strip()]
    visual_variants = [
        {"name": (v or {}).get("name"), "description": (v or {}).get("description")}
        for v in (ai_data.get("variants") or [])
        if isinstance(v, dict)
    ]
    benefits = [str(b).strip() for b in (ai_data.get("benefits") or []) if str(b).strip()]

    return {
        "vendor": vendor_name,
        "store_type": store_type or "general",
        "region": "MA",
        "delivery": "Fast delivery to all cities",
        "title": title,
        "description": description,
        "segment": segment,
        "season": season,
        "colors": [c for c in (colors or []) if str(c).strip()] or detected_colors,
        "detected_colors": detected_colors,
        "sizes": [v.get("size") for v in variants_context if v.get("size")],
        "variants": variants_context,
        "visual_variants": visual_variants,
        "features": benefits,
        "pricing": {
            "sale_price": sale_price,
            "compare_at_price": compare_at_price,
        },
        "merchandising_goal": "Explain why this product will sell well for retailers and include the strongest product features.",
    }


def _wholesale_finalize_product_background(
    product_gid: str,
    initial_title: str,
    image_url: str | None,
    catalog_image_url: str | None,
    title: str | None,
    description: str | None,
    segment: str | None,
    season: str | None,
    cog_price: float | None,
    vendor_name: str | None = None,
    store_type: str | None = None,
    colors: list[str] | None = None,
    size_groups: list[dict] | None = None,
    explicit_variants: list[dict] | None = None,
    sale_price: float | None = None,
    compare_at_price: float | None = None,
) -> None:
    try:
        from app.integrations.shopify_client import (
            _list_variants,
            _numeric_product_id_from_gid,
            _set_inventory_item_cost,
            update_product_description,
            update_product_organization,
            update_product_title,
            upload_image_attachments_to_product,
        )

        final_title = (title or "").strip() or initial_title
        final_description = (description or "").strip()

        ai_data: dict[str, Any] = {}
        if image_url:
            try:
                ai_data = gen_product_from_image(image_url) or {}
                ai_title = str((ai_data or {}).get("title") or "").strip()
                if ai_title:
                    final_title = ai_title
                if not final_description:
                    benefits = (ai_data or {}).get("benefits") or []
                    final_description = ". ".join(str(b).strip() for b in benefits if str(b).strip())
            except Exception:
                pass

        try:
            prompt = _wholesale_title_description_prompt_for(store_type)
            payload = _wholesale_product_ai_payload(
                vendor_name=vendor_name or "",
                store_type=store_type,
                title=title or final_title,
                description=description or final_description,
                colors=colors,
                size_groups=size_groups,
                explicit_variants=explicit_variants,
                sale_price=sale_price,
                compare_at_price=compare_at_price,
                segment=segment,
                season=season,
                ai_data=ai_data,
            )
            angle = {
                "name": f"{store_type or 'wholesale'} product listing",
                "goal": "Generate Shopify title and description that convert wholesale buyers.",
            }
            generated = gen_title_and_description(payload, angle, prompt_override=prompt, image_urls=([image_url] if image_url else [])) or {}
            gen_title = str((generated or {}).get("title") or "").strip()
            gen_description = str((generated or {}).get("description") or "").strip()
            if gen_title:
                final_title = gen_title
            if gen_description:
                final_description = gen_description
        except Exception:
            pass

        try:
            org_req = WholesaleProductCreate(
                title=final_title,
                description=final_description,
                segment=segment,
                season=season,
                collection=None,
                product_type=None,
                tags=[str(t) for t in ((ai_data or {}).get("tags") or []) if str(t).strip()],
                colors=colors,
                sizes=[str(v.get("size")) for v in (explicit_variants or []) if isinstance(v, dict) and v.get("size")],
                size_groups=size_groups,
            )
            organization = _wholesale_build_product_organization(org_req, store_type=store_type)
            org_tags = _wholesale_unique_labels([*(organization.get("tags") or [])])
            if organization.get("product_type") or org_tags:
                update_product_organization(
                    product_gid,
                    product_type=organization.get("product_type"),
                    tags=org_tags,
                    merge_tags=True,
                    store=WHOLESALE_STORE,
                )
            if organization.get("collection"):
                _wholesale_attach_product_to_collection(product_gid, organization.get("collection"))
        except Exception:
            pass

        final_desc_html = _wholesale_build_description_html(final_description or None, segment, season)

        if final_title and final_title != initial_title:
            try:
                update_product_title(product_gid, final_title, store=WHOLESALE_STORE)
            except Exception:
                pass

        if final_desc_html:
            try:
                update_product_description(product_gid, final_desc_html, store=WHOLESALE_STORE)
            except Exception:
                pass

        generated_images = _wholesale_prepare_storefront_images(
            product_gid,
            image_url,
            catalog_image_url,
            final_title,
        )
        if generated_images:
            try:
                alt_texts = [final_title]
                if len(generated_images) > 1:
                    alt_texts.append(f"{final_title} catalog image")
                upload_image_attachments_to_product(product_gid, generated_images, alt_texts, store=WHOLESALE_STORE)
            except Exception as e:
                logging.getLogger("app.wholesale").exception("Failed to upload generated wholesale images to product %s: %r", product_gid, e)

        if cog_price is not None:
            try:
                numeric_id = _numeric_product_id_from_gid(product_gid)
                if numeric_id:
                    all_variants = _list_variants(numeric_id, store=WHOLESALE_STORE)
                    for var in (all_variants or []):
                        inv_id = str(var.get("inventory_item_id") or "")
                        if inv_id and inv_id != "None":
                            _set_inventory_item_cost(inv_id, cog_price, store=WHOLESALE_STORE)
            except Exception:
                pass
    except Exception:
        pass


def _wholesale_configure_product_background(
    product_gid: str,
    initial_title: str,
    image_url: str | None,
    catalog_image_url: str | None,
    title: str | None,
    description: str | None,
    segment: str | None,
    season: str | None,
    cog_price: float | None,
    base_price: float | None,
    explicit_variants: list[dict] | None,
    vendor_name: str | None = None,
    store_type: str | None = None,
    colors: list[str] | None = None,
    size_groups: list[dict] | None = None,
    sale_price: float | None = None,
    compare_at_price: float | None = None,
) -> None:
    try:
        from app.integrations.shopify_client import (
            configure_variants_for_product,
            publish_product_all_channels,
        )

        try:
            configure_variants_for_product(
                product_gid,
                base_price,
                sizes=None,
                colors=None,
                track_quantity=True,
                quantity=None,
                variants=explicit_variants if explicit_variants else None,
                store=WHOLESALE_STORE,
            )
        except Exception:
            pass

        _wholesale_finalize_product_background(
            product_gid,
            initial_title,
            image_url,
            catalog_image_url,
            title,
            description,
            segment,
            season,
            cog_price,
            vendor_name,
            store_type,
            colors,
            size_groups,
            explicit_variants,
            sale_price,
            compare_at_price,
        )

        try:
            publish_product_all_channels(product_gid, store=WHOLESALE_STORE)
        except Exception:
            pass
    except Exception:
        pass


def _wholesale_inventory_levels_for_items(inventory_item_ids: list[Any]) -> dict[str, dict[str, Any]]:
    from app.integrations.shopify_client import _rest_get_store

    ids = [str(i).strip() for i in (inventory_item_ids or []) if str(i).strip() and str(i).strip() != "None"]
    levels_by_item: dict[str, dict[str, Any]] = {}
    for i in range(0, len(ids), 50):
        batch = ",".join(ids[i:i + 50])
        if not batch:
            continue
        try:
            data = _rest_get_store(WHOLESALE_STORE, f"/inventory_levels.json?inventory_item_ids={batch}")
            for level in (data or {}).get("inventory_levels", []) or []:
                item_id = str(level.get("inventory_item_id") or "")
                if not item_id:
                    continue
                current = levels_by_item.get(item_id) or {"available": 0, "locations": []}
                available = int(level.get("available") or 0)
                current["available"] = int(current.get("available") or 0) + available
                current["locations"].append(level)
                levels_by_item[item_id] = current
        except Exception:
            continue
    return levels_by_item


def _wholesale_enrich_products_inventory(products: list[dict]) -> list[dict]:
    item_ids: list[Any] = []
    for product in products or []:
        for variant in (product.get("variants") or []) or []:
            item_ids.append(variant.get("inventory_item_id"))

    levels = _wholesale_inventory_levels_for_items(item_ids)
    for product in products or []:
        product_available = 0
        product_on_hand = 0
        for variant in (product.get("variants") or []) or []:
            item_id = str(variant.get("inventory_item_id") or "")
            level_info = levels.get(item_id) or {}
            available = int(level_info.get("available") if level_info.get("available") is not None else (variant.get("inventory_quantity") or 0))
            on_hand = int(variant.get("inventory_quantity") if variant.get("inventory_quantity") is not None else available)
            variant["inventory_available"] = available
            variant["available_quantity"] = available
            variant["inventory_on_hand"] = on_hand
            variant["inventory_locations"] = level_info.get("locations") or []
            product_available += max(0, available)
            product_on_hand += max(0, on_hand)
        product["inventory_available"] = product_available
        product["inventory_on_hand"] = product_on_hand
    return products


def _wholesale_apply_vendor_original_images(products: list[dict]) -> list[dict]:
    """Show vendor originals in the dashboard even when storefront media is generated."""
    from app.integrations.shopify_client import _rest_get_store

    for product in products or []:
        numeric_id = str(product.get("id") or "").strip()
        if not numeric_id:
            continue
        original_url = ""
        try:
            data = _rest_get_store(WHOLESALE_STORE, f"/products/{numeric_id}/metafields.json?namespace=wholesale")
            for metafield in (data or {}).get("metafields", []) or []:
                key = str((metafield or {}).get("key") or "")
                if key == "vendor_original_shopify_file_url":
                    original_url = str((metafield or {}).get("value") or "").strip()
                    break
                if key == "vendor_original_image_url" and not original_url:
                    original_url = str((metafield or {}).get("value") or "").strip()
        except Exception:
            continue
        if not original_url:
            continue

        image = {"src": original_url}
        existing_images = product.get("images") if isinstance(product.get("images"), list) else []
        product["images"] = [image] + [img for img in existing_images if (img or {}).get("src") != original_url]
        product["image"] = image
        product["vendor_original_image_url"] = original_url
    return products


def _wholesale_variant_availability(variant_ids: list[int]) -> dict[int, dict[str, Any]]:
    from app.integrations.shopify_client import _rest_get_store

    variants_by_id: dict[int, dict[str, Any]] = {}
    item_ids: list[Any] = []
    for variant_id in variant_ids:
        try:
            data = _rest_get_store(WHOLESALE_STORE, f"/variants/{int(variant_id)}.json")
            variant = (data or {}).get("variant") or {}
            if variant.get("id"):
                variants_by_id[int(variant["id"])] = variant
                item_ids.append(variant.get("inventory_item_id"))
        except Exception:
            continue

    levels = _wholesale_inventory_levels_for_items(item_ids)
    availability: dict[int, dict[str, Any]] = {}
    for variant_id, variant in variants_by_id.items():
        item_id = str(variant.get("inventory_item_id") or "")
        level_info = levels.get(item_id) or {}
        available = int(level_info.get("available") if level_info.get("available") is not None else (variant.get("inventory_quantity") or 0))
        availability[variant_id] = {
            "variant": variant,
            "inventory_item_id": item_id,
            "available": max(0, available),
            "locations": level_info.get("locations") or [],
        }
    return availability


@app.get("/api/wholesale/vendors/{vendor_id}/products")
async def api_wholesale_vendor_products(vendor_id: str):
    """List products for a specific vendor from the MMD Shopify store."""
    try:
        vid = (vendor_id or "").strip().lower()
        if not vid:
            return {"error": "vendor_id is required"}

        # Verify vendor exists
        key = _wholesale_vendor_key(vid)
        vendor = db.get_app_setting(WHOLESALE_STORE, key)
        if not isinstance(vendor, dict):
            return {"error": "vendor_not_found"}

        vendor_name = vendor.get("name", vid)
        from app.integrations.shopify_client import list_products_by_vendor
        products = list_products_by_vendor(vendor_name, store=WHOLESALE_STORE, limit=250)
        products = await run_in_threadpool(_wholesale_apply_vendor_original_images, products)
        products = await run_in_threadpool(_wholesale_enrich_products_inventory, products)
        return {"data": products}
    except Exception as e:
        return {"error": str(e)}


@app.post("/api/wholesale/vendors/{vendor_id}/products")
async def api_wholesale_create_product(vendor_id: str, req: WholesaleProductCreate, background_tasks: BackgroundTasks):
    """Create a product on the MMD Shopify store tagged with the vendor name."""
    try:
        vid = (vendor_id or "").strip().lower()
        if not vid:
            return {"error": "vendor_id is required"}

        # Verify vendor exists
        key = _wholesale_vendor_key(vid)
        vendor = db.get_app_setting(WHOLESALE_STORE, key)
        if not isinstance(vendor, dict):
            return {"error": "vendor_not_found"}

        vendor_name = vendor.get("name", vid)
        store_type = str(vendor.get("store_type") or "general").strip().lower()
        if store_type not in WHOLESALE_STORE_TYPES:
            store_type = "general"
        title = (req.title or "").strip() or _wholesale_placeholder_title(vendor_name)
        organization = _wholesale_build_product_organization(req, store_type=store_type)
        segment = organization.get("segment")
        season = organization.get("season")
        collection_name = organization.get("collection")
        product_type = organization.get("product_type")
        desc_html = _wholesale_build_description_html(req.description, segment, season)

        # Tags for filtering
        tags_list = _wholesale_unique_labels([f"vendor:{vendor_name}", *organization.get("tags", [])])

        # ── Derive sizes from size_groups ──
        # Each group {from, to, qty} becomes a size like "20-25" with its own qty
        variant_specs: list[dict[str, Any]] = []
        base_sale_price = float(req.sale_price or 0)
        base_compare_at_price = float(req.compare_at_price or 0)
        if req.size_groups:
            for sg in req.size_groups:
                fr = sg.get("from", 0)
                to = sg.get("to", 0)
                pcs_per_crate = int(sg.get("pcs_per_crate") or sg.get("pcs") or 0)
                crate_quantity = int(sg.get("crate_quantity") or sg.get("qty") or 0)
                unit_sale_price = _wholesale_safe_float(sg.get("sale_price"), base_sale_price)
                unit_compare_at_price = _wholesale_safe_float(sg.get("compare_at_price"), base_compare_at_price)
                unit_cog_price = sg.get("cog_price")
                variant_price = round(unit_sale_price * pcs_per_crate, 2) if pcs_per_crate > 0 else unit_sale_price
                variant_spec = {
                    "size": _wholesale_variant_title(fr, to, pcs_per_crate),
                    "quantity": crate_quantity,
                    "price": variant_price,
                    "sku": str(sg.get("sku") or req.variant_group_id or "").strip(),
                    "pcs_per_crate": pcs_per_crate,
                }
                try:
                    if unit_cog_price is not None and float(unit_cog_price) > 0:
                        variant_spec["cog_price"] = float(unit_cog_price)
                except Exception:
                    pass
                if unit_compare_at_price > 0:
                    variant_spec["compare_at_price"] = round(unit_compare_at_price * pcs_per_crate, 2) if pcs_per_crate > 0 else unit_compare_at_price
                variant_specs.append(variant_spec)

        # ── Combine colors into a single value ──
        # e.g., ["black", "green", "blue"] → "black/green/blue"
        combined_color: str | None = None
        if req.colors and len(req.colors) > 0:
            combined_color = "/".join(c.strip() for c in req.colors if c.strip())

        # ── Build explicit variants ──
        # Each size gets its own variant with the combined color, sale_price, and per-size qty
        explicit_variants: list[dict] = []
        if variant_specs:
            for spec in variant_specs:
                v: dict = {
                    "size": spec["size"],
                    "price": spec["price"],
                    "quantity": spec["quantity"],
                    "track_quantity": True,
                    "requires_shipping": True,
                }
                if spec.get("compare_at_price"):
                    v["compare_at_price"] = spec["compare_at_price"]
                if spec.get("cog_price"):
                    v["cog_price"] = spec["cog_price"]
                if int(spec.get("pcs_per_crate") or 0) > 0:
                    v["unit_price_measurement"] = {
                        "quantityValue": float(spec["pcs_per_crate"]),
                        "quantityUnit": "ITEM",
                        "referenceValue": 1,
                        "referenceUnit": "ITEM",
                    }
                    v["show_unit_price"] = True
                if combined_color:
                    v["color"] = combined_color
                if spec["sku"]:
                    v["sku"] = spec["sku"]
                explicit_variants.append(v)
        elif combined_color:
            v_color: dict = {
                "color": combined_color,
                "price": req.sale_price,
                "track_quantity": True,
                "requires_shipping": True,
            }
            if req.compare_at_price:
                v_color["compare_at_price"] = req.compare_at_price
            v_color["unit_price_measurement"] = {
                "quantityValue": 1.0,
                "quantityUnit": "ITEM",
                "referenceValue": 1,
                "referenceUnit": "ITEM",
            }
            v_color["show_unit_price"] = True
            if req.variant_group_id:
                v_color["sku"] = req.variant_group_id.strip()
            explicit_variants.append(v_color)

        from app.integrations.shopify_client import create_product_only as _create_product

        result = await run_in_threadpool(
            _create_product,
            title=title,
            description_html=desc_html,
            status="ACTIVE",
            price=explicit_variants[0]["price"] if explicit_variants else req.sale_price,
            sizes=None,   # handled via explicit variants
            colors=None,   # handled via explicit variants
            product_type=product_type,
            vendor=vendor_name,
            tags=tags_list,
            track_quantity=True,
            quantity=None,  # per-variant quantities via explicit variants
            variants=None,
            store=WHOLESALE_STORE,
            configure_variants=False,
            publish=False,
        )

        # ── Set COG price as cost per item on each variant ──
        image_url = (req.image_url or "").strip() if req.image_url else None
        catalog_image_url = (req.catalog_image_url or "").strip() if req.catalog_image_url else None
        product_gid = ((result or {}).get("product") or {}).get("id") if isinstance(result, dict) else None
        if product_gid:
            try:
                await run_in_threadpool(
                    _wholesale_store_original_image_metafields,
                    product_gid,
                    image_url,
                    catalog_image_url,
                )
            except Exception as e:
                logging.getLogger("app.wholesale").warning("Failed to save original wholesale image before background task: %s", e)
            background_tasks.add_task(
                _wholesale_configure_product_background,
                product_gid,
                title,
                image_url,
                catalog_image_url,
                req.title,
                req.description,
                segment,
                season,
                req.cog_price,
                explicit_variants[0]["price"] if explicit_variants else req.sale_price,
                explicit_variants if explicit_variants else None,
                vendor_name,
                store_type,
                req.colors,
                req.size_groups,
                req.sale_price,
                req.compare_at_price,
            )
            if collection_name:
                background_tasks.add_task(
                    _wholesale_attach_product_to_collection,
                    product_gid,
                    collection_name,
                )

        return {"data": result, "background_processing": bool(product_gid), "organization": organization}
    except Exception as e:
        return {"error": str(e)}


# ─── Wholesale Order Models ────────────────────────────────────────────
@app.patch("/api/wholesale/vendors/{vendor_id}/products/{product_id}/variants/{variant_id}/inventory")
async def api_wholesale_update_variant_inventory(vendor_id: str, product_id: str, variant_id: str, req: WholesaleInventoryUpdate):
    """Set a vendor product variant's available inventory quantity in Shopify."""
    try:
        vendor_id_norm = (vendor_id or "").strip().lower()
        key = _wholesale_vendor_key(vendor_id_norm)
        vendor = db.get_app_setting(WHOLESALE_STORE, key)
        if not isinstance(vendor, dict):
            return {"error": "vendor_not_found"}
        vendor_name = vendor.get("name", vendor_id_norm)

        from app.integrations.shopify_client import (
            _get_location_id_from_inventory_levels,
            _get_primary_location_id,
            _rest_get_store,
            _set_inventory_level,
            _set_inventory_tracked,
        )

        product_numeric_id = str(product_id).split("/")[-1]
        product_data = await run_in_threadpool(_rest_get_store, WHOLESALE_STORE, f"/products/{product_numeric_id}.json")
        product = (product_data or {}).get("product") or {}
        if not product:
            return {"error": "product_not_found"}

        product_vendor = str(product.get("vendor") or "").strip()
        tags = _wholesale_tags_set(product.get("tags"))
        if product_vendor.lower() != str(vendor_name).strip().lower() and _wholesale_vendor_name_tag(vendor_name).lower() not in tags:
            return {"error": "product_not_found"}

        variant_numeric_id = int(str(variant_id).split("/")[-1])
        variant = next((v for v in (product.get("variants") or []) if int(v.get("id") or 0) == variant_numeric_id), None)
        if not variant:
            return {"error": "variant_not_found"}

        inventory_item_id = str(variant.get("inventory_item_id") or "")
        if not inventory_item_id or inventory_item_id == "None":
            return {"error": "inventory_item_not_found"}

        quantity = max(0, int(req.quantity or 0))
        await run_in_threadpool(_set_inventory_tracked, inventory_item_id, True, store=WHOLESALE_STORE)
        location_id = await run_in_threadpool(_get_location_id_from_inventory_levels, [inventory_item_id], store=WHOLESALE_STORE)
        if not location_id:
            location_id = await run_in_threadpool(_get_primary_location_id, WHOLESALE_STORE)
        if not location_id:
            return {"error": "inventory_location_not_found"}

        await run_in_threadpool(_set_inventory_level, str(location_id), inventory_item_id, quantity, store=WHOLESALE_STORE)
        availability = await run_in_threadpool(_wholesale_variant_availability, [variant_numeric_id])
        available = int((availability.get(variant_numeric_id) or {}).get("available") or quantity)
        return {
            "data": {
                "product_id": product_numeric_id,
                "variant_id": variant_numeric_id,
                "inventory_item_id": inventory_item_id,
                "available": available,
                "on_hand": quantity,
            }
        }
    except Exception as e:
        return {"error": str(e)}


class WholesaleOrderLineItem(BaseModel):
    variant_id: int
    quantity: int = 1

class WholesaleOrderCreate(BaseModel):
    customer_name: str  # "First Last"
    customer_phone: str
    customer_address1: Optional[str] = "NA"
    customer_city: Optional[str] = "Casablanca"
    customer_province: Optional[str] = "Casablanca-Settat"
    customer_zip: Optional[str] = "20000"
    customer_country: Optional[str] = "MA"
    line_items: List[WholesaleOrderLineItem]
    note: Optional[str] = None

# ─── Wholesale Create Order ────────────────────────────────────────────
class WholesaleOrderCancelRequest(BaseModel):
    reason: Optional[str] = "customer"


class WholesaleOrderStatusUpdate(BaseModel):
    order_status: str
    note: Optional[str] = None


@app.post("/api/wholesale/vendors/{vendor_id}/orders")
async def api_wholesale_create_order(vendor_id: str, req: WholesaleOrderCreate):
    import logging
    _log = logging.getLogger("wholesale.orders")
    try:
        vendor_id_norm = (vendor_id or "").strip().lower()
        key = _wholesale_vendor_key(vendor_id_norm)
        vendor = db.get_app_setting(WHOLESALE_STORE, key)
        if not vendor:
            return {"error": "Vendor not found"}
        vendor_name = vendor.get("name", vendor_id_norm)

        requested_by_variant: dict[int, int] = {}
        for li in req.line_items or []:
            requested_by_variant[int(li.variant_id)] = requested_by_variant.get(int(li.variant_id), 0) + max(0, int(li.quantity or 0))
        if not requested_by_variant:
            return {"error": "Add at least one product"}
        variant_stock = await run_in_threadpool(_wholesale_variant_availability, list(requested_by_variant.keys()))
        insufficient: list[dict[str, Any]] = []
        for variant_id, requested_qty in requested_by_variant.items():
            stock = variant_stock.get(variant_id)
            available = int((stock or {}).get("available") or 0)
            title = (((stock or {}).get("variant") or {}).get("title") or str(variant_id))
            if requested_qty > available:
                insufficient.append({
                    "variant_id": variant_id,
                    "title": title,
                    "requested": requested_qty,
                    "available": available,
                })
        if insufficient:
            return {"error": "insufficient_inventory", "details": insufficient}

        # Split customer name into first/last
        name_parts = req.customer_name.strip().split(" ", 1)
        first_name = name_parts[0]
        last_name = name_parts[1] if len(name_parts) > 1 else ""

        # Force a unique synthetic email so Shopify creates a fresh customer per dashboard order.
        synthetic_email = f"wholesale-{vendor_id_norm}-{int(time.time() * 1000)}@mmd.local"
        customer_tags = _wholesale_tags_csv(vendor_name, vendor_id_norm, include_customer=True)
        order_tags = _wholesale_tags_csv(vendor_name, vendor_id_norm, include_customer=False)
        normalized_phone = _wholesale_normalize_phone(req.customer_phone)
        existing_customer: dict[str, Any] | None = None

        if normalized_phone:
            existing_customer = await run_in_threadpool(_wholesale_find_existing_customer_by_phone, req.customer_phone)
            if not existing_customer:
                prior_orders = await run_in_threadpool(_wholesale_fetch_shopify_vendor_orders, vendor_name, vendor_id_norm)
                for prior_order in prior_orders:
                    snapshot = _wholesale_extract_customer_snapshot(prior_order)
                    if snapshot.get("customer_id") and snapshot.get("customer_phone_normalized") == normalized_phone:
                        existing_customer = snapshot
                        break

        customer_payload: dict[str, Any]
        if existing_customer and existing_customer.get("customer_id"):
            customer_payload = {"id": existing_customer["customer_id"]}
        else:
            customer_payload = {
                "first_name": first_name,
                "last_name": last_name,
                "email": synthetic_email,
                "tags": customer_tags,
            }

        # Build Shopify order payload
        order_payload = {
            "order": {
                "line_items": [
                    {"variant_id": li.variant_id, "quantity": li.quantity}
                    for li in req.line_items
                ],
                "customer": customer_payload,
                "shipping_address": {
                    "first_name": first_name,
                    "last_name": last_name,
                    "name": req.customer_name.strip(),
                    "address1": req.customer_address1 or "NA",
                    "city": req.customer_city or "Casablanca",
                    "province_code": "",
                    "zip": req.customer_zip or "20000",
                    "country_code": req.customer_country or "MA",
                    "phone": req.customer_phone.strip(),
                },
                "billing_address": {
                    "first_name": first_name,
                    "last_name": last_name,
                    "name": req.customer_name.strip(),
                    "address1": req.customer_address1 or "NA",
                    "city": req.customer_city or "Casablanca",
                    "province_code": "",
                    "zip": req.customer_zip or "20000",
                    "country_code": req.customer_country or "MA",
                    "phone": req.customer_phone.strip(),
                },
                "tags": order_tags,
                "financial_status": "pending",
                "inventory_behaviour": "decrement_obeying_policy",
                "send_receipt": False,
                "send_fulfillment_receipt": False,
            }
        }
        if req.note:
            order_payload["order"]["note"] = req.note

        _log.info(f"Creating wholesale order for vendor={vendor_name}, payload keys={list(order_payload['order'].keys())}")

        # Call Shopify - capture response body on errors
        import requests as _requests
        from app.integrations.shopify_client import _get_store_config
        cfg = _get_store_config(WHOLESALE_STORE)
        url = f"{cfg['BASE']}/orders.json"
        auth = None
        if not cfg["TOKEN"]:
            if cfg["API_KEY"] and cfg["PASSWORD"]:
                auth = (cfg["API_KEY"], cfg["PASSWORD"])
        r = _requests.post(url, headers=cfg["HEADERS"], json=order_payload, timeout=60, auth=auth)
        if r.status_code >= 400:
            try:
                err_body = r.json()
            except Exception:
                err_body = r.text
            _log.error(f"Shopify order creation failed: status={r.status_code}, body={err_body}")
            return {"error": f"Shopify {r.status_code}: {err_body}"}
        result = r.json() if r.content else {}
        order = result.get("order", {})
        return {
            "data": {
                "id": order.get("id"),
                "order_number": order.get("order_number"),
                "name": order.get("name"),
                "total_price": order.get("total_price"),
                "created_at": order.get("created_at"),
                "tags": order.get("tags"),
            }
        }
    except Exception as e:
        _log.error(f"Wholesale order creation exception: {e}", exc_info=True)
        return {"error": str(e)}


# ─── Wholesale Order Analytics ─────────────────────────────────────────
@app.get("/api/wholesale/vendors/{vendor_id}/orders")
async def api_wholesale_vendor_orders(vendor_id: str):
    try:
        vendor_id_norm = (vendor_id or "").strip().lower()
        key = _wholesale_vendor_key(vendor_id_norm)
        vendor = db.get_app_setting(WHOLESALE_STORE, key)
        if not vendor:
            return {"error": "Vendor not found"}
        vendor_name = vendor.get("name", vendor_id_norm)

        orders = await run_in_threadpool(_wholesale_fetch_shopify_vendor_orders, vendor_name, vendor_id_norm)

        total_orders = len(orders)
        total_units = 0
        total_revenue = 0.0
        all_orders = []
        for o in orders:
            is_cancelled = bool(o.get("cancelled_at"))
            line_items = o.get("line_items", [])
            order_units = sum(li.get("quantity", 0) for li in line_items)
            if not is_cancelled:
                total_units += order_units
                try:
                    total_revenue += float(o.get("total_price", 0))
                except (ValueError, TypeError):
                    pass

            snapshot = _wholesale_extract_customer_snapshot(o)

            # Build line items detail
            items_detail = []
            for li in line_items:
                items_detail.append({
                    "title": li.get("title", ""),
                    "variant_title": li.get("variant_title", ""),
                    "sku": li.get("sku", ""),
                    "quantity": li.get("quantity", 0),
                    "price": li.get("price", "0.00"),
                })

            # Load DB payment data for this order
            order_id = str(o.get("id", ""))
            payment_key = f"wholesale_order_payment:{vendor_id_norm}:{order_id}"
            payment_data = db.get_app_setting(WHOLESALE_STORE, payment_key)
            if not isinstance(payment_data, dict):
                payment_data = {}
            status_key = f"wholesale_order_status:{vendor_id_norm}:{order_id}"
            status_data = db.get_app_setting(WHOLESALE_STORE, status_key)
            if not isinstance(status_data, dict):
                status_data = {}
            workflow_status = str(status_data.get("order_status") or "").strip().lower()
            if not workflow_status:
                workflow_status = "fulfilled" if str(o.get("fulfillment_status") or "").lower() == "fulfilled" else "new"

            all_orders.append({
                "id": o.get("id"),
                "name": o.get("name"),
                "order_number": o.get("order_number"),
                "total_price": o.get("total_price"),
                "created_at": o.get("created_at"),
                "items_count": len(line_items),
                "units": order_units,
                "financial_status": o.get("financial_status"),
                "fulfillment_status": o.get("fulfillment_status"),
                "cancelled_at": o.get("cancelled_at"),
                "cancel_reason": o.get("cancel_reason"),
                "is_cancelled": is_cancelled,
                "customer_id": snapshot.get("customer_id"),
                "customer_name": snapshot.get("customer_name"),
                "customer_phone": snapshot.get("customer_phone", ""),
                "customer_phone_normalized": snapshot.get("customer_phone_normalized", ""),
                "customer_address1": snapshot.get("address1", ""),
                "customer_city": snapshot.get("city", ""),
                "customer_province": snapshot.get("province", ""),
                "customer_zip": snapshot.get("zip", ""),
                "customer_country": snapshot.get("country", ""),
                "tags": o.get("tags", ""),
                "line_items": items_detail,
                # DB-stored payment tracking
                "payment_status": payment_data.get("payment_status", "unpaid"),
                "amount_paid": payment_data.get("amount_paid", 0),
                "payment_note": payment_data.get("payment_note", ""),
                "order_status": workflow_status,
                "order_status_updated_at": status_data.get("updated_at"),
                "order_status_note": status_data.get("note", ""),
                "fulfillment_warning": "",
            })

        return {
            "data": {
                "total_orders": total_orders,
                "total_units_sold": total_units,
                "total_revenue": round(total_revenue, 2),
                "recent_orders": all_orders[:10],
                "all_orders": all_orders,
            }
        }
    except Exception as e:
        return {"error": str(e)}


@app.post("/api/wholesale/vendors/{vendor_id}/orders/{order_id}/cancel")
async def api_wholesale_cancel_order(vendor_id: str, order_id: str, req: WholesaleOrderCancelRequest):
    """Cancel a wholesale Shopify order and restock its inventory."""
    try:
        vendor_id_norm = (vendor_id or "").strip().lower()
        key = _wholesale_vendor_key(vendor_id_norm)
        vendor = db.get_app_setting(WHOLESALE_STORE, key)
        if not vendor:
            return {"error": "Vendor not found"}
        vendor_name = vendor.get("name", vendor_id_norm)

        from app.integrations.shopify_client import _rest_get_store, _rest_post_store

        order_numeric_id = str(order_id).split("/")[-1]
        order_data = await run_in_threadpool(_rest_get_store, WHOLESALE_STORE, f"/orders/{order_numeric_id}.json")
        order = (order_data or {}).get("order") or {}
        if not order or not _wholesale_order_matches_vendor(order, vendor_name, vendor_id_norm):
            return {"error": "order_not_found"}

        if order.get("cancelled_at"):
            return {"data": {"id": order.get("id"), "name": order.get("name"), "cancelled_at": order.get("cancelled_at"), "already_cancelled": True}}

        reason = (req.reason or "customer").strip() or "customer"
        if reason not in {"customer", "inventory", "fraud", "declined", "other"}:
            reason = "other"
        cancel_result = await run_in_threadpool(
            _rest_post_store,
            WHOLESALE_STORE,
            f"/orders/{order_numeric_id}/cancel.json",
            {"reason": reason, "restock": True},
        )
        cancelled_order = (cancel_result or {}).get("order") or {}

        payment_key = f"wholesale_order_payment:{vendor_id_norm}:{order_numeric_id}"
        payment_data = db.get_app_setting(WHOLESALE_STORE, payment_key)
        if isinstance(payment_data, dict):
            payment_data["payment_status"] = "cancelled"
            payment_data["updated_at"] = datetime.utcnow().isoformat() + "Z"
            db.set_app_setting(WHOLESALE_STORE, payment_key, payment_data)

        return {
            "data": {
                "id": cancelled_order.get("id") or order.get("id"),
                "name": cancelled_order.get("name") or order.get("name"),
                "cancelled_at": cancelled_order.get("cancelled_at"),
                "cancel_reason": cancelled_order.get("cancel_reason") or reason,
            }
        }
    except Exception as e:
        return {"error": str(e)}


def _wholesale_try_fulfill_order(order_numeric_id: str) -> tuple[bool, str | None]:
    """Best-effort Shopify fulfillment. Some stores may not grant fulfillment scopes."""
    try:
        from app.integrations.shopify_client import _rest_get_store, _rest_post_store

        fulfillment_orders_data = _rest_get_store(WHOLESALE_STORE, f"/orders/{order_numeric_id}/fulfillment_orders.json")
        fulfillment_orders = (fulfillment_orders_data or {}).get("fulfillment_orders") or []
        line_items_by_fulfillment_order: list[dict[str, Any]] = []
        for fo in fulfillment_orders:
            if str(fo.get("status") or "").lower() in {"closed", "cancelled"}:
                continue
            fo_id = fo.get("id")
            if fo_id:
                line_items_by_fulfillment_order.append({"fulfillment_order_id": int(fo_id)})
        if not line_items_by_fulfillment_order:
            return False, "no_open_fulfillment_orders"

        _rest_post_store(
            WHOLESALE_STORE,
            "/fulfillments.json",
            {
                "fulfillment": {
                    "line_items_by_fulfillment_order": line_items_by_fulfillment_order,
                    "notify_customer": False,
                }
            },
        )
        return True, None
    except Exception as exc:
        return False, str(exc)


@app.patch("/api/wholesale/vendors/{vendor_id}/orders/{order_id}/status")
async def api_wholesale_update_order_status(vendor_id: str, order_id: str, req: WholesaleOrderStatusUpdate):
    """Update the vendor-facing wholesale order workflow status."""
    try:
        vendor_id_norm = (vendor_id or "").strip().lower()
        key = _wholesale_vendor_key(vendor_id_norm)
        vendor = db.get_app_setting(WHOLESALE_STORE, key)
        if not vendor:
            return {"error": "Vendor not found"}
        vendor_name = vendor.get("name", vendor_id_norm)

        from app.integrations.shopify_client import _rest_get_store, _rest_put_store

        order_numeric_id = str(order_id).split("/")[-1]
        order_data = await run_in_threadpool(_rest_get_store, WHOLESALE_STORE, f"/orders/{order_numeric_id}.json")
        order = (order_data or {}).get("order") or {}
        if not order or not _wholesale_order_matches_vendor(order, vendor_name, vendor_id_norm):
            return {"error": "order_not_found"}
        if order.get("cancelled_at"):
            return {"error": "order_cancelled"}

        order_status = (req.order_status or "").strip().lower()
        if order_status not in {"new", "processing", "fulfilled"}:
            return {"error": "invalid_status"}

        fulfillment_warning: str | None = None
        fulfilled_on_shopify = False
        if order_status == "fulfilled" and str(order.get("fulfillment_status") or "").lower() != "fulfilled":
            fulfilled_on_shopify, fulfillment_warning = await run_in_threadpool(_wholesale_try_fulfill_order, order_numeric_id)

        now = datetime.utcnow().isoformat() + "Z"
        status_data = {
            "order_status": order_status,
            "note": (req.note or "").strip(),
            "updated_at": now,
            "fulfilled_on_shopify": fulfilled_on_shopify,
            "fulfillment_warning": "",
        }
        status_key = f"wholesale_order_status:{vendor_id_norm}:{order_numeric_id}"
        db.set_app_setting(WHOLESALE_STORE, status_key, status_data)

        try:
            current_tags = [str(t).strip() for t in str(order.get("tags") or "").split(",") if str(t).strip()]
            current_tags = [t for t in current_tags if not t.lower().startswith("vendor_status:")]
            current_tags.append(f"vendor_status:{order_status}")
            await run_in_threadpool(
                _rest_put_store,
                WHOLESALE_STORE,
                f"/orders/{order_numeric_id}.json",
                {"order": {"id": int(order_numeric_id), "tags": ", ".join(current_tags)}},
            )
        except Exception:
            pass

        return {"data": status_data}
    except Exception as e:
        return {"error": str(e)}


@app.get("/api/wholesale/vendors/{vendor_id}/customers")
async def api_wholesale_vendor_customers(vendor_id: str):
    try:
        orders_res = await api_wholesale_vendor_orders(vendor_id)
        if isinstance(orders_res, dict) and orders_res.get("error"):
            return orders_res
        all_orders = ((orders_res or {}).get("data") or {}).get("all_orders") or []

        customers_map: dict[str, dict] = {}
        for o in all_orders:
            if o.get("is_cancelled") or o.get("cancelled_at"):
                continue
            customer_name = (o.get("customer_name") or "N/A").strip() or "N/A"
            customer_phone = (o.get("customer_phone") or "").strip()
            customer_phone_normalized = (o.get("customer_phone_normalized") or "").strip()
            customer_key = customer_phone_normalized or f"{customer_name.lower()}|{customer_phone.lower()}"
            total_price = _wholesale_safe_float(o.get("total_price"), 0.0)
            amount_paid = max(0.0, _wholesale_safe_float(o.get("amount_paid"), 0.0))
            pending = max(0.0, total_price - amount_paid)

            rec = customers_map.get(customer_key)
            if not rec:
                rec = {
                    "key": customer_key,
                    "customer_name": customer_name,
                    "customer_phone": customer_phone,
                    "customer_phone_normalized": customer_phone_normalized,
                    "customer_address1": (o.get("customer_address1") or "").strip(),
                    "customer_city": (o.get("customer_city") or "").strip(),
                    "customer_province": (o.get("customer_province") or "").strip(),
                    "customer_zip": (o.get("customer_zip") or "").strip(),
                    "customer_country": (o.get("customer_country") or "").strip(),
                    "orders_count": 0,
                    "total_unpaid": 0.0,
                    "total_paid": 0.0,
                    "total_orders_value": 0.0,
                    "orders": [],
                }
                customers_map[customer_key] = rec

            rec["orders_count"] += 1
            rec["total_unpaid"] += pending
            rec["total_paid"] += amount_paid
            rec["total_orders_value"] += total_price
            rec["orders"].append({
                "id": o.get("id"),
                "name": o.get("name"),
                "created_at": o.get("created_at"),
                "total_price": round(total_price, 2),
                "amount_paid": round(amount_paid, 2),
                "pending_amount": round(pending, 2),
                "payment_status": o.get("payment_status", "unpaid"),
            })

        customers = list(customers_map.values())
        for c in customers:
            c["total_unpaid"] = round(c["total_unpaid"], 2)
            c["total_paid"] = round(c["total_paid"], 2)
            c["total_orders_value"] = round(c["total_orders_value"], 2)
            c["orders"].sort(key=lambda x: str(x.get("created_at") or ""), reverse=True)

        customers.sort(key=lambda c: (-float(c.get("total_unpaid") or 0), -int(c.get("orders_count") or 0)))
        total_unpaid = round(sum(float(c.get("total_unpaid") or 0) for c in customers), 2)
        return {"data": {"total_customers": len(customers), "total_unpaid": total_unpaid, "customers": customers}}
    except Exception as e:
        return {"error": str(e)}


# ─── Wholesale Order Payment Tracking ──────────────────────────────────
class WholesaleOrderPaymentUpdate(BaseModel):
    payment_status: str = "unpaid"  # "unpaid" | "partially_paid" | "paid"
    amount_paid: float = 0
    payment_note: str = ""

@app.patch("/api/wholesale/vendors/{vendor_id}/orders/{order_id}/payment")
async def api_wholesale_update_order_payment(vendor_id: str, order_id: str, req: WholesaleOrderPaymentUpdate):
    try:
        vendor_id_norm = (vendor_id or "").strip().lower()
        key = _wholesale_vendor_key(vendor_id_norm)
        vendor = db.get_app_setting(WHOLESALE_STORE, key)
        if not vendor:
            return {"error": "Vendor not found"}

        payment_key = f"wholesale_order_payment:{vendor_id_norm}:{order_id}"
        payment_data = {
            "payment_status": req.payment_status,
            "amount_paid": req.amount_paid,
            "payment_note": req.payment_note,
            "updated_at": datetime.utcnow().isoformat() + "Z",
        }
        db.set_app_setting(WHOLESALE_STORE, payment_key, payment_data)
        return {"data": payment_data}
    except Exception as e:
        return {"error": str(e)}

# ==================== Page Builder (AI Agent) ====================

from app.page_builder_agent import run_page_builder_agent, translate_page_template
from app.integrations.shopify_client import (
    search_products_for_picker,
    read_page_template_json,
    list_ai_pages as _list_ai_pages,
)


@app.get("/api/page-builder/products")
async def api_page_builder_products(query: str = "", store: str | None = None, limit: int = 250):
    """Search products for the page builder product picker."""
    import logging
    _log = logging.getLogger("page_builder.products")
    try:
        s = (store or "").strip()
        _log.info(f"Product search: query={query!r}, store={s!r}, limit={limit}")
        products = await run_in_threadpool(
            search_products_for_picker,
            query=query,
            limit=limit,
            store=s or None,
        )
        _log.info(f"Product search returned {len(products)} results")
        return {"data": products}
    except Exception as e:
        _log.error(f"Product search error: {e}", exc_info=True)
        return {"error": str(e), "data": []}


@app.get("/api/page-builder/pages")
async def api_page_builder_pages(store: str | None = None, limit: int = 50):
    """List AI-generated pages (template_suffix starting with 'ai-').

    Returns pages sorted by updated_at descending (most recently edited first).
    """
    try:
        s = (store or "").strip()
        pages = await run_in_threadpool(
            _list_ai_pages,
            store=s or None,
            limit=limit,
        )
        return {"data": pages}
    except Exception as e:
        return {"error": str(e), "data": []}


class PageBuilderGenerateRequest(BaseModel):
    prompt: str
    product_handle: str | None = None
    product_id: str | None = None
    product_title: str | None = None
    store: str | None = None
    model: str | None = None
    hide_header: bool = False
    hide_footer: bool = False
    # For continuing conversations
    messages: list | None = None
    slug: str | None = None  # For edits to existing pages


@app.post("/api/page-builder/generate")
async def api_page_builder_generate(req: PageBuilderGenerateRequest):
    """Generate a new page or edit an existing one via the AI agent."""
    import asyncio
    try:
        store = (req.store or "").strip() or None

        # Build user message with context
        user_content_parts = [req.prompt]
        if req.product_handle:
            user_content_parts.append(f"\n\nProduct handle: {req.product_handle}")
        if req.product_title:
            user_content_parts.append(f"Product title: {req.product_title}")
        if req.product_id:
            user_content_parts.append(f"Product GID: gid://shopify/Product/{req.product_id}")
        if req.hide_header or req.hide_footer:
            user_content_parts.append("\nHide header and footer (use layout: 'none').")

        user_msg = {"role": "user", "content": "\n".join(user_content_parts)}

        # If editing an existing page, include current template
        if req.slug:
            current_tmpl = await run_in_threadpool(
                read_page_template_json, req.slug, store=store
            )
            if current_tmpl:
                import json as _j
                tmpl_ctx = {
                    "role": "system",
                    "content": f"CURRENT TEMPLATE (slug: {req.slug}):\n```json\n{_j.dumps(current_tmpl, indent=2)}\n```\nModify this template based on the user's request. Use update_shopify_page tool.",
                }
                messages = (req.messages or []) + [tmpl_ctx, user_msg]
            else:
                messages = (req.messages or []) + [user_msg]
        else:
            messages = (req.messages or []) + [user_msg]

        # Run with a 120s timeout — v2 has two OpenAI calls (section selection + content generation)
        result = await asyncio.wait_for(
            run_in_threadpool(
                run_page_builder_agent,
                messages,
                model=req.model,
                store=store,
                user_prompt=req.prompt,
            ),
            timeout=120,
        )

        return {
            "text": result.get("text", ""),
            "page_url": result.get("page_url"),
            "slug": result.get("slug"),
            "template_suffix": result.get("template_suffix"),
            "messages": result.get("messages", []),
            "error": result.get("error"),
        }
    except asyncio.TimeoutError:
        return {"error": "Page generation timed out. Please try again with a simpler prompt."}
    except Exception as e:
        return {"error": str(e)}


class PageBuilderLayoutRequest(BaseModel):
    slug: str
    show_header: bool = True
    show_footer: bool = True
    store: str | None = None


@app.post("/api/page-builder/toggle-layout")
async def api_page_builder_toggle_layout(req: PageBuilderLayoutRequest):
    """Toggle header/footer visibility for an existing page template."""
    try:
        from app.integrations.shopify_client import update_page_template_json as _update_tmpl

        store = (req.store or "").strip() or None
        current = await run_in_threadpool(
            read_page_template_json, req.slug, store=store
        )
        if not current:
            return {"error": f"Template not found: {req.slug}"}

        sections = current.get("sections", {})
        order = current.get("order", [])
        # If both hidden, use layout "none"; otherwise default
        layout = None if (req.show_header and req.show_footer) else "none"

        result = await run_in_threadpool(
            _update_tmpl,
            req.slug, sections, order,
            layout=layout,
            store=store,
        )
        return {"data": result, "layout": layout or "default"}
    except Exception as e:
        return {"error": str(e)}


@app.get("/api/page-builder/status/{slug}")
async def api_page_builder_status(slug: str, store: str | None = None):
    """Get the current template JSON for a page."""
    try:
        s = (store or "").strip() or None
        tmpl = await run_in_threadpool(
            read_page_template_json, slug, store=s
        )
        if not tmpl:
            return {"error": "not_found"}
        return {"data": tmpl, "slug": slug}
    except Exception as e:
        return {"error": str(e)}


@app.get("/api/page-builder/preview-proxy")
async def api_page_builder_preview_proxy(url: str):
    """Proxy a Shopify page to strip X-Frame-Options / CSP so it can be previewed in an iframe."""
    import requests as _req, re as _re
    if not url or not url.startswith("http"):
        return Response(content="Invalid URL", status_code=400)

    def _fetch():
        return _req.get(url, timeout=15, allow_redirects=True)

    try:
        resp = await run_in_threadpool(_fetch)
        html = resp.text
        # Inject <base> tag so relative links/images resolve to the Shopify domain
        from urllib.parse import urlparse
        parsed = urlparse(url)
        base_url = f"{parsed.scheme}://{parsed.netloc}"
        html = _re.sub(
            r"(<head[^>]*>)",
            rf'\1<base href="{base_url}/" />',
            html,
            count=1,
            flags=_re.IGNORECASE,
        )
        # Strip any CSP meta tags in the HTML itself
        html = _re.sub(
            r'<meta[^>]*http-equiv=["\']Content-Security-Policy["\'][^>]*>',
            '',
            html,
            flags=_re.IGNORECASE,
        )
        # Return with permissive headers (no X-Frame-Options, no restrictive CSP)
        return Response(
            content=html,
            media_type="text/html",
            headers={
                "X-Frame-Options": "ALLOWALL",
                "Content-Security-Policy": "",
            },
        )
    except Exception as e:
        return Response(content=f"Proxy error: {e}", status_code=502)


# ---- Removed widget JS serving ----

@app.get("/api/page-builder/widget.js")
async def api_page_builder_widget_js():
    """Return an inert response for stale Shopify themes that still request the old widget."""
    return Response(
        "",
        media_type="application/javascript",
        headers={
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "no-store",
            "X-Robots-Tag": "noindex, nofollow",
        },
    )


# ---- Theme snippet install/uninstall ----

WIDGET_SNIPPET_KEY = "snippets/ai-page-builder-widget.liquid"
WIDGET_LAYOUT_MARKER = "<!-- AI_PAGE_BUILDER_WIDGET -->"


def _strip_page_builder_widget_markup(content: str) -> tuple[str, bool]:
    """Remove every known widget injection shape from a Shopify layout."""
    updated = content or ""
    original = updated
    marker = re.escape(WIDGET_LAYOUT_MARKER)
    updated = re.sub(marker + r".*?" + marker, "", updated, flags=re.DOTALL)
    updated = re.sub(r"\n?\s*" + marker + r"\s*\n?", "\n", updated)
    updated = re.sub(
        r"\{%\s*(?:render|include)\s+['\"]ai-page-builder-widget['\"]\s*%\}",
        "",
        updated,
        flags=re.IGNORECASE,
    )
    updated = re.sub(
        r"<script\b(?=[^>]*\bsrc\s*=\s*['\"][^'\"]*/api/page-builder/widget\.js(?:\?[^'\"]*)?['\"])[\s\S]*?</script\s*>",
        "",
        updated,
        flags=re.IGNORECASE,
    )
    updated = re.sub(r"\n{3,}", "\n\n", updated)
    return updated, updated != original




class WidgetInstallRequest(BaseModel):
    store: str | None = None


@app.post("/api/page-builder/widget/install")
async def api_page_builder_widget_install(req: WidgetInstallRequest):
    """The theme editor widget is disabled; remove stale installs instead."""
    result = await api_page_builder_widget_uninstall(req)
    if result.get("error"):
        return result
    data = result.get("data") or {}
    data.update({"installed": False, "disabled": True})
    return {"data": data}


@app.post("/api/page-builder/widget/uninstall")
async def api_page_builder_widget_uninstall(req: WidgetInstallRequest):
    """Remove the AI page builder widget from the active theme."""
    try:
        from app.integrations.shopify_client import (
            get_active_theme_gid,
            _gql_store,
        )
        store = (req.store or "").strip() or None
        theme_gid = await run_in_threadpool(get_active_theme_gid, store=store)

        DELETE = """
mutation ThemeFilesDelete($themeId: ID!, $files: [String!]!) {
  themeFilesDelete(themeId: $themeId, files: $files) {
    deletedThemeFiles { filename }
    userErrors { field message }
  }
}
"""
        READ = """
query ThemeFiles($themeId: ID!, $filenames: [String!]!) {
  theme(id: $themeId) {
    files(filenames: $filenames, first: 5) {
      nodes {
        filename
        body { ... on OnlineStoreThemeFileBodyText { content } }
      }
    }
  }
}
"""
        UPSERT = """
mutation ThemeFilesUpsert($themeId: ID!, $files: [OnlineStoreThemeFilesUpsertFileInput!]!) {
  themeFilesUpsert(themeId: $themeId, files: $files) {
    upsertedThemeFiles { filename }
    userErrors { field message }
  }
}
"""
        # Delete snippet file
        await run_in_threadpool(
            _gql_store, store, DELETE,
            {"themeId": theme_gid, "files": [WIDGET_SNIPPET_KEY]},
        )

        # Remove render tag from layout/theme.liquid
        layout_file = "layout/theme.liquid"
        layout_data = await run_in_threadpool(
            _gql_store, store, READ,
            {"themeId": theme_gid, "filenames": [layout_file]},
        )
        layout_nodes = ((layout_data or {}).get("theme") or {}).get("files", {}).get("nodes") or []
        layout_content = ""
        for n in layout_nodes:
            if n.get("filename") == layout_file:
                layout_content = (n.get("body") or {}).get("content") or ""
                break

        layout_content, changed = _strip_page_builder_widget_markup(layout_content)
        if changed:
            await run_in_threadpool(
                _gql_store, store, UPSERT,
                {
                    "themeId": theme_gid,
                    "files": [{
                        "filename": layout_file,
                        "body": {"type": "TEXT", "value": layout_content},
                    }],
                },
            )

        return {"data": {"uninstalled": True, "layout_updated": changed, "snippet": WIDGET_SNIPPET_KEY}}
    except Exception as e:
        return {"error": str(e)}

# ─────────────── Marketing Hub Endpoints ───────────────

class MarketingStrategistRequest(BaseModel):
    page_url: str | None = None
    product_info: dict | None = None
    store: str | None = None
    model: str | None = None


@app.post("/api/page-builder/marketing/strategist")
async def api_marketing_strategist(req: MarketingStrategistRequest):
    """Strategist agent: analyze product/page and return 3 marketing angles."""
    try:
        result = await run_in_threadpool(
            marketing_strategist,
            page_url=req.page_url,
            product_info=req.product_info,
            model=req.model,
        )
        return {"data": result}
    except Exception as e:
        return {"error": str(e), "data": {"angles": []}}


class MarketingCopywriterRequest(BaseModel):
    angle: dict
    product_info: dict | None = None
    page_url: str | None = None
    store: str | None = None
    model: str | None = None


@app.post("/api/page-builder/marketing/copywriter")
async def api_marketing_copywriter(req: MarketingCopywriterRequest):
    """Copywriter agent: generate headlines, sub-headlines, and ad copy from a selected angle."""
    try:
        result = await run_in_threadpool(
            marketing_copywriter,
            angle=req.angle,
            product_info=req.product_info,
            page_url=req.page_url,
            model=req.model,
        )
        return {"data": result}
    except Exception as e:
        return {"error": str(e), "data": {}}


class MarketingMediaBuyerRequest(BaseModel):
    angle: dict
    copy: dict
    product_info: dict | None = None
    store: str | None = None
    model: str | None = None


@app.post("/api/page-builder/marketing/media-buyer")
async def api_marketing_media_buyer(req: MarketingMediaBuyerRequest):
    """Media buyer agent: generate image prompts, video concepts, and format recommendations."""
    try:
        result = await run_in_threadpool(
            marketing_media_buyer,
            angle=req.angle,
            copy=req.copy,
            product_info=req.product_info,
            model=req.model,
        )
        return {"data": result}
    except Exception as e:
        return {"error": str(e), "data": {}}


# Mount static files last so that API routes have precedence.
# The directory is configurable via STATIC_DIR env var, otherwise we look for
#   - /app/static (inside container)
#   - <project-root>/frontend/out (local dev after `next export`)

STATIC_DIR = os.getenv("STATIC_DIR", "/app/static")
# fallback for local dev
if STATIC_DIR == "/app/static":
    alt = Path(__file__).resolve().parents[2] / "frontend" / "out"
    if alt.exists():
        STATIC_DIR = str(alt)

if Path(STATIC_DIR).exists():
    @app.middleware("http")
    async def _redirect_trailing_slash(request: Request, call_next):
        """Redirect /foo -> /foo/ when a static directory exists (Next export uses trailingSlash)."""
        try:
            path = request.url.path or "/"
            # Only for frontend routes (never touch API/uploads/assets)
            if path.startswith("/api") or path.startswith("/uploads") or path.startswith("/_next"):
                return await call_next(request)
            # already ok
            if path == "/" or path.endswith("/"):
                return await call_next(request)
            # If last segment looks like a file (has an extension), don't redirect
            last = path.rsplit("/", 1)[-1]
            if "." in last:
                return await call_next(request)
            # If a directory exists in the static export, redirect to /dir/
            rel = path.lstrip("/")
            cand = Path(STATIC_DIR) / rel / "index.html"
            if cand.exists():
                qs = request.url.query
                url = path + "/"
                if qs:
                    url = url + "?" + qs
                return RedirectResponse(url=url, status_code=307)
        except Exception:
            pass
        return await call_next(request)

    app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
else:
    # Skip mounting when directory not found (e.g., during backend-only local dev)
    print(f"[WARN] Static directory '{STATIC_DIR}' not found. Frontend assets will not be served.")
