import json
from contextlib import nullcontext
from datetime import date
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from app import ads_analyzer_data as data
from app import ads_analyzer_settings as config
from app import ads_analyzer_report as reports
from app import ads_analyzer_evidence as evidence


def test_default_range_is_exactly_seven_days_and_comparison_does_not_overlap():
    start, end = data.analysis_range(None, None)
    assert (date.fromisoformat(end) - date.fromisoformat(start)).days == 6
    assert data.preceding_range("2026-09-25", "2026-10-01") == ("2026-09-18", "2026-09-24")


@pytest.mark.parametrize("start,end", [("2026-10-01", None), ("2026-10-01", "2026-09-01"), ("2026-01-01", "2026-09-01"), ("bad", "2026-09-01")])
def test_invalid_ranges_fail_before_provider_calls(start, end):
    with pytest.raises(ValueError):
        data.analysis_range(start, end)


def test_aggregate_calculates_weighted_ratios_and_preserves_missing_values():
    result = data.aggregate([
        {"spend": 10, "impressions": 100, "clicks": 10, "link_clicks": 5, "purchases": 2, "revenue": None},
        {"spend": 90, "impressions": 900, "clicks": 9, "link_clicks": 9, "purchases": 3, "revenue": None},
    ])
    assert result["ctr"] == 1.9
    assert result["link_ctr"] == 1.4
    assert result["cpp"] == 20
    assert result["revenue"] is None and result["roas"] is None
    assert data.aggregate([])["spend"] is None


def test_fetch_window_reads_every_campaign_with_selected_dates(monkeypatch):
    calls = []
    def get(path, params):
        calls.append((path, params))
        if path.startswith("act_"):
            return {"currency": "USD"}
        if not path.endswith("insights"):
            return {"name": path, "account_id": "10"}
        if params.get("level") == "ad":
            return {"data": [{"ad_id": path[0], "spend": "12"}]}
        return {"data": [{"date_start": "2026-09-25", "spend": "10", "impressions": "100", "clicks": "4", "inline_link_clicks": "3", "actions": [{"action_type": "purchase", "value": "2"}]}]}
    monkeypatch.setattr(data.meta, "_get", get)
    result = data.fetch_window(["1", "2"], "2026-09-25", "2026-10-01")
    assert result["spend"] == 20 and result["purchases"] == 4
    assert len(result["campaigns"]) == 2 and len(result["daily"]) == 1
    assert result["campaigns"][1]["ad_insights"][0]["ad_id"] == "2"
    assert len([p for p, _ in calls if p == "act_10"]) == 1
    for path, params in calls:
        if path.endswith("insights"):
            assert json.loads(params["time_range"]) == {"since": "2026-09-25", "until": "2026-10-01"}


def test_primary_metrics_failure_is_not_reported_as_zero_spend(monkeypatch):
    monkeypatch.setattr(data.meta, "_get", Mock(side_effect=RuntimeError("Meta unavailable")))
    with pytest.raises(RuntimeError):
        data.fetch_window(["1"], "2026-09-25", "2026-10-01")


def test_settings_are_store_scoped_and_keys_never_enter_settings(monkeypatch):
    stored = {}
    monkeypatch.setattr(config.db, "get_app_setting", lambda store, key: stored.get((store, key)))
    monkeypatch.setattr(config.db, "set_app_setting", lambda store, key, value: stored.update({(store, key): value}))
    monkeypatch.setattr(config, "model_catalog", lambda: {"source": "openai", "models": [{"id": "gpt-6-astra"}, {"id": "gpt-6.1-sol"}]})
    settings = config.AnalyzerSettings(model="gpt-6-astra", reviewer_enabled=True)
    config.save_settings("nouralibas", settings)
    assert config.get_settings("irrakids").model == "gpt-6-astra"
    assert config.get_settings("irranova").model == "gpt-6.1-sol"
    with pytest.raises(ValueError):
        config.AnalyzerSettings.model_validate({"api_key": "forbidden"})
    with pytest.raises(ValueError):
        config.save_settings("irrakids", config.AnalyzerSettings(model="gpt-5-not-available"))


