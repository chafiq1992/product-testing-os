from __future__ import annotations

import base64
from io import BytesIO
import mimetypes
import os
import re
import subprocess
import tempfile
from datetime import datetime, time as dt_time, timedelta
from pathlib import Path
from typing import Any
from urllib.parse import urlparse
from uuid import uuid4
from zoneinfo import ZoneInfo

import requests
from bs4 import BeautifulSoup
from PIL import Image

from app.ad_launcher import agents, meta, repository as repo
from app.ad_launcher.models import MediaAsset, PreparedAdSet, PreparedCampaign
from app.integrations.openai_client import (
    DEFAULT_IMAGE_MODEL,
    _openai_image_result_to_data_url,
    client,
)
from app.integrations.shopify_client import _get_store_config, _gql_store
from app.social_agent.shopify import _normalize_product


PRODUCT_QUERY = """
query AdLauncherProduct($id: ID!) {
  node(id: $id) {
    ... on Product {
      id title handle status totalInventory productType vendor tags descriptionHtml onlineStoreUrl
      featuredMedia { preview { image { url altText width height } } }
      media(first: 12) {
        nodes {
          mediaContentType
          preview { image { url altText width height } }
          ... on MediaImage { image { url altText width height } }
          ... on Video { sources { url mimeType format height width } }
        }
      }
      variants(first: 50) {
        nodes { id title price compareAtPrice inventoryQuantity availableForSale selectedOptions { name value } }
      }
    }
  }
}
"""


def _number(value: Any, fallback: float) -> float:
    try:
        return float(value)
    except Exception:
        return fallback


def _data_url(data: bytes, content_type: str) -> str:
    return f"data:{content_type};base64,{base64.b64encode(data).decode('ascii')}"


def _arabic_ratio(value: str) -> tuple[int, float]:
    arabic = len(re.findall(r"[\u0600-\u06ff]", value or ""))
    letters = len(re.findall(r"[A-Za-z\u0600-\u06ff]", value or ""))
    return arabic, arabic / max(letters, 1)


def _allowed_landing_hosts(store: str | None, product_url: str) -> set[str]:
    hosts: set[str] = set()
    try:
        host = (urlparse(product_url).hostname or "").lower()
        if host:
            hosts.add(host)
    except Exception:
        pass
    try:
        cfg = _get_store_config(store)
        shop = str(cfg.get("SHOP") or "").replace("https://", "").replace("http://", "").split("/", 1)[0]
        if shop:
            hosts.add(shop.lower())
    except Exception:
        pass
    suffix = re.sub(r"[^A-Z0-9]", "_", str(store or "").upper()).strip("_")
    for key in (f"SHOPIFY_PUBLIC_DOMAIN_{suffix}" if suffix else "", "SHOPIFY_PUBLIC_DOMAIN"):
        value = str(os.getenv(key, "") or "").strip()
        if value:
            host = (urlparse(value if "://" in value else f"https://{value}").hostname or "").lower()
            if host:
                hosts.add(host)
    return hosts


