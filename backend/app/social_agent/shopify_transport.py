"""Bounded Shopify retries for explicit pre-execution rate-limit responses."""
from __future__ import annotations

import time
from email.utils import parsedate_to_datetime
from datetime import datetime, timezone

from app.integrations.shopify_client import _get_store_config, _timed_request


def _retry_delay(response, payload: dict, attempt: int) -> float:
    delay = min(2 ** attempt, 16)
    cost = (payload.get("extensions") or {}).get("cost") or {}
    status = cost.get("throttleStatus") or {}
    try:
        requested = float(cost.get("requestedQueryCost") or 0)
        maximum = float(status.get("maximumAvailable") or 0)
        if maximum and requested > maximum:
            raise RuntimeError("Shopify query exceeds bucket capacity; reduce the catalog page size")
        rate = float(status.get("restoreRate") or 0)
        if rate > 0:
            delay = max(delay, (requested - float(status.get("currentlyAvailable") or 0)) / rate + 0.25)
    except (TypeError, ValueError):
        pass
    header = response.headers.get("Retry-After")
    if header:
        try:
            delay = max(delay, float(header))
        except ValueError:
            try:
                delay = max(delay, (parsedate_to_datetime(header) - datetime.now(timezone.utc)).total_seconds())
            except (TypeError, ValueError):
                pass
    return delay


def _gql_store(store: str | None, query: str, variables: dict):
    cfg = _get_store_config(store)
    auth = None
    if not cfg["TOKEN"]:
        if cfg["API_KEY"] and cfg["PASSWORD"]:
            auth = (cfg["API_KEY"], cfg["PASSWORD"])
        else:
            raise RuntimeError("Shopify credentials are missing for the selected store")
    waited = 0.0
    for attempt in range(6):
        response = _timed_request("POST", cfg["GQL"], headers=cfg["HEADERS"],
                                  json={"query": query, "variables": variables}, timeout=60, auth=auth)
        try:
            payload = response.json()
        except ValueError:
            payload = {}
        errors = payload.get("errors") or []
        throttled = response.status_code == 429 or (
            response.status_code == 200 and not payload.get("data") and errors
            and all((error.get("extensions") or {}).get("code") == "THROTTLED" for error in errors)
        )
        if throttled:
            delay = _retry_delay(response, payload, attempt)
            if attempt == 5 or waited + delay > 60:
                raise RuntimeError("Shopify is temporarily rate-limited. The batch can be retried safely shortly.")
            time.sleep(delay)
            waited += delay
            continue
        response.raise_for_status()
        if errors:
            raise RuntimeError(f"GraphQL errors: {errors}")
        return payload.get("data")
