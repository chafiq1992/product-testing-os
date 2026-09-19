from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest

from app.social_agent import repository as repo, service
from app.social_agent import shopify_transport as transport


def plan(store, day, index=0, count=2):
    config = repo.get_config(store)
    scheduled = service._rolling_groups(config, day)[index][:count]
    return repo.create_run(store, service._rolling_batch_key(store, day, index), "rolling", count,
                           {"local_date": day.isoformat(), "products": [{"id": "one"}] * count,
                            "scheduled_for": [service._utc_naive(value).isoformat() + "Z" for value in scheduled]})


def test_start_rebases_pending_preserves_published_and_next_day():
    store = "start_" + uuid4().hex
    config = repo.save_config(store, {"enabled": True, "batch_size": 2})
    day = datetime.now(service._tz(config)).date()
    run = plan(store, day)
    old = service._planned_utc(run["context"], 0)
    published = repo.create_post(run_id=run["id"], store=store, slot="rolling", position=0,
                                 scheduled_for=old, product={"id": "one"}, status="published")
    pending = repo.create_post(run_id=run["id"], store=store, slot="rolling", position=1,
                               scheduled_for=old, product={"id": "two"}, status="approved")
    later = plan(store, day, 1)
    tomorrow = service._rolling_groups(config, day + timedelta(days=1))
    now = old + timedelta(hours=5)
    changed = repo.start_run_now(run["id"], day.isoformat(), now, 30)
    assert repo.get_post(published["id"])["scheduled_for"] == old.isoformat() + "Z"
    assert repo.get_post(pending["id"])["scheduled_for"] == now.isoformat() + "Z"
    assert repo.start_run_now(run["id"], day.isoformat(), now + timedelta(hours=1), 30) == changed
    effective = service._effective_rolling_groups(store, config, day)
    assert service._utc_naive(effective[1][0]) > now
    assert repo.get_run(later["id"])["context"]["scheduled_for"][0] == service._utc_naive(effective[1][0]).isoformat() + "Z"
    assert service._effective_rolling_groups(store, config, day + timedelta(days=1)) == tomorrow
    assert repo.get_config(store) == config


def test_start_now_repeated_click_does_not_repeat_generation(monkeypatch):
    store = "start_" + uuid4().hex
    config = repo.save_config(store, {"enabled": True})
    day = datetime.now(service._tz(config)).date()
    run = plan(store, day)
    calls = []
    monkeypatch.setattr(service, "prepare_one", lambda run_id: calls.append(run_id))
    result = service.start_now(store)
    again = service.start_now(store)
    assert result["run"]["id"] == again["run"]["id"] == run["id"]
    assert again["already_started"] is True
    assert calls == [run["id"]]


def test_start_now_off_blocks_catalog(monkeypatch):
    monkeypatch.setattr(service, "catalog_preview", lambda *args, **kwargs: pytest.fail("must not fetch catalog"))
    with pytest.raises(RuntimeError, match="OFF"):
        service.start_now("off_" + uuid4().hex)


def test_start_now_does_not_interrupt_generation():
    store = "start_" + uuid4().hex
    run = plan(store, datetime.now().date())
    repo.update_run(run["id"], status="preparing")
    with pytest.raises(RuntimeError, match="already generating"):
        repo.start_run_now(run["id"], datetime.now().date().isoformat(), datetime.now(), 30)
    assert not repo.get_run(run["id"])["context"].get("start_now_at")


class Response:
    def __init__(self, payload, status=200, headers=None):
        self.payload, self.status_code, self.headers = payload, status, headers or {}
    def json(self):
        return self.payload
    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError("HTTP error")


@pytest.fixture
def wire(monkeypatch):
    monkeypatch.setattr(transport, "_get_store_config", lambda store: {"TOKEN": "fake", "GQL": "https://shop.invalid/graphql", "HEADERS": {}})
    sleeps = []
    monkeypatch.setattr(transport.time, "sleep", sleeps.append)
    def run(responses):
        calls = []
        def request(*args, **kwargs):
            calls.append(kwargs["json"])
            return responses[min(len(calls)-1, len(responses)-1)]
        monkeypatch.setattr(transport, "_timed_request", request)
        return calls
    return run, sleeps


def throttled():
    return {"errors": [{"message": "Throttled", "extensions": {"code": "THROTTLED"}}],
            "extensions": {"cost": {"requestedQueryCost": 500, "throttleStatus": {
                "maximumAvailable": 1000, "currentlyAvailable": 50, "restoreRate": 100}}}}


