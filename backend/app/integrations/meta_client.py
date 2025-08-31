import os, json, requests
from tenacity import retry, stop_after_attempt, wait_exponential
from dotenv import load_dotenv
load_dotenv()

ACCESS = os.getenv("META_ACCESS_TOKEN", "")
AD_ACCOUNT_ID = os.getenv("META_AD_ACCOUNT_ID", "")  # numeric only, no act_
PAGE_ID = os.getenv("META_PAGE_ID", "")
API_VERSION = os.getenv("META_API_VERSION", "v23.0")
BASE = f"https://graph.facebook.com/{API_VERSION}"


def _post(path: str, payload: dict, files=None):
    payload = {**payload, "access_token": ACCESS}
    url = f"{BASE}/{path}"
    try:
        r = requests.post(url, data=payload, files=files, timeout=120)
        r.raise_for_status()
        return r.json()
    except requests.HTTPError as e:
        # Raise a more informative error including response body
        try:
            body = r.text
        except Exception:
            body = str(e)
        raise RuntimeError(f"Meta API error {r.status_code} at {url}: {body}") from e


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
    camp = _post(f"act_{AD_ACCOUNT_ID}/campaigns", {
        "name": f"Test {payload.get('title','Product')}",
        "objective": "OUTCOME_SALES",
        "status": "PAUSED",
        "buying_type": "AUCTION"
    })

    results = {"campaign_id": camp["id"], "adsets": []}

    daily_budget_minor = 2000

    for a in angles:
        adset = _post(f"act_{AD_ACCOUNT_ID}/adsets", {
            "name": f"{a['name']} AdSet",
            "campaign_id": camp["id"],
            "daily_budget": daily_budget_minor,
            "billing_event": "IMPRESSIONS",
            "optimization_goal": "OUTCOME_SALES",
            "status": "PAUSED"
        })

        cr = next((c for c in creatives if c["angle"]["name"] == a["name"]), None)
        if not cr:
            continue

        image_hash = _upload_image(cr["image_url"])

        story_spec = {
            "page_id": PAGE_ID,
            "link_data": {
                "image_hash": image_hash,
                "link": f"{landing_url}?utm_source=meta&utm_medium=cpc&utm_campaign={camp['id']}&utm_content={a['name']}",
                "message": a["primaries"][0],
                "name": a["headlines"][0]
            }
        }

        creative = _post(f"act_{AD_ACCOUNT_ID}/adcreatives", {
            "name": f"{a['name']} Creative",
            "object_story_spec": json.dumps(story_spec)
        })

        ad = _post(f"act_{AD_ACCOUNT_ID}/ads", {
            "name": f"{a['name']} Ad",
            "adset_id": adset["id"],
            "creative": json.dumps({"creative_id": creative["id"]}),
            "status": "PAUSED"
        })

        results["adsets"].append({
            "adset_id": adset["id"],
            "ad_id": ad["id"],
            "creative_id": creative["id"],
        })

    return results
