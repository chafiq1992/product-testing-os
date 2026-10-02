"""Read-only landing-page capture with bounded, public-network-only navigation."""
import base64
import ipaddress
import socket
import threading
from urllib.parse import urlsplit
from uuid import uuid4

from app.storage import save_file

_capture_lock = threading.Semaphore(1)


def public_url(url: str) -> bool:
    try:
        parts = urlsplit(url)
        if parts.scheme != "https" or not parts.hostname or parts.username or parts.password or parts.port not in (None, 443):
            return False
        addresses = socket.getaddrinfo(parts.hostname, 443, type=socket.SOCK_STREAM)
        return bool(addresses) and all(ipaddress.ip_address(row[4][0]).is_global for row in addresses)
    except (ValueError, OSError):
        return False


def capture_landing_page(urls: list[str], persist_blob=None) -> tuple[list[dict], list[str]]:
    evidence, images = [], []
    if not urls:
        return [{"id": "landing-mobile", "status": "unavailable", "note": "No landing URL is available."}], images
    url = urls[0]
    if not public_url(url):
        return [{"id": "landing-mobile", "status": "unavailable", "note": "Landing URL must use HTTPS on a public host."}], images
    if not _capture_lock.acquire(timeout=5):
        return [{"id": "landing-mobile", "status": "unavailable", "note": "Screenshot service is busy. Run analysis again later."}], images
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True, args=["--no-sandbox", "--disable-dev-shm-usage"])
            try:
                context = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=1, is_mobile=True, has_touch=True, service_workers="block", accept_downloads=False)
                context.route("**/*", lambda route: route.continue_() if route.request.method in ("GET", "HEAD") and public_url(route.request.url) else route.abort())
                page = context.new_page()
                page.set_default_timeout(15000)
                response = page.goto(url, wait_until="domcontentloaded", timeout=25000)
                if not response or response.status >= 400:
                    raise RuntimeError("Landing page did not load successfully")
                page.wait_for_timeout(1200)
                # Capture the actual first screen and one screen near the buying controls.
                for identifier, title, scroll in (("landing-mobile", "Mobile first screen", False), ("landing-buying", "Mobile buying section", True)):
                    if scroll:
                        controls = page.locator('button[type="submit"], input[type="submit"], [name="add"]')
                        if controls.count():
                            controls.first.scroll_into_view_if_needed()
                        else:
                            page.evaluate("window.scrollTo(0, Math.min(document.body.scrollHeight - innerHeight, 1600))")
                    png = page.screenshot(type="png", full_page=False, timeout=15000)
                    filename = f"ads-evidence-{uuid4().hex}.png"
                    path = save_file(filename, png)
                    if persist_blob:
                        persist_blob(filename, png, "image/png")
                    images.append("data:image/png;base64," + base64.b64encode(png).decode())
                    evidence.append({"id": identifier, "status": "captured", "title": title, "url": path, "source_url": page.url, "note": "Current page capture; not a historical recording for the analysis period."})
            finally:
                browser.close()
    except Exception:
        evidence.append({"id": "landing-mobile", "status": "unavailable", "note": "Screenshot capture failed. Check Chromium installation and landing-page access; no visual conclusions are available."})
    finally:
        _capture_lock.release()
    return evidence, images
