import json
from concurrent.futures import ThreadPoolExecutor
from contextvars import copy_context
from threading import Event

import pytest
import requests
from tenacity import wait_none

from app.integrations import meta_client as meta
from app.tenant_context import workspace_scope


@pytest.fixture(autouse=True)
def isolated_meta_state(monkeypatch):
    monkeypatch.setattr(meta, "ACCESS", "detail-test-token")
    with meta._DETAIL_LOCK:
        meta._DETAIL_CACHE.clear()
        meta._DETAIL_INFLIGHT.clear()
        meta._META_COOLDOWNS.clear()
    yield
    with meta._DETAIL_LOCK:
        meta._DETAIL_CACHE.clear()
        meta._DETAIL_INFLIGHT.clear()
        meta._META_COOLDOWNS.clear()


def paged(rows, cursor=None):
    result = {"data": rows}
    if cursor:
        result["paging"] = {"next": "https://graph.facebook.com/next?access_token=secret", "cursors": {"after": cursor}}
    return result


def response(status, error, headers=None):
    result = requests.Response()
    result.status_code = status
    result._content = json.dumps({"error": error}).encode()
    result.headers.update(headers or {})
    return result


def test_campaign_insights_uses_two_paginated_edges_and_preserves_zero_spend(monkeypatch):
    calls = []
    def get(path, params):
        calls.append((path, dict(params), meta._active_token()))
        if path == "123/adsets":
            if not params.get("after"):
                return paged([{"id": "1", "name": "One", "effective_status": "active"}], "metadata")
            return paged([{"id": "2", "name": "Two", "configured_status": "paused"}, {"id": "3", "name": "Unspent", "effective_status": "ACTIVE"}])
        assert path == "123/insights"
        assert params["level"] == "adset"
        assert params["fields"] == "adset_id,spend,actions,ctr,cpp"
        assert json.loads(params["time_range"]) == {"since": "2026-10-01", "until": "2026-10-14"}
        if not params.get("after"):
            return paged([{"adset_id": "1", "spend": "12.345", "ctr": "1.23456", "actions": [{"action_type": "purchase", "value": "2"}, {"action_type": "add_to_cart", "value": "3"}]}], "insights")
        return paged([{"adset_id": "2", "spend": "5", "cpp": "2.221"}])
    monkeypatch.setattr(meta, "_get", get)
    with meta.meta_access_token_scope("scoped-token"):
        rows = meta.list_adsets_with_insights("123", since="2026-10-01", until="2026-10-14")
        # UTM metadata shares the same successful read, even when consumers mutate it.
        rows[0]["name"] = "Changed by caller"
        metadata = meta.list_campaign_adsets("123")
    assert len(calls) == 4
    assert all(token == "scoped-token" for _, _, token in calls)
    assert metadata[0]["name"] == "One"
    assert rows[0]["spend"] == 12.35 and rows[0]["cpp"] == 6.17
    assert rows[0]["ctr"] == 1.235 and rows[0]["purchases"] == 2 and rows[0]["add_to_cart"] == 3
    assert rows[1]["status"] == "PAUSED" and rows[1]["cpp"] == 2.22
    assert rows[2]["spend"] == 0 and rows[2]["purchases"] == 0 and rows[2]["cpp"] is None


def test_campaign_ads_paginate_once_and_cache_without_duplicates(monkeypatch):
    calls = []
    def get(path, params):
        calls.append((path, params))
        assert path == "123/ads" and params["fields"] == "id,adset_id"
        if not params.get("after"):
            return paged([{"id": "11", "adset_id": "1"}], "more")
        return paged([{"id": "11", "adset_id": "1"}, {"id": "12", "adset_id": "1"}, {"id": "22", "adset_id": "2"}])
    monkeypatch.setattr(meta, "_get", get)
    first = meta.list_campaign_ads_by_adset("123")
    first["1"].append("caller-only")
    assert meta.list_campaign_ads_by_adset("123") == {"1": ["11", "12"], "2": ["22"]}
    assert len(calls) == 2


@pytest.mark.parametrize("loader", [meta.list_campaign_adsets, meta.list_campaign_ads_by_adset])
def test_concurrent_identical_reads_share_one_request(monkeypatch, loader):
    started, release = Event(), Event()
    calls = []
    def get(path, params):
        calls.append(meta._active_token())
        started.set()
        assert release.wait(5)
        return paged([{"id": "1", "adset_id": "a", "name": "Shared"}])
    monkeypatch.setattr(meta, "_get", get)
    with meta.meta_access_token_scope("concurrent-token"), ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(copy_context().run, loader, "123")
        assert started.wait(5)
        second = pool.submit(copy_context().run, loader, "123")
        release.set()
        assert first.result(timeout=5) == second.result(timeout=5)
    assert calls == ["concurrent-token"]


