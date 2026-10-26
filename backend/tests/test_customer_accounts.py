import asyncio
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from threading import Barrier
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker

from app import affiliates, auth_gate, customer_accounts as portal, db, grocery, main


@pytest.fixture
def setup(monkeypatch, tmp_path):
    engine = create_engine("sqlite:///"+str(tmp_path/"customers.db"), connect_args={"check_same_thread": False, "timeout": 20})
    db.Base.metadata.create_all(engine, tables=[db.AppSetting.__table__, affiliates.Seller.__table__, affiliates.SellerSession.__table__, *grocery.TABLES, *portal.TABLES])
    monkeypatch.setattr(db, "SessionLocal", sessionmaker(engine, expire_on_commit=False))
    monkeypatch.setenv("PRODUCT_TESTING_AUTH_SECRET", "customer-tests-only")
    monkeypatch.setenv("PTO_AUTH_GATE", "on")
    vendor = {"id": "grocer", "username": "grocer", "name": "Local Grocer", "account_type": "grocery",
              "account_id": str(uuid4()), "chat_id": "vendor:"+str(uuid4()), "password_hash": main._hash_password("merchant-password")}
    db.set_app_setting(main.WHOLESALE_STORE, main._wholesale_vendor_key("grocer"), vendor)
    merchants = {
        ("vendor", vendor["account_id"]): {"kind": "vendor", "account_id": vendor["account_id"], "name": vendor["name"],
            "chat_id": vendor["chat_id"], "vendor_id": "grocer", "locator": "grocer", "vendor": vendor, "account_type": "grocery"},
        ("vendor", str(uuid4())): {"name": "Wholesaler", "kind": "vendor", "chat_id": "vendor:"+str(uuid4()), "account_type": "vendor", "locator": "wholesaler"},
        ("seller", uuid4().hex): {"name": "Seller", "kind": "seller", "chat_id": "seller:"+uuid4().hex, "account_type": "seller", "requires_delivery": True},
    }
    for (kind, aid), merchant in merchants.items():
        merchant["account_id"] = aid
    calls = []
    def resolve(kind, aid, locator=None):
        merchant = merchants.get((kind, aid))
        if not merchant or (locator and merchant.get("locator") and locator != merchant.get("locator")):
            raise HTTPException(404, {"error": "merchant_unavailable"})
        return merchant
    def catalog(merchant):
        if merchant["account_type"] == "grocery":
            products = grocery._products("grocer", vendor)
        else:
            products = [{"id": "store:1", "title": "Public product", "cost_price": "1.00", "profit": "8.00", "unit_cost": "1.00",
                "fulfillment_group": "store", "currency": "MAD", "variants": [{"id": "store:11", "price": "10.00", "available": 9, "unit_cost": "1.00", "discount_percent": 90}]}]
        return {"products": products, "collections": [{"id": "c1", "title": "Collection"}], "currency": "MAD",
                "delivery_fee": "20.00", "delivery_cities": [{"id": "city", "name": "City"}], "pricing": {"private": True}}
    def place(merchant, payload, customer):
        calls.append((merchant, payload, customer))
        return {"data": {"id": 901, "name": "#W901", "total_price": "10.00", "cost": 1, "profit": 99,
                         "line_items": [{"product_id": "store:1", "variant_id": "store:11", "quantity": 1, "price": "10.00", "unit_cost": "1.00"}]}}
    adapter = SimpleNamespace(resolve_merchant=resolve, catalog=catalog, place_order=place, list_merchants=lambda: list(merchants.values()))
    monkeypatch.setattr(portal, "_adapter", lambda: adapter)
    app = FastAPI()
    app.include_router(portal.router)
    clients = []
    def client():
        value = TestClient(app)
        clients.append(value)
        return value
    invitations = [portal.make_invite(kind, aid, merchant.get("locator")) for (kind, aid), merchant in merchants.items()]
    portal._LOGIN_FAILS.clear()
    auth_gate._vendor_cache.clear()
    yield {"engine": engine, "vendor": vendor, "merchants": merchants, "adapter": adapter, "calls": calls,
           "client": client, "invites": invitations, "app": app}
    for value in clients:
        value.close()
    auth_gate._vendor_cache.clear()
    engine.dispose()


