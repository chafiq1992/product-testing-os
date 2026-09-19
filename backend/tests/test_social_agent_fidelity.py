import base64
import json
from types import SimpleNamespace
from unittest.mock import Mock
from uuid import uuid4
from datetime import datetime

import pytest
from app.social_agent import service, repository as repo, openai_agents as agents


def review(decision="reject"):
    return {"decision": decision, "score": 98 if decision == "approve" else 59,
            "source_product_differences": [] if decision == "approve" else ["Invented floral pattern on plain tulle"],
            "visual_errors": [], "image_text_errors": [], "repair_instruction": "Restore plain tulle"}


@pytest.fixture
def pipeline(monkeypatch):
    store = "fidelity_" + uuid4().hex
    repo.save_config(store, {"enabled": True, "live_publish": False, "creative_variants": 1, "max_review_attempts": 2})
    product = {"id": "dress", "title": "Plain dress", "images": [{"url": "https://shop.test/source.png"}]}
    run = repo.create_run(store, store+":test", "rolling", 1, {
        "local_date": "2026-09-10", "products": [product], "backup_products": [{"id": "wrong-backup"}],
        "scheduled_for": ["2026-09-10T10:00:00Z"],
    })
    strategy = {"visual_directions": ["Good design"], "image_copy": {"headline_ar": "Title"}, "product_analysis": {"surface_details": "plain tulle"}}
    mocks = {}
    for name, result in [("create_strategy", strategy), ("generate_candidate", "original-draft"),
                         ("repair_candidate", "fixed-draft"), ("data_url_bytes", (b"pixels", "image/png"))]:
        mocks[name] = Mock(return_value=result)
        monkeypatch.setattr(service, name, mocks[name])
    mocks["upload"] = Mock(return_value={"url": "https://shop.test/fixed.png"})
    monkeypatch.setattr(service.shopify, "upload_file_bytes", mocks["upload"])
    return store, product, run, mocks


def test_repair_uses_same_product_then_independent_review_and_budget(pipeline, monkeypatch):
    store, product, run, mocks = pipeline
    reviewer = Mock(side_effect=[review(), review("approve")])
    monkeypatch.setattr(service, "review_candidate", reviewer)
    result = service.prepare_one(run["id"])["post"]
    assert result["status"] == "preview_ready" and result["attempts"] == 2
    assert mocks["repair_candidate"].call_args.args[0]["id"] == product["id"]
    assert mocks["repair_candidate"].call_args.args[2] == "original-draft"
    assert reviewer.call_args_list[1].args[2] == "fixed-draft"
    assert result["assets"][0]["image_repaired"] is True
    assert [item["kind"] for item in result["review"]["attempt_history"]] == ["generation", "targeted_image_repair"]
    assert mocks["create_strategy"].call_count == 1


def test_last_attempt_cannot_spend_on_extra_image(pipeline, monkeypatch):
    store, product, run, mocks = pipeline
    repo.save_config(store, {"max_review_attempts": 1})
    monkeypatch.setattr(service, "review_candidate", Mock(return_value=review()))
    result = service.prepare_one(run["id"])["post"]
    assert result["status"] == "rejected" and result["attempts"] == 1
    mocks["repair_candidate"].assert_not_called()
    mocks["upload"].assert_not_called()


def test_failed_repair_keeps_rejection_and_error_history(pipeline, monkeypatch):
    store, product, run, mocks = pipeline
    mocks["repair_candidate"].side_effect = RuntimeError("Image provider unavailable")
    monkeypatch.setattr(service, "review_candidate", Mock(return_value=review()))
    result = service.prepare_one(run["id"])["post"]
    assert result["status"] == "rejected" and result["attempts"] == 2
    assert result["review"]["attempt_history"][-1]["error"]["message"] == "Image provider unavailable"
    mocks["upload"].assert_not_called()


def test_rejected_retry_reuses_strategy_and_merchandise(pipeline, monkeypatch):
    store, product, run, mocks = pipeline
    repo.save_config(store, {"max_review_attempts": 2})
    post = repo.create_post(run_id=run["id"],store=store,slot="rolling",position=0,scheduled_for=datetime.now(),product=product,status="rejected")
    repo.update_post(post["id"], attempts=1, review=review(), strategy={"source_product_id": "dress", "image_copy": {"headline_ar":"Title"}, "visual_directions":["Good design"]})
    monkeypatch.setattr(service, "review_candidate", Mock(return_value=review("approve")))
    result = service.prepare_one(run["id"])["post"]
    mocks["create_strategy"].assert_not_called()
    assert result["product"]["id"] == "dress"
    assert "Invented floral pattern" in mocks["generate_candidate"].call_args.args[2]
    assert result["attempts"] == 2


