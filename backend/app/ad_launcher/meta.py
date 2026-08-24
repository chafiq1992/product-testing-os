from __future__ import annotations

import ipaddress
import json
import os
import re
import time
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

import requests

from app.ad_launcher.models import PreparedAdSet, PreparedCampaign


def _suffix(store: str | None) -> str:
    value = re.sub(r"[^A-Z0-9]", "_", str(store or "").upper()).strip("_")
    return f"_{value}" if value else ""


def _env(name: str, store: str | None, default: str = "") -> str:
    suffix = _suffix(store)
    return str((os.getenv(f"{name}{suffix}") if suffix else None) or os.getenv(name, default) or "").strip()


def _account_id(value: str | None) -> str:
    normalized = str(value or "").strip().removeprefix("act_")
    return normalized if re.fullmatch(r"\d+", normalized) else ""


def _config(store: str | None, ad_account_id: str | None = None) -> dict[str, str]:
    account = _account_id(ad_account_id) or _account_id(_env("META_AD_ACCOUNT_ID", store))
    return {
        "access_token": _env("META_ACCESS_TOKEN", store),
        "ad_account_id": account,
        "page_id": _env("META_PAGE_ID", store),
        "instagram_actor_id": _env("META_INSTAGRAM_ACCOUNT_ID", store),
        "pixel_id": _env("META_PIXEL_ID", store),
        "api_version": _env("AD_LAUNCHER_META_API_VERSION", store, "v26.0"),
    }


def _safe_error(response: requests.Response, path: str) -> RuntimeError:
    try:
        error = (response.json() or {}).get("error") or {}
        message = error.get("error_user_msg") or error.get("message") or response.text
        code = error.get("code")
        subcode = error.get("error_subcode")
        details = ", ".join(part for part in [f"code {code}" if code else "", f"subcode {subcode}" if subcode else ""] if part)
        return RuntimeError(f"Meta API rejected {path}: {message}{f' ({details})' if details else ''}")
    except Exception:
        return RuntimeError(f"Meta API rejected {path}: HTTP {response.status_code}")


