import json
from datetime import datetime

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import affiliates as a, db


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
    for model in (a.Seller, a.SellerSession, a.SellerOrder, a.Payout, a.ProductCost):
        model.__table__.create(engine)
    monkeypatch.setattr(db, 'SessionLocal', sessionmaker(engine, expire_on_commit=False))
    monkeypatch.setattr(db, 'get_app_setting', lambda *args: {})
    connections = [{'label': 'alpha', 'shop': 'alpha.myshopify.com', 'connected': True}, {'label': 'beta', 'shop': 'beta.myshopify.com', 'connected': True}]
    monkeypatch.setattr(a, 'build_store_registry', lambda _: connections)
    monkeypatch.setattr(a, '_get_admin', lambda request: {'sub': 'admin@example.com'} if request.headers.get('authorization') == 'Bearer admin' else None)
    product = {'id': 10, 'title': 'Shoe', 'vendor': 'Vendor A', 'status': 'active', 'handle': 'shoe', 'images': [],
               'variants': [{'id': 20, 'title': '40', 'price': '150', 'inventory_management': 'shopify', 'inventory_policy': 'deny', 'inventory_quantity': 10}]}
    remote = {}
    writes = []
    def read(store, path):
        if path == '/shop.json': return {'shop': {'currency': 'MAD'}}
        if path.startswith('/products/'): return {'product': product}
        if path.startswith('/products.json'): return {'products': [product, {**product, 'id': 11, 'vendor': 'Private vendor'}]}
        if path.startswith('/orders.json'):
            return {'orders': [order for (label, oid), order in remote.items() if label == store]}
        if path.startswith('/orders/'): return {'order': remote[store, path.split('/')[2].split('.')[0]]}
        raise AssertionError(path)
    def post(store, path, payload):
        writes.append((store, payload))
        order = {**payload['order'], 'id': 100 + len(writes), 'name': '#1001', 'currency': 'MAD',
                 'subtotal_price': '240', 'total_price': '240', 'fulfillments': [], 'refunds': []}
        remote[store, str(order['id'])] = order
        return {'order': order}
    monkeypatch.setattr(a, 'read_shopify', read)
    monkeypatch.setattr(a.shopify, '_rest_post_store', post)
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
    response = client.put('/api/affiliates/admin/costs', headers=ADMIN, json={'store': 'alpha', 'product_id': '10', 'variant_id': '20', 'unit_cost': amount})
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
    assert [(p['store'], p['vendor']) for p in products] == [('alpha', 'Vendor A')]
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


def test_sale_price_must_exceed_cost_and_cost_must_exist(market):
    client, _, writes, _ = market
    _, headers = account(client)
    assert client.post('/api/affiliates/orders', headers=headers, json=new_order()).status_code == 422
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
        original(*args)
        raise TimeoutError('response lost')
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
