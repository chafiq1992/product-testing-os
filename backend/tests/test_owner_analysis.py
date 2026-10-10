from datetime import date

import pytest

from app import owner_analyzer as oa
from app import purchase_orders as po


DAYS = ["2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10"]


@pytest.mark.parametrize("tags,expected", [(["3"], 3), (["supplier", "12"], 12), (["Crates: 4"], 4), (["2 boxes"], 2), (["urgent"], 0), ([], 0)])
def test_crates_follow_inventory_helper_tag_convention(tags, expected):
    assert po.crates_from_tags(tags) == expected


def test_group_products_builds_color_by_size_tables():
    grouped = po.group_products([
        {"product_id": "11", "title": "Dress", "color": "Red", "size": "2", "quantity": 5},
        {"product_id": "11", "title": "Dress", "color": "Red", "size": "4", "quantity": 3},
        {"product_id": "11", "title": "Dress", "color": "Blue", "size": "2", "quantity": 2},
        {"product_id": "22", "title": "Shoe", "color": "—", "size": "30", "quantity": 1},
    ])
    assert [g["product_id"] for g in grouped] == ["11", "22"]
    assert grouped[0]["quantity"] == 10
    assert grouped[0]["matrix"] == {"Red": {"2": 5, "4": 3}, "Blue": {"2": 2}}
    assert grouped[0]["sizes"] == ["2", "4"]


def test_period_and_legacy_dates_use_morocco_days():
    start, end = po.period_for_days(5, today=date(2026, 10, 10))
    assert (start, end) == (date(2026, 10, 6), date(2026, 10, 10))
    assert po._in_period("2026-10-06T00:30:00+00:00", start, end)
    assert not po._in_period("2026-10-05T22:00:00Z", start, end)  # still the 5th in Morocco (UTC+0 or the old UTC+1)
    assert po._in_period("10/08/2026", start, end)


def test_helper_state_overrides_shopify_status():
    orders = [{"id": "gid://shopify/InventoryTransfer/1", "status": "open", "status_label": "In Progress", "total_crates": 0},
              {"id": "gid://shopify/InventoryTransfer/2", "status": "open", "status_label": "Draft", "total_crates": 2}]
    po.apply_helper_state(orders, [
        {"shopify_order_gid": "gid://shopify/InventoryTransfer/1", "status": "complete", "ordered_crates": 5, "actual_crates": 5, "reported_items_received": 90},
    ])
    assert orders[0]["status"] == "closed" and orders[0]["status_label"] == "Received"
    assert orders[0]["total_crates"] == 5 and orders[0]["received_items"] == 90
    assert orders[1]["status"] == "open"


def test_recent_purchase_orders_reads_transfers_and_indexes_products(monkeypatch):
    def gql(store, query, variables):
        if "inventoryTransfers" in query:
            return {"inventoryTransfers": {"nodes": [
                {"id": "gid://shopify/InventoryTransfer/9", "name": "#T9", "referenceName": "PO-77", "dateCreated": "2026-10-09T10:00:00Z",
                 "status": "TRANSFERRED", "tags": ["4"], "totalQuantity": 30, "destination": {"name": "Main", "location": {"name": "Casa"}}},
            ], "pageInfo": {"hasNextPage": False}}}
        return {"inventoryTransfer": {"lineItems": {"nodes": [
            {"totalQuantity": 30, "inventoryItem": {"sku": "A", "variant": {"id": "gid://shopify/ProductVariant/5", "title": "Red / 2",
             "selectedOptions": [{"name": "Color", "value": "Red"}, {"name": "Size", "value": "2"}],
             "product": {"id": "gid://shopify/Product/123", "title": "Dress", "featuredMedia": None}}}},
        ], "pageInfo": {"hasNextPage": False}}}}
    monkeypatch.setattr(po, "_transfer_gql", gql)
    monkeypatch.setattr(po, "period_for_days", lambda days, today=None: (date(2026, 10, 6), date(2026, 10, 10)))
    monkeypatch.delenv("INVENTORY_HELPER_API_URL", raising=False)
    data = po.recent_purchase_orders("irranova", 5, use_cache=False)
    order = data["orders"][0]
    assert order["name"] == "PO-77" and order["status"] == "closed" and order["total_crates"] == 4
    assert order["products"][0]["matrix"] == {"Red": {"2": 30}}
    assert data["by_product"] == {"123": ["gid://shopify/InventoryTransfer/9"]}


def test_permission_error_is_reported_not_raised(monkeypatch):
    def denied(*_args, **_kwargs):
        raise PermissionError("Shopify denied inventory-transfer access.")
    monkeypatch.setattr(po, "_transfer_gql", denied)
    monkeypatch.delenv("INVENTORY_HELPER_API_URL", raising=False)
    data = po.recent_purchase_orders("nostore", 5, use_cache=False)
    assert data["source"] is None and data["orders"] == []
    assert "denied" in data["errors"][0]


