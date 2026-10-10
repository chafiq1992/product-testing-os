"""Product owners for the ads dashboard.

One saved owner per product, independent of the selected store, so a choice
made on the dashboard is always the one shown next time. The Shopify product
vendor wins when it carries an owner code (NR -> nour, CHF -> chafiq,
AD-IL -> adil); any other vendor (e.g. "irrakids") is ignored and the saved
choice applies.

Owners chosen before this module lived in store-scoped campaign meta
(``campaign_meta:product-owner:<id>``); they are still read as a fallback, from
whichever store holds the most recent choice.
"""
from __future__ import annotations

import json
import logging
import re
import threading
import time
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from app import db
from app.ads_analyzer_settings import canonical_store

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/product-owners", tags=["product-owners"])

OWNERS = ("chafiq", "nour", "adil")
# Vendor codes compared without case, spaces or punctuation ("AD-IL" == "adil").
VENDOR_OWNERS = {"nr": "nour", "chf": "chafiq", "adil": "adil"}
MAX_PRODUCTS = 1000
_VENDOR_TTL_S = 600
_vendor_cache: dict[tuple[str, str], tuple[float, Optional[str]]] = {}
_cache_lock = threading.Lock()
_write_lock = threading.Lock()

_VENDOR_QUERY = """
query PtosProductVendors($ids: [ID!]!) {
  nodes(ids: $ids) { ... on Product { id vendor } }
}
"""


def owner_key(product_id: str) -> str:
    return f"product_owner:{product_id}"


def legacy_key(product_id: str) -> str:
    return f"campaign_meta:product-owner:{product_id}"


def normalize_owner(value: Any) -> str:
    owner = str(value or "").strip().lower()
    return owner if owner in OWNERS else ""


def owner_from_vendor(vendor: Any) -> str:
    code = re.sub(r"[^a-z0-9]", "", str(vendor or "").lower())
    return VENDOR_OWNERS.get(code, "")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clean_ids(values: list[Any]) -> list[str]:
    out = []
    for value in values or []:
        pid = str(value or "").strip()
        if pid.isdigit() and pid not in out:
            out.append(pid)
    return out[:MAX_PRODUCTS]


def _legacy_owners(product_ids: list[str]) -> dict[str, str]:
    """Most recent store-scoped owner per product from the old campaign meta."""
    if not product_ids:
        return {}
    keys = {legacy_key(pid): pid for pid in product_ids}
    out: dict[str, str] = {}
    with db.SessionLocal() as session:
        rows = (session.query(db.AppSetting)
                .filter(db.AppSetting.key.in_(list(keys)))
                .order_by(db.AppSetting.updated_at.desc())
                .all())
    seen: set[str] = set()
    for row in rows:
        pid = keys.get(row.key)
        if not pid or pid in seen:
            continue
        seen.add(pid)
        try:
            value = json.loads(row.value) if row.value else {}
        except Exception:
            value = {}
        if isinstance(value, dict):
            out[pid] = normalize_owner(value.get("owner"))
    return out


def load_records(product_ids: list[str]) -> dict[str, dict]:
    stored = db.get_app_settings(None, [owner_key(pid) for pid in product_ids]) or {}
    return {pid: stored[owner_key(pid)] for pid in product_ids if isinstance(stored.get(owner_key(pid)), dict)}


def product_vendors(product_ids: list[str], stores: list[Optional[str]]) -> tuple[dict[str, str], list[str]]:
    """Live Shopify vendor per product, trying each store; cached briefly."""
    from app.integrations.shopify_client import _gql_store_once

    found: dict[str, str] = {}
    errors: list[str] = []
    remaining = list(product_ids)
    now = time.time()
    for store in stores or [None]:
        if not remaining:
            break
        need: list[str] = []
        with _cache_lock:
            for pid in remaining:
                hit = _vendor_cache.get((store or "", pid))
                if hit and hit[0] > now:
                    if hit[1] is not None:
                        found[pid] = hit[1]
                else:
                    need.append(pid)
        for offset in range(0, len(need), 100):
            chunk = need[offset:offset + 100]
            try:
                data = _gql_store_once(store, _VENDOR_QUERY, {"ids": [f"gid://shopify/Product/{pid}" for pid in chunk]}, timeout=30) or {}
            except Exception as exc:
                errors.append(f"{store or 'default'}: {str(exc)[:160]}")
                logger.warning("product_owners.vendor_lookup_failed store=%s err=%s", store, exc)
                break
            in_store: dict[str, str] = {}
            for node in data.get("nodes") or []:
                if node and node.get("id"):
                    in_store[str(node["id"]).rsplit("/", 1)[-1]] = str(node.get("vendor") or "")
            with _cache_lock:
                for pid in chunk:
                    _vendor_cache[(store or "", pid)] = (now + _VENDOR_TTL_S, in_store.get(pid))
            found.update(in_store)
        remaining = [pid for pid in remaining if pid not in found]
    return found, errors


