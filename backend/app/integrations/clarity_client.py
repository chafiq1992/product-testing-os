"""Microsoft Clarity Data Export integration.

The export API is intentionally limited, so this module keeps a small in-memory
cache and returns compact, analyzer-ready summaries instead of raw dashboard
payloads.
"""

from __future__ import annotations

import logging
import os
import time
from datetime import datetime
from typing import Any
from urllib.parse import unquote, urlparse

import requests

from app.config import CLARITY_API_TOKEN, CLARITY_EXPORT_MAX_DAYS

logger = logging.getLogger(__name__)

CLARITY_EXPORT_URL = "https://www.clarity.ms/export-data/api/v1/project-live-insights"
_CACHE: dict[str, tuple[float, Any]] = {}
_CACHE_TTL_SECONDS = int(os.getenv("CLARITY_EXPORT_CACHE_TTL_SECONDS", "21600") or "21600")


def _token() -> str:
    return (os.getenv("CLARITY_API_TOKEN") or CLARITY_API_TOKEN or "").strip()


def _bounded_days(num_days: int | None = None) -> int:
    try:
        days = int(num_days or CLARITY_EXPORT_MAX_DAYS or 3)
    except Exception:
        days = 3
    return max(1, min(3, days))


def _norm_text(value: Any) -> str:
    return unquote(str(value or "").strip()).lower()


def _norm_url(value: Any) -> str:
    raw = unquote(str(value or "").strip())
    if not raw:
        return ""
    try:
        p = urlparse(raw)
        host = (p.netloc or "").lower()
        path = (p.path or "/").rstrip("/") or "/"
        return f"{host}{path}".lower()
    except Exception:
        return raw.split("?", 1)[0].rstrip("/").lower()


def _path_variants(value: Any) -> set[str]:
    """Return URL path variants that survive domain, locale, and encoding drift."""
    raw = unquote(str(value or "").strip())
    if not raw:
        return set()
    variants: set[str] = set()
    try:
        p = urlparse(raw)
        path = (p.path or raw.split("?", 1)[0]).rstrip("/").lower()
    except Exception:
        path = raw.split("?", 1)[0].rstrip("/").lower()
    if not path:
        return variants
    if not path.startswith("/"):
        path = "/" + path
    variants.add(path)

    parts = [part for part in path.split("/") if part]
    # Shopify Markets can prefix locale, e.g. /ar/products/handle.
    if len(parts) >= 2 and len(parts[0]) in {2, 5}:
        variants.add("/" + "/".join(parts[1:]))
    if "products" in parts:
        idx = parts.index("products")
        if idx + 1 < len(parts):
            handle = parts[idx + 1]
            variants.add(handle)
            variants.add(f"/products/{handle}")
    return variants


def _slug_signature(value: Any) -> str:
    """A loose handle signature for matching encoded/unencoded Shopify handles."""
    s = _norm_text(value)
    if not s:
        return ""
    try:
        p = urlparse(s)
        s = p.path or s
    except Exception:
        pass
    parts = [part for part in s.split("/") if part]
    if "products" in parts:
        idx = parts.index("products")
        if idx + 1 < len(parts):
            s = parts[idx + 1]
    cleaned = []
    prev_dash = False
    for ch in s:
        keep = ch.isalnum() or ch == "-"
        if keep:
            cleaned.append(ch)
            prev_dash = ch == "-"
        elif not prev_dash:
            cleaned.append("-")
            prev_dash = True
    return "".join(cleaned).strip("-")


def _url_candidates(urls: list[str] | None) -> set[str]:
    out: set[str] = set()
    for u in urls or []:
        n = _norm_url(u)
        if n:
            out.add(n)
            out.update(_path_variants(u))
            sig = _slug_signature(u)
            if sig:
                out.add(f"slug:{sig}")
    return out


def _row_url(row: dict[str, Any]) -> str:
    for key in ("URL", "Url", "url", "Visited URL", "Page URL"):
        if row.get(key):
            return str(row.get(key) or "")
    return ""


def _row_campaign(row: dict[str, Any]) -> str:
    for key in ("Campaign", "campaign", "utm_campaign", "UTM Campaign"):
        if row.get(key):
            return str(row.get(key) or "")
    return ""


def _row_matches(
    row: dict[str, Any],
    *,
    campaign_id: str | None,
    campaign_name: str | None,
    landing_urls: list[str] | None,
) -> tuple[bool, list[str]]:
    reasons: list[str] = []
    campaign_value = _norm_text(_row_campaign(row))
    cid = _norm_text(campaign_id)
    cname = _norm_text(campaign_name)
    if campaign_value:
        if cid and (campaign_value == cid or cid in campaign_value):
            reasons.append("campaign_id")
        if cname and (campaign_value == cname or cname in campaign_value or campaign_value in cname):
            reasons.append("campaign_name")

    row_url = _norm_url(_row_url(row))
    row_variants = _path_variants(_row_url(row))
    row_sig = _slug_signature(_row_url(row))
    candidates = _url_candidates(landing_urls)
    if row_url and candidates:
        for cand in candidates:
            if not cand:
                continue
            if cand.startswith("slug:"):
                sig = cand.split(":", 1)[1]
                if sig and row_sig and (sig == row_sig or sig in row_sig or row_sig in sig):
                    reasons.append("product_handle")
                    break
                continue
            if (
                row_url == cand
                or cand in row_url
                or row_url.endswith(cand)
                or cand in row_variants
            ):
                reasons.append("url")
                break

    return bool(reasons), reasons