def test_failed_coalesced_read_releases_waiters_and_can_retry(monkeypatch):
    started, release, waiter_started = Event(), Event(), Event()
    calls = []
    error = meta.MetaAPIError("Permission denied")
    def get(path, params):
        calls.append(path)
        if len(calls) == 1:
            started.set()
            assert release.wait(5)
            raise error
        return paged([{"id": "1"}])
    monkeypatch.setattr(meta, "_get", get)
    original_result = meta.Future.result
    def wait_result(self, *args, **kwargs):
        waiter_started.set()
        return original_result(self, *args, **kwargs)
    monkeypatch.setattr(meta.Future, "result", wait_result)
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(meta.list_campaign_adsets, "123")
        assert started.wait(5)
        second = pool.submit(meta.list_campaign_adsets, "123")
        assert waiter_started.wait(5)
        release.set()
        for future in (first, second):
            with pytest.raises(meta.MetaAPIError) as caught:
                future.result(timeout=5)
            assert caught.value is error
    assert calls == ["123/adsets"]
    assert not meta._DETAIL_CACHE and not meta._DETAIL_INFLIGHT
    assert meta.list_campaign_adsets("123")[0]["adset_id"] == "1"


def test_failed_insights_page_cannot_return_partial_or_false_zero_metrics(monkeypatch):
    calls = []
    def get(path, params):
        calls.append(path)
        if path.endswith("/adsets"):
            return paged([{"id": "1", "effective_status": "ACTIVE"}])
        if not params.get("after"):
            return paged([{"adset_id": "1", "spend": "5"}], "more")
        raise meta.MetaAPIError("Second page unavailable", retryable=True)
    monkeypatch.setattr(meta, "_get", get)
    with pytest.raises(meta.MetaAPIError, match="Second page unavailable"):
        meta.list_adsets_with_insights("123")
    assert len(calls) == 3


@pytest.mark.parametrize("bad", [{}, {"data": None}, {"data": [None]}, {"data": [], "paging": {"next": "https://graph.facebook.com/next"}}])
def test_invalid_pages_are_not_cached_as_success(monkeypatch, bad):
    monkeypatch.setattr(meta, "_get", lambda *_: bad)
    with pytest.raises(meta.MetaAPIError):
        meta.list_campaign_adsets("123")
    assert not meta._DETAIL_CACHE and not meta._DETAIL_INFLIGHT


def test_token_workspace_and_api_version_isolation(monkeypatch):
    calls = []
    def get(path, params):
        calls.append((meta._active_token(), meta.current_workspace(), meta.BASE))
        return paged([{"id": str(len(calls))}])
    monkeypatch.setattr(meta, "_get", get)
    identities = []
    for token, workspace in [("a", "one"), ("b", "one"), ("a", "two"), ("a", "one")]:
        with meta.meta_access_token_scope(token), workspace_scope(workspace):
            identities.append(meta.meta_cache_identity())
            meta.list_campaign_adsets("123")
    assert len(calls) == 3 and identities[0] == identities[3]
    assert len(set(identities)) == 3 and all("secret" not in key for key in identities)
    monkeypatch.setattr(meta, "BASE", "https://graph.facebook.com/v99.0")
    with meta.meta_access_token_scope("a"), workspace_scope("one"):
        assert meta.meta_cache_identity() not in identities
        meta.list_campaign_adsets("123")
    assert len(calls) == 4


@pytest.mark.parametrize("setter", [meta.set_campaign_status, meta.set_adset_status])
def test_confirmed_status_write_invalidates_shared_metadata(monkeypatch, setter):
    calls = []
    monkeypatch.setattr(meta, "_get", lambda path, *_: calls.append(path) or paged([{"id": "1", "adset_id": "a", "effective_status": "ACTIVE"}]))
    monkeypatch.setattr(meta, "_post", lambda *_: {"success": True})
    meta.list_campaign_adsets("123")
    meta.list_campaign_ads_by_adset("123")
    setter("123" if setter is meta.set_campaign_status else "1", "PAUSED")
    meta.list_campaign_adsets("123")
    meta.list_campaign_ads_by_adset("123")
    assert calls == ["123/adsets", "123/ads", "123/adsets", "123/ads"]


@pytest.mark.parametrize("loader", [meta.list_campaign_adsets, meta.list_campaign_ads_by_adset, meta.list_adsets_with_insights])
def test_missing_identifiers_cannot_become_false_empty_success(monkeypatch, loader):
    def get(path, params):
        if loader is meta.list_adsets_with_insights and path.endswith("/adsets"):
            return paged([{"id": "1", "effective_status": "ACTIVE"}])
        return paged([{"name": "No identifier", "spend": "9"}])
    monkeypatch.setattr(meta, "_get", get)
    with pytest.raises(meta.MetaAPIError, match="without their"):
        loader("123")


