"""Local grocery correctness, isolation and integration regressions."""
import asyncio
import io
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from threading import Barrier
from uuid import uuid4

import pytest
from fastapi import HTTPException, UploadFile
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker
from starlette.datastructures import Headers

from app import auth_gate, db, grocery, main


@pytest.fixture
def local(monkeypatch, tmp_path):
    engine = create_engine("sqlite:///"+str(tmp_path/"local-grocery.db"), connect_args={"check_same_thread": False, "timeout": 20})
    db.Base.metadata.create_all(engine, tables=[db.AppSetting.__table__, *grocery.TABLES])
    monkeypatch.setattr(db, "SessionLocal", sessionmaker(engine, expire_on_commit=False))
    monkeypatch.setenv("PTO_AUTH_GATE", "on")
    monkeypatch.setenv("PRODUCT_TESTING_AUTH_SECRET", "grocery-local-test-secret")
    vendors = {}
    for vid, role in [("shop", "grocery"), ("other", "grocery"), ("vendor", "vendor")]:
        vendors[vid] = {"id": vid, "username": vid, "name": "Same name", "account_type": role,
                       "account_id": str(uuid4()), "password_hash": main._hash_password("test-password")}
        db.set_app_setting(main.WHOLESALE_STORE, main._wholesale_vendor_key(vid), vendors[vid])
    auth_gate._vendor_cache.clear()
    main._chat_catalog_cache.clear()
    calls = []
    def forbidden(*args, **kwargs):
        calls.append((args, kwargs))
        raise AssertionError("Grocery must never call an external commerce service")
    from app.integrations import shopify_client
    monkeypatch.setattr(shopify_client, "_timed_request", forbidden)
    monkeypatch.setattr(shopify_client, "list_products_by_vendor", forbidden)
    monkeypatch.setattr(main, "_wholesale_fetch_shopify_vendor_orders", forbidden)
    monkeypatch.setattr(main, "_wholesale_variant_availability", forbidden)
    yield {"engine": engine, "vendors": vendors, "auth": "Bearer "+grocery.issue_token(vendors["shop"]),
           "other_auth": "Bearer "+grocery.issue_token(vendors["other"]), "calls": calls}
    auth_gate._vendor_cache.clear()
    main._chat_catalog_cache.clear()
    engine.dispose()


def product_request(**changes):
    return grocery.ProductInput(**{"request_id": uuid4(), "name": "Milk", "price": "2.55", "stock": 10, "section": "L", **changes})


def add(local, **changes):
    return grocery.create_product("shop", product_request(**changes), local["auth"])["data"]


def weight(local, **changes):
    return add(local, **{"unit_type": "weight", "stock": None, "name": "Lentils", "pack_count": 2, "pack_weight_kg": "25", "price": "10.00", **changes})


def order_request(product_id, **changes):
    return grocery.OrderInput(**{"request_id": uuid4(), "line_items": [{"product_id": product_id, "quantity": 2}], **changes})


def checkout(local, product_id, **changes):
    return grocery.create_order("shop", order_request(product_id, **changes), local["auth"])


def stock(local, product_id):
    return next(p for p in grocery.list_products("shop")["data"] if p["id"] == product_id)


def count(model):
    with db.SessionLocal() as session:
        return session.scalar(select(func.count()).select_from(model))


def test_authorization_requires_actual_grocery_account_and_scope_bound_token(local):
    assert grocery.authorize("shop", local["auth"])[0] == "shop"
    for vid, token in [("vendor", local["auth"]), ("shop", None), ("other", local["auth"]), ("shop", local["auth"]+"x")]:
        with pytest.raises(HTTPException) as error:
            grocery.authorize(vid, token)
        assert error.value.status_code in (401, 403)


def test_recycling_username_with_new_account_uuid_cannot_inherit_data_or_token(local):
    row = add(local)
    checkout(local, row["id"], customer_name="Old buyer", customer_phone="0611111111")
    replacement = {**local["vendors"]["shop"], "account_id": str(uuid4())}
    db.set_app_setting(main.WHOLESALE_STORE, main._wholesale_vendor_key("shop"), replacement)
    with pytest.raises(HTTPException):
        grocery.authorize("shop", local["auth"])
    assert grocery.list_products("shop")["data"] == []
    assert grocery.list_orders("shop")["data"]["all_orders"] == []
    assert grocery.list_customers("shop")["data"]["customers"] == []
    assert count(grocery.GroceryProduct) == 1  # Original data is preserved.


