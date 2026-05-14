"""Admin-gated routes for the System Health dashboard.

Auth model:
  - Bearer token issued by POST /api/system-health/login.
  - Credentials come from the SYSTEM_ADMIN_USERS env var (JSON map or array,
    same shape as CONFIRMATION_ADMIN_USERS). Signing secret is
    SYSTEM_ADMIN_SECRET, falling back to JWT_SECRET.
  - Tokens carry role="sys_admin" and an exp claim; verified via HMAC-SHA256.

Routes (all under /api/system-health):
  POST /login                      -> { token, admin: { email, name? } }
  GET  /me                         -> { admin } | 401
  GET  /snapshot                   -> full JSON snapshot
  GET  /status                     -> { level, reasons[] }
  POST /confirmation-probe/refresh -> kick the confirmation stuck-orders probe
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
from typing import Optional

from fastapi import APIRouter, Request
from pydantic import BaseModel

from app import system_health as sh


router = APIRouter(prefix="/api/system-health", tags=["system-health"])


# ---------------- auth helpers ----------------

def _b64u_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _b64u_decode(s: str) -> bytes:
    pad = "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode((s or "") + pad)


def _secret() -> bytes:
    sec = (
        os.getenv("SYSTEM_ADMIN_SECRET", "")
        or os.getenv("JWT_SECRET", "")
        or ""
    ).strip()
    if not sec:
        sec = "dev-system-admin-secret"
    return sec.encode("utf-8")


def _issue_token(payload: dict) -> str:
    msg = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    body = _b64u_encode(msg)
    sig = _b64u_encode(hmac.new(_secret(), body.encode("ascii"), hashlib.sha256).digest())
    return f"{body}.{sig}"


def _verify_token(token: str) -> Optional[dict]:
    try:
        tok = (token or "").strip()
        if not tok or "." not in tok:
            return None
        body, sig = tok.split(".", 1)
        exp_sig = _b64u_encode(hmac.new(_secret(), body.encode("ascii"), hashlib.sha256).digest())
        if not hmac.compare_digest(exp_sig, sig):
            return None
        payload = json.loads(_b64u_decode(body).decode("utf-8"))
        if not isinstance(payload, dict):
            return None
        if (payload.get("role") or "").lower() != "sys_admin":
            return None
        try:
            exp = int(payload.get("exp") or 0)
            if exp and int(time.time()) > exp:
                return None
        except Exception:
            return None
        return payload
    except Exception:
        return None


def _load_admin_users() -> list[dict]:
    out: list[dict] = []
    try:
        raw = (os.getenv("SYSTEM_ADMIN_USERS", "") or "").strip()
        if not raw:
            return out
        parsed = json.loads(raw)
        if isinstance(parsed, list):
            for u in parsed:
                if isinstance(u, dict) and u.get("email") and u.get("password"):
                    out.append({
                        "email": str(u["email"]).strip().lower(),
                        "password": str(u["password"]),
                        "name": u.get("name"),
                    })
        elif isinstance(parsed, dict):
            for k, v in parsed.items():
                if k and v:
                    out.append({
                        "email": str(k).strip().lower(),
                        "password": str(v),
                        "name": None,
                    })
    except Exception:
        return out
    return out


def _get_admin(req: Request) -> Optional[dict]:
    auth = (req.headers.get("authorization") or req.headers.get("Authorization") or "").strip()
    token = ""
    if auth.lower().startswith("bearer "):
        token = auth.split(" ", 1)[1].strip()
    if not token:
        token = (req.headers.get("x-system-admin-token") or "").strip()
    if not token:
        return None
    return _verify_token(token)


# ---------------- routes ----------------

class LoginBody(BaseModel):
    email: str
    password: str
    remember: Optional[bool] = True


@router.post("/login")
async def login(body: LoginBody):
    users = _load_admin_users()
    if not users:
        return {"error": "no_admins_configured", "hint": "Set SYSTEM_ADMIN_USERS env"}
    email = (body.email or "").strip().lower()
    pw = body.password or ""
    found = None
    for u in users:
        if u.get("email") == email and hmac.compare_digest(str(u.get("password") or ""), pw):
            found = u
            break
    if not found:
        return {"error": "invalid_credentials"}
    now = int(time.time())
    ttl = 7 * 24 * 3600 if body.remember else 8 * 3600
    token = _issue_token({"sub": email, "name": found.get("name"), "role": "sys_admin", "iat": now, "exp": now + ttl})
    return {"data": {"token": token, "admin": {"email": email, "name": found.get("name")}}}


@router.get("/me")
async def me(req: Request):
    admin = _get_admin(req)
    if not admin:
        return {"error": "unauthorized"}
    return {"data": {"admin": {"email": admin.get("sub"), "name": admin.get("name")}}}


@router.get("/snapshot")
async def get_snapshot(req: Request):
    admin = _get_admin(req)
    if not admin:
        return {"error": "unauthorized"}
    try:
        return {"data": sh.snapshot()}
    except Exception as e:
        return {"error": f"{type(e).__name__}: {e}"}


@router.get("/status")
async def get_status(req: Request):
    admin = _get_admin(req)
    if not admin:
        return {"error": "unauthorized"}
    try:
        return {"data": sh.status()}
    except Exception as e:
        return {"error": f"{type(e).__name__}: {e}", "data": {"level": "warn", "reasons": [{"level": "warn", "code": "HEALTH_INTERNAL", "msg": f"snapshot failed: {e}"}]}}


@router.post("/confirmation-probe/refresh")
async def refresh_confirmation_probe(req: Request):
    admin = _get_admin(req)
    if not admin:
        return {"error": "unauthorized"}
    try:
        # Force a refresh by zeroing the cache ts
        with sh._CONFIRMATION_PROBE_LOCK:  # noqa: SLF001
            sh._CONFIRMATION_PROBE["ts"] = 0.0  # noqa: SLF001
        result = sh._confirmation_probe_cached()  # noqa: SLF001
        return {"data": result or {"pending": True}}
    except Exception as e:
        return {"error": f"{type(e).__name__}: {e}"}
