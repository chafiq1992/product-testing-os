"""On-demand reconciliation of one Shopify product with its Sendo parcel evidence."""
from datetime import date, datetime, timezone
import hashlib
import hmac
import json
import logging
import time
from typing import Literal
from zoneinfo import ZoneInfo

import requests
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field, StrictBool, ValidationError

from app.ads_analyzer_data import analysis_range
from app.integrations.product_issue_orders import ProductIssueOrdersError, fetch_product_issue_orders
from app.product_issue_reasons import group_reasons, parcel_issue
from app.sendo_workspace import delivery_url, is_workspace_label, launch_secret
from app.tenant_context import current_workspace

router = APIRouter(prefix="/api/ads-management", tags=["ads management"])
log = logging.getLogger(__name__)
MOROCCO = ZoneInfo("Africa/Casablanca")


class ProductIssueRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    store: str = Field(pattern=r"^[a-zA-Z0-9][a-zA-Z0-9_]{0,62}$")
    product_id: str = Field(pattern=r"^[1-9][0-9]{0,19}$")
    start: date
    end: date


class Evidence(BaseModel):
    reason: str | None
    note: str | None
    at: datetime | None


class DeliveryRecord(BaseModel):
    id: str
    source: Literal["parcel", "queue"]
    status: str = Field(min_length=1)
    delivered: StrictBool
    adverse: StrictBool
    cancellation_reported: StrictBool | None = None
    cancellation_at: datetime | None = None
    occurred_at: datetime | None
    evidence: list[Evidence]


class DeliveryBatch(BaseModel):
    shop: str
    orders: list[DeliveryRecord]


class DeliveryUnavailable(Exception):
    """Safe explanation for the operator. An incomplete lookup cannot establish zero issues."""


def _delivery_records(shop, orders, merchant_id):
    secret = launch_secret()
    if not secret:
        raise DeliveryUnavailable("The Sendo reporting connection is not configured.")
    url = delivery_url() + "/internal/services/product-delivery-issues"
    records = {}
    with requests.Session() as client:
        for offset in range(0, len(orders), 100):
            batch = orders[offset:offset + 100]
            refs = [{"id": order["order_id"], "name": order["order_name"]} for order in batch]
            body = json.dumps({"shop": shop, "merchant_id": merchant_id, "orders": refs},
                              ensure_ascii=False, separators=(",", ":")).encode()
            ts = str(int(time.time()))
            signature = hmac.new(secret.encode(), f"{ts}.product-delivery-issues.".encode() + body,
                                 hashlib.sha256).hexdigest()
            try:
                response = client.post(url, data=body, headers={
                    "Content-Type": "application/json", "X-Sendo-Timestamp": ts, "X-Sendo-Signature": signature,
                }, timeout=(4, 25), allow_redirects=False)
                if response.status_code == 403:
                    raise DeliveryUnavailable("Sendo could not verify delivery access for the selected store.")
                if response.status_code == 409:
                    raise DeliveryUnavailable("Sendo found an ambiguous store or order match. Delivery totals are unavailable.")
                if response.status_code != 200:
                    log.warning("Sendo product issue lookup returned HTTP %s", response.status_code)
                    raise DeliveryUnavailable("Sendo could not complete the delivery lookup. Please retry.")
                result = DeliveryBatch.model_validate(response.json())
            except (requests.RequestException, ValidationError, ValueError) as exc:
                log.warning("Sendo product issue lookup failed (%s)", type(exc).__name__)
                raise DeliveryUnavailable("Sendo could not complete the delivery lookup. Please retry.") from exc
            allowed = {ref["id"] for ref in refs}
            if result.shop != shop:
                raise DeliveryUnavailable("Sendo returned a different store. Delivery totals are unavailable.")
            for record in result.orders:
                if record.id not in allowed or record.id in records:
                    raise DeliveryUnavailable("Sendo returned inconsistent order matches. Please retry.")
                records[record.id] = record
    return records


def _local_time(value):
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(MOROCCO).isoformat(timespec="seconds")


def _known_time(value):
    if isinstance(value, str):
        try:
            value = datetime.fromisoformat(value)
        except ValueError:
            return None
    return value if isinstance(value, datetime) and value.utcoffset() is not None else None


def _cancellation_after_fulfillment(order, record):
    """Return the qualifying time, an unresolved sequence, and unresolved cohort membership."""
    candidates = []
    if order["cancelled"]:
        candidates.append(_known_time(order.get("cancelled_at")))
    if record and record.source == "parcel" and not record.delivered:
        if record.cancellation_reported:
            candidates.append(_known_time(record.cancellation_at))
        elif record.cancellation_reported is None and record.status in {"Annulé", "Annulé par vendeur"}:
            # Older Sendo responses date the parcel's evidence, which can be a different event.
            candidates.append(None)
    if not candidates:
        return None, False, False
    if not order["fulfilled"]:
        return None, False, bool(order.get("fulfillment_history_incomplete"))
    fulfilled_at = _known_time(order.get("fulfilled_at"))
    # An earlier shipment may be undated, yet a later, verified complete
    # shipment still proves that a subsequent cancellation occurred after full fulfillment.
    fulfilled_by = fulfilled_at or _known_time(order.get("fulfilled_by"))
    qualifying = [stamp for stamp in candidates if stamp and fulfilled_by and stamp > fulfilled_by]
    if qualifying:
        return min(qualifying), False, False
    return None, fulfilled_at is None or any(stamp is None or stamp == fulfilled_at for stamp in candidates), False


