from fastapi import FastAPI, UploadFile, Form, File, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import List, Optional
from uuid import uuid4
import json, os
from pathlib import Path
from urllib.parse import quote

from app.tasks import pipeline_launch, run_pipeline_sync
from app.integrations.openai_client import gen_angles_and_copy, gen_title_and_description, gen_landing_copy
from app.integrations.shopify_client import create_product_and_page, upload_images_to_product
from app.integrations.meta_client import create_campaign_with_ads
from app.integrations.meta_client import list_saved_audiences
from app.storage import save_file
from app.config import BASE_URL
from app import db

app = FastAPI(title="Product Testing OS", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Determine uploads directory – default /app/uploads (inside container) but for local dev use project_root/uploads.
UPLOADS_DIR = os.getenv("UPLOADS_DIR") or str(Path(__file__).resolve().parents[1] / "uploads")
# ensure uploads dir exists
Path(UPLOADS_DIR).mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=UPLOADS_DIR), name="uploads")

class ProductInput(BaseModel):
    title: Optional[str] = None
    base_price: Optional[float] = None
    currency: str = "MAD"
    audience: str
    benefits: List[str]
    pain_points: List[str]
    niche: Optional[str] = None
    targeting: Optional[dict] = None
    advantage_plus: Optional[bool] = True
    adset_budget: Optional[float] = None

@app.post("/api/tests")
async def create_test(
    request: Request,
    audience: str = Form(...),
    benefits: str = Form(...),
    pain_points: str = Form(...),
    base_price: Optional[float] = Form(None),
    title: Optional[str] = Form(None),
    images: List[UploadFile] = File([]),
    targeting: Optional[str] = Form(None),
    advantage_plus: Optional[bool] = Form(True),
    adset_budget: Optional[float] = Form(9.0),
    model: Optional[str] = Form(None),
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
    if model:
        payload["model"] = model
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
async def get_test(test_id: str):
    t = db.get_test(test_id)
    if not t:
        return {"error": "not_found"}
    return t


@app.get("/api/meta/audiences")
async def get_saved_audiences():
    try:
        items = list_saved_audiences()
        return {"data": items}
    except Exception as e:
        return {"error": str(e), "data": []}


# ---------------- LLM step endpoints (interactive flow) ----------------
class AnglesRequest(BaseModel):
    product: ProductInput
    num_angles: Optional[int] = 2
    model: Optional[str] = None

@app.post("/api/llm/angles")
async def api_llm_angles(req: AnglesRequest):
    angles = gen_angles_and_copy(req.product.model_dump(), model=req.model)
    k = max(1, min(5, req.num_angles or 2))
    return {"angles": angles[:k]}


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

@app.post("/api/llm/landing_copy")
async def api_llm_landing_copy(req: LandingCopyRequest):
    payload = req.product.model_dump()
    # include title/description in payload if provided to inform landing copy
    if req.title:
        payload["title"] = req.title
    if req.description:
        payload["description"] = req.description
    angles = [req.angle] if req.angle else []
    data = gen_landing_copy(payload, angles, model=req.model)
    return data


class ShopifyCreateRequest(BaseModel):
    product: ProductInput
    angle: Optional[dict] = None
    title: str
    description: str
    landing_copy: dict
    image_urls: Optional[List[str]] = None

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
    page = create_product_and_page(payload, angles, creatives, req.landing_copy)
    # persist minimal row for convenience
    test_id = str(uuid4())
    db.create_test_row(test_id, payload)
    db.set_test_result(test_id, page, None, creatives, angles=angles, trace=[{"step":"shopify","response":{"page":page}}])
    return {"page_url": page.get("url") if isinstance(page, dict) else None, "test_id": test_id}


# Dedicated endpoint to upload images to a Shopify product and return Shopify CDN URLs
class ShopifyUploadImagesRequest(BaseModel):
    product_gid: str
    image_urls: List[str]
    title: Optional[str] = None
    description: Optional[str] = None
    landing_copy: Optional[dict] = None


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
    urls = upload_images_to_product(req.product_gid, req.image_urls or [], alt_texts)
    return {"urls": urls}


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


class MetaLaunchRequest(BaseModel):
    product: ProductInput
    page_url: str
    creatives: Optional[list] = None

@app.post("/api/meta/launch_from_page")
async def api_meta_launch_from_page(req: MetaLaunchRequest):
    # For now delegate to existing helper
    try:
        campaign = create_campaign_with_ads({"page_url": req.page_url, **req.product.model_dump()}, req.creatives or [])
        return {"campaign_id": campaign.get("id") if isinstance(campaign, dict) else None}
    except Exception as e:
        return {"error": str(e)}

@app.get("/health")
async def health():
    return {"ok": True}

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