def register(setup, phone="0611111111", invite=0, **changes):
    client = setup["client"]()
    response = client.post("/api/customers/register", json={"phone": phone, "password": "customer-password",
        "password_confirm": "customer-password", "name": "Customer", "invite": setup["invites"][invite]["invite"], **changes})
    assert response.status_code == 200, response.text
    return client, response.json()["data"]


def add_product(setup, **changes):
    return grocery.create_product("grocer", grocery.ProductInput(**{"request_id": uuid4(), "name": "Lentils", "section": "L",
        "price": "10.00", "stock": 10, **changes}), "Bearer "+grocery.issue_token(setup["vendor"]))["data"]


def cart(setup, product, **changes):
    return {"request_id": str(uuid4()), "merchant_ref": setup["invites"][0]["merchant"]["ref"],
            "line_items": [{"product_id": product["id"], "variant_id": product["id"], "quantity": 2}], **changes}


def count(model):
    with db.SessionLocal() as session:
        return session.scalar(select(func.count()).select_from(model))


def test_registration_uses_scrypt_hashed_sessions_and_private_http_only_cookie(setup):
    client, account = register(setup)
    assert account["phone"] == "+212611111111"
    assert account["chat_id"] == "customer:"+account["id"]
    assert account["phone_verified"] is False
    assert "password_hash" not in account and "token" not in account
    token = client.cookies.get(portal.CUSTOMER_COOKIE)
    assert portal.verify_session_token(token)["sub"] == account["id"]
    with db.SessionLocal() as session:
        row = session.get(portal.CustomerAccount, account["id"])
        assert row.password_hash.startswith("scrypt$")
        assert "customer-password" not in row.password_hash
        auth = session.get(portal.CustomerSession, portal._token_hash(token))
        assert auth and auth.token_hash != token


def test_phone_equivalence_duplicate_registration_never_resets_account_or_links_other_merchant(setup):
    client, account = register(setup)
    duplicate = setup["client"]().post("/api/customers/register", json={"phone": "+212 611111111", "password": "different-password",
        "password_confirm": "different-password", "invite": setup["invites"][1]["invite"]})
    assert duplicate.status_code == 409
    assert count(portal.CustomerAccount) == 1
    assert len(client.get("/api/customers/merchants").json()["data"]) == 1
    login = setup["client"]().post("/api/customers/login", json={"phone": "+212611111111", "password": "different-password"})
    assert login.status_code == 401
    assert client.get("/api/customers/me").json()["data"]["id"] == account["id"]


def test_simultaneous_registration_of_same_canonical_phone_creates_one_lifetime(setup):
    barrier = Barrier(2)
    clients = [setup["client"](), setup["client"]()]
    def create(index):
        barrier.wait()
        return clients[index].post("/api/customers/register", json={"phone": ["0611111111", "+212611111111"][index],
            "password": "customer-password", "password_confirm": "customer-password", "invite": setup["invites"][0]["invite"]}).status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(create, range(2)))
    assert sorted(results) == [200, 409]
    assert count(portal.CustomerAccount) == 1
    assert count(portal.CustomerMerchantLink) == 1


def test_password_confirmation_required_on_registration_and_admin_creation(setup):
    client = setup["client"]()
    bad = client.post("/api/customers/register", json={"phone": "0611111111", "password": "customer-password", "password_confirm": "different-password", "invite": setup["invites"][0]["invite"]})
    assert bad.status_code == 422
    bad = client.post("/api/customers/admin/accounts", json={"phone": "0611111111", "password": "customer-password", "password_confirm": "different-password"})
    assert bad.status_code == 422
    assert count(portal.CustomerAccount) == 0


