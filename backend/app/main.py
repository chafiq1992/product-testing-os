from fastapi import FastAPI, UploadFile, Form, File, Request
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
from app.integrations.openai_client import gen_angles_and_copy, gen_title_and_description, gen_landing_copy, gen_product_from_image
from app.integrations.gemini_client import gen_ad_images_from_image, gen_promotional_images_from_angles, gen_variant_images_from_image, gen_feature_benefit_images
from app.integrations.gemini_client import analyze_variants_from_image, build_feature_benefit_prompts, _compute_midpoint_size_from_product
from app.integrations.shopify_client import create_product_and_page, upload_images_to_product, create_product_only, create_page_from_copy, list_product_images, upload_images_to_product_verbose, upload_image_attachments_to_product
from app.integrations.shopify_client import configure_variants_for_product
from app.integrations.shopify_client import update_product_description
from app.integrations.shopify_client import _build_page_body_html
from app.integrations.meta_client import create_campaign_with_ads
from app.integrations.meta_client import list_saved_audiences
from app.integrations.meta_client import create_draft_image_campaign
from app.storage import save_file
from app.config import BASE_URL, UPLOADS_DIR
from app import db
import re

app = FastAPI(title="Product Testing OS", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(GZipMiddleware, minimum_size=1024)

# Mount static uploads directory. Use the unified path from config.
Path(UPLOADS_DIR).mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=UPLOADS_DIR), name="uploads")

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


# ---------------- LLM step endpoints (interactive flow) ----------------
class AnglesRequest(BaseModel):
    product: ProductInput
    num_angles: Optional[int] = 2
    model: Optional[str] = None
    prompt: Optional[str] = None

@app.post("/api/llm/angles")
async def api_llm_angles(req: AnglesRequest):
    angles = gen_angles_and_copy(req.product.model_dump(), model=req.model, prompt_override=req.prompt)
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


@app.post("/api/llm/product_from_image")
async def api_llm_product_from_image(req: ProductFromImageRequest):
    try:
        data = gen_product_from_image(req.image_url, model=req.model)
        return {"product": data, "input_image_url": req.image_url}
    except Exception as e:
        return {"product": None, "error": str(e), "input_image_url": req.image_url}
# ---------------- Flows/Drafts ----------------
class DraftSaveRequest(BaseModel):
    product: ProductInput
    image_urls: Optional[List[str]] = None
    flow: Optional[dict] = None  # { nodes:[], edges:[] }
    ui: Optional[dict] = None    # { pan, zoom, selected }
    prompts: Optional[dict] = None  # { angles_prompt, title_desc_prompt, landing_copy_prompt }
    settings: Optional[dict] = None  # { model, advantage_plus, adset_budget, targeting, countries, saved_audience_id }


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
    db.create_test_row(test_id, payload, status="draft")
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
    ok = db.update_test_payload(test_id, payload)
    if not ok:
        # If the draft doesn't exist yet (e.g., deep-link open), create it on first save
        db.create_test_row(test_id, payload, status="draft")
    return {"id": test_id, "status": "draft"}


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


# Create product immediately after title/description approval
class ShopifyProductCreateRequest(BaseModel):
    product: ProductInput
    angle: Optional[dict] = None
    title: str
    description: Optional[str] = None


@app.post("/api/shopify/product_create_from_title_desc")
async def api_shopify_product_create_from_title_desc(req: ShopifyProductCreateRequest):
    payload = req.product.model_dump()
    if req.description:
        payload["description"] = req.description
    # Create product with variants/options/pricing when provided. Description is set later via update.
    product = create_product_only(
        req.title,
        description_html=None,
        status="ACTIVE",
        price=payload.get("base_price"),
        sizes=payload.get("sizes") or None,
        colors=payload.get("colors") or None,
        product_type=payload.get("product_type") or None,
    )
    return {"product_gid": product.get("id"), "handle": product.get("handle")}


class ShopifyUpdateDescriptionRequest(BaseModel):
    product_gid: str
    description_html: str


@app.post("/api/shopify/update_description")
async def api_shopify_update_description(req: ShopifyUpdateDescriptionRequest):
    prod = update_product_description(req.product_gid, req.description_html)
    return {"product_gid": prod.get("id"), "handle": prod.get("handle")}


class ShopifyCreatePageFromCopyRequest(BaseModel):
    title: str
    landing_copy: dict
    image_urls: Optional[List[str]] = None
    product_gid: Optional[str] = None


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
    page = create_page_from_copy(req.title, req.landing_copy, req.image_urls or [], alt_texts)
    # Optionally update product description to match landing body
    try:
        if req.product_gid:
            update_product_description(req.product_gid, body_html)
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
    verbose = upload_images_to_product_verbose(req.product_gid, req.image_urls or [], alt_texts)
    # Poll for images for a short time to allow Shopify to fetch/process
    images = []
    try:
        import time
        for _ in range(6):  # ~6 seconds total
            images = list_product_images(req.product_gid)
            if images:
                break
            time.sleep(1)
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

    verbose = upload_image_attachments_to_product(product_gid, blobs, alt_texts)

    # Poll for images
    images = []
    try:
        import time
        for _ in range(8):  # ~8s
            images = list_product_images(product_gid)
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


# Utility endpoint to (re)configure Shopify product variants and inventory
class ShopifyConfigureVariantsRequest(BaseModel):
    product_gid: str
    base_price: Optional[float] = None
    sizes: Optional[List[str]] = None
    colors: Optional[List[str]] = None


@app.post("/api/shopify/configure_variants")
async def api_shopify_configure_variants(req: ShopifyConfigureVariantsRequest):
    res = configure_variants_for_product(req.product_gid, req.base_price, req.sizes, req.colors)
    return res
