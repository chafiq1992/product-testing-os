import base64
import json
from datetime import datetime
from io import BytesIO
from uuid import uuid4
from zoneinfo import ZoneInfo

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image

from app.ad_launcher import agents, meta, repository, routes, service
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


def _draft(adset_count: int = 3) -> CampaignDraft:
    uploaded_adsets = [
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
        AdSetDraft(
            name="اختبار التفاصيل",
            origin="uploaded",
            angle="تفاصيل المنتج",
            headline_ar="تفاصيل واضحة لاختيار أسهل",
            primary_text_ar="شاهد تفاصيل المنتج العملية بوضوح واختر ما يناسب استخدامك اليومي. تسوقه الآن من متجرنا.",
            description_ar="تفاصيل واضحة واختيار مطمئن",
            rationale="This third angle mirrors the reference campaign while holding media and delivery controls constant.",
        ),
    ]
    uploaded_count = adset_count - 2 if adset_count in {4, 5} else adset_count
    adsets = uploaded_adsets[:uploaded_count]
    if adset_count in {4, 5}:
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
            age_min=18,
            age_max=65,
            gender="all",
            audience_label="Broad Morocco adults",
            rationale="The product can serve a wide adult buyer group in the selected market.",
            broadness_explanation="No interests, behaviours, lookalikes, saved audiences, or custom audiences are used.",
        ),
        adsets=adsets,
        testing_hypothesis="A practical-benefit angle will outperform a general ease-of-use angle with identical delivery controls.",
    )


def _plan(adset_count: int = 3) -> PreparedCampaign:
    draft = _draft(adset_count)
    prepared = [PreparedAdSet(
        **item.model_dump(mode="json"),
        ad_name=f"creative {index:02d}",
        media_type="image",
        media_urls=[f"https://shop.example/assets/{index}.jpg"],
    ) for index, item in enumerate(draft.adsets, start=1)]
    return PreparedCampaign(
        campaign_name="123456789A",
        product_id="123456789",
        product_title="Verified product",
        landing_url="https://shop.example/ar/products/verified-product",
        store="irrakids",
        meta_ad_account_id="42",
        timezone="Africa/Casablanca",
        scheduled_start="2026-08-24T23:59:00+01:00",
        total_daily_budget_usd=9.0 * adset_count,
        audience=draft.audience,
        adsets=prepared,
        analysis=draft,
    )


def test_media_classification_is_deterministic():
    assert service.classify_media([{"kind": "image"}]) == "image"
    assert service.classify_media([{"kind": "video"}]) == "video"
    assert service.classify_media([{"kind": "image"}, {"kind": "image"}]) == "carousel"
    assert service.classify_media(
        [{"kind": "image"}, {"kind": "image"}, {"kind": "image"}],
        selected_format="image",
        uploaded_adsets=3,
    ) == "image"
    with pytest.raises(ValueError, match="exactly 3 images"):
        service.classify_media(
            [{"kind": "image"}], selected_format="image", uploaded_adsets=3
        )
    with pytest.raises(ValueError):
        service.classify_media([{"kind": "image"}, {"kind": "video"}])
    with pytest.raises(ValueError):
        service.classify_media([{"kind": "video"}, {"kind": "video"}])


