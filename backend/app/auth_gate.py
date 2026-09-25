"""Application-wide authentication gate.

Until this module existed only a handful of routers checked a login (system
health, social agent, ad launcher, the confirmation team). Every other API —
Shopify stores, Meta ad accounts, profit costs, prompts, campaigns — answered
anonymously. This gate closes that without inventing a new user system; it only
enforces the logins the app already has:

* **Operator** — either credential set that already exists in the environment:
  ``PRODUCT_TESTING_USERNAME``/``PRODUCT_TESTING_PASSWORD`` (the shared login of
  the earlier whole-app gate, commit d12a904) or any ``SYSTEM_ADMIN_USERS``
  entry. Carried by the HttpOnly ``ptos_auth`` cookie, or by the existing
  system-admin bearer token (``Authorization``/``X-System-Admin-Token``) that the
  System Health, Social Agent and Ad Launcher pages already send.
* **Wholesale vendor** — ``/api/wholesale/login`` already verified the vendor
  password but issued nothing; it now also sets the ``ptos_vendor`` cookie. A
  vendor reaches only its own ``/api/wholesale/vendors/{id}/…`` routes, the
  wholesale upload/analyze helpers and chat (as itself).

Routes that already carry their own verified credential pass straight through:
the confirmation team (per-handler tokens), the social-agent scheduler tick
(shared secret), the Shopify OAuth callback (signed state + Shopify HMAC).

Only API-shaped prefixes are gated. The static Next.js export, ``/uploads``
(Meta and Shopify fetch creatives from there by URL), ``/health`` and
``/legal`` stay public — none of them return data the API guards.

Kill switch: ``PTO_AUTH_GATE=off`` disables enforcement without a rebuild.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import os
import re
import secrets
import threading
import time
from typing import Any, Callable, Optional
from urllib.parse import parse_qs, urlsplit

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel

log = logging.getLogger("app.auth_gate")

OPERATOR_COOKIE = "ptos_auth"
VENDOR_COOKIE = "ptos_vendor"
COOKIE_MAX_AGE = 60 * 60 * 24 * 30
SHORT_COOKIE_MAX_AGE = 60 * 60 * 8

_FALSE = {"0", "false", "no", "off", "disabled"}

# ---------------------------------------------------------------------------
# Path policy
# ---------------------------------------------------------------------------

# Only these prefixes are ever gated. Everything else (the static export,
# /uploads, /health, /legal, /favicon.ico) is public by design.
GATED_PREFIXES = ("/api/", "/chatkit", "/proxy/", "/chat-media/")

# No credential needed: login endpoints, and the inert widget stale Shopify
# themes still request from storefronts.
PUBLIC_PATHS = frozenset({
    "/api/auth/login",
    "/api/auth/logout",
    "/api/auth/session",
    "/api/system-health/login",
    "/api/system-health/me",          # answers {"error":"unauthorized"} itself
    "/api/confirmation/login",
    "/api/confirmation/admin/login",
    "/api/wholesale/login",
    "/api/page-builder/widget.js",
})

# Routes that verify their own credential inside the handler. Listed
# explicitly so a new route under a similar prefix is gated by default.
#   - Shopify OAuth callback: signed `state` + Shopify HMAC (main.py).
#   - Social-agent tick: X-Social-Agent-Key shared secret, or a system admin.
SELF_VERIFIED_PATHS = frozenset({
    "/api/shopify/oauth/callback",
    "/api/connections/meta/callback",
    "/api/social-agent/scheduler/tick",
})
# The confirmation team has its own agent/admin tokens, checked in every
# handler under this prefix; its members are not operators.
SELF_VERIFIED_PREFIXES = ("/api/confirmation/",)

_VENDOR_SCOPED = re.compile(r"^/api/wholesale/vendors/([^/]+)/")
VENDOR_SHARED_PATHS = frozenset({
    "/api/wholesale/upload-image",
    "/api/wholesale/analyze-image",
})
VENDOR_CHAT_PREFIXES = ("/api/chat/", "/chat-media/")
_CHAT_WS = re.compile(r"^/api/chat/ws/([^/]+)$")
_CHAT_ACCOUNT = re.compile(r"^/api/chat/account/[^/]+$")
# JSON-body chat writes: which field names the acting account.
_CHAT_BODY_IDENTITY = {
    "/api/chat/send": "sender",
    "/api/chat/read": "me",
    "/api/chat/register": "id",
}

_UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


def gate_enabled() -> bool:
    return (os.getenv("PTO_AUTH_GATE") or "").strip().lower() not in _FALSE


def docs_enabled() -> bool:
    """/docs, /redoc and /openapi.json are off unless PTO_API_DOCS is truthy."""
    return (os.getenv("PTO_API_DOCS") or "").strip().lower() in {"1", "true", "yes", "on"}


def classify(path: str) -> str:
    """Return one of: public, self, vendor, chat, operator."""
    if not path.startswith(GATED_PREFIXES):
        return "public"
    if path in PUBLIC_PATHS:
        return "public"
    if path in SELF_VERIFIED_PATHS or path.startswith(SELF_VERIFIED_PREFIXES):
        return "self"
    if _VENDOR_SCOPED.match(path) or path in VENDOR_SHARED_PATHS:
        return "vendor"
    if path.startswith(VENDOR_CHAT_PREFIXES):
        return "chat"
    return "operator"


# ---------------------------------------------------------------------------
# Tokens
# ---------------------------------------------------------------------------

_EPHEMERAL_SECRET = secrets.token_bytes(32)
_warned_secret = False


def _secret() -> bytes:
    global _warned_secret
    sec = (
        os.getenv("PRODUCT_TESTING_AUTH_SECRET")
        or os.getenv("SYSTEM_ADMIN_SECRET")
        or os.getenv("JWT_SECRET")
        or ""
    ).strip()
    if sec:
        return sec.encode("utf-8")
    # Never fall back to a constant that is readable in the public repo: a
    # per-process random secret only costs a re-login after a restart.
    if not _warned_secret:
        log.warning("auth gate: no PRODUCT_TESTING_AUTH_SECRET/SYSTEM_ADMIN_SECRET set; sessions end on restart")
        _warned_secret = True
    return _EPHEMERAL_SECRET


def _b64e(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _b64d(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def _sign(payload: dict) -> str:
    body = _b64e(json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8"))
    sig = _b64e(hmac.new(_secret(), body.encode("ascii"), hashlib.sha256).digest())
    return f"{body}.{sig}"


def _unsign(token: str) -> Optional[dict]:
    try:
        tok = (token or "").strip()
        if not tok or "." not in tok:
            return None
        body, sig = tok.split(".", 1)
        expected = _b64e(hmac.new(_secret(), body.encode("ascii"), hashlib.sha256).digest())
        if not hmac.compare_digest(expected, sig):
            return None
        payload = json.loads(_b64d(body).decode("utf-8"))
        if not isinstance(payload, dict):
            return None
        if int(payload.get("exp") or 0) < int(time.time()):
            return None
        return payload
    except Exception:
        return None


def _fingerprint(*parts: str) -> str:
    return hashlib.sha256("\0".join(parts).encode("utf-8")).hexdigest()[:32]


# -- operator credentials ---------------------------------------------------

def _product_credentials() -> tuple[str, str]:
    return (
        (os.getenv("PRODUCT_TESTING_USERNAME") or "").strip(),
        (os.getenv("PRODUCT_TESTING_PASSWORD") or "").strip(),
    )


def _system_admins() -> list[dict]:
    from app.system_health_routes import _load_admin_users  # local: avoid import cycles
    try:
        return _load_admin_users()
    except Exception:
        return []


def check_operator_credentials(username: str, password: str) -> Optional[dict]:
    """Validate against every operator credential the environment defines.

    Returns {"sub", "name", "src", "fp"} on success. `fp` fingerprints the
    matched credential so changing that password revokes existing cookies.
    """
    user = (username or "").strip()
    pw = password or ""
    if not user or not pw:
        return None
    p_user, p_pw = _product_credentials()
    if p_user and p_pw:
        # Evaluate both comparisons so timing does not reveal which one failed.
        u_ok = hmac.compare_digest(user.lower().encode(), p_user.lower().encode())
        p_ok = hmac.compare_digest(pw.strip().encode(), p_pw.encode())
        if u_ok and p_ok:
            return {"sub": p_user, "name": None, "src": "product", "fp": _fingerprint("product", p_user, p_pw)}
    email = user.lower()
    for admin in _system_admins():
        if admin.get("email") == email and hmac.compare_digest(str(admin.get("password") or "").encode(), pw.encode()):
            return {"sub": email, "name": admin.get("name"), "src": "sys_admin",
                    "fp": _fingerprint("sys_admin", email, str(admin.get("password") or ""))}
    from app.operator_users import verify_credentials
    managed = verify_credentials(user, pw)
    if managed:
        username = managed["username"]
        return {"sub": username, "name": None, "src": "managed", "fp": _fingerprint("managed", username, managed["password_hash"])}
    return None


def _operator_fingerprint_valid(payload: dict) -> bool:
    src = payload.get("src")
    fp = payload.get("fp")
    if src == "product":
        p_user, p_pw = _product_credentials()
        return bool(p_user and p_pw) and hmac.compare_digest(str(fp), _fingerprint("product", p_user, p_pw))
    if src == "sys_admin":
        email = str(payload.get("sub") or "")
        for admin in _system_admins():
            if admin.get("email") == email:
                return hmac.compare_digest(str(fp), _fingerprint("sys_admin", email, str(admin.get("password") or "")))
    if src == "managed":
        from app.operator_users import get_user
        username = str(payload.get("sub") or "").lower()
        managed = get_user(username)
        return bool(managed) and hmac.compare_digest(str(fp), _fingerprint("managed", username, managed["password_hash"]))
    return False


def issue_operator_token(match: dict, ttl: int = COOKIE_MAX_AGE) -> str:
    now = int(time.time())
    return _sign({"k": "op", "sub": match["sub"], "name": match.get("name"), "src": match["src"],
                  "fp": match["fp"], "iat": now, "exp": now + ttl})


def verify_operator_token(token: str) -> Optional[dict]:
    payload = _unsign(token)
    if not payload or payload.get("k") != "op" or not _operator_fingerprint_valid(payload):
        return None
    return payload


def verify_system_admin_bearer(token: str) -> Optional[dict]:
    from app.system_health_routes import _verify_token  # the existing sys_admin token
    try:
        return _verify_token(token)
    except Exception:
        return None


# -- wholesale vendors ------------------------------------------------------

_vendor_resolver: Optional[Callable[[str], Any]] = None
_vendor_cache: dict[str, tuple[float, Optional[str]]] = {}
_vendor_cache_lock = threading.Lock()
_VENDOR_CACHE_TTL = 60.0


def set_vendor_resolver(fn: Callable[[str], Any]) -> None:
    """main.py registers how to load a vendor record ({... "password_hash"})."""
    global _vendor_resolver
    _vendor_resolver = fn


def _vendor_password_hash(vendor_id: str) -> Optional[str]:
    now = time.time()
    with _vendor_cache_lock:
        hit = _vendor_cache.get(vendor_id)
        if hit and hit[0] > now:
            return hit[1]
    value: Optional[str] = None
    try:
        rec = _vendor_resolver(vendor_id) if _vendor_resolver else None
        if isinstance(rec, dict) and rec.get("password_hash"):
            value = str(rec["password_hash"])
    except Exception:
        log.exception("auth gate: vendor lookup failed")
        return None  # do not cache a failure
    with _vendor_cache_lock:
        _vendor_cache[vendor_id] = (now + _VENDOR_CACHE_TTL, value)
    return value


def issue_vendor_token(vendor_id: str, password_hash: str, ttl: int = COOKIE_MAX_AGE) -> str:
    now = int(time.time())
    vid = (vendor_id or "").strip().lower()
    with _vendor_cache_lock:
        _vendor_cache.pop(vid, None)
    return _sign({"k": "vendor", "sub": vid, "fp": _fingerprint("vendor", vid, password_hash or ""),
                  "iat": now, "exp": now + ttl})


def verify_vendor_token(token: str) -> Optional[dict]:
    payload = _unsign(token)
    if not payload or payload.get("k") != "vendor":
        return None
    vid = str(payload.get("sub") or "")
    current = _vendor_password_hash(vid)
    if not current or not hmac.compare_digest(str(payload.get("fp")), _fingerprint("vendor", vid, current)):
        return None
    return payload


# ---------------------------------------------------------------------------
# Request inspection
# ---------------------------------------------------------------------------

def _headers(scope) -> dict[str, str]:
    out: dict[str, str] = {}
    for k, v in scope.get("headers") or []:
        key = k.decode("latin-1").lower()
        val = v.decode("latin-1")
        out[key] = f"{out[key]}; {val}" if key == "cookie" and key in out else val
    return out


def _cookies(headers: dict[str, str]) -> dict[str, str]:
    jar: dict[str, str] = {}
    for part in (headers.get("cookie") or "").split(";"):
        if "=" in part:
            k, v = part.split("=", 1)
            jar.setdefault(k.strip(), v.strip().strip('"'))
    return jar


def resolve_principals(headers: dict[str, str]) -> dict[str, Any]:
    """Every identity the request proves. Keys: operator, vendor, via_cookie."""
    out: dict[str, Any] = {"operator": None, "vendor": None, "via_cookie": False}
    auth = (headers.get("authorization") or "").strip()
    bearer = auth.split(" ", 1)[1].strip() if auth.lower().startswith("bearer ") else ""
    for candidate in (bearer, (headers.get("x-system-admin-token") or "").strip()):
        if candidate:
            admin = verify_system_admin_bearer(candidate)
            if admin:
                out["operator"] = {"sub": admin.get("sub"), "name": admin.get("name"), "src": "sys_admin_bearer"}
                break
    jar = _cookies(headers)
    if not out["operator"] and jar.get(OPERATOR_COOKIE):
        op = verify_operator_token(jar[OPERATOR_COOKIE])
        if op:
            out["operator"] = op
            out["via_cookie"] = True
    vendor_tok = jar.get(VENDOR_COOKIE) or (headers.get("x-wholesale-token") or "").strip()
    if vendor_tok:
        vendor = verify_vendor_token(vendor_tok)
        if vendor:
            out["vendor"] = vendor
            if jar.get(VENDOR_COOKIE):
                out["via_cookie"] = True
    return out


def _origin_ok(headers: dict[str, str]) -> bool:
    """Cookie-authenticated writes must come from this site's own pages.

    SameSite=Lax already stops other sites; this also stops sibling
    *.chattbase.site hosts, which count as the same "site".
    """
    origin = (headers.get("origin") or "").strip()
    if not origin or origin == "null":
        return not origin  # absent is fine (non-browser client); literal "null" is not
    try:
        return urlsplit(origin).netloc.lower() == (headers.get("host") or "").lower()
    except Exception:
        return False


def _query(scope) -> dict[str, list[str]]:
    try:
        return parse_qs((scope.get("query_string") or b"").decode("latin-1"))
    except Exception:
        return {}


# ---------------------------------------------------------------------------
# ASGI middleware
# ---------------------------------------------------------------------------

class AuthGateMiddleware:
    """Pure ASGI so it covers HTTP and WebSocket alike and never buffers streams."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] not in ("http", "websocket") or not gate_enabled():
            return await self.app(scope, receive, send)
        method = scope.get("method", "GET").upper() if scope["type"] == "http" else "WEBSOCKET"
        path = scope.get("path") or "/"
        kind = classify(path)
        if method == "OPTIONS" or kind in ("public", "self"):
            return await self.app(scope, receive, send)

        headers = _headers(scope)
        who = resolve_principals(headers)
        operator, vendor = who["operator"], who["vendor"]

        if (method in _UNSAFE_METHODS or method == "WEBSOCKET") and who["via_cookie"] and not _origin_ok(headers):
            return await self._deny(scope, receive, send, 403, "cross_origin_request_blocked")

        if kind == "operator":
            if operator:
                return await self.app(scope, receive, send)
            return await self._deny(scope, receive, send, 401, "unauthorized")

        if operator:  # operators may act on any vendor and any chat account
            return await self.app(scope, receive, send)
        if not vendor:
            return await self._deny(scope, receive, send, 401, "unauthorized")
        vid = str(vendor.get("sub") or "")

        if kind == "vendor":
            m = _VENDOR_SCOPED.match(path)
            if m and m.group(1).strip().lower() != vid:
                return await self._deny(scope, receive, send, 403, "forbidden")
            return await self.app(scope, receive, send)

        # kind == "chat": a vendor acts only as itself.
        m = _CHAT_WS.match(path)
        if m and m.group(1).strip().lower() != vid:
            return await self._deny(scope, receive, send, 403, "forbidden")
        me = [v.strip().lower() for v in _query(scope).get("me", [])]
        if any(v != vid for v in me):
            return await self._deny(scope, receive, send, 403, "forbidden")
        field = _CHAT_BODY_IDENTITY.get(path)
        if field and method == "POST":
            body, receive = await _buffer_body(receive)
            try:
                claimed = str((json.loads(body or b"{}") or {}).get(field) or "").strip().lower()
            except Exception:
                claimed = ""
            if claimed != vid:
                return await self._deny(scope, receive, send, 403, "forbidden")
        return await self.app(scope, receive, send)

    @staticmethod
    async def _deny(scope, receive, send, status: int, error: str):
        if scope["type"] == "websocket":
            await send({"type": "websocket.close", "code": 4401 if status == 401 else 4403})
            return
        body = json.dumps({"error": error, "detail": "Authentication required" if status == 401 else "Not allowed"}).encode()
        await send({"type": "http.response.start", "status": status, "headers": [
            (b"content-type", b"application/json"),
            (b"content-length", str(len(body)).encode()),
            (b"cache-control", b"no-store"),
        ]})
        await send({"type": "http.response.body", "body": body})


