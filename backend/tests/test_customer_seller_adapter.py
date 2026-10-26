"""Real portal/affiliate adapter integration with mocked Shopify transport only."""
import copy
from uuid import NAMESPACE_URL, uuid4, uuid5

import pytest
from fastapi import HTTPException

from app import affiliates, customer_merchants as adapter, db
from test_affiliates import market
from test_customer_affiliate_delivery import delivery_market


@pytest.fixture
def seller_portal(delivery_market, market):
    setup = delivery_market
    product = market[3]
    product['images'] = [{'id': 123, 'src': 'https://cdn.shopify.com/real-product.jpg'}]
    product['variants'][0]['image_id'] = 123
    merchant = adapter.resolve_merchant('seller', setup.seller['id'])
    customer = {'id': str(uuid4()), 'name': 'Customer One', 'phone': '+212611111111'}
    payload = {'request_id': str(uuid4()), 'line_items': [
        {'product_id': 'alpha:10', 'variant_id': 'alpha:20', 'quantity': 2}],
        'customer_name': 'Customer One', 'address': {'address1': 'Street 1', 'city': 'Casablanca', 'country': 'MA'},
        'note': 'Customer portal integration test', 'expected_total': '433.00'}
    return setup, merchant, customer, payload


def all_keys(value):
    if isinstance(value, dict):
        return set(value).union(*(all_keys(child) for child in value.values()))
    if isinstance(value, list):
        return set().union(*(all_keys(child) for child in value))
    return set()


def test_public_seller_catalog_preserves_photo_and_opaque_ids_without_private_terms(seller_portal):
    _, merchant, _, _ = seller_portal
    result = adapter.catalog(merchant)
    assert len(result['products']) == 1
    product = result['products'][0]
    assert product['id'] == 'alpha:10' and product['variants'][0]['id'] == 'alpha:20'
    assert product['variants'][0]['price'] == '200.00'
    assert product['image'] == 'https://cdn.shopify.com/real-product.jpg'
    assert product['images'] == [{'src': 'https://cdn.shopify.com/real-product.jpg'}]
    assert result['delivery_fee'] == '33.00' and result['delivery_fees']['MAD'] == '33.00'
    assert not {'access', 'seller', 'password_hash', 'unit_cost', 'cost', 'cost_price', 'profit',
        'discount_percent', 'pricing', 'vendor'} & all_keys(result)


def test_real_adapter_shipping_receipt_and_uuid_replay_write_one_order(seller_portal):
    setup, merchant, customer, payload = seller_portal
    first = adapter.place_order(merchant, payload, customer)['data']
    replay = adapter.place_order(merchant, copy.deepcopy(payload), customer)['data']
    assert first['id'] == replay['id'] and len(setup.writes) == 1
    assert first['total_price'] == '433.00' and first['delivery_fee'] == '33.00'
    assert first['line_items'][0]['image'] == 'https://cdn.shopify.com/real-product.jpg'
    assert first['line_items'][0]['product_id'] == 'alpha:10'
    assert first['line_items'][0]['variant_id'] == 'alpha:20'
    assert not {'cost', 'unit_cost', 'profit', 'access'} & all_keys(first)
    sent = setup.writes[0][1]['order']
    assert sent['line_items'] == [{'variant_id': 20, 'quantity': 2, 'price': '200'}]
    assert sent['shipping_lines'] == [{'code': 'customer_portal_delivery', 'title': 'Delivery', 'price': '33.00'}]
    with db.SessionLocal() as session:
        rows = session.query(affiliates.SellerOrder).all()
        assert len(rows) == 1
        assert rows[0].request_id == 'portal-' + str(uuid5(NAMESPACE_URL, customer['id'] + ':' + payload['request_id']))


def test_stale_expected_total_is_rejected_before_any_order_dispatch(seller_portal):
    setup, merchant, customer, payload = seller_portal
    payload['expected_total'] = '432.00'
    with pytest.raises(HTTPException) as error:
        adapter.place_order(merchant, payload, customer)
    assert error.value.status_code == 422
    assert error.value.detail['error'] == 'price_changed'
    assert setup.writes == []
    with db.SessionLocal() as session:
        assert session.query(affiliates.SellerOrder).count() == 0


@pytest.mark.parametrize('product_id,variant_id,expected_status', [
    ('beta:10', 'beta:20', 404), ('alpha:10', 'beta:20', 404), ('beta:10', 'alpha:20', 422),
])
def test_cross_store_product_and_variant_ids_cannot_dispatch(seller_portal, product_id, variant_id, expected_status):
    setup, merchant, customer, payload = seller_portal
    payload['line_items'] = [{'product_id': product_id, 'variant_id': variant_id, 'quantity': 2}]
    with pytest.raises(HTTPException) as error:
        adapter.place_order(merchant, payload, customer)
    assert error.value.status_code == expected_status
    assert setup.writes == []


def test_mixed_authorized_stores_require_separate_orders(seller_portal):
    setup, merchant, customer, payload = seller_portal
    merchant['seller']['access']['beta'] = ['Vendor A']
    payload['line_items'].append({'product_id': 'beta:10', 'variant_id': 'beta:20', 'quantity': 1})
    with pytest.raises(HTTPException) as error:
        adapter.place_order(merchant, payload, customer)
    assert error.value.status_code == 422
    assert setup.writes == []


@pytest.mark.parametrize('field,value', [('customer_name', 'X' * 121), ('address', {'address1': 'X' * 251, 'city': 'Casablanca'})])
def test_nested_affiliate_validation_is_safe_before_dispatch(seller_portal, field, value):
    setup, merchant, customer, payload = seller_portal
    payload[field] = value
    with pytest.raises(HTTPException) as error:
        adapter.place_order(merchant, payload, customer)
    assert error.value.status_code == 422
    assert setup.writes == []
