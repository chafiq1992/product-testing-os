from __future__ import annotations

import json
import os
import re
from typing import Any

from agents import Agent, ModelSettings, Runner

from app.ad_launcher.models import CampaignDraft, ReviewDecision


COPY_MODEL = os.getenv("AD_LAUNCHER_COPY_MODEL", "gpt-5.6-sol")
COPY_REASONING_EFFORT = os.getenv("AD_LAUNCHER_COPY_REASONING_EFFORT", "high")
REVIEW_MODEL = os.getenv("AD_LAUNCHER_REVIEW_MODEL", os.getenv("AD_LAUNCHER_MODEL", "gpt-5.6-sol"))
REVIEW_REASONING_EFFORT = os.getenv("AD_LAUNCHER_REVIEW_REASONING_EFFORT", "high")
# Backwards-compatible display value for jobs created before copy/review model metadata was split.
MODEL = COPY_MODEL
REVIEW_THRESHOLD = int(os.getenv("AD_LAUNCHER_REVIEW_THRESHOLD", "85") or "85")


ANALYZER_INSTRUCTIONS = """
You are the lead ecommerce media buyer, creative strategist, visual analyst, and Arabic direct-response copywriter for a
Moroccan Shopify brand. Produce a production-ready Meta creative-test plan from the supplied Shopify facts, rendered
landing-page evidence, and creative images/video frames.

Hard requirements:
- Use polished Modern Standard Arabic for every customer-facing headline, primary text, and description.
- Use only facts in the supplied evidence. Never invent discounts, delivery times, scarcity, reviews, guarantees,
  clinical outcomes, materials, features, prices, or social proof.
- Avoid Meta policy risks: personal-attribute assertions, shaming, sensational claims, unrealistic outcomes, and
  misleading before/after language.
- Recommend one shared BROAD audience. Country is an operator constraint. This launcher's broad-test standard is ages
  18-65 and all genders; never use interests, behaviours, lookalikes, saved audiences, or custom audiences. Explain who
  is most likely to buy in the rationale without narrowing Meta delivery to that persona.
- The operator requests either two or three uploaded-creative ad sets. Produce exactly expected_uploaded_adset_count
  uploaded ad sets first. They must test meaningfully different message angles while holding audience, destination,
  budget method, and placements constant. In image mode, the application assigns one distinct uploaded image to each
  uploaded ad set in upload order. In carousel or video mode, the supplied carousel/video is shared across those sets.
- When two optional AI-generated ad sets are requested, append exactly two AI-generated image tests after every uploaded
  ad set. For each, write an expert
  image-generation prompt grounded in the real product. Demand photorealistic commercial quality, mobile-first 4:5
  composition, product fidelity, realistic lighting and shadows, strong visual hierarchy, safe margins, no fake people
  or testimonials, no invented product details, no watermark, and no rendered words or prices.
- When optional_adset_origins is empty, do not output any AI-generated ad set.
- Write conversion-focused Arabic headlines and primary text with a concrete product-led hook, natural Moroccan-market
  phrasing in Modern Standard Arabic, scannable benefits, and a clear shopping CTA. Keep it persuasive and specific
  without hype, and make each uploaded-creative angle meaningfully different.
- detected_format must exactly match the operator-provided creative classification.
- destination_is_ready is false if the supplied page evidence is not Arabic, is unavailable, or materially contradicts
  the Shopify product facts.
- Return exactly the requested number of ad sets with exactly the requested origin values.
""".strip()


REVIEWER_INSTRUCTIONS = """
You are the independent senior paid-social reviewer and the final publication gate. You did not write the campaign.
Audit the supplied draft against the original Shopify facts, landing-page evidence, uploaded creative or extracted video
frames, and any generated images.

Reject when a material issue makes an ad false, policy-unsafe, structurally invalid, or impossible to publish: an invented
or contradicted claim, misleading product depiction, non-Arabic or unusably weak copy, malformed text in an image, wrong
destination or product, Meta policy risk, narrow or inconsistent audiences, forbidden targeting, wrong ad-set
count/origin, wrong creative format, missing media, poor mobile composition, or a deterministic blocker supplied by the
application.

Evidence rules:
- Treat machine-verified image dimensions and aspect ratios in generated_creative_evidence as authoritative. Do not infer
  a different aspect ratio from the visual preview.
- Hidden modal, inactive error-state, or incidental sitewide footer text is not a blocker when the Arabic product page,
  product details, price, and purchase CTA are usable and the ads do not rely on that incidental text.
- An included/free-accessory statement is compatible with a fixed-price bundle that visibly includes that accessory.
  Reject it only when Shopify or the destination says the accessory is excluded, costs extra, or is not supplied.
- Separate launch blockers from optimization advice. Put non-blocking imperfections in findings or required_fixes and do
  not reject an otherwise truthful, usable package for them.

Approve only when the package is genuinely ready to create as a controlled Meta creative test. A score below the
configured threshold is always a rejection. Explain findings plainly; do not repair or silently rewrite the draft.
""".strip()


