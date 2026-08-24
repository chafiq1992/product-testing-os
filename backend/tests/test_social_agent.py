from datetime import date, datetime, timedelta, timezone
from uuid import uuid4
from zoneinfo import ZoneInfo

import pytest

from app.social_agent.openai_agents import deterministic_review, sanitize_fusha_strategy
from app.social_agent import meta, openai_agents, repository, service
from app.social_agent import shopify
from app.social_agent.shopify import rank_products


def _product(product_id: str, inventory: int, *, status: str = "ACTIVE", title: str = "Summer sandal"):
    return {
        "id": product_id,
        "title": title,
        "status": status,
        "inventory": inventory,
        "product_type": "Shoes",
        "tags": ["summer"],
        "description": "Lightweight product",
        "images": [{"url": "https://cdn.shopify.com/product.jpg"}],
        "url": f"https://shop.example/products/{product_id}",
        "videos": [],
        "discount_percent": 0,
    }


def test_product_ranking_filters_inactive_and_rotates_recent_products():
    products = [
        _product("top-recent", 100),
        _product("fresh", 80),
        _product("inactive", 500, status="DRAFT"),
    ]

    ranked = rank_products(
        products,
        season="summer",
        minimum_inventory=1,
        recent_ids={"top-recent"},
    )

    assert [item["id"] for item in ranked] == ["fresh", "top-recent"]
    assert all(item["status"] == "ACTIVE" for item in ranked)


def test_reviewer_blocks_unapproved_quantity_offer_and_missing_link():
    product = {
        "url": "https://shop.example/products/item",
        "discount_percent": 0,
    }
    strategy = {
        "caption_ar": "اشتر قطعتين الآن واستفد من العرض.",
        "offer_type": "quantity",
        "offer_text_ar": "اشتر قطعتين",
    }
    config = {
        "quantity_offer_enabled": False,
        "approved_quantity_offer_ar": "",
    }

    blockers = deterministic_review(product, strategy, config)

    assert "Caption does not contain the exact Shopify product URL" in blockers
    assert "Quantity offer was not approved by the operator" in blockers


def test_reviewer_accepts_catalog_backed_markdown_copy():
    url = "https://shop.example/products/item"
    product = {"url": url, "discount_percent": 20}
    strategy = {
        "caption_ar": f"وفّر عشرين في المائة واختر منتجك الآن.\n{url}",
        "offer_type": "markdown",
        "offer_text_ar": "خصم 20%",
    }

    assert deterministic_review(product, strategy, {}) == []


def test_meta_derives_page_token_from_visible_accounts(monkeypatch):
    monkeypatch.setattr(meta, "_credentials", lambda _store: {
        "token": "user-token", "page_id": "page-1", "instagram_id": "",
        "version": "v23.0", "explicit_page_token": "0",
    })
    monkeypatch.setattr(meta, "_call", lambda _method, _cfg, path, _payload=None: {
        "data": [{
            "id": "page-1", "access_token": "page-token",
            "instagram_business_account": {"id": "ig-1"},
        }]
    } if path == "me/accounts" else {})

    resolved = meta._page_credentials("irrakids")

    assert resolved["token"] == "page-token"
    assert resolved["instagram_id"] == "ig-1"


def test_meta_does_not_inherit_irrakids_credentials_for_another_store(monkeypatch):
    monkeypatch.setenv("META_ACCESS_TOKEN", "irrakids-token")
    monkeypatch.setenv("META_PAGE_ID", "irrakids-page")
    for name in ("META_ACCESS_TOKEN_IRRANOVA", "META_PAGE_ACCESS_TOKEN_IRRANOVA", "META_PAGE_ID_IRRANOVA"):
        monkeypatch.delenv(name, raising=False)

    assert meta._credentials("irrakids")["page_id"] == "irrakids-page"
    with pytest.raises(RuntimeError, match="irranova"):
        meta._credentials("irranova")


def test_shopify_catalog_paginates_every_active_product(monkeypatch):
    calls = []

    def fake_gql(_store, _query, variables):
        calls.append(variables.get("after"))
        if variables.get("after") is None:
            return {"products": {"nodes": [{"id": "one", "status": "ACTIVE"}], "pageInfo": {"hasNextPage": True, "endCursor": "next"}}}
        return {"products": {"nodes": [{"id": "two", "status": "ACTIVE"}], "pageInfo": {"hasNextPage": False, "endCursor": None}}}

    monkeypatch.setattr(shopify, "_gql_store", fake_gql)
    products = shopify.list_active_products("irrakids", first=50)

    assert [product["id"] for product in products] == ["one", "two"]
    assert calls == [None, "next"]