def test_password_rotation_and_expiry_revoke_tokens(local, monkeypatch):
    vendor = {**local["vendors"]["shop"], "password_hash": main._hash_password("changed")}
    db.set_app_setting(main.WHOLESALE_STORE, main._wholesale_vendor_key("shop"), vendor)
    with pytest.raises(HTTPException):
        grocery.authorize("shop", local["auth"])
    fresh = "Bearer "+grocery.issue_token(vendor)
    monkeypatch.setattr(grocery.time, "time", lambda: 999999999999)
    with pytest.raises(HTTPException):
        grocery.authorize("shop", fresh)


def test_missing_immutable_scope_fails_without_username_fallback(local):
    vendor = {**local["vendors"]["shop"]}
    vendor.pop("account_id")
    db.set_app_setting(main.WHOLESALE_STORE, main._wholesale_vendor_key("shop"), vendor)
    with pytest.raises(HTTPException) as error:
        grocery.list_products("shop")
    assert error.value.detail["error"] == "account_setup_required"


@pytest.mark.parametrize("code,expected", [("l23", "L-23"), ("l-2", "L-02"), (" L 234 ", "L-234"), ("l-00023", "L-23")])
def test_short_code_normalization(code, expected):
    assert grocery.canonical_short_code(code) == expected


def test_gtin_checksum_and_upc_preserve_leading_zero():
    assert grocery.canonical_barcode("012345678905") == "0012345678905"
    with pytest.raises(ValueError):
        grocery.canonical_barcode("012345678906")


@pytest.mark.parametrize("changes", [{"stock": -1}, {"stock": 1.5}, {"stock": True}, {"price": "NaN"}, {"price": "2.555"}, {"name": " "}, {"section": "L 1"}, {"unit_type": "weight", "stock": 2}, {"pack_count": 2}, {"unit_type": "weight", "stock": None, "pack_count": 1, "pack_weight_kg": "0.0001"}])
def test_invalid_product_values_are_rejected(changes):
    with pytest.raises(ValidationError):
        product_request(**changes)


def test_products_are_local_persistent_and_short_codes_are_per_account_section(local):
    first, second = add(local), add(local, name="Rice")
    third = add(local, section="R")
    assert [first["short_code"], second["short_code"], third["short_code"]] == ["L-01", "L-02", "R-01"]
    other = grocery.create_product("other", product_request(), local["other_auth"])["data"]
    assert other["short_code"] == "L-01"
    assert len(grocery.list_products("shop")["data"]) == 3
    assert len(grocery.list_products("other")["data"]) == 1
    assert local["calls"] == []


def test_short_code_prefix_suggestions_do_not_confuse_exact_ids(local):
    row = add(local)
    with db.SessionLocal() as session:
        product = session.get(grocery.GroceryProduct, row["id"])
        product.short_code = "L-234"
        session.commit()
    assert grocery.products("shop", search="l23", authorization=local["auth"])["data"][0]["short_code"] == "L-234"
    assert grocery.products("shop", search="missing", authorization=local["auth"])["data"] == []


def test_product_replay_conflict_and_barcode_duplicate_do_not_overwrite_stock(local):
    req = product_request(barcode="012345678905")
    first = grocery.create_product("shop", req, local["auth"])
    assert grocery.create_product("shop", req, local["auth"]) == first
    with pytest.raises(HTTPException) as error:
        grocery.create_product("shop", req.model_copy(update={"price": Decimal("9.99")}), local["auth"])
    assert error.value.detail["error"] == "request_conflict"
    duplicate = grocery.create_product("shop", product_request(barcode="0012345678905", stock=900), local["auth"])
    assert duplicate["existing"] is True
    assert duplicate["data"]["stock"] == 10
    assert count(grocery.GroceryProduct) == 1


def test_barcode_cannot_conflict_with_another_product_short_code(local):
    row = add(local)
    for barcode in ("L-01", "l-00001"):
        with pytest.raises(HTTPException) as error:
            add(local, barcode=barcode)
        assert error.value.detail["error"] == "alias_conflict"
    assert count(grocery.GroceryProduct) == 1
    second = add(local)
    with pytest.raises(HTTPException) as error:
        grocery.update_product("shop", str(row["id"]), product_request(barcode="l-00002"), local["auth"])
    assert error.value.detail["error"] == "alias_conflict"
    assert stock(local, second["id"])["short_code"] == "L-02"


