"""Per-person operator accounts, stored in the `app_users` table.

The auth gate (auth_gate.py) accepts these alongside the two credential sets
that live in the environment (SYSTEM_ADMIN_USERS, PRODUCT_TESTING_*), which
stay as the bootstrap/break-glass logins.

* Passwords are hashed with scrypt (stdlib), per-user random salt.
* `session_version` is baked into every session this user gets; disabling the
  user, resetting the password or deleting the row makes the stored value
  disagree, so every existing session dies on its next request.
* The table is created the way the rest of this app creates tables: a model on
  `db.Base` plus `create_all` at import, which only ever adds missing tables.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import re
import secrets
import threading
import time
from datetime import datetime
from typing import Any, Optional
from uuid import uuid4

from sqlalchemy import Boolean, Column, DateTime, Index, Integer, String, func

from app import db

log = logging.getLogger("app.users")
# The audit lines ("user_admin action=... by=...") must reach the container log;
# uvicorn does not configure app loggers, so attach a handler the way main.py does.
if not log.handlers:
    log.addHandler(logging.StreamHandler())
log.setLevel(logging.INFO)

ROLES = ("admin", "operator")
MIN_PASSWORD_LEN = 10
MAX_PASSWORD_LEN = 256
_USERNAME_RE = re.compile(r"^[a-z0-9][a-z0-9._@+-]{2,63}$")


class AppUser(db.Base):
    __tablename__ = "app_users"

    id = Column(String, primary_key=True)
    username = Column(String(64), nullable=False)          # stored lower-cased
    display_name = Column(String(128), nullable=True)
    password_hash = Column(String(256), nullable=False)
    role = Column(String(16), nullable=False, default="operator")
    active = Column(Boolean, nullable=False, default=True)
    session_version = Column(Integer, nullable=False, default=1)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    last_login_at = Column(DateTime, nullable=True)
    created_by = Column(String(128), nullable=True)


# Case-insensitive uniqueness: usernames are normalised to lower case before
# they are written, and the unique index is on lower(username) so even a
# direct SQL insert cannot create a case-variant duplicate.
Index("ux_app_users_username_lower", func.lower(AppUser.username), unique=True)

db.Base.metadata.create_all(db.engine, tables=[AppUser.__table__])


class UserError(Exception):
    """A request the admin API should refuse; `status` is the HTTP code."""

    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


# ---------------------------------------------------------------------------
# Password hashing (scrypt)
# ---------------------------------------------------------------------------

_N, _R, _P, _DKLEN = 2 ** 14, 8, 1, 32


def _b64(raw: bytes) -> str:
    return base64.b64encode(raw).decode("ascii")


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=_N, r=_R, p=_P, dklen=_DKLEN)
    return f"scrypt${_N}${_R}${_P}${_b64(salt)}${_b64(dk)}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, n, r, p, salt_b64, dk_b64 = stored.split("$")
        if algo != "scrypt":
            return False
        expected = base64.b64decode(dk_b64)
        dk = hashlib.scrypt(password.encode("utf-8"), salt=base64.b64decode(salt_b64),
                            n=int(n), r=int(r), p=int(p), dklen=len(expected))
        return hmac.compare_digest(dk, expected)
    except Exception:
        return False


# Spent on unknown usernames so response time does not reveal which exist.
_DUMMY_HASH = hash_password(secrets.token_urlsafe(16))


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

def normalize_username(username: str) -> str:
    return (username or "").strip().lower()


def validate_username(username: str) -> str:
    u = normalize_username(username)
    if not _USERNAME_RE.match(u):
        raise UserError(422, "invalid_username",
                        "Username must be 3-64 characters: letters, digits and . _ @ + -")
    return u


def validate_password(password: str) -> str:
    pw = password or ""
    if len(pw) < MIN_PASSWORD_LEN:
        raise UserError(422, "weak_password", f"Password must be at least {MIN_PASSWORD_LEN} characters")
    if len(pw) > MAX_PASSWORD_LEN:
        raise UserError(422, "invalid_password", "Password is too long")
    return pw


def validate_role(role: str) -> str:
    r = (role or "").strip().lower()
    if r not in ROLES:
        raise UserError(422, "invalid_role", "Role must be admin or operator")
    return r


def _clean_name(name: Optional[str]) -> Optional[str]:
    n = (name or "").strip()
    return n[:128] or None


# ---------------------------------------------------------------------------
# Read path (hot: every gated request by a DB user) — short cache
# ---------------------------------------------------------------------------

_CACHE_TTL = 10.0
_cache: dict[str, tuple[float, Optional[dict]]] = {}
_cache_lock = threading.Lock()


def _public(u: AppUser) -> dict:
    """Everything about a user that may leave the server. Never the hash."""
    iso = lambda d: (d.isoformat() + "Z") if d else None  # noqa: E731
    return {
        "id": u.id,
        "username": u.username,
        "name": u.display_name,
        "role": u.role,
        "active": bool(u.active),
        "created_at": iso(u.created_at),
        "updated_at": iso(u.updated_at),
        "last_login_at": iso(u.last_login_at),
        "created_by": u.created_by,
    }


def _invalidate(user_id: Optional[str] = None) -> None:
    with _cache_lock:
        if user_id:
            _cache.pop(user_id, None)
        else:
            _cache.clear()


def get_session_user(user_id: str) -> Optional[dict]:
    """{id, username, name, role, active, sv} for session checks, cached ~10s."""
    now = time.time()
    with _cache_lock:
        hit = _cache.get(user_id)
        if hit and hit[0] > now:
            return hit[1]
    try:
        with db.SessionLocal() as s:
            u = s.get(AppUser, user_id)
            value = None if u is None else {
                "id": u.id, "username": u.username, "name": u.display_name,
                "role": u.role, "active": bool(u.active), "sv": int(u.session_version or 0),
            }
    except Exception:
        log.exception("users: session lookup failed")
        return None  # fail closed, and do not cache the failure
    with _cache_lock:
        _cache[user_id] = (now + _CACHE_TTL, value)
    return value


def session_valid(user_id: Any, sv: Any) -> Optional[dict]:
    """The live user if a session minted for (user_id, sv) is still good."""
    if not user_id:
        return None
    u = get_session_user(str(user_id))
    try:
        ok = bool(u and u["active"] and int(sv) == u["sv"])
    except Exception:
        ok = False
    return u if ok else None


def authenticate(username: str, password: str) -> Optional[dict]:
    """Session-user dict on success, else None. Always spends one scrypt."""
    uname = normalize_username(username)
    row = None
    try:
        with db.SessionLocal() as s:
            row = s.query(AppUser).filter(func.lower(AppUser.username) == uname).one_or_none() if uname else None
            if row is None:
                verify_password(password or "", _DUMMY_HASH)
                return None
            if not verify_password(password or "", row.password_hash) or not row.active:
                return None
            row.last_login_at = datetime.utcnow()
            s.commit()
            return {"id": row.id, "username": row.username, "name": row.display_name,
                    "role": row.role, "active": True, "sv": int(row.session_version or 0)}
    except Exception:
        log.exception("users: authenticate failed")
        return None


# ---------------------------------------------------------------------------
# Admin operations
# ---------------------------------------------------------------------------

def list_users() -> list[dict]:
    with db.SessionLocal() as s:
        return [_public(u) for u in s.query(AppUser).order_by(AppUser.username).all()]


def _env_admin_count() -> int:
    from app.system_health_routes import _load_admin_users
    try:
        return len(_load_admin_users())
    except Exception:
        return 0


def _active_db_admins(s, exclude_id: Optional[str] = None) -> int:
    q = s.query(AppUser).filter(AppUser.role == "admin", AppUser.active.is_(True))
    if exclude_id:
        q = q.filter(AppUser.id != exclude_id)
    return q.count()


def _guard_last_admin(s, target: AppUser, actor_user_id: Optional[str]) -> None:
    """Refuse a change that leaves an admin with no other active admin, self included."""
    if target.role != "admin" or not target.active:
        return
    if _active_db_admins(s, exclude_id=target.id) + _env_admin_count() > 0:
        return
    who = "yourself" if actor_user_id and actor_user_id == target.id else "this user"
    raise UserError(409, "last_admin", f"Cannot remove admin access from {who}: it is the last active admin")


def create_user(username: str, password: str, role: str, name: Optional[str], actor: str,
                reserved: set[str] = frozenset()) -> dict:
    uname = validate_username(username)
    pw = validate_password(password)
    r = validate_role(role)
    if uname in {x.strip().lower() for x in reserved if x}:
        raise UserError(409, "username_taken", "That username belongs to a built-in login")
    with db.SessionLocal() as s:
        if s.query(AppUser).filter(func.lower(AppUser.username) == uname).count():
            raise UserError(409, "username_taken", "That username already exists")
        now = datetime.utcnow()
        u = AppUser(id=str(uuid4()), username=uname, display_name=_clean_name(name),
                    password_hash=hash_password(pw), role=r, active=True, session_version=1,
                    created_at=now, updated_at=now, created_by=(actor or "")[:128] or None)
        s.add(u)
        try:
            s.commit()
        except Exception:
            s.rollback()
            raise UserError(409, "username_taken", "That username already exists")
        out = _public(u)
    log.info("user_admin action=create target=%s role=%s by=%s", uname, r, actor)
    return out


def _load(s, user_id: str) -> AppUser:
    u = s.get(AppUser, user_id)
    if u is None:
        raise UserError(404, "not_found", "No such user")
    return u


def update_user(user_id: str, *, actor: str, actor_user_id: Optional[str],
                role: Optional[str] = None, active: Optional[bool] = None,
                name: Optional[str] = None) -> dict:
    changes: list[str] = []
    with db.SessionLocal() as s:
        u = _load(s, user_id)
        new_role = validate_role(role) if role is not None else u.role
        new_active = bool(active) if active is not None else bool(u.active)
        if (u.role == "admin" and new_role != "admin") or (u.active and not new_active):
            _guard_last_admin(s, u, actor_user_id)
        if new_role != u.role:
            changes.append(f"role:{u.role}->{new_role}")
            u.role = new_role
        if new_active != bool(u.active):
            changes.append("enabled" if new_active else "disabled")
            u.active = new_active
            if not new_active:
                u.session_version = int(u.session_version or 0) + 1  # end every session now
        if name is not None and _clean_name(name) != u.display_name:
            changes.append("name")
            u.display_name = _clean_name(name)
        if changes:
            u.updated_at = datetime.utcnow()
            s.commit()
        out = _public(u)
    _invalidate(user_id)
    if changes:
        log.info("user_admin action=update target=%s changes=%s by=%s", out["username"], ",".join(changes), actor)
    return out


def reset_password(user_id: str, password: str, *, actor: str) -> dict:
    pw = validate_password(password)
    with db.SessionLocal() as s:
        u = _load(s, user_id)
        u.password_hash = hash_password(pw)
        u.session_version = int(u.session_version or 0) + 1
        u.updated_at = datetime.utcnow()
        s.commit()
        out = _public(u)
    _invalidate(user_id)
    log.info("user_admin action=reset_password target=%s by=%s", out["username"], actor)
    return out


def delete_user(user_id: str, *, actor: str, actor_user_id: Optional[str]) -> None:
    with db.SessionLocal() as s:
        u = _load(s, user_id)
        _guard_last_admin(s, u, actor_user_id)
        uname = u.username
        s.delete(u)
        s.commit()
    _invalidate(user_id)
    log.info("user_admin action=delete target=%s by=%s", uname, actor)
