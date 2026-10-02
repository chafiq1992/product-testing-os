import json
from datetime import datetime

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import affiliates as a, db
REAL_DELIVERY_CITIES = a.delivery_cities


def test_seller_sessions_work_through_operator_gate_without_staff_access(market, monkeypatch):
    from app.auth_gate import AuthGateMiddleware

    monkeypatch.setenv('PTO_AUTH_GATE', 'on')
    app = FastAPI()
    app.add_middleware(AuthGateMiddleware)
    app.include_router(a.router)

    @app.get('/api/shopify/stores')
    def staff_stores():
        return {'data': {'stores': []}}

    client = TestClient(app)
    seller = client.post('/api/affiliates/apply', json={
        'name': 'Phone Seller', 'username': 'phone_seller', 'phone': '0612345678', 'password': 'securepassword',
    })
    assert seller.status_code == 200, seller.text
    login = client.post('/api/affiliates/login', json={'username': 'phone_seller', 'password': 'securepassword'})
    assert login.status_code == 200, login.text
    headers = {'Authorization': 'Bearer ' + login.json()['data']['token']}
    assert client.get('/api/affiliates/me', headers=headers).status_code == 200
    assert client.get('/api/affiliates/products', headers=headers).status_code == 403
    fixture_client, remote, _, _ = market
    approved = fixture_client.patch('/api/affiliates/admin/sellers/' + seller.json()['data']['id'], headers=ADMIN,
        json={'status': 'approved', 'access': {'alpha': ['Vendor A']}})
    assert approved.status_code == 200, approved.text
    cost(fixture_client)
    assert client.get('/api/affiliates/products', headers=headers).status_code == 200
    assert client.get('/api/affiliates/customers', headers=headers).status_code == 200
    assert client.put('/api/affiliates/marks', headers=headers,
        json={'store': 'alpha', 'product_id': '10', 'marked': True}).status_code == 200
    assert client.get('/api/affiliates/dashboard', headers=headers).status_code == 200
    assert client.post('/api/affiliates/orders', headers=headers, json=new_order()).status_code == 200
    deliver(remote)
    assert client.post('/api/affiliates/payouts', headers=headers,
        json={'amount': 10, 'currency': 'MAD', 'destination': 'QA bank account'}).status_code == 200
    # Seller credentials cannot reach staff data or administrative affiliate handlers.
    assert client.get('/api/shopify/stores', headers=headers).status_code == 401
    assert client.get('/api/affiliates/admin', headers=headers).status_code == 401
    assert client.get('/api/affiliates/admin').status_code == 401
    assert client.get('/api/affiliates/new-unverified-route', headers=headers).status_code == 401
    assert client.post('/api/affiliates/logout', headers=headers).status_code == 200
    assert client.get('/api/affiliates/me', headers=headers).status_code == 401


def test_staff_token_passes_gate_and_affiliate_admin_verification(market, monkeypatch):
    import time
    from app.auth_gate import AuthGateMiddleware
    from app.system_health_routes import _get_admin, _issue_token

    monkeypatch.setenv('PTO_AUTH_GATE', 'on')
    monkeypatch.setenv('SYSTEM_ADMIN_SECRET', 'affiliate-gate-test-only')
    monkeypatch.setattr(a, '_get_admin', _get_admin)
    app = FastAPI()
    app.add_middleware(AuthGateMiddleware)
    app.include_router(a.router)
    client = TestClient(app)
    token = _issue_token({'sub': 'admin@example.test', 'role': 'sys_admin', 'exp': int(time.time()) + 60})
    response = client.get('/api/affiliates/admin', headers={'Authorization': 'Bearer ' + token})
    assert response.status_code == 200, response.text


