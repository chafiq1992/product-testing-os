"""The vendor bridge respects both the PTO gate and Sendo's separate session."""

import json
from unittest.mock import MagicMock
from urllib.parse import quote

import pytest
import requests
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import auth_gate, sendo_wholesale


PREFIX = "/api/wholesale/sendo"
CUSTOMER_ID = "5ff7fe18-7919-4ea7-8cf6-341a32a77471"


@pytest.fixture
def bridge(monkeypatch):
    upstream = MagicMock(spec=requests.Session)
    upstream.__enter__.return_value = upstream
    monkeypatch.setattr(sendo_wholesale.requests, "Session", lambda: upstream)
    monkeypatch.setenv("SENDO_WHOLESALE_API_ORIGIN", "https://sendo.example.test/")
    monkeypatch.setenv("PTO_AUTH_GATE", "on")

    app = FastAPI()
    app.add_middleware(auth_gate.AuthGateMiddleware)
    app.include_router(sendo_wholesale.router)
    with TestClient(app, follow_redirects=False) as client:
        yield client, upstream.request


def remote(status, body, **headers):
    response = requests.Response()
    response.status_code = status
    response.headers["Content-Type"] = "application/json"
    response.headers.update(headers)
    response._content = json.dumps(body).encode()
    return response


def test_login_reaches_sendo_without_existing_operator_session(bridge):
    client, call = bridge
    call.return_value = remote(201, {"token": "vendor-session"}, **{"Set-Cookie": "upstream=private"})
    result = client.post(
        PREFIX + "/session",
        json={"access_code": "sample-code"},
        headers={"Cookie": "ptos_auth=private", "Authorization": "Bearer unrelated"},
    )
    assert (result.status_code, result.json()) == (201, {"token": "vendor-session"})
    assert "set-cookie" not in result.headers
    assert result.headers["cache-control"] == "no-store"
    method, url = call.call_args.args
    assert (method, url) == ("POST", "https://sendo.example.test/integrations/wholesale/session")
    assert json.loads(call.call_args.kwargs["data"]) == {"access_code": "sample-code"}
    assert call.call_args.kwargs["headers"] == {"Accept": "application/json", "Content-Type": "application/json"}
    assert call.call_args.kwargs["allow_redirects"] is False


def test_vendor_bearer_report_and_search_use_fixed_path(bridge):
    client, call = bridge
    call.return_value = remote(200, {"items": [], "has_more": False})

    assert client.get(PREFIX + "/customers", headers={"Cookie": "ptos_vendor=private"}).status_code == 401
    call.assert_not_called()

    search = quote("اسم العميل")
    result = client.get(
        PREFIX + "/customers",
        params={"offset": 20, "limit": 10, "q": "ignored", "merchant_id": 570},
        headers={
            "X-Wholesale-Search": search,
            "Authorization": "Bearer vendor-session",
            "X-Admin-Token": "private",
        },
    )
    assert result.status_code == 200
    assert call.call_args.args == ("GET", "https://sendo.example.test/integrations/wholesale/customers")
    assert call.call_args.kwargs["params"] == [("offset", "20"), ("limit", "10")]
    assert call.call_args.kwargs["headers"] == {
        "Accept": "application/json",
        "Authorization": "Bearer vendor-session",
        "X-Wholesale-Search": search,
    }


def test_edit_paths_keep_existing_operator_gate_and_forward_only_expected_ids(bridge):
    client, call = bridge
    call.return_value = remote(403, {"detail": "Vendor access disabled"})
    headers = {"Authorization": "Bearer vendor-session"}
    assert client.get("/api/wholesale/vendors", headers=headers).status_code == 401
    assert client.get(PREFIX + "/debug", headers=headers).status_code == 401
    assert client.put(PREFIX + "/customers/17", headers=headers, json={}).status_code == 401
    call.assert_not_called()

    result = client.put(PREFIX + "/customers/" + CUSTOMER_ID, headers=headers, json={"name": "Sample"})
    assert result.status_code == 403
    assert result.json() == {"detail": "Vendor access disabled"}
    assert call.call_args.args == ("PUT", "https://sendo.example.test/integrations/wholesale/customers/" + CUSTOMER_ID)


@pytest.mark.parametrize("response", [
    remote(307, {}, Location="https://other.example.test/"),
    remote(200, {}, **{"Content-Type": "text/html"}),
])
def test_bridge_does_not_follow_or_return_unexpected_upstream_responses(bridge, response):
    client, call = bridge
    call.return_value = response
    result = client.get(PREFIX + "/orders", headers={"Authorization": "Bearer vendor-session"})
    assert result.status_code == 502
    assert "location" not in result.headers
    assert result.headers["cache-control"] == "no-store"
    call.assert_called_once()
