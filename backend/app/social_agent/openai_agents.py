from __future__ import annotations

import base64
import json
import mimetypes
import os
import re
import tempfile
from pathlib import Path
from typing import Any

import requests
from tenacity import retry, stop_after_attempt, wait_exponential

from app.integrations.openai_client import (
    DEFAULT_IMAGE_MODEL,
    DEFAULT_LLM_MODEL,
    _openai_image_result_to_data_url,
    client,
)


STRATEGY_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": [
        "angle", "hook_ar", "body_ar", "cta_ar", "caption_ar", "hashtags",
        "alt_text_ar", "offer_type", "offer_text_ar", "visual_directions",
        "rationale_en", "test_variable", "claims",
    ],
    "properties": {
        "angle": {"type": "string"},
        "hook_ar": {"type": "string"},
        "body_ar": {"type": "string"},
        "cta_ar": {"type": "string"},
        "caption_ar": {"type": "string"},
        "hashtags": {"type": "array", "items": {"type": "string"}, "minItems": 2, "maxItems": 8},
        "alt_text_ar": {"type": "string"},
        "offer_type": {"type": "string", "enum": ["markdown", "quantity", "value", "none"]},
        "offer_text_ar": {"type": "string"},
        "visual_directions": {"type": "array", "items": {"type": "string"}, "minItems": 2, "maxItems": 3},
        "rationale_en": {"type": "string"},
        "test_variable": {"type": "string"},
        "claims": {"type": "array", "items": {"type": "string"}, "maxItems": 8},
    },
}

REVIEW_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["decision", "score", "summary_en", "arabic_errors", "visual_errors", "factual_risks", "strengths", "repair_instruction"],
    "properties": {
        "decision": {"type": "string", "enum": ["approve", "reject"]},
        "score": {"type": "integer", "minimum": 0, "maximum": 100},
        "summary_en": {"type": "string"},
        "arabic_errors": {"type": "array", "items": {"type": "string"}},
        "visual_errors": {"type": "array", "items": {"type": "string"}},
        "factual_risks": {"type": "array", "items": {"type": "string"}},
        "strengths": {"type": "array", "items": {"type": "string"}},
        "repair_instruction": {"type": "string"},
    },
}

LEARNING_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["summary", "winning_patterns", "losing_patterns", "next_rules", "experiments", "sample_size"],
    "properties": {
        "summary": {"type": "string"},
        "winning_patterns": {"type": "array", "items": {"type": "string"}, "maxItems": 8},
        "losing_patterns": {"type": "array", "items": {"type": "string"}, "maxItems": 8},
        "next_rules": {"type": "array", "items": {"type": "string"}, "maxItems": 8},
        "experiments": {"type": "array", "items": {"type": "string"}, "maxItems": 8},
        "sample_size": {"type": "integer", "minimum": 0},
    },
}


def _response_json(*, name: str, schema: dict[str, Any], system: str, user: str, images: list[str] | None = None) -> dict[str, Any]:
    content: list[dict[str, Any]] = [{"type": "input_text", "text": user}]
    for image in images or []:
        if image:
            content.append({"type": "input_image", "image_url": image, "detail": "high"})
    try:
        response = client.responses.create(
            model=DEFAULT_LLM_MODEL,
            instructions=system,
            input=[{"role": "user", "content": content}],
            text={"format": {"type": "json_schema", "name": name, "strict": True, "schema": schema}},
        )
        return json.loads(response.output_text)
    except Exception:
        fallback_content: list[dict[str, Any]] = [{"type": "text", "text": user}]
        for image in images or []:
            fallback_content.append({"type": "image_url", "image_url": {"url": image, "detail": "high"}})
        response = client.chat.completions.create(
            model=DEFAULT_LLM_MODEL,
            messages=[
                {"role": "system", "content": system + " Return one valid JSON object only."},
                {"role": "user", "content": fallback_content},
            ],
            response_format={"type": "json_object"},
        )
        return json.loads(response.choices[0].message.content or "{}")


def _offer_context(product: dict[str, Any], config: dict[str, Any]) -> dict[str, Any]:
    price = product.get("price")
    compare_at = product.get("compare_at_price")
    markdown = bool(price is not None and compare_at is not None and float(compare_at) > float(price))
    quantity = bool(config.get("quantity_offer_enabled") and str(config.get("approved_quantity_offer_ar") or "").strip())
    return {
        "markdown_allowed": markdown,
        "actual_price_mad": price,
        "actual_compare_at_price_mad": compare_at,
        "actual_discount_percent": product.get("discount_percent") if markdown else 0,
        "quantity_offer_allowed": quantity,
        "approved_quantity_offer_ar": str(config.get("approved_quantity_offer_ar") or "") if quantity else "",
        "instruction": "If neither offer is allowed, use value/benefit framing and do not imply any discount.",
    }