async def _buffer_body(receive, limit: int = 1_000_000):
    chunks: list[bytes] = []
    size = 0
    more = True
    while more:
        message = await receive()
        if message["type"] != "http.request":
            break
        chunk = message.get("body", b"")
        size += len(chunk)
        if size > limit:
            break
        chunks.append(chunk)
        more = message.get("more_body", False)
    body = b"".join(chunks)
    sent = False

    async def replay():
        nonlocal sent
        if not sent:
            sent = True
            return {"type": "http.request", "body": body, "more_body": False}
        return await receive()

    return body, replay


# ---------------------------------------------------------------------------
# Login / session endpoints
# ---------------------------------------------------------------------------

router = APIRouter(prefix="/api/auth", tags=["auth"])

_FAILS: dict[str, list[float]] = {}
_FAILS_LOCK = threading.Lock()
_FAIL_WINDOW = 15 * 60
_FAIL_LIMIT_PER_USER = 10
_FAIL_LIMIT_GLOBAL = 100


def _throttled(key: str) -> bool:
    cutoff = time.time() - _FAIL_WINDOW
    with _FAILS_LOCK:
        for k in (key, "*"):
            _FAILS[k] = [t for t in _FAILS.get(k, []) if t > cutoff]
        return len(_FAILS[key]) >= _FAIL_LIMIT_PER_USER or len(_FAILS["*"]) >= _FAIL_LIMIT_GLOBAL


