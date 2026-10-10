"""Recent purchase orders (Shopify inventory transfers) for the ads dashboard.

The Inventory Helper app (shopify-collector) stores each purchase order as a
Shopify inventory transfer; the planned crate count is a numeric transfer tag.
This module reads those transfers directly from Shopify and, when collector
credentials are configured, uses the Inventory Helper receiving state to decide
whether a purchase order is still open (receiving queue) or closed (received
history).

Read-only: nothing here writes to Shopify or to the Inventory Helper.
"""
from __future__ import annotations

import logging
import os
import re
import threading
import time
from datetime import date, datetime, time as dtime, timedelta, timezone
from typing import Any, Optional
from zoneinfo import ZoneInfo

import requests
from fastapi import APIRouter
from starlette.concurrency import run_in_threadpool

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/purchase-orders", tags=["purchase-orders"])

_LOCAL_TZ = ZoneInfo("Africa/Casablanca")
_TRANSFER_API_VERSION = os.getenv("SHOPIFY_INVENTORY_API_VERSION", "2026-07").strip() or "2026-07"
_CACHE_TTL_S = 180
_cache: dict[tuple[str, int], tuple[float, dict]] = {}
_cache_lock = threading.Lock()
_helper_token: dict[str, Any] = {"token": None, "expires": 0.0}
_helper_lock = threading.Lock()

_OPEN_TRANSFER_STATUSES = {"DRAFT", "READY_TO_SHIP", "IN_PROGRESS"}
_CLOSED_HELPER_STATUSES = {"complete", "incomplete"}
_COLOR_NAMES = {"color", "colour", "couleur", "colore", "farbe", "لون"}
_SIZE_NAMES = {"size", "taille", "pointure", "shoe size", "eu size", "uk size", "us size", "größe", "tamanho", "مقاس"}

_TRANSFER_LIST_QUERY = """
query PtosRecentTransfers($query: String!, $after: String) {
  inventoryTransfers(first: 50, after: $after, query: $query, sortKey: CREATED_AT, reverse: true) {
    nodes { id name referenceName dateCreated status tags totalQuantity destination { name location { name } } }
    pageInfo { hasNextPage endCursor }
  }
}
"""

_TRANSFER_LINES_QUERY = """
query PtosTransferLines($id: ID!, $after: String) {
  inventoryTransfer(id: $id) {
    lineItems(first: 100, after: $after) {
      nodes {
        totalQuantity
        inventoryItem {
          sku
          variant {
            id
            title
            selectedOptions { name value }
            product { id title featuredMedia { preview { image { url } } } }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
}
"""

_VARIANT_PRODUCTS_QUERY = """
query PtosVariantProducts($ids: [ID!]!) {
  nodes(ids: $ids) { ... on ProductVariant { id product { id title } } }
}
"""


def period_for_days(days: int, today: date | None = None) -> tuple[date, date]:
    """Inclusive local-date window that ends today (Morocco time)."""
    days = max(1, min(int(days or 5), 31))
    end = today or datetime.now(_LOCAL_TZ).date()
    return end - timedelta(days=days - 1), end


def _shopify_created_query(start: date, end: date) -> str:
    start_utc = datetime.combine(start, dtime.min, tzinfo=_LOCAL_TZ).astimezone(timezone.utc)
    end_utc = datetime.combine(end + timedelta(days=1), dtime.min, tzinfo=_LOCAL_TZ).astimezone(timezone.utc)
    fmt = "%Y-%m-%dT%H:%M:%SZ"
    return f"created_at:>={start_utc.strftime(fmt)} created_at:<{end_utc.strftime(fmt)}"


def crates_from_tags(tags: list[str] | None) -> int:
    """Same convention as Inventory Helper: a bare numeric tag is the crate count."""
    cleaned = [str(tag).strip() for tag in (tags or []) if str(tag).strip()]
    for tag in cleaned:
        if tag.isdigit():
            return int(tag)
    for tag in cleaned:
        match = re.search(r"(?i)(?:crates?|boxes?)\s*[:#x-]?\s*(\d+)|(\d+)\s*(?:crates?|boxes?)", tag)
        if match:
            return int(match.group(1) or match.group(2))
    return 0