@pytest.mark.parametrize(
    ("creative_type", "adset_count", "file_count"),
    [("image", 2, 2), ("image", 3, 3), ("carousel", 3, 2)],
)
def test_create_job_accepts_multi_image_ads_and_carousel(
    monkeypatch, creative_type, adset_count, file_count,
):
    captured: dict = {}

    class DormantThread:
        def __init__(self, **kwargs):
            captured["thread"] = kwargs

        def start(self):
            captured["thread_started"] = True

    def fake_create_job(store, job_id, request_data):
        captured["request"] = request_data
        return {"status": "queued"}

    monkeypatch.setattr(routes, "_require_admin", lambda request: {"email": "admin@example.com"})
    monkeypatch.setattr(routes.repo, "save_asset", lambda filename, data, content_type: f"/uploads/{filename}")
    monkeypatch.setattr(routes.repo, "reserve_campaign_name", lambda store, account, product: f"{product}A")
    monkeypatch.setattr(routes.repo, "create_job", fake_create_job)
    monkeypatch.setattr(routes.threading, "Thread", DormantThread)

    app = FastAPI()
    app.include_router(routes.router)
    client = TestClient(app)
    files = [
        ("files", (f"creative-{index}.jpg", f"image-{index}".encode(), "image/jpeg"))
        for index in range(file_count)
    ]

    response = client.post(
        "/api/ad-launcher/jobs",
        data={
            "store": "irrakids",
            "product_id": "123456789",
            "creative_type": creative_type,
            "adset_count": str(adset_count),
            "daily_budget_per_adset_usd": "9",
        },
        files=files,
    )

    assert response.status_code == 200
    assert response.json()["data"]["status"] == "queued"
    assert len(captured["request"]["media"]) == file_count
    assert all(item["content_type"] == "image/jpeg" for item in captured["request"]["media"])
    assert captured["request"]["creative_type"] == creative_type
    assert captured["request"]["adset_count"] == adset_count
    assert captured["request"]["daily_budget_per_adset_usd"] == 9.0
    assert captured["request"]["total_daily_budget_usd"] == 9.0 * adset_count
    assert captured["request"]["campaign_name"].startswith("123456789")


def test_image_media_is_assigned_one_file_per_adset_in_upload_order():
    media = [
        {"url": "https://app.example/uploads/first.jpg"},
        {"url": "https://app.example/uploads/second.jpg"},
        {"url": "https://app.example/uploads/third.jpg"},
    ]

    assert service.uploaded_media_groups(media, "image", 3) == [
        ["https://app.example/uploads/first.jpg"],
        ["https://app.example/uploads/second.jpg"],
        ["https://app.example/uploads/third.jpg"],
    ]
    assert service.uploaded_media_groups(media[:2], "carousel", 3) == [
        ["https://app.example/uploads/first.jpg", "https://app.example/uploads/second.jpg"],
        ["https://app.example/uploads/first.jpg", "https://app.example/uploads/second.jpg"],
        ["https://app.example/uploads/first.jpg", "https://app.example/uploads/second.jpg"],
    ]


def test_campaign_letters_advance_per_product_and_account():
    product_id = str(uuid4().int)[:14]

    assert repository.campaign_letter(1) == "A"
    assert repository.campaign_letter(26) == "Z"
    assert repository.campaign_letter(27) == "AA"
    assert repository.reserve_campaign_name("irrakids", "42", product_id) == f"{product_id}A"
    assert repository.reserve_campaign_name("irrakids", "42", product_id) == f"{product_id}B"
    assert repository.reserve_campaign_name("irrakids", "99", product_id) == f"{product_id}A"


def test_create_job_enforces_nine_dollars_and_selected_creative_type(monkeypatch):
    monkeypatch.setattr(routes, "_require_admin", lambda request: {"email": "admin@example.com"})
    monkeypatch.setattr(routes.repo, "save_asset", lambda filename, data, content_type: f"/uploads/{filename}")
    app = FastAPI()
    app.include_router(routes.router)
    client = TestClient(app)

    wrong_budget = client.post(
        "/api/ad-launcher/jobs",
        data={
            "store": "irrakids",
            "product_id": "123456789",
            "daily_budget_per_adset_usd": "8",
        },
    )
    wrong_format = client.post(
        "/api/ad-launcher/jobs",
        data={
            "store": "irrakids",
            "product_id": "123456789",
            "creative_type": "image",
            "daily_budget_per_adset_usd": "9",
        },
        files=[
            ("files", ("one.jpg", b"one", "image/jpeg")),
            ("files", ("two.jpg", b"two", "image/jpeg")),
        ],
    )

    assert wrong_budget.status_code == 400
    assert "$9.00" in wrong_budget.json()["detail"]
    assert wrong_format.status_code == 400
    assert "Image ad mode requires exactly 3 images" in wrong_format.json()["detail"]


def test_landing_host_accepts_verified_locale_and_www_subdomains():
    allowed = {"irraki.com", "irrakids.myshopify.com"}

    assert service._landing_host_is_allowed("ar.irraki.com", allowed)
    assert service._landing_host_is_allowed("www.irraki.com", allowed)
    assert service._landing_host_is_allowed("irraki.com", allowed)
    assert service._landing_host_is_allowed("AR.IRRAKI.COM.", allowed)
    assert service._landing_host_is_allowed("www.irraki.com", {"ar.irraki.com"})