@pytest.fixture
def market(monkeypatch):
    engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
    for model in (a.Seller, a.SellerSession, a.SellerOrder, a.Payout, a.ProductCost, a.OrderTerms, a.ProductMark, a.Customer, a.CustomerLink, a.OrderReceipt):
        model.__table__.create(engine)
    monkeypatch.setattr(db, 'SessionLocal', sessionmaker(engine, expire_on_commit=False))
    settings = {'affiliate_marketplace_pricing': {'discount_percent': 50, 'rules': [], 'delivery_fees': {'MAD': 0}}}
    monkeypatch.setattr(db, 'get_app_setting', lambda store, key: settings.get(key, {}))
    monkeypatch.setattr(db, 'set_app_setting', lambda store, key, value: settings.update({key: value}))
    monkeypatch.setattr(a, 'delivery_cities', lambda force=False: [{'id': '1', 'name': 'Casablanca', 'country': 'MA'}, {'id': '2', 'name': 'Rabat', 'country': 'MA'}])
    connections = [{'label': 'alpha', 'shop': 'alpha.myshopify.com', 'connected': True}, {'label': 'beta', 'shop': 'beta.myshopify.com', 'connected': True}]
    monkeypatch.setattr(a, 'build_store_registry', lambda _: connections)
    monkeypatch.setattr(a, '_get_admin', lambda request: {'sub': 'admin@example.com'} if request.headers.get('authorization') == 'Bearer admin' else None)
    product = {'id': 10, 'title': 'Shoe', 'vendor': 'Vendor A', 'status': 'active', 'handle': 'shoe', 'images': [],
               'variants': [{'id': 20, 'title': '40', 'price': '200', 'inventory_management': 'shopify', 'inventory_policy': 'deny', 'inventory_quantity': 10}]}
    remote = {}
    remote_customers = {}
    writes = []
    def read(store, path):
        if path.startswith('/customers/search.json'): return {'customers': list(remote_customers.values())}
        if path.startswith('/customers/'): return {'customer': remote_customers[path.split('/')[2].split('.')[0]]}
        if path.startswith('/custom_collections.json'): return {'custom_collections': [{'id': 99, 'title': 'Summer'}]}
        if path.startswith('/smart_collections.json'): return {'smart_collections': []}
        if path == '/shop.json': return {'shop': {'currency': 'MAD'}}
        if path.startswith('/products/'): return {'product': product}
        if path.startswith('/products.json'): return {'products': [product, {**product, 'id': 11, 'vendor': 'Private vendor'}]}
        if path.startswith('/orders.json'):
            return {'orders': [order for (label, oid), order in remote.items() if label == store]}
        if path.startswith('/orders/'): return {'order': remote[store, path.split('/')[2].split('.')[0]]}
        raise AssertionError(path)
    def post(store, path, payload):
        if path == '/customers.json':
            cid = str(900 + len(remote_customers))
            customer = {**payload['customer'], 'id': int(cid)}
            remote_customers[cid] = customer
            return {'customer': customer}
        writes.append((store, payload))
        subtotal = sum(a.cents(item['price']) * item['quantity'] for item in payload['order']['line_items']) / 100
        order = {**payload['order'], 'id': 100 + len(writes), 'name': '#1001', 'currency': 'MAD',
                 'subtotal_price': str(subtotal), 'total_price': str(subtotal), 'fulfillments': [], 'refunds': []}
        remote[store, str(order['id'])] = order
        return {'order': order}
    monkeypatch.setattr(a, 'read_shopify', read)
    monkeypatch.setattr(a.shopify, '_rest_post_store', post)
    def gql(store, query, variables):
        cid = variables['id'].split('/')[-1]
        customer = remote_customers[cid]
        customer['tags'] = ','.join(sorted(set(customer['tags'].split(',')) | set(variables['tags'])))
        return {'tagsAdd': {'node': {'id': variables['id']}, 'userErrors': []}}
    monkeypatch.setattr(a.shopify, '_gql_store', gql)
    app = FastAPI(); app.include_router(a.router)
    client = TestClient(app)
    yield client, remote, writes, product
    engine.dispose()


ADMIN = {'Authorization': 'Bearer admin'}


def account(client, username='seller', approved=True):
    result = client.post('/api/affiliates/apply', json={'name': 'Seller One', 'username': username, 'phone': '0612345678', 'password': 'securepassword'})
    assert result.status_code == 200, result.text
    seller = result.json()['data']
    token = client.post('/api/affiliates/login', json={'username': username, 'password': 'securepassword'}).json()['data']['token']
    if approved:
        response = client.patch('/api/affiliates/admin/sellers/' + seller['id'], headers=ADMIN, json={'status': 'approved', 'access': {'alpha': ['Vendor A']}})
        assert response.status_code == 200, response.text
    return seller['id'], {'Authorization': 'Bearer ' + token}


def cost(client, amount=100):
    response = client.put('/api/affiliates/admin/pricing', headers=ADMIN,
        json={'discount_percent': round((1 - amount / 200) * 100, 2), 'rules': [], 'delivery_fees': {'MAD': 0}})
    assert response.status_code == 200, response.text


def new_order(**changes):
    return {'request_id': 'request-unique-001', 'store': 'alpha', 'customer_name': 'Buyer One', 'customer_phone': '0612345678',
            'address': 'Street 1', 'city': 'Casablanca', 'country': 'MA', 'items': [{'product_id': '10', 'variant_id': '20', 'quantity': 2, 'sale_price': '120'}], **changes}


def create(client, headers, **changes):
    response = client.post('/api/affiliates/orders', headers=headers, json=new_order(**changes))
    assert response.status_code == 200, response.text
    return response.json()['data']


def deliver(remote, store='alpha', oid='101', **changes):
    remote[store, oid].update({'financial_status': 'paid', 'fulfillments': [{'shipment_status': 'delivered', 'tracking_number': 'T1'}], **changes})


def test_pending_sellers_and_anonymous_admin_are_blocked(market):
    client, _, _, _ = market
    _, headers = account(client, approved=False)
    assert client.get('/api/affiliates/products', headers=headers).status_code == 403
    assert client.post('/api/affiliates/orders', headers=headers, json=new_order()).status_code == 403
    assert client.get('/api/affiliates/admin', headers=headers).status_code == 401
    assert client.get('/api/affiliates/dashboard').status_code == 401


