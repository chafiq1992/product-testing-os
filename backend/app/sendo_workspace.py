"""Sendo merchant workspaces: the delivery app's merchants using True Profit here.

The delivery app (apex-maroc.com) owns who may use a service. When a merchant
opens one, it mints a five-minute launch token signed with the secret both apps
share (``SENDO_LAUNCH_SECRET`` here, ``SERVICES_ENGINE_SECRET`` there):

    base64url(json).hex(hmac_sha256(secret, base64url(json)))
    {"v": 1, "mid": 7, "name": "...", "ws": "m7", "svc": "true_profit",
     "iat": ..., "exp": iat + 300, "jti": "..."}

``POST /api/sendo/session`` exchanges it (once) for a workspace session token.
The embedded page sends that in ``X-Workspace-Token``: the page runs in an
iframe on another site, where browsers increasingly drop cookies.

A workspace is a store label (``m<merchant id>``) like ``irrakids``, so every
existing per-store table already separates its data. What keeps it from the
operator's own stores is enforced elsewhere: auth_gate.py allows a workspace
only a short route list and only its own store, and the Meta and Shopify clients
refuse environment credentials while ``tenant_context`` names a workspace.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import os
import re
import threading
import time
from typing import Any, Optional

import requests
from fastapi import APIRouter, Request, Response
from pydantic import BaseModel

from app import db
from app.tenant_context import current_workspace

log = logging.getLogger("app.sendo_workspace")

WORKSPACE_RE = re.compile(r"^m[1-9][0-9]{0,9}$")
SESSION_TTL = 8 * 60 * 60
LAUNCH_CLOCK_SKEW = 60
SESSION_HEADER = "x-workspace-token"

_used_launch_ids: dict[str, float] = {}
_used_lock = threading.Lock()


def is_workspace_label(value: Any) -> bool:
    return bool(WORKSPACE_RE.fullmatch(str(value or "")))


def launch_secret() -> str:
    secret = (os.getenv("SENDO_LAUNCH_SECRET") or "").strip()
    return secret if len(secret) >= 32 else ""


def enabled_services() -> set[str]:
    raw = os.getenv("SENDO_EMBED_SERVICES", "true_profit")
    return {part.strip() for part in raw.split(",") if part.strip()}


def embed_origins() -> list[str]:
    raw = os.getenv("SENDO_EMBED_ORIGINS", "https://apex-maroc.com")
    return [part.strip().rstrip("/") for part in raw.split(",") if part.strip().startswith("https://")]


def _b64d(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def _claim_launch_id(jti: str, exp: int) -> bool:
    """Single use: a launch link copied out of the fragment cannot be replayed."""
    now = time.time()
    with _used_lock:
        for key, until in list(_used_launch_ids.items()):
            if until < now:
                _used_launch_ids.pop(key, None)
        if jti in _used_launch_ids:
            return False
        _used_launch_ids[jti] = exp + LAUNCH_CLOCK_SKEW
    return True


def verify_launch_token(token: str) -> Optional[dict]:
    secret = launch_secret()
    if not secret or not token or "." not in token:
        return None
    body, signature = token.strip().split(".", 1)
    expected = hmac.new(secret.encode(), body.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(signature, expected):
        return None
    try:
        payload = json.loads(_b64d(body))
    except (ValueError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict) or payload.get("v") != 1:
        return None
    now = int(time.time())
    try:
        mid = int(payload.get("mid"))
        iat = int(payload.get("iat"))
        exp = int(payload.get("exp"))
    except (TypeError, ValueError):
        return None
    ws = str(payload.get("ws") or "")
    jti = str(payload.get("jti") or "")
    if exp < now or iat > now + LAUNCH_CLOCK_SKEW or exp - iat > 600:
        return None
    if ws != f"m{mid}" or not is_workspace_label(ws) or not jti:
        return None
    if payload.get("svc") not in enabled_services():
        return None
    if not _claim_launch_id(jti, exp):
        return None
    return payload


def issue_session_token(launch: dict) -> tuple[str, int]:
    from app.auth_gate import _sign  # the gate's own signing key and format

    now = int(time.time())
    exp = now + SESSION_TTL
    token = _sign({
        "k": "ws",
        "sub": launch["ws"],
        "mid": int(launch["mid"]),
        "name": str(launch.get("name") or "")[:120],
        "svc": launch["svc"],
        "iat": now,
        "exp": exp,
    })
    return token, exp


def verify_session_token(token: str) -> Optional[dict]:
    from app.auth_gate import _unsign

    payload = _unsign(token or "")
    if not payload or payload.get("k") != "ws" or not is_workspace_label(payload.get("sub")):
        return None
    return payload


# ─────────────── store connections pulled from the delivery app ───────────────

def delivery_url() -> str:
    # Both apps sit on the box's shared `edge` network; this never leaves it.
    return (os.getenv("SENDO_DELIVERY_URL") or "http://apex-web:8080").strip().rstrip("/")


def _signed_headers(merchant_id: int) -> dict[str, str]:
    ts = str(int(time.time()))
    message = f"{ts}.{int(merchant_id)}".encode()
    signature = hmac.new(launch_secret().encode(), message, hashlib.sha256).hexdigest()
    return {"X-Sendo-Timestamp": ts, "X-Sendo-Signature": signature}


def sync_shopify_store(workspace: str, merchant_id: int) -> dict:
    """Copy the merchant's connected Shopify store into this workspace.

    The delivery app holds the merchant's Shopify connection (the Sendo app);
    storing it under the workspace label lets the existing Shopify client read
    it exactly as it reads an operator store's OAuth record.
    """
    if not is_workspace_label(workspace) or workspace != f"m{int(merchant_id)}":
        raise ValueError("workspace mismatch")
    response = requests.get(
        f"{delivery_url()}/internal/services/shopify-stores",
        params={"merchant_id": int(merchant_id)},
        headers=_signed_headers(merchant_id),
        timeout=10,
    )
    response.raise_for_status()
    stores = [s for s in (response.json() or {}).get("stores") or [] if s.get("shop_domain") and s.get("access_token")]
    if not stores:
        db.set_app_setting(workspace, "shopify_oauth", {})
        return {"connected": False, "shop": None, "stores": 0}
    primary = stores[0]
    db.set_app_setting(workspace, "shopify_oauth", {
        "shop": str(primary["shop_domain"]).strip().lower(),
        "access_token": str(primary["access_token"]),
        "source": "sendo",
        "synced_at": int(time.time()),
    })
    return {"connected": True, "shop": primary["shop_domain"], "stores": len(stores)}


def connection_status(workspace: str) -> dict:
    meta = db.get_app_setting(workspace, "meta_oauth") or {}
    shopify = db.get_app_setting(workspace, "shopify_oauth") or {}
    meta_ok = bool(isinstance(meta, dict) and meta.get("access_token") and (not meta.get("expires_at") or int(meta["expires_at"]) > time.time()))
    return {
        "meta": {
            "connected": meta_ok,
            "user_name": meta.get("user_name") if meta_ok else None,
            "accounts": len(meta.get("accounts") or []) if meta_ok else 0,
        },
        "shopify": {
            "connected": bool(isinstance(shopify, dict) and shopify.get("access_token")),
            "shop": shopify.get("shop") if isinstance(shopify, dict) else None,
        },
    }


# ─────────────── routes ───────────────

router = APIRouter(prefix="/api/sendo", tags=["sendo"])


class SessionBody(BaseModel):
    launch: str


def _workspace_session(request: Request) -> Optional[dict]:
    return verify_session_token(request.headers.get(SESSION_HEADER) or "")


@router.post("/session")
def create_session(body: SessionBody, response: Response):
    """Exchange a delivery-app launch token for a workspace session."""
    launch = verify_launch_token(body.launch)
    if not launch:
        response.status_code = 401
        return {"error": "invalid_or_expired_launch"}
    token, exp = issue_session_token(launch)
    shopify: dict[str, Any] = {}
    try:
        shopify = sync_shopify_store(launch["ws"], int(launch["mid"]))
    except Exception as exc:  # a store sync failure must not block opening the app
        log.warning("sendo: shopify sync failed for %s: %s", launch["ws"], exc)
        shopify = {"error": "sync_failed"}
    return {"data": {
        "token": token,
        "expires_at": exp,
        "workspace": launch["ws"],
        "merchant_name": launch.get("name"),
        "service": launch["svc"],
        "shopify_sync": shopify,
        "connections": connection_status(launch["ws"]),
    }}


@router.get("/me")
def me(request: Request, store: str | None = None):
    session = _workspace_session(request)
    if not session or current_workspace() != session["sub"]:
        return {"error": "unauthorized"}
    return {"data": {
        "workspace": session["sub"],
        "merchant_name": session.get("name"),
        "service": session.get("svc"),
        "connections": connection_status(session["sub"]),
    }}


@router.post("/sync-stores")
def sync_stores(request: Request, store: str | None = None):
    session = _workspace_session(request)
    if not session or current_workspace() != session["sub"]:
        return {"error": "unauthorized"}
    try:
        result = sync_shopify_store(session["sub"], int(session["mid"]))
    except Exception as exc:
        log.warning("sendo: shopify sync failed for %s: %s", session["sub"], exc)
        return {"error": "sync_failed"}
    return {"data": {"shopify_sync": result, "connections": connection_status(session["sub"])}}


@router.get("/admin/connections")
def admin_connections(request: Request, workspaces: str = ""):
    """Meta/Shopify status per workspace, for the delivery app's admin Services tab.

    Signed like the store sync (merchant id 0 = the admin overview), so the
    delivery app can read it server to server without an operator session.
    """
    ts = request.headers.get("x-sendo-timestamp") or ""
    signature = request.headers.get("x-sendo-signature") or ""
    secret = launch_secret()
    try:
        fresh = abs(time.time() - int(ts)) <= 300
    except ValueError:
        fresh = False
    expected = hmac.new(secret.encode(), f"{ts}.0".encode(), hashlib.sha256).hexdigest() if secret else ""
    if not (secret and fresh and hmac.compare_digest(signature, expected)):
        return {"error": "unauthorized"}
    labels = [w.strip() for w in workspaces.split(",") if is_workspace_label(w.strip())][:500]
    return {"data": {label: connection_status(label) for label in labels}}
