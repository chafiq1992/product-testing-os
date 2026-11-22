from datetime import date

import pytest
import requests

from app.integrations import product_issue_orders as adapter
from app.tenant_context import workspace_scope


SHOP = 'example.myshopify.com'
PRODUCT = '10744794906913'
START = date(2024, 3, 9)
END = date(2024, 3, 10)


def page(nodes, cursor=None):
    return {'nodes': nodes, 'pageInfo': {'hasNextPage': cursor is not None, 'endCursor': cursor}}


def line(product=PRODUCT, variant='Silver / Pink / 38', *, item='1', quantity=1):
    return {'id': f'gid://shopify/LineItem/{item}', 'quantity': quantity,
            'product': {'id': f'gid://shopify/Product/{product}'} if product else None, 'variantTitle': variant}


def order(number, lines, status='UNFULFILLED', **kwargs):
    return {
        'id': f'gid://shopify/Order/{number}', 'name': f'#{number}', 'createdAt': '2024-03-09T12:00:00Z',
        'test': False, 'cancelledAt': None, 'displayFulfillmentStatus': status, 'lineItems': lines,
        'fulfillmentsCount': {'count': 0, 'precision': 'EXACT'}, **kwargs,
    }


def response(**values):
    return {'shop': {'myshopifyDomain': SHOP}, 'currentAppInstallation': {'accessScopes': [{'handle': 'read_all_orders'}]}, **values}


@pytest.fixture
def bound_shop(monkeypatch):
    monkeypatch.setattr(adapter, '_bound_shop', lambda _: SHOP)


def test_original_product_lines_calendar_days_and_pagination(monkeypatch, bound_shop):
    cancelled = order('11', page([line(), line(), line(variant='Beige / 39')]), 'FULFILLED', cancelledAt='2024-03-10T13:00:00Z')
    deep = order('12', page([line(None), line('111')], 'nested'), 'PARTIALLY_FULFILLED')
    calls = []

    def gql(store, document, variables):
        assert store == 'irranova'
        calls.append((document, variables))
        if 'ProductIssueOrderLines' in document:
            assert variables == {'id': deep['id'], 'after': 'nested'}
            return response(order={'lineItems': page([line(variant='Gray / 40')])})
        if 'id:>12' in variables['filter']:
            assert variables['checkAccess'] is False
            return response(orders=page([order('13', page([line()]), test=True), order('14', page([line('999')]))]))
        assert variables['checkAccess'] is True
        # Morocco changed its UTC offset during these two creation days.
        assert variables['filter'] == "created_at:>='2024-03-08T23:00:00+00:00' created_at:<'2024-03-11T00:00:00+00:00' test:false"
        assert 'sortKey: ID' in document
        assert 'currentQuantity' not in document  # Refunded and removed lines still identify the original product.
        return response(orders=page([cancelled, cancelled, deep], 'next-orders'))

    monkeypatch.setattr(adapter, '_gql_store', gql)
    domain, records = adapter.fetch_product_issue_orders('irranova', PRODUCT, START, END)
    assert domain == SHOP
    assert len(calls) == 3
    assert records == [
        {'order_id': '11', 'order_name': '#11', 'created_at': cancelled['createdAt'], 'fulfilled': True,
         'partially_fulfilled': False, 'cancelled': True, 'variants': ['Silver / Pink / 38', 'Beige / 39'], 'mixed_basket': False,
         'fulfilled_at': None, 'fulfilled_by': None, 'cancelled_at': cancelled['cancelledAt'], 'fulfillment_history_incomplete': True},
        {'order_id': '12', 'order_name': '#12', 'created_at': deep['createdAt'], 'fulfilled': False,
         'partially_fulfilled': True, 'cancelled': False, 'variants': ['Gray / 40'], 'mixed_basket': True,
         'fulfilled_at': None, 'fulfilled_by': None, 'cancelled_at': None, 'fulfillment_history_incomplete': False},
    ]


def test_repeating_line_page_fails_before_returning_a_partial_cohort(monkeypatch, bound_shop):
    deep = order('2', page([line()], 'same'))

    def repeat_nested_page(_, document, variables):
        if 'ProductIssueOrderLines' in document:
            return response(order={'lineItems': deep['lineItems']})
        return response(orders=page([order('1', page([line()])), deep]))

    monkeypatch.setattr(adapter, '_gql_store', repeat_nested_page)
    with pytest.raises(adapter.ProductIssueOrdersError, match='pagination'):
        adapter.fetch_product_issue_orders('irranova', PRODUCT, START, END)