def test_passwords_are_hashed_sessions_revoked_and_duplicate_user_rejected(market):
    client, _, _, _ = market
    sid, headers = account(client)
    with db.SessionLocal() as session:
        row = session.get(a.Seller, sid)
        assert 'securepassword' not in row.password_hash
    assert client.post('/api/affiliates/login', json={'username': 'seller', 'password': 'wrong'}).status_code == 401
    assert client.post('/api/affiliates/apply', json={'name': 'Seller Two', 'username': 'SELLER', 'phone': '0612345678', 'password': 'securepassword'}).status_code == 409
    assert client.post('/api/affiliates/logout', headers=headers).status_code == 200
    assert client.get('/api/affiliates/me', headers=headers).status_code == 401


def test_catalog_limits_exact_store_vendor_and_shows_admin_cost(market):
    client, _, _, _ = market
    _, headers = account(client); cost(client)
    products = client.get('/api/affiliates/products', headers=headers).json()['data']['products']
    assert [p['store'] for p in products] == ['alpha']
    assert all('vendor' not in p for p in products)
    assert products[0]['variants'][0]['unit_cost'] == 100


def test_cross_store_vendor_variant_and_stock_tampering_are_rejected(market):
    client, _, writes, product = market
    _, headers = account(client); cost(client)
    assert client.post('/api/affiliates/orders', headers=headers, json=new_order(store='beta')).status_code == 403
    product['vendor'] = 'Private vendor'
    assert client.post('/api/affiliates/orders', headers=headers, json=new_order()).status_code == 403
    product['vendor'] = 'Vendor A'
    body = new_order(); body['items'][0]['variant_id'] = '999'
    assert client.post('/api/affiliates/orders', headers=headers, json=body).status_code == 422
    body = new_order(); body['items'][0]['quantity'] = 11
    assert client.post('/api/affiliates/orders', headers=headers, json=body).status_code == 409
    assert not writes


def test_sale_price_must_exceed_cost_and_shopify_price_must_exist(market):
    client, _, writes, product = market
    _, headers = account(client)
    product['variants'][0]['price'] = '0'
    assert client.post('/api/affiliates/orders', headers=headers, json=new_order()).status_code == 422
    product['variants'][0]['price'] = '200'
    cost(client, 120)
    assert client.post('/api/affiliates/orders', headers=headers, json=new_order()).status_code == 422
    assert not writes


def test_order_uses_seller_price_and_snapshots_cost_and_is_idempotent(market):
    client, remote, writes, _ = market
    _, headers = account(client); cost(client)
    order = create(client, headers)
    assert order['pending_profit'] == 40 and order['cost'] == 200
    assert writes[0][1]['order']['line_items'][0]['price'] == '120'
    assert create(client, headers)['id'] == order['id']
    assert len(writes) == 1
    cost(client, 110); deliver(remote)
    a.sync_orders(client.get('/api/affiliates/me', headers=headers).json()['data']['id'], force=True)
    summary = client.get('/api/affiliates/dashboard', headers=headers).json()['data']['analytics']['MAD']
    assert summary['profit'] == 40  # Existing orders retain original cost.
    assert client.post('/api/affiliates/orders', headers=headers, json=new_order(city='Rabat')).status_code == 409


def test_orders_and_payouts_are_isolated_by_seller(market):
    client, _, _, _ = market
    _, first = account(client); cost(client); create(client, first)
    _, second = account(client, username='another')
    own = client.get('/api/affiliates/dashboard', headers=second).json()['data']
    assert own['orders'] == [] and own['payouts'] == []


@pytest.mark.parametrize('state', ['cancelled', 'returned', 'refunded'])
def test_cancelled_returned_refunded_orders_do_not_earn(market, state):
    client, remote, _, _ = market
    _, headers = account(client); cost(client); create(client, headers); deliver(remote)
    order = remote['alpha', '101']
    if state == 'cancelled': order['cancelled_at'] = '2026-10-02'
    if state == 'returned': order['fulfillments'] = []; order['tags'] = 'returned'
    if state == 'refunded': order['financial_status'] = 'refunded'
    a.sync_orders(client.get('/api/affiliates/me', headers=headers).json()['data']['id'], force=True)
    result = client.get('/api/affiliates/dashboard', headers=headers).json()['data']['analytics']['MAD']
    assert result['profit'] == 0 and result['available'] == 0


def test_partial_refund_reduces_profit(market):
    client, remote, _, _ = market
    _, headers = account(client); cost(client); create(client, headers)
    deliver(remote, financial_status='partially_refunded', refunds=[{'refund_line_items': [{'subtotal': '10'}]}])
    a.sync_orders(client.get('/api/affiliates/me', headers=headers).json()['data']['id'], force=True)
    result = client.get('/api/affiliates/dashboard', headers=headers).json()['data']['analytics']['MAD']
    assert result['profit'] == 30


