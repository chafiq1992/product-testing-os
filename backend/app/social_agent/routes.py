from __future__ import annotations

import hmac
import os
from datetime import date
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from app.social_agent import meta, repository as repo, service, shopify
from app.system_health_routes import _get_admin


router = APIRouter(prefix="/api/social-agent", tags=["social-agent"])


def _require_admin(request: Request) -> dict[str, Any]:
    admin = _get_admin(request)
    if not admin:
        raise HTTPException(status_code=401, detail="System administrator authentication is required")
    return admin


def _require_scheduler_or_admin(request: Request) -> None:
    expected = (os.getenv("SOCIAL_AGENT_SCHEDULER_SECRET") or "").strip()
    supplied = (request.headers.get("x-social-agent-key") or "").strip()
    if expected and supplied and hmac.compare_digest(expected, supplied):
        return
    if _get_admin(request):
        return
    raise HTTPException(status_code=401, detail="Scheduler authentication failed")


class ConfigBody(BaseModel):
    store: str
    patch: dict[str, Any] = Field(default_factory=dict)
    confirm_live_publish: bool = False


class BatchBody(BaseModel):
    store: str
    slot: str
    local_date: str | None = None
    prepare_one_now: bool = True


class StoreBody(BaseModel):
    store: str


class PublishBody(BaseModel):
    store: str
    force: bool = False
    confirm: bool = False


@router.get("/dashboard")
async def get_dashboard(request: Request, store: str):
    _require_admin(request)
    return {"data": await run_in_threadpool(service.dashboard, store)}


@router.get("/catalog-preview")
async def get_catalog_preview(request: Request, store: str, limit: int = 20):
    _require_admin(request)
    try:
        return {"data": await run_in_threadpool(service.catalog_preview, store, limit)}
    except Exception as error:
        return {"error": str(error), "data": {"products": [], "active_count": 0, "eligible_count": 0}}


@router.get("/connection")
async def get_connection(request: Request, store: str):
    _require_admin(request)
    shopify_status = await run_in_threadpool(shopify.upload_capability, store)
    try:
        meta_status = await run_in_threadpool(meta.connection, store)
        return {"data": {
            **meta_status, "meta_ready": bool(meta_status.get("ready")),
            "shopify": shopify_status,
            "ready": bool(meta_status.get("ready") and shopify_status.get("ready")),
        }}
    except Exception as error:
        return {"error": str(error), "data": {
            "ready": False, "meta_ready": False, "shopify": shopify_status,
        }}


@router.put("/config")
async def put_config(request: Request, body: ConfigBody):
    _require_admin(request)
    requested_live = bool(body.patch.get("live_publish"))
    current = repo.get_config(body.store)
    requested_enabled = bool(body.patch.get("enabled", current.get("enabled")))
    if (requested_enabled or requested_live) and not shopify.upload_capability(body.store).get("ready"):
        raise HTTPException(
            status_code=400,
            detail=f"Store '{repo.canonical_store(body.store)}' needs Shopify write_files permission before automation can be enabled",
        )
    if requested_live and not current.get("live_publish") and not body.confirm_live_publish:
        raise HTTPException(status_code=400, detail="confirm_live_publish=true is required to enable live posting")
    if requested_live and not current.get("live_publish"):
        try:
            connection = await run_in_threadpool(meta.connection, body.store)
        except Exception as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        if not connection.get("ready"):
            raise HTTPException(status_code=400, detail="The selected store needs its own Facebook Page and Instagram connection")
    config = repo.save_config(body.store, body.patch)
    armed = repo.arm_preview_posts(body.store) if config.get("live_publish") and not current.get("live_publish") else 0
    return {"data": {"config": config, "armed_preview_posts": armed}}


@router.post("/batches")
async def create_batch(request: Request, body: BatchBody):
    _require_admin(request)
    try:
        local_day = date.fromisoformat(body.local_date) if body.local_date else None
        run = await run_in_threadpool(service.queue_batch, body.store, body.slot, local_day)
        prepared = await run_in_threadpool(service.prepare_one, run["id"]) if body.prepare_one_now and run.get("status") != "completed" else None
        return {"data": {"run": repo.get_run(run["id"]), "prepared": prepared}}
    except Exception as error:
        return {"error": str(error)}


@router.post("/prepare-next")
async def prepare_next(request: Request, body: StoreBody):
    _require_admin(request)
    try:
        return {"data": await run_in_threadpool(service.prepare_next, body.store)}
    except Exception as error:
        return {"error": str(error)}


@router.post("/publish-due")
async def publish_due(request: Request, body: StoreBody):
    _require_admin(request)
    try:
        return {"data": await run_in_threadpool(service.publish_due, body.store, 3)}
    except Exception as error:
        return {"error": str(error)}


@router.post("/posts/{post_id}/publish")
async def publish_one(request: Request, post_id: str, body: PublishBody):
    _require_admin(request)
    if not body.confirm:
        raise HTTPException(status_code=400, detail="confirm=true is required for manual publishing")
    post = repo.get_post(post_id)
    if not post or repo.canonical_store(post.get("store")) != repo.canonical_store(body.store):
        raise HTTPException(status_code=404, detail="Post not found for this store")
    try:
        return {"data": await run_in_threadpool(service.publish_post, post_id, force=body.force)}
    except Exception as error:
        return {"error": str(error)}


@router.post("/analytics")
async def refresh_analytics(request: Request, body: StoreBody):
    _require_admin(request)
    try:
        return {"data": await run_in_threadpool(service.collect_analytics, body.store)}
    except Exception as error:
        return {"error": str(error)}


@router.post("/scheduler/tick")
async def scheduler_tick(request: Request, store: str | None = None):
    _require_scheduler_or_admin(request)
    return {"data": await run_in_threadpool(service.scheduler_tick, store)}
