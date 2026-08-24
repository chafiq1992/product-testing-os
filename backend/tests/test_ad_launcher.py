import base64
import json
from datetime import datetime
from io import BytesIO
from uuid import uuid4
from zoneinfo import ZoneInfo

import pytest
from PIL import Image

from app.ad_launcher import agents, meta, repository, service
from app.ad_launcher.models import (
    AdSetDraft,
    AudiencePlan,
    CampaignDraft,
    CreativeAnalysis,
    LandingAnalysis,
    PreparedAdSet,
    PreparedCampaign,
    ProductAnalysis,
)


def _draft(adset_count: int = 2) -> CampaignDraft:
    adsets = [
        AdSetDraft(
            name="اختبار الراحة",
            origin="uploaded",
            angle="الراحة اليومية",
            headline_ar="راحة ترافقك طوال اليوم",
            primary_text_ar="اكتشف منتجا عمليا يمنحك راحة يومية واضحة. تسوقه الآن من متجرنا.",
            description_ar="اختيار عملي للاستخدام اليومي",
            rationale="This angle tests the verified everyday-comfort benefit without adding claims.",
        ),
        AdSetDraft(
            name="اختبار السهولة",
            origin="uploaded",
            angle="سهولة الاستخدام",
            headline_ar="بساطة تجعل يومك أسهل",
            primary_text_ar="تفاصيل عملية وتصميم واضح لتجربة أسهل كل يوم. اكتشف المنتج وتسوق الآن.",
            description_ar="تفاصيل بسيطة وتجربة مريحة",
            rationale="This angle tests practical ease while holding the audience and media constant.",
        ),
    ]
    if adset_count == 4:
        for index in range(2):
            adsets.append(AdSetDraft(
                name=f"اختبار الصورة {index + 1}",
                origin="ai_generated",
                angle="عرض المنتج بوضوح",
                headline_ar="شاهد التفاصيل التي تهمك",
                primary_text_ar="صورة واقعية تبرز المنتج وتفاصيله كما هي. اكتشفه الآن على متجرنا.",
                description_ar="صورة واضحة لقرار أسهل",
                rationale="This isolates a new product-photography direction with the same audience and copy controls.",
                image_prompt="Create a realistic 4:5 studio product photograph with exact product fidelity and no text.",
            ))
    return CampaignDraft(
        campaign_name="اختبار مبيعات المنتج",
        product_analysis=ProductAnalysis(
            product_summary="A verified practical ecommerce product presented for a controlled creative test.",
            primary_buyer="Shoppers who need a practical everyday product.",
            main_problem="The current alternative is inconvenient in everyday use.",
            desired_outcome="A simple and comfortable everyday experience.",
            strongest_verified_benefits=["Practical design", "Suitable for everyday use"],
            verified_proof=["Shopify product description"],
            objections=["Product fit", "Ease of use"],
            prohibited_or_unsupported_claims=["Unverified delivery speed"],
        ),
        landing_analysis=LandingAnalysis(
            language="Arabic",
            message_match="The Arabic page describes the same product and verified practical benefits.",
            conversion_strengths=["Clear product details"],
            conversion_risks=[],
            destination_is_ready=True,
        ),
        creative_analysis=CreativeAnalysis(
            detected_format="image",
            visual_summary="A clear product-first image with an uncluttered composition.",
            strengths=["Product visibility"],
            weaknesses=[],
            mobile_readability="The product remains readable on a mobile feed.",
        ),
        audience=AudiencePlan(
            country_codes=["MA"],
            age_min=21,
            age_max=65,
            gender="all",
            audience_label="Broad Morocco adults",
            rationale="The product can serve a wide adult buyer group in the selected market.",
            broadness_explanation="No interests, behaviours, lookalikes, saved audiences, or custom audiences are used.",
        ),
        adsets=adsets,
        testing_hypothesis="A practical-benefit angle will outperform a general ease-of-use angle with identical delivery controls.",
    )


def _plan(adset_count: int = 2) -> PreparedCampaign:
    draft = _draft(adset_count)
    prepared = [PreparedAdSet(
        **item.model_dump(mode="json"),
        media_type="image",
        media_urls=[f"https://shop.example/assets/{index}.jpg"],
    ) for index, item in enumerate(draft.adsets, start=1)]
    return PreparedCampaign(
        campaign_name=draft.campaign_name,
        product_id="123456789",
        product_title="Verified product",
        landing_url="https://shop.example/ar/products/verified-product",
        store="irrakids",
        timezone="Africa/Casablanca",
        scheduled_start="2026-08-24T23:59:00+01:00",
        total_daily_budget_usd=9.0,
        audience=draft.audience,
        adsets=prepared,
        analysis=draft,
    )