@pytest.mark.parametrize("value", [{"min_purchases": 0}, {"max_output_tokens": 100}, {"max_output_tokens": 33000}, {"min_spend": float("nan")}, {"instructions": "x" * 6001}, {"enabled": "true"}])
def test_invalid_settings_are_rejected(value):
    with pytest.raises(ValueError):
        config.AnalyzerSettings.model_validate(value)


def test_live_model_catalog_filters_specialized_models_and_redacts_failures(monkeypatch):
    config._model_cache.clear()
    sdk = Mock()
    sdk.models.list.return_value = [SimpleNamespace(id=id, created=i) for i, id in enumerate(["gpt-6.1-sol", "gpt-6-astra", "gpt-image-2", "gpt-5.3-codex", "text-embedding-3-small", "gpt-4o-audio-preview"])]
    monkeypatch.setattr(config, "get_client", lambda: sdk)
    catalog = config.model_catalog(True)
    assert {m["id"] for m in catalog["models"]} == {"gpt-6.1-sol", "gpt-6-astra"}
    sdk.models.list.side_effect = RuntimeError("secret sk-never-display")
    catalog = config.model_catalog(True)
    assert catalog["source"] == "documented"
    assert "sk-" not in catalog["error"] and all(not m["available"] for m in catalog["models"])
    config._model_cache.clear()



def test_rejected_openai_key_has_actionable_message_without_provider_secrets(monkeypatch):
    import httpx
    from openai import AuthenticationError
    config._model_cache.clear()
    sdk = Mock()
    sdk.models.list.side_effect = AuthenticationError("Rejected sk-private-value", response=httpx.Response(401, request=httpx.Request("GET", "https://api.openai.com/v1/models")), body={"error": {"code": "invalid_api_key"}})
    monkeypatch.setattr(config, "get_client", lambda: sdk)
    catalog = config.model_catalog(True)
    assert "401" in catalog["error"] and "Google Secret Manager" in catalog["error"]
    assert "sk-private-value" not in json.dumps(catalog)
    assert all(not model["available"] for model in catalog["models"])
    config._model_cache.clear()


def test_missing_openai_key_identifies_server_configuration(monkeypatch):
    config._model_cache.clear()
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("ADS_ANALYZER_OPENAI_SECRET_VERSION", raising=False)
    monkeypatch.setattr(config, "get_client", Mock(side_effect=RuntimeError("missing key")))
    assert "key is missing" in config.model_catalog(True)["error"]
    config._model_cache.clear()



class FakeResponseStream:
    def __init__(self, response):
        self.response = response

    def __iter__(self):
        event_type = "response." + self.response.status
        yield SimpleNamespace(type=event_type, response=self.response)

    def get_final_response(self):
        return self.response


def base_report():
    return {"overall_verdict": "scale", "product_signal": "potential_winner", "confidence_level": "high", "summary": "A promising campaign.",
            "warnings": [], "data_gaps": [], "funnel_stages": [{"stage": stage, "status": "unknown", "evidence": [], "hypothesis": "Unknown", "suggested_test": "Measure"} for stage in ["delivery", "hook", "creative", "ad_cta", "landing_page", "offer", "checkout", "fulfillment", "tracking"]],
            "visual_findings": [{"evidence_id": "landing-mobile", "area": "CTA", "observation": "Visible", "why_it_matters": "Clarity", "suggested_change": "Test"}],
            "recommendations": [], "scaling_plan": {"current_phase": "testing", "verdict": "Promising", "next_steps": [], "budget_recommendation": "Scale", "timeline": "7 days"},
            "creative_analysis": {"headline_score": None, "headline_feedback": "Unknown", "ad_copy_score": None, "ad_copy_feedback": "Unknown", "suggested_headlines": [], "suggested_ad_copy": "", "new_creative_examples": []},
            "landing_page_diagnosis": {"primary_issue": "insufficient_data", "confidence": "low", "evidence": [], "recommended_fixes": []},
            "customer_alignment": {"score": None, "gaps": [], "opportunities": []}}


