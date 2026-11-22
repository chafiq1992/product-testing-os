"""Shopify orders containing one product, for an on-demand delivery report."""

from collections import Counter
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone
import re
from zoneinfo import ZoneInfo

from app.integrations import shopify_client
from app.shopify_store_registry import canonical_store_label, store_env_value
from app.social_agent.shopify_transport import _gql_store
from app.tenant_context import current_workspace


_LINE_PAGE = """
fragment IssueLines on LineItemConnection {
  nodes { id quantity product { id } variantTitle }
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
      fulfillmentsCount { count precision }
      lineItems(first: 8) { ...IssueLines }
    }
    pageInfo { hasNextPage endCursor }
  }
}
""" + _LINE_PAGE

_SHIPMENT_LINES = """
fragment ShipmentLines on FulfillmentLineItemConnection {
  nodes { id quantity lineItem { id } }
  pageInfo { hasNextPage endCursor }
}
"""

_FULFILLMENT_EVENTS = """
fragment FulfillmentEvents on EventConnection {
  nodes { ... on BasicEvent { action createdAt arguments } }
  pageInfo { hasNextPage endCursor }
}
"""

_EVENT_FILTER = 'action:fulfillment_success OR action:fulfillment_cancelled'
_HISTORY = """
query ProductIssueFulfillments($ids: [ID!]!, $filter: String!) {
  shop { myshopifyDomain }
  nodes(ids: $ids) {
    ... on Order {
      id edited cancelledAt displayFulfillmentStatus fulfillmentsCount { count precision }
      fulfillments { id status fulfillmentLineItems(first: 8) { ...ShipmentLines } }
      events(first: 8, query: $filter) { ...FulfillmentEvents }
    }
  }
}
""" + _SHIPMENT_LINES + _FULFILLMENT_EVENTS

_MORE_SHIPMENT_LINES = """
query ProductIssueShipmentLines($id: ID!, $after: String!) {
  shop { myshopifyDomain }
  fulfillment(id: $id) { fulfillmentLineItems(first: 100, after: $after) { ...ShipmentLines } }
}
""" + _SHIPMENT_LINES

_MORE_EVENTS = """
query ProductIssueFulfillmentEvents($id: ID!, $after: String!, $filter: String!) {
  shop { myshopifyDomain }
  order(id: $id) { events(first: 100, after: $after, query: $filter) { ...FulfillmentEvents } }
}
""" + _FULFILLMENT_EVENTS

_SALE_UNITS = """
fragment SaleUnits on SaleConnection {
  nodes {
    id __typename actionType quantity
    ... on ProductSale { lineItem { id } }
    ... on GiftCardSale { lineItem { id } }
  }
  pageInfo { hasNextPage endCursor }
}
"""

_AGREEMENTS_PAGE = """
fragment IssueAgreements on SalesAgreementConnection {
  nodes {
    id reason happenedAt
    ... on OrderAgreement { sales(first: 8) { ...SaleUnits } }
    ... on OrderEditAgreement { sales(first: 8) { ...SaleUnits } }
  }
  pageInfo { hasNextPage endCursor }
}
""" + _SALE_UNITS

_AGREEMENTS = """
query ProductIssueEditedOrders($ids: [ID!]!) {
  shop { myshopifyDomain }
  nodes(ids: $ids) { ... on Order { id agreements(first: 5) { ...IssueAgreements } } }
}
""" + _AGREEMENTS_PAGE

_MORE_AGREEMENTS = """
query ProductIssueOrderAgreements($id: ID!, $after: String!) {
  shop { myshopifyDomain }
  order(id: $id) { agreements(first: 30, after: $after) { ...IssueAgreements } }
}
""" + _AGREEMENTS_PAGE

_MORE_SALES = """
query ProductIssueAgreementSales($id: ID!, $filter: String!, $after: String!) {
  shop { myshopifyDomain }
  order(id: $id) {
    agreements(first: 1, query: $filter) { nodes { id sales(first: 100, after: $after) { ...SaleUnits } } }
  }
}
""" + _SALE_UNITS

_MORE_LINES = """
query ProductIssueOrderLines($id: ID!, $after: String!) {
  shop { myshopifyDomain }
  order(id: $id) { lineItems(first: 100, after: $after) { ...IssueLines } }
}
""" + _LINE_PAGE


class ProductIssueOrdersError(RuntimeError):
    """A failure safe to present to the operator requesting the report."""


def _utc(value) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        stamp = datetime.fromisoformat(value)
    except ValueError:
        return None
    return stamp.astimezone(timezone.utc) if stamp.tzinfo else None


def _iso(stamp: datetime | None) -> str | None:
    return stamp.isoformat().replace('+00:00', 'Z') if stamp else None


