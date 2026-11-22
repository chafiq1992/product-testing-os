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


def line(product=PRODUCT, variant='Silver / Pink / 38'):
    return {'product': {'id': f'gid://shopify/Product/{product}'} if product else None, 'variantTitle': variant}


def order(number, lines, status='UNFULFILLED', **kwargs):
    return {
        'id': f'gid://shopify/Order/{number}', 'name': f'#{number}', 'createdAt': '2024-03-09T12:00:00Z',
        'test': False, 'cancelledAt': None, 'displayFulfillmentStatus': status, 'lineItems': lines, **kwargs,
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
         'partially_fulfilled': False, 'cancelled': True, 'variants': ['Silver / Pink / 38', 'Beige / 39'], 'mixed_basket': False},
        {'order_id': '12', 'order_name': '#12', 'created_at': deep['createdAt'], 'fulfilled': False,
         'partially_fulfilled': True, 'cancelled': False, 'variants': ['Gray / 40'], 'mixed_basket': True},
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
