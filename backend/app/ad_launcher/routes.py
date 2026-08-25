from __future__ import annotations

import mimetypes
import re
import threading
from typing import Any
from urllib.parse import quote
from uuid import uuid4

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from starlette.concurrency import run_in_threadpool

from app.ad_launcher import repository as repo, service
from app.ad_launcher.models import LaunchConfirmation, MediaAsset
from app.config import BASE_URL
from app.system_health_routes import _get_admin


router = APIRouter(prefix="/api/ad-launcher", tags=["ad-launcher"])

IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}
VIDEO_TYPES = {"video/mp4", "video/quicktime", "video/webm"}


def _require_admin(request: Request) -> dict[str, Any]:
    admin = _get_admin(request)
    if not admin:
        raise HTTPException(status_code=401, detail="System administrator authentication is required")
    return admin


def _base_url(request: Request) -> str:
    configured = str(BASE_URL or "").strip().rstrip("/")
    if configured and "localhost" not in configured and "127.0.0.1" not in configured:
        return configured
    protocol = request.headers.get("x-forwarded-proto") or request.url.scheme
    host = request.headers.get("x-forwarded-host") or request.headers.get("host")
    return f"{protocol}://{host}".rstrip("/") if host else str(request.base_url).rstrip("/")


def _countries(raw: str) -> list[str]:
    value = str(raw or "MA").strip()
    try:
        import json
        parsed = json.loads(value)
        items = parsed if isinstance(parsed, list) else [parsed]
    except Exception:
        items = value.split(",")
    countries = list(dict.fromkeys(str(item).strip().upper() for item in items if str(item).strip()))
    if not countries or any(not re.fullmatch(r"[A-Z]{2}", item) for item in countries):
        raise HTTPException(status_code=400, detail="countries must contain ISO two-letter country codes")
    return countries[:5]


def _prepare_and_optionally_launch(job_id: str, store: str, auto_launch: bool, resume: bool = False) -> None:
    service.prepare_job(job_id, store, resume=resume)
    if auto_launch:
        job = repo.get_job(store, job_id) or {}
        if job.get("status") == "approved":
            try:
                service.launch_job(job_id, store)
            except Exception:
                pass


def _retry_meta_launch(job_id: str, store: str) -> None:
    try:
        service.launch_job(job_id, store)
    except Exception:
        # launch_job persists a safe paused/failed state and an activity entry for polling clients.
        pass


@router.get("/connection")
async def get_connection(request: Request, store: str, ad_account_id: str | None = None):
    _require_admin(request)
    normalized_account = str(ad_account_id or "").strip().removeprefix("act_") or None
    if normalized_account and not normalized_account.isdigit():
        raise HTTPException(status_code=400, detail="ad_account_id must be a numeric Meta ad account ID")
    return {"data": await run_in_threadpool(service.connection, store, normalized_account)}