def _numeric_id(gid: Any) -> str:
    match = re.search(r"(\d+)$", str(gid or ""))
    return match.group(1) if match else ""


def _variant_dimensions(options: list[dict] | None, title: str | None) -> tuple[str, str]:
    color = size = ""
    for option in options or []:
        name = str(option.get("name") or "").strip().casefold()
        value = str(option.get("value") or "").strip()
        if name in _COLOR_NAMES and value:
            color = value
        elif name in _SIZE_NAMES and value:
            size = value
    if not color and not size:
        parts = [p.strip() for p in str(title or "").split("/") if p.strip()]
        if len(parts) >= 2:
            color, size = parts[0], parts[-1]
        elif len(parts) == 1 and parts[0].lower() != "default title":
            size = parts[0]
    return color or "—", size or "—"


def _parse_created(value: Any) -> Optional[datetime]:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except ValueError:
        pass
    try:  # legacy Inventory Helper rows: MM/DD/YYYY
        return datetime.strptime(text[:10], "%m/%d/%Y").replace(tzinfo=_LOCAL_TZ)
    except ValueError:
        return None


def _in_period(value: Any, start: date, end: date) -> bool:
    created = _parse_created(value)
    if created is None:
        return False
    local_day = created.astimezone(_LOCAL_TZ).date()
    return start <= local_day <= end


def group_products(lines: list[dict]) -> list[dict]:
    """Collapse variant lines into per-product color × size quantity tables."""
    products: dict[str, dict] = {}
    for line in lines:
        pid = str(line.get("product_id") or "") or f"title:{line.get('title') or 'Untitled'}"
        product = products.setdefault(pid, {
            "product_id": str(line.get("product_id") or "") or None,
            "title": line.get("title") or "Untitled item",
            "image": line.get("image"),
            "quantity": 0,
            "sizes": [],
            "colors": [],
            "matrix": {},
        })
        qty = max(0, int(line.get("quantity") or 0))
        color, size = str(line.get("color") or "—"), str(line.get("size") or "—")
        product["quantity"] += qty
        if size not in product["sizes"]:
            product["sizes"].append(size)
        if color not in product["colors"]:
            product["colors"].append(color)
        row = product["matrix"].setdefault(color, {})
        row[size] = int(row.get(size, 0)) + qty
        if not product.get("image") and line.get("image"):
            product["image"] = line.get("image")
    return sorted(products.values(), key=lambda p: -p["quantity"])


# ---------------------------------------------------------------- Shopify

def _transfer_gql(store: str | None, query: str, variables: dict) -> dict:
    from app.integrations.shopify_client import _get_store_config

    cfg = _get_store_config(store)
    if not cfg.get("TOKEN"):
        raise RuntimeError("This Shopify store has no access token")
    url = f"https://{cfg['SHOP']}/admin/api/{_TRANSFER_API_VERSION}/graphql.json"
    response = requests.post(url, headers=cfg["HEADERS"], json={"query": query, "variables": variables}, timeout=30)
    response.raise_for_status()
    payload = response.json()
    if payload.get("errors"):
        text = str(payload["errors"])
        if "ACCESS_DENIED" in text.upper() or "access denied" in text.lower():
            raise PermissionError(
                "Shopify denied inventory-transfer access. Reconnect this store with the read_inventory_transfers scope."
            )
        raise RuntimeError(f"Shopify GraphQL error: {text[:300]}")
    return payload.get("data") or {}


