from app.social_agent.openai_agents import deterministic_review, sanitize_fusha_strategy
from app.social_agent import meta
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


def test_fusha_sanitizer_removes_common_dialect_leaks():
    result = sanitize_fusha_strategy({
        "hook_ar": "خروجة زوينة دابا",
        "caption_ar": "السعر 34 درهم بدل 99 درهم + توصيل",
    })

    assert result["hook_ar"] == "نزهة جميلة الآن"
    assert "بدلاً من" in result["caption_ar"]
    assert "+" not in result["caption_ar"]
