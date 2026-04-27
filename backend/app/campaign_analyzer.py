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
    previous_analysis_context: str | None = None,
) -> dict:
    """Run the two-phase analysis pipeline.

    Args:
        campaign_metrics: { spend, purchases, cpp, ctr, add_to_cart, true_cpp, shopify_orders, status }
        ad_creatives: [{ headline, primary_text, description, landing_url }]
        product_info: { title, price, description, image_url, handle, product_url }
        customer_profile_override: skip Phase 1 if already known
        model: OpenAI model override
        previous_analysis_context: formatted string describing previous analysis + implementation status

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

    # Inject previous analysis context for feedback loop
    if previous_analysis_context:
        analyst_input += (
            f"\n\n--- FEEDBACK LOOP: PREVIOUS ANALYSIS & IMPLEMENTATION STATUS ---\n"
            f"{previous_analysis_context}\n"
            f"---\n"
            f"IMPORTANT INSTRUCTIONS FOR THIS FOLLOW-UP ANALYSIS:\n"
            f"1. Review the IMPLEMENTED items above. Evaluate whether those changes likely improved performance based on the current metrics.\n"
            f"2. For NOT YET IMPLEMENTED items, decide if they are still relevant given the current data — keep, update, or drop them.\n"
            f"3. DO NOT repeat recommendations that were already implemented unless they need further iteration.\n"
            f"4. Provide NEW, more advanced recommendations building on what was already done.\n"
            f"5. In your summary, briefly mention what progress was made since the last analysis.\n"
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


# ─────────────── Action Task Agent ───────────────

ACTION_TASK_AGENT_PROMPT = (
    "You are a senior Ad Operations Manager and Task Planner who manages a team of employees "
    "running Meta (Facebook/Instagram) ad campaigns for an ecommerce business.\n\n"
    "Task: You have just received AI analysis reports for MULTIPLE campaigns. "
    "Your job is to distill ALL the analyses into a CLEAR, ACTIONABLE task list that your "
    "management employees can follow immediately.\n\n"
    "RULES FOR TASK CREATION:\n"
    "1. CROSS-REFERENCE campaigns: if 3 campaigns all need better creatives, create ONE task "
    "   that references all 3 instead of 3 separate tasks.\n"
    "2. PRIORITIZE by impact: tasks that save money or increase revenue come first.\n"
    "3. BE SPECIFIC: 'Increase budget for campaign X from $20 to $40' not 'adjust budgets'.\n"
    "4. KILL decisions first: if any campaign should be killed, that's always top priority.\n"
    "5. Group SCALING actions: if multiple campaigns should scale, bundle them.\n"
    "6. Include INVENTORY alerts: if stock is low for a product being advertised, flag it.\n"
    "7. Maximum 15 tasks. Merge similar ones aggressively.\n"
    "8. Each task must be completable by ONE person in ONE sitting.\n"
    "9. Match the language of the campaigns. If the campaigns are Arabic/French, write the employee-facing "
    "   explanation mainly in Arabic.\n"
    "10. Keep technical ad terms in English so employees do not miss them: CTR, CPP, CBO, COD, CPA, ROAS, "
    "    bundle, offer, upsell, downsell, creative, ad copy, landing page, budget, campaign, ad set.\n"
    "11. The description must be easy to execute, not one dense paragraph. Format it as 3-5 short lines inside "
    "    the JSON string, separated with newline characters. Use a structure like:\n"
    "    - Action: what to change now (use Arabic label \"الخطوة\" for Arabic tasks)\n"
    "    - Campaigns: campaigns or IDs affected (use Arabic label \"الحملات\" for Arabic tasks)\n"
    "    - Details: exact offer/copy/budget/targeting instruction (use Arabic label \"التفاصيل\" for Arabic tasks)\n"
    "    - Check: what to verify after the change (use Arabic label \"المتابعة\" for Arabic tasks)\n"
    "12. Do not mix too many languages in one sentence. Arabic explanation is preferred; English is only for "
    "    technical advertising terms and exact campaign/ad labels.\n\n"
    "Output Contract — return ONE valid JSON object:\n"
    "{\n"
    '  "summary": string (2-3 sentence overview of the portfolio health),\n'
    '  "urgent_count": number (how many tasks are urgent/P1),\n'
    '  "tasks": [\n'
    "    {\n"
    '      "id": string (unique, e.g. "task_1"),\n'
    '      "priority": number (1=most urgent, 5=nice-to-have),\n'
    '      "urgency": string ("immediate"|"today"|"this_week"|"when_possible"),\n'
    '      "category": string ("kill"|"scale"|"creative"|"budget"|"targeting"|"inventory"|"pricing"|"optimization"|"testing"),\n'
    '      "title": string (short action title, max 10 words),\n'
    '      "description": string (detailed instructions, be very specific),\n'
    '      "campaigns": string[] (campaign names or IDs this applies to),\n'
    '      "expected_impact": string (what will improve and by how much),\n'
    '      "done": false\n'
    "    }\n"
    '  ] (sorted by priority ascending, then urgency)\n'
    "}\n\n"
    "CRITICAL: Return ONLY the JSON object. No markdown, no prose.\n"
)


def generate_action_tasks(
    *,
    analyses: list[dict],
    model: str | None = None,
) -> dict:
    """Generate actionable management tasks from multiple campaign analyses.

    Args:
        analyses: list of campaign analysis results (each contains verdict, recommendations, etc.)
        model: OpenAI model override

    Returns:
        { summary, urgent_count, tasks: [...] }
    """
    use_model = model or ANALYZER_MODEL

    # Build input context from all analyses
    campaigns_context = []
    for i, analysis in enumerate(analyses):
        campaign_name = analysis.get("campaign_name") or analysis.get("campaign_key") or f"Campaign {i+1}"
        verdict = analysis.get("overall_verdict", "unknown")
        summary = analysis.get("summary", "")
        confidence = analysis.get("confidence_level", "")
        meta_inputs = analysis.get("meta_inputs") or {}
        recommendations = analysis.get("recommendations") or []
        scaling_plan = analysis.get("scaling_plan") or {}
        creative_analysis = analysis.get("creative_analysis") or {}
        customer_alignment = analysis.get("customer_alignment") or {}
        product_info = analysis.get("product_info_input") or {}

        campaign_block = (
            f"\n--- CAMPAIGN {i+1}: {campaign_name} ---\n"
            f"Verdict: {verdict} | Confidence: {confidence}\n"
            f"Summary: {summary}\n"
            f"Metrics: spend=${meta_inputs.get('spend', 0)}, "
            f"purchases={meta_inputs.get('purchases', 0)}, "
            f"CPP=${meta_inputs.get('cpp', 'N/A')}, "
            f"CTR={meta_inputs.get('ctr', 'N/A')}%, "
            f"orders={meta_inputs.get('shopify_orders', 'N/A')}, "
            f"true_cpp=${meta_inputs.get('true_cpp', 'N/A')}, "
            f"age={meta_inputs.get('campaign_age_days', 'N/A')} days\n"
            f"Product: {product_info.get('title', 'Unknown')} (inventory: {product_info.get('inventory', 'N/A')})\n"
        )

        if scaling_plan:
            campaign_block += (
                f"Scaling: phase={scaling_plan.get('current_phase', 'N/A')}, "
                f"budget_rec={scaling_plan.get('budget_recommendation', 'N/A')}\n"
            )

        if recommendations:
            campaign_block += "Recommendations:\n"
            for rec in recommendations[:5]:
                campaign_block += (
                    f"  P{rec.get('priority', '?')} [{rec.get('category', '')}]: "
                    f"{rec.get('recommendation', '')}\n"
                )

        if customer_alignment and customer_alignment.get("score") is not None:
            campaign_block += f"Customer Alignment: {customer_alignment.get('score', 'N/A')}/10\n"
            gaps = customer_alignment.get("gaps") or []
            if gaps:
                campaign_block += f"  Gaps: {'; '.join(gaps[:3])}\n"

        campaigns_context.append(campaign_block)

    user_content = (
        f"PORTFOLIO OF {len(analyses)} CAMPAIGNS TO CREATE TASKS FOR:\n"
        + "\n".join(campaigns_context)
    )

    logger.info("Action Task Agent: generating tasks from %d analyses with %s", len(analyses), use_model)
    result = _call_llm(ACTION_TASK_AGENT_PROMPT, user_content, model=use_model)

    # Normalize output
    if not isinstance(result.get("tasks"), list):
        result["tasks"] = []
    if not isinstance(result.get("summary"), str):
        result["summary"] = ""
    if not isinstance(result.get("urgent_count"), int):
        result["urgent_count"] = len([t for t in result.get("tasks", []) if t.get("priority") == 1])

    # Ensure all tasks have required fields
    for i, task in enumerate(result["tasks"]):
        if not task.get("id"):
            task["id"] = f"task_{i}"
        if "done" not in task:
            task["done"] = False
        if not isinstance(task.get("campaigns"), list):
            task["campaigns"] = []

    # Sort by priority then urgency
    urgency_order = {"immediate": 0, "today": 1, "this_week": 2, "when_possible": 3}
    try:
        result["tasks"].sort(key=lambda t: (
            int(t.get("priority", 99)),
            urgency_order.get(t.get("urgency", "when_possible"), 4),
        ))
    except Exception:
        pass

    return result