def test_detail_cache_is_bounded_and_expires(monkeypatch):
    clock = [100.0]
    calls = []
    monkeypatch.setattr(meta.time, "monotonic", lambda: clock[0])
    monkeypatch.setattr(meta, "_DETAIL_CACHE_LIMIT", 2)
    monkeypatch.setattr(meta, "_get", lambda path, *_: calls.append(path) or paged([{"id": "1"}]))
    for campaign in ("a", "b", "c", "a"):
        meta.list_campaign_adsets(campaign)
    assert len(meta._DETAIL_CACHE) == 2 and len(calls) == 4
    clock[0] += meta._DETAIL_CACHE_TTL + 1
    meta.list_campaign_adsets("a")
    assert len(calls) == 5


def test_invalidation_during_read_prevents_stale_cache_repopulation(monkeypatch):
    started, release = Event(), Event()
    calls = []
    def get(path, params):
        calls.append(path)
        if len(calls) == 1:
            started.set()
            assert release.wait(5)
            return paged([{"id": "1", "effective_status": "ACTIVE"}])
        return paged([{"id": "1", "effective_status": "PAUSED"}])
    monkeypatch.setattr(meta, "_get", get)
    monkeypatch.setattr(meta, "_post", lambda *_: {"success": True})
    with ThreadPoolExecutor(max_workers=1) as pool:
        pending = pool.submit(meta.list_campaign_adsets, "123")
        assert started.wait(5)
        meta.set_campaign_status("123", "PAUSED")
        release.set()
        assert pending.result(timeout=5)[0]["status"] == "ACTIVE"
    assert not meta._DETAIL_CACHE
    assert meta.list_campaign_adsets("123")[0]["status"] == "PAUSED"
    assert len(calls) == 2


def test_failed_status_write_keeps_successful_metadata(monkeypatch):
    calls = []
    monkeypatch.setattr(meta, "_get", lambda path, *_: calls.append(path) or paged([{"id": "1", "effective_status": "ACTIVE"}]))
    monkeypatch.setattr(meta, "_post", lambda *_: {"success": False})
    meta.list_campaign_adsets("123")
    with pytest.raises(RuntimeError, match="did not confirm"):
        meta.set_campaign_status("123", "PAUSED")
    assert meta.list_campaign_adsets("123")[0]["status"] == "ACTIVE"
    assert calls == ["123/adsets"]


@pytest.mark.parametrize("status,error", [(400, {"code": 17, "error_subcode": 2446079}), (429, {}), (400, {"code": 4}), (400, {"code": 80004})])
def test_rate_limit_sanitizes_error_and_stops_repeated_click_requests(monkeypatch, status, error):
    calls = []
    provider = response(status, {**error, "message": "secret-token provider message", "is_transient": True}, {"Retry-After": "120"})
    monkeypatch.setattr(meta, "_timed_meta_request", lambda *_, **__: calls.append(1) or provider)
    with meta.meta_access_token_scope("secret-token"):
        for _ in range(3):
            with pytest.raises(meta.MetaRateLimitError) as caught:
                meta.list_campaign_adsets("123")
            assert caught.value.retryable is False and caught.value.retry_after >= 119
            assert "secret-token" not in str(caught.value) and "graph.facebook" not in str(caught.value)
    assert calls == [1]
    assert not meta._DETAIL_CACHE


def test_cooldown_is_scoped_expires_and_honors_minimum_wait(monkeypatch):
    clock = [100.0]
    calls = []
    monkeypatch.setattr(meta.time, "monotonic", lambda: clock[0])
    def request(*args, **kwargs):
        calls.append((meta._active_token(), meta.current_workspace()))
        if len(calls) == 1:
            return response(400, {"code": 17}, {"Retry-After": "2"})
        result = requests.Response()
        result.status_code = 200
        result._content = b'{"data": []}'
        return result
    monkeypatch.setattr(meta, "_timed_meta_request", request)
    with meta.meta_access_token_scope("a"), workspace_scope("one"):
        with pytest.raises(meta.MetaRateLimitError) as caught:
            meta._get("123/adsets")
        assert caught.value.retry_after == 60
        with pytest.raises(meta.MetaRateLimitError):
            meta._get("456/adsets")
    for token, workspace in [("b", "one"), ("a", "two")]:
        with meta.meta_access_token_scope(token), workspace_scope(workspace):
            assert meta._get("123/adsets") == {"data": []}
    clock[0] += 61
    with meta.meta_access_token_scope("a"), workspace_scope("one"):
        assert meta._get("123/adsets") == {"data": []}
    assert len(calls) == 4


@pytest.mark.parametrize("error,expected_calls", [(meta.MetaRateLimitError(60), 1), (meta.MetaAPIError("Permission denied"), 1), (meta.MetaAPIError("Temporary failure", retryable=True), 3), (requests.Timeout("Timeout"), 3)])
def test_existing_read_retry_policy_skips_quota_and_permanent_errors(monkeypatch, error, expected_calls):
    calls = []
    def get(*args, **kwargs):
        calls.append(1)
        raise error
    monkeypatch.setattr(meta, "_get", get)
    with pytest.raises(type(error)) as caught:
        meta.get_ad_account_info.retry_with(wait=wait_none())("123")
    assert caught.value is error and len(calls) == expected_calls
