from __future__ import annotations

import os
import re
import time
from typing import Any

from app.integrations.meta_client import _timed_meta_request


def _suffix(store: str | None) -> str:
    value = re.sub(r"[^A-Za-z0-9]", "_", (store or "").strip().upper())
    return f"_{value}" if value else ""


def _credentials(store: str | None) -> dict[str, str]:
    suffix = _suffix("irrakids" if (store or "").strip().lower() == "nouralibas" else store)
    page_token = os.getenv(f"META_PAGE_ACCESS_TOKEN{suffix}", "") or os.getenv("META_PAGE_ACCESS_TOKEN", "")
    token = page_token or os.getenv(f"META_ACCESS_TOKEN{suffix}", "") or os.getenv("META_ACCESS_TOKEN", "")
    page_id = os.getenv(f"META_PAGE_ID{suffix}", "") or os.getenv("META_PAGE_ID", "")
    instagram_id = os.getenv(f"META_INSTAGRAM_ACCOUNT_ID{suffix}", "") or os.getenv("META_INSTAGRAM_ACCOUNT_ID", "")
    version = os.getenv("META_API_VERSION", "v23.0")
    if not token:
        raise RuntimeError("META_ACCESS_TOKEN (or META_PAGE_ACCESS_TOKEN) is not configured")
    if not page_id:
        raise RuntimeError("META_PAGE_ID is not configured")
    return {
        "token": token, "page_id": page_id, "instagram_id": instagram_id,
        "version": version, "explicit_page_token": "1" if page_token else "0",
    }


