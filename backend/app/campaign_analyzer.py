"""Campaign Analyzer — Two-phase AI analysis pipeline for Meta ad campaigns.

Phase 1: Customer Profiler — identifies target demographics from product data
Phase 2: Campaign Analyst — produces prioritized recommendations + scaling plan
"""

import json
import logging
import os
from tenacity import retry, stop_after_attempt, wait_exponential
from app.integrations.openai_client import client, DEFAULT_LLM_MODEL

logger = logging.getLogger(__name__)

# Model for campaign analysis (both phases)
ANALYZER_MODEL = os.getenv("OPENAI_ANALYZER_MODEL", "gpt-4.1-mini")


# ─────────────── Phase 1: Customer Profiler ───────────────

CUSTOMER_PROFILER_PROMPT = (
    "You are a senior consumer psychologist and market research expert who specializes in identifying "
    "target customer profiles for ecommerce products.\n\n"
    "Task: From the provided PRODUCT DATA (title, description, price, images, category), identify the "
    "exact target customer profile.\n\n"
    "Output Contract — return ONE valid JSON object:\n"
    "{\n"
    '  "target_gender": string ("men"|"women"|"unisex"|"boys"|"girls"|"kids_unisex"),\n'
    '  "age_range": string (e.g. "25-45"),\n'
    '  "buyer_persona": string (who actually buys — e.g. "Parents of toddlers aged 2-5 in Morocco"),\n'
    '  "psychographics": {\n'
    '    "lifestyle": string (e.g. "busy working mothers who value convenience"),\n'
    '    "values": string[] (3-5 core values like "quality", "affordability", "style"),\n'
    '    "pain_points": string[] (3-5 specific pain points this product solves),\n'
    '    "buying_triggers": string[] (3-5 triggers that push them to buy NOW)\n'
    "  },\n"
    '  "market_segment": string (e.g. "mid-range fashion-conscious parents"),\n'
    '  "price_sensitivity": string ("low"|"medium"|"high"),\n'
    '  "purchase_channel_preference": string (e.g. "mobile-first, social media discovery"),\n'
    '  "competing_alternatives": string[] (2-3 alternatives customers typically consider)\n'
    "}\n\n"
    "Rules:\n"
    "- For kids products: the BUYER is the parent, not the child. Profile the parent.\n"
    "- Be extremely specific. No generic personas.\n"
    "- If the product is from Morocco/MENA region, factor in local culture, COD preference, WhatsApp shopping.\n"
    "- Match language of product info.\n"
    "CRITICAL: Return ONLY the JSON object. No markdown, no prose.\n"
)


# ─────────────── Phase 2: Campaign Analyst ───────────────

CAMPAIGN_ANALYST_PROMPT = (
    "You are an elite team of 3 experts working together:\n"
    "1) A Meta Ads specialist with 10+ years managing $100M+ in ad spend\n"
    "2) A direct-response marketing strategist who has scaled 500+ products\n"
    "3) A consumer behavior analyst who understands buying psychology\n\n"
    "Task: Analyze the provided CAMPAIGN DATA (metrics, ad creatives, product info, customer profile) "
    "and produce actionable, prioritized recommendations.\n\n"
    "ANALYSIS FRAMEWORK:\n"
    "- CTR benchmarks: <1% = poor, 1-2% = average, 2-4% = good, >4% = excellent\n"
    "- CPP benchmarks: depends on product price. True CPP should be < 30-40% of product price for profitability\n"
    "- Add-to-cart vs Purchase ratio: >3:1 = landing page or pricing issue, <2:1 = healthy\n"
    "- If spend is low (<$20), note that data may not be statistically significant\n"
    "- CAMPAIGN AGE: Consider how many days the campaign has been running (campaign_age_days in metrics). "
    "Day 1-3 = testing phase (need patience, focus on creative testing). "
    "Day 3-6 = action phase (evaluate initial data, make early optimizations). "
    "Day 6-13 = micro-scaling phase (if metrics are good, start scaling budgets). "
    "Day 13+ = macro-scaling phase (aggressive scaling if unit economics are solid). "
    "Tailor your recommendations to the campaign's current phase.\n\n"
    "Output Contract — return ONE valid JSON object:\n"
    "{\n"
    '  "overall_verdict": string ("kill"|"optimize"|"scale"|"scale_aggressively"),\n'
    '  "confidence_level": string ("low - insufficient data"|"medium"|"high"),\n'
    '  "summary": string (2-3 sentence executive summary),\n'
    '  "recommendations": [\n'
    "    {\n"
    '      "priority": number (1=most critical, 5=nice-to-have),\n'
    '      "category": string ("creative"|"targeting"|"budget"|"pricing"|"landing_page"|"offer"|"ad_copy"|"product"),\n'
    '      "finding": string (what the data shows — be specific with numbers),\n'
    '      "recommendation": string (exactly what to do — be actionable),\n'
    '      "expected_impact": string (estimated improvement)\n'
    "    }\n"
    "  ] (5-10 recommendations, sorted by priority ascending),\n"
    '  "scaling_plan": {\n'
    '    "current_phase": string ("testing"|"early_results"|"optimization"|"scaling"|"mature"),\n'
    '    "verdict": string (detailed reasoning for the overall verdict),\n'
    '    "next_steps": string[] (3-5 concrete, ordered next steps to take),\n'
    '    "budget_recommendation": string (specific budget change recommendation),\n'
    '    "timeline": string (expected timeline for improvements)\n'
    "  },\n"
    '  "creative_analysis": {\n'
    '    "headline_score": number (1-10),\n'
    '    "headline_feedback": string,\n'
    '    "ad_copy_score": number (1-10),\n'
    '    "ad_copy_feedback": string,\n'
    '    "suggested_headlines": string[] (3 improved headlines),\n'
    '    "suggested_ad_copy": string (improved primary text)\n'
    "  },\n"
    '  "customer_alignment": {\n'
    '    "score": number (1-10, how well the current ads align with the target customer),\n'
    '    "gaps": string[] (specific misalignments between ad creative and customer needs),\n'
    '    "opportunities": string[] (untapped angles based on customer profile)\n'
    "  }\n"
    "}\n\n"
    "Rules:\n"
    "- Every recommendation must reference specific numbers from the data.\n"
    "- Sort recommendations from MOST IMPACTFUL to least impactful.\n"
    "- Be brutally honest. If the product should be killed, say so.\n"
    "- For Morocco/MENA: factor in COD, WhatsApp, local shopping patterns.\n"
    "- Suggested headlines: keep emojis, start with a HOOK, ≤12 words.\n"
    "- Match language of the ad copy (if Arabic/French, write suggestions in same language).\n"
    "CRITICAL: Return ONLY the JSON object. No markdown, no prose.\n"
)


