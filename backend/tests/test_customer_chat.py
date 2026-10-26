"""Customer chat uses verified identities and merchant relationships on every path."""
from types import SimpleNamespace
from collections import defaultdict
from datetime import datetime, timedelta
import hashlib
from uuid import uuid4

import pytest
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from starlette.websockets import WebSocketDisconnect

from app import auth_gate, chat, customer_accounts as portal, db
from app.affiliates import Seller, SellerSession


@pytest.fixture
def setup(monkeypatch, tmp_path):
    engine = create_engine("sqlite:///" + str(tmp_path / "chat.db"), connect_args={"check_same_thread": False})
    db.Base.metadata.create_all(engine, tables=[db.AppSetting.__table__, chat.ChatAccount.__table__,
        chat.ChatMessage.__table__, Seller.__table__, SellerSession.__table__, *portal.TABLES])
    monkeypatch.setattr(db, "SessionLocal", sessionmaker(engine, expire_on_commit=False))
    monkeypatch.setenv("PTO_AUTH_GATE", "on")
    monkeypatch.setenv("PRODUCT_TESTING_AUTH_SECRET", "customer-chat-tests-only")
    monkeypatch.setenv("PRODUCT_TESTING_USERNAME", "operator")
    monkeypatch.setenv("PRODUCT_TESTING_PASSWORD", "operator-password")
    vendors = {name: {"id": name, "account_id": str(uuid4()), "name": "Atlas Market" if name == "market" else "Other Market",
        "chat_id": "vendor:" + str(uuid4()), "password_hash": "password-hash"} for name in ("market", "other")}
    monkeypatch.setattr(auth_gate, "_vendor_resolver", lambda name: vendors.get(name))
    auth_gate._vendor_cache.clear()
    merchants = {v["account_id"]: {"kind": "vendor", "account_id": v["account_id"],
        "chat_id": v["chat_id"], "name": v["name"], "locator": name, "vendor_id": name} for name, v in vendors.items()}

    def resolve(kind, account_id, locator=None):
        if kind != "vendor" or account_id not in merchants:
            raise HTTPException(404, "Unavailable merchant")
        return merchants[account_id]

    monkeypatch.setattr(portal, "_adapter", lambda: SimpleNamespace(resolve_merchant=resolve))
    monkeypatch.setattr(chat, "_directory_providers", [lambda term: [{"id": v["chat_id"], "handle": name,
        "name": v["name"], "avatar": "", "kind": "vendor", "catalog_vendor_id": name} for name, v in vendors.items()]])
    monkeypatch.setattr(chat, "ensure_pubsub", _noop)
    monkeypatch.setattr(chat, "_publish", _noop)
    monkeypatch.setattr(chat.manager, "connections", defaultdict(set))
    app = FastAPI()
    app.add_middleware(auth_gate.AuthGateMiddleware)
    app.include_router(auth_gate.router)
    app.include_router(portal.router)
    app.include_router(chat.router)

    @app.get("/api/shopify/stores")
    @app.get("/api/wholesale/vendors/market/orders")
    def private():
        return {"ok": True}

    @app.get("/api/chat/catalog")
    @app.get("/api/chat/catalog/product")
    def catalog():
        return {"data": []}

    clients = []
    def client():
        value = TestClient(app)
        clients.append(value)
        return value

    def register(name, phone):
        invite = portal.make_invite("vendor", vendors[name]["account_id"], name)
        value = client()
        result = value.post("/api/customers/register", json={"phone": phone, "name": "Customer " + name,
            "password": "customer-password", "password_confirm": "customer-password", "invite": invite["invite"]})
        assert result.status_code == 200, result.text
        principal = portal.verify_session_token(value.cookies.get(auth_gate.CUSTOMER_COOKIE))
        chat_id = principal["chat_id"]
        assert value.post("/api/chat/register", json={"id": chat_id, "name": "Customer " + name,
            "handle": "customer-" + principal["sub"][:8]}).status_code == 200
        return value, chat_id

    first, first_id = register("market", "0611111111")
    second, second_id = register("other", "0622222222")
    yield SimpleNamespace(first=first, first_id=first_id, second=second, second_id=second_id,
        vendors=vendors, client=client)
    for value in clients:
        value.close()
    auth_gate._vendor_cache.clear()
    engine.dispose()


async def _noop(*args, **kwargs):
    return None


def vendor_token(setup):
    vendor = setup.vendors["market"]
    return auth_gate.issue_vendor_token("market", "password-hash", account_id=vendor["account_id"], chat_id=vendor["chat_id"])


def test_customer_session_never_grants_merchant_or_operator_access(setup):
    assert setup.first.get("/api/shopify/stores").status_code == 401
    assert setup.first.get("/api/wholesale/vendors/market/orders").status_code == 401
    assert setup.first.get("/api/chat/conversations", params={"me": setup.second_id}).status_code == 403
    assert setup.first.post("/api/chat/register", json={"id": setup.second_id}).status_code == 403
    assert setup.first.post("/api/chat/send", json={"sender": setup.second_id, "recipient": setup.first_id, "text": "spoof"}).status_code == 403
    with pytest.raises(WebSocketDisconnect):
        with setup.first.websocket_connect("/api/chat/ws/" + setup.second_id):
            pass