def test_payout_reservation_approval_and_transfer_reference(market):
    client, remote, _, _ = market
    _, headers = account(client); cost(client); create(client, headers); deliver(remote)
    body = {'amount': 30, 'currency': 'MAD', 'destination': 'Bank account 123'}
    result = client.post('/api/affiliates/payouts', headers=headers, json=body)
    assert result.status_code == 200, result.text
    pid = result.json()['data']['id']
    assert client.post('/api/affiliates/payouts', headers=headers, json=body).status_code == 409
    assert client.patch('/api/affiliates/admin/payouts/' + pid, headers=ADMIN, json={'status': 'paid', 'reference': 'bank-1'}).status_code == 409
    assert client.patch('/api/affiliates/admin/payouts/' + pid, headers=ADMIN, json={'status': 'approved'}).status_code == 200
    assert client.patch('/api/affiliates/admin/payouts/' + pid, headers=ADMIN, json={'status': 'paid'}).status_code == 422
    assert client.patch('/api/affiliates/admin/payouts/' + pid, headers=ADMIN, json={'status': 'paid', 'reference': 'bank-1'}).status_code == 200
    a.sync_orders(client.get('/api/affiliates/me', headers=headers).json()['data']['id'], force=True)
    result = client.get('/api/affiliates/dashboard', headers=headers).json()['data']['analytics']['MAD']
    assert result['available'] == 10 and result['paid'] == 30


def test_payout_is_rechecked_after_return_and_rejection_releases_reservation(market):
    client, remote, _, _ = market
    _, headers = account(client); cost(client); create(client, headers); deliver(remote)
    pid = client.post('/api/affiliates/payouts', headers=headers, json={'amount': 30, 'currency': 'MAD', 'destination': 'Bank account 123'}).json()['data']['id']
    remote['alpha', '101']['cancelled_at'] = '2026-10-02'
    assert client.patch('/api/affiliates/admin/payouts/' + pid, headers=ADMIN, json={'status': 'approved'}).status_code == 409
    assert client.patch('/api/affiliates/admin/payouts/' + pid, headers=ADMIN, json={'status': 'rejected'}).status_code == 200


def test_suspension_revokes_existing_session_access(market):
    client, _, _, _ = market
    sid, headers = account(client)
    assert client.patch('/api/affiliates/admin/sellers/' + sid, headers=ADMIN, json={'status': 'suspended', 'access': {'alpha': ['Vendor A']}}).status_code == 200
    assert client.get('/api/affiliates/dashboard', headers=headers).status_code == 403


def test_uncertain_submission_is_not_retried_and_can_be_reconciled(market, monkeypatch):
    client, remote, writes, _ = market
    _, headers = account(client); cost(client)
    original = a.shopify._rest_post_store
    def timeout(*args):
        result = original(*args)
        if args[1] == '/orders.json': raise TimeoutError('response lost')
        return result
    monkeypatch.setattr(a.shopify, '_rest_post_store', timeout)
    assert client.post('/api/affiliates/orders', headers=headers, json=new_order()).status_code == 502
    assert client.post('/api/affiliates/orders', headers=headers, json=new_order()).status_code == 409
    assert len(writes) == 1
    order = client.get('/api/affiliates/dashboard', headers=headers).json()['data']['orders'][0]
    result = client.post('/api/affiliates/admin/orders/' + order['id'] + '/reconcile', headers=ADMIN, json={'shopify_id': '101'})
    assert result.status_code == 200, result.text
    assert result.json()['data']['state'] == 'created'


def test_delivery_cash_cap_and_unavailable_delivery_blocks_payout(market, monkeypatch):
    client, remote, _, _ = market
    _, headers = account(client); cost(client); create(client, headers)
    monkeypatch.setattr(db, 'get_app_setting', lambda *args: {'base_url': 'https://delivery.example', 'api_key': 'private-key'})
    class Response:
        status_code = 200
        def raise_for_status(self): pass
        def json(self): return {'data': {'orders': [{'shop': 'alpha.myshopify.com', 'order_id': '101', 'status': 'delivered', 'raw_status': 'Livré', 'cash_collected': True, 'cash_amount': 220}]}}
    monkeypatch.setattr(a.requests, 'post', lambda *args, **kwargs: Response())
    a.sync_orders(client.get('/api/affiliates/me', headers=headers).json()['data']['id'], force=True)
    result = client.get('/api/affiliates/dashboard', headers=headers).json()['data']
    assert result['analytics']['MAD']['profit'] == 20
    def failure(*args, **kwargs): raise TimeoutError()
    monkeypatch.setattr(a.requests, 'post', failure)
    assert client.post('/api/affiliates/payouts', headers=headers, json={'amount': 10, 'currency': 'MAD', 'destination': 'Bank account 123'}).status_code == 409