def test_invalid_expired_rotated_and_deleted_merchant_invites_fail(setup):
    client = setup["client"]()
    token = setup["invites"][0]["invite"]
    assert client.get("/api/customers/invites/invalid").status_code == 404
    with db.SessionLocal() as session:
        invite = session.scalar(select(portal.MerchantInvitation).where(portal.MerchantInvitation.token_hash == portal._token_hash(token)))
        invite.expires_at = datetime.utcnow()-timedelta(seconds=1)
        session.commit()
    assert client.get("/api/customers/invites/"+token).status_code == 404
    old = setup["invites"][1]
    merchant = old["merchant"]
    entry = next(m for m in setup["merchants"].values() if m["name"] == merchant["name"])
    new = portal.make_invite(entry["kind"], entry["account_id"], entry.get("locator"), rotate=True)
    assert client.get("/api/customers/invites/"+old["invite"]).status_code == 404
    assert client.get("/api/customers/invites/"+new["invite"]).status_code == 200


def test_reusable_invitation_contains_no_customer_data_and_hash_only_is_stored(setup):
    invite = setup["invites"][0]
    again = portal.make_invite("vendor", setup["vendor"]["account_id"], "grocer")
    assert invite["invite"] == again["invite"]
    info = setup["client"]().get("/api/customers/invites/"+invite["invite"]).json()["data"]
    assert info["merchant"]["name"] == "Local Grocer"
    assert "phone" not in json.dumps(info)
    with db.SessionLocal() as session:
        row = session.scalar(select(portal.MerchantInvitation).where(portal.MerchantInvitation.token_hash == portal._token_hash(invite["invite"])))
        assert row.token_hash != invite["invite"]


def test_successful_login_with_invite_links_second_merchant_and_failed_login_cannot_link(setup):
    client, _ = register(setup)
    second = setup["invites"][1]["invite"]
    assert setup["client"]().post("/api/customers/login", json={"phone": "0611111111", "password": "wrong", "invite": second}).status_code == 401
    assert len(client.get("/api/customers/merchants").json()["data"]) == 1
    login = client.post("/api/customers/login", json={"phone": "0611111111", "password": "customer-password", "invite": second})
    assert login.status_code == 200
    assert len(client.get("/api/customers/merchants").json()["data"]) == 2
    assert client.post("/api/customers/links", json={"invite": second}).status_code == 200
    assert len(client.get("/api/customers/merchants").json()["data"]) == 2


def test_cookie_expiry_logout_and_bearer_reuse_do_not_authenticate_customer(setup):
    client, _ = register(setup)
    token = client.cookies.get(portal.CUSTOMER_COOKIE)
    outsider = setup["client"]()
    assert outsider.get("/api/customers/me", headers={"Authorization": "Bearer "+token}).status_code == 401
    with db.SessionLocal() as session:
        auth = session.get(portal.CustomerSession, portal._token_hash(token))
        auth.expires_at = datetime.utcnow()-timedelta(seconds=1)
        session.commit()
    assert client.get("/api/customers/me").status_code == 401
    client.post("/api/customers/login", json={"phone": "0611111111", "password": "customer-password"})
    current = client.cookies.get(portal.CUSTOMER_COOKIE)
    assert client.post("/api/customers/logout").status_code == 200
    assert portal.verify_session_token(current) is None


def test_customer_catalog_is_link_scoped_and_strips_costs_and_seller_economics(setup):
    client, _ = register(setup, invite=2)
    linked = setup["invites"][2]["merchant"]["ref"]
    response = client.get(f"/api/customers/merchants/{linked}/catalog")
    assert response.status_code == 200
    public = response.json()["data"]
    assert public["products"][0]["variants"][0]["price"] == "10.00"
    assert public["products"][0]["fulfillment_group"] == "store"
    assert public["delivery_fee"] == "20.00"
    encoded = json.dumps(public)
    assert all(private not in encoded for private in ("unit_cost", "cost_price", "discount_percent", "profit", "pricing"))
    foreign = setup["invites"][0]["merchant"]["ref"]
    assert client.get(f"/api/customers/merchants/{foreign}/catalog").status_code == 404