def test_media_classification_is_deterministic():
    assert service.classify_media([{"kind": "image"}]) == "image"
    assert service.classify_media([{"kind": "video"}]) == "video"
    assert service.classify_media([{"kind": "image"}, {"kind": "image"}]) == "carousel"
    with pytest.raises(ValueError):
        service.classify_media([{"kind": "image"}, {"kind": "video"}])
    with pytest.raises(ValueError):
        service.classify_media([{"kind": "video"}, {"kind": "video"}])


def test_schedule_uses_2359_and_rolls_after_cutoff():
    zone = ZoneInfo("Africa/Casablanca")
    before = datetime(2026, 8, 24, 12, 0, tzinfo=zone)
    after = datetime(2026, 8, 24, 23, 59, tzinfo=zone)

    assert service.scheduled_start("Africa/Casablanca", before) == "2026-08-24T23:59:00+01:00"
    assert service.scheduled_start("Africa/Casablanca", after) == "2026-08-25T23:59:00+01:00"


def test_deterministic_review_gate_enforces_structure_and_generated_images():
    assert agents.deterministic_blockers(
        _draft(2),
        expected_adsets=2,
        expected_format="image",
        requested_countries=["MA"],
        generated_media_count=0,
    ) == []

    blockers = agents.deterministic_blockers(
        _draft(4),
        expected_adsets=4,
        expected_format="image",
        requested_countries=["MA"],
        generated_media_count=1,
    )
    assert "Two approved AI-generated images are required for the four-ad-set mode" in blockers


def test_budget_and_targeting_stay_broad_and_manual():
    plan = _plan(4)
    assert meta._budget_minor(9.0, 4) == [225, 225, 225, 225]

    targeting = meta._targeting(plan)
    assert targeting["geo_locations"] == {"countries": ["MA"]}
    assert targeting["targeting_automation"] == {"advantage_audience": 0}
    assert targeting["publisher_platforms"] == ["facebook", "instagram"]
    assert targeting["facebook_positions"] == ["feed"]
    assert targeting["instagram_positions"] == ["stream"]
    assert not any(key in targeting for key in ("interests", "behaviors", "custom_audiences", "lookalike_spec"))


def test_live_launch_rejects_local_media_urls():
    plan = _plan(2)
    plan.adsets[0].media_urls = ["http://localhost:8080/uploads/creative.jpg"]
    with pytest.raises(RuntimeError, match="public HTTPS media URL"):
        meta._require_public_media(plan)


def test_generated_image_crop_is_exactly_four_by_five():
    source = BytesIO()
    Image.new("RGB", (1024, 1536), "#6655aa").save(source, format="PNG")
    cropped = service._crop_to_four_five(source.getvalue())
    with Image.open(BytesIO(cropped)) as image:
        assert image.size == (1024, 1280)


def test_gpt_image_2_edit_omits_unsupported_input_fidelity(monkeypatch):
    reference = BytesIO()
    Image.new("RGB", (64, 64), "#ffffff").save(reference, format="PNG")
    generated = BytesIO()
    Image.new("RGB", (64, 80), "#5544aa").save(generated, format="PNG")
    result_data_url = "data:image/png;base64," + base64.b64encode(generated.getvalue()).decode("ascii")
    captured: dict = {}

    monkeypatch.setenv("AD_LAUNCHER_IMAGE_MODEL", "gpt-image-2")
    monkeypatch.delenv("AD_LAUNCHER_IMAGE_SIZE", raising=False)
    monkeypatch.setattr(service, "_download_reference_image", lambda url: (reference.getvalue(), "image/png"))
    monkeypatch.setattr(service, "_openai_image_result_to_data_url", lambda response: result_data_url)
    monkeypatch.setattr(service.repo, "save_asset", lambda filename, data, content_type: f"/uploads/{filename}")

    def fake_edit(**kwargs):
        captured.update(kwargs)
        return object()

    monkeypatch.setattr(service.client.images, "edit", fake_edit)
    asset, _ = service._generated_image(
        {"images": [{"url": "https://cdn.shopify.com/product.png"}]},
        "Create a faithful product photograph.",
        base_url="https://app.example",
        candidate=1,
    )

    assert captured["model"] == "gpt-image-2"
    assert captured["size"] == "1024x1280"
    assert "input_fidelity" not in captured
    assert asset["content_type"] == "image/png"


