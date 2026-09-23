"""Per-user accounts: storage, login through the gate, session kill, admin API."""
import json
import logging

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from app import auth_gate, users
from app.system_health_routes import router as system_health_router

OWNER = "owner@example.test"
OWNER_PW = "owner-password-1"


@pytest.fixture
def env(monkeypatch):
    monkeypatch.delenv("PTO_AUTH_GATE", raising=False)
    monkeypatch.setenv("PRODUCT_TESTING_USERNAME", "team")
    monkeypatch.setenv("PRODUCT_TESTING_PASSWORD", "team-pass")
    monkeypatch.setenv("PRODUCT_TESTING_AUTH_SECRET", "test-secret-not-production")
    monkeypatch.setenv("SYSTEM_ADMIN_SECRET", "test-admin-secret")
    monkeypatch.setenv("SYSTEM_ADMIN_USERS", json.dumps([{"email": OWNER, "password": OWNER_PW}]))
    with users.db.SessionLocal() as s:
        s.query(users.AppUser).delete()
        s.commit()
    users._invalidate()
    auth_gate._FAILS.clear()
    return monkeypatch


def _app():
    app = FastAPI()
    app.add_middleware(auth_gate.AuthGateMiddleware)
    app.include_router(auth_gate.router)
    app.include_router(system_health_router)

    @app.get("/api/meta/ad_accounts")
    async def data(request: Request):
        return {"ok": True}

    return app


def _login(client, username, password):
    return client.post("/api/auth/login", json={"username": username, "password": password})


@pytest.fixture
def owner(env):
    c = TestClient(_app())
    assert _login(c, OWNER, OWNER_PW).status_code == 200
    return c


def _create(owner, username="alice", role="operator", password="alice-password-1", name="Alice"):
    r = owner.post("/api/auth/users", json={"username": username, "password": password, "role": role, "name": name})
    assert r.status_code == 201, r.text
    return r.json()["data"]


def _no_secrets(payload):
    text = json.dumps(payload)
    assert "password_hash" not in text and "scrypt$" not in text


def test_hash_is_salted_scrypt():
    a, b = users.hash_password("same-password-1"), users.hash_password("same-password-1")
    assert a.startswith("scrypt$") and a != b
    assert users.verify_password("same-password-1", a) and not users.verify_password("other-password", a)


def test_create_login_and_operator_access(owner):
    created = _create(owner)
    _no_secrets(created)
    assert created["username"] == "alice" and created["role"] == "operator" and created["active"] is True

    c = TestClient(_app())
    assert c.get("/api/meta/ad_accounts").status_code == 401
    r = _login(c, "ALICE", "alice-password-1")          # case-insensitive username
    assert r.status_code == 200 and r.json()["data"]["operator"]["role"] == "operator"
    assert "system_admin_token" not in r.json()["data"]
    assert c.get("/api/meta/ad_accounts").status_code == 200
    assert c.get("/api/auth/session").json()["data"]["operator"]["role"] == "operator"
    listed = owner.get("/api/auth/users").json()["data"]
    _no_secrets(listed)
    assert [u["username"] for u in listed["users"]] == ["alice"]
    assert listed["users"][0]["last_login_at"]


def test_operator_gets_403_on_admin_api(owner):
    user = _create(owner)
    c = TestClient(_app())
    _login(c, "alice", "alice-password-1")
    assert c.get("/api/auth/users").status_code == 403
    assert c.post("/api/auth/users", json={"username": "x-user", "password": "long-enough-1"}).status_code == 403
    assert c.patch(f"/api/auth/users/{user['id']}", json={"role": "admin"}).status_code == 403
    assert c.post(f"/api/auth/users/{user['id']}/password", json={"password": "long-enough-1"}).status_code == 403
    assert c.delete(f"/api/auth/users/{user['id']}").status_code == 403
    # the shared login is an operator too
    shared = TestClient(_app())
    _login(shared, "team", "team-pass")
    assert shared.get("/api/auth/users").status_code == 403
    assert TestClient(_app()).get("/api/auth/users").status_code == 401


def test_validation(owner):
    for body, code in [
        ({"username": "bob", "password": "short", "role": "operator"}, "weak_password"),
        ({"username": "b", "password": "long-enough-1", "role": "operator"}, "invalid_username"),
        ({"username": "bob", "password": "long-enough-1", "role": "root"}, "invalid_role"),
        ({"username": OWNER.upper(), "password": "long-enough-1", "role": "operator"}, "username_taken"),
        ({"username": "team", "password": "long-enough-1", "role": "operator"}, "username_taken"),
    ]:
        r = owner.post("/api/auth/users", json=body)
        assert r.status_code in (409, 422) and r.json()["error"] == code, (body, r.text)
    _create(owner, "bob")
    r = owner.post("/api/auth/users", json={"username": "BOB", "password": "long-enough-1", "role": "operator"})
    assert r.status_code == 409


def test_disable_kills_sessions_and_blocks_login(owner):
    user = _create(owner)
    c = TestClient(_app())
    _login(c, "alice", "alice-password-1")
    assert c.get("/api/meta/ad_accounts").status_code == 200
    r = owner.patch(f"/api/auth/users/{user['id']}", json={"active": False})
    assert r.status_code == 200 and r.json()["data"]["active"] is False
    assert c.get("/api/meta/ad_accounts").status_code == 401
    assert _login(TestClient(_app()), "alice", "alice-password-1").status_code == 401
    owner.patch(f"/api/auth/users/{user['id']}", json={"active": True})
    assert c.get("/api/meta/ad_accounts").status_code == 401             # old session stays dead
    assert _login(c, "alice", "alice-password-1").status_code == 200


