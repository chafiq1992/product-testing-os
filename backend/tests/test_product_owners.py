import json

import pytest

from app import db
from app import product_owners as po


@pytest.fixture(autouse=True)
def clean_owner_rows():
    with db.SessionLocal() as session:
        session.query(db.AppSetting).filter(db.AppSetting.key.like("product_owner:%") | db.AppSetting.key.like("campaign_meta:product-owner:%")).delete(synchronize_session=False)
        session.commit()
    po._vendor_cache.clear()
    yield


@pytest.mark.parametrize("vendor,owner", [("NR", "nour"), (" nr ", "nour"), ("CHF", "chafiq"), ("chf", "chafiq"), ("AD-IL", "adil"), ("ad-il", "adil"), ("Ad Il", "adil"),
                                          ("irrakids", ""), ("Nour", ""), ("", ""), (None, "")])
def test_only_the_three_vendor_codes_name_an_owner(vendor, owner):
    assert po.owner_from_vendor(vendor) == owner


def _vendors(mapping, errors=None):
    return lambda pids, stores: ({pid: v for pid, v in mapping.items() if pid in pids}, errors or [])


def test_saved_owner_survives_any_store_and_vendor_overrides(monkeypatch):
    monkeypatch.setattr(po, "product_vendors", _vendors({"111": "irrakids", "222": "NR", "333": "CHF"}))
    po.save_owner("111", "adil")
    po.save_owner("222", "chafiq")
    owners = po.resolve_owners(["111", "222", "333", "444"], ["irranova"])["owners"]
    assert owners["111"] == {"owner": "adil", "source": "saved", "vendor": "irrakids", "saved_owner": "adil"}
    assert owners["222"]["owner"] == "nour" and owners["222"]["source"] == "vendor" and owners["222"]["saved_owner"] == "chafiq"
    assert owners["333"]["owner"] == "chafiq" and owners["333"]["source"] == "vendor"
    assert owners["444"] == {"owner": "", "source": None, "vendor": None, "saved_owner": ""}
    # A different store selection returns the same saved owner.
    assert po.resolve_owners(["111"], ["irrakids"])["owners"]["111"]["owner"] == "adil"


def test_legacy_store_scoped_owner_is_used_until_a_new_choice(monkeypatch):
    monkeypatch.setattr(po, "product_vendors", _vendors({}))
    db.set_app_setting("irranova", "campaign_meta:product-owner:555", {"owner": "nour"})
    assert po.resolve_owners(["555"], ["irrakids"])["owners"]["555"]["owner"] == "nour"
    po.save_owner("555", "")
    assert po.resolve_owners(["555"], ["irrakids"])["owners"]["555"]["owner"] == ""


def test_last_seen_vendor_owner_is_kept_when_shopify_is_unreachable(monkeypatch):
    monkeypatch.setattr(po, "product_vendors", _vendors({"777": "AD-IL"}))
    assert po.resolve_owners(["777"], ["irranova"])["owners"]["777"]["owner"] == "adil"
    monkeypatch.setattr(po, "product_vendors", _vendors({}, ["irranova: timeout"]))
    result = po.resolve_owners(["777"], ["irranova"])
    assert result["owners"]["777"]["owner"] == "adil" and result["errors"]
    # Saving a manual owner keeps the vendor lock visible in the response.
    saved = po.save_owner("777", "nour")
    assert saved["owner"] == "adil" and saved["source"] == "vendor" and saved["saved_owner"] == "nour"
    # Vendor later changed to a non-owner vendor: the saved choice applies.
    monkeypatch.setattr(po, "product_vendors", _vendors({"777": "irrakids"}))
    assert po.resolve_owners(["777"], ["irranova"])["owners"]["777"]["owner"] == "nour"


def test_vendor_lookup_tries_each_store_and_caches(monkeypatch):
    from app.integrations import shopify_client
    calls = []
    def gql(store, query, variables, timeout=30):
        calls.append(store)
        if store == "irranova":
            return {"nodes": [{"id": "gid://shopify/Product/1", "vendor": "NR"}, None]}
        return {"nodes": [None, {"id": "gid://shopify/Product/2", "vendor": "irrakids"}]}
    monkeypatch.setattr(shopify_client, "_gql_store_once", gql)
    found, errors = po.product_vendors(["1", "2"], ["irranova", "irrakids"])
    assert found == {"1": "NR", "2": "irrakids"} and not errors
    po.product_vendors(["1", "2"], ["irranova", "irrakids"])
    assert calls == ["irranova", "irrakids"]


def test_shopify_vendor_change_updates_owner_on_refresh_and_after_cache_expiry(monkeypatch):
    from app.integrations import shopify_client
    now = [1000.0]
    vendor = ["NR"]
    calls = []
    monkeypatch.setattr(po.time, "time", lambda: now[0])
    def gql(store, query, variables, timeout=30):
        calls.append(vendor[0])
        return {"nodes": [{"id": "gid://shopify/Product/777", "vendor": vendor[0]}]}
    monkeypatch.setattr(shopify_client, "_gql_store_once", gql)
    po.save_owner("777", "adil")
    assert po.resolve_owners(["777"], ["irranova"])["owners"]["777"]["owner"] == "nour"
    vendor[0] = "CHF"
    assert po.resolve_owners(["777"], ["irranova"])["owners"]["777"]["owner"] == "nour"
    refreshed = po.resolve_owners(["777"], ["irranova"], refresh=True)["owners"]["777"]
    assert refreshed == {"owner": "chafiq", "source": "vendor", "vendor": "CHF", "saved_owner": "adil"}
    assert po.load_records(["777"])["777"]["vendor_owner"] == "chafiq"
    vendor[0] = "irrakids"
    now[0] += 61
    removed = po.resolve_owners(["777"], ["irranova"])["owners"]["777"]
    assert removed["owner"] == "adil" and removed["source"] == "saved" and removed["vendor"] == "irrakids"
    assert calls == ["NR", "CHF", "irrakids"]


def test_failed_forced_vendor_refresh_preserves_last_owner_and_can_retry(monkeypatch):
    from app.integrations import shopify_client
    monkeypatch.setattr(shopify_client, "_gql_store_once", lambda *_, **__: {"nodes": [{"id": "gid://shopify/Product/888", "vendor": "NR"}]})
    assert po.resolve_owners(["888"], ["irranova"])["owners"]["888"]["owner"] == "nour"
    def fail(*_, **__):
        raise RuntimeError("Shopify unavailable")
    monkeypatch.setattr(shopify_client, "_gql_store_once", fail)
    failed = po.resolve_owners(["888"], ["irranova"], refresh=True)
    assert failed["errors"] and failed["owners"]["888"]["owner"] == "nour"
    monkeypatch.setattr(shopify_client, "_gql_store_once", lambda *_, **__: {"nodes": [{"id": "gid://shopify/Product/888", "vendor": "AD-IL"}]})
    assert po.resolve_owners(["888"], ["irranova"], refresh=True)["owners"]["888"]["owner"] == "adil"
