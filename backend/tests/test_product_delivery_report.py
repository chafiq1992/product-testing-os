import hashlib
import hmac
import json
from datetime import datetime

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import auth_gate, product_delivery_issues as api


SHOP = "example-shop.myshopify.com"
PATH = "/api/ads-management/product-delivery-issues"
BODY = {"store": "m9", "product_id": "1234", "start": "2026-11-12", "end": "2026-11-20"}


FULL_TIME = "2026-11-16T12:00:00Z"
AFTER = "2026-11-18T09:00:00Z"
BEFORE = "2026-11-14T10:00:00Z"


def checkout(number, *, fulfilled=True, cancelled=False, mixed=False, fulfilled_at=FULL_TIME, cancelled_at=None):
    return {"order_id": str(number), "order_name": f"#{number}", "fulfilled": fulfilled,
            "partially_fulfilled": False, "cancelled": cancelled, "mixed_basket": mixed,
            "variants": ["Pink / 38"], "fulfilled_at": fulfilled_at if fulfilled else None,
            "cancelled_at": cancelled_at}


def shipment(number, status="Refusé", *, reason=None, note=None, delivered=False, adverse=True, source="parcel"):
    return api.DeliveryRecord(id=str(number), status=status, delivered=delivered, adverse=adverse,
                              source=source, occurred_at="2026-11-18T11:55:28Z",
                              evidence=[api.Evidence(reason=reason, note=note, at=None)] if reason or note else [])


def test_counts_and_evidence_are_order_based():
    orders = [checkout(i, mixed=i == 7) for i in range(1, 10)]
    orders.extend([checkout(10, fulfilled=False, cancelled=True), checkout(11, fulfilled=False)])
    records = [shipment(1, "Livré", delivered=True, adverse=True),
               shipment(2, note="jatha sghira, glt liha ndwz lik taille kbr"),
               shipment(3, reason="durability", note="double commande khdat lwla hadi tanya"),
               shipment(4, reason="quality", note="machi bhal photo"),
               shipment(5, "ERROR (city)", source="queue", adverse=False),
               shipment(6, "NEW (shopify)", source="queue", adverse=False),
               shipment(7, reason="too_large"), shipment(8, "Reporté", adverse=False)]
    result = api._build_report(api.ProductIssueRequest(**BODY), SHOP, orders, {r.id: r for r in records})
    assert result["delivery_available"] and result["warning"] is None
    assert result["summary"] == {"received": 11, "fulfilled": 9, "cancelled": 1, "unfulfilled": 1,
                                 "partially_fulfilled": 0, "tracked": 6, "delivered": 1, "adverse": 4,
                                 "in_progress": 1, "queued": 2, "queue_errors": 1, "unmatched": 3,
                                 "product_complaints": 2, "fulfilled_delivered": 1, "fulfilled_cancelled": 0,
                                 "fulfilled_cancellation_unverified": 0, "fulfillment_history_unverified": 0}
    cases = {item["order_id"]: item for item in result["issues"]}
    assert cases["2"]["reasons"] == ["Too small"]
    assert cases["3"]["kind"] == "delivery" and cases["3"]["reasons"] == ["Duplicate order"]
    assert "Different from the photo" in cases["4"]["reasons"]
    assert cases["7"]["kind"] == "unattributed" and cases["9"]["kind"] == "unmatched"
    assert cases["5"]["kind"] == "queue" and cases["5"]["status"] == "ERROR (city)"
    assert cases["5"]["reasons"] == ["Missing or unrecognized delivery city"]
    assert datetime.fromisoformat(cases["5"]["occurred_at"]).timestamp() == records[4].occurred_at.timestamp()
    assert cases["6"]["kind"] == "queue" and cases["6"]["reasons"] == ["Awaiting dispatch"]
    assert not {"10", "11"}.intersection(cases)