def _cache_get(key: str) -> Any | None:
    now = time.time()
    hit = _CACHE.get(key)
    if not hit:
        return None
    exp, value = hit
    if exp > now:
        return value
    _CACHE.pop(key, None)
    return None


def _cache_set(key: str, value: Any) -> None:
    if _CACHE_TTL_SECONDS <= 0:
        return
    _CACHE[key] = (time.time() + _CACHE_TTL_SECONDS, value)


def fetch_project_live_insights(
    *,
    num_days: int | None = None,
    dimensions: tuple[str, ...] = ("Campaign", "URL", "Device"),
) -> list[dict[str, Any]]:
    """Fetch Clarity dashboard export data.

    Raises RuntimeError when the token is missing or the API returns an error.
    """
    tok = _token()
    if not tok:
        raise RuntimeError("CLARITY_API_TOKEN is not set.")

    days = _bounded_days(num_days)
    dims = tuple(d for d in dimensions[:3] if d)
    cache_key = f"{days}:{'|'.join(dims)}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    params: dict[str, str] = {"numOfDays": str(days)}
    for i, dim in enumerate(dims, start=1):
        params[f"dimension{i}"] = dim

    res = requests.get(
        CLARITY_EXPORT_URL,
        params=params,
        headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/json"},
        timeout=30,
    )
    if res.status_code >= 400:
        raise RuntimeError(f"Clarity API error {res.status_code}: {res.text[:300]}")
    data = res.json()
    if not isinstance(data, list):
        data = []
    _cache_set(cache_key, data)
    return data


def _numeric_values(row: dict[str, Any]) -> dict[str, float]:
    out: dict[str, float] = {}
    for key, value in (row or {}).items():
        if key in {"Campaign", "campaign", "URL", "Url", "url", "Device", "Country/Region", "OS", "Browser", "Source", "Medium", "Channel", "Page Title", "Referrer URL"}:
            continue
        if isinstance(value, bool):
            continue
        try:
            if value is None or value == "":
                continue
            out[str(key)] = float(value)
        except Exception:
            continue
    return out


def _merge_numeric(target: dict[str, float], row: dict[str, Any]) -> None:
    for key, value in _numeric_values(row).items():
        target[key] = target.get(key, 0.0) + value


def _metric_signal_name(metric_name: str) -> str:
    s = _norm_text(metric_name).replace(" ", "_").replace("/", "_").replace("-", "_")
    return "".join(ch for ch in s if ch.isalnum() or ch == "_").strip("_") or "metric"


def summarize_for_campaign(
    *,
    campaign_id: str | None = None,
    campaign_name: str | None = None,
    landing_urls: list[str] | None = None,
    num_days: int | None = None,
) -> dict[str, Any]:
    """Return a compact Clarity summary matched to a campaign/product landing URL."""
    days = _bounded_days(num_days)
    if not _token():
        return {"enabled": False, "error": "CLARITY_API_TOKEN is not set.", "num_days": days}

    landing_urls = [u for u in (landing_urls or []) if str(u or "").strip()]
    try:
        export = fetch_project_live_insights(num_days=days)
    except Exception as e:
        logger.warning("Clarity export fetch failed: %s", e)
        return {"enabled": True, "error": str(e), "num_days": days}

    matched_by: dict[str, int] = {}
    metrics: dict[str, Any] = {}
    total_rows = 0
    matched_rows = 0

    for metric in export:
        if not isinstance(metric, dict):
            continue
        metric_name = str(metric.get("metricName") or metric.get("name") or "Unknown Metric")
        rows = metric.get("information") or metric.get("data") or []
        if not isinstance(rows, list):
            continue
        total_rows += len(rows)
        summary = metrics.setdefault(metric_name, {"matched_rows": 0, "numeric_totals": {}, "sample_rows": []})
        for row in rows:
            if not isinstance(row, dict):
                continue
            ok, reasons = _row_matches(
                row,
                campaign_id=campaign_id,
                campaign_name=campaign_name,
                landing_urls=landing_urls,
            )
            if not ok:
                continue
            matched_rows += 1
            summary["matched_rows"] += 1
            _merge_numeric(summary["numeric_totals"], row)
            if len(summary["sample_rows"]) < 3:
                sample = {k: v for k, v in row.items() if k in {"Campaign", "URL", "Device", "Source", "Medium", "Page Title", "Referrer URL"} or k in _numeric_values(row)}
                summary["sample_rows"].append(sample)
            for reason in reasons:
                matched_by[reason] = matched_by.get(reason, 0) + 1

    diagnostic_signals: dict[str, Any] = {}
    for metric_name, summary in metrics.items():
        if not summary.get("matched_rows"):
            continue
        signal = _metric_signal_name(metric_name)
        numeric_totals = summary.get("numeric_totals") or {}
        diagnostic_signals[signal] = {
            "matched_rows": summary.get("matched_rows", 0),
            "numeric_totals": numeric_totals,
        }

    return {
        "enabled": True,
        "source": "microsoft_clarity_data_export_api",
        "num_days": days,
        "dimensions": ["Campaign", "URL", "Device"],
        "matched_rows": matched_rows,
        "total_rows_scanned": total_rows,
        "matched_by": matched_by,
        "campaign_id": campaign_id,
        "campaign_name": campaign_name,
        "landing_urls": landing_urls[:10],
        "diagnostic_signals": diagnostic_signals,
        "metrics": {k: v for k, v in metrics.items() if v.get("matched_rows")},
        "fetched_at": datetime.utcnow().isoformat(timespec="seconds") + "Z",
    }