def _record_failure(key: str) -> None:
    now = time.time()
    with _FAILS_LOCK:
        _FAILS.setdefault(key, []).append(now)
        _FAILS.setdefault("*", []).append(now)


def _secure_cookie(request: Request) -> bool:
    host = (request.headers.get("host") or "").split(":")[0].lower()
    return host not in {"localhost", "127.0.0.1", "testserver"}


def set_session_cookie(response: Response, request: Request, name: str, token: str, max_age: int) -> None:
    response.set_cookie(name, token, max_age=max_age, httponly=True, secure=_secure_cookie(request),
                        samesite="lax", path="/")


class LoginBody(BaseModel):
    username: Optional[str] = None
    email: Optional[str] = None
    password: str
    remember: Optional[bool] = True


@router.post("/login")
async def login(body: LoginBody, request: Request, response: Response):
    user = (body.username or body.email or "").strip()
    key = user.lower() or "?"
    if _throttled(key):
        response.status_code = 429
        return {"error": "too_many_attempts"}
    match = check_operator_credentials(user, body.password or "")
    if not match:
        _record_failure(key)
        response.status_code = 401
        return {"error": "invalid_credentials"}
    ttl = COOKIE_MAX_AGE if body.remember is not False else SHORT_COOKIE_MAX_AGE
    set_session_cookie(response, request, OPERATOR_COOKIE, issue_operator_token(match, ttl), ttl)
    data: dict[str, Any] = {"operator": {"name": match.get("name") or match["sub"], "sub": match["sub"]}}
    if match["src"] == "sys_admin":
        # The System Health / Social Agent / Ad Launcher pages keep their own
        # bearer token in localStorage; hand it over so they skip their login.
        from app.system_health_routes import _issue_token
        now = int(time.time())
        data["system_admin_token"] = _issue_token({"sub": match["sub"], "name": match.get("name"),
                                                   "role": "sys_admin", "iat": now, "exp": now + min(ttl, 7 * 24 * 3600)})
    return {"data": data}


