import os, json, requests
from tenacity import retry, stop_after_attempt, wait_exponential
from dotenv import load_dotenv
load_dotenv()

ACCESS = os.getenv("META_ACCESS_TOKEN", "")
AD_ACCOUNT_ID = os.getenv("META_AD_ACCOUNT_ID", "")  # numeric only, no act_
PAGE_ID = os.getenv("META_PAGE_ID", "")
PIXEL_ID = os.getenv("META_PIXEL_ID", "")
OBJECTIVE = os.getenv("META_OBJECTIVE", "TRAFFIC").upper()  # TRAFFIC (default) or CONVERSIONS/SALES
COUNTRIES = [c.strip().upper() for c in (os.getenv("META_COUNTRIES", "US").split(",")) if c.strip()]
API_VERSION = os.getenv("META_API_VERSION", "v20.0")
BASE = f"https://graph.facebook.com/{API_VERSION}"


def _redact_url(url: str) -> str:
    """Remove query parameters to avoid leaking tokens in logs."""
    try:
        return url.split("?", 1)[0]
    except Exception:
        return url

def _format_meta_error(r: requests.Response, url: str, verb: str) -> RuntimeError:
    """Create a user-friendly error while avoiding leaking sensitive data."""
    safe_url = _redact_url(url)
    # Default fallback body
    body_text = None
    try:
        payload = r.json()
        err = payload.get("error") or {}
        err_msg = err.get("message") or ""
        err_type = err.get("type") or ""
        err_code = err.get("code")

        # Special-case common permission error from Marketing API
        if r.status_code == 403 and err_code == 200:
            hint = (
                "Meta permissions error: The ad account owner must grant 'ads_management' or 'ads_read' "
                f"to the app/user for ad account act_{AD_ACCOUNT_ID}. Ensure: "
                "1) The access token belongs to a user or system user with access to the ad account; "
                "2) The app is in Live mode (or using a system user token); "
                "3) The app has the Marketing API permissions approved or you're using a Business System User token "
                "assigned to the ad account."
            )
            return RuntimeError(hint)

        # Generic structured error with helpful fields when available
        user_msg = err.get("error_user_msg")
        subcode = err.get("error_subcode")
        error_data = err.get("error_data")
        parts = [p for p in [err_msg, user_msg] if p]
        suffix = f" (subcode {subcode})" if subcode else ""
        if error_data and isinstance(error_data, dict):
            blame = error_data.get("blame_field") or error_data.get("blame_field_specs")
            if blame:
                parts.append(f"Field: {blame}")
        summary = "; ".join(parts) or (payload if isinstance(payload, str) else "")
        return RuntimeError(f"Meta API {verb} error {r.status_code} at {safe_url}: {summary}{suffix}")
    except Exception:
        try:
            body_text = r.text
        except Exception:
            body_text = "<no body>"
        return RuntimeError(f"Meta API {verb} error {r.status_code} at {safe_url}: {body_text}")

def _post(path: str, payload: dict, files=None):
    payload = {**payload, "access_token": ACCESS}
    url = f"{BASE}/{path}"
    try:
        r = requests.post(url, data=payload, files=files, timeout=120)
        r.raise_for_status()
        return r.json()
    except requests.HTTPError as e:
        raise _format_meta_error(r, url, "POST") from e

def _get(path: str, params: dict | None = None):
    params = {**(params or {}), "access_token": ACCESS}
    url = f"{BASE}/{path}"
    try:
        r = requests.get(url, params=params, timeout=120)
        r.raise_for_status()
        return r.json()
    except requests.HTTPError as e:
        raise _format_meta_error(r, url, "GET") from e


def list_saved_audiences() -> list[dict]:
    """Return saved audiences for the configured ad account (id, name)."""
    res = _get(f"act_{AD_ACCOUNT_ID}/saved_audiences", {"fields": "id,name,description"})
    data = res.get("data") if isinstance(res, dict) else None
    if isinstance(data, list):
        return [{"id": x.get("id"), "name": x.get("name"), "description": x.get("description")} for x in data]
    return []