def test_currencies_are_never_combined(market):
    client, _, _, _ = market
    sid, headers = account(client)
    with db.SessionLocal() as session:
        for i, currency in enumerate(['MAD', 'EUR']):
            session.add(a.SellerOrder(id=str(i), seller_id=sid, request_id=f'currency-{i}', fingerprint='x', store='alpha',
                cost_cents=10000, currency=currency, state='created', snapshot=json.dumps({'subtotal_price': '150', 'total_price': '150', 'financial_status': 'paid', 'tags': 'delivered'}), created_at=datetime.utcnow()))
        session.commit()
    result = a.dashboard(sid)['analytics']
    assert set(result) == {'MAD', 'EUR'} and result['EUR']['profit'] == 50 and result['MAD']['profit'] == 50


def test_pending_cod_price_review_blocks_settlement_even_if_shopify_is_paid(market):
    client, remote, _, _ = market
    sid, headers = account(client); cost(client); create(client, headers); deliver(remote)
    with db.SessionLocal() as session:
        row = session.query(a.SellerOrder).filter_by(seller_id=sid).one()
        row.delivery = json.dumps({'status': 'delivered', 'raw_status': 'Livré', 'cash_collected': False, 'settlement_pending': True, 'cash_amount': 240})
        session.commit()
    a.sync_orders(sid, force=True)
    result = a.dashboard(sid)['analytics']['MAD']
    assert result['profit'] == 0 and result['available'] == 0 and result['pending_profit'] == 40


def test_default_35_percent_cost_and_33_delivery_fee_are_snapshotted(market, monkeypatch):
    client, remote, writes, product = market
    # No saved pricing is the production default.
    original_get = db.get_app_setting
    monkeypatch.setattr(db, 'get_app_setting', lambda store, key: {} if key == 'affiliate_marketplace_pricing' else original_get(store, key))
    sid, headers = account(client)
    product['variants'][0]['price'] = '199'
    listing = client.get('/api/affiliates/products', headers=headers).json()['data']['products'][0]
    assert listing['variants'][0]['unit_cost'] == 129.35
    assert listing['variants'][0]['price'] == '199'
    order = create(client, headers, items=[{'product_id': '10', 'variant_id': '20', 'quantity': 1, 'sale_price': '199'}])
    assert order['delivery_fee'] == 33 and order['pending_profit'] == 36.65 and order['profit'] == 0
    assert 'shipping_lines' not in writes[0][1]['order']  # Fee is deducted from profit.
    assert writes[0][1]['order']['customer']['id'] == 900
    monkeypatch.setattr(db, 'get_app_setting', original_get)
    assert client.put('/api/affiliates/admin/pricing', headers=ADMIN, json={'discount_percent': 10, 'delivery_fees': {'MAD': 99}}).status_code == 200
    deliver(remote)
    a.sync_orders(sid, force=True)
    delivered = a.dashboard(sid)['orders'][0]
    assert delivered['cost'] == 129.35 and delivered['delivery_fee'] == 33 and delivered['profit'] == 36.65
    assert client.post('/api/affiliates/payouts', headers=headers, json={'amount': 36.66, 'currency': 'MAD', 'destination': 'QA bank'}).status_code == 409


def test_delivery_fee_is_once_per_order_and_partial_collection_caps_profit(market):
    client, remote, _, _ = market
    sid, headers = account(client)
    assert client.put('/api/affiliates/admin/pricing', headers=ADMIN, json={'discount_percent': 35, 'delivery_fees': {'MAD': 33}}).status_code == 200
    order = create(client, headers, items=[{'product_id': '10', 'variant_id': '20', 'quantity': 3, 'sale_price': '200'}])
    assert order['cost'] == 390 and order['pending_profit'] == 177
    with db.SessionLocal() as session:
        row = session.get(a.SellerOrder, order['id'])
        row.delivery = json.dumps({'status': 'delivered', 'cash_collected': True, 'cash_amount': 500})
        session.commit()
    assert a.dashboard(sid)['orders'][0]['profit'] == 77


def test_collection_pricing_is_scoped_validated_and_cannot_fail_open(market, monkeypatch):
    client, _, _, product = market
    _, headers = account(client)
    rule = {'store': 'alpha', 'collection_id': '99', 'discount_percent': 20}
    response = client.put('/api/affiliates/admin/pricing', headers=ADMIN,
        json={'discount_percent': 35, 'rules': [rule], 'delivery_fees': {'MAD': 33}})
    assert response.status_code == 200, response.text
    listing = client.get('/api/affiliates/products', headers=headers).json()['data']['products'][0]
    assert listing['variants'][0]['unit_cost'] == 160 and listing['discount_percent'] == 20
    unknown = {**rule, 'collection_id': '555'}
    assert client.put('/api/affiliates/admin/pricing', headers=ADMIN,
        json={'discount_percent': 35, 'rules': [unknown]}).status_code == 422
    assert client.put('/api/affiliates/admin/pricing', headers=ADMIN,
        json={'discount_percent': 35, 'rules': [rule, rule]}).status_code == 422
    original_read = a.read_shopify
    def unavailable(store, path):
        if 'collection_id=' in path: raise TimeoutError('Collection could not be read')
        return original_read(store, path)
    monkeypatch.setattr(a, 'read_shopify', unavailable)
    # Expire the prior verified snapshot. Fresh cache entries can still be shown,
    # while submission always verifies collection membership against Shopify.
    connection = a.connected_stores()[0]
    a.catalog_cache.invalidate(connection, a.pricing_settings())
    listing = client.get('/api/affiliates/products', headers=headers).json()['data']
    assert listing['products'] == [] and listing['warnings']
    assert client.post('/api/affiliates/orders', headers=headers, json=new_order()).status_code != 200