@router.post("/logout")
async def logout(request: Request, response: Response):
    for name in (OPERATOR_COOKIE, VENDOR_COOKIE):
        response.delete_cookie(name, path="/", secure=_secure_cookie(request), httponly=True, samesite="lax")
    return {"data": {"ok": True}}


@router.get("/session")
async def session(request: Request):
    who = resolve_principals({k.lower(): v for k, v in request.headers.items()})
    op, vendor = who["operator"], who["vendor"]
    return {"data": {
        "gate": gate_enabled(),
        "operator": ({"sub": op.get("sub"), "name": op.get("name") or op.get("sub")} if op else None),
        "vendor": (vendor.get("sub") if vendor else None),
    }}


@router.post("/session")
async def upgrade_session(request: Request, response: Response):
    """Swap a still-valid system-admin bearer token for the operator cookie.

    Lets anyone already signed in to System Health keep working without a
    second login the first time the gate is switched on.
    """
    headers = {k.lower(): v for k, v in request.headers.items()}
    auth = (headers.get("authorization") or "").strip()
    token = auth.split(" ", 1)[1].strip() if auth.lower().startswith("bearer ") else ""
    admin = verify_system_admin_bearer(token) if token else None
    if not admin:
        response.status_code = 401
        return {"error": "unauthorized"}
    email = str(admin.get("sub") or "").lower()
    entry = next((a for a in _system_admins() if a.get("email") == email), None)
    if not entry:
        response.status_code = 401
        return {"error": "unauthorized"}
    match = {"sub": email, "name": entry.get("name"), "src": "sys_admin",
             "fp": _fingerprint("sys_admin", email, str(entry.get("password") or ""))}
    remaining = max(60, int(admin.get("exp") or 0) - int(time.time()))
    ttl = min(COOKIE_MAX_AGE, remaining)
    set_session_cookie(response, request, OPERATOR_COOKIE, issue_operator_token(match, ttl), ttl)
    return {"data": {"operator": {"sub": email, "name": entry.get("name") or email}}}