def test_throttle_200_waits_for_capacity_and_retries_same_page(wire):
    setup, sleeps = wire
    calls = setup([Response(throttled()), Response({"data": {"products": [1]}})])
    assert transport._gql_store("store", "query", {"after": "cursor"}) == {"products": [1]}
    assert sleeps == [4.75]
    assert calls[0] == calls[1]


def test_throttle_429_respects_retry_after(wire):
    setup, sleeps = wire
    setup([Response({}, 429, {"Retry-After": "7"}), Response({"data": {}})])
    transport._gql_store("store", "mutation", {})
    assert sleeps == [7]


def test_throttle_exhaustion_is_bounded(wire):
    setup, sleeps = wire
    calls = setup([Response(throttled())])
    with pytest.raises(RuntimeError, match="temporarily rate-limited"):
        transport._gql_store("store", "query", {})
    assert len(calls) == 6 and sum(sleeps) <= 60


def test_partial_mutation_and_non_throttle_errors_are_not_replayed(wire):
    setup, sleeps = wire
    payload = throttled()
    payload["data"] = {"fileCreate": {"id": "already-created"}}
    calls = setup([Response(payload)])
    with pytest.raises(RuntimeError, match="GraphQL errors"):
        transport._gql_store("store", "mutation", {})
    assert len(calls) == 1 and not sleeps
    calls = setup([Response({"errors": [{"message": "Access denied"}]})])
    with pytest.raises(RuntimeError, match="Access denied"):
        transport._gql_store("store", "query", {})
    assert len(calls) == 1


def test_scheduler_continues_overnight_batches(monkeypatch):
    from zoneinfo import ZoneInfo
    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            value = datetime(2026, 9, 12, 0, 10, tzinfo=ZoneInfo("Africa/Casablanca"))
            return value.astimezone(tz) if tz else value.replace(tzinfo=None)
    store = "night_" + uuid4().hex
    repo.save_config(store, {"enabled": True, "batch_size": 2, "posting_window_start": "23:00", "posting_window_end": "01:00"})
    monkeypatch.setattr(service, "datetime", Clock)
    queued = []
    monkeypatch.setattr(service, "queue_rolling_batch", lambda store, day, index: queued.append((day.isoformat(), index)))
    monkeypatch.setattr(service, "prepare_next", lambda store: None)
    monkeypatch.setattr(service, "publish_due", lambda *args, **kwargs: [])
    service.scheduler_tick(store)
    assert queued == [("2026-09-11", 1), ("2026-09-11", 2)]


def test_start_now_after_window_begins_today_not_tomorrow(monkeypatch):
    from zoneinfo import ZoneInfo
    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            value = datetime(2026, 9, 12, 23, 0, tzinfo=ZoneInfo("Africa/Casablanca"))
            return value.astimezone(tz) if tz else value.replace(tzinfo=None)
    store = "late_" + uuid4().hex
    config = repo.save_config(store, {"enabled": True, "posting_window_start": "10:00", "posting_window_end": "12:00", "batch_size": 2})
    monkeypatch.setattr(service, "datetime", Clock)
    monkeypatch.setattr(service, "catalog_preview", lambda *args, **kwargs: {"products": [{"id": str(i)} for i in range(10)]})
    monkeypatch.setattr(service, "prepare_one", lambda run_id: None)
    result = service.start_now(store)
    assert result["run"]["context"]["start_now_date"] == "2026-09-12"
    assert service._planned_utc(result["run"]["context"], 0) == service._utc_naive(Clock.now(service._tz(config)))
    assert repo.get_config(store)["posting_window_start"] == "10:00"


def test_start_endpoint_authenticates_and_dispatches(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from app.social_agent import routes
    app = FastAPI()
    app.include_router(routes.router)
    client = TestClient(app)
    monkeypatch.setattr(routes, "_get_admin", lambda request: None)
    assert client.post("/api/social-agent/start-now", json={"store": "one"}).status_code == 401
    monkeypatch.setattr(routes, "_get_admin", lambda request: {"email": "admin@example.test"})
    called = []
    monkeypatch.setattr(service, "start_now", lambda store: called.append(store) or {"run": {"id": "test-run"}})
    response = client.post("/api/social-agent/start-now", json={"store": "one"})
    assert response.status_code == 200 and response.json()["data"]["run"]["id"] == "test-run"
    assert called == ["one"]
