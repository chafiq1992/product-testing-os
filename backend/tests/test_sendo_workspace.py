"""Sendo merchant workspaces: launch exchange, gate scoping and credential isolation."""
import base64
import hashlib
import hmac
import json
import time
from uuid import uuid4

import pytest
from cryptography.fernet import Fernet
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from app import auth_gate, db, meta_connection, sendo_workspace
from app.integrations import meta_client, shopify_client
from app.tenant_context import current_workspace, workspace_scope

SECRET = "s" * 40


def _launch(**overrides):
    now = int(time.time())
    payload = {"v": 1, "mid": 7, "name": "Shop", "ws": "m7", "svc": "true_profit",
               "iat": now, "exp": now + 300, "jti": uuid4().hex}
    payload.update(overrides)
    body = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip("=")
    return f"{body}.{hmac.new(SECRET.encode(), body.encode(), hashlib.sha256).hexdigest()}"


@pytest.fixture(autouse=True)
def env(monkeypatch):
    monkeypatch.delenv("PTO_AUTH_GATE", raising=False)
    monkeypatch.setenv("SENDO_LAUNCH_SECRET", SECRET)
    monkeypatch.setenv("PRODUCT_TESTING_AUTH_SECRET", "test-secret-not-production")
    monkeypatch.setenv("CONNECTION_ENCRYPTION_KEY", Fernet.generate_key().decode())
    monkeypatch.delenv("SENDO_EMBED_SERVICES", raising=False)
    sendo_workspace._used_launch_ids.clear()


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(sendo_workspace, "sync_shopify_store", lambda ws, mid: {"connected": False})
    app = FastAPI()
    app.add_middleware(auth_gate.AuthGateMiddleware)
    app.include_router(sendo_workspace.router)

    async def echo(request: Request):
        return {"workspace": current_workspace()}

    for method, path in [("GET", "/api/profit_costs"), ("POST", "/api/profit_costs"),
                         ("GET", "/api/meta/ad_accounts"), ("DELETE", "/api/profit_campaign_cards/{cid}"),
                         ("GET", "/api/shopify/stores"), ("POST", "/api/exchange/usd_to_mad")]:
        app.add_api_route(path, echo, methods=[method])
    return TestClient(app)


def _session(client):
    resp = client.post("/api/sendo/session", json={"launch": _launch()})
    assert resp.status_code == 200, resp.text
    return {"X-Workspace-Token": resp.json()["data"]["token"]}


# ── launch token ──────────────────────────────────────────────────────────


def test_launch_token_is_verified_and_single_use():
    token = _launch()
    assert sendo_workspace.verify_launch_token(token)["ws"] == "m7"
    assert sendo_workspace.verify_launch_token(token) is None  # replay


@pytest.mark.parametrize("overrides", [
    {"exp": int(time.time()) - 1},
    {"ws": "m8"},
    {"ws": "irrakids", "mid": 7},
    {"svc": "true_manager"},
    {"v": 2},
])
def test_bad_launch_tokens_are_rejected(overrides):
    assert sendo_workspace.verify_launch_token(_launch(**overrides)) is None


def test_tampered_or_unsigned_launch_is_rejected(monkeypatch):
    token = _launch()
    assert sendo_workspace.verify_launch_token(token[:-1] + ("0" if token[-1] != "0" else "1")) is None
    monkeypatch.setenv("SENDO_LAUNCH_SECRET", "short")
    assert sendo_workspace.verify_launch_token(_launch()) is None


def test_session_exchange_rejects_a_bad_launch(client):
    assert client.post("/api/sendo/session", json={"launch": "nope"}).status_code == 401


# ── gate scoping ──────────────────────────────────────────────────────────


def test_workspace_reaches_its_own_store_with_the_context_set(client):
    headers = _session(client)
    resp = client.get("/api/profit_costs", params={"store": "m7"}, headers=headers)
    assert resp.status_code == 200
    assert resp.json() == {"workspace": "m7"}
    resp = client.post("/api/profit_costs", json={"store": "m7", "product_id": "1"}, headers=headers)
    assert resp.json() == {"workspace": "m7"}
    assert client.delete("/api/profit_campaign_cards/123", params={"store": "m7"}, headers=headers).status_code == 200


