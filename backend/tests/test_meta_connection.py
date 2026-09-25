import time
import pytest

from app import meta_connection
from app.integrations import meta_client


def test_meta_state_rejects_tampering_and_expiry(monkeypatch):
    monkeypatch.setenv("OAUTH_STATE_SECRET", "test-secret")
    valid = meta_connection._encode_state({"store": "irrakids", "exp": int(time.time()) + 60})
    assert meta_connection._decode_state(valid)["store"] == "irrakids"
    assert meta_connection._decode_state(valid + "x") is None
    expired = meta_connection._encode_state({"store": "irrakids", "exp": int(time.time()) - 1})
    assert meta_connection._decode_state(expired) is None


def test_connected_meta_token_reaches_parallel_campaign_reads(monkeypatch):
    seen = []

    def fake_edge(path, params=None, *, max_pages=100):
        seen.append((path, meta_client._active_token()))
        return []

    monkeypatch.setattr(meta_client, "_list_graph_edge_all", fake_edge)
    with meta_client.meta_access_token_scope("connected-token"):
        assert meta_client.list_active_campaigns_with_insights(ad_account_id="123") == []
    assert {path for path, _ in seen} == {"act_123/insights", "act_123/campaigns"}
    assert all(token == "connected-token" for _, token in seen)


def test_business_accounts_keep_business_label_when_direct_account_is_duplicated(monkeypatch):
    def fake_edge(path, params=None, *, max_pages=20):
        return {
            "me/adaccounts": [{"id": "act_123", "name": "Store ads", "account_status": 1}],
            "me/businesses": [{"id": "bm_1", "name": "Store Business"}],
            "bm_1/owned_ad_accounts": [{"id": "123", "name": "Store ads"}],
            "bm_1/client_ad_accounts": [{"id": "act_456", "name": "Client ads"}],
        }.get(path, [])

    monkeypatch.setattr(meta_client, "_list_graph_edge_all", fake_edge)
    rows = meta_client.list_ad_accounts(access_token="connected-token")
    assert len(rows) == 2
    assert {row["id"] for row in rows} == {"act_123", "act_456"}
    assert all(row["business_id"] == "bm_1" and row["business_name"] == "Store Business" for row in rows)


def test_meta_callback_saves_accounts_and_rejects_replay(monkeypatch):
    monkeypatch.setenv("OAUTH_STATE_SECRET", "test-secret")
    monkeypatch.setenv("META_APP_ID", "app-id")
    monkeypatch.setenv("META_APP_SECRET", "app-secret")
    monkeypatch.setenv("BASE_URL", "https://api.example.com")
    settings = {}
    monkeypatch.setattr(meta_connection.db, "get_app_setting", lambda store, key: settings.get((store, key)))
    monkeypatch.setattr(meta_connection.db, "set_app_setting", lambda store, key, value: settings.__setitem__((store, key), value))
    monkeypatch.setattr(meta_connection, "list_ad_accounts", lambda access_token=None: [{"id": "act_123", "name": "Test ads"}])

    class Response:
        def __init__(self, payload):
            self.payload = payload

        def raise_for_status(self):
            pass

        def json(self):
            return self.payload

    def fake_get(url, params, timeout):
        if params.get("grant_type") == "fb_exchange_token":
            return Response({"access_token": "long-token", "expires_in": 3600})
        if url.endswith("/me"):
            return Response({"id": "user-id", "name": "Test user"})
        return Response({"access_token": "short-token"})

    monkeypatch.setattr(meta_connection.requests, "get", fake_get)
    nonce = "test-nonce"
    settings[(None, f"meta_oauth_nonce:{nonce}")] = {"store": "irrakids", "exp": int(time.time()) + 60}
    state = meta_connection._encode_state({"store": "irrakids", "nonce": nonce, "exp": int(time.time()) + 60, "return_origin": "https://app.example.com"})
    result = meta_connection.callback(code="code", state=state)
    assert result.status_code == 302
    assert result.headers["location"].startswith("https://app.example.com/settings/connections?")
    assert meta_connection.connected_token("irrakids", "123") == "long-token"
    assert meta_connection.connected_token("irrakids", "999") is None
    assert "access_token" not in meta_connection._public_record("irrakids")
    assert meta_connection.callback(code="code", state=state) == {"error": "state_already_used_or_expired"}


def test_connected_store_never_falls_back_to_global_token(monkeypatch):
    record = {"access_token": "connected-token", "accounts": [{"id": "act_123"}], "expires_at": int(time.time()) - 1}
    monkeypatch.setattr(meta_connection.db, "get_app_setting", lambda store, key: record)
    with pytest.raises(ValueError, match="expired"):
        meta_connection.reporting_token("irrakids", "123")
    record["expires_at"] = int(time.time()) + 60
    with pytest.raises(ValueError, match="not connected"):
        meta_connection.reporting_token("irrakids", "999")