def _upload_image(url: str):
    res = _post(f"act_{AD_ACCOUNT_ID}/adimages", {"url": url})
    images = res.get("images", {})
    first = next(iter(images.values()))
    return first["hash"]

@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, max=16))
def create_campaign_with_ads(payload: dict, angles: list, creatives: list, landing_url: str) -> dict:
    if not ACCESS:
        raise RuntimeError("META_ACCESS_TOKEN is not set.")
    if not AD_ACCOUNT_ID:
        raise RuntimeError("META_AD_ACCOUNT_ID is not set (numeric, without 'act_').")
    if not PAGE_ID:
        raise RuntimeError("META_PAGE_ID is not set.")
    # Build request log for tracing
    requests_log = []

    # Campaign
    # Preflight: verify ad account is accessible by the token
    _get(f"act_{AD_ACCOUNT_ID}", {"fields": "id,account_status,name"})
    campaign_payload = {
        "name": f"Test {payload.get('title','Product')}",
        "objective": "OUTCOME_TRAFFIC" if OBJECTIVE not in ("CONVERSIONS", "SALES") else "OUTCOME_SALES",
        "status": "PAUSED",
        "buying_type": "AUCTION",
        "special_ad_categories": ["NONE"]
    }
    requests_log.append({"path": f"act_{AD_ACCOUNT_ID}/campaigns", "payload": campaign_payload})
    camp = _post(f"act_{AD_ACCOUNT_ID}/campaigns", campaign_payload)
    requests_log[-1]["response"] = camp

    results = {"campaign_id": camp["id"], "adsets": [], "requests": requests_log}

    # Determine daily budget (minor units). Default to $9.00 if not provided.
    try:
        budget_major = float(payload.get("adset_budget", 9)) if isinstance(payload, dict) else 9.0
    except Exception:
        budget_major = 9.0
    daily_budget_minor = max(100, int(round(budget_major * 100)))

    for a in angles:
        # Allow per-test targeting override via payload["targeting"]
        targeting_spec = payload.get("targeting") if isinstance(payload, dict) else None
        if not targeting_spec:
            targeting_spec = {"geo_locations": {"countries": COUNTRIES}}
        # Ensure it is JSON-encoded for the API
        targeting_json = json.dumps(targeting_spec) if not isinstance(targeting_spec, str) else targeting_spec
        adset_payload = {
            "name": f"{a['name']} AdSet",
            "campaign_id": camp["id"],
            "daily_budget": daily_budget_minor,
            "status": "PAUSED",
            "billing_event": "IMPRESSIONS",
            "bid_strategy": "LOWEST_COST_WITHOUT_CAP",
            # For conversions/sales, use a valid optimization goal for pixel conversions
            "optimization_goal": "LINK_CLICKS" if OBJECTIVE not in ("CONVERSIONS", "SALES") else "OFFSITE_CONVERSIONS",
            # Meta Marketing API expects JSON-encoded targeting for form-encoded posts
            "targeting": targeting_json
        }
        if OBJECTIVE in ("CONVERSIONS", "SALES"):
            if not PIXEL_ID:
                raise RuntimeError("META_PIXEL_ID is required for conversions objective.")
            # JSON-encode promoted_object including a conversion event for SALES/CONVERSIONS
            adset_payload["promoted_object"] = json.dumps({"pixel_id": PIXEL_ID, "custom_event_type": "PURCHASE"})
        requests_log.append({"path": f"act_{AD_ACCOUNT_ID}/adsets", "payload": adset_payload})
        adset = _post(f"act_{AD_ACCOUNT_ID}/adsets", adset_payload)
        requests_log[-1]["response"] = adset

        cr = next((c for c in creatives if c["angle"]["name"] == a["name"]), None)
        if not cr:
            continue

        image_hash = _upload_image(cr["image_url"])
        # We can't log upload payload fully (URL inside), but capture path
        requests_log.append({"path": f"act_{AD_ACCOUNT_ID}/adimages", "payload": {"url": cr["image_url"]}, "response": {"image_hash": image_hash}})

        story_spec = {
            "page_id": PAGE_ID,
            "link_data": {
                "image_hash": image_hash,
                "link": f"{landing_url}?utm_source=meta&utm_medium=cpc&utm_campaign={camp['id']}&utm_content={a['name']}",
                "message": a["primaries"][0],
                "name": a["headlines"][0]
            }
        }

        creative_payload = {
            "name": f"{a['name']} Creative",
            "object_story_spec": json.dumps(story_spec)
        }
        requests_log.append({"path": f"act_{AD_ACCOUNT_ID}/adcreatives", "payload": creative_payload})
        creative = _post(f"act_{AD_ACCOUNT_ID}/adcreatives", creative_payload)
        requests_log[-1]["response"] = creative

        ad_payload = {
            "name": f"{a['name']} Ad",
            "adset_id": adset["id"],
            "creative": json.dumps({"creative_id": creative["id"]}),
            "status": "PAUSED"
        }
        requests_log.append({"path": f"act_{AD_ACCOUNT_ID}/ads", "payload": ad_payload})
        ad = _post(f"act_{AD_ACCOUNT_ID}/ads", ad_payload)
        requests_log[-1]["response"] = ad

        results["adsets"].append({
            "adset_id": adset["id"],
            "ad_id": ad["id"],
            "creative_id": creative["id"],
        })

    return results