@router.post("/jobs")
async def create_job(
    request: Request,
    store: str = Form(...),
    ad_account_id: str | None = Form(None),
    product_id: str = Form(...),
    landing_url: str | None = Form(None),
    total_daily_budget_usd: float | None = Form(None),
    daily_budget_per_adset_usd: float | None = Form(None),
    adset_count: int = Form(3),
    creative_type: str = Form("auto"),
    ai_generated_adsets: bool = Form(False),
    countries: str = Form("MA"),
    timezone: str = Form("Africa/Casablanca"),
    auto_launch: bool = Form(False),
    confirm_live_launch: bool = Form(False),
    source_job_id: str | None = Form(None),
    files: list[UploadFile] = File(default_factory=list),
):
    _require_admin(request)
    numeric_id = str(product_id or "").strip().split("/")[-1]
    if not numeric_id.isdigit():
        raise HTTPException(status_code=400, detail="product_id must be a numeric Shopify product ID")
    normalized_account = str(ad_account_id or "").strip().removeprefix("act_")
    if normalized_account and not normalized_account.isdigit():
        raise HTTPException(status_code=400, detail="ad_account_id must be a numeric Meta ad account ID")
    if adset_count not in {2, 3}:
        raise HTTPException(status_code=400, detail="adset_count must be 2 or 3")
    expected_adsets = adset_count + (2 if ai_generated_adsets else 0)
    per_adset_budget = float(daily_budget_per_adset_usd) if daily_budget_per_adset_usd is not None else 9.0
    total_budget = per_adset_budget * expected_adsets
    if abs(per_adset_budget - 9.0) > 0.001:
        raise HTTPException(status_code=400, detail="This launcher requires a $9.00 daily budget per ad set")
    if per_adset_budget < 1:
        raise HTTPException(status_code=400, detail="Daily budget must be at least $1.00 per ad set")
    if total_budget > 10_000:
        raise HTTPException(status_code=400, detail="Budget exceeds the launcher safety limit")
    selected_creative_type = str(creative_type or "auto").strip().lower()
    if selected_creative_type not in {"auto", "image", "carousel", "video"}:
        raise HTTPException(status_code=400, detail="creative_type must be image, carousel, or video")
    if auto_launch and not confirm_live_launch:
        raise HTTPException(status_code=400, detail="confirm_live_launch=true is required for automatic live scheduling")
    uploads = list(files or [])
    if len(uploads) > 10:
        raise HTTPException(status_code=400, detail="Upload no more than 10 creative files")

    job_id = str(uuid4())
    base_url = _base_url(request)
    pending: list[dict[str, Any]] = []
    for index, upload in enumerate(uploads):
        data = await upload.read()
        raw_name = str(upload.filename or f"creative-{index}")
        content_type = str(upload.content_type or mimetypes.guess_type(raw_name)[0] or "").lower()
        if content_type in IMAGE_TYPES:
            kind = "image"
            limit = 25 * 1024 * 1024
        elif content_type in VIDEO_TYPES:
            kind = "video"
            limit = 200 * 1024 * 1024
        else:
            raise HTTPException(status_code=400, detail=f"Unsupported creative type: {content_type or raw_name}")
        if not data or len(data) > limit:
            raise HTTPException(status_code=400, detail=f"{raw_name} is empty or exceeds the {limit // 1024 // 1024} MB limit")
        pending.append({
            "data": data,
            "content_type": content_type,
            "kind": kind,
        })

    assets: list[dict[str, Any]] = []
    actual_creative_type = ""
    if pending:
        try:
            actual_creative_type = service.classify_media(
                pending,
                selected_format=selected_creative_type,
                uploaded_adsets=adset_count,
            )
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        for index, item in enumerate(pending):
            extension = _content_suffix(str(item["content_type"]))
            filename = f"ad_launcher_{job_id}_{index}{extension}"
            path = repo.save_asset(filename, bytes(item["data"]), str(item["content_type"]))
            url = f"{base_url}{quote(path, safe='/:')}" if base_url else path
            assets.append(MediaAsset(
                filename=filename,
                url=url,
                content_type=str(item["content_type"]),
                size=len(item["data"]),
                kind=str(item["kind"]),
                source="uploaded",
            ).model_dump(mode="json"))
    elif source_job_id:
        source_job = repo.get_job(store, str(source_job_id))
        if not source_job:
            raise HTTPException(status_code=404, detail="Saved source job was not found for this store")
        assets = [dict(item) for item in ((source_job.get("request") or {}).get("media") or [])]
        try:
            actual_creative_type = service.classify_media(
                assets,
                selected_format=selected_creative_type,
                uploaded_adsets=adset_count,
            )
            for asset in assets:
                filename = str(asset.get("filename") or "").replace("\\", "/").split("/")[-1]
                repo.load_asset(filename)
                if base_url and filename:
                    asset["url"] = f"{base_url}/uploads/{quote(filename, safe='')}"
        except Exception as error:
            raise HTTPException(status_code=400, detail=f"Saved creative files are unavailable: {error}") from error
    else:
        raise HTTPException(status_code=400, detail="Upload creative files or choose a saved product card")
    campaign_name = repo.reserve_campaign_name(store, normalized_account or None, numeric_id)

    request_data = {
        "store": repo.canonical_store(store),
        "meta_ad_account_id": normalized_account or None,
        "product_id": numeric_id,
        "campaign_name": campaign_name,
        "landing_url": str(landing_url or "").strip() or None,
        "adset_count": adset_count,
        "daily_budget_per_adset_usd": round(per_adset_budget, 2),
        "total_daily_budget_usd": round(total_budget, 2),
        "creative_type": actual_creative_type,
        "ai_generated_adsets": bool(ai_generated_adsets),
        "countries": _countries(countries),
        "timezone": timezone,
        "auto_launch": bool(auto_launch),
        "media": assets,
        "base_url": base_url,
        "source_job_id": str(source_job_id or "").strip() or None,
    }
    row = repo.create_job(store, job_id, request_data)
    threading.Thread(
        target=_prepare_and_optionally_launch,
        args=(job_id, repo.canonical_store(store), bool(auto_launch)),
        daemon=True,
        name=f"ad-launcher-{job_id[:8]}",
    ).start()
    return {"data": {"job_id": job_id, "status": row["status"]}}


@router.get("/product-cards")
async def product_cards(request: Request, store: str | None = None, limit: int = 60):
    _require_admin(request)
    cards = await run_in_threadpool(repo.list_product_cards, store, limit)
    return {"data": cards}


def _content_suffix(content_type: str) -> str:
    return {
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/webp": ".webp",
        "video/mp4": ".mp4",
        "video/quicktime": ".mov",
        "video/webm": ".webm",
    }.get(content_type, mimetypes.guess_extension(content_type) or ".bin")


@router.get("/jobs/{job_id}")
async def get_job(request: Request, job_id: str, store: str):
    _require_admin(request)
    job = await run_in_threadpool(repo.get_job, store, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Ad launcher job not found")
    return {"data": job}


@router.post("/jobs/{job_id}/retry")
async def retry_job(request: Request, job_id: str, body: LaunchConfirmation):
    _require_admin(request)
    if not body.confirm:
        raise HTTPException(status_code=400, detail="confirm=true is required to resume a job")
    try:
        job = await run_in_threadpool(service.retry_job, job_id, body.store)
        request_data = dict(job.get("request") or {})
        store = repo.canonical_store(body.store)
        if job.get("stage") == "meta_retry_queued":
            threading.Thread(
                target=_retry_meta_launch,
                args=(job_id, store),
                daemon=True,
                name=f"ad-launcher-meta-retry-{job_id[:8]}",
            ).start()
        else:
            threading.Thread(
                target=_prepare_and_optionally_launch,
                args=(job_id, store, bool(request_data.get("auto_launch")), True),
                daemon=True,
                name=f"ad-launcher-retry-{job_id[:8]}",
            ).start()
        return {"data": {"job_id": job_id, "status": job.get("status") or "queued"}}
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.post("/jobs/{job_id}/launch")
async def launch_job(request: Request, job_id: str, body: LaunchConfirmation):
    _require_admin(request)
    if not body.confirm:
        raise HTTPException(status_code=400, detail="confirm=true is required for a live Meta launch")
    try:
        result = await run_in_threadpool(service.launch_job, job_id, body.store)
        return {"data": result}
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except Exception as error:
        return {"error": str(error)}
