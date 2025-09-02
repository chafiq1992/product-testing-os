import os, json
from tenacity import retry, stop_after_attempt, wait_exponential
from openai import OpenAI, BadRequestError
import os

# Initialize OpenAI client (reads OPENAI_API_KEY from env)
client = OpenAI()
DEFAULT_LLM_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

ANGLE_JSON_INSTRUCTIONS = {"type": "json_object"}

# We build the prompt with an f-string so that only the payload vars are substituted and
# the JSON braces inside the schema remain intact (no KeyError from str.format).
BASE_PROMPT = (
    "You are a senior CRO & direct-response strategist.\n"
    "Task: From the provided PRODUCT_INFO (and optional IMAGES), identify the dominant buying driver and primary friction, then generate 2–5 distinct ad angles that are most likely to convert. Prioritize angles with clear proof, risk reversal, and a concrete, specific promise. Use only facts present in PRODUCT_INFO; if you must infer, mark it [ASSUMPTION].\n\n"
    "Method:\n"
    "1) Diagnose Fit (audience, pains, outcomes, offer, price, guarantees, constraints/region/language).\n"
    "2) Choose 2–5 angle patterns (PAS, Social Proof, Risk Reversal, Speed/Convenience, Value, Emotional/Why-Now).\n"
    "3) Map proof to each claim (reviews, numbers, materials, policies).\n"
    "4) Pre-empt 2–3 objections per angle.\n"
    "5) If IMAGES provided, map them to angle/hooks by URL (never invent URLs).\n\n"
    "Output:\n"
    "Return ONE valid json object with:\n"
    "- diagnosis { dominant_driver, primary_friction, why_these_angles }\n"
    "- angles[] each with:\n"
    "  name, big_idea, promise, ksp[3-5], headlines[5-8], titles[3-5],\n"
    "  primaries { short, medium, long }, objections[{q,rebuttal}],\n"
    "  proof[], cta{label,url}, image_map{used[],notes}, lp_snippet{hero_headline,subheadline,bullets[]}\n"
    "- scores per angle: relevance, desire_intensity, differentiation, proof_strength, objection_coverage, clarity, visual_fit, total\n"
    "- recommendation { best_angle, why, first_test_assets[], next_tests[] }\n\n"
    "Style & Localization:\n"
    "- Match language in PRODUCT_INFO (\"ar\" Fus’ha, \"fr\", or \"en\").\n"
    "- If region == \"MA\", add Morocco trust signals (Cash on Delivery, fast city delivery, easy returns, WhatsApp support).\n"
    "- Be concrete and benefit-led. Avoid vague hype.\n\n"
    "CRITICAL: Output must be a single valid json object only (no markdown, no explanations).\n"
)

@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, max=8))
def gen_angles_and_copy(payload: dict, model: str | None = None, prompt_override: str | None = None) -> list:
    base = (prompt_override or BASE_PROMPT)
    msg = (
        base
        + "PRODUCT INFO:\n"
        + json.dumps(payload, ensure_ascii=False)
        + f"\nAudience: {payload.get('audience')}"
    )
    messages = [
        {"role": "system", "content": "Respond ONLY with a json object. No prose, no markdown."},
        {"role": "user", "content": msg},
    ]
    resp = client.chat.completions.create(
        model=(model or DEFAULT_LLM_MODEL),
        messages=messages,
        response_format={"type":"json_object"}
    )
    text = resp.choices[0].message.content
    data = json.loads(text)
    return data.get("angles", [])

IMAGE_PROMPT = (
    "High-converting ecommerce ad image for {title}. Angle: {angle}. "
    "Clean, product-first, bright neutral backdrop, subtle shadow, crisp edges, retail-ready, 4:5 safe crop."
)

@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, max=8))
def gen_images(angle: dict, payload: dict) -> list:
    prompt = IMAGE_PROMPT.format(title=payload.get("title") or "product", angle=angle.get("name"))
    img = client.images.generate(
        model="gpt-image-1",
        prompt=prompt,
        size="1024x1024",
        n=1
    )
    return [img.data[0].url]


