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


def checkout(number, *, fulfilled=True, cancelled=False, mixed=False):
    return {"order_id": str(number), "order_name": f"#{number}", "fulfilled": fulfilled,
            "partially_fulfilled": False, "cancelled": cancelled, "mixed_basket": mixed,
            "variants": ["Pink / 38"]}


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
                                 "product_complaints": 2}
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