@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, max=8), reraise=True)
def create_strategy(
    product: dict[str, Any], config: dict[str, Any], learning: dict[str, Any],
    *, slot: str, position: int,
) -> dict[str, Any]:
    context = {
        "product": {k: v for k, v in product.items() if k not in {"variants", "videos"}},
        "offer_guardrail": _offer_context(product, config),
        "store_brand_notes": str(config.get("brand_notes") or "")[:2000],
        "default_hashtags": config.get("hashtags") or [],
        "evidence_based_learning": learning,
        "slot": slot,
        "position": position,
    }
    system = (
        "You are the strategist and Arabic direct-response copywriter in a social-commerce team. "
        "Write customer-facing text only in polished Modern Standard Arabic (Fusha) for Morocco; "
        "never use Darija. Internal rationale remains English. Use only supplied catalog facts. "
        "Never invent discounts, quantities, delivery claims, guarantees, reviews, scarcity, results, or capabilities. "
        "Respect the offer_guardrail exactly. Make the caption naturally persuasive, mobile-scannable, not spammy, "
        "and include a clear CTA to the real product URL. Produce two meaningfully different 4:5 visual directions. "
        "Visual directions must preserve the exact source product and request no more than one very short Arabic badge; "
        "prefer no rendered text so the image cannot contain spelling errors. Avoid unsupported superlatives."
    )
    return _response_json(
        name="social_strategy", schema=STRATEGY_SCHEMA, system=system,
        user="Create one conversion-focused organic social post from this JSON:\n" + json.dumps(context, ensure_ascii=False),
    )


def _download_source(url: str) -> tuple[bytes, str]:
    response = requests.get(url, timeout=45)
    response.raise_for_status()
    mime = (response.headers.get("content-type") or "image/jpeg").split(";", 1)[0]
    return response.content, mime


@retry(stop=stop_after_attempt(2), wait=wait_exponential(multiplier=1, max=5), reraise=True)
def generate_candidate(product: dict[str, Any], strategy: dict[str, Any], direction: str, candidate_number: int) -> str:
    source_url = str(((product.get("images") or [{}])[0]).get("url") or "")
    if not source_url:
        raise RuntimeError("Selected product has no source image")
    source, mime = _download_source(source_url)
    ext = mimetypes.guess_extension(mime) or ".jpg"
    temp_path = ""
    try:
        with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as handle:
            handle.write(source)
            temp_path = handle.name
        prompt = (
            "Create a high-converting organic Instagram and Facebook ecommerce image in a portrait 4:5-safe composition.\n"
            f"Creative direction: {direction}\n"
            f"Product: {product.get('title')}\n"
            f"Campaign angle: {strategy.get('angle')}\n"
            f"Candidate: {candidate_number}\n\n"
            "PRODUCT FIDELITY IS MANDATORY: preserve the exact real product identity, colors, silhouette, proportions, "
            "materials, texture, stitching, printed marks, logo placement, parts, and variant shown in the supplied image. "
            "Do not invent accessories, product features, variants, packaging, people, testimonials, ratings, prices, "
            "discount numbers, logos, watermarks, or claims. Remove only the old background and unrelated clutter. "
            "Use premium commercial lighting, a strong focal hierarchy, generous safe margins, realistic contact shadows, "
            "and a polished Moroccan ecommerce aesthetic. Do not render any words, letters, numbers, badges, UI, or CTA "
            "inside the image. The caption will carry all copy. Output one finished ad image."
        )
        with open(temp_path, "rb") as image_file:
            result = client.images.edit(
                model=DEFAULT_IMAGE_MODEL,
                image=[image_file],
                prompt=prompt,
                size=os.getenv("SOCIAL_AGENT_IMAGE_SIZE", "1024x1536"),
                quality=os.getenv("OPENAI_IMAGE_QUALITY", "high"),
                background="opaque",
                n=1,
            )
        data_url = _openai_image_result_to_data_url(result)
        if not data_url:
            raise RuntimeError("OpenAI returned no usable image")
        return data_url
    finally:
        if temp_path:
            try:
                Path(temp_path).unlink(missing_ok=True)
            except Exception:
                pass


def data_url_bytes(data_url: str) -> tuple[bytes, str]:
    match = re.match(r"^data:([^;]+);base64,(.+)$", data_url or "", flags=re.DOTALL)
    if not match:
        raise ValueError("Invalid generated image data URL")
    return base64.b64decode(match.group(2)), match.group(1)