def test_grocery_portal_order_has_atomic_owner_mapping_stock_and_unpaid_merchant_history(setup):
    product = add_product(setup, cost_price="1.00")
    client, account = register(setup)
    body = cart(setup, product)
    response = client.post("/api/customers/orders", json=body)
    assert response.status_code == 200, response.text
    order = response.json()["data"]
    assert order["total_price"] == "20.00"
    assert order["payment_status"] == "unpaid"
    assert "cost_price" not in response.text and "inventory_updates" not in response.text
    assert grocery.list_products("grocer")["data"][0]["stock"] == 8
    merchant_order = grocery.list_orders("grocer")["data"]["all_orders"][0]
    assert merchant_order["customer_phone"] == account["phone"]
    assert merchant_order["amount_paid"] == "0.00"
    assert client.post("/api/customers/orders", json=body).json() == response.json()
    assert count(grocery.GroceryOrder) == count(portal.CustomerOrder) == 1
    assert client.get("/api/customers/orders").json()["data"][0]["id"] == order["id"]


def test_real_grocery_adapter_catalog_and_checkout_never_touch_external_commerce(setup, monkeypatch):
    from app import customer_merchants
    from app.integrations import shopify_client
    monkeypatch.setattr(portal, "_adapter", lambda: customer_merchants)
    external = []
    def forbidden(*args, **kwargs):
        external.append(args)
        raise AssertionError("Grocery portal cannot call commerce APIs")
    monkeypatch.setattr(shopify_client, "_timed_request", forbidden)
    monkeypatch.setattr(shopify_client, "list_products_by_vendor", forbidden)
    product = add_product(setup, unit_type="weight", stock=None, pack_count=2, pack_weight_kg="25", cost_price="1.00")
    client, _ = register(setup)
    ref = setup["invites"][0]["merchant"]["ref"]
    catalog = client.get(f"/api/customers/merchants/{ref}/catalog")
    assert catalog.status_code == 200
    assert "cost_price" not in catalog.text and "unit_cost" not in catalog.text
    sale = client.post("/api/customers/orders", json=cart(setup, product, line_items=[{"product_id": str(product["id"]), "grams": 500}]))
    assert sale.status_code == 200, sale.text
    assert sale.json()["data"]["total_price"] == "5.00"
    assert client.get("/api/customers/orders").json()["data"][0]["total_price"] == "5.00"
    assert grocery.list_products("grocer")["data"][0]["stock_grams"] == 49500
    assert external == []


def test_failed_mapping_rolls_back_grocery_stock_order_and_operation(setup, monkeypatch):
    product = add_product(setup)
    client, _ = register(setup)
    original = portal._public_order
    monkeypatch.setattr(portal, "_public_order", lambda *args: (_ for _ in ()).throw(RuntimeError("receipt failed")))
    with pytest.raises(RuntimeError):
        client.post("/api/customers/orders", json=cart(setup, product))
    assert grocery.list_products("grocer")["data"][0]["stock"] == 10
    assert count(grocery.GroceryOrder) == count(portal.CustomerOrder) == 0
    monkeypatch.setattr(portal, "_public_order", original)


def test_grocery_changed_quote_rolls_back_sale_and_customer_can_confirm_fresh_quote(setup):
    product = add_product(setup)
    client, _ = register(setup)
    body = cart(setup, product, expected_total="19.00")
    response = client.post("/api/customers/orders", json=body)
    assert response.status_code == 422
    assert response.json()["detail"]["error"] == "price_changed"
    assert response.json()["detail"]["total_price"] == "20.00"
    assert grocery.list_products("grocer")["data"][0]["stock"] == 10
    assert count(grocery.GroceryOrder) == count(portal.CustomerOrder) == 0
    fresh = {**body, "request_id": str(uuid4()), "expected_total": "20.00"}
    result = client.post("/api/customers/orders", json=fresh)
    assert result.status_code == 200
    assert result.json()["data"]["total_price"] == "20.00"
    assert count(grocery.GroceryOrder) == count(portal.CustomerOrder) == 1