def test_landing_host_rejects_lookalikes_and_shopify_tenant_subdomains():
    allowed = {"irraki.com", "irrakids.myshopify.com"}

    assert not service._landing_host_is_allowed("irraki.com.evil.example", allowed)
    assert not service._landing_host_is_allowed("fakeirraki.com", allowed)
    assert not service._landing_host_is_allowed("evil.irrakids.myshopify.com", {"irrakids.myshopify.com"})


def test_irrakids_verified_public_domain_is_available_without_runtime_env(monkeypatch):
    monkeypatch.setattr(service, "_get_store_config", lambda store: {"SHOP": "irrakids.myshopify.com"})
    monkeypatch.delenv("SHOPIFY_PUBLIC_DOMAIN_IRRAKIDS", raising=False)
    monkeypatch.delenv("SHOPIFY_PUBLIC_DOMAIN", raising=False)

    assert "irraki.com" in service._allowed_landing_hosts("irrakids", "")


def test_landing_evidence_accepts_irrakids_arabic_storefront(monkeypatch):
    class Response:
        status_code = 200
        url = "https://ar.irraki.com/products/girls-round-neck-t-shirt"
        text = "<html><title>قميص بناتي</title><body>تفاصيل المنتج الأصلية</body></html>"

        @staticmethod
        def raise_for_status():
            return None

    monkeypatch.setattr(service, "_get_store_config", lambda store: {"SHOP": "irrakids.myshopify.com"})
    monkeypatch.setattr(service.requests, "get", lambda *args, **kwargs: Response())

    landing_url, evidence = service._landing_evidence(
        "irrakids",
        {"url": "https://irrakids.myshopify.com/products/girls-round-neck-t-shirt"},
        "https://ar.irraki.com/products/girls-round-neck-t-shirt",
    )

    assert landing_url == "https://ar.irraki.com/products/girls-round-neck-t-shirt"
    assert evidence["http_status"] == 200
    assert evidence["fetch_error"] is None


def test_landing_evidence_excludes_inactive_hidden_error_states(monkeypatch):
    arabic_product_copy = "هذا طقم صيفي مكون من ثلاث قطع بتفاصيل واضحة ومقاسات متعددة. " * 5

    class Response:
        status_code = 200
        url = "https://ar.irraki.com/products/verified-product"
        text = (
            "<html><title>طقم صيفي</title><body>"
            f"<main>{arabic_product_copy}</main>"
            "<div class='cod-modal-overlay cod-hidden'>"
            "Order creation was not successful. Please contact support."
            "</div></body></html>"
        )

        @staticmethod
        def raise_for_status():
            return None

    monkeypatch.setattr(service, "_get_store_config", lambda store: {"SHOP": "irrakids.myshopify.com"})
    monkeypatch.setattr(service.requests, "get", lambda *args, **kwargs: Response())

    _, evidence = service._landing_evidence(
        "irrakids",
        {"url": "https://irrakids.myshopify.com/products/verified-product"},
        "https://ar.irraki.com/products/verified-product",
    )

    assert "Order creation was not successful" not in evidence["text_excerpt"]
    assert evidence["arabic_ready_hint"] is True


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
        expected_uploaded_adsets=2,
        expected_format="image",
        requested_countries=["MA"],
        generated_media_count=0,
    ) == []
    assert agents.deterministic_blockers(
        _draft(3),
        expected_adsets=3,
        expected_uploaded_adsets=3,
        expected_format="image",
        requested_countries=["MA"],
        generated_media_count=0,
    ) == []

    blockers = agents.deterministic_blockers(
        _draft(5),
        expected_adsets=5,
        expected_uploaded_adsets=3,
        expected_format="image",
        requested_countries=["MA"],
        generated_media_count=1,
    )
    assert "Expected 2 approved AI-generated image(s); found 1" in blockers

    assert agents.deterministic_blockers(
        _draft(4),
        expected_adsets=4,
        expected_uploaded_adsets=2,
        expected_format="image",
        requested_countries=["MA"],
        generated_media=[
            {"width": 1024, "height": 1280},
            {"width": 1024, "height": 1280},
        ],
    ) == []


