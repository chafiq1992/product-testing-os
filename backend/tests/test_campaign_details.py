import asyncio

import pytest

from app.integrations import meta_client, shopify_client


@pytest.fixture
def api(monkeypatch):
    from app import main
    main._API_CACHE.clear()
    main._API_INFLIGHT.clear()
    writes = []
    monkeypatch.setattr(main.db, "get_app_setting", lambda *_: None)
    monkeypatch.setattr(main.db, "set_app_setting", lambda *args: writes.append(args))
    monkeypatch.setattr(main, "reporting_token", lambda store, account=None: f"token-{store}")
    monkeypatch.setattr(main, "list_campaign_adsets", lambda *_: [{"adset_id": "222", "name": "Audience"}])
    monkeypatch.setattr(main, "list_campaign_ads_by_adset", lambda *_: {"222": ["333"]})
    monkeypatch.setattr(main, "list_orders_with_utms_processed", lambda *_, **__: [{"order_id": "1", "campaign_id": "111", "ad_id": "333"}])
    yield main, writes
    main._API_CACHE.clear()
    main._API_INFLIGHT.clear()


@pytest.mark.parametrize("provider", ["list_campaign_adsets", "list_campaign_ads_by_adset", "list_orders_with_utms_processed"])
def test_failed_provider_read_is_not_saved_as_empty_orders_and_can_retry(api, monkeypatch, provider):
    main, writes = api
    original = getattr(main, provider)
    calls = []

    def flaky(*args, **kwargs):
        calls.append(1)
        if len(calls) == 1:
            raise RuntimeError("temporary provider failure")
        return original(*args, **kwargs)

    monkeypatch.setattr(main, provider, flaky)

    async def scenario():
        failed = await main.api_campaign_adset_orders("111", "2026-10-01", "2026-10-04", store="irrakids")
        assert failed == {"error": "temporary provider failure", "data": {}}
        assert writes == []
        assert main._API_CACHE == {}
        loaded = await main.api_campaign_adset_orders("111", "2026-10-01", "2026-10-04", store="irrakids")
        assert loaded["data"]["222"]["count"] == 1
        assert len(writes) == 1
        assert await main.api_campaign_adset_orders("111", "2026-10-01", "2026-10-04", store="irrakids") == loaded
        assert len(calls) == 2

    asyncio.run(scenario())


def test_multistore_attribution_uses_campaign_connection_instead_of_first_store(api, monkeypatch):
    main, _ = api
    tokens = []
    monkeypatch.setattr(main, "list_campaign_adsets", lambda *_: tokens.append(meta_client._active_token()) or [{"adset_id": "222", "name": "Audience"}])
    monkeypatch.setattr(main, "list_campaign_ads_by_adset", lambda *_: tokens.append(meta_client._active_token()) or {"222": ["333"]})
    monkeypatch.setattr(main, "list_orders_with_utms_processed_multi", lambda *_, **__: [{"order_id": "1", "ad_id": "333", "store": "irranova"}])
    result = asyncio.run(main.api_campaign_adset_orders("111", "2026-10-01", "2026-10-04", stores="irrakids,irranova", meta_store="irranova"))
    assert result["data"]["222"]["count"] == 1
    assert tokens == ["token-irranova", "token-irranova"]


def test_one_failed_shopify_store_does_not_return_partial_multistore_totals(monkeypatch):
    def orders(*_, store, **__):
        if store == "irranova":
            raise RuntimeError("network failure")
        return [{"order_id": "1"}]
    monkeypatch.setattr(shopify_client, "list_orders_with_utms_processed", orders)
    with pytest.raises(RuntimeError, match="irranova"):
        shopify_client.list_orders_with_utms_processed_multi("2026-10-01", "2026-10-04", stores=["irrakids", "irranova"])


def test_adsets_and_ads_paginate_and_campaign_insights_keep_oauth_token(monkeypatch):
    seen = []

    def get(path, params=None):
        seen.append((path, meta_client._active_token()))
        if path == "111/adsets":
            if not (params or {}).get("after"):
                return {"data": [{"id": "222", "name": "First", "effective_status": "ACTIVE"}], "paging": {"next": "https://graph.facebook.com/next", "cursors": {"after": "more"}}}
            return {"data": [{"id": "444", "name": "Second", "effective_status": "PAUSED"}]}
        if path.endswith("/insights"):
            assert path == "111/insights" and params["level"] == "adset"
            return {"data": [{"adset_id": aid, "spend": "12", "actions": [{"action_type": "purchase", "value": "2"}]} for aid in ["222", "444"]]}
        if path.endswith("/ads"):
            if not (params or {}).get("after"):
                return {"data": [{"id": "333"}], "paging": {"next": "https://graph.facebook.com/next", "cursors": {"after": "more"}}}
            return {"data": [{"id": "555"}]}
        raise AssertionError(path)

    monkeypatch.setattr(meta_client, "_get", get)
    with meta_client.meta_access_token_scope("connected-token"):
        rows = meta_client.list_adsets_with_insights("111")
        ads = meta_client.list_ads_for_adsets(["222", "444"])
    assert [row["adset_id"] for row in rows] == ["222", "444"]
    assert all(row["spend"] == 12 and row["purchases"] == 2 for row in rows)
    assert ads == {"222": ["333", "555"], "444": ["333", "555"]}
    assert all(token == "connected-token" for _, token in seen)