@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, max=16))
def create_draft_image_campaign(ad: dict) -> dict:
    if not ACCESS:
        raise RuntimeError("META_ACCESS_TOKEN is not set.")
    if not AD_ACCOUNT_ID:
        raise RuntimeError("META_AD_ACCOUNT_ID is not set (numeric, without 'act_').")
    if not PAGE_ID:
        raise RuntimeError("META_PAGE_ID is not set.")

    requests_log = []

    # Preflight: verify ad account is accessible by the token
    _get(f"act_{AD_ACCOUNT_ID}", {"fields": "id,account_status,name"})

    campaign_payload = {
        "name": ad.get("campaign_name") or f"Test {ad.get('title','Product')}",
        "objective": "OUTCOME_TRAFFIC" if OBJECTIVE not in ("CONVERSIONS", "SALES") else "OUTCOME_SALES",
        "status": "PAUSED",
        "buying_type": "AUCTION",
        "special_ad_categories": ["NONE"],
    }
    requests_log.append({"path": f"act_{AD_ACCOUNT_ID}/campaigns", "payload": campaign_payload})
    camp = _post(f"act_{AD_ACCOUNT_ID}/campaigns", campaign_payload)
    requests_log[-1]["response"] = camp

    results = {"campaign_id": camp["id"], "adsets": [], "requests": requests_log}

    # Budget
    try:
        budget_major = float(ad.get("adset_budget", 9))
    except Exception:
        budget_major = 9.0
    daily_budget_minor = max(100, int(round(budget_major * 100)))

    # Targeting: allow saved audience or explicit geo
    targeting_spec = ad.get("targeting")
    saved_audience_id = ad.get("saved_audience_id")
    if saved_audience_id and not targeting_spec:
        targeting_spec = {"saved_audience_id": saved_audience_id}
    if not targeting_spec:
        targeting_spec = {"geo_locations": {"countries": COUNTRIES}}
    targeting_json = json.dumps(targeting_spec) if not isinstance(targeting_spec, str) else targeting_spec

    adset_payload = {
        "name": ad.get("adset_name") or "Image AdSet",
        "campaign_id": camp["id"],
        "daily_budget": daily_budget_minor,
        "status": "PAUSED",
        "billing_event": "IMPRESSIONS",
        "bid_strategy": "LOWEST_COST_WITHOUT_CAP",
        "optimization_goal": "LINK_CLICKS" if OBJECTIVE not in ("CONVERSIONS", "SALES") else "OFFSITE_CONVERSIONS",
        "targeting": targeting_json,
    }
    if OBJECTIVE in ("CONVERSIONS", "SALES"):
        if not PIXEL_ID:
            raise RuntimeError("META_PIXEL_ID is required for conversions objective.")
        adset_payload["promoted_object"] = json.dumps({"pixel_id": PIXEL_ID, "custom_event_type": "PURCHASE"})
    requests_log.append({"path": f"act_{AD_ACCOUNT_ID}/adsets", "payload": adset_payload})
    adset = _post(f"act_{AD_ACCOUNT_ID}/adsets", adset_payload)
    requests_log[-1]["response"] = adset

    image_url = ad.get("image_url")
    if not image_url:
        raise RuntimeError("image_url is required for image ad.")
    landing_url = ad.get("landing_url")
    if not landing_url:
        raise RuntimeError("landing_url is required.")

    image_hash = _upload_image(image_url)
    requests_log.append({"path": f"act_{AD_ACCOUNT_ID}/adimages", "payload": {"url": image_url}, "response": {"image_hash": image_hash}})

    cta = (ad.get("call_to_action") or "SHOP_NOW").upper()
    primary_text = ad.get("primary_text") or ad.get("text") or ""
    headline = ad.get("headline") or ""
    description = ad.get("description") or ""

    story_spec = {
        "page_id": PAGE_ID,
        "link_data": {
            "image_hash": image_hash,
            "link": landing_url,
            "message": primary_text,
            "name": headline,
            "description": description,
            "call_to_action": {
                "type": cta,
                "value": {"link": landing_url},
            },
        },
    }

    creative_payload = {
        "name": ad.get("creative_name") or "Image Ad Creative",
        "object_story_spec": json.dumps(story_spec),
    }
    requests_log.append({"path": f"act_{AD_ACCOUNT_ID}/adcreatives", "payload": creative_payload})
    creative = _post(f"act_{AD_ACCOUNT_ID}/adcreatives", creative_payload)
    requests_log[-1]["response"] = creative

    ad_payload = {
        "name": ad.get("ad_name") or "Image Ad",
        "adset_id": adset["id"],
        "creative": json.dumps({"creative_id": creative["id"]}),
        "status": "PAUSED",
    }
    requests_log.append({"path": f"act_{AD_ACCOUNT_ID}/ads", "payload": ad_payload})
    ad_obj = _post(f"act_{AD_ACCOUNT_ID}/ads", ad_payload)
    requests_log[-1]["response"] = ad_obj

    results["adsets"].append({
        "adset_id": adset["id"],
        "ad_id": ad_obj["id"],
        "creative_id": creative["id"],
    })
    results["requests"] = requests_log
    return results