def _exact_count(order: dict) -> int | None:
    count = order.get('fulfillmentsCount') or {}
    return count.get('count') if count.get('precision') == 'EXACT' else None


@dataclass
class _Shipment:
    status: str
    units: Counter = field(default_factory=Counter)
    success: datetime | None = None
    revoked: datetime | None = None


def _covers(units, ordered) -> bool:
    return bool(ordered) and all(units[item] >= count for item, count in ordered.items())


def _basket_changes(order, ordered, query):
    """Return reconciled, dated purchases and edits. Refunds do not ship goods."""
    def more_agreements(after):
        data = query(_MORE_AGREEMENTS, {'id': order['id'], 'after': after})
        return (data.get('order') or {}).get('agreements')

    changes = {}
    purchased = Counter()
    placements = set()
    sales_seen = set()
    for agreement in _nodes(order['agreements'], more_agreements):
        reason = agreement['reason']
        if reason in {'REFUND', 'RETURN'}:
            continue
        stamp = _utc(agreement.get('happenedAt'))
        if reason not in {'ORDER', 'ORDER_EDIT'} or not stamp:
            return None
        if reason == 'ORDER':
            placements.add(agreement['id'])

        def more_sales(after):
            number = agreement['id'].rsplit('/', 1)[-1]
            data = query(_MORE_SALES, {'id': order['id'], 'filter': f'id:{number}', 'after': after})
            same = ((data.get('order') or {}).get('agreements') or {}).get('nodes') or []
            return same[0]['sales'] if len(same) == 1 and same[0]['id'] == agreement['id'] else None

        for sale in _nodes(agreement.get('sales'), more_sales):
            if sale['id'] in sales_seen:
                continue
            sales_seen.add(sale['id'])
            if sale['__typename'] == 'UnknownSale':
                return None
            if sale['__typename'] not in {'ProductSale', 'GiftCardSale'} or sale['actionType'] == 'UPDATE':
                continue
            item = (sale.get('lineItem') or {}).get('id')
            qty = sale.get('quantity')
            if not item or not isinstance(qty, int):
                return None
            if sale['actionType'] == 'ORDER' and qty > 0:
                purchased[item] += qty
            elif sale['actionType'] != 'RETURN' or qty >= 0:
                return None
            changes.setdefault(stamp, Counter())[item] += qty
    if len(placements) != 1 or purchased != Counter(ordered):
        return None
    balance = Counter()
    for stamp, delta in sorted(changes.items()):
        balance.update(delta)
        if any(qty < 0 for qty in balance.values()):
            return None
    return changes


def _first_full(ordered, shipments, changes=None):
    # A revoked shipment contributes only up to the recorded revocation. If its
    # revocation time is missing, its own success event proves it at that instant.
    successes = {s.success for s in shipments if s.success}
    required = Counter() if changes is not None else Counter(ordered)
    changes = changes or {}
    edit_could_complete = False
    for stamp in sorted(successes | changes.keys()):
        if stamp in changes:
            required.update(changes[stamp])
        active = Counter()
        instantaneous = []
        for shipment in shipments:
            if not shipment.success or shipment.success > stamp or (shipment.revoked and shipment.revoked <= stamp):
                continue
            if shipment.status == 'SUCCESS' or shipment.revoked:
                active.update(shipment.units)
            elif shipment.success == stamp:
                instantaneous.append(shipment.units)
        needed = +required  # Counter omits items removed by a preceding edit.
        if _covers(active, needed) or any(_covers(active + units, needed) for units in instantaneous):
            if stamp in changes:
                # A reduction after a partial shipment can make the display
                # FULL without another success. The edit is not a shipping time.
                edit_could_complete = True
            elif stamp in successes:
                return stamp, edit_could_complete
    return None, edit_could_complete


