"""Campaign Analyzer — Two-phase AI analysis pipeline for Meta ad campaigns.

Phase 1: Customer Profiler — identifies target demographics from product data
Phase 2: Campaign Analyst — produces prioritized recommendations + scaling plan
"""

import json
import logging
import os
from tenacity import retry, stop_after_attempt, wait_exponential
from app.integrations.openai_client import client, DEFAULT_LLM_MODEL
from app.ads_analyzer_settings import AnalyzerSettings, get_client
from app.ads_analyzer_report import build_report, AnalyzerResponseError

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
    clarity_insights: dict | None = None,
    customer_profile_override: dict | None = None,
    model: str | None = None,
    previous_analysis_context: str | None = None,
    settings: AnalyzerSettings | None = None,
    visual_evidence: list | None = None,
    image_data_urls: list | None = None,
) -> dict:
    """Run the two-phase analysis pipeline.

    Args:
        campaign_metrics: { spend, purchases, cpp, ctr, add_to_cart, true_cpp, shopify_orders, status }
        ad_creatives: [{ headline, primary_text, description, landing_url }]
        product_info: { title, price, description, image_url, handle, product_url }
        clarity_insights: Microsoft Clarity behavior summary for the matched campaign/landing URL
        customer_profile_override: skip Phase 1 if already known
        model: OpenAI model override
        previous_analysis_context: formatted string describing previous analysis + implementation status

    Returns:
        { customer_profile, recommendations, scaling_plan, creative_analysis, ... }
    """
    settings = settings or AnalyzerSettings()
    if not settings.enabled:
        raise ValueError("Ads analyzer is paused in AI agent settings")
    if model:
        settings = settings.model_copy(update={"model": model})
    use_model = settings.model

    # ── Phase 1: Customer Profiler ──
    if customer_profile_override:
        customer_profile = customer_profile_override
    elif settings.profiler_enabled:
        product_context = (
            f"PRODUCT DATA:\n"
            f"Title: {product_info.get('title', 'Unknown')}\n"
            f"Price: {product_info.get('price', 'Unknown')}\n"
            f"Description: {(product_info.get('description') or '')[:2000]}\n"
            f"Product URL: {product_info.get('product_url', '')}\n"
            f"Image URL: {product_info.get('image_url', '')}\n"
        )
        logger.info("Campaign Analyzer: Phase 1 (Customer Profiler) with %s", use_model)
        profiler_options = {"reasoning": {"effort": settings.reasoning_effort}} if use_model.startswith(("gpt-5", "gpt-6", "o3", "o4")) else {}
        response = get_client().responses.create(
            model=use_model, instructions=CUSTOMER_PROFILER_PROMPT + "\nSeparate evidence from demographic hypotheses. Do not invent buyer facts.",
            input="Return the customer profile as a JSON object.\n\n" + product_context, text={"format": {"type": "json_object"}},
            max_output_tokens=settings.max_output_tokens, store=False, **profiler_options,
        )
        if response.status != "completed" or not response.output_text:
            raise AnalyzerResponseError("Customer profiler did not complete; retry or disable profiling")
        customer_profile = json.loads(response.output_text)
        if not customer_profile:
            customer_profile = {"error": "Could not generate customer profile"}
    else:
        customer_profile = {"note": "Customer profiling is disabled"}

    return build_report(
        settings=settings, campaign_metrics=campaign_metrics, ad_creatives=ad_creatives,
        product_info=product_info, customer_profile=customer_profile,
        clarity_insights=clarity_insights or {}, previous_analysis_context=previous_analysis_context,
        visual_evidence=visual_evidence or [], image_data_urls=image_data_urls or [],
    )

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


ARABIC_TASK_TRANSLATION_PROMPT = (
    "Translate campaign action tasks to clear Arabic for ad operations employees.\n"
    "Keep English ad terms unchanged when useful: CTR, CPP, CBO, COD, CPA, ROAS, bundle, offer, upsell, downsell, "
    "creative, ad copy, landing page, budget, campaign, ad set.\n"
    "Do not change task ids. Do not rewrite the original task meaning. Return only translations.\n\n"
    "Output Contract - return ONE valid JSON object:\n"
    "{\n"
    '  "translations": [\n'
    "    {\n"
    '      "id": string,\n'
    '      "title_ar": string,\n'
    '      "description_ar": string,\n'
    '      "expected_impact_ar": string\n'
    "    }\n"
    "  ]\n"
    "}\n"
)


def _coerce_priority(value: object) -> int:
    try:
        return max(1, min(5, int(value)))
    except Exception:
        return 3


