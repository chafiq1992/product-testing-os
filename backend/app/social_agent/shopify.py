from __future__ import annotations

import math
import time
from datetime import datetime
from typing import Any

import requests

from app.integrations.shopify_client import _gql_store
from app import db


CATALOG_QUERY = """
query SocialAgentCatalog($first: Int!, $after: String, $query: String!) {
  products(first: $first, after: $after, query: $query, sortKey: INVENTORY_TOTAL, reverse: true) {
    nodes {
      id title handle status totalInventory productType vendor tags descriptionHtml onlineStoreUrl
      featuredMedia {
        preview { image { url altText width height } }
      }
      media(first: 12) {
        nodes {
          mediaContentType
          preview { image { url altText width height } }
          ... on MediaImage { image { url altText width height } }
          ... on Video { sources { url mimeType format height width } }
        }
      }
      variants(first: 50) {
        nodes {
          id title price compareAtPrice inventoryQuantity availableForSale
          selectedOptions { name value }
        }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}
"""

STAGED_UPLOAD_CREATE = """
mutation SocialAgentStagedUpload($input: [StagedUploadInput!]!) {
  stagedUploadsCreate(input: $input) {
    stagedTargets { url resourceUrl parameters { name value } }
    userErrors { field message }
  }
}
"""

FILE_CREATE = """
mutation SocialAgentFileCreate($files: [FileCreateInput!]!) {
  fileCreate(files: $files) {
    files {
      id alt fileStatus
      ... on MediaImage { image { url width height } }
      ... on Video { sources { url mimeType format height width } }
      ... on GenericFile { url }
    }
    userErrors { field message }
  }
}
"""

FILE_NODE = """
query SocialAgentFileNode($id: ID!) {
  node(id: $id) {
    ... on MediaImage { id alt fileStatus image { url width height } }
    ... on Video { id alt fileStatus sources { url mimeType format height width } }
    ... on GenericFile { id alt fileStatus url }
  }
}
"""


def _number(value: Any) -> float | None:
    try:
        return float(value)
    except Exception:
        return None


def _strip_html(value: str) -> str:
    try:
        from bs4 import BeautifulSoup
        return BeautifulSoup(value or "", "html.parser").get_text(" ", strip=True)
    except Exception:
        return value or ""


def current_season(now: datetime | None = None) -> str:
    month = (now or datetime.utcnow()).month
    if month in (12, 1, 2):
        return "winter"
    if month in (3, 4, 5):
        return "spring"
    if month in (6, 7, 8, 9):
        return "summer"
    return "autumn"


SEASON_WORDS = {
    "summer": ("summer", "été", "ete", "صيف", "sandale", "maillot", "short", "léger", "leger"),
    "winter": ("winter", "hiver", "شتاء", "manteau", "pull", "chaud", "botte", "polaire"),
    "spring": ("spring", "printemps", "ربيع", "mi-saison", "léger", "leger"),
    "autumn": ("autumn", "fall", "automne", "خريف", "mi-saison", "veste"),
}


