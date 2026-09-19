import base64
import json
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from PIL import Image

from app.social_agent import openai_agents as agents, repository as repo


def test_store_settings_round_trip_and_legacy_defaults(monkeypatch):
    stored = {"legacy": {"enabled": False, "creative_variants": 2}}
    monkeypatch.setattr(repo.db, "get_app_setting", lambda store, key: stored.get(store))
    monkeypatch.setattr(repo.db, "set_app_setting", lambda store, key, value: stored.update({store: dict(value)}))
    assert repo.get_config("legacy")["creative_variants"] == 2
    assert repo.get_config("legacy")["analyzer_model"] == "gpt-6-astra"
    saved = repo.save_config("one", {"copy_instructions": "A distinctive caption", "image_quality": "low", "creative_variants": 1})
    assert repo.get_config("one") == saved
    assert repo.get_config("two")["copy_instructions"] != saved["copy_instructions"]
    assert saved["analyzer_reasoning"] == "medium"
    assert saved["image_prompt_model"] == "gpt-6-astra"


@pytest.mark.parametrize("patch", [
    {"openai_image_model": "invented-model"}, {"analyzer_model": "gpt-image-2"},
    {"analyzer_reasoning": "none"}, {"copy_max_output_tokens": 100000},
    {"source_image_limit": None}, {"creative_variants": 0},
    {"image_quality": "auto"}, {"image_size": "100x100"},
    {"image_prompt_instructions": " "}, {"caption_max_chars": True},
    {"image_text_mode": "anything"}, {"image_badge_mode": "fake_offer"}, {"image_cta_ar": "x" * 25},
])
def test_invalid_settings_never_reach_storage(monkeypatch, patch):
    monkeypatch.setattr(repo.db, "get_app_setting", lambda *args: None)
    save = Mock()
    monkeypatch.setattr(repo.db, "set_app_setting", save)
    with pytest.raises(ValueError):
        repo.save_config("one", patch)
    save.assert_not_called()


def test_responses_sends_selected_model_effort_budget_and_no_fallback(monkeypatch):
    sdk = Mock()
    sdk.with_options.return_value = sdk
    sdk.responses.create.return_value = SimpleNamespace(status="completed", output_text='{"brief":"facts"}', usage=None)
    monkeypatch.setattr(agents, "client", sdk)
    config = {"analyzer_model": "gpt-6-astra", "analyzer_reasoning": "medium", "analyzer_max_output_tokens": 3500, "analyzer_instructions": "Specialist instructions"}
    result = agents._response_json(name="analysis", schema={}, system="Keep facts true", user="Product", config=config, stage="analyzer")
    call = sdk.responses.create.call_args.kwargs
    assert call["model"] == "gpt-6-astra"
    assert call["reasoning"] == {"effort": "medium"}
    assert call["max_output_tokens"] == 3500
    assert "Specialist instructions" in call["instructions"]
    assert "temperature" not in call
    assert result["_generation"]["model"] == "gpt-6-astra"
    sdk.responses.create.side_effect = RuntimeError("model access denied")
    with pytest.raises(RuntimeError, match="model access denied"):
        agents._response_json(name="analysis", schema={}, system="Facts", user="Product", config=config, stage="analyzer")
    sdk.chat.completions.create.assert_not_called()
    assert sdk.responses.create.call_count == 2


def test_truncated_response_does_not_become_a_valid_brief(monkeypatch):
    sdk = Mock()
    sdk.with_options.return_value = sdk
    sdk.responses.create.return_value = SimpleNamespace(status="incomplete", output_text='{"brief":')
    monkeypatch.setattr(agents, "client", sdk)
    with pytest.raises(RuntimeError, match="output token limit"):
        agents._response_json(name="analysis", schema={}, system="Facts", user="Product", stage="analyzer")