def test_marketplace_option_positions_stock_and_safe_description(market):
    client, _, _, product = market
    _, headers = account(client)
    product.update({'product_type': 'Unisex enfants', 'created_at': '2026-10-02T10:00:00Z',
        'body_html': '<p>Comfortable shoes</p><script>unsafe()</script><p>Every day</p>',
        'images': [{'id': 1, 'src': 'https://example.test/red.jpg'}, {'id': 2, 'src': 'https://example.test/blue.jpg'}],
        'options': [{'name': 'Taille', 'position': 1}, {'name': 'Couleur', 'position': 2}],
        'variants': [{**product['variants'][0], 'option1': '40', 'option2': 'Red', 'image_id': 1},
            {**product['variants'][0], 'id': 21, 'option1': '41', 'option2': 'Blue', 'inventory_quantity': 0, 'inventory_policy': 'continue'}]})
    listing = client.get('/api/affiliates/products', headers=headers).json()['data']['products'][0]
    assert listing['category'] == 'unisex_kids' and len(listing['images']) == 2
    assert listing['description'] == 'Comfortable shoes\nEvery day'
    assert listing['variants'][0]['color'] == 'Red' and listing['variants'][0]['size'] == '40'
    assert listing['variants'][0]['image'] == 'https://example.test/red.jpg'
    assert listing['variants'][1]['available'] is False and listing['inventory_quantity'] == 10
    assert client.post('/api/affiliates/orders', headers=headers, json=new_order(items=[{'product_id': '10', 'variant_id': '21', 'quantity': 1, 'sale_price': '200'}])).status_code == 409


@pytest.mark.parametrize('text, expected', [('Women shoes', 'women'), ('Men', 'men'), ('Filles', 'girls'), ('Garçons', 'boys'), ('Unisex adult', 'unisex_adult'), ('Unisex kids', 'unisex_kids')])
def test_product_type_categories(text, expected):
    from app.affiliate_marketplace import product_category
    assert product_category({'product_type': text}) == expected


def test_marked_products_persist_and_are_isolated(market):
    client, _, _, product = market
    _, first = account(client)
    _, second = account(client, username='seller_two')
    body = {'store': 'alpha', 'product_id': '10', 'marked': True}
    assert client.put('/api/affiliates/marks', headers=first, json=body).status_code == 200
    assert client.get('/api/affiliates/products', headers=first).json()['data']['products'][0]['marked'] is True
    assert client.get('/api/affiliates/products', headers=second).json()['data']['products'][0]['marked'] is False
    assert client.put('/api/affiliates/marks', headers=second, json={**body, 'store': 'beta'}).status_code == 403
    assert client.put('/api/affiliates/marks', headers=first, json={**body, 'marked': False}).status_code == 200
    assert client.get('/api/affiliates/products', headers=first).json()['data']['products'][0]['marked'] is False


def test_customer_list_reuse_shopify_tags_and_seller_isolation(market, monkeypatch):
    client, _, _, _ = market
    first_id, first = account(client)
    second_id, second = account(client, username='seller_two')
    original_post = a.shopify._rest_post_store
    created_customers, updated_customers = [], []
    def post(store, path, payload):
        if path == '/customers.json': created_customers.append(payload['customer'])
        return original_post(store, path, payload)
    original_gql = a.shopify._gql_store
    def gql(store, query, variables):
        updated_customers.append(variables)
        return original_gql(store, query, variables)
    monkeypatch.setattr(a.shopify, '_rest_post_store', post)
    monkeypatch.setattr(a.shopify, '_gql_store', gql)
    create(client, first)
    customers = client.get('/api/affiliates/customers', headers=first).json()['data']
    assert len(customers) == 1 and customers[0]['orders_count'] == 1
    assert client.get('/api/affiliates/customers', headers=second).json()['data'] == []
    assert created_customers[0]['tags'] == f'affiliate,affiliate_seller:{first_id}'
    assert created_customers[0]['send_email_invite'] is False
    assert client.post('/api/affiliates/orders', headers=second, json=new_order(customer_id=customers[0]['id'])).status_code == 403
    create(client, first, request_id='another-order-001', customer_id=customers[0]['id'])
    assert len(created_customers) == 1
    assert client.get('/api/affiliates/customers', headers=first).json()['data'][0]['orders_count'] == 2
    create(client, second, customer_name='Own customer details')
    assert len(created_customers) == 1
    assert f'affiliate_seller:{second_id}' in updated_customers[0]['tags']
    assert f'affiliate_seller:{first_id}' in created_customers[0]['tags']
    assert set(updated_customers[0]) == {'id', 'tags'}  # Existing Shopify personal details are untouched.
    assert client.get('/api/affiliates/customers', headers=second).json()['data'][0]['customer_name'] == 'Own customer details'