@pytest.mark.parametrize("call", [
    lambda c, h: c.get("/api/profit_costs", params={"store": "irrakids"}, headers=h),
    lambda c, h: c.get("/api/profit_costs", headers=h),
    lambda c, h: c.get("/api/meta/ad_accounts", params={"stores": "m7,irrakids"}, headers=h),
    # A body handler would read store=None (global settings) from a body without one.
    lambda c, h: c.post("/api/profit_costs?store=m7", json={"product_id": "1"}, headers=h),
    lambda c, h: c.post("/api/profit_costs", json={"store": "m7"}, params={"store": "irrakids"}, headers=h),
    lambda c, h: c.post("/api/exchange/usd_to_mad", content=b"[1]", headers=h),
    # Not on the workspace route list at all.
    lambda c, h: c.get("/api/shopify/stores", params={"store": "m7"}, headers=h),
])
def test_workspace_cannot_leave_its_store_or_route_list(client, call):
    assert call(client, _session(client)).status_code == 403


def test_forged_or_missing_workspace_token_is_anonymous(client):
    assert client.get("/api/profit_costs", params={"store": "m7"}).status_code == 401
    assert client.get("/api/profit_costs", params={"store": "m7"}, headers={"X-Workspace-Token": "x.y"}).status_code == 401


# ── credential isolation ──────────────────────────────────────────────────


def test_meta_never_falls_back_to_the_env_token_in_a_workspace(monkeypatch):
    monkeypatch.setattr(meta_client, "ACCESS", "operator-env-token")
    monkeypatch.setattr(meta_client, "AD_ACCOUNT_ID", "999")
    assert meta_client._active_token() == "operator-env-token"
    with workspace_scope("m7"):
        with pytest.raises(RuntimeError):
            meta_client._active_token()
        assert meta_client._default_account() == ""
        with meta_client.meta_access_token_scope("merchant-token"):
            assert meta_client._active_token() == "merchant-token"


def test_shopify_uses_only_the_workspace_record(monkeypatch):
    monkeypatch.setenv("SHOPIFY_SHOP_DOMAIN", "operator.myshopify.com")
    monkeypatch.setenv("SHOPIFY_ACCESS_TOKEN", "operator-env-token")
    label = f"m{int(time.time() * 1000) % 10**9 + 1}"
    with workspace_scope(label):
        with pytest.raises(RuntimeError):
            shopify_client._get_store_config(label)
        with pytest.raises(RuntimeError):
            shopify_client._get_store_config("irrakids")
        with pytest.raises(RuntimeError):
            shopify_client._gql("{ shop { name } }", {})
    db.set_app_setting(label, "shopify_oauth", {"shop": "merchant.myshopify.com", "access_token": "merchant-token"})
    with workspace_scope(label):
        cfg = shopify_client._get_store_config(label)
    assert cfg["SHOP"] == "merchant.myshopify.com"
    assert cfg["HEADERS"]["X-Shopify-Access-Token"] == "merchant-token"
    # A workspace label outside its request context must fail, not use env credentials.
    with pytest.raises(RuntimeError):
        shopify_client._get_store_config(label)


def test_meta_connect_returns_workspaces_to_the_popup_page():
    assert meta_connection._return_url("https://pt.example", "m7", "meta_connected") == "https://pt.example/sendo-connected/?result=meta_connected"
    assert meta_connection._return_url("https://pt.example", "irrakids", "meta_connected").startswith("https://pt.example/settings/connections?")


def test_admin_connections_requires_the_shared_signature(client):
    assert client.get("/api/sendo/admin/connections", params={"workspaces": "m7"}).json() == {"error": "unauthorized"}
    ts = str(int(time.time()))
    sig = hmac.new(SECRET.encode(), f"{ts}.0".encode(), hashlib.sha256).hexdigest()
    resp = client.get("/api/sendo/admin/connections", params={"workspaces": "m7,irrakids"},
                      headers={"X-Sendo-Timestamp": ts, "X-Sendo-Signature": sig})
    assert list(resp.json()["data"]) == ["m7"]


# ── True Manager ──────────────────────────────────────────────────────────


