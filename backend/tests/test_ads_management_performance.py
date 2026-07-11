from app import db
from app.integrations import shopify_client


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