def test_delivery_fee_and_underpriced_orders_are_validated(market):
    client, _, writes, _ = market
    _, headers = account(client)
    assert client.put('/api/affiliates/admin/pricing', headers=ADMIN,
        json={'discount_percent': 35, 'delivery_fees': {'MAD': -1}}).status_code == 422
    assert client.put('/api/affiliates/admin/pricing', headers=headers,
        json={'discount_percent': 35, 'delivery_fees': {'MAD': 33}}).status_code == 401
    assert client.put('/api/affiliates/admin/pricing', headers=ADMIN,
        json={'discount_percent': 35, 'delivery_fees': {'MAD': 33}}).status_code == 200
    # Selling above unit cost alone is insufficient to cover delivery.
    assert client.post('/api/affiliates/orders', headers=headers,
        json=new_order(items=[{'product_id': '10', 'variant_id': '20', 'quantity': 1, 'sale_price': '150'}])).status_code == 422
    assert not writes


def test_customer_permission_failure_blocks_order_before_shopify_write(market, monkeypatch):
    client, _, writes, _ = market
    _, headers = account(client)
    original_read = a.read_shopify
    def missing_permission(store, path):
        if path.startswith('/customers/'): raise PermissionError('Missing read_customers')
        return original_read(store, path)
    monkeypatch.setattr(a, 'read_shopify', missing_permission)
    response = client.post('/api/affiliates/orders', headers=headers, json=new_order())
    assert response.status_code == 502 and 'no order was submitted' in response.json()['detail']
    assert not writes
    with db.SessionLocal() as session:
        assert session.query(a.SellerOrder).count() == 0


def test_failed_atomic_customer_tags_block_order_and_preserve_existing_customer(market, monkeypatch):
    client, _, writes, _ = market
    _, first = account(client)
    _, second = account(client, username='seller_two')
    create(client, first)
    monkeypatch.setattr(a.shopify, '_gql_store', lambda *args: {'tagsAdd': {'node': None, 'userErrors': [{'message': 'Permission denied'}]}})
    response = client.post('/api/affiliates/orders', headers=second, json=new_order())
    assert response.status_code == 502 and len(writes) == 1
    assert client.get('/api/affiliates/customers', headers=first).json()['data'][0]['orders_count'] == 1


def test_failed_collection_validation_preserves_admin_settings(market, monkeypatch):
    client, _, _, _ = market
    initial = client.get('/api/affiliates/admin/pricing', headers=ADMIN).json()['data']['settings']
    original_read = a.read_shopify
    def failed_collections(store, path):
        if path.startswith('/custom_collections.json'): raise TimeoutError('Connection unavailable')
        return original_read(store, path)
    monkeypatch.setattr(a, 'read_shopify', failed_collections)
    response = client.put('/api/affiliates/admin/pricing', headers=ADMIN,
        json={'discount_percent': 35, 'rules': [{'store': 'alpha', 'collection_id': '99', 'discount_percent': 25}]})
    assert response.status_code == 502
    assert a.pricing_settings() == initial


def test_cached_catalog_avoids_shopify_reads_and_filters_current_vendor_access(market, monkeypatch):
    client, _, _, product = market
    sid, headers = account(client)
    first = client.get('/api/affiliates/products', headers=headers).json()['data']
    assert len(first['products']) == 1
    monkeypatch.setattr(a, 'read_shopify', lambda *args: (_ for _ in ()).throw(AssertionError('Cached browse must not call Shopify')))
    second = client.get('/api/affiliates/products', headers=headers).json()['data']
    assert second['products'] == first['products'] and not second['warnings']
    # Shared store snapshots do not grant seller access to private vendors.
    with db.SessionLocal() as session:
        row = session.get(a.Seller, sid)
        row.access = json.dumps({'alpha': ['Private vendor']})
        session.commit()
    own = client.get('/api/affiliates/products', headers=headers).json()['data']['products']
    assert [p['id'] for p in own] == ['11']


def test_cold_catalog_returns_one_page_then_schedules_remaining_pages(market, monkeypatch):
    client, _, _, product = market
    _, headers = account(client)
    original = a.read_shopify
    calls, scheduled = [], []
    def read(store, path):
        calls.append(path)
        if path.startswith('/products.json'):
            return {'products': [{**product, 'id': i + 1} for i in range(250)]}
        return original(store, path)
    monkeypatch.setattr(a, 'read_shopify', read)
    monkeypatch.setattr(a.catalog_cache, '_schedule', lambda *args: scheduled.append(args))
    data = client.get('/api/affiliates/products', headers=headers).json()['data']
    assert len(data['products']) == 250 and data['refreshing'] is True
    assert len([c for c in calls if c.startswith('/products.json')]) == 1 and len(scheduled) == 1


