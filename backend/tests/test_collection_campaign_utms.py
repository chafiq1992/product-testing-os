import asyncio
from urllib.parse import parse_qs, urlparse

import pytest

from app.ads_attribution import collection_order_breakdown
from app.integrations import shopify_client


class Response:
    def __init__(self, orders, next_page=None):
        self.orders = orders
        self.headers = {"Link": f'<https://shop.example/orders.json?page_info={next_page}>; rel="next"'} if next_page else {}

    def json(self):
        return {"orders": self.orders}


def test_collection_breakdown_counts_orders_not_units_and_includes_zero_products():
    orders = [{"order_id": "1"}, {"order_id": "2"}, {"order_id": "1"}, {"order_id": "3"}]
    result = collection_order_breakdown([101, 202, 303, 101], orders, {
        "1": ["101", "101", "202", "999"], "2": ["202"], "3": ["999"],
    })
    assert result["product_ids"] == ["101", "202", "303"]
    assert result["campaign_count"] == 3
    assert result["collection_count"] == 2
    assert {pid: product["count"] for pid, product in result["products"].items()} == {"101": 1, "202": 2, "303": 0}
    assert [order["order_id"] for order in result["products"]["202"]["orders"]] == ["1", "2"]


def test_order_products_are_scoped_paginated_and_deduplicated(monkeypatch):
    pages = [
        Response([{"id": 1, "line_items": [{"product_id": 101, "quantity": 5}, {"product_id": 101}, {"product_id": 202}]}], "next"),
        Response([{"id": 2, "cancelled_at": "2026-08-30", "line_items": [{"product_id": 101}]}]),
    ]
    calls = []

    def fetch(store, path):
        calls.append((store, parse_qs(urlparse(path).query)))
        return pages.pop(0)

    monkeypatch.setattr(shopify_client, "_rest_get_store_raw", fetch)
    result = shopify_client.get_order_product_ids(["1", "2", "1"], store="irranova")
    assert result == {"1": ["101", "202"], "2": []}
    assert calls[0] == ("irranova", {"ids": ["1,2"], "status": ["any"], "limit": ["250"], "fields": ["id,line_items,cancelled_at"]})
    assert calls[1] == ("irranova", {"page_info": ["next"], "limit": ["250"]})


def test_order_products_batch_only_the_attributed_order_ids(monkeypatch):
    calls = []

    def fetch(store, path):
        ids = parse_qs(urlparse(path).query)["ids"][0].split(",")
        calls.append(ids)
        return Response([{"id": oid, "line_items": []} for oid in ids])

    monkeypatch.setattr(shopify_client, "_rest_get_store_raw", fetch)
    ids = [str(i) for i in range(1, 202)]
    assert len(shopify_client.get_order_product_ids(ids)) == 201
    assert list(map(len, calls)) == [100, 100, 1]


@pytest.mark.parametrize("orders", [[], [{"id": 1}]])
def test_missing_order_products_do_not_become_zero_sales(monkeypatch, orders):
    monkeypatch.setattr(shopify_client, "_rest_get_store_raw", lambda *_: Response(orders))
    with pytest.raises(RuntimeError, match="unavailable"):
        shopify_client.get_order_product_ids(["1"])


def test_empty_order_products_skips_shopify(monkeypatch):
    def fail(*_):
        pytest.fail("No Shopify call expected")

    monkeypatch.setattr(shopify_client, "_rest_get_store_raw", fail)
    assert shopify_client.get_order_product_ids([]) == {}


@pytest.fixture
def api(monkeypatch):
    from app import main

    async def no_cache(_key, _ttl, compute):
        return await compute()

    monkeypatch.setattr(main, "_cached", no_cache)
    monkeypatch.setattr(main.db, "get_app_setting", lambda *_: None)
    monkeypatch.setattr(main.db, "set_app_setting", lambda *_: None)
    monkeypatch.setattr(main, "list_adsets_with_insights", lambda *_: [
        {"adset_id": "222", "name": "Blue audience AdSet"},
        {"adset_id": "333", "name": "Red audience AdSet"},
    ])
    monkeypatch.setattr(main, "list_ads_for_adsets", lambda *_: {"222": ["444"], "333": ["555"]})
    return main


def test_collection_and_product_campaigns_have_identical_utm_attribution(api, monkeypatch):
    rows = [
        {"order_id": "1", "campaign_id": "111", "utm": {"utm_campaign": "111"}},
        {"order_id": "2", "campaign_id": "111", "utm": {"utm_content": "Blue audience"}},
        {"order_id": "3", "campaign_id": "111", "ad_id": "555"},
        {"order_id": "4", "adset_id": "222"},
        {"order_id": "5", "ad_id": "444"},
        {"order_id": "6", "campaign_id": "999"},
        {"order_id": "7"},
    ]
    monkeypatch.setattr(api, "list_orders_with_utms_processed", lambda *_, **__: rows)
    product = asyncio.run(api.api_campaign_adset_orders("111", "2026-08-25", "2026-08-31", store="irrakids", mapping_kind="product"))
    collection = asyncio.run(api.api_campaign_adset_orders("111", "2026-08-25", "2026-08-31", store="irrakids", mapping_kind="collection"))
    assert product == collection
    assert {key: value["count"] for key, value in collection["data"].items()} == {"__campaign__": 1, "222": 3, "333": 1}
    assert {o["order_id"] for bucket in collection["data"].values() for o in bucket["orders"]} == {"1", "2", "3", "4", "5"}


def test_collection_endpoint_uses_campaign_orders_and_the_mapped_store(api, monkeypatch):
    calls = []

    def orders(start, end, **kwargs):
        calls.append(("orders", start, end, kwargs))
        return [
            {"order_id": "1", "campaign_id": "111", "utm": {"utm_campaign": "111"}},
            {"order_id": "2", "campaign_id": "111", "ad_id": "555"},
            {"order_id": "3", "campaign_id": "999"},
        ]

    def products(collection_id, **kwargs):
        calls.append(("collection", collection_id, kwargs))
        return [101, 202, 303]

    def order_products(ids, **kwargs):
        calls.append(("products", ids, kwargs))
        assert set(ids) == {"1", "2"}
        return {"1": ["101", "202"], "2": ["202"]}

    monkeypatch.setattr(api, "list_orders_with_utms_processed", orders)
    monkeypatch.setattr(api, "list_product_ids_in_collection", products)
    monkeypatch.setattr(api, "get_order_product_ids", order_products)
    result = asyncio.run(api.api_campaign_collection_orders("111", "77", "2026-08-25", "2026-08-31", store="irranova"))
    assert "error" not in result
    assert result["data"]["campaign_count"] == 2
    assert {pid: p["count"] for pid, p in result["data"]["products"].items()} == {"101": 1, "202": 2, "303": 0}
    assert all(call[-1]["store"] == "irranova" for call in calls)
    assert ("orders", "2026-08-25", "2026-08-31", {"store": "irranova", "include_closed": True}) in calls


def test_collection_endpoint_surfaces_line_item_failures(api, monkeypatch):
    monkeypatch.setattr(api, "list_orders_with_utms_processed", lambda *_, **__: [{"order_id": "1", "campaign_id": "111"}])
    monkeypatch.setattr(api, "list_product_ids_in_collection", lambda *_, **__: [101])

    def fail(*_, **__):
        raise RuntimeError("Shopify unavailable")

    monkeypatch.setattr(api, "get_order_product_ids", fail)
    result = asyncio.run(api.api_campaign_collection_orders("111", "77", "2026-08-25", "2026-08-31", store="irrakids"))
    assert result == {"error": "Shopify unavailable", "data": {}}
