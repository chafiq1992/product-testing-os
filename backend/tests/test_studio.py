import asyncio
import base64
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app import studio


@pytest.fixture(autouse=True)
def offline_token_count(monkeypatch):
    monkeypatch.setattr(studio, "count_input_tokens", AsyncMock(return_value=800))
    monkeypatch.setenv("STUDIO_APPROVAL_SECRET", "unit-test-signing-secret")


def client():
    app = FastAPI()
    app.include_router(studio.router)
    class PreviewClient(TestClient):
        def post(self, url, **kwargs):
            if url.startswith('/api/studio/steps/') or url == '/api/studio/images':
                preview = super().post(url.replace('/api/studio/', '/api/studio/preflight/', 1), json=kwargs.get('json'))
                if preview.status_code == 200 and preview.json().get('ticket'):
                    kwargs['headers'] = {'X-Studio-Ticket': preview.json()['ticket'], 'X-Studio-Approve-High': 'yes'}
            return super().post(url, **kwargs)
    return PreviewClient(app)


def test_model_and_count_validation_prevents_provider_calls():
    with pytest.raises(ValidationError):
        studio.ImageRequest(image_url="https://example.com/a.png", model="invented")
    with pytest.raises(ValidationError):
        studio.ImageRequest(image_url="https://example.com/a.png", count=7)
    with pytest.raises(ValidationError):
        studio.StepRequest(model="gpt-4a")


def test_text_contract_and_run_metadata(monkeypatch):
    run = AsyncMock(return_value={"title": "Cotton cap", "description": "Adjustable black cap."})
    monkeypatch.setattr(studio, "run_step", run)
    response = client().post("/api/studio/steps/title_desc", json={"product":{"title":"Cotton cap"}})
    assert response.status_code == 200
    assert response.json()["_run"]["model"] == "gpt-6-astra"
    assert len(response.json()["_run"]["id"]) == 32


def test_empty_results_are_failures_and_never_fake_success(monkeypatch):
    monkeypatch.setattr(studio, "run_step", AsyncMock(return_value={"angles":[]}))
    response = client().post("/api/studio/steps/angles", json={})
    assert response.status_code == 502
    assert "did not return any angles" in response.json()["detail"]


def test_analysis_requires_image(monkeypatch):
    run = AsyncMock()
    monkeypatch.setattr(studio, "run_step", run)
    response = client().post("/api/studio/steps/product_from_image", json={})
    assert response.status_code == 502
    run.assert_not_called()


def test_error_response_hides_provider_secrets(monkeypatch):
    monkeypatch.setattr(studio, "run_step", AsyncMock(side_effect=RuntimeError("sensitive-api-key")))
    response = client().post("/api/studio/steps/angles", json={})
    assert response.status_code == 502
    assert "sensitive" not in response.text
    assert "Run:" in response.json()["detail"]


def test_partial_image_batch_preserves_success_and_selected_model(monkeypatch):
    monkeypatch.setattr(studio, "reference_image", AsyncMock(return_value=("ref.png", b"png", "image/png")))
    monkeypatch.setattr(studio, "run_step", AsyncMock(return_value={"items":[{"prompt":"First"},{"prompt":"Second"}]}))
    edit = AsyncMock(side_effect=[SimpleNamespace(data=[SimpleNamespace(b64_json="aW1hZ2U=")]), RuntimeError("provider failed")])
    class Provider:
        images = SimpleNamespace(edit=edit)
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
    monkeypatch.setattr(studio, "AsyncOpenAI", lambda **kw: Provider())
    response = client().post("/api/studio/images", json={"image_url":"https://example.com/ref.png", "model":"gpt-image-2.5-flare", "count":2})
    assert response.status_code == 200
    assert len(response.json()["images"]) == 1
    assert "1 image(s) failed" in response.json()["warning"]
    assert all(call.kwargs["model"] == "gpt-image-2.5-flare" for call in edit.call_args_list)
    assert edit.call_args.kwargs["image"][1] == b"png"


def test_image_source_rejects_private_addresses():
    with pytest.raises(ValueError, match="publicly accessible"):
        asyncio.run(studio.reference_image("http://127.0.0.1/secrets"))


def test_landing_html_cannot_introduce_scripts_or_unapproved_resources():
    result = studio.sanitize_landing({
        "html": '<script>alert(1)</script><img src="https://bad.example/a" onerror="bad()"><a href="javascript:bad()">Buy</a><img src="https://cdn.example/a.png"><a href="/products/cap">Shop</a>',
        "sections": [{"image_url":"https://bad.example/a"}],
    }, ["https://cdn.example/a.png"], "/products/cap")
    assert "script" not in result["html"]
    assert "onerror" not in result["html"]
    assert "bad.example" not in result["html"]
    assert 'href="/products/cap"' in result["html"]
    assert 'src="https://cdn.example/a.png"' in result["html"]
    assert result["sections"][0]["image_url"] is None