def test_insights_and_ads_failure_are_not_empty_success(monkeypatch):
    monkeypatch.setattr(meta_client, "list_campaign_adsets", lambda *_: [{"adset_id": "222", "name": "Audience", "status": "ACTIVE"}])

    def fail(*_, **__):
        raise RuntimeError("provider unavailable")

    monkeypatch.setattr(meta_client, "_get", fail)
    with meta_client.meta_access_token_scope("connected-token"):
        with pytest.raises(RuntimeError, match="provider unavailable"):
            meta_client.list_adsets_with_insights("111")
        with pytest.raises(RuntimeError, match="provider unavailable"):
            meta_client.list_ads_for_adsets(["222"])


def test_detail_endpoint_cache_changes_with_token_and_workspace(api, monkeypatch):
    from app.tenant_context import workspace_scope
    main, _ = api
    token = ["first-token"]
    seen = []
    monkeypatch.setattr(main, "reporting_token", lambda *args: token[0])
    def insights(*args, **kwargs):
        seen.append(meta_client._active_token())
        return [{"adset_id": meta_client._active_token()}]
    monkeypatch.setattr(main, "list_adsets_with_insights", insights)
    async def scenario():
        assert (await main.api_get_campaign_adsets("111", store="irrakids"))["data"][0]["adset_id"] == "first-token"
        token[0] = "rotated-token"
        assert (await main.api_get_campaign_adsets("111", store="irrakids"))["data"][0]["adset_id"] == "rotated-token"
        with workspace_scope("merchant-a"):
            await main.api_get_campaign_adsets("111", store="irrakids")
        with workspace_scope("merchant-b"):
            await main.api_get_campaign_adsets("111", store="irrakids")
    asyncio.run(scenario())
    assert seen == ["first-token", "rotated-token", "rotated-token", "rotated-token"]


def test_attribution_checks_connection_before_persisted_cache_read(api, monkeypatch):
    main, _ = api
    reads = []
    monkeypatch.setattr(main.db, "get_app_setting", lambda *args: reads.append(args) or {"ts": 9999999999, "data": {"222": {"count": 99}}})
    def disconnected(*args):
        raise RuntimeError("Reconnect Meta")
    monkeypatch.setattr(main, "reporting_token", disconnected)
    result = asyncio.run(main.api_campaign_adset_orders("111", "2026-10-01", "2026-10-04", store="irrakids"))
    assert result == {"error": "Reconnect Meta", "data": {}} and reads == []


def test_detail_endpoints_expose_quota_cooldown_without_caching_empty_data(api, monkeypatch):
    main, writes = api
    error = meta_client.MetaRateLimitError(retry_after=120)
    def limited(*args, **kwargs):
        raise error
    monkeypatch.setattr(main, "list_adsets_with_insights", limited)
    monkeypatch.setattr(main, "list_campaign_adsets", limited)
    async def scenario():
        for response in [await main.api_get_campaign_adsets("111", store="irrakids"),
                         await main.api_campaign_adset_orders("111", "2026-10-01", "2026-10-04", store="irrakids")]:
            assert response["error_code"] == "meta_rate_limited" and response["retry_after"] == 120
            assert not response["data"]
    asyncio.run(scenario())
    assert not main._API_CACHE and not writes


def test_coalesced_cache_failure_reaches_all_callers_without_unhandled_future(api):
    main, _ = api
    async def scenario():
        unexpected = []
        loop = asyncio.get_running_loop()
        loop.set_exception_handler(lambda loop, context: unexpected.append(context))
        entered = asyncio.Event()
        release = asyncio.Event()
        async def compute():
            entered.set()
            await release.wait()
            raise RuntimeError("provider failed")
        first = asyncio.create_task(main._cached("failure-check", 60, compute))
        await entered.wait()
        second = asyncio.create_task(main._cached("failure-check", 60, compute))
        await asyncio.sleep(0)
        release.set()
        result = await asyncio.gather(first, second, return_exceptions=True)
        assert all(isinstance(error, RuntimeError) for error in result)
        assert "failure-check" not in main._API_CACHE
        assert not main._API_INFLIGHT and not unexpected
    asyncio.run(scenario())
