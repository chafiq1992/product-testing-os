"""Fetch the selected window for every campaign; calculate ratios from totals."""
from datetime import date, timedelta
from zoneinfo import ZoneInfo
from datetime import datetime
import json
from app.integrations import meta_client as meta

PURCHASES = ["purchase", "omni_purchase", "offsite_conversion.fb_pixel_purchase", "onsite_conversion.purchase"]


def analysis_range(start: str | None, end: str | None) -> tuple[str, str]:
    if bool(start) != bool(end):
        raise ValueError("Both start and end dates are required")
    today = datetime.now(ZoneInfo("Africa/Casablanca")).date()
    first = date.fromisoformat(start) if start else today - timedelta(days=6)
    last = date.fromisoformat(end) if end else today
    if first > last or (last - first).days > 89 or last > today:
        raise ValueError("Select a valid period of up to 90 days ending today or earlier")
    return first.isoformat(), last.isoformat()


def preceding_range(start: str, end: str) -> tuple[str, str]:
    first, last = date.fromisoformat(start), date.fromisoformat(end)
    length = (last - first).days + 1
    return (first - timedelta(days=length)).isoformat(), (first - timedelta(days=1)).isoformat()


def aggregate(rows: list[dict]) -> dict:
    counts = ["spend", "impressions", "clicks", "link_clicks", "landing_page_views", "add_to_cart", "checkouts", "purchases", "revenue"]
    result = {key: sum(float(r.get(key) or 0) for r in rows) if rows and all(r.get(key) is not None for r in rows) else None for key in counts}
    def ratio(numerator, denominator, factor=1):
        a, b = result.get(numerator), result.get(denominator)
        return round(a / b * factor, 4) if a is not None and b is not None and b > 0 else None
    result.update(ctr=ratio("clicks", "impressions", 100), link_ctr=ratio("link_clicks", "impressions", 100),
                  cpc=ratio("spend", "link_clicks"), cpm=ratio("spend", "impressions", 1000), cpp=ratio("spend", "purchases"),
                  roas=ratio("revenue", "spend"), landing_rate=ratio("landing_page_views", "link_clicks", 100),
                  cart_rate=ratio("add_to_cart", "landing_page_views", 100), checkout_rate=ratio("checkouts", "add_to_cart", 100),
                  purchase_rate=ratio("purchases", "checkouts", 100))
    return result


def fetch_window(cids: list[str], start: str, end: str) -> dict:
    days, campaigns, currencies, account_currencies = {}, [], set(), {}
    for cid in cids:
        details = meta._get(cid, {"fields": "id,name,account_id,created_time,effective_status"})
        account = str(details.get("account_id") or "")
        if account:
            if account not in account_currencies:
                account_currencies[account] = meta._get(f"act_{account}", {"fields": "currency"}).get("currency")
            currency = account_currencies[account]
            if currency:
                currencies.add(currency)
        response = meta._get(f"{cid}/insights", {"level": "campaign", "fields": "date_start,spend,impressions,clicks,inline_link_clicks,actions,action_values,frequency",
                            "time_range": json.dumps({"since": start, "until": end}), "time_increment": 1, "limit": 100})
        normalized = []
        for raw in response.get("data") or []:
            actions = raw.get("actions") or []
            row = {"date": raw.get("date_start"), "spend": float(raw.get("spend") or 0), "impressions": float(raw.get("impressions") or 0),
                   "clicks": float(raw.get("clicks") or 0), "link_clicks": float(raw["inline_link_clicks"]) if "inline_link_clicks" in raw else None,
                   "purchases": meta._action_count(actions, PURCHASES), "add_to_cart": meta._action_count(actions, ["add_to_cart", "omni_add_to_cart", "offsite_conversion.fb_pixel_add_to_cart"]),
                   "landing_page_views": meta._action_count(actions, ["landing_page_view", "omni_landing_page_view"]),
                   "checkouts": meta._action_count(actions, ["initiate_checkout", "omni_initiated_checkout", "offsite_conversion.fb_pixel_initiate_checkout"]),
                   "revenue": meta._action_count(raw.get("action_values") or [], PURCHASES) if raw.get("action_values") else None,
                   "frequency": float(raw["frequency"]) if "frequency" in raw else None}
            normalized.append(row)
            days.setdefault(row["date"], []).append(row)
        campaigns.append({"id": cid, "name": details.get("name"), "created_time": details.get("created_time"), "status": details.get("effective_status"),
                          "metrics": aggregate(normalized), "daily": normalized})
        try:
            ads = meta._get(f"{cid}/insights", {"level": "ad", "fields": "ad_id,ad_name,spend,impressions,inline_link_clicks,actions,action_values,ctr,cpc",
                            "time_range": json.dumps({"since": start, "until": end}), "limit": 100})
            campaigns[-1]["ad_insights"] = ads.get("data") or []
            if ads.get("paging", {}).get("next"):
                campaigns[-1]["ad_insights_note"] = "First 100 ads only; additional ads were not retrieved."
        except Exception:
            campaigns[-1]["ad_insights_note"] = "Ad-level metrics unavailable; creative performance cannot be isolated."
    if len(currencies) > 1:
        raise ValueError("Campaigns use different currencies. Analyze each ad account separately.")
    all_rows = [day for campaign in campaigns for day in campaign["daily"]]
    result = aggregate(all_rows)
    result.update(currency=next(iter(currencies), None), date_range={"start": start, "end": end}, campaigns=campaigns,
                  daily=[{"date": day, **aggregate(rows)} for day, rows in sorted(days.items())],
                  funnel_measurement_note="Zero actions means no platform-reported events; it does not verify pixel coverage or prove there was no onsite activity.",
                  attribution_note="Meta platform-reported actions. Shopify orders are separate product totals; attribution may differ.")
    return result
