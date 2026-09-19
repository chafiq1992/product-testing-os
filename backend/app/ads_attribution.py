"""Collection breakdowns of the existing campaign UTM attribution results."""


def collection_order_breakdown(product_ids, attributed_orders, order_products):
    """Count an order once per distinct collection product, never by quantity."""
    ids = list(dict.fromkeys(str(pid) for pid in product_ids))
    products = {pid: {"count": 0, "orders": []} for pid in ids}
    seen = set()
    collection_orders = 0
    for order in attributed_orders:
        order_id = str(order.get("order_id") or "")
        if not order_id or order_id in seen:
            continue
        seen.add(order_id)
        matched = set(order_products.get(order_id, [])) & products.keys()
        if matched:
            collection_orders += 1
        for pid in matched:
            products[pid]["count"] += 1
            products[pid]["orders"].append(order)
    return {
        "product_ids": ids,
        "products": products,
        "campaign_count": len(seen),
        "collection_count": collection_orders,
    }
