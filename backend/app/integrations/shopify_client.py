import os, requests
from tenacity import retry, stop_after_attempt, wait_exponential
from dotenv import load_dotenv
load_dotenv()

SHOP = os.getenv("SHOPIFY_SHOP_DOMAIN", "")  # your-store.myshopify.com
TOKEN = os.getenv("SHOPIFY_ACCESS_TOKEN", "")
API_VERSION = os.getenv("SHOPIFY_API_VERSION", "2025-07")
GQL = f"https://{SHOP}/admin/api/{API_VERSION}/graphql.json"

headers = {
    "X-Shopify-Access-Token": TOKEN,
    "Content-Type": "application/json"
}

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
    r = requests.post(GQL, headers=headers, json={"query": query, "variables": variables}, timeout=60)
    r.raise_for_status()
    j = r.json()
    if "errors" in j:
        raise RuntimeError(j["errors"])
    data = j.get("data")
    ue = (data or {}).get("productCreate", {}).get("userErrors") or (data or {}).get("pageCreate", {}).get("userErrors")
    if ue:
        raise RuntimeError(ue)
    return data


def create_product_and_page(payload: dict, angles: list, creatives: list) -> dict:
    title = payload.get("title") or (angles and angles[0].get("titles", ["Offer"])[0]) or "Offer"
    ksp = (angles[0].get("ksp") if angles else [])[:3]
    desc_html = "<ul>" + "".join([f"<li>{p}</li>" for p in ksp]) + "</ul>" if ksp else ""

    product_in = {
        "title": title,
        "descriptionHtml": desc_html,
        "status": "ACTIVE",
    }

    pdata = _gql(PRODUCT_CREATE, {"input": product_in})["productCreate"]["product"]

    handle = f"offer-{pdata['id'].split('/')[-1]}"
    page_in = {
        "title": f"{title} – Offer",
        "handle": handle,
        "templateSuffix": "product_test",
        "isPublished": True,
        "body": f"<h2>{title}</h2>{desc_html}"
    }

    page = _gql(PAGE_CREATE, {"page": page_in})["pageCreate"]["page"]
    page_url = f"https://{SHOP}/pages/{page['handle']}"

    return {"product_gid": pdata["id"], "page_gid": page["id"], "url": page_url}