def test_customer_cannot_claim_another_customers_orders_or_prior_phone_history(setup):
    product = add_product(setup)
    employee_req = grocery.OrderInput(request_id=uuid4(), customer_name="Previous buyer", customer_phone="0611111111", payment_status="unpaid",
        line_items=[{"product_id": product["id"], "quantity": 1}])
    grocery.place_order("grocer", setup["vendor"], employee_req)
    first, _ = register(setup)
    second, _ = register(setup, phone="0622222222")
    assert first.get("/api/customers/orders").json()["data"] == []
    assert first.post("/api/customers/orders", json=cart(setup, product)).status_code == 200
    assert second.get("/api/customers/orders").json()["data"] == []


def test_request_conflict_and_stock_failure_never_create_second_sale(setup):
    product = add_product(setup, stock=2)
    client, _ = register(setup)
    body = cart(setup, product)
    assert client.post("/api/customers/orders", json=body).status_code == 200
    changed = {**body, "line_items": [{"product_id": product["id"], "quantity": 1}]}
    assert client.post("/api/customers/orders", json=changed).status_code == 409
    assert client.post("/api/customers/orders", json=cart(setup, product)).status_code == 409
    assert count(grocery.GroceryOrder) == 1


def test_simultaneous_customer_uuid_retries_return_one_local_receipt_and_stock_decrement(setup):
    product = add_product(setup, stock=2)
    client, _ = register(setup)
    customer = portal.verify_session_token(client.cookies.get(portal.CUSTOMER_COOKIE))
    body = portal.PortalOrderInput(**cart(setup, product))
    barrier = Barrier(2)
    def checkout():
        barrier.wait()
        return portal.create_order(body, customer)
    with ThreadPoolExecutor(max_workers=2) as pool:
        first, second = list(pool.map(lambda _: checkout(), range(2)))
    assert first == second
    assert count(grocery.GroceryOrder) == count(portal.CustomerOrder) == 1
    assert grocery.list_products("grocer")["data"][0]["stock"] == 0


def test_portal_rejects_customer_prices_paid_status_and_fake_identity_fields(setup):
    product = add_product(setup)
    client, _ = register(setup)
    body = cart(setup, product)
    assert client.post("/api/customers/orders", json={**body, "payment_status": "paid"}).status_code == 422
    assert client.post("/api/customers/orders", json={**body, "customer_phone": "0699999999"}).status_code == 422
    body["line_items"][0]["price"] = "0.01"
    assert client.post("/api/customers/orders", json=body).status_code == 422


@pytest.mark.parametrize("product_id", ["0", "-1"])
def test_grocery_portal_rejects_nonpositive_ids_with_validation_status_and_no_writes(setup, product_id):
    product = add_product(setup)
    client, _ = register(setup)
    response = client.post("/api/customers/orders", json=cart(setup, product, line_items=[{"product_id": product_id, "quantity": 1}]))
    assert response.status_code == 422
    assert response.json()["detail"]["error"] == "invalid_product"
    assert count(grocery.GroceryOrder) == count(portal.CustomerOrder) == 0
    assert grocery.list_products("grocer")["data"][0]["stock"] == 10


def test_external_orders_are_whitelisted_owned_and_claimed_before_dispatch(setup):
    client, _ = register(setup, invite=1)
    body = {"request_id": str(uuid4()), "merchant_ref": setup["invites"][1]["merchant"]["ref"],
            "line_items": [{"product_id": "store:1", "variant_id": "store:11", "quantity": 1}]}
    response = client.post("/api/customers/orders", json=body)
    assert response.status_code == 200, response.text
    assert "profit" not in response.text and "unit_cost" not in response.text
    assert client.post("/api/customers/orders", json=body).json() == response.json()
    assert len(setup["calls"]) == 1
    assert setup["calls"][0][1]["customer_phone"] == "+212611111111"