def _transfer_lines(store: str | None, transfer_id: str) -> list[dict]:
    lines: list[dict] = []
    after: Optional[str] = None
    for _ in range(20):  # 2,000 variants per purchase order is far beyond real usage
        data = _transfer_gql(store, _TRANSFER_LINES_QUERY, {"id": transfer_id, "after": after})
        connection = ((data.get("inventoryTransfer") or {}).get("lineItems")) or {}
        for node in connection.get("nodes") or []:
            item = node.get("inventoryItem") or {}
            variant = item.get("variant") or {}
            product = variant.get("product") or {}
            image = ((((product.get("featuredMedia") or {}).get("preview")) or {}).get("image")) or {}
            color, size = _variant_dimensions(variant.get("selectedOptions"), variant.get("title"))
            lines.append({
                "product_id": _numeric_id(product.get("id")),
                "variant_id": _numeric_id(variant.get("id")),
                "title": product.get("title") or "Untitled item",
                "image": image.get("url"),
                "sku": item.get("sku"),
                "color": color,
                "size": size,
                "quantity": max(0, int(node.get("totalQuantity") or 0)),
            })
        page = connection.get("pageInfo") or {}
        after = page.get("endCursor")
        if not page.get("hasNextPage") or not after:
            break
    return lines


def _shopify_purchase_orders(store: str | None, start: date, end: date) -> list[dict]:
    transfers: list[dict] = []
    after: Optional[str] = None
    for _ in range(10):
        data = _transfer_gql(store, _TRANSFER_LIST_QUERY, {"query": _shopify_created_query(start, end), "after": after})
        connection = data.get("inventoryTransfers") or {}
        transfers.extend(connection.get("nodes") or [])
        page = connection.get("pageInfo") or {}
        after = page.get("endCursor")
        if not page.get("hasNextPage") or not after:
            break
    orders: list[dict] = []
    for transfer in transfers:
        if not _in_period(transfer.get("dateCreated"), start, end):
            continue
        lines = _transfer_lines(store, str(transfer.get("id")))
        status = str(transfer.get("status") or "").upper()
        destination = transfer.get("destination") or {}
        total = transfer.get("totalQuantity")
        orders.append({
            "id": transfer.get("id"),
            "name": transfer.get("referenceName") or transfer.get("name") or "Purchase order",
            "transfer_name": transfer.get("name"),
            "created_at": transfer.get("dateCreated"),
            "status": "open" if status in _OPEN_TRANSFER_STATUSES else "closed",
            "status_label": status.replace("_", " ").title() if status else "Unknown",
            "shopify_status": status or None,
            "total_items": max(0, int(total if total is not None else sum(l["quantity"] for l in lines))),
            "total_crates": crates_from_tags(transfer.get("tags")),
            "destination": ((destination.get("location") or {}).get("name")) or destination.get("name"),
            "received_items": None,
            "received_crates": None,
            "products": group_products(lines),
        })
    return orders


def _variant_product_ids(store: str | None, variant_gids: list[str]) -> dict[str, tuple[str, str]]:
    from app.integrations.shopify_client import _gql_store_once

    found: dict[str, tuple[str, str]] = {}
    ids = [gid for gid in dict.fromkeys(variant_gids) if gid]
    for offset in range(0, len(ids), 100):
        data = _gql_store_once(store, _VARIANT_PRODUCTS_QUERY, {"ids": ids[offset:offset + 100]}, timeout=30) or {}
        for node in data.get("nodes") or []:
            if node and node.get("id"):
                product = node.get("product") or {}
                found[str(node["id"])] = (_numeric_id(product.get("id")), product.get("title") or "")
    return found


# ---------------------------------------------------------- Inventory Helper

def _helper_config() -> dict | None:
    base = (os.getenv("INVENTORY_HELPER_API_URL") or "").strip().rstrip("/")
    token = (os.getenv("INVENTORY_HELPER_TOKEN") or "").strip()
    email = (os.getenv("INVENTORY_HELPER_EMAIL") or "").strip()
    password = os.getenv("INVENTORY_HELPER_PASSWORD") or ""
    if not base or not (token or (email and password)):
        return None
    return {"base": base, "token": token, "email": email, "password": password}