# ─────────────── Orchestration ───────────────

@retry(stop=stop_after_attempt(2), wait=wait_exponential(multiplier=1, max=8))
def _call_llm(system_prompt: str, user_content: str, model: str | None = None) -> dict:
    """Single LLM call returning parsed JSON."""
    use_model = model or ANALYZER_MODEL
    logger.info("Campaign Analyzer _call_llm: model=%s, input_len=%d", use_model, len(user_content))
    try:
        resp = client.chat.completions.create(
            model=use_model,
            messages=[
                {"role": "system", "content": "Respond ONLY with a JSON object. No prose, no markdown."},
                {"role": "user", "content": system_prompt + "\n\n" + user_content},
            ],
            response_format={"type": "json_object"},
        )
    except Exception as e:
        logger.error("Campaign Analyzer _call_llm: OpenAI API error: %s", e)
        raise

    text = resp.choices[0].message.content
    logger.info("Campaign Analyzer _call_llm: response_len=%d, finish=%s", len(text or ""), resp.choices[0].finish_reason)
    try:
        return json.loads(text)
    except Exception as e:
        logger.error("Campaign Analyzer _call_llm: JSON parse failed: %s — raw[:500]: %s", e, (text or "")[:500])
        return {}


def analyze_campaign(
    *,
    campaign_metrics: dict,
    ad_creatives: list[dict],
    product_info: dict,
    customer_profile_override: dict | None = None,
    model: str | None = None,
) -> dict:
    """Run the two-phase analysis pipeline.

    Args:
        campaign_metrics: { spend, purchases, cpp, ctr, add_to_cart, true_cpp, shopify_orders, status }
        ad_creatives: [{ headline, primary_text, description, landing_url }]
        product_info: { title, price, description, image_url, handle, product_url }
        customer_profile_override: skip Phase 1 if already known
        model: OpenAI model override

    Returns:
        { customer_profile, recommendations, scaling_plan, creative_analysis, ... }
    """
    use_model = model or ANALYZER_MODEL

    # ── Phase 1: Customer Profiler ──
    if customer_profile_override:
        customer_profile = customer_profile_override
    else:
        product_context = (
            f"PRODUCT DATA:\n"
            f"Title: {product_info.get('title', 'Unknown')}\n"
            f"Price: {product_info.get('price', 'Unknown')}\n"
            f"Description: {(product_info.get('description') or '')[:2000]}\n"
            f"Product URL: {product_info.get('product_url', '')}\n"
            f"Image URL: {product_info.get('image_url', '')}\n"
        )
        logger.info("Campaign Analyzer: Phase 1 (Customer Profiler) with %s", use_model)
        customer_profile = _call_llm(CUSTOMER_PROFILER_PROMPT, product_context, model=use_model)
        if not customer_profile:
            customer_profile = {"error": "Could not generate customer profile"}

    # ── Phase 2: Campaign Analyst ──
    analyst_input = (
        f"CUSTOMER PROFILE:\n{json.dumps(customer_profile, ensure_ascii=False)}\n\n"
        f"CAMPAIGN METRICS:\n{json.dumps(campaign_metrics, ensure_ascii=False)}\n\n"
        f"AD CREATIVES:\n{json.dumps(ad_creatives[:5], ensure_ascii=False)}\n\n"
        f"PRODUCT INFO:\n{json.dumps({k: v for k, v in product_info.items() if k != 'description'}, ensure_ascii=False)}\n"
    )
    logger.info("Campaign Analyzer: Phase 2 (Campaign Analyst) with %s", use_model)
    analysis = _call_llm(CAMPAIGN_ANALYST_PROMPT, analyst_input, model=use_model)

    # Normalize output
    if not isinstance(analysis.get("recommendations"), list):
        analysis["recommendations"] = []
    if not isinstance(analysis.get("scaling_plan"), dict):
        analysis["scaling_plan"] = {}
    if not isinstance(analysis.get("creative_analysis"), dict):
        analysis["creative_analysis"] = {}
    if not isinstance(analysis.get("customer_alignment"), dict):
        analysis["customer_alignment"] = {}

    # Sort recommendations by priority
    try:
        analysis["recommendations"].sort(key=lambda r: int(r.get("priority", 99)))
    except Exception:
        pass

    return {
        "customer_profile": customer_profile,
        **analysis,
    }
