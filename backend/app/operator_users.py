"""Administrator-managed operator accounts for the app-wide login."""

from __future__ import annotations

import hashlib
import hmac
import os
import re
from datetime import datetime

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError

from app import db
from app.system_health_routes import _get_admin, _load_admin_users

router = APIRouter(prefix="/api/users", tags=["users"])
USERNAME_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{2,63}$")


def _normalize_username(value: str) -> str:
    username = str(value or "").strip().lower()
    if not USERNAME_RE.fullmatch(username):
        raise HTTPException(status_code=400, detail="Username must be 3–64 letters, numbers, dots, underscores, or hyphens")
    return username


def _validate_password(value: str) -> str:
    if len(value or "") < 12:
        raise HTTPException(status_code=400, detail="Password must be at least 12 characters")
    return value


def _hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=16384, r=8, p=1, dklen=32)
    return f"scrypt$16384${salt.hex()}${digest.hex()}"


def _verify_password(password: str, stored: str) -> bool:
    try:
        algorithm, work, salt, digest = stored.split("$", 3)
        if algorithm != "scrypt" or int(work) != 16384:
            return False
        candidate = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1, dklen=32)
        return hmac.compare_digest(candidate, bytes.fromhex(digest))
    except (ValueError, TypeError):
        return False


def get_user(username: str) -> dict | None:
    with db.SessionLocal() as session:
        row = session.get(db.OperatorUser, str(username or "").strip().lower())
        return {"username": row.username, "password_hash": row.password_hash} if row else None


def verify_credentials(username: str, password: str) -> dict | None:
    row = get_user(username)
    return row if row and _verify_password(password, row["password_hash"]) else None


def _require_admin(request: Request) -> None:
    if not _get_admin(request):
        raise HTTPException(status_code=403, detail="System administrator access required")


def _public_user(row: db.OperatorUser) -> dict:
    return {"username": row.username, "created_at": row.created_at.isoformat(), "updated_at": row.updated_at.isoformat()}


class UserCreate(BaseModel):
    username: str
    password: str


class PasswordChange(BaseModel):
    password: str


@router.get("")
def list_users(request: Request):
    _require_admin(request)
    with db.SessionLocal() as session:
        users = session.query(db.OperatorUser).order_by(db.OperatorUser.username).all()
        return {"data": [_public_user(row) for row in users]}


@router.post("", status_code=201)
def create_user(request: Request, body: UserCreate):
    _require_admin(request)
    username = _normalize_username(body.username)
    password = _validate_password(body.password)
    from app.auth_gate import _product_credentials
    shared_name, _ = _product_credentials()
    reserved = {shared_name.lower(), *(str(admin.get("email") or "").lower() for admin in _load_admin_users())}
    if username in reserved:
        raise HTTPException(status_code=409, detail="Username is already in use")
    now = datetime.utcnow()
    with db.SessionLocal() as session:
        row = db.OperatorUser(username=username, password_hash=_hash_password(password), created_at=now, updated_at=now)
        session.add(row)
        try:
            session.commit()
        except IntegrityError as exc:
            session.rollback()
            raise HTTPException(status_code=409, detail="Username is already in use") from exc
        return {"data": _public_user(row)}


@router.put("/{username}/password")
def change_password(request: Request, username: str, body: PasswordChange):
    _require_admin(request)
    username = _normalize_username(username)
    password = _validate_password(body.password)
    with db.SessionLocal() as session:
        row = session.get(db.OperatorUser, username)
        if not row:
            raise HTTPException(status_code=404, detail="User not found")
        row.password_hash = _hash_password(password)
        row.updated_at = datetime.utcnow()
        session.commit()
    return {"data": {"username": username, "password_changed": True}}


@router.delete("/{username}")
def delete_user(request: Request, username: str):
    _require_admin(request)
    username = _normalize_username(username)
    with db.SessionLocal() as session:
        row = session.get(db.OperatorUser, username)
        if not row:
            raise HTTPException(status_code=404, detail="User not found")
        session.delete(row)
        session.commit()
    return {"data": {"username": username, "deleted": True}}