def test_customer_directory_and_http_peers_are_link_scoped(setup):
    own, other = setup.vendors["market"]["chat_id"], setup.vendors["other"]["chat_id"]
    rows = setup.first.get("/api/chat/search", params={"me": setup.first_id}).json()["data"]
    assert [row["id"] for row in rows] == [own]
    assert "0622222222" not in str(rows)
    assert setup.first.get("/api/chat/account/" + other).status_code == 403
    assert setup.first.get("/api/chat/messages", params={"me": setup.first_id, "peer": other}).status_code == 403
    assert setup.first.post("/api/chat/read", json={"me": setup.first_id, "peer": other}).status_code == 403
    assert setup.first.post("/api/chat/send", json={"sender": setup.first_id, "recipient": other, "text": "denied"}).status_code == 403
    sent = setup.first.post("/api/chat/send", json={"sender": setup.first_id, "recipient": own, "text": "Question"})
    assert sent.json()["data"]["text"] == "Question"
    assert setup.first.get("/api/chat/catalog?vendor=market").status_code == 403
    assert setup.first.get("/api/chat/catalog?vendor=other").status_code == 403
    with db.SessionLocal() as session:
        assert session.query(chat.ChatMessage).count() == 1


@pytest.mark.parametrize('path', ['/api/chat/catalog', '/api/chat/catalog/product'])
def test_customer_legacy_catalog_denied_even_with_matching_merchant_name(setup, monkeypatch, path):
    # A display-name match cannot authorize the old Shopify catalog surface.
    monkeypatch.setattr(portal, 'customer_catalog_allowed', lambda *args: True)
    for target in ('market', 'other', 'Atlas Market'):
        assert setup.first.get(path, params={'vendor': target, 'id': '123'}).status_code == 403
    vendor = setup.client()
    vendor.cookies.set(auth_gate.VENDOR_COOKIE, vendor_token(setup))
    assert vendor.get(path, params={'vendor': 'market', 'id': '123'}).status_code == 200


def test_first_customer_message_uses_trusted_merchant_profile_without_registration(setup):
    merchant_id = setup.vendors['market']['chat_id']
    with db.SessionLocal() as session:
        assert session.get(chat.ChatAccount, merchant_id) is None
    assert setup.first.post('/api/chat/send', json={'sender': setup.first_id,
        'recipient': merchant_id, 'text': 'Are you open?'}).status_code == 200
    response = setup.first.get('/api/chat/conversations', params={'me': setup.first_id})
    peer = response.json()['data'][0]['peer']
    assert peer['id'] == merchant_id
    assert peer['name'] == 'Atlas Market' and peer['handle'] == 'market' and peer['kind'] == 'vendor'
    assert 'online' in peer and 'last_seen' in peer
    assert '0611111111' not in str(response.json()) and '0622222222' not in str(response.json())


def test_merchant_only_sees_linked_customers_and_dual_cookie_actor_is_verified(setup):
    merchant = setup.client()
    merchant.cookies.set(auth_gate.VENDOR_COOKIE, vendor_token(setup))
    rows = merchant.get("/api/chat/search", params={"me": setup.vendors["market"]["chat_id"]}).json()["data"]
    assert setup.first_id in {r["id"] for r in rows}
    assert setup.second_id not in {r["id"] for r in rows}
    assert merchant.get("/api/chat/account/" + setup.second_id).status_code == 403
    setup.first.cookies.set(auth_gate.VENDOR_COOKIE, merchant.cookies.get(auth_gate.VENDOR_COOKIE))
    assert setup.first.get("/api/chat/search", headers={"X-Chat-Actor": setup.vendors["market"]["chat_id"]}).status_code == 200
    assert setup.first.get("/api/chat/search", headers={"X-Chat-Actor": "vendor:forged"}).status_code == 403


def test_websocket_checks_each_recipient_and_uses_verified_sender(setup):
    own, other = setup.vendors["market"]["chat_id"], setup.vendors["other"]["chat_id"]
    with setup.first.websocket_connect("/api/chat/ws/" + setup.first_id) as ws:
        while ws.receive_json()["type"] != "presence_snapshot":
            pass
        ws.send_json({"type": "send_message", "data": {"recipient": other, "text": "No"}})
        assert ws.receive_json()["type"] == "error"
        ws.send_json({"type": "read", "data": {"peer": other}})
        assert ws.receive_json()["type"] == "error"
        ws.send_json({"type": "send_message", "data": {"sender": setup.second_id, "recipient": own, "text": "Yes"}})
        result = ws.receive_json()
        assert result["type"] == "message"
        assert result["data"]["sender_id"] == setup.first_id
    with db.SessionLocal() as session:
        assert session.query(chat.ChatMessage).count() == 1