def test_runner_uses_responses_and_preserves_multimodal_input(monkeypatch):
    runner = AsyncMock(return_value=SimpleNamespace(final_output={"title":"Cap"}))
    monkeypatch.setattr(studio.Runner, "run", runner)
    asyncio.run(studio.run_step("product_from_image", {"product":{}}, "gpt-6-astra", ["data:image/png;base64,aQ=="], "run-1"))
    agent, inputs = runner.call_args.args
    assert isinstance(agent.model, studio.OpenAIResponsesModel)
    assert inputs[0]["content"][1]["type"] == "input_image"
    assert runner.call_args.kwargs["run_config"].trace_include_sensitive_data is False
    assert agent.model_settings.store is False


@pytest.mark.parametrize("stage", list(studio.STAGES))
def test_base64_never_enters_text_for_any_agent_stage(monkeypatch, stage):
    source = "data:image/png;base64," + "aGVsbG8=" * 120000
    payload = {"image_url": source, "image_urls": [source], "product": {"html": '<img src="' + source + '">', "selection": {source: True}}}
    runner = AsyncMock(return_value=SimpleNamespace(final_output={"title": "Cap"}))
    monkeypatch.setattr(studio.Runner, "run", runner)
    asyncio.run(studio.run_step(stage, payload, "gpt-6-astra", [source, source], "run-images"))
    agent, inputs = runner.call_args.args
    content = inputs[0]["content"]
    assert len(content) == 2  # deduplicated image, separate from text
    assert content[1]["image_url"] == source
    assert "base64" not in content[0]["text"]
    assert len(content[0]["text"]) < 1000
    assert runner.call_args.kwargs["max_turns"] == 1
    assert agent.model_settings.max_tokens == studio.OUTPUT_LIMITS[stage]


def test_oversized_text_is_rejected_before_openai_client_created(monkeypatch):
    provider = AsyncMock()
    monkeypatch.setattr(studio, "AsyncOpenAI", provider)
    response = client().post("/api/studio/steps/angles", json={"product": {"description": "x" * 50000}})
    assert response.status_code == 502
    assert "No model call was made" in response.json()["detail"]
    provider.assert_not_called()


def test_unlisted_inline_data_is_removed_and_unicode_limit_uses_bytes():
    text, _ = studio.prepare_agent_input({"prompt": "Inspect data:image/png;base64,abc123 then stop."}, [])
    assert "base64" not in text
    with pytest.raises(ValueError, match="48 KB"):
        studio.prepare_agent_input({"product": {"description": "\u20ac" * 17000}}, [])


def test_landing_aliases_restore_exact_images_without_model_echoing_bytes(monkeypatch):
    source = "data:image/png;base64,aGVsbG8="
    runner = AsyncMock(return_value=SimpleNamespace(final_output={"headline": "Cap", "html": '<img src="studio-image://1">', "sections": [{"image_url": "studio-image://1"}]}))
    monkeypatch.setattr(studio.Runner, "run", runner)
    response = client().post("/api/studio/steps/landing_copy", json={"image_urls": [source]})
    assert response.status_code == 200
    assert response.json()["sections"][0]["image_url"] == source
    assert source in response.json()["html"]
    assert source not in runner.call_args.args[1][0]["content"][0]["text"]


def test_usage_logged_and_retries_disabled_and_vision_bounded(monkeypatch, caplog):
    from agents.usage import Usage
    from unittest.mock import Mock
    provider = SimpleNamespace()
    class Client:
        async def __aenter__(self): return provider
        async def __aexit__(self, *args): pass
    factory = Mock(return_value=Client())
    monkeypatch.setattr(studio, "AsyncOpenAI", factory)
    response = SimpleNamespace(response_id="resp-qa", usage=Usage(input_tokens=350, output_tokens=50))
    runner = AsyncMock(return_value=SimpleNamespace(final_output={"items": [{"prompt": "Cap on white"}]}, raw_responses=[response]))
    monkeypatch.setattr(studio.Runner, "run", runner)
    images = [f"https://example.com/{i}.png" for i in range(10)]
    result = asyncio.run(studio.run_step("image_brief", {}, "gpt-6-astra", images, "run-usage"))
    assert factory.call_args.kwargs["max_retries"] == 0
    content = runner.call_args.args[1][0]["content"]
    assert len(content) == 5
    assert all(item["detail"] == "low" for item in content[1:])
    assert result["_usage"][0]["input_tokens"] == 350
    assert "studio_usage" in caplog.text
