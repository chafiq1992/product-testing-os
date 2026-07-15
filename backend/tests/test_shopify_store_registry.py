from app import shopify_store_registry
from app.shopify_store_registry import (
    build_store_registry,
    configured_store_labels,
    store_env_names,
    store_env_value,
)


class _FakeDb:
    @staticmethod
    def get_app_setting(store, key):
        if store == "beitii" and key == "shopify_oauth":
            return {"shop": "beitii.myshopify.com", "access_token": "secret-token"}
        return None


def test_configured_store_labels_are_dynamic_and_deduplicated():
    assert configured_store_labels("irranova,beitii,BEITII") == [
        "irranova",
        "beitii",
        "irrakids",
        "mmd",
    ]


def test_store_env_names_use_uppercase_suffix():
    assert store_env_names("beitii") == {
        "shop_domain": "SHOPIFY_SHOP_DOMAIN_BEITII",
        "client_id": "SHOPIFY_CLIENT_ID_BEITII",
        "client_secret": "SHOPIFY_CLIENT_SECRET_BEITII",
    }


def test_lowercase_env_names_work_during_migration(monkeypatch):
    values = {"SHOPIFY_CLIENT_ID_beitii": "client-id"}
    monkeypatch.setattr(shopify_store_registry.os, "getenv", lambda name, default="": values.get(name, default))
    assert store_env_value("SHOPIFY_CLIENT_ID", "beitii") == (
        "client-id",
        "SHOPIFY_CLIENT_ID_beitii",
    )


def test_registry_never_returns_credentials_or_tokens(monkeypatch):
    values = {
        "SHOPIFY_OAUTH_STORES": "beitii",
        "SHOPIFY_CLIENT_ID_beitii": "client-id",
        "SHOPIFY_CLIENT_SECRET_beitii": "client-secret",
    }
    monkeypatch.setattr(shopify_store_registry.os, "getenv", lambda name, default="": values.get(name, default))

    registry = build_store_registry(_FakeDb)
    beitii = next(item for item in registry if item["label"] == "beitii")

    assert beitii["connected"] is True
    assert beitii["shop"] == "beitii.myshopify.com"
    assert beitii["credentials_configured"] is True
    assert beitii["warnings"]
    assert "client-id" not in repr(registry)
    assert "client-secret" not in repr(registry)
    assert "secret-token" not in repr(registry)
