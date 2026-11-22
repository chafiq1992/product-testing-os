"""Shopify orders containing one product, for an on-demand delivery report."""

from datetime import date, datetime, time, timedelta, timezone
import re
from zoneinfo import ZoneInfo

from app.integrations import shopify_client
from app.shopify_store_registry import canonical_store_label, store_env_value
from app.social_agent.shopify_transport import _gql_store
from app.tenant_context import current_workspace


_LINE_PAGE = """
fragment IssueLines on LineItemConnection {
  nodes { product { id } variantTitle }
  pageInfo { hasNextPage endCursor }
}
"""

_ORDERS = """
query ProductIssueOrders($filter: String!, $checkAccess: Boolean!) {
  shop { myshopifyDomain }
  currentAppInstallation @include(if: $checkAccess) { accessScopes { handle } }
  orders(first: 80, sortKey: ID, query: $filter) {
    nodes {
      id name createdAt cancelledAt test displayFulfillmentStatus
      lineItems(first: 8) { ...IssueLines }
    }
    pageInfo { hasNextPage endCursor }
  }
}
""" + _LINE_PAGE

_MORE_LINES = """
query ProductIssueOrderLines($id: ID!, $after: String!) {
  shop { myshopifyDomain }
  order(id: $id) { lineItems(first: 100, after: $after) { ...IssueLines } }
}
""" + _LINE_PAGE


class ProductIssueOrdersError(RuntimeError):
    """A failure safe to present to the operator requesting the report."""


def _bound_shop(store: str) -> str:
    # The shared client permits operator defaults when a store-specific setting
    # is absent. A cross-app order join must have an explicit domain binding.
    cfg = shopify_client._get_store_config(store)
    domain = shopify_client._normalize_shop_domain(cfg['SHOP']).lower()
    if not current_workspace():
        bound, _ = store_env_value('SHOPIFY_SHOP_DOMAIN', store)
        if not bound and shopify_client._oauth_enabled_for_store(store):
            from app import db

            connection = db.get_app_setting(store, 'shopify_oauth') or {}
            bound = str(connection.get('shop') or '')
        if shopify_client._normalize_shop_domain(bound).lower() != domain:
            raise ProductIssueOrdersError('Connect the selected Shopify store before checking delivery issues.')
    if not re.fullmatch(r'[a-z0-9][a-z0-9-]*\.myshopify\.com', domain):
        raise ProductIssueOrdersError('The selected store needs a valid myshopify.com domain.')
    return domain


def _order_id(order: dict) -> str:
    match = re.fullmatch(r'gid://shopify/Order/([1-9][0-9]*)', order['id'])
    if not match:
        raise ProductIssueOrdersError('Shopify returned an invalid order reference. Please retry.')
    return match[1]


def _nodes(connection, next_page, *, advance_by_id=False):
    seen_cursors = set()
    while True:
        if not isinstance(connection, dict) or not isinstance(connection.get('nodes'), list):
            raise ProductIssueOrdersError('Shopify returned an incomplete order page. Please retry.')
        page = connection.get('pageInfo') or {}
        if not isinstance(page.get('hasNextPage'), bool):
            raise ProductIssueOrdersError('Shopify did not confirm the end of the order page. Please retry.')
        yield from connection['nodes']
        if not page['hasNextPage']:
            return
        if not connection['nodes']:
            raise ProductIssueOrdersError('Shopify returned an empty page with more orders pending. Please retry.')
        # Order ID keysets keep large stores below Shopify's 25,000-record
        # connection limit. Nested items use their order's own Shopify cursor.
        cursor = _order_id(connection['nodes'][-1]) if advance_by_id else page.get('endCursor')
        if not cursor or cursor in seen_cursors:
            raise ProductIssueOrdersError('Shopify could not continue order pagination. Please retry.')
        seen_cursors.add(cursor)
        connection = next_page(cursor)


def fetch_product_issue_orders(store: str, product_id: str, start: date, end: date) -> tuple[str, list[dict]]:
    label = canonical_store_label(store)
    if not label or not re.fullmatch(r'[1-9][0-9]*', product_id) or end < start:
        raise ValueError('Select a Shopify store, a numeric product ID and a valid date range.')
    try:
        return _read_orders(label, product_id, start, end)
    except ProductIssueOrdersError:
        raise
    except Exception as exc:
        # Shopify errors can include response data. Keep the chained exception
        # available to the server and expose only a safe operator-facing reason.
        raise ProductIssueOrdersError('Shopify could not read the orders. Check the store connection and retry.') from exc


def _read_orders(label: str, product_id: str, start: date, end: date) -> tuple[str, list[dict]]:
    domain = _bound_shop(label)
    local = ZoneInfo('Africa/Casablanca')
    lower = datetime.combine(start, time.min, local).astimezone(timezone.utc)
    upper = datetime.combine(end + timedelta(days=1), time.min, local).astimezone(timezone.utc)
    filters = f"created_at:>='{lower.isoformat()}' created_at:<'{upper.isoformat()}' test:false"
    needs_old_orders = lower < datetime.now(timezone.utc) - timedelta(days=60)

    def query(document, variables):
        data = _gql_store(label, document, variables)
        if not isinstance(data, dict) or (data.get('shop') or {}).get('myshopifyDomain', '').lower() != domain:
            raise ProductIssueOrdersError('Shopify did not confirm the identity of the selected store.')
        return data

    def order_page(after_id):
        check_access = needs_old_orders and after_id is None
        window = f'{filters} id:>{after_id}' if after_id else filters
        data = query(_ORDERS, {'filter': window, 'checkAccess': check_access})
        if check_access:
            scopes = (data.get('currentAppInstallation') or {}).get('accessScopes') or []
            if not any(scope.get('handle') == 'read_all_orders' for scope in scopes):
                raise ProductIssueOrdersError('This store needs read_all_orders access for the selected dates. Choose a period within the last 60 days or reconnect the store.')
        return data.get('orders')

    product_gid = f'gid://shopify/Product/{product_id}'
    matched = {}
    for order in _nodes(order_page(None), order_page, advance_by_id=True):
        if order['test']:
            continue
        gid = order['id']

        def line_page(after):
            data = query(_MORE_LINES, {'id': gid, 'after': after})
            return (data.get('order') or {}).get('lineItems')

        variants = []
        contains_product = False
        mixed = False
        for line in _nodes(order.get('lineItems'), line_page):
            if (line['product'] or {}).get('id') != product_gid:
                mixed = True
                continue
            contains_product = True
            variant = line.get('variantTitle')
            if variant and variant not in variants:
                variants.append(variant)
        if contains_product:
            order_id = _order_id(order)
            if not order['name']:
                raise ProductIssueOrdersError('Shopify returned an unnamed order. Please retry.')
            status = order['displayFulfillmentStatus']
            matched[order_id] = {
                'order_id': order_id, 'order_name': order['name'], 'created_at': order['createdAt'],
                'fulfilled': status == 'FULFILLED', 'partially_fulfilled': status == 'PARTIALLY_FULFILLED',
                'cancelled': bool(order['cancelledAt']), 'variants': variants, 'mixed_basket': mixed,
            }
    return domain, list(matched.values())