def test_external_paid_status_refresh_overrides_original_pending_receipt(setup):
    client, _ = register(setup, invite=2)
    body = {"request_id": str(uuid4()), "merchant_ref": setup["invites"][2]["merchant"]["ref"],
            "line_items": [{"product_id": "store:1", "variant_id": "store:11", "quantity": 1}]}
    created = client.post("/api/customers/orders", json=body)
    assert created.status_code == 200
    assert created.json()["data"]["payment_status"] == "pending"
    setup["adapter"].refresh_order = lambda merchant, order_id: {"financial_status": "paid", "order_status": "delivered", "total_price": "10.00"}
    current = client.get("/api/customers/orders").json()["data"][0]
    assert current["payment_status"] == "paid"
    assert current["status"] == "delivered"
    assert current["id"] == created.json()["data"]["id"]
    assert len(current["line_items"]) == 1


def test_ambiguous_external_dispatch_is_durable_and_never_blindly_retried(setup):
    client, _ = register(setup, invite=1)
    calls = []
    def unknown(*args):
        calls.append(args)
        raise TimeoutError("unknown merchant outcome")
    setup["adapter"].place_order = unknown
    body = {"request_id": str(uuid4()), "merchant_ref": setup["invites"][1]["merchant"]["ref"], "line_items": [{"variant_id": "store:11", "quantity": 1}]}
    for _ in range(2):
        response = client.post("/api/customers/orders", json=body)
        assert response.status_code == 409
        assert response.json()["detail"]["error"] == "order_needs_review"
    assert len(calls) == 1
    assert client.get("/api/customers/orders").json()["data"][0]["status"] == "needs_review"


def test_chat_links_are_fresh_scoped_and_directory_omits_other_customer_phone(setup):
    first, account = register(setup)
    _, other = register(setup, phone="0622222222", invite=1)
    own_merchant = setup["vendor"]["chat_id"]
    assert portal.linked_chat_ids(account["id"]) == [own_merchant]
    assert portal.chat_peer_allowed(account["chat_id"], own_merchant)
    assert portal.chat_peer_allowed(own_merchant, account["chat_id"])
    assert not portal.chat_peer_allowed(account["chat_id"], other["chat_id"])
    assert portal.customer_catalog_allowed(account["id"], "grocer")
    assert not portal.customer_catalog_allowed(other["id"], "grocer")
    directory = portal.directory_for(own_merchant)
    assert [entry["id"] for entry in directory] == [account["chat_id"]]
    assert "phone" not in json.dumps(directory)


def test_admin_and_merchant_invite_routes_reject_unproven_identity_and_customer(setup):
    client, _ = register(setup)
    assert client.get("/api/customers/admin/accounts").status_code == 401
    assert client.post("/api/customers/admin/accounts", json={"phone": "0633333333", "password": "password123", "password_confirm": "password123"}).status_code == 401
    assert client.post("/api/customers/merchant/invites", json={}).status_code == 401


def test_admin_can_create_customer_with_explicit_links_without_overwriting_existing(setup, monkeypatch):
    client = setup["client"]()
    original = auth_gate.resolve_principals
    monkeypatch.setattr(auth_gate, "resolve_principals", lambda headers: {"operator": {"sub": "operator"}})
    ref = setup["invites"][0]["merchant"]["ref"]
    body = {"phone": "0611111111", "name": "Admin-created customer", "password": "customer-password", "password_confirm": "customer-password", "merchant_refs": [ref]}
    created = client.post("/api/customers/admin/accounts", json=body)
    assert created.status_code == 200
    assert "password_hash" not in created.text
    assert client.post("/api/customers/admin/accounts", json=body).status_code == 409
    assert len(client.get("/api/customers/admin/accounts").json()["data"]) == 1
    descriptors = client.get("/api/customers/admin/merchants").json()["data"]
    assert len(descriptors) == 3
    assert all("account_id" in merchant and "locator" in merchant for merchant in descriptors)
    assert "password_hash" not in json.dumps(descriptors) and "password" not in json.dumps(descriptors)
    monkeypatch.setattr(auth_gate, "resolve_principals", original)
    response = client.post("/api/customers/login", json={"phone": "0611111111", "password": "customer-password"})
    assert response.status_code == 200
    assert "httponly" in response.headers["set-cookie"].lower()
    assert "samesite=lax" in response.headers["set-cookie"].lower()
    assert len(client.get("/api/customers/merchants").json()["data"]) == 1
    assert "account_id" not in json.dumps(client.get("/api/customers/merchants").json())