def test_product_analysis_feeds_copy_and_specialist_once(monkeypatch):
    calls = []
    def response(**kwargs):
        calls.append(kwargs)
        return {
            "analyzer": {"verified_facts": "Blue hat", "customer_insight": "Outdoor moments"},
            "copy": {"caption_ar": "قبعة جميلة", "angle": "Outdoor fun", "visual_directions": []},
            "image_prompt": {"visual_directions": ["A playful shade metaphor"], "rationale_en": "Relevant to outdoor use"},
        }[kwargs["stage"]]
    monkeypatch.setattr(agents, "_response_json", response)
    product = {"title": "Hat", "url": "https://shop.example/hat", "images": [{"url": "https://shop.example/hat.png"}], "variants": ["large unused payload"]}
    strategy = agents.create_strategy(product, repo.DEFAULT_CONFIG, {}, slot="rolling", position=0)
    assert [call["stage"] for call in calls] == ["analyzer", "copy", "image_prompt"]
    assert calls[0]["images"] == ["https://shop.example/hat.png"]
    assert json.loads(calls[1]["user"])["product_analysis"]["verified_facts"] == "Blue hat"
    assert json.loads(calls[2]["user"])["analysis"]["verified_facts"] == "Blue hat"
    assert "variants" not in json.loads(calls[0]["user"])["product"]
    assert strategy["visual_directions"] == ["A playful shade metaphor"]
    assert strategy["product_analysis"]["verified_facts"] == "Blue hat"


def test_flare_generation_uses_exact_snapshot_and_cost_options(monkeypatch):
    sdk = Mock()
    sdk.with_options.return_value = sdk
    sdk.images.edit.return_value = SimpleNamespace(data=[SimpleNamespace(b64_json="AAAA")])
    monkeypatch.setattr(agents, "client", sdk)
    config = {**repo.DEFAULT_CONFIG, "openai_image_model": "gpt-image-2.5-flare-2026-09-08", "image_quality": "low"}
    agents._generate_openai_creative(b"source", "image/png", "Backdrop only", config)
    call = sdk.images.edit.call_args.kwargs
    assert call["model"] == "gpt-image-2.5-flare-2026-09-08"
    assert call["size"] == "1024x1280"
    assert call["quality"] == "low"
    assert call["n"] == 1
    assert call["image"] == [("product-reference", b"source", "image/png")]
    sdk.images.generate.assert_not_called()


def test_final_image_keeps_edge_text_instead_of_cropping():
    poster = Image.new("RGB", (1024, 1536), "blue")
    # Top/bottom colored strips stand in for text near the image edges.
    from PIL import ImageDraw
    draw = ImageDraw.Draw(poster)
    draw.rectangle((100, 0, 924, 60), fill="red")
    draw.rectangle((100, 1476, 924, 1535), fill="green")
    raw = BytesIO(); poster.save(raw, "PNG")
    data_url = "data:image/png;base64," + base64.b64encode(raw.getvalue()).decode()
    final, _ = agents.data_url_bytes(agents._finalize_creative(data_url))
    image = Image.open(BytesIO(final))
    assert image.size == (1024, 1280)
    assert image.getpixel((512, 10)) == (255, 0, 0)
    assert image.getpixel((512, 1270)) == (0, 128, 0)


def test_caption_length_is_enforced():
    blockers = agents.deterministic_review({}, {"caption_ar": "مرحبا " * 100}, {"caption_max_chars": 200})
    assert "Caption exceeds the configured character limit" in blockers


@pytest.mark.parametrize("phrase", ["بدل 300", "بدل من 300", "بدلاً من 300", "بدلاً 300"])
def test_fusha_price_wording_is_idempotent(phrase):
    result = agents.sanitize_fusha_strategy({"offer_text_ar": phrase})
    assert result["offer_text_ar"] == "بدلاً من 300"
    assert agents.sanitize_fusha_strategy(result)["offer_text_ar"] == result["offer_text_ar"]