def deterministic_review(product: dict[str, Any], strategy: dict[str, Any], config: dict[str, Any]) -> list[str]:
    blockers: list[str] = []
    caption = str(strategy.get("caption_ar") or "").strip()
    if not caption:
        blockers.append("Caption is empty")
    # Product URLs and Latin brand handles should not make otherwise-correct
    # Arabic copy fail the language gate.
    language_sample = re.sub(r"https?://\S+|www\.\S+|#[A-Za-z0-9_]+", " ", caption)
    arabic = len(re.findall(r"[\u0600-\u06ff]", language_sample))
    letters = len(re.findall(r"[A-Za-z\u0600-\u06ff]", language_sample))
    if letters and arabic / letters < 0.72:
        blockers.append("Customer-facing caption is not predominantly Arabic Fusha")
    if str(product.get("url") or "") and str(product.get("url")) not in caption:
        blockers.append("Caption does not contain the exact Shopify product URL")
    offer_type = str(strategy.get("offer_type") or "none")
    if offer_type == "markdown" and int(product.get("discount_percent") or 0) <= 0:
        blockers.append("Markdown claim is not supported by Shopify compare-at pricing")
    if offer_type == "quantity":
        approved = str(config.get("approved_quantity_offer_ar") or "").strip()
        if not config.get("quantity_offer_enabled") or not approved:
            blockers.append("Quantity offer was not approved by the operator")
        elif approved not in (str(strategy.get("offer_text_ar") or "") + " " + caption):
            blockers.append("Quantity offer does not match the operator-approved wording")
    suspicious = ("الأفضل في المغرب", "مضمون 100%", "نتائج مضمونة", "آخر فرصة", "ينفد بسرعة")
    for phrase in suspicious:
        if phrase in caption:
            blockers.append(f"Unsupported or high-risk claim: {phrase}")
    return blockers


@retry(stop=stop_after_attempt(2), wait=wait_exponential(multiplier=1, max=5), reraise=True)
def review_candidate(
    product: dict[str, Any], strategy: dict[str, Any], candidate_data_url: str,
    config: dict[str, Any], candidate_number: int,
) -> dict[str, Any]:
    blockers = deterministic_review(product, strategy, config)
    source_url = str(((product.get("images") or [{}])[0]).get("url") or "")
    context = {
        "candidate_number": candidate_number,
        "product": product,
        "strategy": strategy,
        "minimum_score": int(config.get("minimum_review_score") or 82),
        "deterministic_blockers": blockers,
        "image_order": ["source Shopify product", "generated candidate"],
    }
    system = (
        "You are an independent senior ecommerce creative reviewer and publication gate. "
        "Compare the generated candidate with the source product. Reject any changed product identity, color, geometry, "
        "logo, quantity, physical detail, malformed anatomy, visual artifact, accidental/gibberish text, misleading offer, "
        "unsupported claim, wrong link, non-Fusha customer copy, or unreadable/low-quality composition. "
        "The target is a Moroccan audience, but customer copy must be Modern Standard Arabic, not Darija. "
        "Any deterministic blocker requires rejection. Approve only when score reaches the supplied minimum. "
        "Be strict and explain findings in English."
    )
    result = _response_json(
        name="social_creative_review", schema=REVIEW_SCHEMA, system=system,
        user="Review this post package:\n" + json.dumps(context, ensure_ascii=False),
        images=[source_url, candidate_data_url],
    )
    if blockers:
        result["decision"] = "reject"
        result["score"] = min(int(result.get("score") or 0), 59)
        risks = list(result.get("factual_risks") or [])
        result["factual_risks"] = list(dict.fromkeys(risks + blockers))
    if int(result.get("score") or 0) < int(config.get("minimum_review_score") or 82):
        result["decision"] = "reject"
    return result


def analyze_learning(rows: list[dict[str, Any]]) -> dict[str, Any]:
    evidence = []
    for post in rows:
        totals = ((post.get("metrics") or {}).get("totals") or {})
        if not totals:
            continue
        strategy = post.get("strategy") or {}
        product = post.get("product") or {}
        evidence.append({
            "post_id": post.get("id"), "slot": post.get("slot"), "scheduled_for": post.get("scheduled_for"),
            "product_type": product.get("product_type"), "inventory": product.get("inventory"),
            "angle": strategy.get("angle"), "offer_type": strategy.get("offer_type"),
            "hook_ar": strategy.get("hook_ar"), "test_variable": strategy.get("test_variable"),
            "reach": totals.get("reach"), "interactions": totals.get("interactions"),
            "clicks": totals.get("clicks"), "engagement_rate": totals.get("engagement_rate"),
            "click_rate": totals.get("click_rate"),
        })
    if len(evidence) < 3:
        return {
            "summary": f"Only {len(evidence)} measured post(s); more evidence is required before changing the strategy.",
            "winning_patterns": [], "losing_patterns": [],
            "next_rules": ["Keep hooks and visual directions diverse until at least three posts have meaningful reach."],
            "experiments": ["Test benefit-led versus value-led hooks while holding product and posting slot comparable."],
            "sample_size": len(evidence),
        }
    system = (
        "You are the analytics specialist in a closed-loop organic social system. Analyze only the supplied post metrics. "
        "Separate correlation from causation, account for reach/sample size, and avoid declaring a winner from one post. "
        "Explain likely reasons in English. Produce concrete future rules and controlled experiments. "
        "Do not recommend unsupported offers or fabricated claims."
    )
    result = _response_json(
        name="social_learning", schema=LEARNING_SCHEMA, system=system,
        user="Analyze this measured post evidence and return learning memory:\n" + json.dumps(evidence, ensure_ascii=False),
    )
    result["sample_size"] = len(evidence)
    return result
