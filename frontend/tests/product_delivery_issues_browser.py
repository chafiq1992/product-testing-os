"""Run against a local frontend: python tests/product_delivery_issues_browser.py http://127.0.0.1:3000"""

import os
import sys
from urllib.parse import urlparse

from playwright.sync_api import expect, sync_playwright


GROUP = "10744794906913"
SINGLE = "10744794906914"
COLLECTION = "10744794906915"
PERIOD = {"start": "2026-11-01", "end": "2026-11-21"}
CANCELLATION_DEFINITION = "Explicitly cancelled in Shopify or Sendo after full fulfillment."


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
        "received": 21, "fulfilled": 12, "unfulfilled": 3, "partially_fulfilled": 2, "cancelled": 5,
        "fulfilled_delivered": 5, "fulfilled_cancelled": 1, "fulfilled_cancellation_unverified": 0,
        "tracked": 10, "delivered": 6, "adverse": 3, "in_progress": 1, "queued": 1, "queue_errors": 1,
        "unmatched": 10, "product_complaints": 2,
    }
    queue = {"order_id": "81", "order_name": "#1081", "variants": ["Blue / 30"], "kind": "queue",
             "status": "ERROR (CITY)", "reasons": ["Missing or unrecognized delivery city"], "notes": [], "occurred_at": "2026-11-18T11:55:28+00:00"}
    complaint = {**queue, "order_id": "82", "order_name": "#1082", "kind": "product", "status": "Returned",
                 "reasons": ["Too small", "Larger size requested", "No answer"], "notes": ["La taille est petite."],
                 "reason_groups": {"product": ["Too small", "Larger size requested"], "delivery": ["No answer", "Cancelled after fulfillment"]},
                 "occurred_at": "2026-05-18T09:12:38+01:00", "cancelled_after_fulfillment_at": "2026-11-19T16:03:12+00:00"}
    mixed = {**complaint, "order_id": "83", "order_name": "#1083", "kind": "unattributed",
             "reasons": ["Too small", "Late delivery"], "reason_groups": {"unattributed": ["Too small"], "delivery": ["Late delivery"]},
             "notes": ["Requested a larger size."], "occurred_at": None}
    # A legacy row can repeat a reason. Multiple records can add notes for the same order.
    other = {**queue, "order_id": "84", "order_name": "#1084", "kind": "product", "status": "Returned",
             "reasons": ["Too small", "Too small"], "notes": ["Le 30 serre."]}
    another_note = {**complaint, "reason_groups": {"product": ["Too small"]}, "notes": ["Follow-up confirmed the size."]}
    unmatched = {**queue, "order_id": "85", "order_name": "#1085", "kind": "unmatched", "status": "Fulfilled in Shopify",
                 "reasons": ["No matching Sendo parcel or queue entry"], "occurred_at": None}
    return {**scope, "as_of": "2026-11-21T14:00:00+00:00", "shop_domain": "example-shop.myshopify.com",
            "delivery_available": True, "warning": None, "summary": summary, "cancellation_definition": CANCELLATION_DEFINITION,
            "issues": [queue, complaint, mixed, other, another_note, unmatched]}


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
    delivered = dialog.get_by_role("region", name="Delivery rate", exact=True)
    cancelled = dialog.get_by_role("region", name="Cancellation rate", exact=True)
    expect(delivered.get_by_text("41.7%", exact=True)).to_be_visible()
    expect(delivered.get_by_text("5 of 12 fully fulfilled orders")).to_be_visible()
    expect(cancelled.get_by_text("8.3%", exact=True)).to_be_visible()
    expect(cancelled.get_by_text("1 of 12 fully fulfilled orders")).to_be_visible()
    expect(dialog.get_by_text(CANCELLATION_DEFINITION)).to_be_visible()
    reasons = dialog.get_by_role("region", name="Issues by reason")
    assert reasons.get_by_role("heading", level=4).all_text_contents() == [
        "Product complaints", "Delivery issues", "Dispatch queue", "Mixed orders · item unclear", "Unmatched orders"]
    expect(reasons.get_by_text("5 orders", exact=True)).to_be_visible()
    expect(reasons.get_by_text("An order can appear under more than one reason.", exact=False)).to_be_visible()
    product = reasons.get_by_role("region", name="Product complaints")
    assert product.get_by_role("button").all_inner_texts()[0].startswith("Too small")
    expect(product.get_by_role("button", name="No answer", exact=False)).to_have_count(0)
    expect(dialog.get_by_role("link", name="#1082")).to_have_count(0)
    product.get_by_role("button", name="Too small 2 orders").click()
    expect(product.get_by_role("link", name="#1082")).to_have_count(1)
    expect(product.get_by_role("link", name="#1084")).to_be_visible()
    expect(dialog.get_by_text("La taille est petite.")).to_be_visible()
    expect(dialog.get_by_text("Follow-up confirmed the size.")).to_be_visible()
    expect(dialog.get_by_text("2026-05-18 09:12:38 Morocco time")).to_be_visible()
    product.get_by_role("button", name="Larger size requested 1 order").click()
    expect(product.get_by_role("link", name="#1082")).to_be_visible()
    expect(product.get_by_role("link", name="#1084")).to_have_count(0)
    delivery = reasons.get_by_role("region", name="Delivery issues")
    delivery.get_by_role("button", name="No answer 1 order").click()
    expect(delivery.get_by_role("link", name="#1082")).to_be_visible()
    expect(product.get_by_role("link")).to_have_count(0)
    delivery.get_by_role("button", name="Cancelled after fulfillment 1 order").click()
    expect(delivery.get_by_text("Cancelled 2026-11-19 16:03:12 Morocco time", exact=True)).to_be_visible()
    expect(delivery.get_by_text("2026-05-18 09:12:38 Morocco time")).to_have_count(0)
    mixed = reasons.get_by_role("region", name="Mixed orders · item unclear")
    mixed.get_by_role("button", name="Too small 1 order").click()
    expect(mixed.get_by_role("link", name="#1083")).to_be_visible()
    expect(mixed.locator("time")).to_have_count(0)
    page.set_viewport_size({"width": 375, "height": 720})
    rect = dialog.bounding_box()
    assert rect["x"] >= 0 and rect["x"] + rect["width"] <= 375
    assert dialog.evaluate("(node) => node.scrollWidth <= node.clientWidth")
    reasons.get_by_role("region", name="Dispatch queue").get_by_role("button", name="Missing or unrecognized delivery city 1 order").click()
    expect(dialog.get_by_text("La taille est petite.")).to_have_count(0)
    expect(dialog.get_by_text("Blue / 30")).to_be_visible()
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
    for card in (delivered, cancelled):
        expect(card.get_by_text("Delivery data unavailable")).to_be_visible()
        expect(card).not_to_contain_text("%")
    dialog.get_by_text("Order funnel", exact=False).first.click()
    expect(dialog.get_by_text("Delivered", exact=True).locator("..").locator("dd")).to_have_text("Unavailable")
    expect(dialog.get_by_text("Orders received", exact=True).locator("..").locator("dd")).to_have_text("21")
    with page.expect_request("**/api/ads-management/product-delivery-issues"):
        dialog.get_by_role("button", name="Refresh report").click()
    incomplete = report(scope)
    del incomplete["summary"]["fulfilled_cancelled"]
    del incomplete["summary"]["fulfilled_delivered"]
    requests[-1].fulfill(json={"data": incomplete})
    for card in (delivered, cancelled):
        expect(card.get_by_text("Outcome data unavailable")).to_be_visible()
        expect(card).not_to_contain_text("%")
    with page.expect_request("**/api/ads-management/product-delivery-issues"):
        dialog.get_by_role("button", name="Refresh report").click()
    bounded = report(scope)
    bounded["summary"].update(fulfilled_delivered=0, fulfilled_cancellation_unverified=2, fulfillment_history_unverified=1)
    requests[-1].fulfill(json={"data": bounded})
    expect(delivered.get_by_text("0%", exact=True)).to_be_visible()
    expect(cancelled).to_contain_text("≥")
    expect(cancelled).to_contain_text("8.3%")
    expect(cancelled.get_by_text("Cancellation timing unverified for 2 orders.")).to_be_visible()
    expect(dialog.get_by_text("Both rates exclude 1 order with unverified fulfillment history.")).to_be_visible()
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
    for card in (delivered, cancelled):
        expect(card.get_by_text("No fully fulfilled orders")).to_be_visible()
        expect(card).not_to_contain_text("%")
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
