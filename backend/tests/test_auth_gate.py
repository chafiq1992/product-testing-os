"""The auth gate: who may reach which route, and the login/session endpoints."""
import hashlib
import json

import pytest
from fastapi import FastAPI, Request, WebSocket
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app import auth_gate
from app.system_health_routes import _issue_token

ADMIN_EMAIL = "owner@example.test"
ADMIN_PW = "admin-pass-1"
VENDOR_PW_HASH = hashlib.sha256(b"vendor-pass").hexdigest()


@pytest.fixture
def client(monkeypatch):
    monkeypatch.delenv("PTO_AUTH_GATE", raising=False)
    monkeypatch.setenv("PRODUCT_TESTING_USERNAME", "team")
    monkeypatch.setenv("PRODUCT_TESTING_PASSWORD", "team-pass")
    monkeypatch.setenv("PRODUCT_TESTING_AUTH_SECRET", "test-secret-not-production")
    monkeypatch.setenv("SYSTEM_ADMIN_SECRET", "test-admin-secret")
    monkeypatch.setenv("SYSTEM_ADMIN_USERS", json.dumps([{"email": ADMIN_EMAIL, "password": ADMIN_PW, "name": "Owner"}]))
    vendors = {"acme": {"id": "acme", "password_hash": VENDOR_PW_HASH}, "other": {"id": "other", "password_hash": "x"}}
    monkeypatch.setattr(auth_gate, "_vendor_resolver", lambda vid: vendors.get(vid))
    auth_gate._vendor_cache.clear()
    auth_gate._FAILS.clear()

    app = FastAPI()
    app.add_middleware(auth_gate.AuthGateMiddleware)
    app.include_router(auth_gate.router)

    async def ok(request: Request):
        return {"ok": True}

    for path in [
        "/api/shopify/stores", "/api/meta/ad_accounts", "/api/profit_costs", "/api/prompts",
        "/api/shopify/debug/status", "/api/confirmation/admin/users", "/api/system-health/me",
        "/api/shopify/oauth/callback", "/api/page-builder/widget.js", "/health", "/uploads/a.png",
        "/api/wholesale/vendors", "/api/wholesale/vendors/acme/orders", "/api/wholesale/vendors/other/orders",
        "/api/chat/conversations", "/proxy/image", "/chat-media/x.png", "/",
    ]:
        app.add_api_route(path, ok, methods=["GET"])
    for path in ["/api/social-agent/scheduler/tick", "/api/chat/send", "/api/wholesale/upload-image", "/api/profit_costs", "/chatkit"]:
        app.add_api_route(path, ok, methods=["POST"])

    @app.websocket("/api/chat/ws/{account_id}")
    async def ws(websocket: WebSocket, account_id: str):
        await websocket.accept()
        await websocket.send_text(account_id)
        await websocket.close()

    return TestClient(app)


def _vendor_cookie(vid="acme", pw_hash=VENDOR_PW_HASH):
    return {auth_gate.VENDOR_COOKIE: auth_gate.issue_vendor_token(vid, pw_hash)}


@pytest.mark.parametrize("path", ["/api/shopify/stores", "/api/meta/ad_accounts", "/api/profit_costs",
                                  "/api/prompts", "/api/shopify/debug/status", "/proxy/image",
                                  "/api/wholesale/vendors", "/api/chat/conversations", "/chat-media/x.png"])
def test_anonymous_is_rejected(client, path):
    r = client.get(path)
    assert r.status_code == 401
    assert r.json()["error"] == "unauthorized"


def test_anonymous_writes_and_chatkit_rejected(client):
    assert client.post("/api/profit_costs", json={}).status_code == 401
    assert client.post("/chatkit", json={}).status_code == 401


@pytest.mark.parametrize("path", ["/health", "/uploads/a.png", "/", "/api/shopify/oauth/callback",
                                  "/api/page-builder/widget.js", "/api/system-health/me",
                                  "/api/confirmation/admin/users"])
def test_public_and_self_verified_routes_pass(client, path):
    assert client.get(path).status_code == 200


def test_scheduler_tick_reaches_its_own_secret_check(client):
    assert client.post("/api/social-agent/scheduler/tick", json={}).status_code == 200


