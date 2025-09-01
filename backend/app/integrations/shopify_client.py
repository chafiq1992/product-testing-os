import os, requests
from tenacity import retry, stop_after_attempt, wait_exponential
from dotenv import load_dotenv
load_dotenv()

def _normalize_shop_domain(val: str) -> str:
    v = (val or "").strip()
    # remove protocol if provided and any stray whitespace or slashes
    if v.lower().startswith("https://"):
        v = v[8:]
    elif v.lower().startswith("http://"):
        v = v[7:]
    v = v.strip().strip("/\t\n\r ")
    return v

SHOP = _normalize_shop_domain(os.getenv("SHOPIFY_SHOP_DOMAIN", ""))  # your-store.myshopify.com
TOKEN = os.getenv("SHOPIFY_ACCESS_TOKEN", "")
API_KEY = os.getenv("SHOPIFY_API_KEY", "")
PASSWORD = os.getenv("SHOPIFY_PASSWORD", "")
API_VERSION = os.getenv("SHOPIFY_API_VERSION", "2025-07")
GQL = f"https://{SHOP}/admin/api/{API_VERSION}/graphql.json"

headers = {
    "Content-Type": "application/json"
}
if TOKEN:
    headers["X-Shopify-Access-Token"] = TOKEN

PRODUCT_CREATE = """
mutation CreateProduct($input: ProductInput!) {
  productCreate(input: $input) {
    product { id handle onlineStoreUrl title status }
    userErrors { field message }
  }
}
"""

PAGE_CREATE = """
mutation CreatePage($page: PageCreateInput!) {
  pageCreate(page: $page) {
    page { id handle title }
    userErrors { field message }
  }
}
"""

@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, max=8))
def _gql(query: str, variables: dict):
    if not SHOP:
        raise RuntimeError("SHOPIFY_SHOP_DOMAIN is not set. Please configure SHOPIFY_SHOP_DOMAIN env var.")
    # Choose auth: prefer Bearer token; else fallback to Basic auth with API key/password
    auth = None
    if not TOKEN:
        if API_KEY and PASSWORD:
            auth = (API_KEY, PASSWORD)
        else:
            raise RuntimeError("Provide either SHOPIFY_ACCESS_TOKEN or both SHOPIFY_API_KEY and SHOPIFY_PASSWORD.")
    r = requests.post(GQL, headers=headers, json={"query": query, "variables": variables}, timeout=60, auth=auth)
    r.raise_for_status()
    j = r.json()
    if "errors" in j:
        raise RuntimeError(j["errors"])
    data = j.get("data")
    ue = (data or {}).get("productCreate", {}).get("userErrors") or (data or {}).get("pageCreate", {}).get("userErrors")
    if ue:
        raise RuntimeError(ue)
    return data


def _rest_post(path: str, payload: dict):
    """Minimal REST helper for endpoints not covered by GraphQL (e.g., product images)."""
    if not SHOP:
        raise RuntimeError("SHOPIFY_SHOP_DOMAIN is not set. Please configure SHOPIFY_SHOP_DOMAIN env var.")
    base = f"https://{SHOP}/admin/api/{API_VERSION}"
    url = f"{base}{path}"
    auth = None
    if not TOKEN:
        if API_KEY and PASSWORD:
            auth = (API_KEY, PASSWORD)
        else:
            raise RuntimeError("Provide either SHOPIFY_ACCESS_TOKEN or both SHOPIFY_API_KEY and SHOPIFY_PASSWORD.")
    r = requests.post(url, headers=headers, json=payload, timeout=60, auth=auth)
    r.raise_for_status()
    return r.json() if r.content else {}


def create_product_and_page(payload: dict, angles: list, creatives: list, landing_copy: dict | None = None) -> dict:
    title = payload.get("title") or (angles and angles[0].get("titles", ["Offer"])[0]) or "Offer"
    ksp = (angles[0].get("ksp") if angles else [])[:3]
    # Prefer structured landing HTML if provided; otherwise derive a short feature list
    structured_html = (landing_copy or {}).get("html") if landing_copy else None
    desc_html = structured_html or ("<ul>" + "".join([f"<li>{p}</li>" for p in ksp]) + "</ul>" if ksp else "")

    # Collate image URLs: prefer uploaded images from payload; otherwise fall back to creatives
    uploaded_images = payload.get("uploaded_images") or []
    creative_image_urls = [c.get("image_url") for c in (creatives or []) if c.get("image_url")]
    image_urls = uploaded_images or creative_image_urls

    product_in = {
        "title": title,
        "descriptionHtml": desc_html,
        "status": "ACTIVE",
    }

    pdata = _gql(PRODUCT_CREATE, {"input": product_in})["productCreate"]["product"]
    # Attach images via REST after creation (GraphQL ProductInput does not accept images)
    if image_urls:
        try:
            numeric_id = pdata["id"].split("/")[-1]
        except Exception:
            numeric_id = None
        if numeric_id:
            for u in image_urls:
                try:
                    _rest_post(f"/products/{numeric_id}/images.json", {"image": {"src": u}})
                except Exception:
                    # Continue on best-effort basis; image attachment failures should not block page creation
                    pass

    # Build landing page body with sections matched to images (by index)
    sections = (landing_copy or {}).get("sections") or []
    headline = (landing_copy or {}).get("headline") or title
    subheadline = (landing_copy or {}).get("subheadline") or ""
    body_parts = [
        f"<section style=\"text-align:center;padding:16px 0;\"><h2 style=\"margin:0 0 8px;\">{headline}</h2>"
        + (f"<p style=\"margin:0;color:#555;\">{subheadline}</p>" if subheadline else "")
        + "</section>"
    ]
    if sections:
        for idx, sec in enumerate(sections):
            sec_title = sec.get("title") or ""
            sec_body = sec.get("body") or ""
            img_tag = ""
            if image_urls:
                img_url = image_urls[idx % len(image_urls)]
                img_tag = f"<img src=\"{img_url}\" alt=\"{title}\" style=\"width:100%;max-width:720px;display:block;margin:12px auto;border-radius:8px;\"/>"
            body_parts.append(
                "<section style=\"padding:16px 0;\">"
                + (f"<h3 style=\"margin:0 0 8px;\">{sec_title}</h3>" if sec_title else "")
                + (img_tag or "")
                + (f"<p style=\"margin:8px 0 0;line-height:1.5;color:#333;\">{sec_body}</p>" if sec_body else "")
                + "</section>"
            )
    else:
        # Fallback: description HTML followed by a simple gallery
        body_parts.append(desc_html)
        if image_urls:
            gallery = "".join([f"<img src=\"{u}\" alt=\"{title}\" style=\"width:100%;max-width:320px;margin:8px;border-radius:8px;\"/>" for u in image_urls])
            body_parts.append(f"<div style=\"display:flex;flex-wrap:wrap;justify-content:center;\">{gallery}</div>")

    page_body_html = "".join(body_parts)

    handle = f"offer-{pdata['id'].split('/')[-1]}"
    page_in = {
        "title": f"{title} – Offer",
        "handle": handle,
        "templateSuffix": "product_test",
        "isPublished": True,
        "body": page_body_html
    }

    page = _gql(PAGE_CREATE, {"page": page_in})["pageCreate"]["page"]
    page_url = f"https://{SHOP}/pages/{page['handle']}"

    return {"product_gid": pdata["id"], "page_gid": page["id"], "url": page_url}