def test_rates_use_only_orders_that_were_fully_fulfilled_and_cancelled_later():
    # Shopify and Sendo can both report the same checkout, at different times.
    def explicit(number, when, status="Annulé"):
        record = shipment(number, status)
        record.cancellation_reported = True
        record.cancellation_at = datetime.fromisoformat(when) if when else None
        return record

    orders = [
        checkout(1), checkout(2, fulfilled=False), checkout(3, cancelled=True, cancelled_at=AFTER),
        checkout(4, cancelled=True, cancelled_at=AFTER), checkout(5), checkout(6),
        checkout(7, cancelled=True, cancelled_at=BEFORE), checkout(8, cancelled=True, cancelled_at=FULL_TIME),
        checkout(9, fulfilled=False, cancelled=True, cancelled_at=AFTER),
        {**checkout(10, fulfilled=False, cancelled=True, cancelled_at=AFTER), "partially_fulfilled": True},
        checkout(11), checkout(12, fulfilled_at=None), checkout(13), checkout(14), checkout(15),
    ]
    records = [
        shipment(1, "Livré", delivered=True, adverse=False), shipment(2, "Livré", delivered=True, adverse=False),
        explicit(3, "2026-11-17T09:00:00Z"), explicit(5, AFTER, "Returned"), shipment(6, "Refusé"),
        explicit(7, BEFORE), explicit(10, AFTER), shipment(11, "Returned"), explicit(12, AFTER),
        explicit(13, None), shipment(14, "Deleted"), shipment(15, "Annulé"),
    ]
    report = api._build_report(api.ProductIssueRequest(**BODY), SHOP, orders, {r.id: r for r in records})
    totals = report["summary"]
    assert (totals["received"], totals["fulfilled"], totals["fulfilled_delivered"]) == (15, 12, 1)
    assert totals["delivered"] == 2
    assert totals["fulfilled_cancelled"] == 3
    # Equal timestamps, missing full time, missing cancellation time and a legacy
    # record that supplies only the time of the most recent parcel event.
    assert totals["fulfilled_cancellation_unverified"] == 4
    assert totals["fulfillment_history_unverified"] == 0
    cancelled = {i["order_id"]: i for i in report["issues"] if "Cancelled after fulfillment" in i["reasons"]}
    assert set(cancelled) == {"3", "4", "5"}
    assert datetime.fromisoformat(cancelled["3"]["cancelled_after_fulfillment_at"]) == records[2].cancellation_at
    assert cancelled["4"]["reason_groups"] == {"unmatched": ["No matching Sendo parcel or queue entry"],
                                              "delivery": ["Cancelled after fulfillment"]}
    assert cancelled["5"]["reason_groups"] == {"delivery": ["Parcel returned", "Cancelled after fulfillment"]}


def test_only_explicit_candidates_with_missing_history_are_excluded_as_unverified():
    orders = [{**checkout(n, fulfilled=False, cancelled=n == 1), "fulfillment_history_incomplete": True}
              for n in range(1, 5)]
    records = [shipment(2, "Annulé par vendeur"), shipment(3, "Refusé"), shipment(4, "Livré", delivered=True)]
    records[2].cancellation_reported = True  # stale carrier evidence on a recovered parcel
    result = api._build_report(api.ProductIssueRequest(**BODY), SHOP, orders, {r.id: r for r in records})
    assert result["summary"]["fulfilled"] == result["summary"]["fulfilled_cancelled"] == 0
    assert result["summary"]["fulfilled_delivered"] == result["summary"]["fulfilled_cancellation_unverified"] == 0
    assert result["summary"]["fulfillment_history_unverified"] == 2


def test_known_complete_shipment_can_confirm_chronology_with_an_undated_earlier_shipment():
    orders = [{**checkout(i, cancelled=True, fulfilled_at=None, cancelled_at=when), "fulfilled_by": FULL_TIME}
              for i, when in enumerate((BEFORE, FULL_TIME, AFTER), 1)]
    result = api._build_report(api.ProductIssueRequest(**BODY), SHOP, orders, {})
    assert result["summary"]["fulfilled_cancelled"] == 1
    assert result["summary"]["fulfilled_cancellation_unverified"] == 2


def test_each_reason_keeps_its_category_on_a_single_checkout():
    orders = [checkout(1), checkout(2, mixed=True)]
    records = {o["order_id"]: shipment(o["order_id"], reason="quality", note="trop petite, pas de réponse") for o in orders}
    result = api._build_report(api.ProductIssueRequest(**BODY), SHOP, orders, records)
    rows = {i["order_id"]: i for i in result["issues"]}
    assert rows["1"]["reason_groups"] == {"product": ["Too small", "Quality"], "delivery": ["No answer"]}
    assert rows["2"]["reason_groups"] == {"unattributed": ["Too small", "Quality"], "delivery": ["No answer"]}
    assert result["summary"]["product_complaints"] == 1


@pytest.mark.parametrize(("note", "reason"), [
    ("la qualité est mauvaise, mhlola mn jnab", "Open at the side"),
    ("ma3jbhach gae modela", "Disliked the style"),
    ("b4at nemra kbar mn hadi", "Larger size requested"),
    ("trop petite", "Too small"), ("جاتها صغيرة", "Too small"),
    ("different from the listing photo", "Different from the photo"),
])
def test_explicit_written_complaints_without_a_product_label(note, reason):
    kind, reasons, notes, _ = api.parcel_issue(shipment(1, note=note), False)
    assert kind == "product" and reason in reasons and notes == [note]