def test_copy_repair_preserves_visual_brief_and_analysis(monkeypatch):
    monkeypatch.setattr(agents, "_response_json", lambda **kwargs: {"caption_ar": "نص مصحح", "visual_directions": ["unwanted new direction"]})
    strategy = {"visual_directions": ["original direction"], "product_analysis": {"verified_facts": "Blue hat"}, "generation_stages": [{"stage": "analyzer"}], "image_copy": {"headline_ar": "وقت المرح"}, "image_headline_ar": "وقت المرح"}
    result = agents.repair_strategy({}, strategy, {}, repo.DEFAULT_CONFIG)
    assert result["visual_directions"] == strategy["visual_directions"]
    assert result["product_analysis"] == strategy["product_analysis"]
    assert len(result["generation_stages"]) == 2
    assert result["image_copy"] == strategy["image_copy"]


def test_overlay_badges_use_actual_catalog_values():
    strategy = {"image_headline_ar": "وقت المرح", "image_benefit_ar": "قطعة واحدة"}
    product = {"price": "199.99", "compare_at_price": "339.90", "discount_percent": 99}
    assert agents._image_copy(product, strategy, {})["badge_ar"] == "199.99 درهم"
    assert agents._image_copy(product, strategy, {"image_badge_mode": "discount"})["badge_ar"] == "خصم 41٪"
    assert agents._image_copy({"price": 200}, strategy, {"image_badge_mode": "discount"})["badge_ar"] == ""
    assert agents._image_copy({"price": "NaN"}, strategy, {})["badge_ar"] == ""


def test_overlay_controls_remove_unrequested_elements():
    strategy = {"image_headline_ar": "وقت المرح", "image_benefit_ar": "قطعة واحدة"}
    assert not any(agents._image_copy({"price": 100}, strategy, {"image_text_mode": "none"}).values())
    copy = agents._image_copy({"price": 100}, strategy, {"image_text_mode": "headline", "image_badge_mode": "none", "image_cta_ar": ""})
    assert copy == {"headline_ar": "وقت المرح", "benefit_ar": "", "badge_ar": "", "cta_ar": ""}


def test_integrated_render_passes_exact_text_and_does_not_add_frame(monkeypatch):
    captured = {}
    monkeypatch.setattr(agents, "_download_source", lambda url: (b"reference", "image/png"))
    def render(source, mime, prompt, config):
        captured.update(source=source, prompt=prompt)
        return "data:image/png;base64,AAAA"
    monkeypatch.setattr(agents, "_generate_openai_creative", render)
    monkeypatch.setattr(agents, "_finalize_creative", lambda image: image)
    strategy = {"image_copy": {"headline_ar": "وقت المرح", "benefit_ar": "", "cta_ar": "", "badge_ar": ""}}
    result = agents.generate_candidate({"images": [{"url": "https://example.test/product"}]}, strategy, "One clever scene", 1)
    assert captured["source"] == b"reference"
    assert "وقت المرح" in captured["prompt"]
    assert "No white photo border" in captured["prompt"]
    assert "render scenery only" not in captured["prompt"]
    assert result == "data:image/png;base64,AAAA"


def test_missing_headline_stops_before_paid_image_call(monkeypatch):
    download = Mock()
    monkeypatch.setattr(agents, "_download_source", download)
    with pytest.raises(ValueError, match="headline is missing"):
        agents.generate_candidate({"images": [{"url": "https://example.test/product"}]}, {}, "A scene", 1)
    download.assert_not_called()


def test_incorrect_rendered_words_are_a_hard_rejection(monkeypatch):
    result = {"decision": "approve", "score": 99, "score_breakdown": {"product_fidelity": 100, "geometry": 100, "text_logo_integrity": 100}, "image_text_errors": ["Headline is missing"]}
    monkeypatch.setattr(agents, "_response_json", lambda **kwargs: dict(result))
    review = agents.review_candidate({}, {"caption_ar": "منتج جميل"}, "data:image/png;base64,AAAA", {}, 1)
    assert review["decision"] == "reject"
    assert "Headline is missing" in review["factual_risks"]
