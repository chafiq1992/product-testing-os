"""Administrator-controlled Meta OAuth connections for ads reporting."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from urllib.parse import urlencode
from urllib.parse import urlparse

import requests
from fastapi import APIRouter, Request
from pydantic import BaseModel
from starlette.responses import RedirectResponse

from app import db
from app.integrations.meta_client import list_ad_accounts
from app.shopify_store_registry import canonical_store_label
from app.system_health_routes import _get_admin

router = APIRouter(prefix="/api/connections/meta", tags=["connections"])


def _version() -> str:
    return (os.getenv("META_CONNECT_API_VERSION") or "v26.0").strip()


def _credentials() -> tuple[str, str]:
    return (os.getenv("META_APP_ID") or "").strip(), (os.getenv("META_APP_SECRET") or "").strip()


def _state_secret() -> bytes:
    secret = (os.getenv("OAUTH_STATE_SECRET") or "").strip()
    if not secret:
        raise ValueError("OAUTH_STATE_SECRET must be configured for Meta OAuth")
    return secret.encode()


def _encode_state(payload: dict) -> str:
    body = base64.urlsafe_b64encode(json.dumps(payload, separators=(",", ":")).encode()).decode().rstrip("=")
    signature = hmac.new(_state_secret(), body.encode(), hashlib.sha256).hexdigest()
    return f"{body}.{signature}"


def _decode_state(value: str) -> dict | None:
    try:
        body, signature = value.split(".", 1)
        expected = hmac.new(_state_secret(), body.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(signature, expected):
            return None
        payload = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
        if not isinstance(payload, dict) or int(payload.get("exp") or 0) < time.time():
            return None
        return payload
    except (ValueError, TypeError, KeyError, AttributeError, json.JSONDecodeError):
        return None


def _callback_url() -> str:
    base = (os.getenv("BASE_URL") or "").strip().rstrip("/")
    if not base or not base.startswith("https://"):
        raise ValueError("BASE_URL must be the public HTTPS app URL for Meta OAuth")
    return f"{base}/api/connections/meta/callback"


def _public_record(store: str) -> dict:
    record = db.get_app_setting(store, "meta_oauth") or {}
    if not isinstance(record, dict):
        record = {}
    return {
        "store": store,
        "connected": bool(record.get("access_token") and (not record.get("expires_at") or int(record["expires_at"]) > time.time())),
        "user_name": record.get("user_name"),
        "accounts": record.get("accounts") or [],
        "connected_at": record.get("connected_at"),
        "expires_at": record.get("expires_at"),
        "callback_url": _callback_url() if (os.getenv("BASE_URL") or "").startswith("https://") else None,
        "configured": bool(all(_credentials()) and (os.getenv("OAUTH_STATE_SECRET") or "").strip() and (os.getenv("CONNECTION_ENCRYPTION_KEY") or "").strip() and (os.getenv("DATABASE_URL") or "").strip() and (os.getenv("BASE_URL") or "").startswith("https://")),
    }


def connected_token(store: str | None, ad_account: str | None = None) -> str | None:
    """Resolve a token only when this store's connection includes the account."""
    label = canonical_store_label(store)
    if not label:
        return None
    record = db.get_app_setting(label, "meta_oauth") or {}
    if not isinstance(record, dict):
        return None
    token = str(record.get("access_token") or "").strip()
    if not token:
        return None
    if record.get("expires_at") and int(record["expires_at"]) <= time.time():
        return None
    account = str(ad_account or "").removeprefix("act_")
    if account and not any(str(row.get("id") or "").removeprefix("act_") == account for row in record.get("accounts") or []):
        return None
    return token


def reporting_token(store: str | None, ad_account: str | None = None) -> str | None:
    """Keep an existing OAuth workspace from silently falling back to an env token."""
    label = canonical_store_label(store)
    if not label:
        return None
    record = db.get_app_setting(label, "meta_oauth")
    if not isinstance(record, dict) or not record.get("access_token"):
        return None
    token = connected_token(label, ad_account)
    if not token:
        raise ValueError("Meta connection expired or this ad account is not connected. Reconnect it in Connections settings.")
    return token


class StartRequest(BaseModel):
    store: str
    return_origin: str | None = None


def _return_origin(value: str | None) -> str:
    parsed = urlparse(str(value or ""))
    if parsed.scheme == "https" and parsed.netloc and not parsed.username and not parsed.password:
        return f"https://{parsed.netloc}"
    if parsed.scheme == "http" and parsed.hostname in ("localhost", "127.0.0.1"):
        return f"http://{parsed.netloc}"
    return ""