def test_launch_claim_is_single_use():
    job_id = str(uuid4())
    repository.create_job("irrakids", job_id, {"product_id": "123"})
    repository.update_job("irrakids", job_id, {"status": "approved"})

    assert repository.claim_job_launch("irrakids", job_id)["status"] == "launching"
    with pytest.raises(ValueError, match="approved campaign"):
        repository.claim_job_launch("irrakids", job_id)


def test_meta_campaign_is_built_paused_then_campaign_activates_last(monkeypatch):
    calls: list[tuple[str, str, dict]] = []
    counters = {"campaigns": 0, "adsets": 0, "adcreatives": 0, "ads": 0}

    monkeypatch.setattr(meta, "_require_config", lambda store: {
        "access_token": "token",
        "ad_account_id": "42",
        "page_id": "84",
        "instagram_actor_id": "",
        "pixel_id": "126",
        "api_version": "v26.0",
    })
    monkeypatch.setattr(meta, "_story_spec", lambda cfg, adset, url: {
        "page_id": cfg["page_id"],
        "link_data": {"link": url, "message": adset.primary_text_ar},
    })

    def fake_request(method, cfg, path, payload=None):
        payload = dict(payload or {})
        calls.append((method, path, payload))
        if method == "GET":
            return {"id": "act_42", "name": "USD account", "account_status": 1, "currency": "USD"}
        edge = path.rsplit("/", 1)[-1]
        if edge in counters:
            counters[edge] += 1
            return {"id": f"{edge}-{counters[edge]}"}
        return {"success": True}

    monkeypatch.setattr(meta, "_request", fake_request)
    result = meta.create_sales_test_campaign(_plan(2))

    campaign_create = next(payload for method, path, payload in calls if path.endswith("/campaigns"))
    assert campaign_create["status"] == "PAUSED"
    assert campaign_create["objective"] == "OUTCOME_SALES"
    assert campaign_create["is_adset_budget_sharing_enabled"] == "false"
    assert "daily_budget" not in campaign_create

    adset_creates = [payload for method, path, payload in calls if path.endswith("/adsets")]
    assert [int(payload["daily_budget"]) for payload in adset_creates] == [450, 450]
    assert all(payload["status"] == "PAUSED" for payload in adset_creates)
    assert all(payload["is_dynamic_creative"] == "false" for payload in adset_creates)
    assert all(json.loads(payload["promoted_object"])["custom_event_type"] == "PURCHASE" for payload in adset_creates)
    assert all(json.loads(payload["targeting"])["targeting_automation"] == {"advantage_audience": 0} for payload in adset_creates)

    ad_creates = [payload for method, path, payload in calls if path.endswith("/ads")]
    assert all(payload["status"] == "PAUSED" for payload in ad_creates)
    active_updates = [(path, payload) for method, path, payload in calls if payload.get("status") == "ACTIVE"]
    assert active_updates[-1] == ("campaigns-1", {"status": "ACTIVE"})
    assert result["campaign_status"] == "ACTIVE"
    assert sum(item["daily_budget_usd"] for item in result["adsets"]) == 9.0
    assert result["automation"] == {
        "catalog": False,
        "campaign_budget": False,
        "advantage_audience": False,
        "advantage_placements": False,
        "creative_feature_opt_outs": True,
        "carousel_reordering": False,
    }


def test_meta_failure_never_activates_campaign(monkeypatch):
    calls: list[tuple[str, str, dict]] = []
    monkeypatch.setattr(meta, "_require_config", lambda store: {
        "access_token": "token", "ad_account_id": "42", "page_id": "84",
        "instagram_actor_id": "", "pixel_id": "126", "api_version": "v26.0",
    })
    monkeypatch.setattr(meta, "_story_spec", lambda cfg, adset, url: {"page_id": "84"})

    def fake_request(method, cfg, path, payload=None):
        payload = dict(payload or {})
        calls.append((method, path, payload))
        if method == "GET":
            return {"account_status": 1, "currency": "USD"}
        if path.endswith("/campaigns"):
            return {"id": "campaign-1"}
        if path.endswith("/adsets"):
            return {"id": "adset-1"}
        if path.endswith("/adcreatives"):
            raise RuntimeError("creative rejected")
        return {"id": "unexpected"}

    monkeypatch.setattr(meta, "_request", fake_request)
    with pytest.raises(RuntimeError, match="left PAUSED"):
        meta.create_sales_test_campaign(_plan(2))

    assert not any(path == "campaign-1" and payload.get("status") == "ACTIVE" for _, path, payload in calls)