def test_checkout_cannot_become_a_product_complaint_from_a_delivery_attempt_or_negated_fit():
    result = api.parcel_issue(shipment(1, status="Pas de réponse 2", adverse=False, note="not too small"), False)
    assert result[:2] == ("delivery", ["No answer"])
    assert api.parcel_issue(shipment(1, "Reporté"), False)[:2] == ("delivery", ["Delivery postponed"])


def test_product_issue_uses_its_first_recorded_time_even_after_a_delivery_attempt():
    record = shipment(1, reason="quality", note="machi bhal photo")
    record.evidence[0].at = datetime.fromisoformat("2026-11-16T12:01:02+00:00")
    record.evidence.append(api.Evidence(reason=None, note="pas de réponse", at="2026-11-18T15:12:01Z"))
    assert api.parcel_issue(record, False)[3] == record.evidence[0].at
    record.evidence[0] = api.Evidence(reason="quality", note=None, at=None)
    report = api._build_report(api.ProductIssueRequest(**BODY), SHOP, [checkout(1)], {"1": record})
    assert report["issues"][0]["kind"] == "product"
    assert report["issues"][0]["occurred_at"] is None


def test_a_failed_second_batch_never_returns_partial_counts(monkeypatch):
    orders = [checkout(i) for i in range(101)]
    monkeypatch.setattr(api, "fetch_product_issue_orders", lambda *a: (SHOP, orders))
    monkeypatch.setattr(api, "launch_secret", lambda: "k" * 40)
    calls = []

    def post(_, url, *, data, headers, **kwargs):
        batch = json.loads(data)
        calls.append(batch)
        expected = hmac.new(b"k" * 40, f"{headers['X-Sendo-Timestamp']}.product-delivery-issues.".encode()
                            + data, hashlib.sha256).hexdigest()
        assert headers["X-Sendo-Signature"] == expected
        assert batch["merchant_id"] == 9 and batch["shop"] == SHOP and kwargs["allow_redirects"] is False
        if len(calls) > 1:
            raise api.requests.Timeout()
        return type("Response", (), {"status_code": 200, "json": lambda self: {"shop": SHOP, "orders": []}})()

    monkeypatch.setattr(api.requests.Session, "post", post)
    result = api.product_delivery_issues(api.ProductIssueRequest(**BODY))["data"]
    assert [len(b["orders"]) for b in calls] == [100, 1]
    assert result["summary"]["received"] == 101 and result["summary"]["tracked"] is None
    assert result["summary"]["unmatched"] is None and result["issues"] == [] and result["warning"]
    assert all(result["summary"][key] is None for key in (
        "fulfilled_delivered", "fulfilled_cancelled", "fulfilled_cancellation_unverified", "fulfillment_history_unverified"))


def test_on_demand_route_only_accepts_authorized_workspace_and_its_store(monkeypatch):
    app = FastAPI()
    app.add_middleware(auth_gate.AuthGateMiddleware)
    app.include_router(api.router)
    client = TestClient(app)
    monkeypatch.setenv("PRODUCT_TESTING_AUTH_SECRET", "synthetic-local-test-key")
    monkeypatch.setenv("PTO_AUTH_GATE", "on")
    from app.sendo_workspace import issue_session_token
    token, _ = issue_session_token({"ws": "m9", "mid": 9, "svc": "true_manager"})
    headers = {"X-Workspace-Token": token}
    calls = []
    monkeypatch.setattr(api, "fetch_product_issue_orders", lambda *args: (calls.append(args) or (SHOP, [])))
    assert client.post(PATH, json=BODY).status_code == 401
    assert client.post(PATH, json={**BODY, "store": "m8"}, headers=headers).status_code == 403
    profit, _ = issue_session_token({"ws": "m9", "mid": 9, "svc": "true_profit"})
    assert client.post(PATH, json=BODY, headers={"X-Workspace-Token": profit}).status_code == 403
    assert not calls
    assert client.post(PATH, json={**BODY, "merchant_id": 8}, headers=headers).status_code == 422
    reply = client.post(PATH, json=BODY, headers=headers)
    assert reply.status_code == 200, reply.text
    assert len(calls) == 1 and reply.json()["data"]["summary"]["received"] == 0
