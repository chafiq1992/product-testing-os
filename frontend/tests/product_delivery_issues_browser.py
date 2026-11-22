"""Run against a local frontend: python tests/product_delivery_issues_browser.py http://127.0.0.1:3000"""

import os
import sys
from urllib.parse import urlparse

from playwright.sync_api import expect, sync_playwright


GROUP = "10744794906913"
SINGLE = "10744794906914"
COLLECTION = "10744794906915"
PERIOD = {"start": "2026-11-01", "end": "2026-11-21"}


def mock_workspace(route):
    path = urlparse(route.request.url).path
    data = {}
    if path.endswith("/session"):
        data = {"operator": True}
    elif path.endswith("/ad_accounts"):
        data = [{"id": "1", "name": "Test account", "store": "irrakids"}]
    elif path.endswith("/ad_account_timezone"):
        data = {"timezone_name": "Africa/Casablanca"}
    elif path.endswith("/stores"):
        data = {"stores": [{"label": "irrakids"}, {"label": "irranova"}]}
    elif path.endswith("/me"):
        data = {"connections": {"meta": {"connected": True}, "shopify": {"connected": True}}}
    elif path.endswith("/bundle"):
        mappings = {
            "A": {"id": GROUP, "kind": "product", "store": "irrakids"},
            "B": {"id": GROUP, "kind": "product", "store": "irranova"},
            "C": {"id": SINGLE, "kind": "product", "store": "irranova"},
            "D": {"id": COLLECTION, "kind": "collection", "store": "irranova"},
        }
        campaigns = [
            {"campaign_id": key, "name": f"Campaign {key} {m['id']}", "status": "ACTIVE",
             "spend": 5, "purchases": 1, "add_to_cart": 1}
            for key, m in mappings.items()
        ]
        data = {"campaigns": campaigns, "mappings": mappings, "campaign_meta": {}}
    route.fulfill(json={"data": data})


def report(scope):
    summary = {
        "received": 12, "fulfilled": 8, "unfulfilled": 3, "partially_fulfilled": 1, "cancelled": 1,
        "tracked": 6, "delivered": 3, "adverse": 1, "in_progress": 2, "queued": 1, "queue_errors": 0,
        "unmatched": 5, "product_complaints": 1,
    }
    queue = {"order_id": "81", "order_name": "#1081", "variants": ["Blue / 30"], "kind": "queue",
             "status": "Pending", "reasons": [], "notes": [], "occurred_at": "2026-11-18T11:55:28+00:00"}
    complaint = {**queue, "order_id": "82", "order_name": "#1082", "kind": "product", "status": "Returned",
                 "reasons": ["Sizing"], "notes": ["La taille est petite."], "occurred_at": "2026-05-18T09:12:38+01:00"}
    mixed = {**complaint, "order_id": "83", "order_name": "#1083", "kind": "unattributed",
             "notes": ["Requested a larger size."], "occurred_at": None}
    return {**scope, "as_of": "2026-11-21T14:00:00+00:00", "shop_domain": "example-shop.myshopify.com",
            "delivery_available": True, "warning": None, "summary": summary, "issues": [queue, complaint, mixed]}