def test_copy_agent_is_pinned_to_gpt_5_6_sol_with_high_reasoning(monkeypatch):
    captured: dict = {}

    class FakeAgent:
        def __init__(self, **kwargs):
            captured.update(kwargs)

    class Result:
        final_output = _draft(3)

    monkeypatch.setattr(agents, "Agent", FakeAgent)
    monkeypatch.setattr(agents.Runner, "run_sync", lambda *args, **kwargs: Result())

    agents.analyze_campaign({}, [])

    assert captured["model"] == "gpt-5.6-sol"
    assert captured["model_settings"].reasoning.effort == "high"
    assert captured["model_settings"].reasoning.summary == "auto"


def test_only_api_provided_reasoning_summaries_are_exposed():
    class Summary:
        text = "Compared the product facts with the uploaded carousel and selected two distinct angles."

    class RawItem:
        summary = [Summary()]

    class ReasoningItem:
        type = "reasoning_item"
        raw_item = RawItem()

    class MessageItem:
        type = "message_output_item"

    class Result:
        new_items = [ReasoningItem(), MessageItem()]

    assert agents._reasoning_summaries(Result()) == [
        "Compared the product facts with the uploaded carousel and selected two distinct angles."
    ]


def test_broad_audience_controls_are_enforced_after_ai_planning():
    draft = _draft(3)
    draft.audience = draft.audience.model_copy(update={"age_min": 18, "age_max": 54, "gender": "women"})

    controlled = agents.enforce_broad_audience(draft, ["ma"])

    assert controlled.audience.country_codes == ["MA"]
    assert controlled.audience.age_min == 18
    assert controlled.audience.age_max == 65
    assert controlled.audience.gender == "all"


def test_reference_campaign_naming_is_deterministic():
    named = agents.enforce_reference_naming(_draft(3), "15043841786232a")

    assert named.campaign_name == "15043841786232A"
    assert [item.name for item in named.adsets] == [
        "adset 01 parent",
        "adset 02 parent",
        "adset 03 parent",
    ]


def test_generated_media_dimensions_are_machine_checked():
    valid = agents.deterministic_blockers(
        _draft(5),
        expected_adsets=5,
        expected_uploaded_adsets=3,
        expected_format="image",
        requested_countries=["MA"],
        generated_media=[
            {"width": 1024, "height": 1280},
            {"width": 1024, "height": 1280},
        ],
    )
    invalid = agents.deterministic_blockers(
        _draft(5),
        expected_adsets=5,
        expected_uploaded_adsets=3,
        expected_format="image",
        requested_countries=["MA"],
        generated_media=[
            {"width": 768, "height": 1024},
            {"width": 1024, "height": 1280},
        ],
    )

    assert not any("4:5" in blocker for blocker in valid)
    assert "AI-generated image 1 is not machine-verified as exact 4:5" in invalid


def test_budget_and_targeting_stay_broad_and_manual():
    plan = _plan(3)
    assert meta._budget_minor(27.0, 3) == [900, 900, 900]

    targeting = meta._targeting(plan)
    assert targeting["geo_locations"] == {"countries": ["MA"]}
    assert targeting["targeting_automation"] == {"advantage_audience": 0}
    assert targeting["publisher_platforms"] == ["facebook", "instagram"]
    assert targeting["facebook_positions"] == ["feed"]
    assert targeting["instagram_positions"] == ["stream"]
    assert not any(key in targeting for key in ("interests", "behaviors", "custom_audiences", "lookalike_spec"))


def test_live_launch_rejects_local_media_urls():
    plan = _plan(3)
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
    assert asset["width"] == 64
    assert asset["height"] == 80


def test_launch_claim_is_single_use():
    job_id = str(uuid4())
    repository.create_job("irrakids", job_id, {"product_id": "123"})
    repository.update_job("irrakids", job_id, {"status": "approved"})

    assert repository.claim_job_launch("irrakids", job_id)["status"] == "launching"
    with pytest.raises(ValueError, match="approved campaign"):
        repository.claim_job_launch("irrakids", job_id)


def test_job_activity_records_safe_progress_summaries():
    job_id = str(uuid4())
    repository.create_job("irranova", job_id, {"product_id": "123", "meta_ad_account_id": "99"})
    repository.add_activity(
        "irranova",
        job_id,
        stage="creative_analysis",
        title="Creative strategy completed",
        summary="Two evidence-grounded angles were selected.",
        source="structured_output_summary",
    )

    job = repository.get_job("irranova", job_id)

    assert job["store"] == "irranova"
    assert [item["stage"] for item in job["activity"]] == ["queued", "creative_analysis"]
    assert job["activity"][-1]["summary"] == "Two evidence-grounded angles were selected."