@pytest.mark.parametrize("username,password", [("team", "team-pass"), (ADMIN_EMAIL, ADMIN_PW)])
def test_operator_login_sets_cookie_that_unlocks_api(client, username, password):
    assert client.get("/api/auth/session").json()["data"]["operator"] is None
    r = client.post("/api/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200
    assert auth_gate.OPERATOR_COOKIE in r.cookies
    cookie_header = r.headers["set-cookie"].lower()
    assert "httponly" in cookie_header and "samesite=lax" in cookie_header
    assert client.get("/api/meta/ad_accounts").status_code == 200
    assert client.get("/api/wholesale/vendors/other/orders").status_code == 200  # operators see every vendor
    assert client.get("/api/auth/session").json()["data"]["operator"]["sub"]
    if username == ADMIN_EMAIL:
        assert r.json()["data"]["system_admin_token"]


def test_bad_login_is_401_and_throttled(client):
    for _ in range(10):
        assert client.post("/api/auth/login", json={"username": "team", "password": "nope"}).status_code == 401
    assert client.post("/api/auth/login", json={"username": "team", "password": "team-pass"}).status_code == 429


def test_password_change_revokes_operator_cookie(client, monkeypatch):
    client.post("/api/auth/login", json={"username": "team", "password": "team-pass"})
    assert client.get("/api/prompts").status_code == 200
    monkeypatch.setenv("PRODUCT_TESTING_PASSWORD", "rotated")
    assert client.get("/api/prompts").status_code == 401


def test_forged_cookie_rejected(client, monkeypatch):
    client.cookies.set(auth_gate.OPERATOR_COOKIE, "eyJrIjoib3AifQ.bogus")
    assert client.get("/api/prompts").status_code == 401


def test_existing_system_admin_bearer_still_works_and_upgrades(client):
    token = _issue_token({"sub": ADMIN_EMAIL, "role": "sys_admin", "exp": 4102444800})
    hdr = {"Authorization": f"Bearer {token}"}
    assert client.get("/api/profit_costs", headers=hdr).status_code == 200
    r = client.post("/api/auth/session", headers=hdr)
    assert r.status_code == 200 and auth_gate.OPERATOR_COOKIE in r.cookies
    assert client.get("/api/profit_costs").status_code == 200
    assert client.post("/api/auth/session", headers={"Authorization": "Bearer nope"}).status_code == 401


def test_cookie_write_from_another_origin_is_blocked(client):
    client.post("/api/auth/login", json={"username": "team", "password": "team-pass"})
    assert client.post("/api/profit_costs", json={}, headers={"Origin": "https://evil.chattbase.site"}).status_code == 403
    assert client.post("/api/profit_costs", json={}, headers={"Origin": "http://testserver"}).status_code == 200
    assert client.post("/api/profit_costs", json={}).status_code == 200  # no Origin: non-browser client


def test_vendor_reaches_only_its_own_routes(client):
    client.cookies.update(_vendor_cookie())
    assert client.get("/api/wholesale/vendors/acme/orders").status_code == 200
    assert client.get("/api/wholesale/vendors/other/orders").status_code == 403
    assert client.get("/api/wholesale/vendors").status_code == 401        # the admin list
    assert client.get("/api/meta/ad_accounts").status_code == 401         # operator API
    assert client.post("/api/wholesale/upload-image").status_code == 200
    assert client.get("/api/chat/conversations?me=acme").status_code == 200
    assert client.get("/api/chat/conversations?me=other").status_code == 403
    assert client.post("/api/chat/send", json={"sender": "acme", "recipient": "x"}).status_code == 200
    assert client.post("/api/chat/send", json={"sender": "other", "recipient": "x"}).status_code == 403


def test_vendor_token_dies_with_password_change(client):
    client.cookies.update(_vendor_cookie(pw_hash="old-hash"))
    assert client.get("/api/wholesale/vendors/acme/orders").status_code == 401


def test_chat_websocket_requires_matching_identity(client):
    client.cookies.update(_vendor_cookie())
    with client.websocket_connect("/api/chat/ws/acme") as ws:
        assert ws.receive_text() == "acme"
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/api/chat/ws/other") as ws:
            ws.receive_text()


def test_kill_switch(client, monkeypatch):
    monkeypatch.setenv("PTO_AUTH_GATE", "off")
    assert client.get("/api/meta/ad_accounts").status_code == 200


def test_docs_flag_defaults_off(monkeypatch):
    monkeypatch.delenv("PTO_API_DOCS", raising=False)
    assert auth_gate.docs_enabled() is False
    monkeypatch.setenv("PTO_API_DOCS", "1")
    assert auth_gate.docs_enabled() is True


def test_every_route_in_the_real_app_is_classified_deliberately():
    """New routes are operator-only by default; this pins the non-operator set."""
    non_operator = {
        "public": {"/api/auth/login", "/api/auth/logout", "/api/auth/session", "/api/system-health/login",
                   "/api/system-health/me", "/api/confirmation/login", "/api/confirmation/admin/login",
                   "/api/wholesale/login", "/api/page-builder/widget.js"},
        "self": {"/api/shopify/oauth/callback", "/api/social-agent/scheduler/tick"},
    }
    for kind, paths in non_operator.items():
        for p in paths:
            assert auth_gate.classify(p) == kind, p
    assert auth_gate.classify("/api/confirmation/orders") == "self"
    assert auth_gate.classify("/api/shopify/oauth/start") == "operator"
    assert auth_gate.classify("/api/some-new-route") == "operator"
    assert auth_gate.classify("/uploads/x.png") == "public"
    assert auth_gate.classify("/studio/") == "public"