def exercise(browser, url):
    page = browser.new_page(timezone_id="America/Los_Angeles")
    page.route("https://**/*", lambda route: route.abort())
    page.route("**/api/**", mock_workspace)
    requests = []
    page.route("**/api/ads-management/product-delivery-issues", lambda route: requests.append(route))
    page.goto(url + "/ads-management/")
    group = page.get_by_role("button", name=f"Delivery issues for product {GROUP}")
    single = page.get_by_role("button", name=f"Delivery issues for product {SINGLE}")
    dialog = page.get_by_role("dialog", name="Product delivery issues")
    expect(group).to_be_visible()
    expect(single).to_be_visible()
    expect(page.get_by_role("button", name=f"Delivery issues for product {COLLECTION}")).to_have_count(0)
    page.get_by_label("Date range").select_option("custom")
    page.get_by_label("Start date").fill(PERIOD["start"])
    page.get_by_label("End date").fill(PERIOD["end"])
    assert not requests
    group.click()
    chooser = dialog.get_by_role("combobox", name="Store", exact=True)
    expect(chooser).to_have_value("")
    assert not requests
    with page.expect_request("**/api/ads-management/product-delivery-issues"):
        chooser.select_option("irrakids")
    expect(dialog.get_by_role("status")).to_contain_text("Checking")
    with page.expect_request("**/api/ads-management/product-delivery-issues"):
        chooser.select_option("irranova")
    scope = {"store": "irranova", "product_id": GROUP, **PERIOD}
    assert [r.request.post_data_json for r in requests] == [{**scope, "store": "irrakids"}, scope]
    requests[-1].fulfill(json={"data": report(scope)})
    expect(dialog.get_by_text("50% of 6 tracked")).to_be_visible()
    expect(dialog.get_by_text("La taille est petite.")).to_be_visible()
    expect(dialog.get_by_text("2026-05-18 09:12:38 Morocco time")).to_be_visible()
    mixed_row = dialog.get_by_role("listitem").filter(has_text="#1083")
    expect(mixed_row.get_by_text("Mixed order · item unclear")).to_be_visible()
    expect(mixed_row.locator("time")).to_have_count(0)
    page.set_viewport_size({"width": 375, "height": 720})
    rect = dialog.bounding_box()
    assert rect["x"] >= 0 and rect["x"] + rect["width"] <= 375
    dialog.get_by_role("combobox", name="Show", exact=True).select_option("queue")
    expect(dialog.get_by_text("La taille est petite.")).to_have_count(0)
    expect(dialog.get_by_text("Queued since")).to_have_text("Queued since 2026-11-18 11:55:28 Morocco time")
    expect(dialog.get_by_role("link", name="#1081")).to_have_attribute("href", "https://admin.shopify.com/store/example-shop/orders/81")
    requests[0].fulfill(json={"data": {**report(scope), "issues": []}})
    expect(dialog.get_by_role("link", name="#1081")).to_be_visible()
    page.set_viewport_size({"width": 1280, "height": 720})
    page.keyboard.press("Escape")
    expect(group).to_be_focused()

    with page.expect_request("**/api/ads-management/product-delivery-issues"):
        single.evaluate("(button) => { button.click(); button.click() }")
    scope = {"store": "irranova", "product_id": SINGLE, **PERIOD}
    assert len(requests) == 3 and requests[-1].request.post_data_json == scope
    requests[-1].fulfill(status=503, json={"detail": "Shopify is unavailable."})
    expect(dialog.get_by_role("alert")).to_have_text("Shopify is unavailable.")
    with page.expect_request("**/api/ads-management/product-delivery-issues"):
        dialog.get_by_role("button", name="Retry").click()
    partial = {**report(scope), "delivery_available": False, "warning": "Sendo is unavailable.", "issues": []}
    for key in ("tracked", "delivered", "adverse", "in_progress", "queued", "queue_errors", "unmatched", "product_complaints"):
        partial["summary"][key] = None
    requests[-1].fulfill(json={"data": partial})
    expect(dialog.get_by_text("Sendo is unavailable.")).to_be_visible()
    expect(dialog.get_by_text("Delivered", exact=True).locator("..").locator("dd")).to_have_text("Unavailable")
    expect(dialog.get_by_text("Orders received", exact=True).locator("..").locator("dd")).to_have_text("12")
    with page.expect_request("**/api/ads-management/product-delivery-issues"):
        dialog.get_by_role("button", name="Refresh report").click()
    # Close a pending report, change dates, then resolve the old request last.
    page.keyboard.press("Escape")
    page.get_by_label("End date").fill("2026-11-20")
    page.get_by_label("Search products and campaigns").fill(SINGLE)
    page.get_by_role("button").filter(has_text="Search all time for").click()
    expect(page.get_by_label("Date range")).to_have_value("maximum")
    with page.expect_request("**/api/ads-management/product-delivery-issues"):
        single.click()
    scope = {**scope, "end": "2026-11-20"}
    assert requests[-1].request.post_data_json == scope
    expect(dialog.get_by_text("Orders placed 2026-11-01 to 2026-11-20 (Morocco time)")).to_be_visible()
    empty = report(scope)
    empty.update(issues=[], summary=dict.fromkeys(empty["summary"], 0))
    requests[-1].fulfill(json={"data": empty})
    expect(dialog.get_by_text("No Shopify orders contained this product", exact=False)).to_be_visible()
    requests[-2].fulfill(json={"data": report(scope)})
    expect(dialog.get_by_role("link")).to_have_count(0)
    page.close()

    page = browser.new_page()
    page.route("https://**/*", lambda route: route.abort())
    page.route("**/api/**", mock_workspace)
    page.route("**/api/ads-management/product-delivery-issues", lambda route: requests.append(route))
    page.add_init_script("""sessionStorage.setItem('sendo_workspace_session:true_manager', JSON.stringify({
      service:'true_manager', workspace:'m7349', token:'fixture-session',
      expires_at:Date.now()/1000+3600, connections:{meta:{connected:true}, shopify:{connected:true}}
    }))""")
    page.goto(url + "/ads-management/?embed=1")
    with page.expect_request("**/api/ads-management/product-delivery-issues"):
        page.get_by_role("button", name=f"Delivery issues for product {GROUP}").click()
    request = requests[-1].request
    assert request.post_data_json["store"] == "m7349"
    assert request.headers["x-workspace-token"] == "fixture-session"
    requests[-1].fulfill(json={"data": report(request.post_data_json)})
    expect(page.get_by_role("dialog").get_by_role("combobox", name="Store", exact=True)).to_have_count(0)
    page.close()


if __name__ == "__main__":
    origin = sys.argv[1].rstrip("/")
    if urlparse(origin).hostname not in ("localhost", "127.0.0.1", "::1"):
        raise ValueError("Use a local frontend URL.")
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel=os.environ.get("PLAYWRIGHT_CHROMIUM_CHANNEL"))
        exercise(browser, origin)
        browser.close()
    print("Product delivery report browser checks passed.")