def test_rejected_job_resume_seeds_completed_checkpoints():
    job_id = str(uuid4())
    request_data = {
        "product_id": "987654321",
        "media": [{"kind": "image", "filename": "saved.jpg", "url": "https://app.example/uploads/saved.jpg"}],
        "countries": ["MA"],
    }
    repository.create_job("irrakids", job_id, request_data)
    repository.update_job("irrakids", job_id, {
        "status": "rejected",
        "result": {
            "product": {"numeric_id": "987654321", "title": "Saved product"},
            "landing_page": {"arabic_ready_hint": True},
            "generated_media": [],
            "plan": {
                "landing_url": "https://ar.irraki.com/products/saved-product",
                "analysis": _draft(3).model_dump(mode="json"),
            },
            "reasoning_summaries": {"creative_strategy": ["Selected three controlled angles."]},
        },
    })

    resumed = service.retry_job(job_id, "irrakids")

    assert resumed["status"] == "queued"
    assert resumed["result"] is None
    assert resumed["checkpoint"]["product"]["title"] == "Saved product"
    assert resumed["checkpoint"]["media_format"] == "image"
    assert resumed["checkpoint"]["draft"]["campaign_name"] == _draft(3).campaign_name
    assert resumed["retry_count"] == 1


def test_launch_failed_retry_keeps_approved_plan_and_skips_agent_work():
    job_id = str(uuid4())
    legacy_plan = _plan(3).model_dump(mode="json")
    legacy_plan["campaign_name"] = "123456789"
    legacy_plan["total_daily_budget_usd"] = 9.0
    saved_result = {
        "plan": legacy_plan,
        "review": {"approved": True, "score": 92},
        "reasoning_summaries": {"review": ["Approved controlled campaign."]},
    }
    repository.create_job("irrakids", job_id, {"product_id": "123456789", "auto_launch": True})
    repository.update_job("irrakids", job_id, {
        "status": "launch_failed",
        "stage": "meta_failed_paused",
        "result": saved_result,
        "error": {"type": "RuntimeError", "message": "Meta image upload failed"},
    })

    resumed = service.retry_job(job_id, "irrakids")

    assert resumed["status"] == "approved"
    assert resumed["stage"] == "meta_retry_queued"
    assert resumed["result"]["plan"]["campaign_name"].startswith("123456789")
    assert resumed["result"]["plan"]["campaign_name"] != "123456789"
    assert resumed["result"]["plan"]["total_daily_budget_usd"] == 27.0
    assert resumed["request"]["daily_budget_per_adset_usd"] == 9.0
    assert resumed["error"] is None
    assert resumed["retry_count"] == 1


def test_launch_failure_persists_paused_meta_hierarchy_for_retry(monkeypatch):
    job_id = str(uuid4())
    saved_result = {
        "plan": _plan(3).model_dump(mode="json"),
        "review": {"approved": True, "score": 92},
    }
    partial = {
        "campaign_id": "campaign-42",
        "campaign_name": "123456789A",
        "campaign_status": "PAUSED",
        "draft_saved": True,
        "adsets": [
            {"index": index, "adset_id": f"adset-{index}", "adset_name": f"adset {index:02d} parent"}
            for index in range(1, 4)
        ],
    }
    repository.create_job("irrakids", job_id, {
        "product_id": "123456789",
        "campaign_name": "123456789A",
        "adset_count": 3,
        "daily_budget_per_adset_usd": 9,
    })
    repository.update_job("irrakids", job_id, {"status": "approved", "result": saved_result})

    def fail_with_saved_draft(plan, existing=None):
        assert existing == {}
        raise meta.MetaCampaignSavedError("creative capability rejected", partial)

    monkeypatch.setattr(meta, "create_sales_test_campaign", fail_with_saved_draft)

    with pytest.raises(meta.MetaCampaignSavedError):
        service.launch_job(job_id, "irrakids")

    failed = repository.get_job("irrakids", job_id)
    assert failed["status"] == "launch_failed"
    assert failed["stage"] == "meta_draft_saved"
    assert failed["result"]["meta"]["campaign_id"] == "campaign-42"
    assert failed["result"]["meta"]["draft_saved"] is True
    assert "3 saved ad set(s)" in failed["activity"][-1]["summary"]

    resumed = service.retry_job(job_id, "irrakids")
    assert resumed["status"] == "approved"
    assert resumed["result"]["meta"]["campaign_id"] == "campaign-42"

    def finish_saved_draft(plan, existing=None):
        assert existing["campaign_id"] == "campaign-42"
        return {**existing, "campaign_status": "ACTIVE", "draft_saved": False}

    monkeypatch.setattr(meta, "create_sales_test_campaign", finish_saved_draft)
    launched = service.launch_job(job_id, "irrakids")
    assert launched["campaign_id"] == "campaign-42"
    assert launched["campaign_status"] == "ACTIVE"
    assert repository.get_job("irrakids", job_id)["status"] == "launched"


