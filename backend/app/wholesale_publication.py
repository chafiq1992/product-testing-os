"""Publish wholesale products using Shopify's PublicationInput contract."""
from app.integrations.shopify_client import _gql_store

PUBLICATIONS = """
query WholesalePublications($after: String) {
  publications(first: 50, after: $after) {
    nodes { id }
    pageInfo { hasNextPage endCursor }
  }
}
"""
PUBLISH = """
mutation PublishWholesaleProduct($id: ID!, $input: [PublicationInput!]!) {
  publishablePublish(id: $id, input: $input) {
    userErrors { field message }
  }
}
"""


def publish_wholesale_product(product_gid: str, *, store: str) -> dict:
    cursor = None
    ids = []
    while True:
        page = (_gql_store(store, PUBLICATIONS, {"after": cursor}) or {}).get("publications") or {}
        ids.extend(n["id"] for n in page.get("nodes", []) if n.get("id"))
        info = page.get("pageInfo") or {}
        if not info.get("hasNextPage"):
            break
        next_cursor = info.get("endCursor")
        if not next_cursor or next_cursor == cursor:
            raise RuntimeError("Could not load sales channels")
        cursor = next_cursor
    if not ids:
        raise RuntimeError("No sales channels are available")
    for offset in range(0, len(ids), 50):
        data = _gql_store(store, PUBLISH, {"id": product_gid, "input": [{"publicationId": p} for p in ids[offset:offset + 50]]})
        result = (data or {}).get("publishablePublish")
        if not isinstance(result, dict) or result.get("userErrors"):
            raise RuntimeError("Product publication failed: " + str((result or {}).get("userErrors") or "empty response"))
    return {"ok": True, "published": len(ids)}