def _request(method: str, cfg: dict[str, str], path: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    url = f"https://graph.facebook.com/{cfg['api_version']}/{path.lstrip('/')}"
    values = {**(payload or {}), "access_token": cfg["access_token"]}
    kwargs: dict[str, Any] = {"timeout": 120}
    if method.upper() == "GET":
        kwargs["params"] = values
    else:
        kwargs["data"] = values
    response = requests.request(method.upper(), url, **kwargs)
    if not response.ok:
        raise _safe_error(response, path)
    try:
        value = response.json()
        return value if isinstance(value, dict) else {"data": value}
    except Exception as error:
        raise RuntimeError(f"Meta API returned invalid JSON for {path}") from error


def _require_config(store: str | None, ad_account_id: str | None = None) -> dict[str, str]:
    cfg = _config(store, ad_account_id)
    missing = [
        name for name, value in (
            ("META_ACCESS_TOKEN", cfg["access_token"]),
            ("META_AD_ACCOUNT_ID", cfg["ad_account_id"]),
            ("META_PAGE_ID", cfg["page_id"]),
            ("META_PIXEL_ID", cfg["pixel_id"]),
        ) if not value
    ]
    if missing:
        raise RuntimeError("Missing Meta configuration: " + ", ".join(missing))
    return cfg


def _available_ad_accounts(cfg: dict[str, str]) -> list[dict[str, Any]]:
    result = _request("GET", cfg, "me/adaccounts", {
        "fields": "id,name,account_status,currency,timezone_name",
        "limit": "200",
    })
    accounts: list[dict[str, Any]] = []
    for raw in result.get("data") or []:
        if not isinstance(raw, dict):
            continue
        account_id = _account_id(str(raw.get("id") or ""))
        if not account_id:
            continue
        accounts.append({
            "id": f"act_{account_id}",
            "account_id": account_id,
            "name": str(raw.get("name") or f"Ad account {account_id}"),
            "account_status": raw.get("account_status"),
            "currency": str(raw.get("currency") or "").upper(),
            "timezone_name": raw.get("timezone_name"),
        })
    return accounts


def connection(store: str | None, ad_account_id: str | None = None) -> dict[str, Any]:
    cfg = _config(store, ad_account_id)
    missing = [
        name for name, value in (
            ("META_ACCESS_TOKEN", cfg["access_token"]),
            ("META_AD_ACCOUNT_ID", cfg["ad_account_id"]),
            ("META_PAGE_ID", cfg["page_id"]),
            ("META_PIXEL_ID", cfg["pixel_id"]),
        ) if not value
    ]
    accounts: list[dict[str, Any]] = []
    discovery_error: str | None = None
    if cfg["access_token"]:
        try:
            accounts = _available_ad_accounts(cfg)
        except Exception as error:
            discovery_error = str(error)
    if not cfg["ad_account_id"] and accounts:
        preferred = next(
            (
                item for item in accounts
                if str(item.get("account_status") or "") in {"1", "ACTIVE"}
                and str(item.get("currency") or "").upper() == "USD"
            ),
            accounts[0],
        )
        cfg["ad_account_id"] = str(preferred.get("account_id") or "")
    if cfg["ad_account_id"]:
        missing = [name for name in missing if name != "META_AD_ACCOUNT_ID"]
    if not cfg["ad_account_id"] and "META_AD_ACCOUNT_ID" not in missing:
        missing.append("META_AD_ACCOUNT_ID")
    if missing:
        return {
            "ready": False,
            "missing": missing,
            "api_version": cfg["api_version"],
            "accounts": accounts,
            "selected_account_id": cfg["ad_account_id"] or None,
            "error": discovery_error,
        }
    try:
        account = _request("GET", cfg, f"act_{cfg['ad_account_id']}", {
            "fields": "id,name,account_status,currency,timezone_name",
        })
        selected_id = _account_id(str(account.get("id") or cfg["ad_account_id"]))
        if selected_id and not any(item.get("account_id") == selected_id for item in accounts):
            accounts.append({
                "id": f"act_{selected_id}",
                "account_id": selected_id,
                "name": str(account.get("name") or f"Ad account {selected_id}"),
                "account_status": account.get("account_status"),
                "currency": str(account.get("currency") or "").upper(),
                "timezone_name": account.get("timezone_name"),
            })
        active = bool(str(account.get("account_status") or "") in {"1", "ACTIVE"})
        currency = str(account.get("currency") or "").upper()
        return {
            "ready": bool(active and currency == "USD"),
            "missing": [],
            "api_version": cfg["api_version"],
            "account": account,
            "accounts": accounts,
            "selected_account_id": selected_id,
            "page_id": cfg["page_id"],
            "pixel_configured": bool(cfg["pixel_id"]),
            "error": (
                None if active and currency == "USD"
                else "The Meta account must be active and denominated in USD for the configured launcher budget"
            ),
        }
    except Exception as error:
        return {
            "ready": False,
            "missing": [],
            "api_version": cfg["api_version"],
            "accounts": accounts,
            "selected_account_id": cfg["ad_account_id"] or None,
            "error": str(error),
        }


def _append_utm(url: str, campaign_id: str, adset_index: int, angle: str) -> str:
    parsed = urlparse(url)
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    query.update({
        "utm_source": "meta",
        "utm_medium": "paid_social",
        "utm_campaign": campaign_id,
        "utm_content": f"adset_{adset_index}_{re.sub(r'[^a-z0-9]+', '_', angle.lower())[:50]}",
    })
    return urlunparse(parsed._replace(query=urlencode(query)))


def _require_public_media(plan: PreparedCampaign) -> None:
    for adset in plan.adsets:
        for value in adset.media_urls:
            parsed = urlparse(value)
            host = str(parsed.hostname or "").lower()
            invalid_host = not host or host == "localhost" or host.endswith(".localhost")
            try:
                invalid_host = invalid_host or ipaddress.ip_address(host).is_private
            except ValueError:
                pass
            if parsed.scheme != "https" or invalid_host:
                raise RuntimeError(
                    "Live Meta launch requires every creative to have a public HTTPS media URL; configure BASE_URL "
                    "to the deployed backend before preparing the campaign"
                )


def _targeting(plan: PreparedCampaign) -> dict[str, Any]:
    audience = plan.audience
    targeting: dict[str, Any] = {
        "geo_locations": {"countries": audience.country_codes},
        "age_min": audience.age_min,
        "age_max": audience.age_max,
        "targeting_automation": {"advantage_audience": 0},
        # Manual, common-denominator placements keep all image/video/carousel tests comparable.
        "publisher_platforms": ["facebook", "instagram"],
        "facebook_positions": ["feed"],
        "instagram_positions": ["stream"],
    }
    if audience.gender == "women":
        targeting["genders"] = [2]
    elif audience.gender == "men":
        targeting["genders"] = [1]
    return targeting


def _feature_opt_outs(media_type: str) -> dict[str, dict[str, str]]:
    common = [
        "advantage_plus_creative", "description_automation", "media_order", "media_type_automation",
        "product_extensions", "product_tags", "text_generation", "text_optimizations",
    ]
    image = [
        "image_auto_crop", "image_background_gen", "image_enhancement", "image_templates",
        "image_touchups", "image_uncrop",
    ]
    video = ["audio", "video_auto_crop", "video_filtering", "video_highlight"]
    carousel = ["carousel_to_video"]
    defaults = common + (image if media_type == "image" else video if media_type == "video" else carousel)
    configured = [
        item.strip() for item in os.getenv("META_CREATIVE_FEATURE_OPT_OUTS", ",".join(defaults)).split(",") if item.strip()
    ]
    return {name: {"enroll_status": "OPT_OUT"} for name in configured}


def _upload_image(cfg: dict[str, str], url: str) -> str:
    result = _request("POST", cfg, f"act_{cfg['ad_account_id']}/adimages", {"url": url})
    images = result.get("images") or {}
    item = next(iter(images.values()), None) if isinstance(images, dict) else None
    image_hash = str((item or {}).get("hash") or "")
    if not image_hash:
        raise RuntimeError("Meta did not return an image hash")
    return image_hash


def _upload_video(cfg: dict[str, str], url: str, title: str) -> str:
    result = _request("POST", cfg, f"act_{cfg['ad_account_id']}/advideos", {
        "file_url": url,
        "title": title[:200],
    })
    video_id = str(result.get("id") or "")
    if not video_id:
        raise RuntimeError("Meta did not return a video ID")
    deadline = time.time() + int(os.getenv("META_VIDEO_PROCESSING_TIMEOUT_S", "180") or "180")
    while time.time() < deadline:
        value = _request("GET", cfg, video_id, {"fields": "status"})
        status = value.get("status") or {}
        state = str(status.get("video_status") or status.get("processing_phase") or status or "").lower()
        if any(word in state for word in ("ready", "complete", "published")):
            return video_id
        if any(word in state for word in ("error", "failed")):
            raise RuntimeError(f"Meta failed to process uploaded video: {status}")
        time.sleep(3)
    raise RuntimeError("Timed out while Meta processed the uploaded video")


def _story_spec(cfg: dict[str, str], adset: PreparedAdSet, landing_url: str) -> dict[str, Any]:
    identity: dict[str, Any] = {"page_id": cfg["page_id"]}
    if cfg.get("instagram_actor_id"):
        identity["instagram_actor_id"] = cfg["instagram_actor_id"]
    cta = {"type": adset.call_to_action, "value": {"link": landing_url}}
    if adset.media_type == "image":
        image_hash = _upload_image(cfg, adset.media_urls[0])
        identity["link_data"] = {
            "image_hash": image_hash,
            "link": landing_url,
            "message": adset.primary_text_ar,
            "name": adset.headline_ar,
            "description": adset.description_ar,
            "call_to_action": cta,
        }
    elif adset.media_type == "video":
        video_id = _upload_video(cfg, adset.media_urls[0], adset.name)
        identity["video_data"] = {
            "video_id": video_id,
            "message": adset.primary_text_ar,
            "title": adset.headline_ar,
            "link_description": adset.description_ar,
            "call_to_action": cta,
        }
    else:
        children: list[dict[str, Any]] = []
        for url in adset.media_urls:
            children.append({
                "image_hash": _upload_image(cfg, url),
                "link": landing_url,
                "name": adset.headline_ar,
                "description": adset.description_ar,
                "call_to_action": cta,
            })
        identity["link_data"] = {
            "message": adset.primary_text_ar,
            "link": landing_url,
            "child_attachments": children,
            "multi_share_optimized": False,
            "multi_share_end_card": False,
        }
    return identity


def _budget_minor(total_usd: float, count: int) -> list[int]:
    total = int(round(total_usd * 100))
    if total < count * 100:
        raise ValueError("The total budget is below Meta's $1.00-per-ad-set safety floor")
    base, remainder = divmod(total, count)
    return [base + (1 if index < remainder else 0) for index in range(count)]


def create_sales_test_campaign(plan: PreparedCampaign) -> dict[str, Any]:
    _require_public_media(plan)
    cfg = _require_config(plan.store, plan.meta_ad_account_id)
    account = _request("GET", cfg, f"act_{cfg['ad_account_id']}", {
        "fields": "id,name,account_status,currency,timezone_name",
    })
    if str(account.get("account_status") or "") not in {"1", "ACTIVE"}:
        raise RuntimeError("The selected Meta ad account is not active")
    currency = str(account.get("currency") or "").upper()
    if currency != "USD":
        raise RuntimeError(
            f"This plan is denominated in USD, but the Meta ad account currency is {currency or 'unknown'}. "
            "Configure a USD ad account or add an explicit reviewed currency conversion before launch."
        )

    requests_log: list[dict[str, Any]] = []
    campaign_payload = {
        "name": plan.campaign_name,
        "objective": "OUTCOME_SALES",
        "buying_type": "AUCTION",
        "special_ad_categories": json.dumps([]),
        "status": "PAUSED",
        "is_adset_budget_sharing_enabled": "false",
    }
    campaign = _request("POST", cfg, f"act_{cfg['ad_account_id']}/campaigns", campaign_payload)
    campaign_id = str(campaign.get("id") or "")
    if not campaign_id:
        raise RuntimeError("Meta did not return a campaign ID")
    requests_log.append({"edge": "campaigns", "id": campaign_id, "status": "PAUSED"})

    budgets = _budget_minor(plan.total_daily_budget_usd, len(plan.adsets))
    created: list[dict[str, Any]] = []
    targeting = _targeting(plan)
    try:
        for index, (adset_plan, budget) in enumerate(zip(plan.adsets, budgets), start=1):
            adset_payload = {
                "name": adset_plan.name,
                "campaign_id": campaign_id,
                "daily_budget": str(budget),
                "billing_event": "IMPRESSIONS",
                "optimization_goal": "OFFSITE_CONVERSIONS",
                "bid_strategy": "LOWEST_COST_WITHOUT_CAP",
                "promoted_object": json.dumps({"pixel_id": cfg["pixel_id"], "custom_event_type": "PURCHASE"}),
                "destination_type": "WEBSITE",
                "is_dynamic_creative": "false",
                "targeting": json.dumps(targeting),
                "attribution_spec": json.dumps([
                    {"event_type": "CLICK_THROUGH", "window_days": 7},
                    {"event_type": "VIEW_THROUGH", "window_days": 1},
                ]),
                "start_time": plan.scheduled_start,
                "status": "PAUSED",
            }
            adset = _request("POST", cfg, f"act_{cfg['ad_account_id']}/adsets", adset_payload)
            adset_id = str(adset.get("id") or "")
            if not adset_id:
                raise RuntimeError(f"Meta did not return an ID for ad set {index}")

            destination = _append_utm(plan.landing_url, campaign_id, index, adset_plan.angle)
            story = _story_spec(cfg, adset_plan, destination)
            creative_payload = {
                "name": f"{adset_plan.name} Creative",
                "object_story_spec": json.dumps(story, ensure_ascii=False),
                "degrees_of_freedom_spec": json.dumps({
                    "creative_features_spec": _feature_opt_outs(adset_plan.media_type),
                }),
            }
            creative = _request("POST", cfg, f"act_{cfg['ad_account_id']}/adcreatives", creative_payload)
            creative_id = str(creative.get("id") or "")
            if not creative_id:
                raise RuntimeError(f"Meta did not return a creative ID for ad set {index}")

            ad = _request("POST", cfg, f"act_{cfg['ad_account_id']}/ads", {
                "name": f"{adset_plan.name} Ad",
                "adset_id": adset_id,
                "creative": json.dumps({"creative_id": creative_id}),
                "status": "PAUSED",
            })
            ad_id = str(ad.get("id") or "")
            if not ad_id:
                raise RuntimeError(f"Meta did not return an ad ID for ad set {index}")
            created.append({
                "index": index,
                "adset_id": adset_id,
                "creative_id": creative_id,
                "ad_id": ad_id,
                "daily_budget_usd": budget / 100,
                "media_type": adset_plan.media_type,
                "origin": adset_plan.origin,
            })
            requests_log.append({"edge": "adsets/adcreatives/ads", **created[-1], "status": "PAUSED"})

        # Transactional activation: the campaign remains paused until every child is ready and active.
        for item in created:
            _request("POST", cfg, item["ad_id"], {"status": "ACTIVE"})
        for item in created:
            _request("POST", cfg, item["adset_id"], {"status": "ACTIVE"})
        _request("POST", cfg, campaign_id, {"status": "ACTIVE"})
    except Exception as error:
        raise RuntimeError(
            f"Meta campaign {campaign_id} was left PAUSED because launch did not complete: {error}"
        ) from error

    return {
        "campaign_id": campaign_id,
        "campaign_status": "ACTIVE",
        "scheduled_start": plan.scheduled_start,
        "objective": "OUTCOME_SALES",
        "budget_mode": "ABO",
        "total_daily_budget_usd": plan.total_daily_budget_usd,
        "adsets": created,
        "account": {k: account.get(k) for k in ("id", "name", "currency", "timezone_name")},
        "api_version": cfg["api_version"],
        "automation": {
            "catalog": False,
            "campaign_budget": False,
            "advantage_audience": False,
            "advantage_placements": False,
            "creative_feature_opt_outs": True,
            "carousel_reordering": False,
        },
        "requests": requests_log,
    }