def _build_report(body, shop, orders, records, warning=None):
    # Fulfillment refers to Shopify; delivery outcomes refer to all exactly matched Sendo parcels.
    summary = {
        "received": len(orders),
        "fulfilled": sum(o["fulfilled"] for o in orders),
        "partially_fulfilled": sum(o["partially_fulfilled"] for o in orders),
        "cancelled": sum(o["cancelled"] for o in orders),
        "unfulfilled": sum(not (o["fulfilled"] or o["partially_fulfilled"] or o["cancelled"]) for o in orders),
    }
    for key in ("tracked", "delivered", "adverse", "in_progress", "queued", "queue_errors", "unmatched",
                "product_complaints", "fulfilled_delivered", "fulfilled_cancelled", "fulfilled_cancellation_unverified",
                "fulfillment_history_unverified"):
        summary[key] = None if records is None else 0
    issues = []
    for order in orders if records is not None else ():
        record = records.get(order["order_id"])
        cancelled_at, unverified, unknown_fulfillment = _cancellation_after_fulfillment(order, record)
        summary["fulfilled_cancelled"] += int(cancelled_at is not None)
        summary["fulfilled_cancellation_unverified"] += int(unverified)
        summary["fulfillment_history_unverified"] += int(unknown_fulfillment)
        occurred = record.occurred_at if record else None
        if record is None:
            summary["unmatched"] += 1
            if not order["fulfilled"]:
                continue
            kind, status = "unmatched", "Fulfilled in Shopify"
            reasons, notes = ["No matching Sendo parcel or queue entry"], []
        elif record.source == "queue":
            summary["queued"] += 1
            kind, status = "queue", record.status
            reason = "Awaiting dispatch"
            if status.upper().startswith("ERROR"):
                summary["queue_errors"] += 1
                reason = "Missing or unrecognized delivery city" if status.casefold() == "error (city)" else "Dispatch queue error"
            reasons, notes = [reason], []
        else:
            summary["tracked"] += 1
            summary["fulfilled_delivered"] += int(order["fulfilled"] and record.delivered)
            outcome = "delivered" if record.delivered else "adverse" if record.adverse else "in_progress"
            summary[outcome] += 1
            issue = parcel_issue(record, order["mixed_basket"])
            if issue is None:
                if not cancelled_at:
                    continue
                issue = "delivery", [], [], cancelled_at
            kind, reasons, notes, evidence_time = issue
            status = record.status
            # A later delivery scan cannot date a complaint from an undated note.
            occurred = evidence_time if kind in {"product", "unattributed"} else evidence_time or occurred
            if kind == "product":
                summary["product_complaints"] += 1
        # Each reason has its own category. A product complaint may also have
        # an independent delivery problem, even on a multi-product order.
        if cancelled_at:
            reasons = [reason for reason in reasons if reason != "Delivery cancelled"]
        reason_groups = group_reasons(kind, reasons)
        if cancelled_at:
            reason_groups.setdefault("delivery", []).append("Cancelled after fulfillment")
            reasons = [*reasons, "Cancelled after fulfillment"]
        issues.append({"order_id": order["order_id"], "order_name": order["order_name"],
                       "variants": order["variants"], "kind": kind, "status": status,
                       "reasons": reasons, "reason_groups": reason_groups, "notes": notes,
                       "cancelled_after_fulfillment_at": _local_time(cancelled_at),
                       "occurred_at": _local_time(occurred)})
    # Keep the most recent records first; without a verified event time a record sorts last.
    issues.sort(key=lambda item: datetime.fromisoformat(item["occurred_at"]).timestamp()
                if item["occurred_at"] else float("-inf"), reverse=True)
    return {"store": body.store, "product_id": body.product_id, "shop_domain": shop,
            "start": body.start.isoformat(), "end": body.end.isoformat(),
            "as_of": _local_time(datetime.now(timezone.utc)), "delivery_available": records is not None,
            "warning": warning, "summary": summary, "issues": issues,
            "cancellation_definition": "Explicitly cancelled in Shopify or Sendo after full fulfillment."}


@router.post("/product-delivery-issues")
def product_delivery_issues(body: ProductIssueRequest):
    try:
        analysis_range(body.start.isoformat(), body.end.isoformat())
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    store = body.store.lower()
    workspace = current_workspace()
    if workspace and workspace != store:
        raise HTTPException(403, "The requested store is outside this workspace.")
    try:
        shop, orders = fetch_product_issue_orders(store, body.product_id, body.start, body.end)
    except ProductIssueOrdersError as exc:
        raise HTTPException(502, str(exc)) from exc
    try:
        merchant_id = int(store[1:]) if is_workspace_label(store) else None
        records = _delivery_records(shop, orders, merchant_id) if orders else {}
    except DeliveryUnavailable as exc:
        return {"data": _build_report(body, shop, orders, None, str(exc))}
    return {"data": _build_report(body, shop, orders, records)}