def test_customer_attachment_requires_participation_and_has_private_cache(setup):
    upload = setup.first.post("/api/chat/upload", files={"file": ("photo.png", b"photo", "image/png")}).json()["data"]
    assert setup.first.get(upload["url"]).status_code == 200
    assert setup.second.get(upload["url"]).status_code == 403
    assert setup.second.post("/api/chat/send", json={"sender": setup.second_id,
        "recipient": setup.vendors["other"]["chat_id"], "type": "image", "media_url": upload["url"]}).status_code == 403
    own = setup.vendors["market"]["chat_id"]
    setup.first.post("/api/chat/send", json={"sender": setup.first_id, "recipient": own,
        "type": "image", "media_url": upload["url"]})
    merchant = setup.client()
    merchant.cookies.set(auth_gate.VENDOR_COOKIE, vendor_token(setup))
    response = merchant.get(upload["url"])
    assert response.status_code == 200
    assert response.headers["cache-control"] == "private, no-store"


def test_websocket_rechecks_link_after_connection_and_filters_presence(setup):
    own = setup.vendors["market"]["chat_id"]
    # A connected but unrelated account never appears in customer presence.
    chat.manager.connections[setup.second_id].add(object())
    with setup.first.websocket_connect("/api/chat/ws/" + setup.first_id) as ws:
        snapshot = ws.receive_json()
        if snapshot["type"] == "presence":
            snapshot = ws.receive_json()
        assert snapshot["type"] == "presence_snapshot"
        assert setup.second_id not in snapshot["data"]["online"]
        with db.SessionLocal() as session:
            session.query(portal.CustomerMerchantLink).filter_by(customer_id=setup.first_id.split(":", 1)[1]).delete()
            session.commit()
        ws.send_json({"type": "send_message", "data": {"recipient": own, "text": "After unlink"}})
        assert ws.receive_json()["type"] == "error"


def test_operator_can_still_manage_chat_and_merchant_apis(setup):
    operator = setup.client()
    assert operator.post("/api/auth/login", json={"username": "operator", "password": "operator-password"}).status_code == 200
    assert operator.get("/api/shopify/stores").status_code == 200
    assert operator.get("/api/wholesale/vendors/market/orders").status_code == 200
    assert operator.get("/api/chat/account/" + setup.second_id).status_code == 200
    for path in ("/api/chat/catalog", "/api/chat/catalog/product"):
        assert operator.get(path, params={"vendor": "market", "id": "123"}).status_code == 200


def test_existing_customer_socket_closes_after_logout(setup):
    with setup.first.websocket_connect("/api/chat/ws/" + setup.first_id) as ws:
        while ws.receive_json()["type"] != "presence_snapshot":
            pass
        assert setup.first.post("/api/customers/logout").status_code == 200
        ws.send_json({"type": "ping"})
        with pytest.raises(WebSocketDisconnect) as error:
            ws.receive_json()
        assert error.value.code == 4401


def test_customer_writes_block_foreign_origin_even_on_login(setup):
    for path in ("/api/customers/login", "/api/customers/register", "/api/customers/logout", "/api/chat/send"):
        assert setup.first.post(path, json={}, headers={"Origin": "https://other.example"}).status_code == 403


def test_seller_chat_cookie_is_approved_lifetime_and_chat_only(setup):
    seller_id = uuid4().hex
    with db.SessionLocal() as session:
        session.add(Seller(id=seller_id, username="seller", name="Seller", phone="0633333333",
            password_hash="seller-password-hash", status="approved"))
        session.add(SellerSession(token_hash=hashlib.sha256(b"seller-bearer").hexdigest(), seller_id=seller_id,
            expires_at=datetime.utcnow() + timedelta(days=1)))
        session.commit()
    request = Request({"type": "http", "headers": [(b"host", b"testserver"), (b"authorization", b"Bearer seller-bearer")]})
    response = Response()
    identity = auth_gate.issue_seller_chat_cookie(response, request, {"id": seller_id})
    token = response.headers["set-cookie"].split(";", 1)[0].split("=", 1)[1]
    assert identity["id"] == "seller:" + seller_id
    seller = setup.client()
    seller.cookies.set(auth_gate.SELLER_CHAT_COOKIE, token)
    assert seller.get("/api/chat/conversations", params={"me": identity["id"]}).status_code == 200
    assert seller.get("/api/shopify/stores").status_code == 401
    assert seller.get("/api/wholesale/vendors/market/orders").status_code == 401
    for path in ("/api/chat/catalog", "/api/chat/catalog/product"):
        assert seller.get(path, params={"vendor": "market", "id": "123"}).status_code == 403
    with db.SessionLocal() as session:
        session.get(Seller, seller_id).status = "suspended"
        session.commit()
    assert seller.get("/api/chat/conversations", params={"me": identity["id"]}).status_code == 401
    with pytest.raises(HTTPException):
        auth_gate.issue_seller_chat_cookie(Response(), request, {"id": seller_id})
    with db.SessionLocal() as session:
        session.get(Seller, seller_id).status = "approved"
        session.query(SellerSession).delete()
        session.commit()
    assert auth_gate.verify_seller_chat_token(token) is None
