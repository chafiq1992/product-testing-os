import json
from uuid import uuid4

import pytest
from cryptography.fernet import Fernet

from app import db


def test_oauth_token_is_encrypted_and_legacy_record_migrates(monkeypatch):
    monkeypatch.setenv("CONNECTION_ENCRYPTION_KEY", Fernet.generate_key().decode())
    store = f"secrets-{uuid4().hex}"
    db.set_app_setting(store, "meta_oauth", {"access_token": "private-meta-token", "accounts": []})
    with db.SessionLocal() as session:
        row = session.get(db.AppSetting, f"{store}|meta_oauth")
        assert "private-meta-token" not in row.value
        assert "access_token_encrypted" in row.value
    assert db.get_app_setting(store, "meta_oauth")["access_token"] == "private-meta-token"

    with db.SessionLocal() as session:
        row = session.get(db.AppSetting, f"{store}|meta_oauth")
        row.value = json.dumps({"shop": "example.myshopify.com", "access_token": "legacy-token"})
        row.key = "shopify_oauth"
        row.pk = f"{store}|shopify_oauth"
        session.commit()
    assert db.get_app_setting(store, "shopify_oauth")["access_token"] == "legacy-token"
    with db.SessionLocal() as session:
        row = session.get(db.AppSetting, f"{store}|shopify_oauth")
        assert "legacy-token" not in row.value


def test_oauth_token_storage_requires_key(monkeypatch):
    monkeypatch.delenv("CONNECTION_ENCRYPTION_KEY", raising=False)
    with pytest.raises(RuntimeError, match="CONNECTION_ENCRYPTION_KEY"):
        db.set_app_setting(f"secrets-{uuid4().hex}", "meta_oauth", {"access_token": "token"})