def _return_url(origin: str, store: str, result: str) -> str:
    return f"{origin}/settings/connections?{urlencode({'store': store, result: '1'})}"


@router.get("/status")
def status(request: Request, store: str):
    if not _get_admin(request):
        return {"error": "unauthorized"}
    label = canonical_store_label(store)
    if not label:
        return {"error": "invalid_store"}
    return {"data": _public_record(label)}


@router.post("/start")
def start(request: Request, body: StartRequest):
    if not _get_admin(request):
        return {"error": "unauthorized"}
    label = canonical_store_label(body.store)
    if not label:
        return {"error": "invalid_store"}
    app_id, app_secret = _credentials()
    if not app_id or not app_secret:
        return {"error": "Set META_APP_ID and META_APP_SECRET on the backend"}
    if not (os.getenv("DATABASE_URL") or "").strip():
        return {"error": "DATABASE_URL is required to store the connection"}
    if not (os.getenv("CONNECTION_ENCRYPTION_KEY") or "").strip():
        return {"error": "CONNECTION_ENCRYPTION_KEY is required to encrypt the connection"}
    try:
        redirect_uri = _callback_url()
        nonce = secrets.token_urlsafe(24)
        db.set_app_setting(None, f"meta_oauth_nonce:{nonce}", {"store": label, "exp": int(time.time()) + 600})
        state = _encode_state({"store": label, "nonce": nonce, "exp": int(time.time()) + 600, "return_origin": _return_origin(body.return_origin)})
        params = {
            "client_id": app_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": "ads_read,ads_management,business_management",
            "state": state,
        }
        return {"data": {"url": f"https://www.facebook.com/{_version()}/dialog/oauth?{urlencode(params)}"}}
    except Exception as exc:
        return {"error": str(exc)}


@router.get("/callback")
def callback(code: str = "", state: str = "", error: str = ""):
    payload = _decode_state(state)
    if not payload:
        return {"error": "invalid_or_expired_state"}
    store = canonical_store_label(payload.get("store"))
    origin = _return_origin(payload.get("return_origin"))
    nonce = str(payload.get("nonce") or "")
    if not store or not nonce:
        return {"error": "invalid_state"}
    saved = db.get_app_setting(None, f"meta_oauth_nonce:{nonce}") or {}
    if saved.get("store") != store or int(saved.get("exp") or 0) < time.time():
        return {"error": "state_already_used_or_expired"}
    db.set_app_setting(None, f"meta_oauth_nonce:{nonce}", {})
    if error or not code:
        return RedirectResponse(_return_url(origin, store, "meta_error"), status_code=302)
    try:
        app_id, app_secret = _credentials()
        graph = f"https://graph.facebook.com/{_version()}"
        response = requests.get(f"{graph}/oauth/access_token", params={
            "client_id": app_id, "client_secret": app_secret,
            "redirect_uri": _callback_url(), "code": code,
        }, timeout=20)
        response.raise_for_status()
        short_token = str(response.json().get("access_token") or "")
        if not short_token:
            raise ValueError("Meta did not return an access token")
        exchange = requests.get(f"{graph}/oauth/access_token", params={
            "grant_type": "fb_exchange_token", "client_id": app_id,
            "client_secret": app_secret, "fb_exchange_token": short_token,
        }, timeout=20)
        exchange.raise_for_status()
        token_data = exchange.json()
        token = str(token_data.get("access_token") or "")
        if not token:
            raise ValueError("Meta did not return a long-lived token")
        accounts = list_ad_accounts(access_token=token)
        me = requests.get(f"{graph}/me", params={"fields": "id,name", "access_token": token}, timeout=20)
        me.raise_for_status()
        user = me.json()
        expires_in = int(token_data.get("expires_in") or 0)
        db.set_app_setting(store, "meta_oauth", {
            "access_token": token,
            "user_id": user.get("id"),
            "user_name": user.get("name"),
            "accounts": accounts,
            "connected_at": int(time.time()),
            "expires_at": int(time.time()) + expires_in if expires_in else None,
        })
        return RedirectResponse(_return_url(origin, store, "meta_connected"), status_code=302)
    except Exception:
        return RedirectResponse(_return_url(origin, store, "meta_error"), status_code=302)