def test_selected_model_schema_images_and_sample_safeguards(monkeypatch):
    sdk = Mock()
    sdk.with_options.return_value = sdk
    sdk.responses.stream.return_value = nullcontext(FakeResponseStream(SimpleNamespace(status="completed", output_text=json.dumps(base_report()))))
    monkeypatch.setattr(reports, "get_client", lambda: sdk)
    settings = config.AnalyzerSettings(model="gpt-6-astra", reasoning_effort="high", target_cpa=20.0, max_output_tokens=8000)
    result = reports.build_report(settings=settings, campaign_metrics={"spend": 100, "purchases": 2, "currency": "USD"}, ad_creatives=[], product_info={}, customer_profile={}, clarity_insights={}, previous_analysis_context=None, visual_evidence=[], image_data_urls=[])
    assert result["overall_verdict"] == "hold" and result["product_signal"] == "inconclusive"
    assert result["confidence_level"] == "low" and not result["visual_findings"]
    call = sdk.responses.stream.call_args.kwargs
    assert call["model"] == "gpt-6-astra" and call["reasoning"] == {"effort": "high"}
    assert call["store"] is False and call["text"]["format"]["strict"] is True
    assert call["max_output_tokens"] == 8000
    sdk.with_options.assert_called_once_with(timeout=600, max_retries=0)


def test_independent_reviewer_blocks_unsupported_winner(monkeypatch):
    sdk = Mock()
    sdk.with_options.return_value = sdk
    sdk.responses.stream.side_effect = [nullcontext(FakeResponseStream(SimpleNamespace(status="completed", output_text=json.dumps(value)))) for value in (base_report(), {"decision_supported": False, "summary": "Attribution is missing", "concerns": ["No confirmed margin"]})]
    monkeypatch.setattr(reports, "get_client", lambda: sdk)
    result = reports.build_report(settings=config.AnalyzerSettings(reviewer_enabled=True, reviewer_model="gpt-6-astra", target_cpa=20.0), campaign_metrics={"spend": 100, "purchases": 20, "currency": "USD"}, ad_creatives=[], product_info={}, customer_profile={}, clarity_insights={}, previous_analysis_context=None, visual_evidence=[], image_data_urls=[])
    assert sdk.responses.stream.call_args.kwargs["model"] == "gpt-6-astra"
    assert result["overall_verdict"] == "hold" and result["product_signal"] == "inconclusive"
    assert result["review"]["decision_supported"] is False


def test_incomplete_response_never_becomes_a_saved_report(monkeypatch):
    sdk = Mock()
    sdk.with_options.return_value = sdk
    sdk.responses.stream.return_value = nullcontext(FakeResponseStream(SimpleNamespace(status="incomplete", output_text='{}')))
    monkeypatch.setattr(reports, "get_client", lambda: sdk)
    with pytest.raises(RuntimeError, match="incomplete analysis"):
        reports.structured_response(reports.AdsReport, instructions="test", content=[], model="gpt-6.1-sol", settings=config.AnalyzerSettings())


@pytest.mark.parametrize("url", ["http://public.example", "https://127.0.0.1", "https://169.254.169.254", "https://user:pass@example.com", "https://example.com:8080"])
def test_screenshots_block_private_or_unsafe_destinations(monkeypatch, url):
    monkeypatch.setattr(evidence.socket, "getaddrinfo", lambda *a, **k: [(None, None, None, None, ("127.0.0.1", 443))])
    assert not evidence.public_url(url)


def test_screenshot_failure_returns_explicit_evidence_gap():
    evidence_rows, images = evidence.capture_landing_page([])
    assert not images and evidence_rows[0]["status"] == "unavailable"