def test_receipt_is_owned_immutable_and_excludes_private_earnings(market):
    client, _, writes, product = market
    _, first = account(client)
    _, second = account(client, username='seller_two')
    product['images'] = [{'id': 5, 'src': 'https://example.test/shoe.jpg'}]
    product['variants'][0].update({'title': 'Blue / 40', 'image_id': 5})
    created = create(client, first)
    assert writes[0][1]['order']['shipping_address']['phone'] == '+212612345678'
    assert 'phone' not in writes[0][1]['order']
    result = client.get('/api/affiliates/order-details', headers=first, params={'order_id': created['id']})
    receipt = result.json()['data']['receipt']
    assert receipt['items'][0]['variant'] == 'Blue / 40' and receipt['items'][0]['image'].endswith('shoe.jpg')
    assert receipt['total'] == 240 and receipt['customer_phone'] == '+212612345678'
    assert not {'cost', 'profit', 'delivery_fee', 'store', 'vendor'} & receipt.keys()
    product['title'] = 'Changed title'
    assert client.get('/api/affiliates/order-details', headers=first, params={'order_id': created['id']}).json()['data']['receipt']['items'][0]['title'] == 'Shoe'
    assert client.get('/api/affiliates/order-details', headers=second, params={'order_id': created['id']}).status_code == 404


def test_explicit_shopify_rejection_surfaces_validation_error_without_retry(market, monkeypatch):
    import requests
    client, _, _, _ = market
    _, headers = account(client)
    original = a.shopify._rest_post_store
    def rejected(store, path, payload):
        if path != '/orders.json': return original(store, path, payload)
        response = requests.Response()
        response.status_code = 422
        response._content = b'{"errors":{"phone":["is invalid"]}}'
        raise requests.HTTPError(response=response)
    monkeypatch.setattr(a.shopify, '_rest_post_store', rejected)
    response = client.post('/api/affiliates/orders', headers=headers, json=new_order())
    assert response.status_code == 422 and 'phone: is invalid' in response.json()['detail']
    with db.SessionLocal() as session:
        assert session.query(a.SellerOrder).one().state == 'rejected'
    repeated = client.post('/api/affiliates/orders', headers=headers, json=new_order())
    assert repeated.status_code == 422 and repeated.json()['detail'] == response.json()['detail']


def test_unsupported_city_is_rejected_before_any_customer_or_order_write(market):
    client, _, writes, _ = market
    _, headers = account(client)
    response = client.post('/api/affiliates/orders', headers=headers, json=new_order(city='Not served'))
    assert response.status_code == 422 and not writes
    with db.SessionLocal() as session:
        assert session.query(a.Customer).count() == 0


def test_delivery_city_bridge_uses_server_credentials_caches_reads_and_verifies_submission(market, monkeypatch):
    client, _, _, _ = market
    _, headers = account(client)
    db.set_app_setting(None, 'affiliate_delivery_connection', {'base_url':'https://delivery.example.test','api_key':'private-qa-key'})
    calls=[]
    class Response:
        def raise_for_status(self): pass
        def json(self): return {'data':{'cities':[{'id':'1','name':'Casablanca','country':'MA'},{'id':'2','name':'Paris','country':'FR'}]}}
    def get(url, **kwargs):
        calls.append((url,kwargs)); return Response()
    monkeypatch.setattr(a.requests,'get',get)
    monkeypatch.setattr(a,'delivery_cities',REAL_DELIVERY_CITIES)
    first=client.get('/api/affiliates/cities',headers=headers)
    assert first.json()['data']['cities']==[{'id':'1','name':'Casablanca','country':'MA'}]
    assert 'private-qa-key' not in first.text
    assert client.get('/api/affiliates/cities',headers=headers).status_code==200 and len(calls)==1
    assert calls[0][1]['allow_redirects'] is False
    create(client,headers)
    assert len(calls)==2  # Submit forces a fresh city lookup.


def test_delivery_city_bridge_rejects_html_or_unconfigured_connection(market, monkeypatch):
    client, _, _, _=market
    _,headers=account(client)
    monkeypatch.setattr(a,'delivery_cities',REAL_DELIVERY_CITIES)
    assert client.get('/api/affiliates/cities',headers=headers).status_code==503
    db.set_app_setting(None,'affiliate_delivery_connection',{'base_url':'https://delivery.example.test','api_key':'private-qa-key'})
    class Response:
        def raise_for_status(self): pass
        def json(self): raise ValueError('HTML is not JSON')
    monkeypatch.setattr(a.requests,'get',lambda *args,**kwargs:Response())
    assert client.get('/api/affiliates/cities',headers=headers).status_code==502
