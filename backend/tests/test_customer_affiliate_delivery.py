"""Customer delivery is charged separately without changing legacy seller terms."""
import hashlib
import json
from datetime import datetime
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app import affiliates as a, db
from test_affiliates import ADMIN, account, market, new_order


@pytest.fixture
def delivery_market(market, monkeypatch):
    client, remote, writes, product = market
    seller_id, headers = account(client)
    assert client.put('/api/affiliates/admin/pricing', headers=ADMIN,
        json={'discount_percent': 50, 'delivery_fees': {'MAD': 33}}).status_code == 200
    original = a.shopify._rest_post_store

    def post(store, path, payload):
        result = original(store, path, payload)
        if path == '/orders.json':
            snapshot = result['order']
            shipping = sum(a.cents(line['price']) for line in snapshot.get('shipping_lines', []))
            snapshot['total_price'] = str((a.cents(snapshot['subtotal_price']) + shipping) / 100)
        return result

    monkeypatch.setattr(a.shopify, '_rest_post_store', post)
    with db.SessionLocal() as session:
        seller = a._public_seller(session.get(a.Seller, seller_id))
    return SimpleNamespace(client=client, remote=remote, writes=writes, seller=seller, headers=headers)


def portal_order(**changes):
    request = a.NewOrder(**new_order(**changes))
    request._customer_portal = True
    return request


def test_portal_shipping_charge_receipt_and_product_margin(delivery_market):
    setup = delivery_market
    result = a.create_order(portal_order(), setup.seller)['data']
    payload = setup.writes[0][1]['order']
    assert payload['shipping_lines'] == [{'code': 'customer_portal_delivery', 'title': 'Delivery', 'price': '33.00'}]
    assert payload['line_items'][0]['price'] == '120'
    assert payload['inventory_behaviour'] == 'decrement_obeying_policy'
    assert result['total'] == 273 and result['pending_profit'] == 40
    details = setup.client.get('/api/affiliates/order-details', headers=setup.headers,
        params={'order_id': result['id']}).json()['data']
    assert details['receipt']['delivery_included'] is False
    assert details['receipt']['delivery_fee'] == 33
    assert details['receipt']['total'] == 273
    assert sum(item['total'] for item in details['receipt']['items']) == 240


def test_legacy_payload_fingerprint_receipt_and_profit_unchanged(delivery_market):
    setup = delivery_market
    request = a.NewOrder(**new_order())
    expected = hashlib.sha256(json.dumps(request.model_dump(mode='json'), sort_keys=True).encode()).hexdigest()
    result = a.create_order(request, setup.seller)['data']
    assert 'shipping_lines' not in setup.writes[0][1]['order']
    assert result['total'] == 240 and result['pending_profit'] == 7
    with db.SessionLocal() as session:
        assert session.get(a.SellerOrder, result['id']).fingerprint == expected
        receipt = json.loads(session.get(a.OrderReceipt, result['id']).data)
    assert receipt['delivery_included'] is True and receipt['total'] == 240


@pytest.mark.parametrize('field', ['_customer_portal', 'customer_portal'])
def test_client_json_cannot_enable_portal_delivery(delivery_market, field):
    setup = delivery_market
    request = a.NewOrder(**new_order(**{field: True}))
    assert request._customer_portal is False
    assert '_customer_portal' not in request.model_dump()
    assert '_customer_portal' not in a.NewOrder.model_json_schema()['properties']
    result = setup.client.post('/api/affiliates/orders', headers=setup.headers,
        json=new_order(**{field: True}))
    assert result.status_code == 200
    assert 'shipping_lines' not in setup.writes[0][1]['order']
    assert result.json()['data']['total'] == 240


@pytest.mark.parametrize('first_portal', [True, False])
def test_idempotency_id_cannot_cross_delivery_modes(delivery_market, first_portal):
    setup = delivery_market
    first = a.NewOrder(**new_order())
    first._customer_portal = first_portal
    created = a.create_order(first, setup.seller)['data']
    assert a.create_order(first, setup.seller)['data']['id'] == created['id']
    second = a.NewOrder(**new_order())
    second._customer_portal = not first_portal
    with pytest.raises(HTTPException) as error:
        a.create_order(second, setup.seller)
    assert error.value.status_code == 409
    assert len(setup.writes) == 1


def test_portal_margin_does_not_require_hiding_delivery_in_product_price(delivery_market):
    setup = delivery_market
    items = [{'product_id': '10', 'variant_id': '20', 'quantity': 1, 'sale_price': '101'}]
    result = a.create_order(portal_order(items=items), setup.seller)['data']
    assert result['total'] == 134 and result['pending_profit'] == 1
    with pytest.raises(HTTPException) as error:
        a.create_order(a.NewOrder(**new_order(request_id='legacy-margin-test', items=items)), setup.seller)
    assert error.value.status_code == 422


def view(*, shipping=None, total='273', refunds=None, delivery=None, financial='paid'):
    snapshot = {'subtotal_price': '240', 'total_price': total, 'financial_status': financial,
        'shipping_lines': shipping if shipping is not None else [{'code': 'customer_portal_delivery', 'price': '33'}],
        'refunds': refunds or [], 'fulfillments': [{'shipment_status': 'delivered'}]}
    row = SimpleNamespace(id='order', seller_id='seller', store='alpha', shopify_id='1', snapshot=json.dumps(snapshot),
        delivery=json.dumps(delivery or {}), cost_cents=20000, state='created', currency='MAD',
        synced_at=None, created_at=datetime.utcnow())
    return a.order_view(row, 3300, lookup_cancellation=False)


@pytest.mark.parametrize('shipping,total,expected', [
    ([{'code': 'customer_portal_delivery', 'price': '100'}], '340', 40),
    ([{'code': 'customer_portal_delivery', 'price': '33', 'discounted_price': '5'}], '245', 12),
    ([{'code': 'customer_portal_delivery', 'price': '33', 'is_removed': True}], '240', 7),
    ([{'code': 'customer_portal_delivery', 'price': '33'}], '240', 7),
    ([{'code': 'other', 'price': '33'}], '273', 7),
    ([], '240', 7),
])
def test_only_actual_matching_shipping_offsets_snapshotted_expense(shipping, total, expected):
    assert view(shipping=shipping, total=total)['profit'] == expected


def test_partial_cash_and_refunds_remain_conservative():
    result = view(delivery={'status': 'delivered', 'cash_collected': True, 'cash_amount': '250'})
    assert result['profit'] == 17
    refund = lambda amount: [{'transactions': [{'kind': 'refund', 'status': 'success', 'amount': amount}]}]
    assert view(refunds=refund('20'))['profit'] == 20
    assert view(refunds=refund('53'))['profit'] == 0
    assert view(financial='refunded')['profit'] == 0
    assert view(delivery={'status': 'returned', 'cash_collected': True, 'cash_amount': '273'})['profit'] == 0
