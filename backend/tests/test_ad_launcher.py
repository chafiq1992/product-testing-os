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
        meta_ad_account_id="42",
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


def test_copy_agent_is_pinned_to_gpt_5_6_sol_with_high_reasoning(monkeypatch):
    captured: dict = {}

    class FakeAgent:
        def __init__(self, **kwargs):
            captured.update(kwargs)

    class Result:
        final_output = _draft(2)

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
    draft = _draft(2)
    draft.audience = draft.audience.model_copy(update={"age_min": 18, "age_max": 54, "gender": "women"})

    controlled = agents.enforce_broad_audience(draft, ["ma"])

    assert controlled.audience.country_codes == ["MA"]
    assert controlled.audience.age_min == 18
    assert controlled.audience.age_max == 65
    assert controlled.audience.gender == "all"


def test_generated_media_dimensions_are_machine_checked():
    valid = agents.deterministic_blockers(
        _draft(4),
        expected_adsets=4,
        expected_format="image",
        requested_countries=["MA"],
        generated_media=[
            {"width": 1024, "height": 1280},
            {"width": 1024, "height": 1280},
        ],
    )
    invalid = agents.deterministic_blockers(
        _draft(4),
        expected_adsets=4,
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
                "analysis": _draft(2).model_dump(mode="json"),
            },
            "reasoning_summaries": {"creative_strategy": ["Selected two controlled angles."]},
        },
    })

    resumed = service.retry_job(job_id, "irrakids")

    assert resumed["status"] == "queued"
    assert resumed["result"] is None
    assert resumed["checkpoint"]["product"]["title"] == "Saved product"
    assert resumed["checkpoint"]["media_format"] == "image"
    assert resumed["checkpoint"]["draft"]["campaign_name"] == _draft(2).campaign_name
    assert resumed["retry_count"] == 1


def test_launch_failed_retry_keeps_approved_plan_and_skips_agent_work():
    job_id = str(uuid4())
    saved_result = {
        "plan": _plan(2).model_dump(mode="json"),
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
    assert resumed["result"] == saved_result
    assert resumed["error"] is None
    assert resumed["retry_count"] == 1


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


def test_meta_media_preflight_fails_before_campaign_creation(monkeypatch):
    calls: list[tuple[str, str]] = []
    monkeypatch.setattr(meta, "_require_config", lambda store, ad_account_id=None: {
        "access_token": "token", "ad_account_id": "42", "page_id": "84",
        "instagram_actor_id": "", "pixel_id": "126", "api_version": "v26.0",
    })

    def fake_request(method, cfg, path, payload=None):
        calls.append((method, path))
        return {"account_status": 1, "currency": "USD"}

    monkeypatch.setattr(meta, "_request", fake_request)
    monkeypatch.setattr(meta, "_prepare_media", lambda cfg, plan: (_ for _ in ()).throw(
        RuntimeError("image upload capability rejected")
    ))

    with pytest.raises(RuntimeError, match="image upload capability rejected"):
        meta.create_sales_test_campaign(_plan(2))

    assert calls == [("GET", "act_42")]


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
        [item.media_urls[0] for item in _plan(2).adsets], start=1
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
    result = meta.create_sales_test_campaign(_plan(2))

    assert selected == {"store": "irrakids", "ad_account_id": "42"}
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
    monkeypatch.setattr(meta, "_require_config", lambda store, ad_account_id=None: {
        "access_token": "token", "ad_account_id": "42", "page_id": "84",
        "instagram_actor_id": "", "pixel_id": "126", "api_version": "v26.0",
    })
    monkeypatch.setattr(meta, "_prepare_media", lambda cfg, plan: {"images": {}, "videos": {}})
    monkeypatch.setattr(meta, "_story_spec", lambda cfg, adset, url, media_handles: {"page_id": "84"})

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