def _helper_bearer(cfg: dict, *, refresh: bool = False) -> str:
    if cfg["token"]:
        return cfg["token"]
    with _helper_lock:
        if not refresh and _helper_token["token"] and _helper_token["expires"] > time.time():
            return str(_helper_token["token"])
        response = requests.post(f"{cfg['base']}/api/auth/login", json={"email": cfg["email"], "password": cfg["password"]}, timeout=15)
        response.raise_for_status()
        token = str((response.json() or {}).get("access_token") or "")
        if not token:
            raise RuntimeError("Inventory Helper login returned no token")
        # Tokens are short-lived; refresh well before a typical expiry.
        _helper_token.update(token=token, expires=time.time() + 20 * 60)
        return token


def _helper_receipts(store: str) -> list[dict]:
    """All open receipts plus received history; filtered by date by the caller.

    Date parameters are intentionally omitted: with dates the Inventory Helper
    also syncs new queue cards, and this dashboard must stay read-only.
    """
    cfg = _helper_config()
    if not cfg:
        return []
    url = f"{cfg['base']}/api/inventory-helper/receipts"
    for attempt in range(2):
        headers = {"Authorization": f"Bearer {_helper_bearer(cfg, refresh=attempt > 0)}"}
        response = requests.get(url, params={"store": store}, headers=headers, timeout=25)
        if response.status_code == 401 and attempt == 0 and not cfg["token"]:
            continue
        response.raise_for_status()
        payload = response.json() or {}
        return [*(payload.get("receipts") or []), *(payload.get("history") or [])]
    return []


def _helper_purchase_order(receipt: dict, product_lookup: dict[str, tuple[str, str]]) -> dict:
    lines = []
    for item in receipt.get("line_items") or []:
        variant_gid = str(item.get("variant_id") or "")
        product_id, product_title = product_lookup.get(variant_gid, ("", ""))
        lines.append({
            "product_id": product_id,
            "title": product_title or item.get("title") or "Untitled item",
            "image": item.get("image_url"),
            "color": item.get("variant_color") or "—",
            "size": item.get("variant_size") or "—",
            "quantity": int(item.get("ordered_quantity") or item.get("shopify_quantity") or 0),
        })
    return {
        "id": receipt.get("shopify_order_gid"),
        "name": receipt.get("order_number") or "Purchase order",
        "transfer_name": receipt.get("po_number"),
        "created_at": receipt.get("shopify_created_at"),
        "status": "closed" if receipt.get("status") in _CLOSED_HELPER_STATUSES else "open",
        "status_label": str(receipt.get("status") or "new").title(),
        "shopify_status": None,
        "total_items": int(receipt.get("expected_items") or 0),
        "total_crates": int(receipt.get("ordered_crates") or 0),
        "destination": None,
        "received_items": receipt.get("reported_items_received", receipt.get("actual_items")),
        "received_crates": receipt.get("actual_crates"),
        "products": group_products(lines),
        "partial_lines": not receipt.get("shopify_details_loaded"),
    }


def apply_helper_state(orders: list[dict], receipts: list[dict]) -> None:
    by_gid = {str(r.get("shopify_order_gid")): r for r in receipts if r.get("shopify_order_gid")}
    for order in orders:
        receipt = by_gid.get(str(order.get("id")))
        if not receipt:
            continue
        helper_status = str(receipt.get("status") or "")
        order["status"] = "closed" if helper_status in _CLOSED_HELPER_STATUSES else "open"
        order["status_label"] = {"new": "New", "pending": "Receiving", "complete": "Received", "incomplete": "Received (incomplete)"}.get(helper_status, order["status_label"])
        order["helper_status"] = helper_status or None
        order["received_items"] = receipt.get("reported_items_received", receipt.get("actual_items"))
        order["received_crates"] = receipt.get("actual_crates")
        if receipt.get("ordered_crates"):
            order["total_crates"] = int(receipt["ordered_crates"])