def test_timeout_reports_an_actionable_error_without_source_data(monkeypatch, bound_shop):
    def timeout(*args):
        raise requests.Timeout('upstream private header and customer data')

    monkeypatch.setattr(adapter, '_gql_store', timeout)
    with pytest.raises(adapter.ProductIssueOrdersError, match='could not read') as error:
        adapter.fetch_product_issue_orders('irranova', PRODUCT, START, END)
    assert 'private' not in str(error.value)


@pytest.mark.parametrize(('payload', 'message'), [
    (response(orders={}), 'incomplete'),
    (response(orders=page([]), shop={'myshopifyDomain': 'different.myshopify.com'}), 'identity'),
    (response(orders=page([]), currentAppInstallation={'accessScopes': [{'handle': 'read_orders'}]}), 'read_all_orders'),
])
def test_missing_access_or_unverified_pages_do_not_look_empty(monkeypatch, bound_shop, payload, message):
    monkeypatch.setattr(adapter, '_gql_store', lambda *_: payload)
    with pytest.raises(adapter.ProductIssueOrdersError, match=message):
        adapter.fetch_product_issue_orders('irranova', PRODUCT, START, END)


def test_only_the_selected_shops_config_can_be_used(monkeypatch):
    monkeypatch.setenv('SHOPIFY_SHOP_DOMAIN_REVIEWSTORE', SHOP)
    monkeypatch.setattr(adapter.shopify_client, '_get_store_config', lambda _: {'SHOP': 'unrelated.myshopify.com'})
    monkeypatch.setattr(adapter, '_gql_store', lambda *_: pytest.fail('Unbound store queried'))
    with pytest.raises(adapter.ProductIssueOrdersError, match='Connect the selected'):
        adapter.fetch_product_issue_orders('reviewstore', PRODUCT, START, END)
    monkeypatch.delenv('SHOPIFY_SHOP_DOMAIN_REVIEWSTORE')
    monkeypatch.setattr(adapter.shopify_client, '_oauth_enabled_for_store', lambda _: False)
    with pytest.raises(adapter.ProductIssueOrdersError, match='Connect the selected'):
        adapter.fetch_product_issue_orders('reviewstore', PRODUCT, START, END)


def test_real_workspace_guard_rejects_other_store_without_querying(monkeypatch):
    monkeypatch.setattr(adapter, '_gql_store', lambda *_: pytest.fail('Cross-store query attempted'))
    with workspace_scope('m9'), pytest.raises(adapter.ProductIssueOrdersError):
        adapter.fetch_product_issue_orders('m10', PRODUCT, START, END)


def test_valid_empty_cohort_and_store_alias(monkeypatch):
    monkeypatch.setenv('SHOPIFY_SHOP_DOMAIN_IRRAKIDS', SHOP)
    monkeypatch.setattr(adapter.shopify_client, '_get_store_config', lambda _: {'SHOP': SHOP})

    def empty(store, _, variables):
        assert store == 'irrakids'
        return response(orders=page([]))

    monkeypatch.setattr(adapter, '_gql_store', empty)
    assert adapter.fetch_product_issue_orders('NOURALIBAS', PRODUCT, START, END) == (SHOP, [])


def shipment_line(item, units):
    return {'id': f'gid://shopify/FulfillmentLineItem/{item}', 'lineItem': {'id': f'gid://shopify/LineItem/{item}'},
            'quantity': units}


def shipment(number, quantities, status='SUCCESS'):
    return {'id': f'gid://shopify/Fulfillment/{number}', 'status': status,
            'fulfillmentLineItems': page([shipment_line(item, n) for item, n in quantities.items()])}


def event(number, units, when, action='fulfillment_success'):
    return {'action': action, 'arguments': [int(number), units, 'api_client_id', 123],
            'createdAt': when}


FIRST = '2024-03-10T09:00:00Z'
SECOND = '2024-03-10T10:00:00Z'
CANCELLED = '2024-03-10T11:00:00Z'


