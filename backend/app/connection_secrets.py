"""Encrypt OAuth access tokens before persisting connection settings."""

import os

from cryptography.fernet import Fernet


OAUTH_SETTING_KEYS = frozenset({"shopify_oauth", "meta_oauth"})


def _cipher() -> Fernet:
    key = (os.getenv("CONNECTION_ENCRYPTION_KEY") or "").strip()
    if not key:
        raise RuntimeError("CONNECTION_ENCRYPTION_KEY must be configured for OAuth connections")
    return Fernet(key.encode())


def seal_record(key: str, value):
    if key not in OAUTH_SETTING_KEYS or not isinstance(value, dict):
        return value
    record = dict(value)
    token = record.pop("access_token", None)
    if token:
        record["access_token_encrypted"] = _cipher().encrypt(str(token).encode()).decode()
    return record


def open_record(key: str, value):
    if key not in OAUTH_SETTING_KEYS or not isinstance(value, dict):
        return value
    record = dict(value)
    encrypted = record.pop("access_token_encrypted", None)
    if encrypted:
        record["access_token"] = _cipher().decrypt(str(encrypted).encode()).decode()
    return record
