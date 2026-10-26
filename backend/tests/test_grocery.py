import copy
import asyncio
import inspect
from decimal import Decimal
from uuid import uuid4

import pytest
from fastapi import HTTPException
from fastapi import Request, Response
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import db, grocery, main


@pytest.fixture
def setup(monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    grocery.GroceryOperation.__table__.create(engine)
    grocery.GroceryBarcode.__table__.create(engine)
    db.AppSetting.__table__.create(engine)
    monkeypatch.setattr(db, "SessionLocal", sessionmaker(engine, expire_on_commit=False))
    vendors = {
        "shop": {"id": "shop", "name": "Same name", "password_hash": "server-secret", "account_type": "grocery"},
        "other": {"id": "other", "name": "Same name", "password_hash": "different-secret", "account_type": "grocery"},
        "vendor": {"id": "vendor", "name": "Vendor", "password_hash": "vendor-secret", "account_type": "vendor"},
    }
    original_get_setting = db.get_app_setting
    monkeypatch.setattr(db, "get_app_setting", lambda store, key: vendors.get(key.split(":")[-1]) if key.startswith("wholesale_vendor:") else original_get_setting(store, key))
    monkeypatch.setattr(grocery, "_invalidate", lambda vid: None)
    product = {"id": 1, "title": "Milk", "vendor": "Same name", "tags": "vendor_id:shop, grocery", "variants": [{
        "id": 11, "product_id": 1, "barcode": "012345678905", "sku": "012345678905",
        "price": "2.55", "inventory_quantity": 10, "inventory_item_id": 111,
        "inventory_management": "shopify", "inventory_policy": "deny",
    }]}
    products = [product]
    calls = []

    class Response:
        links = {}
        def __init__(self, data):
            self.data = data
        def json(self):
            return copy.deepcopy(self.data)

    def request(method, path, payload=None):
        calls.append((method, path, copy.deepcopy(payload)))
        if method == "GET":
            if path.startswith("/products.json"):
                return Response({"products": products})
            if path.startswith("/products/"):
                pid = int(path.split("/")[2].split(".")[0])
                return Response({"product": next(p for p in products if p["id"] == pid)})
            if path.startswith("/inventory_levels"):
                return Response({"inventory_levels": [{"location_id": 99, "available": 10}]})
        if method == "POST" and path == "/products.json":
            created = copy.deepcopy(product)
            created.update(payload["product"])
            created["id"] = 2
            created["variants"][0].update({"id": 22, "inventory_item_id": 222, "product_id": 2})
            products.append(created)
            return Response({"product": created})
        if method == "POST" and path == "/inventory_levels/set.json":
            return Response({"inventory_level": {"available": payload["available"]}})
        if method == "POST" and path == "/orders.json":
            order = payload["order"]
            total = sum(Decimal(li["price"]) * li["quantity"] for li in order["line_items"])
            return Response({"order": {**order, "id": 91, "name": "#91", "order_number": 91,
                                      "total_price": str(total), "financial_status": order["financial_status"]}})
        return Response({})

    monkeypatch.setattr(grocery, "_request", request)
    monkeypatch.setattr(main, "_wholesale_enrich_products_inventory", lambda ps: ps)
    from app.integrations import shopify_client
    monkeypatch.setattr(shopify_client, "_get_store_config", lambda store: {"BASE": "https://shop/admin/api/version"})
    monkeypatch.setattr(main, "_wholesale_variant_availability", lambda ids: {
        11: {"variant": product["variants"][0], "available": product["variants"][0]["inventory_quantity"]},
    })
    yield {"auth": "Bearer " + grocery.issue_token(vendors["shop"]), "vendors": vendors,
           "product": product, "products": products, "calls": calls, "request": request, "response": Response}
    engine.dispose()


def product_request(**overrides):
    return grocery.ProductInput(**{"request_id": uuid4(), "barcode": "GROC-NEW", "name": "Rice", "price": "3.20", "stock": 5, **overrides})


def order_request(**overrides):
    return grocery.OrderInput(**{"request_id": uuid4(), "line_items": [{"variant_id": 11, "quantity": 2}], "amount_paid": "6.00", **overrides})


def login_request(username, password):
    req = main.WholesaleLogin(username=username, password=password)
    kwargs = {}
    if "request" in inspect.signature(main.api_wholesale_login).parameters:
        kwargs = {"request": Request({"type": "http", "scheme": "http", "headers": [], "server": ("testserver", 80)}), "response": Response()}
    return asyncio.run(main.api_wholesale_login(req, **kwargs))


def test_auth_requires_grocery_account_and_matching_unexpired_signature(setup, monkeypatch):
    assert grocery.authorize("shop", setup["auth"])[0] == "shop"
    for vid, auth in [("vendor", setup["auth"]), ("other", setup["auth"]), ("shop", None), ("shop", setup["auth"] + "x")]:
        with pytest.raises(HTTPException) as error:
            grocery.authorize(vid, auth)
        assert error.value.status_code in (401, 403)
    monkeypatch.setattr(grocery.time, "time", lambda: 999999999999)
    with pytest.raises(HTTPException) as error:
        grocery.authorize("shop", setup["auth"])
    assert error.value.status_code == 401


def test_password_rotation_revokes_scanner_tokens(setup):
    setup["vendors"]["shop"]["password_hash"] = "changed"
    with pytest.raises(HTTPException):
        grocery.authorize("shop", setup["auth"])


def test_login_returns_scanner_token_only_for_grocery_and_hides_password_hash(setup):
    setup["vendors"]["shop"]["password_hash"] = main._hash_password("correct-password")
    result = login_request("shop", "correct-password")["data"]
    assert result["account_type"] == "grocery"
    assert "password_hash" not in result
    assert grocery.authorize("shop", "Bearer " + result["grocery_token"])[0] == "shop"
    setup["vendors"]["vendor"]["password_hash"] = main._hash_password("correct-password")
    result = login_request("vendor", "correct-password")["data"]
    assert "grocery_token" not in result


def test_create_and_edit_grocery_account_persists_explicit_role(setup, monkeypatch):
    saved = {}
    monkeypatch.setattr(db, "set_app_setting", lambda store, key, value: saved.update(value))
    result = asyncio.run(main.api_wholesale_create_vendor(main.WholesaleVendorCreate(
        name="Grocery", username="new-grocery", password="correct-password", account_type="grocery")))
    assert result["data"]["account_type"] == "grocery"
    assert saved["store_type"] == "grocery"
    assert "password_hash" not in result["data"]
    result = asyncio.run(main.api_wholesale_create_vendor(main.WholesaleVendorCreate(
        name="Renamed", username="shop", password="UNCHANGED_PLACEHOLDER")))
    assert result["data"]["account_type"] == "grocery"
    assert saved["password_hash"] == "server-secret"


def test_legacy_manual_entry_cannot_bypass_grocery_write_checks(setup):
    from fastapi import BackgroundTasks
    result = asyncio.run(main.api_wholesale_create_product("shop", main.WholesaleProductCreate(title="Bypass"), BackgroundTasks()))
    assert result["error"] == "grocery_scanner_required"
    result = asyncio.run(main.api_wholesale_update_variant_inventory("shop", "1", "11", main.WholesaleInventoryUpdate(quantity=5)))
    assert result["error"] == "grocery_scanner_required"
    result = asyncio.run(main.api_wholesale_create_order("shop", main.WholesaleOrderCreate(
        customer_name="Buyer", customer_phone="0611111111", line_items=[{"variant_id": 11, "quantity": 1}])))
    assert result["error"] == "grocery_scanner_required"


def test_gtin_checksum_and_upc_canonicalization():
    assert grocery.canonical_barcode("012345678905") == "0012345678905"
    assert grocery.canonical_barcode("0012345678905") == "0012345678905"
    assert grocery.canonical_barcode("GROC-001") == "GROC-001"
    with pytest.raises(ValueError):
        grocery.canonical_barcode("012345678906")
    with pytest.raises(ValueError):
        grocery.canonical_barcode("bad code\n")


@pytest.mark.parametrize("changes", [{"stock": -1}, {"stock": 1.5}, {"stock": True}, {"price": "NaN"}, {"price": "3.201"}, {"name": " "}])
def test_invalid_product_input_is_rejected(changes):
    with pytest.raises(ValidationError):
        product_request(**changes)


@pytest.mark.parametrize("changes", [{"quantity": 0}, {"quantity": -1}, {"quantity": 1.5}, {"quantity": True}])
def test_invalid_order_quantities_are_rejected(changes):
    with pytest.raises(ValidationError):
        order_request(line_items=[{"variant_id": 11, **changes}])


def test_catalog_is_scoped_by_vendor_id_even_when_vendor_names_match(setup):
    other = copy.deepcopy(setup["product"])
    other.update({"id": 3, "tags": "vendor_id:other"})
    setup["products"].append(other)
    assert [p["id"] for p in grocery.products("shop", setup["auth"])["data"]] == [1]
    assert [p["id"] for p in asyncio.run(main.api_wholesale_vendor_products("shop"))["data"]] == [1]
    assert [p["id"] for p in main._build_vendor_catalog_sync("shop")["products"]] == ["1"]


def test_grocery_orders_require_vendor_id_even_when_vendor_names_match(setup, monkeypatch):
    tags = main._wholesale_tags_csv("Same name", "other") + ", grocery"
    assert main._wholesale_order_matches_vendor({"tags": tags}, "Same name", "shop") is False
    assert main._wholesale_order_matches_vendor({"tags": tags}, "Same name", "other") is True
    own = {"id": 1, "tags": main._wholesale_tags_csv("Same name", "shop") + ", grocery"}
    foreign = {"id": 2, "tags": main._wholesale_tags_csv("Same name", "other")}
    monkeypatch.setattr(main, "_wholesale_fetch_shopify_vendor_orders", lambda *args: [own, foreign])
    history = asyncio.run(main.api_wholesale_vendor_orders("shop"))["data"]["all_orders"]
    assert [order["id"] for order in history] == [1]


def test_grocery_cannot_enqueue_image_batch_or_start_analysis(setup):
    from fastapi import BackgroundTasks
    from app import wholesale_batches
    req = wholesale_batches.BatchRequest(request_id="grocery-batch-bypass", images=[{"image_url": "https://example.test/photo.jpg"}], shared={})
    tasks = BackgroundTasks()
    with pytest.raises(HTTPException) as error:
        asyncio.run(wholesale_batches.create_batch("shop", req, tasks))
    assert error.value.status_code == 403
    assert error.value.detail["error"] == "grocery_scanner_required"
    assert not tasks.tasks


def test_catalog_paginates_and_never_silently_returns_truncated_products(setup, monkeypatch):
    first = setup["response"]({"products": [setup["product"]]})
    first.links = {"next": {"url": "https://shop/admin/api/version/products.json?page_info=second"}}
    second = setup["response"]({"products": [{**setup["product"], "id": 2}]})
    monkeypatch.setattr(grocery, "_request", lambda method, path, payload=None: second if "second" in path else first)
    assert [p["id"] for p in grocery.products("shop", setup["auth"])["data"]] == [1, 2]


def test_same_barcode_returns_existing_without_creating_or_overwriting(setup):
    result = grocery.create_product("shop", product_request(barcode="0012345678905"), setup["auth"])
    assert result["existing"] is True
    assert result["data"]["id"] == 1
    assert all(method == "GET" for method, _, _ in setup["calls"])


def test_product_is_single_variant_and_idempotent_with_real_barcode_and_stock(setup):
    req = product_request()
    result = grocery.create_product("shop", req, setup["auth"])
    assert result["data"]["id"] == 2
    assert grocery.create_product("shop", req, setup["auth"]) == result
    creates = [payload for method, path, payload in setup["calls"] if method == "POST" and path == "/products.json"]
    assert len(creates) == 1
    assert creates[0]["product"]["variants"][0]["barcode"] == "GROC-NEW"
    assert "vendor_id:shop" in creates[0]["product"]["tags"]
    stock = [payload for _, path, payload in setup["calls"] if path == "/inventory_levels/set.json"]
    assert stock[0]["available"] == 5


def test_same_request_id_with_changed_payload_is_rejected(setup):
    req = product_request()
    grocery.create_product("shop", req, setup["auth"])
    with pytest.raises(HTTPException) as error:
        grocery.create_product("shop", product_request(request_id=req.request_id, price="9.00"), setup["auth"])
    assert error.value.detail["error"] == "request_conflict"


def test_ambiguous_product_write_is_not_retried_even_with_new_request_id(setup, monkeypatch):
    def request(method, path, payload=None):
        if method == "POST" and path == "/products.json":
            setup["calls"].append((method, path, payload))
            raise TimeoutError("unknown outcome")
        return setup["request"](method, path, payload)
    monkeypatch.setattr(grocery, "_request", request)
    req = product_request()
    for attempt in (req, req, product_request()):
        with pytest.raises(HTTPException) as error:
            grocery.create_product("shop", attempt, setup["auth"])
        assert error.value.detail["error"] == "needs_review"
    assert sum(method == "POST" and path == "/products.json" for method, path, _ in setup["calls"]) == 1


def test_catalog_read_failure_does_not_claim_or_poison_product_request(setup, monkeypatch):
    req = product_request()
    original = grocery._products
    monkeypatch.setattr(grocery, "_products", lambda *args: (_ for _ in ()).throw(TimeoutError("read unavailable")))
    with pytest.raises(HTTPException) as error:
        grocery.create_product("shop", req, setup["auth"])
    assert error.value.status_code == 503
    with db.SessionLocal() as session:
        assert session.get(grocery.GroceryOperation, grocery._operation_key("shop", req.request_id)) is None
    monkeypatch.setattr(grocery, "_products", original)
    assert grocery.create_product("shop", req, setup["auth"])["data"]["id"] == 2


def test_update_preserves_barcode_and_rejects_foreign_product(setup):
    req = product_request(barcode="0012345678905")
    result = grocery.update_product("shop", "1", req, setup["auth"])
    assert result["data"]["id"] == 1
    setup["product"]["tags"] = "vendor_id:other"
    with pytest.raises(HTTPException) as error:
        grocery.update_product("shop", "1", product_request(), setup["auth"])
    assert error.value.status_code == 404


def test_cash_sale_uses_fresh_price_aggregates_quantities_and_replays_after_stock_changes(setup):
    req = order_request(line_items=[{"variant_id": 11, "quantity": 1}, {"variant_id": 11, "quantity": 1}])
    result = grocery.create_order("shop", req, setup["auth"])
    assert result["data"]["total_price"] == "5.10"
    assert result["data"]["change"] == "0.90"
    assert result["data"]["financial_status"] == "paid"
    setup["product"]["variants"][0]["inventory_quantity"] = 0
    assert grocery.create_order("shop", req, setup["auth"]) == result
    orders = [payload for method, path, payload in setup["calls"] if method == "POST" and path == "/orders.json"]
    assert len(orders) == 1
    assert orders[0]["order"]["line_items"] == [{"variant_id": 11, "quantity": 2, "price": "2.55"}]
    assert orders[0]["order"]["inventory_behaviour"] == "decrement_obeying_policy"
    assert orders[0]["order"]["transactions"][0]["amount"] == "5.10"
    assert "customer" not in orders[0]["order"]


def test_unpaid_sale_is_pending_with_no_payment_transaction(setup):
    result = grocery.create_order("shop", order_request(payment_status="unpaid", amount_paid=None, customer_name="Customer", customer_phone="0611111111"), setup["auth"])
    assert result["data"]["financial_status"] == "pending"
    payload = next(payload for method, path, payload in setup["calls"] if method == "POST" and path == "/orders.json")
    assert "transactions" not in payload["order"]


def test_unpaid_sale_requires_recoverable_customer_identity(setup):
    with pytest.raises(HTTPException) as error:
        grocery.create_order("shop", order_request(payment_status="unpaid", amount_paid=None), setup["auth"])
    assert error.value.detail["error"] == "unpaid_customer_required"
    assert not setup["calls"]


@pytest.mark.parametrize("changes,code", [({"amount_paid": "1.00"}, "insufficient_payment"), ({"line_items": [{"variant_id": 11, "quantity": 11}]}, "insufficient_inventory")])
def test_invalid_sale_does_not_make_external_writes(setup, changes, code):
    with pytest.raises(HTTPException) as error:
        grocery.create_order("shop", order_request(**changes), setup["auth"])
    assert error.value.detail["error"] == code
    assert all(method == "GET" for method, _, _ in setup["calls"])


def test_foreign_or_untracked_variant_cannot_be_sold(setup):
    setup["product"]["tags"] = "vendor_id:other"
    with pytest.raises(HTTPException) as error:
        grocery.create_order("shop", order_request(), setup["auth"])
    assert error.value.status_code == 404
    setup["product"]["tags"] = "vendor_id:shop"
    setup["product"]["variants"][0]["inventory_policy"] = "continue"
    with pytest.raises(HTTPException) as error:
        grocery.create_order("shop", order_request(), setup["auth"])
    assert error.value.detail["error"] == "untracked_inventory"


def test_ambiguous_order_is_never_automatically_reposted(setup, monkeypatch):
    def request(method, path, payload=None):
        if method == "POST" and path == "/orders.json":
            setup["calls"].append((method, path, payload))
            raise TimeoutError("unknown outcome")
        return setup["request"](method, path, payload)
    monkeypatch.setattr(grocery, "_request", request)
    req = order_request()
    for _ in range(2):
        with pytest.raises(HTTPException) as error:
            grocery.create_order("shop", req, setup["auth"])
        assert error.value.detail["error"] == "needs_review"
    assert sum(method == "POST" and path == "/orders.json" for method, path, _ in setup["calls"]) == 1


def test_cash_sale_updates_existing_history_and_customer_debt_ledger(setup, monkeypatch):
    result = grocery.create_order("shop", order_request(customer_name="Sam Customer", customer_phone="0611111111"), setup["auth"])
    order = result["data"]
    monkeypatch.setattr(main, "_wholesale_fetch_shopify_vendor_orders", lambda *args: [order])
    history = asyncio.run(main.api_wholesale_vendor_orders("shop"))["data"]["all_orders"][0]
    assert history["payment_status"] == "paid"
    assert Decimal(str(history["amount_paid"])) == Decimal("5.10")  # Not the 6.00 cash tendered.
    assert history["customer_phone"] == "0611111111"
    ledger = asyncio.run(main.api_wholesale_vendor_customers("shop"))["data"]
    assert ledger["total_unpaid"] == 0
    assert ledger["customers"][0]["customer_name"] == "Sam Customer"
    assert ledger["customers"][0]["total_paid"] == 5.10


def test_history_recovers_cash_payment_and_customer_if_local_commit_or_billing_was_lost(setup, monkeypatch):
    order = {"id": 77, "total_price": "7.20", "financial_status": "paid", "tags": "grocery, vendor_id:shop",
             "note_attributes": [{"name": "grocery_customer_name", "value": "Customer"},
                                 {"name": "grocery_customer_phone", "value": "0611111111"}]}
    monkeypatch.setattr(main, "_wholesale_fetch_shopify_vendor_orders", lambda *args: [order])
    history = asyncio.run(main.api_wholesale_vendor_orders("shop"))["data"]["all_orders"][0]
    assert history["payment_status"] == "paid"
    assert history["amount_paid"] == "7.20"
    assert history["customer_name"] == "Customer"
    assert history["customer_phone"] == "0611111111"
    ledger = asyncio.run(main.api_wholesale_vendor_customers("shop"))["data"]
    assert ledger["total_unpaid"] == 0


@pytest.fixture
def api_client(setup, monkeypatch):
    auth_gate = pytest.importorskip("app.auth_gate")
    monkeypatch.setenv("PTO_AUTH_GATE", "on")
    monkeypatch.setenv("PRODUCT_TESTING_AUTH_SECRET", "grocery-integration-test-secret")
    monkeypatch.setattr(auth_gate, "_vendor_resolver", lambda vid: setup["vendors"].get(vid))
    auth_gate._vendor_cache.clear()
    setup["vendors"]["shop"]["password_hash"] = main._hash_password("test-password")
    setup["vendors"]["vendor"]["password_hash"] = main._hash_password("vendor-password")
    client = TestClient(main.app)
    yield client
    client.close()
    auth_gate._vendor_cache.clear()


def test_api_auth_gate_blocks_anonymous_scanning_and_account_creation(setup, api_client):
    assert api_client.get("/api/wholesale/vendors/shop/grocery/products").status_code == 401
    assert api_client.post("/api/wholesale/vendors", json={"name": "Bad", "username": "bad", "password": "password", "account_type": "grocery"}).status_code == 401
    assert not setup["calls"]


def test_api_login_cookie_and_scanner_token_enable_only_own_grocery_routes(setup, api_client):
    auth_gate = pytest.importorskip("app.auth_gate")
    login = api_client.post("/api/wholesale/login", json={"username": "shop", "password": "test-password"})
    assert login.status_code == 200
    assert auth_gate.VENDOR_COOKIE in login.cookies
    token = login.json()["data"]["grocery_token"]
    headers = {"Authorization": "Bearer " + token}
    assert api_client.get("/api/wholesale/vendors/shop/grocery/products", headers=headers).status_code == 200
    assert api_client.get("/api/wholesale/vendors/other/grocery/products", headers=headers).status_code == 403
    assert api_client.get("/api/wholesale/vendors/shop/grocery/products").status_code == 401
    wrong_token = grocery.issue_token(setup["vendors"]["other"])
    assert api_client.get("/api/wholesale/vendors/shop/grocery/products", headers={"Authorization": "Bearer " + wrong_token}).status_code == 401
    assert api_client.post("/api/wholesale/vendors", headers=headers, json={"name": "Bad", "username": "bad", "password": "password"}).status_code in (401, 403)
    req = product_request()
    created = api_client.post("/api/wholesale/vendors/shop/grocery/products", headers=headers, json=req.model_dump(mode="json"))
    assert created.status_code == 200
    assert created.json()["data"]["id"] == 2
    assert api_client.post("/api/wholesale/vendors/shop/grocery/products", headers={**headers, "Origin": "https://evil.example"}, json=product_request().model_dump(mode="json")).status_code == 403


def test_api_vendor_cookie_cannot_enable_grocery_scanner(setup, api_client):
    login = api_client.post("/api/wholesale/login", json={"username": "vendor", "password": "vendor-password"})
    assert login.status_code == 200
    assert "grocery_token" not in login.json()["data"]
    response = api_client.get("/api/wholesale/vendors/vendor/grocery/products", headers={"Authorization": setup["auth"]})
    assert response.status_code == 403
    assert response.json()["detail"]["error"] == "grocery_only"