def _economics(orders_by_day, *, price=299.0, cost=None, service=None, inventory=40, spend_per_day=10.0, currency="USD"):
    meta_daily = [{"date": d, "spend": spend_per_day, "impressions": 1000, "link_clicks": 20, "add_to_cart": 4, "purchases": 1} for d in DAYS]
    return oa.compute_economics(days=DAYS, meta_daily=meta_daily, orders_by_day=orders_by_day, currency=currency,
                                price=price, product_cost=cost, service_cost=service, inventory_total=inventory)


def test_economics_use_default_costs_and_dashboard_rate(monkeypatch):
    monkeypatch.setenv("ADS_USD_TO_MAD", "10")
    econ = _economics({d: 2 for d in DAYS})
    unit, totals = econ["unit_economics"], econ["totals"]
    assert unit["product_cost_mad"] == 120 and unit["product_cost_source"] == "default"
    assert unit["service_cost_mad"] == 70
    assert unit["margin_before_ads_mad"] == 109.0
    assert totals["spend_mad"] == 500.0 and totals["real_orders"] == 10
    assert totals["true_cpp_mad"] == 50.0
    assert unit["estimated_profit_5d_mad"] == 10 * 109 - 500
    assert econ["inventory_cover"]["days_of_cover"] == 20.0
    assert totals["link_ctr"] == 2.0


def test_saved_costs_and_mad_accounts_are_respected():
    econ = _economics({d: 1 for d in DAYS}, cost=80, service=60, currency="MAD", spend_per_day=50)
    assert econ["unit_economics"]["margin_before_ads_mad"] == 159.0
    assert econ["totals"]["spend_mad"] == 250.0
    assert econ["daily"][0]["true_cpp_mad"] == 50.0


def test_guard_blocks_unprofitable_or_thin_scale_calls():
    losing = _economics({d: 1 for d in DAYS}, spend_per_day=30)  # 1500 MAD for 5 orders
    assert oa.guard_signal({"signal": "scale", "confidence": "high"}, losing)["signal"] == "fix"
    thin = _economics({DAYS[-1]: 2}, spend_per_day=1)
    assert oa.guard_signal({"signal": "scale", "confidence": "high"}, thin)["signal"] == "watch"
    burning = _economics({}, spend_per_day=10)  # 500 MAD, no orders, margin 109
    assert oa.guard_signal({"signal": "watch", "confidence": "low"}, burning)["signal"] == "fix"
    stockout = _economics({d: 3 for d in DAYS}, inventory=0)
    report = oa.guard_signal({"signal": "scale", "confidence": "high"}, stockout)
    assert report["signal"] == "fix" and report["guardrail_notes"]
    healthy = _economics({d: 3 for d in DAYS})
    assert oa.guard_signal({"signal": "scale", "confidence": "high"}, healthy) == {"signal": "scale", "confidence": "high"}


def test_campaign_adsets_reports_active_days_and_daily_spend(monkeypatch):
    def edges(path, params, max_pages=1):
        if path.endswith("/adsets"):
            return [
                {"id": "1", "name": "Broad", "effective_status": "ACTIVE", "start_time": "2026-10-08T09:00:00+0100", "daily_budget": "2000",
                 "targeting": {"age_min": 25, "geo_locations": {"countries": ["MA"]}}},
                {"id": "2", "name": "Old paused", "effective_status": "PAUSED", "created_time": "2026-09-01T00:00:00+0000"},
                {"id": "3", "name": "Paused but spent", "effective_status": "PAUSED", "created_time": "2026-10-01T00:00:00+0000"},
            ]
        return [
            {"adset_id": "1", "date_start": "2026-10-09", "spend": "5", "impressions": "500", "inline_link_clicks": "10", "actions": [{"action_type": "add_to_cart", "value": "2"}]},
            {"adset_id": "1", "date_start": "2026-10-10", "spend": "7", "impressions": "500", "inline_link_clicks": "5", "actions": [{"action_type": "purchase", "value": "1"}]},
            {"adset_id": "3", "date_start": "2026-10-06", "spend": "3", "impressions": "100", "inline_link_clicks": "1"},
        ]
    monkeypatch.setattr(oa.meta, "_list_graph_edge_all", edges)
    monkeypatch.setenv("ADS_USD_TO_MAD", "10")
    rows = oa.campaign_adsets("99", DAYS, "USD")
    assert [r["adset_id"] for r in rows] == ["1", "3"]
    broad = rows[0]
    assert broad["days_active"] == 3 and broad["spend_5d_mad"] == 120.0
    assert broad["daily_spend_mad"]["2026-10-10"] == 70.0 and broad["daily_spend_mad"]["2026-10-06"] == 0
    assert broad["budget"] == {"type": "daily", "amount": 20.0, "amount_mad": 200.0}
    assert broad["link_ctr"] == 1.5 and broad["add_to_cart"] == 2 and broad["meta_purchases"] == 1
    assert broad["targeting"]["countries"] == ["MA"]


def test_landing_candidates_prefer_arabic_pages():
    urls = oa.landing_candidates(["https://irranova.com/products/dress?utm_source=fb", "http://insecure.test/x"], "dress", ["www.irranova.com"], "https://irranova.myshopify.com/products/dress")
    assert urls[0] == "https://irranova.com/ar/products/dress?utm_source=fb"
    assert urls[1] == "https://www.irranova.com/ar/products/dress"
    assert "https://irranova.com/products/dress?utm_source=fb" in urls
    assert all(u.startswith("https://") for u in urls)
    assert oa._arabic_variant("https://a.com/ar/products/x") == "https://a.com/ar/products/x"