def _settings(reasoning_effort: str) -> ModelSettings:
    return ModelSettings(reasoning={"effort": reasoning_effort, "summary": "auto"}, verbosity="low")


def _reasoning_summaries(result: Any) -> list[str]:
    """Extract API-provided summaries; raw hidden reasoning is never exposed."""
    summaries: list[str] = []
    for item in getattr(result, "new_items", []) or []:
        if getattr(item, "type", "") != "reasoning_item":
            continue
        raw_item = getattr(item, "raw_item", None)
        for summary in getattr(raw_item, "summary", []) or []:
            text = str(getattr(summary, "text", "") or "").strip()
            if text and text not in summaries:
                summaries.append(text[:4000])
    return summaries[:4]


def _agent_input(context: dict[str, Any], image_data_urls: list[str], label: str) -> list[dict[str, Any]]:
    content: list[dict[str, Any]] = [{
        "type": "input_text",
        "text": f"{label}\n" + json.dumps(context, ensure_ascii=False),
    }]
    for image in image_data_urls[:12]:
        if image:
            content.append({"type": "input_image", "image_url": image, "detail": "high"})
    return [{"role": "user", "content": content}]


def analyze_campaign_with_summary(
    context: dict[str, Any], image_data_urls: list[str],
) -> tuple[CampaignDraft, list[str]]:
    agent = Agent(
        name="Paid Social Creative Analyst",
        instructions=ANALYZER_INSTRUCTIONS,
        model=COPY_MODEL,
        model_settings=_settings(COPY_REASONING_EFFORT),
        output_type=CampaignDraft,
    )
    result = Runner.run_sync(
        agent,
        _agent_input(context, image_data_urls, "Build the campaign draft from this verified evidence:"),
        max_turns=4,
    )
    output = result.final_output
    draft = output if isinstance(output, CampaignDraft) else CampaignDraft.model_validate(output)
    return draft, _reasoning_summaries(result)


def analyze_campaign(context: dict[str, Any], image_data_urls: list[str]) -> CampaignDraft:
    draft, _ = analyze_campaign_with_summary(context, image_data_urls)
    return draft


def enforce_broad_audience(draft: CampaignDraft, requested_countries: list[str]) -> CampaignDraft:
    """Apply the launcher's deterministic broad-test controls after AI planning."""
    countries = list(dict.fromkeys(str(code).strip().upper() for code in requested_countries if str(code).strip()))
    audience = draft.audience.model_copy(update={
        "country_codes": countries,
        "age_min": 18,
        "age_max": 65,
        "gender": "all",
    })
    return draft.model_copy(update={"audience": audience})


def enforce_reference_naming(draft: CampaignDraft, campaign_name: str) -> CampaignDraft:
    """Apply the naming hierarchy copied from the operator's proven Meta campaign."""
    normalized_name = str(campaign_name or "").strip().upper()
    if not re.fullmatch(r"\d+[A-Z]*", normalized_name):
        raise ValueError("Campaign names must use a numeric Shopify product ID followed by letters")
    adsets = [
        item.model_copy(update={"name": f"adset {index:02d} parent"})
        for index, item in enumerate(draft.adsets, start=1)
    ]
    return draft.model_copy(update={"campaign_name": normalized_name, "adsets": adsets})


def _arabic_ratio(value: str) -> float:
    arabic = len(re.findall(r"[\u0600-\u06ff]", value or ""))
    letters = len(re.findall(r"[A-Za-z\u0600-\u06ff]", value or ""))
    return arabic / max(letters, 1)