def test_product_can_add_or_remove_own_barcode_without_losing_short_code(local):
    row = add(local)
    updated = grocery.update_product("shop", str(row["id"]), product_request(barcode="GROC-ONE"), local["auth"])["data"]
    assert updated["barcode"] == "GROC-ONE"
    assert updated["short_code"] == "L-01"
    unchanged = grocery.update_product("shop", str(row["id"]), product_request(stock=8), local["auth"])["data"]
    assert unchanged["barcode"] == "GROC-ONE"
    removed = grocery.update_product("shop", str(row["id"]), product_request(barcode=None), local["auth"])["data"]
    assert removed["barcode"] is None
    assert removed["short_code"] == "L-01"


def test_code_allocator_skips_short_code_equivalent_barcode_aliases(local):
    first = add(local, barcode="l-00002")
    second = add(local)
    assert first["short_code"] == "L-01"
    assert second["short_code"] == "L-03"
    duplicate = grocery.create_product("shop", product_request(barcode="L-02"), local["auth"])
    assert duplicate["existing"] is True
    assert duplicate["data"]["id"] == first["id"]


def test_weight_stock_packs_sale_and_exact_once_cancellation(local):
    row = weight(local)
    assert row["stock_grams"] == 50000
    assert row["variants"][0]["inventory_available"] == 50
    req = order_request(row["id"], line_items=[{"product_id": row["id"], "grams": 500}], amount_paid="6.00")
    result = grocery.create_order("shop", req, local["auth"])
    assert result["data"]["total_price"] == "5.00"
    assert result["data"]["change"] == "1.00"
    assert result["data"]["line_items"][0]["quantity"] == 0.5
    assert result["data"]["line_items"][0]["unit"] == "kg"
    assert result["products"][0]["stock_grams"] == 49500
    assert result["inventory_updates"][0]["inventory_quantity"] == 49.5
    assert stock(local, row["id"])["stock_grams"] == 49500
    assert grocery.create_order("shop", req, local["auth"]) == result
    first = grocery.cancel_order("shop", result["data"]["id"])
    assert first["data"]["is_cancelled"] is True
    assert stock(local, row["id"])["stock_grams"] == 50000
    second = grocery.cancel_order("shop", result["data"]["id"])
    assert second["data"]["already_cancelled"] is True
    assert stock(local, row["id"])["stock_grams"] == 50000


def test_weight_restock_and_absolute_correction_are_replayable(local):
    row = weight(local)
    req = product_request(stock=None, unit_type="weight", pack_count=1, pack_weight_kg="0.125")
    update = grocery.update_product("shop", str(row["id"]), req, local["auth"])
    assert update["data"]["stock_grams"] == 50125
    assert grocery.update_product("shop", str(row["id"]), req, local["auth"]) == update
    corrected = grocery.update_product("shop", str(row["id"]), product_request(stock=None, unit_type="weight", stock_grams=125), local["auth"])
    assert corrected["data"]["variants"][0]["inventory_quantity"] == 0.125


def test_currency_rounds_half_up_per_aggregated_product_line(local):
    row = weight(local, price="1.00")
    result = checkout(local, row["id"], line_items=[{"product_id": row["id"], "grams": 5}])
    assert result["data"]["total_price"] == "0.01"
    assert result["data"]["line_items"][0]["line_total"] == "0.01"


def test_duplicate_order_lines_are_aggregated_and_fresh_price_used(local):
    row = add(local)
    result = checkout(local, row["id"], line_items=[{"product_id": row["id"], "quantity": 1}, {"variant_id": row["id"], "quantity": 2}], amount_paid="10.00")
    assert result["data"]["total_price"] == "7.65"
    assert len(result["data"]["line_items"]) == 1
    assert stock(local, row["id"])["stock"] == 7


def test_failed_checkout_rolls_back_every_stock_decrement_and_receipt(local):
    first, second = add(local), add(local, stock=1)
    req = order_request(first["id"], line_items=[{"product_id": first["id"], "quantity": 2}, {"product_id": second["id"], "quantity": 2}])
    operations_before = count(grocery.GroceryOperation)
    with pytest.raises(HTTPException) as error:
        grocery.create_order("shop", req, local["auth"])
    assert error.value.detail["error"] == "insufficient_inventory"
    assert stock(local, first["id"])["stock"] == 10
    assert stock(local, second["id"])["stock"] == 1
    assert count(grocery.GroceryOrder) == count(grocery.GroceryOrderLine) == 0
    assert count(grocery.GroceryOperation) == operations_before


