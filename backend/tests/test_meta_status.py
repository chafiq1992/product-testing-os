import asyncio
import json

import pytest
import requests
from tenacity import wait_none

from app import main
from app.integrations import meta_client


@pytest.mark.parametrize("setter", [meta_client.set_campaign_status, meta_client.set_adset_status])
def test_status_write_uses_scoped_token_and_requires_confirmation(monkeypatch, setter):
    calls = []
    monkeypatch.setattr(meta_client, "_post", lambda path, data: calls.append((path, data, meta_client._active_token())) or {"success": True})
    with meta_client.meta_access_token_scope("store-token"):
        assert setter("123", "PAUSED") == {"success": True}
    assert calls == [("123", {"status": "PAUSED"}, "store-token")]
    monkeypatch.setattr(meta_client, "_post", lambda *args: {"success": False})
    with meta_client.meta_access_token_scope("store-token"), pytest.raises(RuntimeError, match="did not confirm"):
        setter("123", "PAUSED")


@pytest.mark.parametrize("setter", [meta_client.set_campaign_status, meta_client.set_adset_status])
def test_permanent_status_error_is_not_retried_or_wrapped(monkeypatch, setter):
    calls = []
    def fail(*args):
        calls.append(args)
        raise meta_client.MetaAPIError("Missing ads_management permission")
    monkeypatch.setattr(meta_client, "_post", fail)
    with meta_client.meta_access_token_scope("store-token"), pytest.raises(meta_client.MetaAPIError, match="ads_management"):
        setter("123", "PAUSED")
    assert len(calls) == 1


@pytest.mark.parametrize("error", [requests.Timeout("Meta timed out"), meta_client.MetaAPIError("Meta temporarily unavailable", retryable=True)])
@pytest.mark.parametrize("setter", [meta_client.set_campaign_status, meta_client.set_adset_status])
def test_status_retries_transient_failure_then_exposes_original_error(monkeypatch, setter, error):
    calls = []
    def fail(*args):
        calls.append(args)
        raise error
    monkeypatch.setattr(meta_client, "_post", fail)
    fast = setter.retry_with(wait=wait_none())
    with meta_client.meta_access_token_scope("store-token"), pytest.raises(type(error)) as caught:
        fast("123", "PAUSED")
    assert caught.value is error
    assert len(calls) == 3
    calls.clear()
    def recover(*args):
        calls.append(args)
        if len(calls) == 1:
            raise error
        return {"success": True}
    monkeypatch.setattr(meta_client, "_post", recover)
    with meta_client.meta_access_token_scope("store-token"):
        assert fast("123", "PAUSED") == {"success": True}
    assert len(calls) == 2


@pytest.mark.parametrize("status,transient,expected", [(400, False, False), (400, True, True), (429, False, True), (503, False, True)])
def test_meta_error_classification_preserves_message_and_redacts_url(status, transient, expected):
    response = requests.Response()
    response.status_code = status
    response._content = json.dumps({"error": {"message": "Cannot update this campaign", "is_transient": transient, "code": 100}}).encode()
    error = meta_client._format_meta_error(response, "https://graph.facebook.com/v26.0/123?access_token=secret", "POST")
    assert error.retryable is expected
    assert "Cannot update this campaign" in str(error)
    assert "secret" not in str(error)


@pytest.mark.parametrize("endpoint,request_type,operation", [
    (main.api_update_campaign_status, main.CampaignStatusUpdateRequest, "set_campaign_status"),
    (main.api_update_adset_status, main.AdsetStatusUpdateRequest, "set_adset_status"),
])
def test_status_endpoint_uses_row_store_and_account_and_invalidates_on_success(monkeypatch, endpoint, request_type, operation):
    seen = []
    monkeypatch.setattr(main, "reporting_token", lambda store, account: seen.append((store, account)) or "row-token")
    monkeypatch.setattr(main, operation, lambda object_id, status: {"success": meta_client._active_token() == "row-token"})
    monkeypatch.setattr(main, "_invalidate_caches_for_status_change", lambda: seen.append("invalidated"))
    result = asyncio.run(endpoint("123", request_type(status="PAUSED", store="irranova", ad_account="456")))
    assert result == {"data": {"success": True}, "status": "PAUSED"}
    assert seen == [("irranova", "456"), "invalidated"]
    def fail(*args):
        raise RuntimeError("Token expired; reconnect Meta")
    monkeypatch.setattr(main, operation, fail)
    seen.clear()
    assert asyncio.run(endpoint("123", request_type(status="PAUSED", store="irranova", ad_account="456"))) == {"error": "Token expired; reconnect Meta"}
    assert "invalidated" not in seen