def test_vendor_qr_only_binds_verified_immutable_account_and_reuses_invitation(setup):
    client = setup["client"]()
    vendor = setup["vendor"]
    token = auth_gate.issue_vendor_token("grocer", vendor["password_hash"], account_id=vendor["account_id"], chat_id=vendor["chat_id"])
    client.cookies.set(auth_gate.VENDOR_COOKIE, token)
    response = client.post("/api/customers/merchant/invites", json={})
    assert response.status_code == 200
    assert response.json()["data"]["invite"] == setup["invites"][0]["invite"]
    assert client.get("/api/customers/merchant/invites").json()["data"]["invite"] == response.json()["data"]["invite"]
    assert client.post("/api/customers/merchant/invites", json={"kind": "seller", "account_id": "other"}).status_code == 403
    chat = client.post("/api/customers/merchant/chat-session")
    assert chat.json()["data"]["chat_id"] == vendor["chat_id"]
    invitations_before = count(portal.MerchantInvitation)
    assert client.get("/api/customers/merchant/invites", params={"kind": "invalid"}).status_code == 422
    assert client.get("/api/customers/merchant/invites", params={"account_id": "x"*65}).status_code == 422
    assert client.get("/api/customers/merchant/invites", params={"locator": "x"*256}).status_code == 422
    assert count(portal.MerchantInvitation) == invitations_before


def test_seller_bearer_precedes_vendor_cookie_and_qr_chat_require_approved_seller(setup):
    client = setup["client"]()
    seller = next(m for m in setup["merchants"].values() if m["kind"] == "seller")
    token = "seller-session-token"
    with db.SessionLocal() as session:
        session.add(affiliates.Seller(id=seller["account_id"], username="seller", name="Seller", phone="0612345678", password_hash="private-hash", status="approved", access="{}"))
        session.add(affiliates.SellerSession(token_hash=portal._token_hash(token), seller_id=seller["account_id"], expires_at=datetime.utcnow()+timedelta(days=1)))
        session.commit()
    client.headers["Authorization"] = "Bearer "+token
    vendor = setup["vendor"]
    client.cookies.set(auth_gate.VENDOR_COOKIE, auth_gate.issue_vendor_token("grocer", vendor["password_hash"],
        account_id=vendor["account_id"], chat_id=vendor["chat_id"]))
    invitation = client.post("/api/customers/merchant/invites", json={})
    assert invitation.status_code == 200
    assert invitation.json()["data"]["merchant"]["kind"] == "seller"
    assert invitation.json()["data"]["merchant"]["ref"] == setup["invites"][2]["merchant"]["ref"]
    assert client.post("/api/customers/merchant/invites", json={"kind": "vendor", "account_id": setup["vendor"]["account_id"]}).status_code == 403
    response = client.post("/api/customers/merchant/chat-session")
    assert response.status_code == 200
    assert response.json()["data"]["chat_id"] == "seller:"+seller["account_id"]
    cookie = client.cookies.get(auth_gate.SELLER_CHAT_COOKIE)
    assert cookie and auth_gate.verify_seller_chat_token(cookie)["chat_id"] == "seller:"+seller["account_id"]
    with db.SessionLocal() as session:
        session.get(affiliates.Seller, seller["account_id"]).status = "pending"
        session.commit()
    assert client.post("/api/customers/merchant/invites", json={}).status_code == 403
    assert auth_gate.verify_seller_chat_token(cookie) is None


def test_foreign_origin_cannot_register_login_link_or_checkout(setup):
    client, _ = register(setup)
    assert client.post("/api/customers/links", json={"invite": setup["invites"][1]["invite"]}, headers={"Origin": "https://evil.example"}).status_code == 403
    assert client.post("/api/customers/login", json={"phone": "0611111111", "password": "customer-password"}, headers={"Origin": "https://evil.example"}).status_code == 403
    assert client.post("/api/customers/logout", headers={"Origin": "https://evil.example"}).status_code == 403