def _landing_evidence(store: str | None, product: dict[str, Any], override: str | None) -> tuple[str, dict[str, Any]]:
    product_url = str(product.get("url") or "").strip()
    landing_url = str(override or product_url).strip()
    parsed = urlparse(landing_url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("A valid public Shopify Arabic landing URL is required")
    allowed_hosts = _allowed_landing_hosts(store, product_url)
    if allowed_hosts and parsed.hostname.lower() not in allowed_hosts:
        raise ValueError("The destination URL must use the selected Shopify store's public domain")

    evidence: dict[str, Any] = {
        "url": landing_url,
        "http_status": None,
        "final_url": landing_url,
        "title": "",
        "description": "",
        "text_excerpt": "",
        "arabic_characters": 0,
        "arabic_ratio": 0.0,
        "arabic_ready_hint": False,
        "fetch_error": None,
    }
    try:
        response = requests.get(
            landing_url,
            headers={"User-Agent": "ProductTestingOS-AdLauncher/1.0"},
            timeout=(5, 25),
        )
        evidence["http_status"] = response.status_code
        response.raise_for_status()
        final_host = (urlparse(response.url).hostname or "").lower()
        if allowed_hosts and final_host not in allowed_hosts:
            raise ValueError("The Shopify destination redirected to an unapproved domain")
        evidence["final_url"] = response.url
        soup = BeautifulSoup(response.text[:1_500_000], "html.parser")
        for element in soup(["script", "style", "noscript", "svg"]):
            element.decompose()
        title = soup.title.get_text(" ", strip=True) if soup.title else ""
        meta_description = soup.find("meta", attrs={"name": re.compile("description", re.I)})
        description = str(meta_description.get("content") or "") if meta_description else ""
        text = re.sub(r"\s+", " ", soup.get_text(" ", strip=True)).strip()
        sample = " ".join([title, description, text[:12000]])
        count, ratio = _arabic_ratio(sample)
        evidence.update({
            "title": title[:500],
            "description": description[:1000],
            "text_excerpt": text[:8000],
            "arabic_characters": count,
            "arabic_ratio": round(ratio, 4),
            "arabic_ready_hint": bool(count >= 80 and ratio >= 0.15),
        })
    except Exception as error:
        evidence["fetch_error"] = f"{type(error).__name__}: {error}"[:1200]
    return landing_url, evidence


def get_product(store: str | None, product_id: str) -> dict[str, Any]:
    numeric = str(product_id or "").strip().split("/")[-1]
    if not numeric.isdigit():
        raise ValueError("Shopify product ID must be numeric")
    data = _gql_store(store, PRODUCT_QUERY, {"id": f"gid://shopify/Product/{numeric}"})
    node = (data or {}).get("node") or {}
    if not node or not node.get("id"):
        raise ValueError(f"Shopify product {numeric} was not found in store {store}")
    product = _normalize_product(node)
    product["numeric_id"] = numeric
    return product


def classify_media(items: list[dict[str, Any]]) -> str:
    kinds = [str(item.get("kind") or "") for item in items]
    if not kinds:
        raise ValueError("Upload one image, one video, or 2-10 carousel images")
    if kinds == ["video"]:
        return "video"
    if all(kind == "image" for kind in kinds):
        if len(kinds) == 1:
            return "image"
        if 2 <= len(kinds) <= 10:
            return "carousel"
    raise ValueError("Use exactly one video, exactly one image, or 2-10 images for a carousel; mixed media is not supported")


def _image_asset_data(asset: dict[str, Any]) -> str:
    data = repo.load_asset(str(asset.get("filename") or ""))
    if len(data) > 25 * 1024 * 1024:
        raise ValueError("Image exceeds the 25 MB analysis limit")
    return _data_url(data, str(asset.get("content_type") or "image/jpeg"))


def _video_frames(asset: dict[str, Any]) -> list[str]:
    source = repo.load_asset(str(asset.get("filename") or ""))
    suffix = mimetypes.guess_extension(str(asset.get("content_type") or "")) or Path(str(asset.get("filename") or "video.mp4")).suffix or ".mp4"
    frames: list[str] = []
    with tempfile.TemporaryDirectory(prefix="ad-launcher-video-") as temp_dir:
        input_path = Path(temp_dir) / f"source{suffix}"
        input_path.write_bytes(source)
        for index, offset in enumerate((0, 2, 5)):
            output_path = Path(temp_dir) / f"frame-{index}.jpg"
            command = [
                "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-ss", str(offset),
                "-i", str(input_path), "-frames:v", "1", "-vf",
                "scale=1280:-2:force_original_aspect_ratio=decrease", str(output_path),
            ]
            try:
                subprocess.run(command, check=True, capture_output=True, timeout=45)
                if output_path.exists() and output_path.stat().st_size:
                    frame = _data_url(output_path.read_bytes(), "image/jpeg")
                    if frame not in frames:
                        frames.append(frame)
            except (FileNotFoundError, subprocess.SubprocessError):
                continue
    if not frames:
        raise RuntimeError("Video analysis needs ffmpeg and at least one readable video frame")
    return frames


def _download_reference_image(url: str) -> tuple[bytes, str]:
    response = requests.get(url, timeout=(5, 35))
    response.raise_for_status()
    content_type = str(response.headers.get("content-type") or "image/jpeg").split(";", 1)[0]
    if not content_type.startswith("image/") or len(response.content) > 25 * 1024 * 1024:
        raise ValueError("Shopify product reference is not a supported image")
    return response.content, content_type


def _crop_to_four_five(data: bytes) -> bytes:
    """Center-crop a generated portrait to an exact 4:5 feed asset."""
    with Image.open(BytesIO(data)) as source:
        image = source.convert("RGB")
        width, height = image.size
        if width * 5 > height * 4:
            target_width = max(1, (height * 4) // 5)
            left = (width - target_width) // 2
            image = image.crop((left, 0, left + target_width, height))
        elif width * 5 < height * 4:
            target_height = max(1, (width * 5) // 4)
            top = (height - target_height) // 2
            image = image.crop((0, top, width, top + target_height))
        output = BytesIO()
        image.save(output, format="PNG", optimize=True)
        return output.getvalue()


def _generated_image(
    product: dict[str, Any], prompt: str, *, base_url: str, candidate: int,
) -> tuple[dict[str, Any], str]:
    source_url = str(((product.get("images") or [{}])[0]).get("url") or "")
    if not source_url:
        raise RuntimeError("AI image ad sets require a Shopify product reference image")
    source, source_type = _download_reference_image(source_url)
    suffix = mimetypes.guess_extension(source_type) or ".jpg"
    temp_path = ""
    try:
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as handle:
            handle.write(source)
            temp_path = handle.name
        final_prompt = (
            f"{prompt}\n\n"
            "Mandatory fidelity and advertising constraints: preserve the exact supplied product identity, color, shape, "
            "proportions, material appearance, stitching, printed marks, logo placement, parts, and quantity. Do not invent "
            "a variant, accessory, package, feature, testimonial, rating, price, discount, UI, watermark, person, or brand. "
            "Create one photorealistic premium ecommerce ad in a 4:5 portrait-safe composition with realistic commercial "
            "lighting, contact shadows, strong mobile hierarchy, and generous placement-safe margins. Render no letters, "
            "numbers, badges, CTA, or other text. The approved Arabic copy will be supplied by Meta."
        )
        with open(temp_path, "rb") as image_file:
            response = client.images.edit(
                model=os.getenv("AD_LAUNCHER_IMAGE_MODEL", DEFAULT_IMAGE_MODEL),
                image=[image_file],
                prompt=final_prompt,
                size=os.getenv("AD_LAUNCHER_IMAGE_SIZE", "1024x1280"),
                quality=os.getenv("AD_LAUNCHER_IMAGE_QUALITY", "high"),
                background="opaque",
                output_format="png",
                n=1,
            )
        result_url = _openai_image_result_to_data_url(response)
        match = re.match(r"^data:([^;]+);base64,(.+)$", result_url or "", flags=re.DOTALL)
        if not match:
            raise RuntimeError("OpenAI returned no usable generated image")
        content_type = match.group(1)
        data = _crop_to_four_five(base64.b64decode(match.group(2)))
        content_type = "image/png"
        filename = f"ad_launcher_ai_{uuid4().hex}_{candidate}.png"
        path = repo.save_asset(filename, data, content_type)
        url = f"{base_url.rstrip('/')}{path}" if base_url else path
        asset = MediaAsset(
            filename=filename,
            url=url,
            content_type=content_type,
            size=len(data),
            kind="image",
            source="ai_generated",
        ).model_dump(mode="json")
        return asset, _data_url(data, content_type)
    finally:
        if temp_path:
            Path(temp_path).unlink(missing_ok=True)


def scheduled_start(timezone_name: str, now: datetime | None = None) -> str:
    try:
        zone = ZoneInfo(timezone_name)
    except Exception as error:
        raise ValueError(f"Unknown timezone: {timezone_name}") from error
    local_now = now.astimezone(zone) if now else datetime.now(zone)
    target = datetime.combine(local_now.date(), dt_time(23, 59), tzinfo=zone)
    if target <= local_now:
        target += timedelta(days=1)
    return target.isoformat()


def _context(
    request_data: dict[str, Any], product: dict[str, Any], landing: dict[str, Any], media_format: str,
) -> dict[str, Any]:
    expected_adsets = 4 if request_data.get("ai_generated_adsets") else 2
    return {
        "shopify_product": product,
        "landing_page": landing,
        "uploaded_creative": {
            "classification": media_format,
            "asset_count": len(request_data.get("media") or []),
            "assets": [
                {k: item.get(k) for k in ("filename", "content_type", "size", "kind")}
                for item in request_data.get("media") or []
            ],
        },
        "operator_constraints": {
            "expected_adset_count": expected_adsets,
            "countries": request_data.get("countries") or ["MA"],
            "objective": "OUTCOME_SALES",
            "conversion_event": "PURCHASE",
            "total_daily_budget_usd": request_data.get("total_daily_budget_usd", 9),
            "same_broad_audience_for_every_adset": True,
            "interests_behaviors_custom_saved_lookalike_audiences": "forbidden",
            "catalog_dynamic_creative_advantage_audience_advantage_placements_meta_creative_enhancements": "forbidden",
            "destination_language": "Arabic",
            "schedule": "23:59 Africa/Casablanca; delivery begins the following day",
            "uploaded_adset_origins": ["uploaded", "uploaded"],
            "optional_adset_origins": ["ai_generated", "ai_generated"] if expected_adsets == 4 else [],
        },
    }


def prepare_job(job_id: str, store: str | None) -> None:
    job = repo.get_job(store, job_id)
    if not job:
        return
    request_data = dict(job.get("request") or {})
    try:
        repo.update_job(store, job_id, {"status": "running", "stage": "shopify_product", "progress": 8, "error": None})
        product = get_product(store, str(request_data.get("product_id") or ""))
        landing_url, landing = _landing_evidence(store, product, request_data.get("landing_url"))
        media = request_data.get("media") or []
        media_format = classify_media(media)

        repo.update_job(store, job_id, {"stage": "creative_analysis", "progress": 22})
        analysis_images: list[str] = []
        reference_url = str(((product.get("images") or [{}])[0]).get("url") or "")
        if reference_url:
            reference, reference_type = _download_reference_image(reference_url)
            analysis_images.append(_data_url(reference, reference_type))
        if media_format == "video":
            analysis_images.extend(_video_frames(media[0]))
        else:
            analysis_images.extend(_image_asset_data(item) for item in media)

        context = _context(request_data, product, landing, media_format)
        draft = agents.analyze_campaign(context, analysis_images)

        generated_media: list[dict[str, Any]] = []
        if request_data.get("ai_generated_adsets"):
            repo.update_job(store, job_id, {"stage": "ai_image_generation", "progress": 48})
            ai_drafts = [item for item in draft.adsets if item.origin == "ai_generated"]
            for index, item in enumerate(ai_drafts[:2], start=1):
                asset, data_url = _generated_image(
                    product,
                    str(item.image_prompt or ""),
                    base_url=str(request_data.get("base_url") or ""),
                    candidate=index,
                )
                generated_media.append(asset)
                analysis_images.append(data_url)

        repo.update_job(store, job_id, {"stage": "independent_review", "progress": 76})
        blockers = agents.deterministic_blockers(
            draft,
            expected_adsets=4 if request_data.get("ai_generated_adsets") else 2,
            expected_format=media_format,
            requested_countries=request_data.get("countries") or ["MA"],
            generated_media_count=len(generated_media),
        )
        if not landing.get("arabic_ready_hint"):
            blockers.append(
                "The destination page could not be independently verified as a reachable Arabic Shopify page"
            )
        review = agents.review_campaign(context, draft, analysis_images, blockers)

        prepared_adsets: list[PreparedAdSet] = []
        uploaded_urls = [str(item.get("url") or "") for item in media]
        generated_urls = [str(item.get("url") or "") for item in generated_media]
        ai_index = 0
        for item in draft.adsets:
            if item.origin == "uploaded":
                ad_media_type = media_format
                media_urls = uploaded_urls
            else:
                ad_media_type = "image"
                media_urls = [generated_urls[ai_index]] if ai_index < len(generated_urls) else []
                ai_index += 1
            prepared_adsets.append(PreparedAdSet(
                **item.model_dump(mode="json"),
                media_type=ad_media_type,
                media_urls=media_urls,
            ))

        plan = PreparedCampaign(
            campaign_name=draft.campaign_name,
            product_id=str(product.get("numeric_id") or request_data.get("product_id") or ""),
            product_title=str(product.get("title") or "Product"),
            landing_url=landing_url,
            store=repo.canonical_store(store),
            timezone=str(request_data.get("timezone") or "Africa/Casablanca"),
            scheduled_start=scheduled_start(str(request_data.get("timezone") or "Africa/Casablanca")),
            total_daily_budget_usd=_number(request_data.get("total_daily_budget_usd"), 9.0),
            audience=draft.audience,
            adsets=prepared_adsets,
            analysis=draft,
        )
        result = {
            "product": product,
            "landing_page": landing,
            "uploaded_media": media,
            "generated_media": generated_media,
            "plan": plan.model_dump(mode="json"),
            "review": review.model_dump(mode="json"),
            "model": agents.MODEL,
            "image_model": os.getenv("AD_LAUNCHER_IMAGE_MODEL", DEFAULT_IMAGE_MODEL),
            "meta_api_version": os.getenv("AD_LAUNCHER_META_API_VERSION", "v26.0"),
        }
        final_status = "approved" if review.approved else "rejected"
        repo.update_job(store, job_id, {
            "status": final_status,
            "stage": "ready" if review.approved else "review_rejected",
            "progress": 100,
            "result": result,
        })
    except Exception as error:
        repo.update_job(store, job_id, {
            "status": "failed",
            "stage": "failed",
            "error": {"type": type(error).__name__, "message": str(error)[:2500]},
        })


def launch_job(job_id: str, store: str | None) -> dict[str, Any]:
    job = repo.get_job(store, job_id)
    if not job:
        raise ValueError("Ad launcher job not found")
    if job.get("status") == "launched":
        return dict(((job.get("result") or {}).get("meta") or {}))
    if job.get("status") != "approved":
        raise ValueError("Only an independently approved campaign can be launched")
    result = dict(job.get("result") or {})
    review = result.get("review") or {}
    if not review.get("approved"):
        raise ValueError("The independent reviewer did not approve this campaign")
    plan = PreparedCampaign.model_validate(result.get("plan") or {})
    repo.claim_job_launch(store, job_id)
    try:
        meta_result = meta.create_sales_test_campaign(plan)
        result["meta"] = meta_result
        repo.update_job(store, job_id, {
            "status": "launched",
            "stage": "scheduled",
            "result": result,
            "launched_at": repo.utc_now(),
        })
        return meta_result
    except Exception as error:
        repo.update_job(store, job_id, {
            "status": "launch_failed",
            "stage": "meta_failed_paused",
            "error": {"type": type(error).__name__, "message": str(error)[:2500]},
            "result": result,
        })
        raise


def connection(store: str | None) -> dict[str, Any]:
    return meta.connection(store)