@pytest.mark.parametrize("failed_view", [None, "landing-mobile", "landing-buying"])
def test_capture_preserves_independent_views_and_avoids_hidden_forms(monkeypatch, failed_view):
    import playwright.sync_api
    page = Mock()
    page.url = "https://public.example/products/example"
    page.goto.return_value = SimpleNamespace(status=200)
    controls = Mock()
    controls.count.return_value = 1
    def locate(selector):
        # A generic first submit button can be a hidden search/newsletter form.
        if ':visible' not in selector or '/cart/add' not in selector:
            hidden = Mock()
            hidden.count.return_value = 1
            hidden.first.scroll_into_view_if_needed.side_effect = RuntimeError("hidden form")
            return hidden
        return controls
    page.locator.side_effect = locate
    def screenshot(**kwargs):
        identifier = "landing-mobile" if page.screenshot.call_count == 1 else "landing-buying"
        if identifier == failed_view:
            raise RuntimeError("private browser diagnostic")
        return identifier.encode()
    page.screenshot.side_effect = screenshot
    browser = Mock()
    browser.new_context.return_value.new_page.return_value = page
    chromium = Mock()
    chromium.launch.return_value = browser
    monkeypatch.setattr(playwright.sync_api, "sync_playwright", lambda: nullcontext(SimpleNamespace(chromium=chromium)))
    monkeypatch.setattr(evidence, "public_url", lambda url: True)
    monkeypatch.setattr(evidence, "save_file", lambda name, png: "/files/" + name)
    persist = Mock()
    rows, images = evidence.capture_landing_page([page.url], persist)
    assert [row['id'] for row in rows] == ["landing-mobile", "landing-buying"]
    assert [row['id'] for row in rows if row['status'] == 'unavailable'] == ([failed_view] if failed_view else [])
    assert len(images) == persist.call_count == (1 if failed_view else 2)
    assert "private browser diagnostic" not in json.dumps(rows)
    controls.first.scroll_into_view_if_needed.assert_called_once()
    browser.close.assert_called_once()


def test_job_ignores_client_metrics_and_persists_full_group_and_period(monkeypatch):
    from app import main
    stored, windows = {}, []
    monkeypatch.setattr(main.db, "get_app_setting", lambda store, key: stored.get((store, key)))
    monkeypatch.setattr(main.db, "set_app_setting", lambda store, key, value: stored.update({(store, key): value}))
    monkeypatch.setattr(main.db, "set_campaign_meta", Mock())
    monkeypatch.setattr(main.db, "append_campaign_timeline", Mock())
    monkeypatch.setattr(main, "reporting_token", lambda *a: None)
    monkeypatch.setattr(main, "get_campaign_ad_creatives", lambda cid: [{"ad_id": cid, "headline": "Evidence"}])
    def window(cids, start, end):
        windows.append((cids, start, end))
        return {"spend": 100, "purchases": 12, "currency": "USD"}
    monkeypatch.setattr(main, "fetch_analysis_window", window)
    analyze = Mock(return_value=base_report())
    monkeypatch.setattr(main, "run_campaign_analysis", analyze)
    settings = config.AnalyzerSettings(profiler_enabled=False, clarity_enabled=False, screenshots_enabled=False)
    main._run_analysis_job("fixture-job", {"cids": ["1", "2"], "pid": "fixture-product", "store": "irrakids", "s_date": "2026-09-25", "e_date": "2026-10-01", "campaign_key": "fixture-product", "metrics": {"spend": 99999}, "settings": settings.model_dump()})
    assert windows == [(["1", "2"], "2026-09-25", "2026-10-01"), (["1", "2"], "2026-09-18", "2026-09-24")]
    assert analyze.call_args.kwargs["campaign_metrics"]["spend"] == 100
    assert len(analyze.call_args.kwargs["ad_creatives"]) == 2
    assert analyze.call_args.kwargs["settings"].model == "gpt-6.1-sol"
    history = stored[("irrakids", "ads_analysis:fixture-product")]
    assert history[0]["campaign_ids"] == ["1", "2"]
    assert history[0]["date_range"] == {"start": "2026-09-25", "end": "2026-10-01"}
    assert stored[(None, "ads_analysis_job:fixture-job")]["status"] == "done"
    main._analysis_jobs.pop("fixture-job", None)