@pytest.fixture
def manager_client(monkeypatch):
    monkeypatch.setenv("SENDO_EMBED_SERVICES", "true_profit,true_manager")
    monkeypatch.setattr(sendo_workspace, "sync_shopify_store", lambda ws, mid: {"connected": False})
    app = FastAPI()
    app.add_middleware(auth_gate.AuthGateMiddleware)
    app.include_router(sendo_workspace.router)

    async def echo(request: Request):
        return {"workspace": current_workspace()}

    for method, path in [("GET", "/api/meta/campaigns/{cid}/adsets/orders"), ("POST", "/api/meta/campaigns/{cid}/status"),
                         ("POST", "/api/ads-management/bundle"), ("GET", "/api/profit_campaign_cards"),
                         ("GET", "/api/profit_costs"), ("POST", "/api/campaign/analyze"),
                         ("GET", "/api/ads-management/agent/reports")]:
        app.add_api_route(path, echo, methods=[method])
    return TestClient(app)


def _service_session(client, svc):
    resp = client.post("/api/sendo/session", json={"launch": _launch(svc=svc)})
    assert resp.status_code == 200, resp.text
    return {"X-Workspace-Token": resp.json()["data"]["token"]}


def test_true_manager_session_reaches_its_routes_only(manager_client):
    headers = _service_session(manager_client, "true_manager")
    ok = manager_client.get("/api/meta/campaigns/1/adsets/orders", params={"store": "m7", "start": "a", "end": "b"}, headers=headers)
    assert ok.json() == {"workspace": "m7"}
    assert manager_client.post("/api/meta/campaigns/1/status", json={"store": "m7", "status": "PAUSED"}, headers=headers).status_code == 200
    assert manager_client.post("/api/ads-management/bundle", json={"store": "m7"}, headers=headers).status_code == 200
    # Shared routes work for either service; True Profit's own cards do not.
    assert manager_client.get("/api/profit_costs", params={"store": "m7"}, headers=headers).status_code == 200
    assert manager_client.get("/api/profit_campaign_cards", params={"store": "m7"}, headers=headers).status_code == 403


def test_true_profit_session_cannot_use_true_manager_routes(manager_client):
    headers = _service_session(manager_client, "true_profit")
    assert manager_client.post("/api/ads-management/bundle", json={"store": "m7"}, headers=headers).status_code == 403
    assert manager_client.get("/api/profit_campaign_cards", params={"store": "m7"}, headers=headers).status_code == 200


def test_meta_store_is_pinned_like_store(manager_client):
    headers = _service_session(manager_client, "true_manager")
    resp = manager_client.get("/api/meta/campaigns/1/adsets/orders",
                              params={"store": "m7", "meta_store": "irrakids", "start": "a", "end": "b"}, headers=headers)
    assert resp.status_code == 403


def test_ai_routes_stay_operator_only(manager_client):
    headers = _service_session(manager_client, "true_manager")
    assert manager_client.post("/api/campaign/analyze", json={"store": "m7"}, headers=headers).status_code == 403
    assert manager_client.get("/api/ads-management/agent/reports", params={"store": "m7"}, headers=headers).status_code == 403


def test_true_manager_launch_needs_the_service_enabled(monkeypatch):
    monkeypatch.setenv("SENDO_EMBED_SERVICES", "true_profit")
    assert sendo_workspace.verify_launch_token(_launch(svc="true_manager")) is None
    monkeypatch.setenv("SENDO_EMBED_SERVICES", "true_profit,true_manager")
    assert sendo_workspace.verify_launch_token(_launch(svc="true_manager"))["svc"] == "true_manager"


def test_ad_account_timezone_answers_only_for_the_workspace_accounts(monkeypatch):
    import asyncio
    from app import main

    label = f"m{int(time.time() * 1000) % 10**9 + 2}"
    db.set_app_setting(label, "meta_oauth", {"access_token": "merchant-token", "accounts": [{"id": "act_555"}]})
    db.set_app_setting(None, "meta_ad_account_tz:999", {"id": "999", "timezone_name": "Africa/Casablanca", "ts": time.time()})
    with workspace_scope(label):
        foreign = asyncio.run(main.api_ad_account_timezone(ad_account="999", store=label))
    assert foreign == {"data": {}}
    outside = asyncio.run(main.api_ad_account_timezone(ad_account="999", store="irrakids"))
    assert outside["data"]["timezone_name"] == "Africa/Casablanca"
