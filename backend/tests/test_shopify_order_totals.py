import asyncio
from datetime import datetime

import pytest

from app.integrations import shopify_client as sc


@pytest.mark.parametrize('field,function', [('processed_at', sc.count_orders_total_processed), ('created_at', sc.count_orders_total_created)])
def test_store_total_uses_full_local_day_and_unlimited_exact_count(monkeypatch, field, function):
    calls = []
    monkeypatch.setattr(sc, '_rest_get_store', lambda *_: {'shop': {'iana_timezone': 'Africa/Casablanca'}})
    monkeypatch.setattr(sc, '_gql_store_once', lambda st, gql, variables, **_: calls.append(variables) or {'ordersCount': {'count': 41, 'precision': 'EXACT'}})
    with sc.reporting_timezone_scope(None):
        assert function('2026-10-04', '2026-10-04', store='irrakids', include_closed=True) == 41
    assert calls[0]['limit'] is None
    # Morocco is permanently UTC+0 since 2026-09-20 (IANA 2026c), so a Casablanca
    # day in October is the UTC day. The old UTC+1 rule started it at 23:00.
    assert f'{field}:>="2026-10-04T00:00:00+00:00"' in calls[0]['query']
    assert f'{field}:<="2026-10-04T23:59:59.999000+00:00"' in calls[0]['query']
    assert 'status:open' not in calls[0]['query']


@pytest.mark.parametrize('response', [{}, {'ordersCount': {'count': 10000, 'precision': 'AT_LEAST'}}])
def test_missing_or_capped_count_is_a_failure_not_zero(monkeypatch, response):
    monkeypatch.delenv('PTOS_ORDERS_TOTAL_REST_FALLBACK', raising=False)
    monkeypatch.setattr(sc, '_gql_store_once', lambda *_args, **_kwargs: response)
    with sc.reporting_timezone_scope('UTC'), pytest.raises(RuntimeError, match='exact'):
        sc.count_orders_total_processed('2026-10-04', '2026-10-04')


def test_utm_search_and_product_search_use_reporting_day_boundaries(monkeypatch):
    queries = []
    monkeypatch.setattr(sc, '_gql_store_once', lambda st, gql, variables, **_: queries.append(variables['query']) or {'orders': {'edges': [], 'pageInfo': {'hasNextPage': False}}})
    with sc.reporting_timezone_scope('America/Los_Angeles'):
        sc.list_orders_with_utms_processed_graphql('2026-10-04', '2026-10-04', store='irrakids')
        assert sc._count_orders_by_product_search('123', '2026-10-04', '2026-10-04', store='irrakids') == 0
    assert len(queries) == 2
    assert all('2026-10-04T07:00:00+00:00' in query and '2026-10-05T06:59:59.999000+00:00' in query for query in queries)


def test_shop_summary_overrides_meta_day_and_restores_context(monkeypatch):
    from app import main
    main._API_CACHE.clear()
    seen = []

    class FixedClock(datetime):
        @classmethod
        def now(cls, tz=None):
            return cls.fromisoformat('2026-10-04T01:00:00+00:00').astimezone(tz)

    def timezone(store, *, strict=False):
        assert sc.current_reporting_timezone() is None
        assert strict is True
        return 'America/Los_Angeles'

    def count(start, end, **kwargs):
        seen.append((start, end, sc.current_reporting_timezone()))
        return 56

    monkeypatch.setattr(main, 'datetime', FixedClock)
    monkeypatch.setattr(main, 'get_shop_timezone', timezone)
    monkeypatch.setattr(main, 'count_orders_total_processed', count)
    request = main.OrdersTotalCountRequest(start='2026-10-04', end='2026-10-04', store='irranova', include_closed=True, timezone_mode='shop', date_preset='today')
    with sc.reporting_timezone_scope('Europe/London'):
        result = asyncio.run(main.api_orders_count_total(request))
        assert sc.current_reporting_timezone() == 'Europe/London'
    assert seen == [('2026-10-03', '2026-10-03', 'America/Los_Angeles')]
    assert result['data'] == {'count': 56, 'timezone': 'America/Los_Angeles', 'start': '2026-10-03', 'end': '2026-10-03'}
    main._API_CACHE.clear()


def test_summary_failure_has_no_count_or_cached_zero_and_retry_recovers(monkeypatch):
    from app import main
    main._API_CACHE.clear()
    main._API_INFLIGHT.clear()
    monkeypatch.setattr(main, 'get_shop_timezone', lambda *_, **__: 'UTC')
    attempts = []

    def count(*_, **__):
        attempts.append(1)
        if len(attempts) == 1:
            raise RuntimeError('temporary failure')
        return 0

    monkeypatch.setattr(main, 'count_orders_total_processed', count)
    request = main.OrdersTotalCountRequest(start='2026-10-04', end='2026-10-04', store='mmd')

    async def scenario():
        failed = await main.api_orders_count_total(request)
        assert failed['error'] == 'temporary failure'
        assert failed['data']['count'] is None
        assert main._API_CACHE == {}
        result = await main.api_orders_count_total(request)
        assert result['data']['count'] == 0
        assert 'error' not in result

    asyncio.run(scenario())
    main._API_CACHE.clear()
    main._API_INFLIGHT.clear()


def test_strict_shop_timezone_does_not_silently_count_in_utc(monkeypatch):
    monkeypatch.setattr(sc, '_rest_get_store', lambda *_: {})
    with sc.reporting_timezone_scope(None), pytest.raises(RuntimeError, match='timezone'):
        sc.get_shop_timezone('irrakids', strict=True)