def _fulfillment_history(order, ordered, query, changes=None):
    shipments = {}
    incomplete = False
    # Order.fulfillments is an array, not a connection. Omit "first" to
    # request every record, including voided shipments, and check the count.
    for raw in order['fulfillments']:
        gid = raw['id']
        shipment = _Shipment(raw['status'])
        shipments[gid] = shipment

        def more_lines(after):
            data = query(_MORE_SHIPMENT_LINES, {'id': gid, 'after': after})
            return (data.get('fulfillment') or {}).get('fulfillmentLineItems')

        seen_lines = set()
        for line in _nodes(raw.get('fulfillmentLineItems'), more_lines):
            if line['id'] in seen_lines:
                continue
            seen_lines.add(line['id'])
            item = (line.get('lineItem') or {}).get('id')
            if item and isinstance(line.get('quantity'), int) and line['quantity'] >= 0:
                shipment.units[item] += line['quantity']
            else:
                incomplete = True

    def more_events(after):
        data = query(_MORE_EVENTS, {'id': order['id'], 'after': after, 'filter': _EVENT_FILTER})
        return (data.get('order') or {}).get('events')

    incomplete |= _exact_count(order) != len(shipments)
    for event in _nodes(order.get('events'), more_events):
        # Shopify's documented fulfillment_success arguments and the store's
        # timeline identify the fulfillment by numeric ID in the first slot.
        args = event.get('arguments')
        number = str(args[0]) if isinstance(args, list) and args else ''
        shipment = shipments.get(f'gid://shopify/Fulfillment/{number}')
        when = _utc(event.get('createdAt'))
        if not shipment or not when:
            incomplete = True
            continue
        if event.get('action') == 'fulfillment_success':
            if len(args) < 2 or str(args[1]) != str(shipment.units.total()):
                incomplete = True
                continue
            shipment.success = min(shipment.success, when) if shipment.success else when
        elif event.get('action') == 'fulfillment_cancelled':
            shipment.revoked = min(shipment.revoked, when) if shipment.revoked else when

    records = list(shipments.values())
    full_at, edit_could_complete = _first_full(ordered, records, changes)
    damaged_history = incomplete or any(s.success and s.revoked and s.revoked <= s.success for s in records)
    incomplete = damaged_history
    undated_revocations = [s.success for s in records if s.success and s.status != 'SUCCESS' and not s.revoked]
    successful_units = Counter()
    possible_units = Counter()
    for shipment in records:
        if shipment.status == 'SUCCESS':
            successful_units.update(shipment.units)
        if shipment.success or shipment.status in {'SUCCESS', 'CANCELLED'}:
            possible_units.update(shipment.units)
            if not shipment.success:
                incomplete = True  # Includes expired or unavailable Shopify events.
    full = bool(full_at) or _covers(successful_units, ordered) or order['displayFulfillmentStatus'] == 'FULFILLED'
    # An earlier overlap with a voided partial can make a later confirmed full
    # shipment only an upper bound on the first time the order was complete.
    possible_earlier_overlap = full_at is not None and any(t < full_at for t in undated_revocations)
    basket_verified = not order['edited'] or changes is not None
    if edit_could_complete or possible_earlier_overlap or not basket_verified:
        incomplete = True
    if full:
        # Even if an earlier full moment is unresolved, a verified, complete
        # basket at a success event proves the order was full by that time.
        fulfilled_by = _iso(full_at) if basket_verified and not damaged_history else None
        return True, _iso(full_at) if not incomplete else None, incomplete or full_at is None, fulfilled_by
    # A historical partial that was voided can overlap another shipment only
    # if we also know when it was voided. A current zero quantity after a
    # refund or cancellation cannot establish the quantity at fulfillment.
    possible = _covers(possible_units, ordered) or (order['edited'] and bool(possible_units))
    unknown = damaged_history or (possible and (incomplete or undated_revocations))
    return False, None, bool(unknown), None


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
    history_needed = {}
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
        ordered = {}
        for line in _nodes(order.get('lineItems'), line_page):
            if line['quantity'] > 0:
                ordered[line['id']] = line['quantity']
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
                'fulfilled_at': None, 'fulfilled_by': None, 'cancelled_at': _iso(_utc(order['cancelledAt'])),
                'fulfillment_history_incomplete': status == 'FULFILLED',
            }
            if _exact_count(order) != 0:
                history_needed[gid] = ordered

    # Expanding histories only for matching orders with shipments keeps the
    # store-wide creation-date scan cheap. Most shipments fit the nested page.
    gids = list(history_needed)
    for start_index in range(0, len(gids), 20):
        batch = gids[start_index:start_index + 20]
        data = query(_HISTORY, {'ids': batch, 'filter': _EVENT_FILTER})
        details = {order['id']: order for order in data['nodes'] if order}
        edited = [gid for gid in batch if details.get(gid, {}).get('edited')]
        changes = {}
        if edited:
            agreements = query(_AGREEMENTS, {'ids': edited})
            changes = {o['id']: _basket_changes(o, history_needed[o['id']], query)
                       for o in agreements['nodes'] if o and o['id'] in edited}
        for gid in batch:
            row = matched[gid.rsplit('/', 1)[-1]]
            if gid not in details:
                row['fulfillment_history_incomplete'] = True
                continue
            order = details[gid]
            full, full_at, incomplete, full_by = _fulfillment_history(order, history_needed[gid], query, changes.get(gid))
            row.update(fulfilled=full, fulfilled_at=full_at, fulfilled_by=full_by, fulfillment_history_incomplete=incomplete,
                       partially_fulfilled=not full and order['displayFulfillmentStatus'] == 'PARTIALLY_FULFILLED',
                       cancelled=bool(order['cancelledAt']), cancelled_at=_iso(_utc(order['cancelledAt'])))
    return domain, list(matched.values())