def test_insufficient_cash_rolls_back_stock_and_customer(local):
    row = add(local)
    with pytest.raises(HTTPException) as error:
        checkout(local, row["id"], amount_paid="1.00", customer_name="Buyer", customer_phone="0611111111")
    assert error.value.detail["error"] == "insufficient_payment"
    assert stock(local, row["id"])["stock"] == 10
    assert count(grocery.GroceryCustomer) == count(grocery.GroceryOrder) == 0


def test_oversized_currency_total_fails_cleanly_without_stock_write(local):
    row = add(local, price="9999999999.99", stock=1000000)
    with pytest.raises(HTTPException) as error:
        checkout(local, row["id"], line_items=[{"product_id": row["id"], "quantity": 1000000}])
    assert error.value.detail["error"] == "order_total_too_large"
    assert stock(local, row["id"])["stock"] == 1000000
    assert count(grocery.GroceryOrder) == 0


def test_lost_response_replays_receipt_after_last_item_sold_and_price_changed(local):
    row = add(local, stock=2)
    req = order_request(row["id"])
    first = grocery.create_order("shop", req, local["auth"])
    grocery.update_product("shop", str(row["id"]), product_request(price="99.99", stock=0), local["auth"])
    assert grocery.create_order("shop", req, local["auth"]) == first
    assert count(grocery.GroceryOrder) == 1


def test_account_isolation_covers_product_order_payment_status_cancel_and_request_ids(local):
    row = add(local)
    sale = checkout(local, row["id"])["data"]
    for action in [lambda: grocery.update_product("other", str(row["id"]), product_request(), local["other_auth"]),
                   lambda: grocery.create_order("other", order_request(row["id"]), local["other_auth"]),
                   lambda: grocery.cancel_order("other", sale["id"]),
                   lambda: grocery.update_payment("other", sale["id"], {"amount_paid": "0", "payment_status": "unpaid"}),
                   lambda: grocery.update_status("other", sale["id"], {"order_status": "fulfilled"})]:
        with pytest.raises(HTTPException) as error:
            action()
        assert error.value.status_code == 404
    assert grocery.list_orders("other")["data"]["all_orders"] == []
    assert grocery.list_customers("other")["data"]["customers"] == []


def test_credit_sales_and_payments_use_local_customer_ledger(local):
    row = add(local)
    sale = checkout(local, row["id"], payment_status="unpaid", customer_name="Buyer", customer_phone="+212611111111")["data"]
    assert grocery.list_customers("shop")["data"]["total_unpaid"] == "5.10"
    grocery.update_payment("shop", sale["id"], {"payment_status": "partially_paid", "amount_paid": "1.10"})
    assert grocery.list_customers("shop")["data"]["total_unpaid"] == "4.00"
    grocery.update_payment("shop", sale["id"], {"payment_status": "paid", "amount_paid": "5.10"})
    assert grocery.list_customers("shop")["data"]["total_unpaid"] == "0.00"
    grocery.update_status("shop", sale["id"], {"order_status": "fulfilled"})
    assert grocery.list_orders("shop")["data"]["all_orders"][0]["fulfillment_status"] == "fulfilled"
    assert local["calls"] == []


def test_anonymous_credit_and_overpayment_are_rejected(local):
    row = add(local)
    with pytest.raises(HTTPException):
        checkout(local, row["id"], payment_status="unpaid")
    sale = checkout(local, row["id"])["data"]
    with pytest.raises(HTTPException):
        grocery.update_payment("shop", sale["id"], {"payment_status": "paid", "amount_paid": "99.00"})


@pytest.mark.parametrize("line", [{"quantity": 0}, {"quantity": -1}, {"quantity": True}, {"quantity": 0.5}, {"grams": 0}, {"grams": 1.5}, {"product_id": 2, "variant_id": 1, "quantity": 1}])
def test_invalid_sale_quantities_and_ambiguous_ids_are_rejected(line):
    with pytest.raises(ValidationError):
        grocery.OrderInput(request_id=uuid4(), line_items=[{"product_id": 1, **line}])