def resolve_owners(product_ids: list[Any], stores: list[Any]) -> dict:
    pids = _clean_ids(product_ids)
    store_list = list(dict.fromkeys(canonical_store(s) for s in (stores or []) if canonical_store(s))) or [None]
    records = load_records(pids)
    legacy = _legacy_owners([pid for pid in pids if "owner" not in records.get(pid, {})])
    vendors, errors = product_vendors(pids, store_list)
    out: dict[str, dict] = {}
    updates: dict[str, dict] = {}
    for pid in pids:
        record = records.get(pid, {})
        saved = normalize_owner(record["owner"]) if "owner" in record else legacy.get(pid, "")
        if pid in vendors:
            vendor = vendors[pid]
            vendor_owner = owner_from_vendor(vendor)
            if record.get("vendor") != vendor or record.get("vendor_owner", "") != vendor_owner:
                updates[pid] = {**record, "vendor": vendor, "vendor_owner": vendor_owner, "vendor_checked_at": _now()}
        else:
            # Shopify unreachable or the product is not in these stores: keep the
            # last vendor seen so ownership does not flicker.
            vendor = record.get("vendor")
            vendor_owner = normalize_owner(record.get("vendor_owner"))
        owner, source = (vendor_owner, "vendor") if vendor_owner else (saved, "saved" if saved else None)
        out[pid] = {"owner": owner, "source": source, "vendor": vendor, "saved_owner": saved}
    if updates:
        try:
            with _write_lock:
                current = load_records(list(updates))
                db.set_app_settings(None, {owner_key(pid): {**current.get(pid, {}), **{k: v for k, v in patch.items() if k.startswith("vendor")}}
                                           for pid, patch in updates.items()})
        except Exception as exc:
            logger.warning("product_owners.vendor_persist_failed err=%s", exc)
    return {"owners": out, "errors": errors}


def save_owner(product_id: str, owner: str) -> dict:
    pid = _clean_ids([product_id])
    if not pid:
        raise ValueError("A numeric product id is required")
    pid = pid[0]
    with _write_lock:
        record = load_records([pid]).get(pid, {})
        record = {**record, "owner": normalize_owner(owner), "owner_updated_at": _now()}
        db.set_app_setting(None, owner_key(pid), record)
    vendor_owner = normalize_owner(record.get("vendor_owner"))
    return {"product_id": pid, "owner": vendor_owner or record["owner"], "source": "vendor" if vendor_owner else ("saved" if record["owner"] else None),
            "vendor": record.get("vendor"), "saved_owner": record["owner"]}


class ResolveRequest(BaseModel):
    product_ids: list[str] = Field(default_factory=list, max_length=MAX_PRODUCTS)
    stores: list[str] = Field(default_factory=list, max_length=10)


class SaveRequest(BaseModel):
    product_id: str = Field(pattern=r"^\d{1,20}$")
    owner: str = Field(default="", max_length=40)


@router.post("/resolve")
async def api_resolve_product_owners(req: ResolveRequest):
    try:
        result = await run_in_threadpool(resolve_owners, req.product_ids, req.stores)
        return {"data": result["owners"], "errors": result["errors"]}
    except Exception as exc:
        logger.exception("product_owners.resolve_failed")
        return {"error": str(exc), "data": {}}


@router.post("")
async def api_save_product_owner(req: SaveRequest):
    owner = (req.owner or "").strip().lower()
    if owner and owner not in OWNERS:
        return {"error": f"Unknown owner {req.owner}"}
    try:
        return {"data": await run_in_threadpool(save_owner, req.product_id, owner)}
    except Exception as exc:
        logger.exception("product_owners.save_failed")
        return {"error": str(exc)}