def test_full_order_then_cancelled_uses_the_success_that_covered_the_last_units(monkeypatch, bound_shop):
    basket = page([line(quantity=2), line(product='999', item='2')])
    orders = [
        order('1', basket, 'FULFILLMENT_NOT_REQUIRED', cancelledAt=CANCELLED),
        order('2', basket, 'FULFILLMENT_NOT_REQUIRED', cancelledAt=CANCELLED),
        order('3', basket, 'FULFILLMENT_NOT_REQUIRED', cancelledAt='2024-03-10T12:00:00+01:00'),
        order('4', basket, 'FULFILLED', cancelledAt=FIRST),
        order('5', page([line(product='999')]), 'FULFILLED'),
    ]
    records = {
        '2': ([shipment('21', {'1': 2})], [event('21', 2, FIRST)]),
        '3': ([shipment('31', {'1': 1}), shipment('32', {'2': 1, '1': 1}, 'CANCELLED')],
              [event('32', 2, SECOND), event('31', 1, FIRST), event('32', 2, CANCELLED, 'fulfillment_cancelled')]),
        '4': ([shipment('41', {'1': 2, '2': 1})], [event('41', 3, SECOND)]),
    }
    for number, (ships, _) in records.items():
        orders[int(number) - 1]['fulfillmentsCount']['count'] = len(ships)
    orders[-1]['fulfillmentsCount']['count'] = 1
    calls = []

    def gql(_, document, variables):
        calls.append(document)
        if document == adapter._ORDERS:
            return response(orders=page(orders))
        assert document == adapter._HISTORY
        assert variables['ids'] == [o['id'] for o in orders[1:4]]
        assert variables['filter'] == 'action:fulfillment_success OR action:fulfillment_cancelled'
        return response(nodes=[{**orders[int(num) - 1], 'edited': False, 'fulfillments': ships, 'events': page(events)}
                               for num, (ships, events) in records.items()])

    monkeypatch.setattr(adapter, '_gql_store', gql)
    _, rows = adapter.fetch_product_issue_orders('irranova', PRODUCT, START, END)
    assert len(calls) == 2
    assert [(r['fulfilled'], r['fulfilled_at'], r['cancelled_at'], r['fulfillment_history_incomplete']) for r in rows] == [
        (False, None, CANCELLED, False),  # A cancellation without any shipment.
        (False, None, CANCELLED, False),  # Only the selected product shipped, and the other item never did.
        (True, SECOND, CANCELLED, False),  # Both units and both products were fulfilled, before cancellation.
        (True, SECOND, FIRST, False),  # The report can explicitly exclude the reversed sequence.
    ]
    assert [r['fulfilled_by'] for r in rows] == [None, None, SECOND, SECOND]


def test_expired_events_edits_and_voided_shipments_preserve_uncertainty():
    ordered = {line()['id']: 1, line(item='2')['id']: 1}
    one = shipment('1', {'1': 1}, 'CANCELLED')
    two = shipment('2', {'2': 1})
    first = event('1', 1, FIRST)
    second = event('2', 1, SECOND)

    def history(ships, events, status, *, edited=False, count=None):
        info = {'id': 'gid://shopify/Order/1', 'edited': edited, 'displayFulfillmentStatus': status,
                'fulfillments': ships, 'events': page(events),
                'fulfillmentsCount': {'count': len(ships) if count is None else count, 'precision': 'EXACT'}}
        return adapter._fulfillment_history(info, ordered, lambda *_: pytest.fail('Unexpected pagination'))

    assert history([one, two], [first, event('1', 1, '2024-03-10T09:30:00Z', 'fulfillment_cancelled'), second],
                   'PARTIALLY_FULFILLED') == (False, None, False, None)
    assert history([one, two], [first, second], 'FULFILLMENT_NOT_REQUIRED') == (False, None, True, None)
    assert history([shipment('3', {'1': 1, '2': 1})], [], 'FULFILLED') == (True, None, True, None)
    assert history([shipment('3', {'1': 1, '2': 1}, 'CANCELLED')], [], 'FULFILLMENT_NOT_REQUIRED') == (False, None, True, None)
    assert history([two], [second], 'FULFILLED', edited=True) == (True, None, True, None)
    assert history([two], [second], 'FULFILLMENT_NOT_REQUIRED', edited=True) == (False, None, True, None)
    assert history([two], [second], 'PARTIALLY_FULFILLED', count=2) == (False, None, True, None)
    both = shipment('3', {'1': 1, '2': 1})
    assert history([both], [event('3', 1, FIRST)], 'FULFILLED') == (True, None, True, None)  # Event quantities disagree.
    replacement = shipment('3', {'1': 1})
    assert history([one, two, replacement], [first, second, event('3', 1, CANCELLED)],
                   'FULFILLED') == (True, None, True, CANCELLED)  # Separate coverage proves this upper bound.
    missing_units = shipment('4', {'1': None})
    assert history([missing_units], [], 'FULFILLMENT_NOT_REQUIRED') == (False, None, True, None)


