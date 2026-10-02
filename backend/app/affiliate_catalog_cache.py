"""Shared store snapshots: quick first page, progressive background pagination.

Authorization and pricing are applied by the caller on every response. Cached
stock is only a browsing hint; order submission always reads Shopify again.
"""
import hashlib
import json
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlencode

from app import db

_pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="affiliate-catalog")
_guard = threading.Lock()
_running = set()
_first_locks = {}
TTL = 120
MAX_AGE = 1800


def cache_key(connection, settings):
    collections = sorted({r['collection_id'] for r in settings['rules'] if r['store'] == connection['label']})
    identity = [connection['label'], connection['shop'], collections]
    return 'affiliate_catalog_v2:' + hashlib.sha256(json.dumps(identity).encode()).hexdigest()


def page(read, store, since):
    params = {'limit': 250, 'since_id': since, 'status': 'active',
        'fields': 'id,title,vendor,status,variants,images,options,product_type,tags,created_at,body_html'}
    result = read(store, '/products.json?' + urlencode(params)).get('products')
    if not isinstance(result, list): raise ValueError('Invalid Shopify product page')
    if result and max(int(p['id']) for p in result) <= since: raise ValueError('Invalid product pagination')
    return result


def _first(connection, settings, read, memberships):
    store = connection['label']
    currency = read(store, '/shop.json')['shop']['currency']
    if currency not in {'MAD', 'USD', 'EUR', 'GBP', 'CAD', 'AED', 'SAR'}:
        raise ValueError('Unsupported settlement currency')
    collections = memberships(store, settings)
    rows = page(read, store, 0)
    return {'timestamp': time.time(), 'currency': currency, 'products': rows,
        'memberships': {cid: sorted(ids) for cid, ids in collections.items()}, 'complete': len(rows) < 250}


def _finish(key, connection, settings, read, memberships, snapshot=None):
    try:
        data = snapshot or _first(connection, settings, read, memberships)
        db.set_app_setting(None, key, data)
        while not data['complete']:
            time.sleep(0.55)  # Leave capacity for order/customer writes in Shopify's REST bucket.
            since = max(int(p['id']) for p in data['products'])
            rows = page(read, connection['label'], since)
            data = {**data, 'products': [*data['products'], *rows], 'complete': len(rows) < 250}
            db.set_app_setting(None, key, data)
    except Exception:
        # Keep the last usable snapshot. A later request can retry the refresh.
        import logging
        logging.getLogger(__name__).exception('Affiliate catalog background refresh failed')
    finally:
        with _guard: _running.discard(key)


def _schedule(key, connection, settings, read, memberships, snapshot=None):
    with _guard:
        if key in _running: return
        _running.add(key)
    _pool.submit(_finish, key, connection, settings, read, memberships, snapshot)


def load(connection, settings, read, memberships):
    key = cache_key(connection, settings)
    data = db.get_app_setting(None, key)
    age = time.time() - float((data or {}).get('timestamp', 0))
    if not data or age > MAX_AGE:
        # Fetch one bounded page rather than every product before showing anything.
        with _guard: first_lock = _first_locks.setdefault(key, threading.Lock())
        with first_lock:
            data = db.get_app_setting(None, key)
            age = time.time() - float((data or {}).get('timestamp', 0))
            if not data or age > MAX_AGE:
                data = _first(connection, settings, read, memberships)
                db.set_app_setting(None, key, data)
                age = 0
    if not data['complete'] or age > TTL:
        _schedule(key, connection, settings, read, memberships,
            data if not data['complete'] and age <= MAX_AGE else None)
    return {**data, 'refreshing': not data['complete'] or age > TTL}


def invalidate(connection, settings):
    # A successful order should trigger a fresh stock snapshot on next browse.
    key = cache_key(connection, settings)
    data = db.get_app_setting(None, key)
    if data:
        db.set_app_setting(None, key, {**data, 'timestamp': 0})
