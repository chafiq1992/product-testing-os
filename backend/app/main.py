from fastapi import FastAPI, UploadFile, Form, File, Request
from fastapi.responses import StreamingResponse, Response
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import List, Optional
from uuid import uuid4
import json, os
from pathlib import Path
from urllib.parse import quote

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
from app.integrations.shopify_client import count_orders_by_product_or_variant_processed
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
from app.integrations.meta_client import create_campaign_with_ads
from app.integrations.meta_client import list_saved_audiences
from app.integrations.meta_client import list_active_campaigns_with_insights
from app.integrations.meta_client import get_ad_account_info, set_campaign_status, list_adsets_with_insights, set_adset_status, campaign_daily_insights, list_ad_accounts
from app.integrations.meta_client import list_ads_for_adsets
from app.integrations.meta_client import create_draft_image_campaign
from app.integrations.meta_client import create_draft_carousel_campaign
from app.storage import save_file
from app.config import BASE_URL, UPLOADS_DIR, CHATKIT_WORKFLOW_ID
from app import db
import re
import threading
import time
import json as _json
import io
import mimetypes
from urllib.parse import urlparse
import logging

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
        out: dict[str, int] = {}
        for name in (req.names or []):
            try:
                # Prefer processed_at window for numeric product IDs to match Shopify Admin, regardless of input format
                if str(name or "").isdigit():
                    s_date = (start or "").split("T")[0] if isinstance(start, str) and "-" in start else (start or "")
                    e_date = (end or "").split("T")[0] if isinstance(end, str) and "-" in end else (end or "")
                    df = (req.date_field or "processed").lower()
                    if df == "created":
                        out[name] = count_orders_by_title(str(name) or "", start, end, store=store, include_closed=include_closed)
                    else:
                        # Use product_or_variant to catch variant IDs too
                        out[name] = count_orders_by_product_or_variant_processed(str(name), s_date, e_date, store=store, include_closed=include_closed)
                else:
                    out[name] = count_orders_by_title(name or "", start, end, store=store, include_closed=include_closed)
            except Exception:
                out[name] = 0
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
    app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
else:
    # Skip mounting when directory not found (e.g., during backend-only local dev)
    print(f"[WARN] Static directory '{STATIC_DIR}' not found. Frontend assets will not be served.")