def test_weight_and_unit_sale_modes_cannot_be_confused(local):
    weighted, unit = weight(local), add(local)
    with pytest.raises(HTTPException) as error:
        checkout(local, weighted["id"])
    assert error.value.detail["error"] == "grams_required"
    with pytest.raises(HTTPException) as error:
        checkout(local, unit["id"], line_items=[{"product_id": unit["id"], "grams": 500}])
    assert error.value.detail["error"] == "quantity_required"


def test_concurrent_checkout_cannot_oversell_last_units(local):
    row = add(local, stock=3)
    barrier = Barrier(2)
    def sell():
        barrier.wait()
        try:
            return checkout(local, row["id"])["data"]["id"]
        except HTTPException as error:
            return error.detail["error"]
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: sell(), range(2)))
    assert sum(isinstance(result, int) for result in results) == 1
    assert "insufficient_inventory" in results
    assert stock(local, row["id"])["stock"] == 1
    assert count(grocery.GroceryOrder) == 1


def test_concurrent_duplicate_uuid_returns_one_sale_and_one_decrement(local):
    row = add(local, stock=2)
    req, barrier = order_request(row["id"]), Barrier(2)
    def sell():
        barrier.wait()
        return grocery.create_order("shop", req, local["auth"])
    with ThreadPoolExecutor(max_workers=2) as pool:
        first, second = list(pool.map(lambda _: sell(), range(2)))
    assert first == second
    assert count(grocery.GroceryOrder) == 1
    assert stock(local, row["id"])["stock"] == 0


def test_concurrent_barcode_creation_and_section_code_allocation_are_unique(local):
    barrier = Barrier(2)
    def create():
        barrier.wait()
        return grocery.create_product("shop", product_request(barcode="GROC-ONE"), local["auth"])["data"]
    with ThreadPoolExecutor(max_workers=2) as pool:
        first, second = list(pool.map(lambda _: create(), range(2)))
    assert first["id"] == second["id"]
    assert first["short_code"] == "L-01"
    assert count(grocery.GroceryProduct) == 1


def test_image_upload_checks_magic_and_ownership_and_preserves_omitted_image(local, monkeypatch):
    from PIL import Image
    from app import storage
    buf = io.BytesIO()
    Image.new("RGB", (4, 4), "red").save(buf, "PNG")
    saved = []
    monkeypatch.setattr(storage, "save_file", lambda name, data: saved.append((name, data)) or "/uploads/"+name)
    upload = UploadFile(io.BytesIO(buf.getvalue()), filename="../../evil.png", headers=Headers({"content-type": "image/png"}))
    path = asyncio.run(grocery.upload_image("shop", upload, local["auth"]))["data"]["image_url"]
    assert path.startswith("/uploads/grocery_") and "evil" not in path
    row = add(local, image_url=path)
    updated = grocery.update_product("shop", str(row["id"]), product_request(stock=9), local["auth"])["data"]
    assert updated["image_url"] == path
    with pytest.raises(HTTPException):
        grocery.create_product("other", product_request(image_url=path), local["other_auth"])
    bad = UploadFile(io.BytesIO(b"<svg></svg>"), filename="fake.jpg", headers=Headers({"content-type": "image/jpeg"}))
    with pytest.raises(HTTPException) as error:
        asyncio.run(grocery.upload_image("shop", bad, local["auth"]))
    assert error.value.detail["error"] == "invalid_image"


def test_image_bytes_survive_missing_disk_cache_and_are_served_from_database(local, monkeypatch, tmp_path):
    from PIL import Image
    from app import storage
    buf = io.BytesIO()
    Image.new("RGB", (4, 4), "green").save(buf, "PNG")
    monkeypatch.setattr(storage, "save_file", lambda *args: (_ for _ in ()).throw(OSError("disk cache unavailable")))
    monkeypatch.setattr(main, "UPLOADS_DIR", str(tmp_path/"empty-cache"))
    upload = UploadFile(io.BytesIO(buf.getvalue()), filename="image.png", headers=Headers({"content-type": "image/png"}))
    path = asyncio.run(grocery.upload_image("shop", upload, local["auth"]))["data"]["image_url"]
    response = TestClient(main.app).get(path)
    assert response.status_code == 200
    assert response.content == buf.getvalue()
    assert response.headers["content-type"].startswith("image/png")


