from app import db
from app.integrations import meta_client, shopify_client


def test_bulk_app_settings_round_trip():
    db.set_app_settings("perf-test", {"a": {"value": 1}, "b": 0})

    assert db.get_app_settings("perf-test", ["a", "b", "missing"]) == {
        "a": {"value": 1},
        "b": 0,
    }


def test_campaign_meta_summary_preserves_table_fields_and_task_count():
    value = {
        "owner": "adil",
        "product_life_checks": {"testing": {"0": True}},
        "timeline": [
            {"text": '{"type":"analysis","analysis":{"large":"payload"}}', "at": "1"},
            {"text": '{"type":"task","done":false}', "at": "2"},
            {"text": '{"type": "task", "done": true}', "at": "3"},
            {"text": "plain note", "at": "4"},
        ],
    }

    summary = db._campaign_meta_summary(value)

    assert "timeline" not in summary
    assert summary["timeline_entries"] == 4
    assert summary["incomplete_tasks"] == 1
    assert summary["owner"] == "adil"
    assert summary["product_life_checks"] == value["product_life_checks"]


def test_inventory_colors_rank_by_available_sizes_then_quantity():
    colors = ["Red", "Blue", "Green"]
    sizes = ["S", "M", "L"]
    matrix = {
        "Red": {"S": 4, "M": 0, "L": 0},
        "Blue": {"S": 1, "M": 1, "L": 0},
        "Green": {"S": 3, "M": 2, "L": 0},
    }

    assert shopify_client._rank_colors_by_available_sizes(colors, sizes, matrix) == [
        "Green",
        "Blue",
        "Red",
    ]


def test_inventory_summary_handles_color_missing_from_product_options():
    node = {
        "id": "gid://shopify/Product/123",
        "options": [{"name": "Size", "values": ["40", "41"]}],
        "variants": {
            "nodes": [
                {
                    "inventoryQuantity": 2,
                    "price": "10.00",
                    "selectedOptions": [
                        {"name": "Size", "value": "40"},
                        {"name": "Color", "value": "Black"},
                    ],
                }
            ]
        },
    }

    summary = shopify_client._inventory_summary_from_graphql_product(node)

    assert summary["colors"] == ["Black"]
    assert summary["matrix"] == {"Black": {"40": 2}}


def test_variant_inventory_bypasses_stored_cache(monkeypatch):
    expected = {"sizes": ["S"], "colors": ["Black"], "matrix": {"Black": {"S": 2}}, "total_available": 2}

    def fail_if_cache_is_read(*_args, **_kwargs):
        raise AssertionError("inventory cache must not be read")

    monkeypatch.setattr(shopify_client, "_get_product_cache", fail_if_cache_is_read)
    monkeypatch.setattr(shopify_client, "_get_product_inventory_graphql", lambda *_args, **_kwargs: expected)

    assert shopify_client.get_product_variants_inventory("123", store="irrakids") == expected


def test_fresh_product_brief_does_not_create_missing_store_placeholders(monkeypatch):
    expected = {
        "123": {
            "image": "https://cdn.shopify.com/product.jpg",
            "total_available": 4,
            "zero_variants": 0,
            "zero_sizes": 0,
            "price": 10.0,
        }
    }
    monkeypatch.setattr(shopify_client, "_get_products_brief_graphql", lambda *_args, **_kwargs: expected)

    result = shopify_client.get_products_brief(["123", "999"], store="irrakids", fresh_inventory=True)

    assert result == expected
    assert "999" not in result


def test_meta_collection_tracking_signature_resolves_and_matches_exact_utm():
    ad = {
        "id": "333",
        "name": "Creative A",
        "creative": {
            "url_tags": "utm_source=meta&utm_medium=cpc&utm_campaign={{campaign.id}}&utm_content={{adset.id}}&ad_id={{ad.id}}",
        },
    }

    signature = meta_client._extract_meta_ad_tracking_params(
        ad,
        campaign_id="111",
        adset_id="222",
        adset_name="Collection audience",
    )

    assert signature == {
        "utm_source": "meta",
        "utm_medium": "cpc",
        "utm_campaign": "111",
        "utm_content": "222",
        "ad_id": "333",
    }
    assert meta_client.meta_tracking_signature_matches(
        {
            "utm_source": "meta",
            "utm_medium": "cpc",
            "utm_campaign": "111",
            "utm_content": "222",
            "ad_id": "333",
        },
        signature,
    )
    assert not meta_client.meta_tracking_signature_matches(
        {
            "utm_source": "meta",
            "utm_medium": "cpc",
            "utm_campaign": "111",
            "utm_content": "different-adset",
            "ad_id": "333",
        },
        signature,
    )


def test_meta_ad_account_list_paginates_and_merges_business_accounts(monkeypatch):
    calls = []

    def fake_get(path, params=None):
        params = dict(params or {})
        calls.append((path, params))
        after = params.get("after")
        if path == "me/adaccounts" and not after:
            return {
                "data": [{"id": "act_1", "name": "Direct one", "account_status": 1}],
                "paging": {
                    "cursors": {"after": "direct-page-2"},
                    "next": "https://graph.facebook.com/v20.0/me/adaccounts?after=direct-page-2",
                },
            }
        if path == "me/adaccounts" and after == "direct-page-2":
            return {"data": [{"id": "act_2", "name": "Direct two", "account_status": 1}]}
        if path == "me/businesses":
            return {"data": [{"id": "business-1", "name": "Main business"}]}
        if path == "business-1/owned_ad_accounts":
            return {
                "data": [
                    {"id": "2", "name": "Duplicate two", "account_status": 1},
                    {"id": "act_3", "name": "Owned three", "account_status": 1},
                ]
            }
        if path == "business-1/client_ad_accounts":
            return {"data": [{"id": "act_4", "name": "Client four", "account_status": 2}]}
        raise AssertionError(f"unexpected Meta path: {path} {params}")

    monkeypatch.setattr(meta_client, "ACCESS", "test-token")
    monkeypatch.setattr(meta_client, "_get", fake_get)

    result = meta_client.list_ad_accounts()

    assert [item["id"] for item in result] == ["act_4", "act_1", "act_2", "act_3"]
    assert len([item for item in result if item["id"].removeprefix("act_") == "2"]) == 1
    assert any(path == "me/adaccounts" and params.get("after") == "direct-page-2" for path, params in calls)
    assert {path for path, _params in calls} >= {
        "me/businesses",
        "business-1/owned_ad_accounts",
        "business-1/client_ad_accounts",
    }