def deterministic_blockers(
    draft: CampaignDraft,
    *,
    expected_adsets: int,
    expected_uploaded_adsets: int,
    expected_format: str,
    requested_countries: list[str],
    generated_media_count: int | None = None,
    generated_media: list[dict[str, Any]] | None = None,
) -> list[str]:
    blockers: list[str] = []
    if len(draft.adsets) != expected_adsets:
        blockers.append(f"Expected {expected_adsets} ad sets; the agent returned {len(draft.adsets)}")
    expected_generated_adsets = expected_adsets - expected_uploaded_adsets
    expected_origins = ["uploaded"] * expected_uploaded_adsets + ["ai_generated"] * expected_generated_adsets
    if [item.origin for item in draft.adsets] != expected_origins:
        blockers.append("Ad-set origins do not match the selected uploaded plus optional two-AI test structure")
    if expected_uploaded_adsets not in {2, 3} or expected_generated_adsets not in {0, 2}:
        blockers.append("The campaign must contain two or three uploaded ad sets, with either zero or two AI tests")
    if draft.creative_analysis.detected_format != expected_format:
        blockers.append("The creative format does not match the uploaded media classification")
    if not draft.landing_analysis.destination_is_ready:
        blockers.append("The Arabic destination page is not ready or could not be verified")
    actual_countries = sorted(draft.audience.country_codes)
    expected_countries = sorted(set(code.upper() for code in requested_countries))
    if actual_countries != expected_countries:
        blockers.append("The agent changed the operator-selected country targeting")
    if (draft.audience.age_min, draft.audience.age_max, draft.audience.gender) != (18, 65, "all"):
        blockers.append("The audience must use the launcher's fully broad ages 18-65 and all-genders standard")
    generated_count = len(generated_media) if generated_media is not None else int(generated_media_count or 0)
    if generated_count != expected_generated_adsets:
        blockers.append(f"Expected {expected_generated_adsets} approved AI-generated image(s); found {generated_count}")
    for index, asset in enumerate(generated_media or [], start=1):
        width = int(asset.get("width") or 0)
        height = int(asset.get("height") or 0)
        if width <= 0 or height <= 0 or width * 5 != height * 4:
            blockers.append(f"AI-generated image {index} is not machine-verified as exact 4:5")
    for index, item in enumerate(draft.adsets, start=1):
        if _arabic_ratio(item.headline_ar) < 0.65:
            blockers.append(f"Ad set {index} headline is not predominantly Arabic")
        if _arabic_ratio(item.primary_text_ar) < 0.65:
            blockers.append(f"Ad set {index} primary text is not predominantly Arabic")
        if _arabic_ratio(item.description_ar) < 0.55:
            blockers.append(f"Ad set {index} description is not predominantly Arabic")
        if item.origin == "ai_generated" and not str(item.image_prompt or "").strip():
            blockers.append(f"Ad set {index} is missing its expert image-generation prompt")
    return list(dict.fromkeys(blockers))


def review_campaign_with_summary(
    context: dict[str, Any],
    draft: CampaignDraft,
    image_data_urls: list[str],
    blockers: list[str],
) -> tuple[ReviewDecision, list[str]]:
    review_context = {
        **context,
        "draft": draft.model_dump(mode="json"),
        "deterministic_blockers": blockers,
        "minimum_approval_score": REVIEW_THRESHOLD,
        "image_order_note": (
            "Images are supplied in this order when present: Shopify product reference, uploaded image(s) or extracted "
            "video frames, then the two generated ad images."
        ),
    }
    agent = Agent(
        name="Independent Meta Ads Reviewer",
        instructions=REVIEWER_INSTRUCTIONS,
        model=REVIEW_MODEL,
        model_settings=_settings(REVIEW_REASONING_EFFORT),
        output_type=ReviewDecision,
    )
    result = Runner.run_sync(
        agent,
        _agent_input(review_context, image_data_urls, "Audit this complete campaign package:"),
        max_turns=4,
    )
    output = result.final_output
    review = output if isinstance(output, ReviewDecision) else ReviewDecision.model_validate(output)
    combined = list(dict.fromkeys(list(review.blockers) + blockers))
    approved = bool(review.approved and review.score >= REVIEW_THRESHOLD and not combined)
    decision = review.model_copy(update={"approved": approved, "blockers": combined})
    return decision, _reasoning_summaries(result)


def review_campaign(
    context: dict[str, Any],
    draft: CampaignDraft,
    image_data_urls: list[str],
    blockers: list[str],
) -> ReviewDecision:
    review, _ = review_campaign_with_summary(context, draft, image_data_urls, blockers)
    return review