def test_job_provider_failure_preserves_existing_report(monkeypatch):
    from app import main
    stored = {("irrakids", "ads_analysis:product"): [{"summary": "Previous valid report"}]}
    monkeypatch.setattr(main.db, "get_app_setting", lambda store, key: stored.get((store, key)))
    monkeypatch.setattr(main.db, "set_app_setting", lambda store, key, value: stored.update({(store, key): value}))
    monkeypatch.setattr(main, "reporting_token", lambda *a: None)
    monkeypatch.setattr(main, "fetch_analysis_window", Mock(side_effect=RuntimeError("provider sk-private")))
    main._run_analysis_job("failed-job", {"cids": ["1"], "store": "irrakids", "s_date": "2026-09-25", "e_date": "2026-10-01", "campaign_key": "product"})
    assert stored[("irrakids", "ads_analysis:product")][0]["summary"] == "Previous valid report"
    job = stored[(None, "ads_analysis_job:failed-job")]
    assert job["status"] == "error" and "sk-private" not in job["error"]
    main._analysis_jobs.pop("failed-job", None)


def test_status_reads_database_across_instances_and_enforces_store(monkeypatch):
    import asyncio
    from app import main
    monkeypatch.setattr(main.db, "get_app_setting", lambda store, key: {"status": "done", "store": "irrakids", "result": {"summary": "Stored report"}})
    assert asyncio.run(main.api_campaign_analyze_status("saved-job", "nouralibas"))["status"] == "done"
    assert asyncio.run(main.api_campaign_analyze_status("saved-job", "irranova"))["status"] == "not_found"


def test_paused_agent_never_starts_a_job(monkeypatch):
    import asyncio
    from app import main
    monkeypatch.setattr(main, "get_ads_analyzer_settings", lambda store: config.AnalyzerSettings(enabled=False))
    thread = Mock()
    monkeypatch.setattr(main.threading, "Thread", thread)
    response = asyncio.run(main.api_campaign_analyze(main.CampaignAnalyzeRequest(campaign_id="1", store="irrakids")))
    assert "paused" in response["error"]
    thread.assert_not_called()


def test_direct_secret_manager_client_keeps_key_server_side(monkeypatch):
    import base64
    import google.auth
    from google.auth import transport
    import google.auth.transport.requests
    config.get_client.cache_clear()
    monkeypatch.setenv("ADS_ANALYZER_OPENAI_SECRET_VERSION", "projects/test/secrets/OPENAI_API_KEY/versions/latest")
    monkeypatch.setenv("OPENAI_API_KEY", "environment-fallback")
    monkeypatch.setattr(google.auth, "default", Mock(return_value=(object(), "test")))
    session = Mock()
    session.__enter__ = Mock(return_value=session)
    session.__exit__ = Mock(return_value=False)
    session.get.return_value = SimpleNamespace(ok=True, json=lambda: {"payload": {"data": base64.b64encode(b"test-direct-key").decode()}})
    monkeypatch.setattr(google.auth.transport.requests, "AuthorizedSession", Mock(return_value=session))
    constructor = Mock()
    monkeypatch.setattr(config, "OpenAI", constructor)
    config.get_client()
    assert constructor.call_args.kwargs["api_key"] == "test-direct-key"
    assert session.get.call_args.args[0].endswith('/versions/latest:access')
    config.get_client.cache_clear()


def test_invalid_secret_resource_never_falls_back_to_environment_key(monkeypatch):
    config.get_client.cache_clear()
    monkeypatch.setenv("ADS_ANALYZER_OPENAI_SECRET_VERSION", "invalid-resource")
    monkeypatch.setenv("OPENAI_API_KEY", "test-fallback")
    with pytest.raises(RuntimeError, match="Invalid"):
        config.get_client()
    config.get_client.cache_clear()