def test_recent_completed_batch_reopens_for_reviewer_retry():
    store = f"retry_{uuid4().hex[:10]}"
    repository.save_config(store, {"max_review_attempts": 3})
    run = repository.create_run(
        store, f"{store}:2026-08-24:midday", "midday", 1,
        {"local_date": "2026-08-24", "products": [_product("first", 10)]},
    )
    post = repository.create_post(
        run_id=run["id"], store=store, slot="midday", position=0,
        scheduled_for=datetime.utcnow() + timedelta(hours=1),
        product=_product("first", 10), status="rejected",
    )
    repository.update_post(post["id"], attempts=1)
    repository.update_run(run["id"], status="completed", completed_count=1)

    claimed = repository.claim_next_run(store)

    assert claimed and claimed["id"] == run["id"]
    assert claimed["status"] == "preparing"


def test_fusha_sanitizer_removes_common_dialect_leaks():
    result = sanitize_fusha_strategy({
        "hook_ar": "خروجة زوينة دابا",
        "caption_ar": "السعر 34 درهم بدل 99 درهم + توصيل",
    })

    assert result["hook_ar"] == "نزهة جميلة الآن"
    assert "بدلاً من" in result["caption_ar"]
    assert "+" not in result["caption_ar"]


def test_evening_batch_uses_five_thirty_minute_slots_inside_recovery_window():
    config = {
        "timezone": "Africa/Casablanca",
        "evening_time": "17:00",
        "evening_end_time": "23:59",
        "post_interval_minutes": 30,
    }

    scheduled = [service._scheduled_utc(config, date(2026, 8, 24), "evening", index) for index in range(5)]
    local = [value.replace(tzinfo=timezone.utc).astimezone(ZoneInfo("Africa/Casablanca")) for value in scheduled]

    assert [value.strftime("%H:%M") for value in local] == ["17:00", "17:30", "18:00", "18:30", "19:00"]
    assert all((later - earlier) == timedelta(minutes=30) for earlier, later in zip(scheduled, scheduled[1:]))


def test_midday_keeps_its_independent_spacing():
    config = {
        "timezone": "Africa/Casablanca",
        "midday_time": "14:00",
        "midday_post_interval_minutes": 8,
        "post_interval_minutes": 30,
    }

    first = service._scheduled_utc(config, date(2026, 8, 24), "midday", 0)
    second = service._scheduled_utc(config, date(2026, 8, 24), "midday", 1)

    assert second - first == timedelta(minutes=8)


def test_reviewer_hard_rejects_product_geometry_or_fidelity_mismatch(monkeypatch):
    captured = {}

    def fake_response_json(**kwargs):
        captured["images"] = kwargs.get("images")
        return {
            "decision": "approve",
            "score": 94,
            "summary_en": "Attractive, but the hat geometry changed.",
            "score_reasoning_en": "The brim is compressed and merged with a duplicate layer.",
            "score_breakdown": {
                "product_fidelity": 55,
                "realism": 75,
                "geometry": 40,
                "text_logo_integrity": 100,
                "copy_factuality": 100,
            },
            "source_product_differences": ["The brim shape differs from the Shopify reference."],
            "arabic_errors": [],
            "visual_errors": ["The brim is squashed and merged."],
            "factual_risks": [],
            "strengths": ["Clean background"],
            "repair_instruction": "Keep the source hat unchanged and regenerate only the surrounding atmosphere.",
        }

    monkeypatch.setattr(openai_agents, "_response_json", fake_response_json)
    product = _product("hat", 20, title="Baby hat")
    product["images"].append({"url": "https://cdn.shopify.com/hat-side.jpg"})
    strategy = {
        "caption_ar": f"قبعة أنيقة للأطفال.\n{product['url']}",
        "offer_type": "none",
    }

    result = openai_agents.review_candidate(
        product, strategy, "data:image/png;base64,AAAA", {"minimum_review_score": 82}, 1,
    )

    assert result["decision"] == "reject"
    assert result["score"] == 59
    assert "The brim is squashed and merged." in result["factual_risks"]
    assert captured["images"] == [
        "https://cdn.shopify.com/product.jpg",
        "https://cdn.shopify.com/hat-side.jpg",
        "data:image/png;base64,AAAA",
    ]