@pytest.fixture
def client(local):
    with TestClient(main.app, raise_server_exceptions=True) as session:
        login = session.post("/api/wholesale/login", json={"username": "shop", "password": "test-password"})
        assert login.status_code == 200
        session.headers["Authorization"] = "Bearer "+login.json()["data"]["grocery_token"]
        yield session


def test_actual_api_login_cookie_local_products_checkout_and_generic_history(local, client):
    response = client.post("/api/wholesale/vendors/shop/grocery/products", json=product_request().model_dump(mode="json"))
    assert response.status_code == 200
    row = response.json()["data"]
    sale = client.post("/api/wholesale/vendors/shop/grocery/orders", json=order_request(row["id"]).model_dump(mode="json"))
    assert sale.status_code == 200
    assert client.get("/api/wholesale/vendors/shop/products").json()["data"][0]["stock"] == 8
    assert client.get("/api/wholesale/vendors/shop/orders").json()["data"]["all_orders"][0]["id"] == sale.json()["data"]["id"]
    assert client.get("/api/wholesale/vendors/shop/customers").json()["data"]["total_unpaid"] == "0.00"
    assert client.get("/api/wholesale/vendors/other/grocery/products").status_code == 403
    assert local["calls"] == []


def test_generic_api_rejects_foreign_object_ids_with_real_404(local, client):
    other_product = grocery.create_product("other", product_request(), local["other_auth"])["data"]
    other_order = grocery.create_order("other", order_request(other_product["id"]), local["other_auth"])["data"]
    base = f"/api/wholesale/vendors/shop/orders/{other_order['id']}"
    for method, path, payload in [
        ("post", base+"/cancel", {"reason": "customer"}),
        ("patch", base+"/status", {"order_status": "fulfilled"}),
        ("patch", base+"/payment", {"payment_status": "unpaid", "amount_paid": 0}),
    ]:
        response = getattr(client, method)(path, json=payload)
        assert response.status_code == 404
        assert response.json()["detail"]["error"] == "order_not_found"
    response = client.patch(f"/api/wholesale/vendors/shop/grocery/products/{other_product['id']}", json=product_request().model_dump(mode="json"))
    assert response.status_code == 404
    assert response.json()["detail"]["error"] == "product_not_found"
    assert grocery.list_products("other")["data"][0]["stock"] == 8
    assert grocery.list_orders("other")["data"]["all_orders"][0]["is_cancelled"] is False
    assert local["calls"] == []


def test_all_generic_grocery_adapters_use_local_storage(local):
    row = add(local)
    sale = checkout(local, row["id"], payment_status="unpaid", customer_name="Buyer", customer_phone="0611111111")["data"]
    assert asyncio.run(main.api_wholesale_vendor_products("shop"))["data"][0]["id"] == row["id"]
    assert main._build_vendor_catalog_sync("shop")["products"][0]["id"] == str(row["id"])
    assert asyncio.run(main.api_wholesale_vendor_orders("shop"))["data"]["all_orders"][0]["id"] == sale["id"]
    assert asyncio.run(main.api_wholesale_vendor_customers("shop"))["data"]["total_unpaid"] == "5.10"
    payment = asyncio.run(main.api_wholesale_update_order_payment("shop", str(sale["id"]), main.WholesaleOrderPaymentUpdate(payment_status="paid", amount_paid=5.10)))
    assert payment["data"]["payment_status"] == "paid"
    status = asyncio.run(main.api_wholesale_update_order_status("shop", str(sale["id"]), main.WholesaleOrderStatusUpdate(order_status="fulfilled")))
    assert status["data"]["order_status"] == "fulfilled"
    cancelled = asyncio.run(main.api_wholesale_cancel_order("shop", str(sale["id"]), main.WholesaleOrderCancelRequest()))
    assert cancelled["data"]["is_cancelled"] is True
    assert stock(local, row["id"])["stock"] == 10
    assert local["calls"] == []


def test_chat_catalog_keeps_fractional_weight_and_available_stock(local):
    row = weight(local)
    checkout(local, row["id"], line_items=[{"product_id": row["id"], "grams": 49875}])
    catalog = main._build_vendor_catalog_sync("shop")
    assert len(catalog["products"]) == 1
    product = catalog["products"][0]
    assert product["available"] == 0.125
    assert product["variants"][0]["available"] == 0.125
    assert local["calls"] == []