LANDING_COPY_PROMPT = (
    "You are a CRO specialist and landing-page copy engineer.\n"
    "Goal: Produce a single json object with high-converting landing copy and a complete HTML page (inline styles) that embeds only the image URLs provided by the user.\n\n"
    "Output Contract\n\n"
    "Return one json object (no markdown, no prose) with these keys:\n\n"
    "headline: string\n\n"
    "subheadline: string\n\n"
    "sections: array of objects\n\n"
    "Each section: { \"id\": string, \"title\": string, \"body\": string, \"image_url\": string|null, \"image_alt\": string }\n\n"
    "Recommended IDs (use any that apply): \"hero\", \"highlights\", \"colors\", \"feature_gallery\", \"quick_specs\", \"trust_badges\", \"reviews\", \"cta_block\"\n\n"
    "faq: array of { \"q\": string, \"a\": string } (3–6 items)\n\n"
    "cta: { \"primary_label\": string, \"primary_url\": string, \"secondary_label\": string, \"secondary_url\": string }\n\n"
    "html: string — a complete, self-contained landing page using inline CSS (no external assets), mobile-first, and following the layout spec below\n\n"
    "assets_used: object listing which provided images you actually used.\n\n"
    "Image Mapping Rules\n\n"
    "Use only the image URLs provided in input. Never invent URLs. Prefer a \"hero\"-labeled image for hero; else first wide image. Map remaining images to feature_gallery (up to 10), colors (if provided), reviews (optional). Always set meaningful image_alt. If no suitable image for a section, set image_url: null.\n\n"
    "Copy Guidelines\n\n"
    "Follow audience/tone. Emphasize benefits and outcomes. Short paragraphs. Bullets when helpful. Morocco trust signals if region is MA: Cash on Delivery, fast delivery to big cities, easy returns, WhatsApp support. Language per input.\n\n"
    "Layout Spec for html\n\n"
    "Build one responsive page using inline CSS and this structure: Hero, Highlights, Color Options (optional), Feature Gallery (≤10), Quick Specs, Trust Badges (Morocco), Reviews, CTA Block, Footer. Styling: primary color from brand (fallback #004AAD); rounded cards, soft shadows, generous spacing, readable system fonts; buttons large and full-width on mobile; images loading=\"lazy\", width:100%, height:auto, border-radius:12px.\n\n"
    "Validation: html must be valid and self-contained. Use only provided image URLs. Ensure all CTAs use URLs provided in input (or product_url if provided); if missing, use \"#\". Return only the json object.\n"
)

@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, max=8))
def gen_landing_copy(payload: dict, angles: list, model: str | None = None, image_urls: list[str] | None = None, prompt_override: str | None = None, product_url: str | None = None) -> dict:
    base = (prompt_override or LANDING_COPY_PROMPT)
    msg = (
        base
        + "\nPRODUCT INFO:\n"
        + json.dumps(payload, ensure_ascii=False)
        + "\nTOP ANGLES:\n"
        + json.dumps(angles[:3], ensure_ascii=False)
        + (f"\nPRODUCT_URL: {product_url}" if product_url else "")
    )
    # Prepare multimodal content if images are provided; limit to a few to avoid timeouts
    images = list(image_urls or [])
    if len(images) > 4:
        images = images[:4]
    if images:
        content = [{"type":"text","text": msg}] + [
            {"type":"image_url","image_url":{"url": u}} for u in images
        ]
        messages = [
            {"role": "system", "content": "Respond ONLY with a json object. No prose, no markdown."},
            {"role":"user","content": content}
        ]
    else:
        messages = [
            {"role": "system", "content": "Respond ONLY with a json object. No prose, no markdown."},
            {"role":"user","content": msg}
        ]
    resp = client.chat.completions.create(
        model=(model or DEFAULT_LLM_MODEL),
        messages=messages,
        response_format={"type":"json_object"}
    )
    text = resp.choices[0].message.content
    try:
        return json.loads(text)
    except Exception:
        return {"headline": None, "subheadline": None, "sections": [], "faq": [], "cta": None, "html": None}


# ---------------- Title & Description generation ----------------
TITLE_DESC_PROMPT = (
    "You are an ecommerce copywriter. Given PRODUCT INFO and a selected ANGLE, output ONLY valid JSON: "
    '{"title": str, "description": str}. '
    "Title <= 30 chars, compelling, brand-safe. Description 1-2 short sentences, no claims; focus on benefits."
)

@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, max=8))
def gen_title_and_description(payload: dict, angle: dict, prompt_override: str | None = None, model: str | None = None, image_urls: list[str] | None = None) -> dict:
    # Ensure the message explicitly mentions json to comply with response_format=json_object
    json_rule = (
        "Respond ONLY with a json object having keys 'title' and 'description'. "
        "No prose, no markdown, just json."
    )
    if prompt_override:
        base = prompt_override.strip() + "\n" + json_rule
    else:
        base = TITLE_DESC_PROMPT + "\n" + json_rule
    msg_text = (
        base
        + "\nPRODUCT INFO:\n"
        + json.dumps(payload, ensure_ascii=False)
        + "\nANGLE:\n"
        + json.dumps(angle, ensure_ascii=False)
    )
    def _call(messages: list[dict]):
        return client.chat.completions.create(
            model=(model or DEFAULT_LLM_MODEL),
            messages=messages,
            response_format={"type":"json_object"}
        )

    # Limit images to at most 1 to avoid remote fetch timeouts; fallback without images on failure
    images = list(image_urls or [])
    if len(images) > 1:
        images = images[:1]

    try:
        if images:
            content = [{"type":"text","text": msg_text}] + [
                {"type":"image_url","image_url":{"url": u}} for u in images
            ]
            messages = [
                {"role": "system", "content": "Respond ONLY with a json object. No prose, no markdown."},
                {"role":"user","content": content}
            ]
        else:
            messages = [
                {"role": "system", "content": "Respond ONLY with a json object. No prose, no markdown."},
                {"role":"user","content": msg_text}
            ]
        resp = _call(messages)
    except BadRequestError as e:
        # If image fetch failed on OpenAI side, retry once without images as a graceful fallback
        if images:
            resp = _call([
                {"role": "system", "content": "Respond ONLY with a json object. No prose, no markdown."},
                { "role":"user", "content": msg_text }
            ])
        else:
            raise
    text = resp.choices[0].message.content
    try:
        data = json.loads(text)
        return {"title": data.get("title"), "description": data.get("description")}
    except Exception:
        return {"title": None, "description": None}