def test_customer_profiler_json_instruction_is_in_request_input(monkeypatch):
    from app import campaign_analyzer
    sdk = Mock()
    profile = {"buyer_persona": "A hypothesis based on product data"}
    sdk.responses.create.return_value = SimpleNamespace(status="completed", output_text=json.dumps(profile))
    monkeypatch.setattr(campaign_analyzer, "get_client", lambda: sdk)
    monkeypatch.setattr(campaign_analyzer, "build_report", lambda **kwargs: kwargs)
    result = campaign_analyzer.analyze_campaign(campaign_metrics={}, ad_creatives=[], product_info={"title": "Children shoes"}, settings=config.AnalyzerSettings())
    request = sdk.responses.create.call_args.kwargs
    assert request["text"]["format"]["type"] == "json_object"
    assert "json" in request["input"].lower()
    assert "Children shoes" in request["input"]
    assert request["store"] is False
    assert result["customer_profile"] == profile


def test_customer_profiler_incomplete_response_does_not_request_report(monkeypatch):
    from app import campaign_analyzer
    sdk = Mock()
    sdk.responses.create.return_value = SimpleNamespace(status="incomplete", output_text='{"unfinished":')
    monkeypatch.setattr(campaign_analyzer, "get_client", lambda: sdk)
    build = Mock()
    monkeypatch.setattr(campaign_analyzer, "build_report", build)
    with pytest.raises(RuntimeError, match="Customer profiler did not complete"):
        campaign_analyzer.analyze_campaign(campaign_metrics={}, ad_creatives=[], product_info={}, settings=config.AnalyzerSettings())
    build.assert_not_called()


def test_analysis_timeout_is_actionable_and_does_not_expose_provider_secrets():
    import httpx
    from openai import APITimeoutError, BadRequestError
    timeout = APITimeoutError(request=httpx.Request("POST", "https://api.openai.com/v1/responses"))
    message = reports.analysis_failure_message(timeout)
    assert "took too long" in message and "reasoning depth" in message
    assert "No new report was saved" in message
    rejected = BadRequestError("Private sk-secret-value", response=httpx.Response(400, request=httpx.Request("POST", "https://api.openai.com/v1/responses")), body={})
    assert "sk-secret-value" not in reports.analysis_failure_message(rejected)
    assert "400" in reports.analysis_failure_message(rejected)


def test_stream_without_completed_event_closes_and_never_returns_partial_report(monkeypatch):
    from contextlib import contextmanager
    sdk = Mock()
    sdk.with_options.return_value = sdk
    closed = []
    @contextmanager
    def interrupted(**kwargs):
        try:
            yield iter([SimpleNamespace(type="response.output_text.delta", delta='{"partial":')])
        finally:
            closed.append(True)
    sdk.responses.stream.side_effect = interrupted
    monkeypatch.setattr(reports, "get_client", lambda: sdk)
    with pytest.raises(reports.AnalyzerResponseError, match="connection ended"):
        reports.structured_response(reports.AdsReport, instructions="test", content=[], model="gpt-6.1-sol", settings=config.AnalyzerSettings())
    assert closed == [True]


@pytest.mark.parametrize("budget", [8000, config.MAX_ANALYSIS_OUTPUT_TOKENS])
def test_stream_token_cutoff_identifies_configured_budget_before_sdk_finalization(monkeypatch, budget):
    sdk = Mock()
    sdk.with_options.return_value = sdk
    terminal = SimpleNamespace(status="incomplete", incomplete_details=SimpleNamespace(reason="max_output_tokens"))
    stream = FakeResponseStream(terminal)
    stream.get_final_response = Mock(side_effect=RuntimeError("SDK has no completed response"))
    sdk.responses.stream.return_value = nullcontext(stream)
    monkeypatch.setattr(reports, "get_client", lambda: sdk)
    with pytest.raises(reports.AnalyzerResponseError, match=f"{budget:,}-token output limit") as caught:
        reports.structured_response(reports.AdsReport, instructions="test", content=[], model="gpt-6.1-sol", settings=config.AnalyzerSettings(reasoning_effort="high", max_output_tokens=budget))
    if budget == config.MAX_ANALYSIS_OUTPUT_TOKENS:
        assert "Lower reasoning depth" in str(caught.value)
        assert "Increase the output token limit" not in str(caught.value)
    else:
        assert "Increase the output token limit" in str(caught.value)
    stream.get_final_response.assert_not_called()
