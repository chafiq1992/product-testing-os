from fastapi import FastAPI, UploadFile, Form, File, Request
from fastapi.responses import StreamingResponse, Response
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.responses import RedirectResponse
from pydantic import BaseModel
from typing import List, Optional
from uuid import uuid4
import json, os
import base64, hmac, hashlib
from pathlib import Path
from urllib.parse import quote, urlencode

from app.tasks import pipeline_launch, run_pipeline_sync
from app.integrations.openai_client import gen_angles_and_copy, gen_angles_and_copy_full, gen_title_and_description, gen_landing_copy, gen_product_from_image, analyze_landing_page, translate_texts
from app.agent import run_agent_until_final, run_ads_agent
from app.integrations.gemini_client import gen_ad_images_from_image, gen_promotional_images_from_angles, gen_variant_images_from_image, gen_feature_benefit_images
from app.integrations.gemini_client import analyze_variants_from_image, build_feature_benefit_prompts, _compute_midpoint_size_from_product
from app.integrations.shopify_client import create_product_and_page, upload_images_to_product, create_product_only, create_page_from_copy, list_product_images, upload_images_to_product_verbose, upload_image_attachments_to_product, _link_product_landing_page
from app.integrations.shopify_client import configure_variants_for_product
from app.integrations.shopify_client import count_orders_by_title
from app.integrations.shopify_client import get_products_brief
from app.integrations.shopify_client import count_orders_by_product_processed
from app.integrations.shopify_client import count_orders_by_product_or_variant_processed, count_orders_by_product_or_variant_processed_batch
from app.integrations.shopify_client import list_product_ids_in_collection
from app.integrations.shopify_client import count_orders_by_collection_processed
from app.integrations.shopify_client import count_items_by_collection_processed
from app.integrations.shopify_client import sum_product_order_counts_for_collection
from app.integrations.shopify_client import sum_product_order_counts_for_collection_created
from app.integrations.shopify_client import update_product_description
from app.integrations.shopify_client import update_product_title
from app.integrations.shopify_client import _build_page_body_html
from app.integrations.shopify_client import count_orders_total_processed, count_orders_total_created
from app.integrations.shopify_client import list_orders_with_utms_processed
from app.integrations.shopify_client import list_orders_open_unfulfilled, cycle_tag, set_cod_tag, has_cod_tag
from app.integrations.meta_client import create_campaign_with_ads
from app.integrations.meta_client import list_saved_audiences
from app.integrations.meta_client import list_active_campaigns_with_insights
from app.integrations.meta_client import get_ad_account_info, set_campaign_status, list_adsets_with_insights, set_adset_status, campaign_daily_insights, list_ad_accounts
from app.integrations.meta_client import list_ads_for_adsets
from app.integrations.meta_client import create_draft_image_campaign
from app.integrations.meta_client import create_draft_carousel_campaign
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

    Prefer BASE_URL if configured for non-local deployments; else infer from headers.
    """
    try:
        host = (request.headers.get("x-forwarded-host") or request.headers.get("host") or "").strip()
        scheme = (request.headers.get("x-forwarded-proto") or request.url.scheme or "https").strip()
        req_base = f"{scheme}://{host}" if host else str(request.base_url).rstrip("/")
        if BASE_URL and ("localhost" not in BASE_URL and "127.0.0.1" not in BASE_URL):
            return BASE_URL.rstrip("/")
        return req_base.rstrip("/")
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
async def api_shopify_oauth_status(store: str | None = None):
    """Return whether we have a stored OAuth token for this store label."""
    try:
        rec = db.get_app_setting(store, "shopify_oauth") or {}
        if not isinstance(rec, dict):
            rec = {}
        tok = str(rec.get("access_token") or "").strip()
        shop = str(rec.get("shop") or "").strip()
        return {"data": {"connected": bool(tok and shop), "shop": (shop or None), "scopes": rec.get("scopes")}}
    except Exception as e:
        return {"error": str(e), "data": {"connected": False}}


@app.get("/api/shopify/oauth/start")
async def api_shopify_oauth_start(request: Request, store: str, shop: str):
    """Redirect to Shopify OAuth install screen for the given shop.

    Usage:
      /api/shopify/oauth/start?store=irranova&shop=your-shop.myshopify.com
    """
    try:
        if not (SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET):
            return {"error": "missing_shopify_client_credentials"}
        store_label = (store or "").strip()
        if not store_label:
            return {"error": "missing_store"}
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

        redirect_uri = f"{_abs_base_url(request)}/api/shopify/oauth/callback"
        scopes = _shopify_oauth_scopes()
        params = {
            "client_id": SHOPIFY_CLIENT_ID,
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
        if not (SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET):
            return {"error": "missing_shopify_client_credentials"}
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
        if not _is_valid_shop_domain(shop):
            return {"error": "invalid_shop_domain"}
        if not (state and code):
            return {"error": "missing_state_or_code"}
        # Optional: ensure the same shop
        if st.get("shop") and str(st.get("shop")).strip().lower() != shop:
            return {"error": "shop_mismatch"}

        # Verify Shopify HMAC (recommended). If this fails in your environment, you can temporarily bypass
        # it for internal installs by setting SHOPIFY_OAUTH_SKIP_HMAC=1.
        hmac_ok = _verify_shopify_hmac_request(request, SHOPIFY_CLIENT_SECRET)
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
            "client_id": SHOPIFY_CLIENT_ID,
            "client_secret": SHOPIFY_CLIENT_SECRET,
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
async def get_meta_campaigns(date_preset: str | None = None, ad_account: str | None = None, store: str | None = None, start: str | None = None, end: str | None = None):
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
        items = list_active_campaigns_with_insights(date_preset or "last_7d", ad_account_id=(acct or None), since=start, until=end)
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
    try:
        start = req.start
        end = req.end
        store = req.store
        include_closed = bool(req.include_closed) if req.include_closed is not None else False
        names = [str(x or "").strip() for x in (req.names or []) if str(x or "").strip()]
        # Guardrails: keep requests bounded even if UI sends a lot
        if len(names) > 400:
            names = names[:400]
        out: dict[str, int] = {n: 0 for n in names}

        df = (req.date_field or "processed").lower()
        numeric = [n for n in names if n.isdigit()]
        non_numeric = [n for n in names if not n.isdigit()]

        # Prefer processed_at window for numeric product/variant IDs to match Shopify Admin.
        # Use a batched single-pass scan for speed.
        if numeric:
            s_date = (start or "").split("T")[0] if isinstance(start, str) and "-" in start else (start or "")
            e_date = (end or "").split("T")[0] if isinstance(end, str) and "-" in end else (end or "")
            try:
                if df == "created":
                    # created_at path: still per-id, but created_at ranges are typically smaller and this is less used
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
                # fallback to slow per-id (best-effort)
                for n in numeric:
                    try:
                        out[n] = count_orders_by_product_or_variant_processed(n, s_date, e_date, store=store, include_closed=include_closed)
                    except Exception:
                        out[n] = 0

        # Non-numeric names are intentionally ignored by count_orders_by_title() (returns 0),
        # but keep behavior consistent.
        for n in non_numeric:
            try:
                out[n] = count_orders_by_title(n, start, end, store=store, include_closed=include_closed)
            except Exception:
                out[n] = 0
        return {"data": out}
    except Exception as e:
        return {"error": str(e), "data": {}}


class ProductsBriefRequest(BaseModel):
    ids: list[str]
    store: Optional[str] = None


@app.post("/api/shopify/products_brief")
async def api_products_brief(req: ProductsBriefRequest):
    try:
        data = get_products_brief(req.ids or [], store=req.store)
        return {"data": data}
    except Exception as e:
        return {"error": str(e), "data": {}}


class OrdersTotalCountRequest(BaseModel):
    start: Optional[str] = None  # YYYY-MM-DD
    end: Optional[str] = None    # YYYY-MM-DD
    store: Optional[str] = None
    include_closed: Optional[bool] = None
    date_field: Optional[str] = None  # 'processed' | 'created'


@app.post("/api/shopify/orders_count_total")
async def api_orders_count_total(req: OrdersTotalCountRequest):
    try:
        s_date = (req.start or "").split("T")[0] if isinstance(req.start, str) and "-" in (req.start or "") else (req.start or "")
        e_date = (req.end or "").split("T")[0] if isinstance(req.end, str) and "-" in (req.end or "") else (req.end or "")
        include_closed = bool(req.include_closed) if req.include_closed is not None else False
        df = (req.date_field or "processed").lower()
        if df == "created":
            cnt = count_orders_total_created(s_date, e_date, store=req.store, include_closed=include_closed)
        else:
            cnt = count_orders_total_processed(s_date, e_date, store=req.store, include_closed=include_closed)
        return {"data": {"count": int(cnt)}}
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
        ids = list_product_ids_in_collection(cid, store=req.store)
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
        if agg == "items":
            cnt = count_items_by_collection_processed(cid, s_date, e_date, store=req.store, include_closed=include_closed)
        elif agg == "sum_product_orders":
            df = (req.date_field or "processed").lower()
            if df == "created":
                cnt = sum_product_order_counts_for_collection_created(cid, s_date, e_date, store=req.store, include_closed=include_closed)
            else:
                cnt = sum_product_order_counts_for_collection(cid, s_date, e_date, store=req.store, include_closed=include_closed)
        else:
            cnt = count_orders_by_collection_processed(cid, s_date, e_date, store=req.store, include_closed=include_closed)
        return {"data": {"count": cnt}}
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
        res = set_campaign_status(campaign_id, status)
        return {"data": res}
    except Exception as e:
        return {"error": str(e)}


@app.get("/api/meta/campaigns/{campaign_id}/adsets")
async def api_get_campaign_adsets(campaign_id: str, date_preset: str | None = None, start: str | None = None, end: str | None = None):
    try:
        items = list_adsets_with_insights(campaign_id, date_preset or "last_7d", since=start, until=end)
        return {"data": items}
    except Exception as e:
        return {"error": str(e), "data": []}


@app.get("/api/meta/campaigns/{campaign_id}/adsets/orders")
async def api_campaign_adset_orders(campaign_id: str, start: str, end: str, store: str | None = None):
    """Attribute Shopify orders to ad sets by matching UTM ad_id to Meta ad IDs under each ad set.

    Returns mapping: { adset_id: { count: number, orders: [...] } }
    """
    try:
        # 1) List ad sets for campaign and their ads
        adsets = list_adsets_with_insights(campaign_id, "last_7d")
        adset_ids = [str((a or {}).get("adset_id") or "") for a in (adsets or []) if (a or {}).get("adset_id")]
        ads_by_adset = list_ads_for_adsets(adset_ids)

        # Build reverse map ad_id -> adset_id
        ad_to_adset: dict[str, str] = {}
        for aid, ad_ids in (ads_by_adset or {}).items():
            for ad in (ad_ids or []):
                if ad:
                    ad_to_adset[str(ad)] = str(aid)

        # 2) Fetch Shopify orders with UTMs for date range (processed dates)
        orders = list_orders_with_utms_processed(start, end, store=store, include_closed=True)

        # 3) Attribute orders by ad_id
        result: dict[str, dict] = {}
        for o in (orders or []):
            try:
                ad_id = str((o or {}).get("ad_id") or "")
                if not ad_id:
                    continue
                adset_id = ad_to_adset.get(ad_id)
                if not adset_id:
                    continue
                bucket = result.setdefault(adset_id, {"count": 0, "orders": []})
                bucket["count"] = int(bucket.get("count", 0)) + 1
                # Append a slimmed order row for UI
                bucket["orders"].append({
                    "order_id": o.get("order_id"),
                    "processed_at": o.get("processed_at"),
                    "total_price": o.get("total_price"),
                    "currency": o.get("currency"),
                    "landing_site": o.get("landing_site"),
                    "utm": o.get("utm") or {},
                    "ad_id": ad_id,
                    "campaign_id": o.get("campaign_id"),
                })
            except Exception:
                continue
        return {"data": result}
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
        res = set_adset_status(adset_id, status)
        return {"data": res}
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