def _normalize_product(node: dict[str, Any]) -> dict[str, Any]:
    variants = ((node.get("variants") or {}).get("nodes") or [])
    prices = [x for x in (_number(v.get("price")) for v in variants) if x is not None]
    compares = [x for x in (_number(v.get("compareAtPrice")) for v in variants) if x is not None]
    media_nodes = ((node.get("media") or {}).get("nodes") or [])
    images: list[dict[str, Any]] = []
    videos: list[dict[str, Any]] = []
    for media in media_nodes:
        image = media.get("image") or ((media.get("preview") or {}).get("image"))
        if isinstance(image, dict) and image.get("url"):
            item = {
                "url": image.get("url"), "alt": image.get("altText"),
                "width": image.get("width"), "height": image.get("height"),
            }
            if item not in images:
                images.append(item)
        for source in media.get("sources") or []:
            if isinstance(source, dict) and source.get("url"):
                videos.append(source)
    featured = (((node.get("featuredMedia") or {}).get("preview") or {}).get("image")) or {}
    if featured.get("url") and not any(x.get("url") == featured.get("url") for x in images):
        images.insert(0, {
            "url": featured.get("url"), "alt": featured.get("altText"),
            "width": featured.get("width"), "height": featured.get("height"),
        })
    inventory = max(0, int(node.get("totalInventory") or 0))
    price = min(prices) if prices else None
    compare_at = max(compares) if compares else None
    discount_percent = 0
    if price is not None and compare_at and compare_at > price:
        discount_percent = int(round((compare_at - price) / compare_at * 100))
    return {
        "id": node.get("id"), "title": node.get("title"), "handle": node.get("handle"),
        "status": node.get("status"), "inventory": inventory,
        "product_type": node.get("productType") or "", "vendor": node.get("vendor") or "",
        "tags": node.get("tags") or [], "description": _strip_html(node.get("descriptionHtml") or "")[:1800],
        "url": node.get("onlineStoreUrl") or "", "price": price, "compare_at_price": compare_at,
        "discount_percent": discount_percent, "currency": "MAD", "images": images, "videos": videos,
        "variants": variants[:20],
    }


def list_active_products(store: str | None, first: int = 80) -> list[dict[str, Any]]:
    """Load the complete active catalog, one Shopify connection page at a time.

    ``first`` is retained as the page-size hint for callers and tests; it is no
    longer a total-product cap. A hard page guard prevents a malformed Shopify
    cursor from creating an unbounded loop.
    """
    page_size = max(10, min(first, 100))
    after: str | None = None
    products: list[dict[str, Any]] = []
    seen_cursors: set[str] = set()
    for _ in range(100):
        data = _gql_store(store, CATALOG_QUERY, {
            "first": page_size, "after": after, "query": "status:active",
        })
        connection = ((data or {}).get("products") or {})
        products.extend(
            _normalize_product(node)
            for node in connection.get("nodes") or []
            if isinstance(node, dict)
        )
        page_info = connection.get("pageInfo") or {}
        cursor = str(page_info.get("endCursor") or "")
        if not page_info.get("hasNextPage"):
            break
        if not cursor or cursor in seen_cursors:
            raise RuntimeError("Shopify catalog pagination returned an invalid cursor")
        seen_cursors.add(cursor)
        after = cursor
    else:
        raise RuntimeError("Shopify active catalog exceeded the 10,000-product safety limit")
    return products


def upload_capability(store: str | None) -> dict[str, Any]:
    """Report whether the connected Shopify store can host generated assets."""
    label = (store or "").strip().lower()
    if label == "nouralibas":
        label = "irrakids"
    record = db.get_app_setting(label or "default", "shopify_oauth") or {}
    scopes = {
        value.strip().lower()
        for value in str(record.get("scopes") or "").replace(" ", ",").split(",")
        if value.strip()
    }
    ready = "write_files" in scopes
    return {
        "ready": ready,
        "required_scope": "write_files",
        "reason": None if ready else "Reconnect Shopify and approve the write_files scope for generated social images.",
    }