def _call(method: str, cfg: dict[str, str], path: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    data = dict(payload or {})
    data["access_token"] = cfg["token"]
    url = f"https://graph.facebook.com/{cfg['version']}/{path.lstrip('/')}"
    response = _timed_meta_request(method.upper(), url, data=data if method.upper() == "POST" else None, params=data if method.upper() == "GET" else None, timeout=120)
    try:
        body = response.json()
    except Exception:
        body = {"raw": response.text[:1000]}
    if response.status_code >= 400 or (isinstance(body, dict) and body.get("error")):
        error = body.get("error") if isinstance(body, dict) else None
        message = error.get("message") if isinstance(error, dict) else str(body)
        code = error.get("code") if isinstance(error, dict) else response.status_code
        raise RuntimeError(f"Meta API error {code}: {message}")
    return body if isinstance(body, dict) else {}


def _page_credentials(store: str | None) -> dict[str, str]:
    """Resolve a Page access token without persisting or exposing it.

    Meta's Page and Instagram publishing endpoints expect the Page credential
    returned by ``/me/accounts`` when the configured secret is a user token.
    System-user and already-configured Page tokens continue to work as-is.
    """
    cfg = _credentials(store)
    if cfg.get("explicit_page_token") == "1":
        return cfg
    try:
        accounts = _call("GET", cfg, "me/accounts", {
            "fields": "id,access_token,instagram_business_account{id}", "limit": 100,
        })
        for account in accounts.get("data") or []:
            if str(account.get("id") or "") != cfg["page_id"]:
                continue
            access_token = str(account.get("access_token") or "")
            if access_token:
                cfg["token"] = access_token
            instagram = account.get("instagram_business_account") or {}
            if not cfg.get("instagram_id") and instagram.get("id"):
                cfg["instagram_id"] = str(instagram["id"])
            break
    except Exception:
        # A Page/system-user token might not have a meaningful /me/accounts
        # edge. The direct token remains the correct fallback in that case.
        pass
    return cfg


def connection(store: str | None) -> dict[str, Any]:
    cfg = _page_credentials(store)
    page = _call("GET", cfg, cfg["page_id"], {"fields": "id,name,instagram_business_account{id,username,name,profile_picture_url}"})
    instagram = page.get("instagram_business_account") or {}
    if not cfg.get("instagram_id") and instagram.get("id"):
        cfg["instagram_id"] = str(instagram["id"])
    return {
        "page": {"id": page.get("id"), "name": page.get("name")},
        "instagram": instagram,
        "ready": bool(page.get("id") and cfg.get("instagram_id")),
    }


def _instagram_id(cfg: dict[str, str]) -> str:
    if cfg.get("instagram_id"):
        return cfg["instagram_id"]
    page = _call("GET", cfg, cfg["page_id"], {"fields": "instagram_business_account{id}"})
    value = ((page.get("instagram_business_account") or {}).get("id"))
    if not value:
        raise RuntimeError("The configured Facebook Page has no connected Instagram professional account")
    return str(value)


def publish_facebook_image(store: str | None, *, image_url: str, caption: str) -> dict[str, Any]:
    cfg = _page_credentials(store)
    facebook = _call("POST", cfg, f"{cfg['page_id']}/photos", {
        "url": image_url, "caption": caption, "published": "true",
    })
    return {"id": facebook.get("post_id") or facebook.get("id"), "photo_id": facebook.get("id")}


def publish_instagram_image(store: str | None, *, image_url: str, caption: str, alt_text: str) -> dict[str, Any]:
    cfg = _page_credentials(store)
    ig_id = _instagram_id(cfg)
    container = _call("POST", cfg, f"{ig_id}/media", {
        "image_url": image_url, "caption": caption,
        "accessibility_caption": alt_text[:1000],
    })
    creation_id = str(container.get("id") or "")
    if not creation_id:
        raise RuntimeError("Instagram did not create a media container")
    instagram = _call("POST", cfg, f"{ig_id}/media_publish", {"creation_id": creation_id})
    return {"id": instagram.get("id"), "container_id": creation_id}


def publish_image(store: str | None, *, image_url: str, caption: str, alt_text: str) -> dict[str, Any]:
    facebook = publish_facebook_image(store, image_url=image_url, caption=caption)
    instagram = publish_instagram_image(store, image_url=image_url, caption=caption, alt_text=alt_text)
    return {
        "facebook": facebook,
        "instagram": instagram,
    }


def publish_video(store: str | None, *, video_url: str, caption: str) -> dict[str, Any]:
    cfg = _page_credentials(store)
    facebook = _call("POST", cfg, f"{cfg['page_id']}/videos", {"file_url": video_url, "description": caption})
    ig_id = _instagram_id(cfg)
    container = _call("POST", cfg, f"{ig_id}/media", {
        "media_type": "REELS", "video_url": video_url, "caption": caption, "share_to_feed": "true",
    })
    creation_id = str(container.get("id") or "")
    deadline = time.time() + 300
    while time.time() < deadline:
        state = _call("GET", cfg, creation_id, {"fields": "status_code,status"})
        status = str(state.get("status_code") or "").upper()
        if status == "FINISHED":
            break
        if status in {"ERROR", "EXPIRED"}:
            raise RuntimeError(f"Instagram reel processing failed: {state.get('status') or status}")
        time.sleep(5)
    else:
        raise RuntimeError("Instagram reel processing timed out")
    instagram = _call("POST", cfg, f"{ig_id}/media_publish", {"creation_id": creation_id})
    return {
        "facebook": {"id": facebook.get("id")},
        "instagram": {"id": instagram.get("id"), "container_id": creation_id},
    }


def _summary_count(value: Any) -> int:
    try:
        return int((((value or {}).get("summary") or {}).get("total_count")) or 0)
    except Exception:
        return 0


def collect_post_metrics(store: str | None, platforms: dict[str, Any]) -> dict[str, Any]:
    cfg = _page_credentials(store)
    result: dict[str, Any] = {"facebook": {}, "instagram": {}}
    fb_id = str(((platforms.get("facebook") or {}).get("id")) or "")
    if fb_id:
        base = _call("GET", cfg, fb_id, {"fields": "created_time,permalink_url,shares,comments.limit(0).summary(true),likes.limit(0).summary(true),reactions.limit(0).summary(true)"})
        fb = {
            "likes": _summary_count(base.get("likes")), "comments": _summary_count(base.get("comments")),
            "reactions": _summary_count(base.get("reactions")), "shares": int((base.get("shares") or {}).get("count") or 0),
            "permalink": base.get("permalink_url"),
        }
        for metric in ("post_impressions_unique", "post_engaged_users", "post_clicks"):
            try:
                insight = _call("GET", cfg, f"{fb_id}/insights", {"metric": metric, "period": "lifetime"})
                rows = insight.get("data") or []
                values = (rows[0].get("values") if rows else []) or []
                fb[metric] = int((values[-1].get("value") if values else 0) or 0)
            except Exception:
                continue
        fb["reach"] = int(fb.get("post_impressions_unique") or 0)
        fb["interactions"] = fb["reactions"] + fb["comments"] + fb["shares"]
        result["facebook"] = fb
    ig_id = str(((platforms.get("instagram") or {}).get("id")) or "")
    if ig_id:
        base = _call("GET", cfg, ig_id, {"fields": "timestamp,permalink,like_count,comments_count,media_type,media_product_type"})
        ig = {
            "likes": int(base.get("like_count") or 0), "comments": int(base.get("comments_count") or 0),
            "permalink": base.get("permalink"), "media_type": base.get("media_type"),
        }
        for metric in ("reach", "saved", "shares", "total_interactions", "views"):
            try:
                insight = _call("GET", cfg, f"{ig_id}/insights", {"metric": metric})
                rows = insight.get("data") or []
                value = (rows[0].get("values") or [{}])[-1].get("value") if rows else 0
                ig[metric] = int(value or 0)
            except Exception:
                continue
        ig["interactions"] = int(ig.get("total_interactions") or (ig["likes"] + ig["comments"] + int(ig.get("saved") or 0) + int(ig.get("shares") or 0)))
        result["instagram"] = ig
    reach = int((result["facebook"] or {}).get("reach") or 0) + int((result["instagram"] or {}).get("reach") or 0)
    interactions = int((result["facebook"] or {}).get("interactions") or 0) + int((result["instagram"] or {}).get("interactions") or 0)
    clicks = int((result["facebook"] or {}).get("post_clicks") or 0)
    result["totals"] = {
        "reach": reach, "interactions": interactions, "clicks": clicks,
        "engagement_rate": round(interactions / reach * 100, 2) if reach else 0,
        "click_rate": round(clicks / reach * 100, 2) if reach else 0,
    }
    return result