def test_shipment_line_and_timeline_pagination_keeps_ids_and_quantities(monkeypatch, bound_shop):
    target = order('22', page([line(), line(item='2')]), 'FULFILLED', fulfillmentsCount={'count': 1, 'precision': 'EXACT'})
    shipping = shipment('12', {'1': 1})
    shipping['fulfillmentLineItems'] = page([shipment_line('1', 1)], 'next-lines')
    seen = []

    def gql(_, document, variables):
        seen.append(document)
        if document == adapter._ORDERS:
            return response(orders=page([target]))
        if document == adapter._HISTORY:
            return response(nodes=[{**target, 'edited': False, 'fulfillments': [shipping],
                                   'events': page([event('12', 2, CANCELLED, 'fulfillment_cancelled')], 'next-events')}])
        if document == adapter._MORE_SHIPMENT_LINES:
            assert variables == {'id': shipping['id'], 'after': 'next-lines'}
            return response(fulfillment={'fulfillmentLineItems': page([shipment_line('1', 1), shipment_line('2', 1)])})
        assert document == adapter._MORE_EVENTS
        assert variables == {'id': target['id'], 'after': 'next-events', 'filter': adapter._EVENT_FILTER}
        return response(order={'events': page([event('12', 2, FIRST), event('12', 2, FIRST)])})

    monkeypatch.setattr(adapter, '_gql_store', gql)
    _, rows = adapter.fetch_product_issue_orders('irranova', PRODUCT, START, END)
    assert rows[0]['fulfilled_at'] == FIRST
    assert len(seen) == 4


def sale(num, item, quantity):
    return {'id': f'sale-{num}', '__typename': 'ProductSale', 'actionType': 'ORDER' if quantity > 0 else 'RETURN',
            'quantity': quantity, 'lineItem': {'id': line(item=item)['id']}}


def agreement(num, reason, when, sales):
    return {'id': f'gid://shopify/SalesAgreement/{num}', 'reason': reason, 'happenedAt': when, 'sales': page(sales)}


@pytest.mark.parametrize(('initial', 'edit_sales', 'edit_at', 'sent', 'expected'), [
    ([(1, 1)], [(1, -1), (2, 1)], FIRST, {2: 1}, SECOND),  # Pre-shipment replacement, like real order #107210.
    ([(1, 1), (2, 1)], [(2, -1)], CANCELLED, {1: 1}, None),  # Removing outstanding units after a partial.
    ([(1, 1), (2, 1)], [(2, -1)], SECOND, {1: 1}, None),  # Same timestamp cannot establish sequence.
    ([(1, 1), (2, 1)], [], CANCELLED, {1: 1, 2: 1}, SECOND),  # Postfulfillment return changes the edited flag.
])
def test_edited_orders_use_the_basket_at_shipment_with_paged_sales(
        monkeypatch, bound_shop, initial, edit_sales, edit_at, sent, expected):
    target = order('17', page([line(item='1'), line(item='2')]), 'FULFILLED',
                   fulfillmentsCount={'count': 1, 'precision': 'EXACT'})
    placed = agreement('1', 'ORDER', '2024-03-09T12:00:00Z', [sale(i, item, n) for i, (item, n) in enumerate(initial)])
    edit = agreement('2', 'ORDER_EDIT' if edit_sales else 'RETURN', edit_at,
                     [sale(i + 10, item, n) for i, (item, n) in enumerate(edit_sales)])
    duplicate_safe_page = page([*edit['sales']['nodes']], 'sales-next') if edit_sales else edit['sales']
    edited_order = {'id': target['id'], 'agreements': page([placed], 'agreements-next')}

    def gql(_, document, variables):
        if document == adapter._ORDERS:
            return response(orders=page([target]))
        if document == adapter._HISTORY:
            return response(nodes=[{**target, 'edited': True, 'fulfillments': [shipment('44', sent)],
                                   'events': page([event('44', sum(sent.values()), SECOND)])}])
        if document == adapter._AGREEMENTS:
            assert variables == {'ids': [target['id']]}
            return response(nodes=[edited_order])
        if document == adapter._MORE_AGREEMENTS:
            assert variables == {'id': target['id'], 'after': 'agreements-next'}
            return response(order={'agreements': page([{**edit, 'sales': duplicate_safe_page}])})
        assert document == adapter._MORE_SALES
        assert variables == {'id': target['id'], 'filter': 'id:2', 'after': 'sales-next'}
        return response(order={'agreements': {'nodes': [edit]}})

    monkeypatch.setattr(adapter, '_gql_store', gql)
    _, rows = adapter.fetch_product_issue_orders('irranova', PRODUCT, START, END)
    assert (rows[0]['fulfilled'], rows[0]['fulfilled_at'], rows[0]['fulfillment_history_incomplete']) == (
        True, expected, expected is None)
    assert rows[0]['fulfilled_by'] == expected