def test_product_cards_keep_latest_setup_per_store_product():
    product_id = "777888999"
    first_id = str(uuid4())
    latest_id = str(uuid4())
    repository.create_job("mmd", first_id, {"product_id": product_id, "media": [{"kind": "image"}]})
    repository.create_job("mmd", latest_id, {
        "product_id": product_id,
        "meta_ad_account_id": "55",
        "total_daily_budget_usd": 12,
        "media": [{"kind": "image", "url": "https://app.example/latest.jpg"}],
    })
    repository.update_job("mmd", latest_id, {
        "status": "approved",
        "result": {"product": {"title": "Latest saved setup", "images": []}, "review": {"score": 91}},
    })

    cards = repository.list_product_cards("mmd")
    matching = [card for card in cards if card["product_id"] == product_id]

    assert len(matching) == 1
    assert matching[0]["job_id"] == latest_id
    assert matching[0]["product_title"] == "Latest saved setup"
    assert matching[0]["request"]["meta_ad_account_id"] == "55"


def test_meta_connection_discovers_accounts_and_respects_selection(monkeypatch):
    monkeypatch.setenv("META_ACCESS_TOKEN_IRRAKIDS", "token")
    monkeypatch.setenv("META_AD_ACCOUNT_ID_IRRAKIDS", "42")
    monkeypatch.setenv("META_PAGE_ID_IRRAKIDS", "84")
    monkeypatch.setenv("META_PIXEL_ID_IRRAKIDS", "126")

    def fake_request(method, cfg, path, payload=None):
        if path == "me/adaccounts":
            return {"data": [
                {"id": "act_42", "name": "Store One", "account_status": 1, "currency": "USD"},
                {"id": "act_99", "name": "Store Two", "account_status": 1, "currency": "USD"},
            ]}
        assert path == "act_99"
        return {"id": "act_99", "name": "Store Two", "account_status": 1, "currency": "USD"}

    monkeypatch.setattr(meta, "_request", fake_request)
    result = meta.connection("irrakids", "99")

    assert result["ready"] is True
    assert result["selected_account_id"] == "99"
    assert [item["account_id"] for item in result["accounts"]] == ["42", "99"]
    assert result["account"]["name"] == "Store Two"


def test_meta_development_mode_error_has_actionable_live_app_guidance():
    class Response:
        status_code = 400
        text = "Bad request"

        @staticmethod
        def json():
            return {"error": {
                "message": "Ads creative post was created by an app that is in development mode.",
                "code": 100,
                "error_subcode": 1885183,
            }}

    error = meta._safe_error(Response(), "act_42/adcreatives")

    assert "Development mode" in str(error)
    assert "Live/Public" in str(error)
    assert "regenerate the access token" in str(error)
    assert "cannot bypass" in str(error)


def test_meta_image_upload_sends_multipart_bytes_not_remote_url(monkeypatch):
    class ImageResponse:
        ok = True
        headers = {"content-type": "image/jpeg"}

        @staticmethod
        def iter_content(chunk_size=0):
            return iter([b"prepared-image-bytes"])

    captured: dict = {}
    monkeypatch.setattr(meta.requests, "get", lambda *args, **kwargs: ImageResponse())

    def fake_request(method, cfg, path, payload=None, *, files=None):
        captured.update({"method": method, "path": path, "payload": payload, "files": files})
        return {"images": {"creative.jpg": {"hash": "verified-hash"}}}

    monkeypatch.setattr(meta, "_request", fake_request)
    image_hash = meta._upload_image({"ad_account_id": "42"}, "https://app.example/uploads/creative.jpg")

    assert image_hash == "verified-hash"
    assert captured["path"] == "act_42/adimages"
    assert captured["payload"] is None
    filename, data, content_type = captured["files"]["filename"]
    assert filename == "creative.jpg"
    assert data == b"prepared-image-bytes"
    assert content_type == "image/jpeg"