def test_targeted_edit_sends_original_and_draft_with_selected_model(monkeypatch):
    sdk = Mock()
    sdk.with_options.return_value = sdk
    sdk.images.edit.return_value = SimpleNamespace(data=[SimpleNamespace(b64_json=base64.b64encode(b"fixed").decode(),url=None)])
    monkeypatch.setattr(agents, "client", sdk)
    monkeypatch.setattr(agents, "_download_source", lambda url: (b"original", "image/png"))
    monkeypatch.setattr(agents, "_finalize_creative", lambda result: result)
    agents.repair_candidate({"images":[{"url":"https://shop.test/source.png"}]}, {"image_copy":{"headline_ar":"Exact"}},
                            "data:image/png;base64,"+base64.b64encode(b"draft").decode(), review(), {"openai_image_model":"gpt-image-2.5-flare"})
    params = sdk.images.edit.call_args.kwargs
    assert params["image"] == [("original-product",b"original","image/png"),("draft-to-repair",b"draft","image/png")]
    assert params["model"] == "gpt-image-2.5-flare" and params["n"] == 1
    assert params["quality"] == "medium"
    assert "Invented floral pattern" in params["prompt"] and "Exact" in params["prompt"]


def test_analyzer_checklist_reaches_art_director_and_generator(monkeypatch):
    calls=[]
    def respond(**kwargs):
        calls.append(kwargs)
        if kwargs["stage"] == "analyzer":
            return {"surface_details":"Plain satin bow", "included_items":"dress", "excluded_styling_items":"sandals"}
        if kwargs["stage"] == "copy":
            return {"image_headline_ar":"Title", "image_benefit_ar":"Benefit", "caption_ar":"Caption"}
        return {"visual_directions":["Bright design"],"rationale_en":"Simple"}
    monkeypatch.setattr(agents, "_response_json", respond)
    product={"id":"one","images":[{"url":"https://shop.test/source.png"}],"price":10}
    strategy=agents.create_strategy(product,{}, {},slot="rolling",position=0)
    art=next(call for call in calls if call["stage"] == "image_prompt")
    assert art["images"] == ["https://shop.test/source.png"]
    assert "Plain satin bow" in art["user"]
    capture=Mock(return_value="data:image/png;base64,AAAA")
    monkeypatch.setattr(agents,"_generate_openai_creative",capture)
    monkeypatch.setattr(agents,"_download_source",lambda url:(b"original","image/png"))
    monkeypatch.setattr(agents,"_finalize_creative",lambda result:result)
    agents.generate_candidate(product,strategy,"Bright design",1,{})
    assert "Plain satin bow" in capture.call_args.args[2] and "sandals" in capture.call_args.args[2]


def test_correction_model_is_explicit_and_does_not_change_first_generation(monkeypatch):
    sdk=Mock()
    sdk.with_options.return_value=sdk
    sdk.images.edit.return_value=SimpleNamespace(data=[SimpleNamespace(b64_json=base64.b64encode(b"fixed").decode(),url=None)])
    monkeypatch.setattr(agents,"client",sdk)
    monkeypatch.setattr(agents,"_download_source",lambda url:(b"original","image/png"))
    monkeypatch.setattr(agents,"_finalize_creative",lambda result:result)
    config={"openai_image_model":"gpt-image-2.5-flare","image_repair_model":"gpt-image-2.5-sunburst","image_repair_quality":"medium"}
    agents.repair_candidate({"images":[{"url":"https://shop.test/source.png"}]},{},
                            "data:image/png;base64,"+base64.b64encode(b"draft").decode(),review(),config)
    assert sdk.images.edit.call_args.kwargs["model"]=="gpt-image-2.5-sunburst"
    assert config["openai_image_model"]=="gpt-image-2.5-flare"


def test_repair_model_settings_validate_before_storage():
    store="config_"+uuid4().hex
    with pytest.raises(ValueError,match="image_repair_model"):
        repo.save_config(store,{"image_repair_model":"invented"})
    with pytest.raises(ValueError,match="image_repair_quality"):
        repo.save_config(store,{"image_repair_quality":"unbounded"})
    assert repo.get_config(store)["image_repair_model"]=="same"