def rank_products(
    products: list[dict[str, Any]], *, season: str, minimum_inventory: int,
    recent_ids: set[str] | None = None,
) -> list[dict[str, Any]]:
    recent_ids = recent_ids or set()
    eligible = [
        p for p in products
        if str(p.get("status") or "").upper() == "ACTIVE"
        and int(p.get("inventory") or 0) >= minimum_inventory
        and bool(p.get("images"))
        and bool(p.get("url"))
    ]
    max_inventory = max([int(p.get("inventory") or 0) for p in eligible] or [1])
    words = SEASON_WORDS.get(season, ())
    ranked: list[dict[str, Any]] = []
    for product in eligible:
        searchable = " ".join([
            str(product.get("title") or ""), str(product.get("product_type") or ""),
            " ".join(str(x) for x in product.get("tags") or []), str(product.get("description") or "")[:600],
        ]).lower()
        season_hits = sum(1 for word in words if word in searchable)
        explicit_other = max(
            [sum(1 for word in values if word in searchable) for key, values in SEASON_WORDS.items() if key != season]
            or [0]
        )
        season_score = 1.0 if season_hits else (0.45 if not explicit_other else 0.05)
        inventory_score = math.log1p(int(product.get("inventory") or 0)) / math.log1p(max_inventory)
        media_score = min(1.0, 0.55 + len(product.get("images") or []) * 0.1 + (0.15 if product.get("videos") else 0))
        offer_score = 1.0 if int(product.get("discount_percent") or 0) > 0 else 0.35
        rotation_score = 0.0 if str(product.get("id")) in recent_ids else 1.0
        score = 0.38 * inventory_score + 0.28 * season_score + 0.14 * media_score + 0.08 * offer_score + 0.12 * rotation_score
        item = dict(product)
        item["ranking"] = {
            "score": round(score * 100, 1), "season": season,
            "inventory_score": round(inventory_score * 100, 1),
            "season_score": round(season_score * 100, 1),
            "media_score": round(media_score * 100, 1),
            "rotation_score": round(rotation_score * 100, 1),
        }
        ranked.append(item)
    ranked.sort(key=lambda p: (float((p.get("ranking") or {}).get("score") or 0), int(p.get("inventory") or 0)), reverse=True)
    return ranked


def upload_file_bytes(
    store: str | None, *, filename: str, content: bytes, mime_type: str,
    alt_text: str, content_type: str = "IMAGE", timeout_seconds: int = 90,
) -> dict[str, Any]:
    resource = "VIDEO" if content_type == "VIDEO" else "IMAGE"
    upload_input: dict[str, Any] = {
        "filename": filename, "mimeType": mime_type, "httpMethod": "POST", "resource": resource,
    }
    if resource == "VIDEO":
        upload_input["fileSize"] = str(len(content))
    staged_data = _gql_store(store, STAGED_UPLOAD_CREATE, {"input": [upload_input]})
    staged = (staged_data or {}).get("stagedUploadsCreate") or {}
    if staged.get("userErrors"):
        raise RuntimeError(f"Shopify staged upload error: {staged['userErrors']}")
    target = (staged.get("stagedTargets") or [None])[0]
    if not isinstance(target, dict):
        raise RuntimeError("Shopify did not return a staged upload target")
    form = {str(x.get("name")): str(x.get("value")) for x in target.get("parameters") or [] if x.get("name")}
    response = requests.post(
        str(target.get("url")), data=form,
        files={"file": (filename, content, mime_type)}, timeout=timeout_seconds,
    )
    response.raise_for_status()
    created_data = _gql_store(store, FILE_CREATE, {"files": [{
        "alt": alt_text[:500], "contentType": content_type,
        "originalSource": target.get("resourceUrl"),
    }]})
    payload = (created_data or {}).get("fileCreate") or {}
    if payload.get("userErrors"):
        raise RuntimeError(f"Shopify fileCreate error: {payload['userErrors']}")
    item = (payload.get("files") or [None])[0]
    if not isinstance(item, dict) or not item.get("id"):
        raise RuntimeError("Shopify did not create the social asset")
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        current = ((_gql_store(store, FILE_NODE, {"id": item["id"]}) or {}).get("node") or {})
        status = str(current.get("fileStatus") or "").upper()
        image = current.get("image") or {}
        sources = current.get("sources") or []
        url = image.get("url") or current.get("url") or (sources[0].get("url") if sources else None)
        if status == "READY" and url:
            return {"id": current.get("id"), "status": status, "url": url, "alt": current.get("alt"), "content_type": content_type}
        if status in {"FAILED", "ERROR"}:
            raise RuntimeError(f"Shopify file processing failed with status {status}")
        time.sleep(2)
    raise RuntimeError("Timed out while Shopify processed the social asset")
