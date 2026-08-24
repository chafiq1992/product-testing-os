from __future__ import annotations

import json
import os
import re
from typing import Any

from agents import Agent, ModelSettings, Runner

from app.ad_launcher.models import CampaignDraft, ReviewDecision


MODEL = os.getenv("AD_LAUNCHER_MODEL", "gpt-5.6-sol")
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
- Recommend one shared BROAD audience. Country is an operator constraint. Choose age and gender only from product fit,
  keep a wide population, and never use interests, behaviours, lookalikes, saved audiences, or custom audiences.
- The first two ad sets use the uploaded creative format. They must test meaningfully different message angles while
  holding audience, destination, budget method, placements, and creative asset constant.
- If exactly four ad sets are requested, ad sets three and four are AI-generated image tests. For each, write an expert
  image-generation prompt grounded in the real product. Demand photorealistic commercial quality, mobile-first 4:5
  composition, product fidelity, realistic lighting and shadows, strong visual hierarchy, safe margins, no fake people
  or testimonials, no invented product details, no watermark, and no rendered words or prices.
- If two ad sets are requested, do not output any AI-generated ad set.
- Keep copy persuasive and specific without hype. Make the opening line carry the hook and end with a clear shopping CTA.
- detected_format must exactly match the operator-provided creative classification.
- destination_is_ready is false if the supplied page evidence is not Arabic, is unavailable, or materially contradicts
  the Shopify product facts.
- Return exactly the requested number of ad sets with exactly the requested origin values.
""".strip()


REVIEWER_INSTRUCTIONS = """
You are the independent senior paid-social reviewer and the final publication gate. You did not write the campaign.
Audit the supplied draft against the original Shopify facts, landing-page evidence, uploaded creative or extracted video
frames, and any generated images.

Reject when any material issue exists: invented or unverifiable claim, misleading product depiction, non-Arabic or weak
Arabic copy, malformed text in an image, wrong destination, landing page not ready in Arabic, Meta policy risk, narrow
audience, interest/custom/lookalike targeting, inconsistent audiences, wrong ad-set count/origin, wrong creative format,
missing media, poor mobile composition, or a deterministic blocker supplied by the application.

Approve only when the package is genuinely ready to create as a controlled Meta creative test. A score below the
configured threshold is always a rejection. Explain findings plainly; do not repair or silently rewrite the draft.
""".strip()


def _settings() -> ModelSettings:
    return ModelSettings(reasoning={"effort": "high"}, verbosity="low")


def _agent_input(context: dict[str, Any], image_data_urls: list[str], label: str) -> list[dict[str, Any]]:
    content: list[dict[str, Any]] = [{
        "type": "input_text",
        "text": f"{label}\n" + json.dumps(context, ensure_ascii=False),
    }]
    for image in image_data_urls[:12]:
        if image:
            content.append({"type": "input_image", "image_url": image, "detail": "high"})
    return [{"role": "user", "content": content}]


def analyze_campaign(context: dict[str, Any], image_data_urls: list[str]) -> CampaignDraft:
    agent = Agent(
        name="Paid Social Creative Analyst",
        instructions=ANALYZER_INSTRUCTIONS,
        model=MODEL,
        model_settings=_settings(),
        output_type=CampaignDraft,
    )
    result = Runner.run_sync(
        agent,
        _agent_input(context, image_data_urls, "Build the campaign draft from this verified evidence:"),
        max_turns=4,
    )
    output = result.final_output
    if isinstance(output, CampaignDraft):
        return output
    return CampaignDraft.model_validate(output)


def _arabic_ratio(value: str) -> float:
    arabic = len(re.findall(r"[\u0600-\u06ff]", value or ""))
    letters = len(re.findall(r"[A-Za-z\u0600-\u06ff]", value or ""))
    return arabic / max(letters, 1)


def deterministic_blockers(
    draft: CampaignDraft,
    *,
    expected_adsets: int,
    expected_format: str,
    requested_countries: list[str],
    generated_media_count: int,
) -> list[str]:
    blockers: list[str] = []
    if len(draft.adsets) != expected_adsets:
        blockers.append(f"Expected {expected_adsets} ad sets; the agent returned {len(draft.adsets)}")
    expected_origins = ["uploaded", "uploaded"] + (["ai_generated", "ai_generated"] if expected_adsets == 4 else [])
    if [item.origin for item in draft.adsets] != expected_origins:
        blockers.append("Ad-set origins do not match the two-uploaded plus optional two-AI test structure")
    if draft.creative_analysis.detected_format != expected_format:
        blockers.append("The creative format does not match the uploaded media classification")
    if not draft.landing_analysis.destination_is_ready:
        blockers.append("The Arabic destination page is not ready or could not be verified")
    actual_countries = sorted(draft.audience.country_codes)
    expected_countries = sorted(set(code.upper() for code in requested_countries))
    if actual_countries != expected_countries:
        blockers.append("The agent changed the operator-selected country targeting")
    if draft.audience.age_max - draft.audience.age_min < 20:
        blockers.append("The recommended age range is too narrow for the required broad test")
    if expected_adsets == 4 and generated_media_count != 2:
        blockers.append("Two approved AI-generated images are required for the four-ad-set mode")
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


def review_campaign(
    context: dict[str, Any],
    draft: CampaignDraft,
    image_data_urls: list[str],
    blockers: list[str],
) -> ReviewDecision:
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
        model=MODEL,
        model_settings=_settings(),
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
    return review.model_copy(update={"approved": approved, "blockers": combined})