def test_page_text_strips_markup():
    page = oa._page_text('<html lang="ar"><head><title>فستان</title><style>p{}</style></head><body><h1>فستان صيفي</h1><script>x()</script><p>الدفع عند الاستلام</p></body></html>')
    assert page["lang"] == "ar" and page["title"] == "فستان"
    assert page["visible_text"] == "فستان فستان صيفي الدفع عند الاستلام"


def test_report_contract_is_strict_json_schema():
    schema = oa.OwnerProductReport.model_json_schema()
    assert schema["additionalProperties"] is False
    assert set(schema["required"]) == set(oa.OwnerProductReport.model_fields)


def _fake_report(signal="scale"):
    return {"signal": signal, "headline": "h", "summary": "s", "confidence": "high", "key_findings": [], "ads_creative": [], "adsets": [],
            "landing_page": [], "offer_and_pricing": [], "inventory": [], "data_gaps": [], "next_check": "48h", "other_platforms": [],
            "scaling_plan": {"method": "m", "steps": [], "budget_change": "", "guardrails": []}}


def test_analyze_product_applies_guardrails_and_attaches_inputs(monkeypatch):
    econ = _economics({DAYS[-1]: 1}, spend_per_day=1)  # one order: not enough to scale
    context = {"product": {"title": "Dress"}, "economics": econ, "adsets": [], "landing_page": {}, "inventory": {},
               "purchase_orders_last_5_days": [], "data_gaps": [], "_evidence": []}
    monkeypatch.setattr(oa, "gather_product", lambda product, settings, days: (dict(context), []))
    seen = {}
    def fake_structured(contract, *, instructions, content, model, settings):
        seen.update(budget=settings.max_output_tokens, instructions=instructions)
        return _fake_report("scale")
    monkeypatch.setattr(oa, "structured_response", fake_structured)
    report = oa.analyze_product({"product_id": "123", "campaign_ids": ["9"], "store": "irranova", "owner": "nour"}, oa.AnalyzerSettings(), DAYS)
    assert report["signal"] == "watch" and report["guardrail_notes"]
    assert report["product_name"] == "Dress" and report["economics"] is econ
    assert report["date_range"] == {"start": DAYS[0], "end": DAYS[-1]}
    assert seen["budget"] >= 12000 and "Write in English" in seen["instructions"]


def test_job_runs_saves_reports_and_serves_results(monkeypatch):
    import asyncio
    from app import meta_connection
    monkeypatch.setattr(meta_connection, "reporting_token", lambda store, account=None: None)
    calls = []
    def fake_analyze(product, settings, days):
        calls.append(product["product_id"])
        if product["product_id"] == "222":
            raise ValueError("Meta unavailable")
        return {**_fake_report("fix"), "product_id": product["product_id"], "store": product["store"], "analyzed_at": "now"}
    monkeypatch.setattr(oa, "analyze_product", fake_analyze)
    job_id = "test-job-1"
    oa._save_job(job_id, {"status": "pending", "store": "irranova", "progress": {"done": 0, "total": 2}, "results": {}, "failures": {}})
    oa.run_job(job_id, {"store": "irranova", "settings": oa.AnalyzerSettings().model_dump(), "products": [
        {"product_id": "111", "campaign_ids": ["1"], "store": "irranova"},
        {"product_id": "222", "campaign_ids": ["2"], "store": "irranova"},
    ]})
    job = oa._load_job(job_id)
    assert job["status"] == "done" and job["progress"]["done"] == 2
    assert job["results"]["111"]["signal"] == "fix"
    assert "Meta unavailable" in job["failures"]["222"]
    results = asyncio.run(oa.api_owner_analysis_results(oa.OwnerResultsRequest(items=[{"product_id": "111", "store": "irranova"}, {"product_id": "222", "store": "irranova"}])))
    assert list(results["data"]) == ["111"]
    status = asyncio.run(oa.api_owner_analysis_status(job_id, store="irranova"))
    assert status["status"] == "done"
    assert asyncio.run(oa.api_owner_analysis_status(job_id, store="irrakids"))["status"] == "not_found"


def test_cancelled_job_skips_remaining_products(monkeypatch):
    from app import meta_connection
    monkeypatch.setattr(meta_connection, "reporting_token", lambda store, account=None: None)
    monkeypatch.setattr(oa, "analyze_product", lambda *a: (_ for _ in ()).throw(AssertionError("should not run")))
    job_id = "test-job-cancel"
    oa._save_job(job_id, {"status": "pending", "store": None, "cancel_requested": True, "progress": {"done": 0, "total": 1}})
    oa.run_job(job_id, {"store": None, "settings": oa.AnalyzerSettings().model_dump(), "products": [{"product_id": "1", "campaign_ids": ["1"]}]})
    job = oa._load_job(job_id)
    assert job["status"] == "cancelled" and not job.get("results") and not job.get("failures")