# ------------------------------------------------------------------ public

def recent_purchase_orders(store: str | None, days: int = 5, *, use_cache: bool = True) -> dict:
    store_key = (store or "").strip().lower() or None
    days = max(1, min(int(days or 5), 31))
    cache_key = (store_key or "", days)
    if use_cache:
        with _cache_lock:
            hit = _cache.get(cache_key)
            if hit and hit[0] > time.time():
                return hit[1]
    start, end = period_for_days(days)
    errors: list[str] = []
    source = "shopify"
    orders: list[dict] = []
    shopify_ok = False
    try:
        orders = _shopify_purchase_orders(store_key, start, end)
        shopify_ok = True
    except Exception as exc:
        errors.append(str(exc) if isinstance(exc, PermissionError) else f"Shopify transfers unavailable: {exc}")
        logger.warning("purchase_orders.shopify_failed store=%s err=%s", store_key, exc)

    receipts: list[dict] = []
    if _helper_config() and store_key:
        try:
            receipts = [r for r in _helper_receipts(store_key)
                        if str(r.get("shopify_order_gid") or "").startswith("gid://shopify/InventoryTransfer/")
                        and _in_period(r.get("shopify_created_at"), start, end)]
        except Exception as exc:
            errors.append(f"Inventory Helper unavailable: {exc}")
            logger.warning("purchase_orders.helper_failed store=%s err=%s", store_key, exc)

    if shopify_ok:
        apply_helper_state(orders, receipts)
        if receipts:
            source = "shopify+inventory_helper"
    elif receipts:
        source = "inventory_helper"
        variant_gids = [str(i.get("variant_id") or "") for r in receipts for i in (r.get("line_items") or [])]
        try:
            lookup = _variant_product_ids(store_key, variant_gids)
        except Exception as exc:
            lookup = {}
            errors.append(f"Could not match purchase-order variants to products: {exc}")
        orders = [_helper_purchase_order(r, lookup) for r in receipts]

    orders.sort(key=lambda o: str(o.get("created_at") or ""), reverse=True)
    by_product: dict[str, list[str]] = {}
    for order in orders:
        for product in order.get("products") or []:
            if product.get("product_id"):
                by_product.setdefault(str(product["product_id"]), []).append(str(order.get("id")))
    result = {
        "store": store_key,
        "date_from": start.isoformat(),
        "date_to": end.isoformat(),
        "source": source if (shopify_ok or receipts) else None,
        "orders": orders,
        "by_product": by_product,
        "errors": errors,
    }
    if shopify_ok or receipts:
        with _cache_lock:
            _cache[cache_key] = (time.time() + _CACHE_TTL_S, result)
    return result


def purchase_orders_for_product(store: str | None, product_id: str, days: int = 5) -> list[dict]:
    """Compact per-product view used by the ads analyst."""
    data = recent_purchase_orders(store, days)
    out = []
    for order in data.get("orders") or []:
        product = next((p for p in order.get("products") or [] if str(p.get("product_id")) == str(product_id)), None)
        if not product:
            continue
        out.append({
            "name": order.get("name"),
            "created_at": order.get("created_at"),
            "status": order.get("status"),
            "status_label": order.get("status_label"),
            "po_total_items": order.get("total_items"),
            "po_total_crates": order.get("total_crates"),
            "this_product_items": product.get("quantity"),
            "this_product_matrix": product.get("matrix"),
        })
    return out


@router.get("")
async def api_recent_purchase_orders(store: str | None = None, days: int = 5, refresh: bool = False):
    try:
        data = await run_in_threadpool(recent_purchase_orders, store, days, use_cache=not refresh)
        if not data.get("source") and data.get("errors"):
            return {"error": data["errors"][0], "data": data}
        return {"data": data}
    except Exception as exc:
        logger.exception("purchase_orders.failed")
        return {"error": str(exc), "data": None}