def test_reset_password_kills_sessions(owner):
    user = _create(owner)
    c = TestClient(_app())
    _login(c, "alice", "alice-password-1")
    r = owner.post(f"/api/auth/users/{user['id']}/password", json={"password": "brand-new-pass-2"})
    assert r.status_code == 200
    _no_secrets(r.json())
    assert c.get("/api/meta/ad_accounts").status_code == 401
    assert _login(c, "alice", "alice-password-1").status_code == 401
    assert _login(c, "alice", "brand-new-pass-2").status_code == 200
    assert owner.post(f"/api/auth/users/{user['id']}/password", json={"password": "short"}).status_code == 422


def test_delete_kills_sessions(owner):
    user = _create(owner)
    c = TestClient(_app())
    _login(c, "alice", "alice-password-1")
    assert owner.delete(f"/api/auth/users/{user['id']}").status_code == 200
    assert c.get("/api/meta/ad_accounts").status_code == 401
    assert owner.delete(f"/api/auth/users/{user['id']}").status_code == 404


def test_role_change_applies_immediately(owner):
    user = _create(owner)
    c = TestClient(_app())
    _login(c, "alice", "alice-password-1")
    assert c.get("/api/auth/users").status_code == 403
    owner.patch(f"/api/auth/users/{user['id']}", json={"role": "admin"})
    assert c.get("/api/auth/users").status_code == 200
    owner.patch(f"/api/auth/users/{user['id']}", json={"role": "operator"})
    assert c.get("/api/auth/users").status_code == 403


def test_db_admin_gets_system_admin_bearer_that_dies_with_the_account(owner):
    user = _create(owner, "carol", role="admin", password="carol-password-1")
    c = TestClient(_app())
    r = _login(c, "carol", "carol-password-1")
    token = r.json()["data"]["system_admin_token"]
    hdr = {"Authorization": f"Bearer {token}"}
    assert c.get("/api/system-health/me", headers=hdr).json().get("data")
    assert TestClient(_app()).get("/api/meta/ad_accounts", headers=hdr).status_code == 200
    owner.patch(f"/api/auth/users/{user['id']}", json={"active": False})
    assert c.get("/api/system-health/me", headers=hdr).json().get("error") == "unauthorized"
    assert TestClient(_app()).get("/api/meta/ad_accounts", headers=hdr).status_code == 401


def test_last_admin_guard(env):
    env.setenv("SYSTEM_ADMIN_USERS", "")                 # no environment admins
    admin = users.create_user("dave", "dave-password-1", "admin", None, "test")
    c = TestClient(_app())
    assert _login(c, "dave", "dave-password-1").status_code == 200
    for call in (lambda: c.patch(f"/api/auth/users/{admin['id']}", json={"active": False}),
                 lambda: c.patch(f"/api/auth/users/{admin['id']}", json={"role": "operator"}),
                 lambda: c.delete(f"/api/auth/users/{admin['id']}")):
        r = call()
        assert r.status_code == 409 and r.json()["error"] == "last_admin"
    second = _create(c, "erin", role="admin", password="erin-password-1")
    assert c.patch(f"/api/auth/users/{admin['id']}", json={"role": "operator"}).status_code == 200
    assert c.get("/api/auth/users").status_code == 403                 # demoted immediately
    e = TestClient(_app())
    _login(e, "erin", "erin-password-1")
    assert e.patch(f"/api/auth/users/{second['id']}", json={"active": False}).status_code == 409


def test_failed_db_logins_are_rate_limited(owner):
    _create(owner)
    c = TestClient(_app())
    for _ in range(10):
        assert _login(c, "alice", "wrong-password").status_code == 401
    assert _login(c, "alice", "alice-password-1").status_code == 429


def test_env_logins_and_existing_sessions_keep_working(owner):
    shared = TestClient(_app())
    assert _login(shared, "team", "team-pass").status_code == 200
    assert shared.get("/api/meta/ad_accounts").status_code == 200
    # a cookie minted before this change (no "role" claim) is still accepted
    legacy = auth_gate._sign({"k": "op", "sub": "team", "name": None, "src": "product",
                              "fp": auth_gate._fingerprint("product", "team", "team-pass"),
                              "iat": 0, "exp": 4102444800})
    c = TestClient(_app())
    c.cookies.set(auth_gate.OPERATOR_COOKIE, legacy)
    assert c.get("/api/meta/ad_accounts").status_code == 200
    assert c.get("/api/auth/session").json()["data"]["operator"]["role"] == "operator"
    assert owner.get("/api/auth/session").json()["data"]["operator"]["role"] == "admin"


def test_admin_actions_are_logged_without_passwords(owner, caplog):
    with caplog.at_level(logging.INFO, logger="app.users"):
        user = _create(owner, password="log-me-not-12345")
        owner.post(f"/api/auth/users/{user['id']}/password", json={"password": "also-secret-678"})
        owner.patch(f"/api/auth/users/{user['id']}", json={"active": False})
        owner.delete(f"/api/auth/users/{user['id']}")
    text = caplog.text
    for action in ("action=create", "action=reset_password", "action=update", "action=delete"):
        assert action in text
    assert f"by={OWNER}" in text
    assert "log-me-not" not in text and "also-secret" not in text and "scrypt$" not in text
