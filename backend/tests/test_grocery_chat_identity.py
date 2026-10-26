"""New account lifetimes never inherit username-based chat history or sessions."""
import asyncio
import json
from datetime import datetime
from uuid import UUID

import pytest
from fastapi import FastAPI, WebSocket
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from starlette.websockets import WebSocketDisconnect

from app import auth_gate, chat, db, main


@pytest.fixture
def isolated(monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    for table in (db.AppSetting.__table__, chat.ChatAccount.__table__, chat.ChatMessage.__table__):
        table.create(engine)
    monkeypatch.setattr(db, "SessionLocal", sessionmaker(engine, expire_on_commit=False))
    monkeypatch.setattr(auth_gate, "_vendor_resolver", lambda vid: db.get_app_setting(main.WHOLESALE_STORE, main._wholesale_vendor_key(vid)))
    monkeypatch.setattr(chat, "_directory_providers", [main._wholesale_chat_directory])
    monkeypatch.setenv("PTO_AUTH_GATE", "on")
    monkeypatch.setenv("PRODUCT_TESTING_AUTH_SECRET", "isolated-account-lifetime-tests")
    auth_gate._vendor_cache.clear()

    app = FastAPI()
    app.add_middleware(auth_gate.AuthGateMiddleware)
    app.add_api_route("/api/wholesale/login", main.api_wholesale_login, methods=["POST"])

    @app.websocket("/api/chat/ws/{account_id}")
    async def socket(websocket: WebSocket, account_id: str):
        await websocket.accept()
        await websocket.send_text(account_id)
        await websocket.close()

    app.include_router(chat.router)
    client = TestClient(app)
    yield client
    client.close()
    engine.dispose()


def create(username="market", **overrides):
    request = main.WholesaleVendorCreate(**{
        "name": "Fresh Market", "username": username, "password": "same-password",
        "account_type": "grocery", **overrides,
    })
    return asyncio.run(main.api_wholesale_create_vendor(request))


def login(client, username="market"):
    response = client.post("/api/wholesale/login", json={"username": username, "password": "same-password"})
    assert response.status_code == 200
    assert "error" not in response.json(), response.json()
    return response.json()["data"]


def seed_history(identity="market"):
    with db.SessionLocal() as session:
        session.add(chat.ChatAccount(id=identity, handle="market", display_name="Earlier Market", kind="vendor", created_at=datetime.utcnow()))
        session.add(chat.ChatAccount(id="peer", handle="peer", display_name="Peer", kind="agent", created_at=datetime.utcnow()))
        session.add(chat.ChatMessage(id="old-message", conversation_id=chat.conversation_id(identity, "peer"), sender_id="peer",
                                     recipient_id=identity, msg_type="text", text="Earlier private conversation", status="sent", created_at=datetime.utcnow()))
        session.commit()


def test_new_account_has_uuid_lifetime_and_fresh_chat_without_deleting_old_history(isolated):
    seed_history()
    result = create()["data"]
    assert str(UUID(result["account_id"])) == result["account_id"]
    assert result["chat_id"] == "vendor:" + result["account_id"]
    assert result["chat_id"] != result["username"]
    account = login(isolated)
    assert account["account_id"] == result["account_id"]
    assert "password_hash" not in account
    assert isolated.get("/api/chat/conversations", params={"me": account["chat_id"]}).json()["data"] == []
    assert isolated.get("/api/chat/messages", params={"me": account["chat_id"], "peer": "peer"}).json()["data"] == []
    with db.SessionLocal() as session:
        assert session.get(chat.ChatMessage, "old-message").text == "Earlier private conversation"


def test_new_account_cannot_claim_old_username_for_http_or_websocket(isolated):
    account = create()["data"]
    login(isolated)
    assert isolated.get("/api/chat/conversations?me=market").status_code == 403
    assert isolated.get("/api/chat/messages?me=market&peer=peer").status_code == 403
    assert isolated.post("/api/chat/register", json={"id": "market"}).status_code == 403
    assert isolated.post("/api/chat/send", json={"sender": "market", "recipient": "peer"}).status_code == 403
    assert isolated.post("/api/chat/register", json={"id": account["chat_id"], "handle": "market", "kind": "vendor"}).status_code == 200
    with isolated.websocket_connect("/api/chat/ws/" + account["chat_id"]) as ws:
        assert ws.receive_text() == account["chat_id"]
    with pytest.raises(WebSocketDisconnect):
        with isolated.websocket_connect("/api/chat/ws/market"):
            pass


def test_duplicate_create_rejects_without_changing_identity_password_or_name(isolated):
    original = create()["data"]
    duplicate = create(name="Overwritten", password="replacement")
    assert duplicate == {"error": "username_already_exists"}
    current = login(isolated)
    assert current["name"] == "Fresh Market"
    assert current["account_id"] == original["account_id"]
    assert current["chat_id"] == original["chat_id"]
    # The insert-only persistence guard protects a race after an earlier absence check.
    stored = db.get_app_setting(main.WHOLESALE_STORE, main._wholesale_vendor_key("market"))
    assert main._wholesale_save_vendor_record({**stored, "account_id": "replacement"}, create=True) is False
    assert login(isolated)["account_id"] == original["account_id"]


def test_explicit_update_preserves_lifetime_and_metadata(isolated):
    original = create()["data"]
    key = main._wholesale_vendor_key("market")
    stored = db.get_app_setting(main.WHOLESALE_STORE, key)
    db.set_app_setting(main.WHOLESALE_STORE, key, {**stored, "profile_image": "retained.jpg"})
    updated = create(operation="update", name="Renamed", password="UNCHANGED_PLACEHOLDER")["data"]
    assert updated["account_id"] == original["account_id"]
    assert updated["chat_id"] == original["chat_id"]
    assert updated["profile_image"] == "retained.jpg"
    assert login(isolated)["name"] == "Renamed"
    assert create(username="absent", operation="update") == {"error": "vendor_not_found"}


def test_recreated_username_with_same_password_revokes_old_lifetime_cookie(isolated):
    earlier = create()["data"]
    login(isolated)
    old_cookie = isolated.cookies.get(auth_gate.VENDOR_COOKIE)
    key = main._wholesale_vendor_key("market")
    with db.SessionLocal() as session:
        session.delete(session.get(db.AppSetting, db._mk_setting_pk(main.WHOLESALE_STORE, key)))
        session.commit()
    replacement = create()["data"]
    assert replacement["account_id"] != earlier["account_id"]
    assert replacement["chat_id"] != earlier["chat_id"]
    assert auth_gate.verify_vendor_token(old_cookie) is None
    assert isolated.get("/api/chat/conversations", params={"me": earlier["chat_id"]}).status_code == 401
    assert login(isolated)["account_id"] == replacement["account_id"]


def test_directory_returns_current_chat_identity_and_catalog_username(isolated):
    seed_history()
    account = create()["data"]
    create(username="other")
    login(isolated, "other")
    result = isolated.get("/api/chat/search", params={"q": "market", "me": login(isolated, "other")["chat_id"]}).json()["data"]
    market = [row for row in result if row["handle"] == "market"]
    assert len(market) == 1
    assert market[0]["id"] == account["chat_id"]
    assert market[0]["catalog_vendor_id"] == "market"


def test_legacy_login_preserves_existing_chat_and_backfills_stable_lifetime(isolated):
    key = main._wholesale_vendor_key("market")
    db.set_app_setting(main.WHOLESALE_STORE, key, {"id": "market", "username": "market", "name": "Legacy",
                       "password_hash": main._hash_password("same-password"), "created_at": "2026-01-01T00:00:00Z"})
    seed_history()
    first = login(isolated)
    assert first["chat_id"] == "market"
    assert UUID(first["account_id"])
    assert login(isolated)["account_id"] == first["account_id"]
    assert len(isolated.get("/api/chat/conversations?me=market").json()["data"]) == 1


def test_previous_release_grocery_gets_fresh_inbox_without_old_username_conversations(isolated):
    key = main._wholesale_vendor_key("market")
    db.set_app_setting(main.WHOLESALE_STORE, key, {"id": "market", "username": "market", "name": "Earlier Grocery",
                       "account_type": "grocery", "store_type": "grocery",
                       "password_hash": main._hash_password("same-password"), "created_at": "2026-10-26T00:00:00Z"})
    seed_history()
    first = login(isolated)
    assert first["chat_id"] == "vendor:" + first["account_id"]
    assert first["chat_id"] != "market"
    assert isolated.get("/api/chat/conversations", params={"me": first["chat_id"]}).json()["data"] == []
    assert isolated.get("/api/chat/messages", params={"me": first["chat_id"], "peer": "peer"}).json()["data"] == []
    assert isolated.get("/api/chat/conversations?me=market").status_code == 403
    assert isolated.get("/api/chat/messages?me=market&peer=peer").status_code == 403
    again = login(isolated)
    assert again["account_id"] == first["account_id"]
    assert again["chat_id"] == first["chat_id"]
    with db.SessionLocal() as session:
        assert session.get(chat.ChatMessage, "old-message").text == "Earlier private conversation"