def _task_urgency(priority: int, category: str) -> str:
    cat = (category or "").lower()
    if cat == "kill" or priority <= 1:
        return "immediate"
    if priority <= 2 or cat in {"budget", "scale", "pricing"}:
        return "today"
    if priority <= 4:
        return "this_week"
    return "when_possible"


def _task_category(analysis: dict, rec: dict) -> str:
    verdict = str(analysis.get("overall_verdict") or "").lower()
    raw = str(rec.get("category") or "optimization").lower()
    text = " ".join(str(rec.get(k) or "") for k in ("finding", "recommendation", "expected_impact")).lower()
    if verdict == "kill" or "kill" in text or "pause" in text:
        return "kill"
    if "inventory" in text or "stock" in text:
        return "inventory"
    return raw or "optimization"


def _task_title(rec: dict) -> str:
    category = str(rec.get("category") or "optimization").replace("_", " ").title()
    priority = _coerce_priority(rec.get("priority", 3))
    return f"P{priority} {category} Recommendation"


def _campaign_labels(analysis: dict, index: int) -> tuple[str, str]:
    campaign_key = str(analysis.get("campaign_key") or analysis.get("campaign_id") or "").strip()
    campaign_name = str(analysis.get("campaign_name") or campaign_key or f"Campaign {index + 1}").strip()
    return campaign_name, campaign_key or campaign_name


def _apply_arabic_task_translations(tasks: list[dict], model: str | None = None) -> None:
    if not tasks:
        return
    translation_input = {
        "tasks": [
            {
                "id": task.get("id"),
                "title": task.get("title", ""),
                "description": task.get("description", ""),
                "expected_impact": task.get("expected_impact", ""),
                "campaigns": task.get("campaigns", []),
            }
            for task in tasks
        ]
    }
    try:
        translated = _call_llm(
            ARABIC_TASK_TRANSLATION_PROMPT,
            json.dumps(translation_input, ensure_ascii=False),
            model=model,
        )
        translations = translated.get("translations") if isinstance(translated, dict) else []
        by_id = {str(t.get("id")): t for t in translations if isinstance(t, dict)}
        for task in tasks:
            match = by_id.get(str(task.get("id")))
            if not match:
                continue
            task["title_ar"] = str(match.get("title_ar") or task.get("title") or "")
            task["description_ar"] = str(match.get("description_ar") or task.get("description") or "")
            task["expected_impact_ar"] = str(match.get("expected_impact_ar") or task.get("expected_impact") or "")
    except Exception as exc:
        logger.warning("Action Task Agent: Arabic translation failed: %s", exc)


def generate_action_tasks(
    *,
    analyses: list[dict],
    model: str | None = None,
) -> dict:
    """Create one campaign-level task for each analysis recommendation.

    Args:
        analyses: list of campaign analysis results (each contains verdict, recommendations, etc.)
        model: OpenAI model override

    Returns:
        { summary, urgent_count, tasks: [...] }
    """
    use_model = model or ANALYZER_MODEL

    tasks: list[dict] = []
    for analysis_index, analysis in enumerate(analyses):
        if not isinstance(analysis, dict):
            continue
        campaign_name, campaign_key = _campaign_labels(analysis, analysis_index)
        recommendations = analysis.get("recommendations") or []
        if not isinstance(recommendations, list):
            continue
        for rec_index, rec in enumerate(recommendations):
            if not isinstance(rec, dict):
                continue
            priority = _coerce_priority(rec.get("priority", rec_index + 1))
            category = _task_category(analysis, rec)
            finding = str(rec.get("finding") or "").strip()
            recommendation = str(rec.get("recommendation") or "").strip()
            expected_impact = str(rec.get("expected_impact") or "").strip()
            description = (
                f"- Action: {recommendation}\n"
                f"- Campaign: {campaign_name}\n"
                f"- Finding: {finding}\n"
                f"- Check: {expected_impact}"
            )
            tasks.append({
                "id": f"task_{analysis_index + 1}_{rec_index + 1}",
                "priority": priority,
                "urgency": _task_urgency(priority, category),
                "category": category,
                "title": _task_title(rec),
                "description": description,
                "campaigns": [campaign_name],
                "campaign_keys": [campaign_key],
                "expected_impact": expected_impact,
                "source_recommendation": rec,
                "done": False,
            })

    _apply_arabic_task_translations(tasks, model=use_model)

    result = {
        "summary": (
            f"Created {len(tasks)} campaign-level tasks directly from {len(analyses)} analysis report"
            f"{'' if len(analyses) == 1 else 's'}. Recommendations are preserved per campaign; Arabic is available as an alternate view."
        ),
        "urgent_count": len([t for t in tasks if t.get("priority") == 1 or t.get("urgency") == "immediate"]),
        "tasks": tasks,
    }

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