@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, max=16))
def create_draft_carousel_campaign(ad: dict) -> dict:
    if not ACCESS:
        raise RuntimeError("META_ACCESS_TOKEN is not set.")
    if not AD_ACCOUNT_ID:
        raise RuntimeError("META_AD_ACCOUNT_ID is not set (numeric, without 'act_').")
    if not PAGE_ID:
        raise RuntimeError("META_PAGE_ID is not set.")

    requests_log: list[dict] = []

    # Preflight: verify ad account is accessible by the token
    _get(f"act_{AD_ACCOUNT_ID}", {"fields": "id,account_status,name"})

    campaign_payload = {
        "name": ad.get("campaign_name") or f"Test {ad.get('title','Product')}",
        "objective": "OUTCOME_TRAFFIC" if OBJECTIVE not in ("CONVERSIONS", "SALES") else "OUTCOME_SALES",
        "status": "PAUSED",
        "buying_type": "AUCTION",
        "special_ad_categories": ["NONE"],
    }
    requests_log.append({"path": f"act_{AD_ACCOUNT_ID}/campaigns", "payload": campaign_payload})
    camp = _post(f"act_{AD_ACCOUNT_ID}/campaigns", campaign_payload)
    requests_log[-1]["response"] = camp

    results = {"campaign_id": camp["id"], "adsets": [], "requests": requests_log}

    # Budget
    try:
        budget_major = float(ad.get("adset_budget", 9))
    except Exception:
        budget_major = 9.0
    daily_budget_minor = max(100, int(round(budget_major * 100)))

    # Targeting: allow saved audience or explicit geo
    targeting_spec = ad.get("targeting")
    saved_audience_id = ad.get("saved_audience_id")
    if saved_audience_id and not targeting_spec:
        targeting_spec = {"saved_audience_id": saved_audience_id}
    if not targeting_spec:
        targeting_spec = {"geo_locations": {"countries": COUNTRIES}}
    targeting_json = json.dumps(targeting_spec) if not isinstance(targeting_spec, str) else targeting_spec

    adset_payload = {
        "name": ad.get("adset_name") or "Carousel AdSet",
        "campaign_id": camp["id"],
        "daily_budget": daily_budget_minor,
        "status": "PAUSED",
        "billing_event": "IMPRESSIONS",
        "bid_strategy": "LOWEST_COST_WITHOUT_CAP",
        "optimization_goal": "LINK_CLICKS" if OBJECTIVE not in ("CONVERSIONS", "SALES") else "OFFSITE_CONVERSIONS",
        "targeting": targeting_json,
    }
    if OBJECTIVE in ("CONVERSIONS", "SALES"):
        if not PIXEL_ID:
            raise RuntimeError("META_PIXEL_ID is required for conversions objective.")
        adset_payload["promoted_object"] = json.dumps({"pixel_id": PIXEL_ID, "custom_event_type": "PURCHASE"})
    requests_log.append({"path": f"act_{AD_ACCOUNT_ID}/adsets", "payload": adset_payload})
    adset = _post(f"act_{AD_ACCOUNT_ID}/adsets", adset_payload)
    requests_log[-1]["response"] = adset

    cards = ad.get("cards") or []
    if not isinstance(cards, list) or len(cards) < 2:
        raise RuntimeError("Provide at least 2 cards for a carousel (cards: [{ image_url, headline?, description?, link?, call_to_action? }]).")

    landing_url = ad.get("landing_url")
    if not landing_url:
        raise RuntimeError("landing_url is required.")

    primary_text = ad.get("primary_text") or ad.get("text") or ""
    default_cta = (ad.get("call_to_action") or "SHOP_NOW").upper()

    child_attachments = []
    for idx, card in enumerate(cards):
        image_url = card.get("image_url") if isinstance(card, dict) else None
        if not image_url:
            raise RuntimeError(f"cards[{idx}].image_url is required")
        image_hash = _upload_image(image_url)
        requests_log.append({"path": f"act_{AD_ACCOUNT_ID}/adimages", "payload": {"url": image_url}, "response": {"image_hash": image_hash}})

        headline = card.get("headline") or ad.get("headline") or ""
        description = card.get("description") or ad.get("description") or ""
        card_link = card.get("link") or landing_url
        cta_type = (card.get("call_to_action") or default_cta).upper()

        child_attachments.append({
            "image_hash": image_hash,
            "link": card_link,
            "name": headline,
            "description": description,
            "call_to_action": {"type": cta_type, "value": {"link": card_link}},
        })

    story_spec = {
        "page_id": PAGE_ID,
        "link_data": {
            "message": primary_text,
            "link": landing_url,
            "child_attachments": child_attachments,
            "multi_share_optimized": True,
        },
    }

    creative_payload = {
        "name": ad.get("creative_name") or "Carousel Ad Creative",
        "object_story_spec": json.dumps(story_spec),
    }
    requests_log.append({"path": f"act_{AD_ACCOUNT_ID}/adcreatives", "payload": creative_payload})
    creative = _post(f"act_{AD_ACCOUNT_ID}/adcreatives", creative_payload)
    requests_log[-1]["response"] = creative

    ad_payload = {
        "name": ad.get("ad_name") or "Carousel Ad",
        "adset_id": adset["id"],
        "creative": json.dumps({"creative_id": creative["id"]}),
        "status": "PAUSED",
    }
    requests_log.append({"path": f"act_{AD_ACCOUNT_ID}/ads", "payload": ad_payload})
    ad_obj = _post(f"act_{AD_ACCOUNT_ID}/ads", ad_payload)
    requests_log[-1]["response"] = ad_obj

    results["adsets"].append({
        "adset_id": adset["id"],
        "ad_id": ad_obj["id"],
        "creative_id": creative["id"],
    })
    results["requests"] = requests_log
    return results