def test_meta_media_failure_keeps_complete_paused_hierarchy(monkeypatch):
    calls: list[tuple[str, str]] = []
    adset_count = 0
    monkeypatch.setattr(meta, "_require_config", lambda store, ad_account_id=None: {
        "access_token": "token", "ad_account_id": "42", "page_id": "84",
        "instagram_actor_id": "", "pixel_id": "126", "api_version": "v26.0",
    })

    def fake_request(method, cfg, path, payload=None):
        nonlocal adset_count
        calls.append((method, path))
        if method == "GET":
            return {"account_status": 1, "currency": "USD"}
        if path.endswith("/campaigns"):
            return {"id": "campaign-1"}
        if path.endswith("/adsets"):
            adset_count += 1
            return {"id": f"adset-{adset_count}"}
        return {"success": True}

    monkeypatch.setattr(meta, "_request", fake_request)
    monkeypatch.setattr(meta, "_prepare_media", lambda cfg, plan: (_ for _ in ()).throw(
        RuntimeError("image upload capability rejected")
    ))

    with pytest.raises(meta.MetaCampaignSavedError, match="saved PAUSED") as captured:
        meta.create_sales_test_campaign(_plan(3))

    partial = captured.value.partial_result
    assert partial["campaign_id"] == "campaign-1"
    assert partial["campaign_name"] == "123456789A"
    assert partial["campaign_status"] == "PAUSED"
    assert partial["draft_saved"] is True
    assert [item["adset_id"] for item in partial["adsets"]] == ["adset-1", "adset-2", "adset-3"]
    assert calls[0] == ("GET", "act_42")
    assert sum(path.endswith("/campaigns") for _, path in calls) == 1
    assert sum(path.endswith("/adsets") for _, path in calls) == 3
    assert not any(path.endswith(("/adcreatives", "/ads")) for _, path in calls)


def test_meta_campaign_is_built_paused_then_campaign_activates_last(monkeypatch):
    calls: list[tuple[str, str, dict]] = []
    counters = {"campaigns": 0, "adsets": 0, "adcreatives": 0, "ads": 0}
    selected: dict[str, str | None] = {}

    def fake_config(store, ad_account_id=None):
        selected.update({"store": store, "ad_account_id": ad_account_id})
        return {
            "access_token": "token",
            "ad_account_id": str(ad_account_id or "42"),
            "page_id": "84",
            "instagram_actor_id": "",
            "pixel_id": "126",
            "api_version": "v26.0",
        }

    monkeypatch.setattr(meta, "_require_config", fake_config)
    handles = {"images": {url: f"hash-{index}" for index, url in enumerate(
        [item.media_urls[0] for item in _plan(3).adsets], start=1
    )}, "videos": {}}
    monkeypatch.setattr(meta, "_prepare_media", lambda cfg, plan: handles)
    monkeypatch.setattr(meta, "_story_spec", lambda cfg, adset, url, media_handles: {
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
    result = meta.create_sales_test_campaign(_plan(3))

    assert selected == {"store": "irrakids", "ad_account_id": "42"}
    campaign_create = next(payload for method, path, payload in calls if path.endswith("/campaigns"))
    assert campaign_create["status"] == "PAUSED"
    assert campaign_create["name"] == "123456789A"
    assert campaign_create["objective"] == "OUTCOME_SALES"
    assert campaign_create["is_adset_budget_sharing_enabled"] == "false"
    assert "daily_budget" not in campaign_create

    adset_creates = [payload for method, path, payload in calls if path.endswith("/adsets")]
    assert [payload["name"] for payload in adset_creates] == [
        "adset 01 parent",
        "adset 02 parent",
        "adset 03 parent",
    ]
    assert [int(payload["daily_budget"]) for payload in adset_creates] == [900, 900, 900]
    assert all(payload["status"] == "PAUSED" for payload in adset_creates)
    assert all(payload["is_dynamic_creative"] == "false" for payload in adset_creates)
    assert all(json.loads(payload["promoted_object"])["custom_event_type"] == "PURCHASE" for payload in adset_creates)
    assert all(json.loads(payload["targeting"])["targeting_automation"] == {"advantage_audience": 0} for payload in adset_creates)

    ad_creates = [payload for method, path, payload in calls if path.endswith("/ads")]
    creative_creates = [payload for method, path, payload in calls if path.endswith("/adcreatives")]
    assert [payload["name"] for payload in creative_creates] == ["creative 01", "creative 02", "creative 03"]
    assert [payload["name"] for payload in ad_creates] == ["creative 01", "creative 02", "creative 03"]
    campaign_position = next(index for index, (_, path, _) in enumerate(calls) if path.endswith("/campaigns"))
    adset_positions = [index for index, (_, path, _) in enumerate(calls) if path.endswith("/adsets")]
    creative_positions = [index for index, (_, path, _) in enumerate(calls) if path.endswith("/adcreatives")]
    assert adset_positions and creative_positions
    assert campaign_position < min(adset_positions) < min(creative_positions)
    assert all(payload["status"] == "PAUSED" for payload in ad_creates)
    active_updates = [(path, payload) for method, path, payload in calls if payload.get("status") == "ACTIVE"]
    assert active_updates[-1] == ("campaigns-1", {"status": "ACTIVE"})
    assert result["campaign_status"] == "ACTIVE"
    assert result["campaign_name"] == "123456789A"
    assert result["draft_saved"] is False
    assert sum(item["daily_budget_usd"] for item in result["adsets"]) == 27.0
    assert result["automation"] == {
        "catalog": False,
        "campaign_budget": False,
        "advantage_audience": False,
        "advantage_placements": False,
        "creative_feature_opt_outs": True,
        "carousel_reordering": False,
    }


def test_meta_creative_failure_saves_and_retry_resumes_same_hierarchy(monkeypatch):
    calls: list[tuple[str, str, dict]] = []
    blocked = True
    counters = {"campaigns": 0, "adsets": 0, "adcreatives": 0, "ads": 0}
    monkeypatch.setattr(meta, "_require_config", lambda store, ad_account_id=None: {
        "access_token": "token", "ad_account_id": "42", "page_id": "84",
        "instagram_actor_id": "", "pixel_id": "126", "api_version": "v26.0",
    })
    monkeypatch.setattr(meta, "_prepare_media", lambda cfg, plan: {"images": {}, "videos": {}})
    monkeypatch.setattr(meta, "_story_spec", lambda cfg, adset, url, media_handles: {"page_id": "84"})

    def fake_request(method, cfg, path, payload=None):
        nonlocal blocked
        payload = dict(payload or {})
        calls.append((method, path, payload))
        if method == "GET":
            return {"account_status": 1, "currency": "USD"}
        if path.endswith("/adcreatives"):
            if blocked:
                raise RuntimeError("development mode creative rejected")
            counters["adcreatives"] += 1
            return {"id": f"adcreatives-{counters['adcreatives']}"}
        edge = path.rsplit("/", 1)[-1]
        if edge in counters:
            counters[edge] += 1
            return {"id": f"{edge}-{counters[edge]}"}
        return {"success": True}

    monkeypatch.setattr(meta, "_request", fake_request)
    with pytest.raises(meta.MetaCampaignSavedError, match="development mode creative rejected") as captured:
        meta.create_sales_test_campaign(_plan(3))

    partial = captured.value.partial_result
    assert partial["campaign_id"] == "campaigns-1"
    assert [item["adset_id"] for item in partial["adsets"]] == ["adsets-1", "adsets-2", "adsets-3"]
    assert not any(path.endswith("/ads") for _, path, _ in calls)

    blocked = False
    calls.clear()
    result = meta.create_sales_test_campaign(_plan(3), existing=partial)

    assert result["campaign_id"] == "campaigns-1"
    assert result["campaign_status"] == "ACTIVE"
    assert counters["campaigns"] == 1
    assert counters["adsets"] == 3
    assert sum(path.endswith("/adcreatives") for _, path, _ in calls) == 3
    assert sum(path.endswith("/ads") for _, path, _ in calls) == 3
