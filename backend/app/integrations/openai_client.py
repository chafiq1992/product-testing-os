import os, json
from tenacity import retry, stop_after_attempt, wait_exponential
from openai import OpenAI, BadRequestError
import base64
import mimetypes
import requests
import os

# Initialize OpenAI client (reads OPENAI_API_KEY from env)
client = OpenAI()
DEFAULT_LLM_MODEL = os.getenv("OPENAI_MODEL", "gpt-5")

ANGLE_JSON_INSTRUCTIONS = {"type": "json_object"}

# We build the prompt with an f-string so that only the payload vars are substituted and
# the JSON braces inside the schema remain intact (no KeyError from str.format).
BASE_PROMPT = (
    "You are a senior CRO & direct-response strategist.\n"
    "Task: From the provided PRODUCT_INFO (and optional IMAGES), identify the dominant buying driver and primary friction, then generate EXACTLY 3 distinct ad angles that are most likely to convert. Prioritize angles with clear proof, risk reversal, and a concrete, specific promise. Use only facts present in PRODUCT_INFO; if you must infer, mark it [ASSUMPTION].\n\n"
    "Method:\n"
    "1) Diagnose Fit (audience, pains, outcomes, offer, price, guarantees, constraints/region/language).\n"
    "2) Choose 3 angle patterns (PAS, Social Proof, Risk Reversal, Speed/Convenience, Value, Emotional/Why-Now).\n"
    "3) Map proof to each claim (reviews, numbers, materials, policies).\n"
    "4) Pre-empt 2–3 objections per angle.\n"
    "5) If IMAGES provided, map them to angle/hooks by URL (never invent URLs).\n\n"
    "Output:\n"
    "Return ONE valid json object with:\n"
    "- diagnosis { dominant_driver, primary_friction, why_these_angles }\n"
    "- angles[] each with:\n"
    "  name, big_idea, promise, ksp[3-5], headlines[3], titles[3-5],\n"
    "  primaries { short, medium, long }, objections[{q,rebuttal}],\n"
    "  proof[], cta{label,url}, image_map{used[],notes}, lp_snippet{hero_headline,subheadline,bullets[]}\n"
    "- scores per angle: relevance, desire_intensity, differentiation, proof_strength, objection_coverage, clarity, visual_fit, total\n"
    "- recommendation { best_angle, why, first_test_assets[], next_tests[] }\n\n"
    "Style & Localization:\n"
    "- Match language in PRODUCT_INFO (\"ar\" Fus’ha, \"fr\", or \"en\").\n"
    "- If region == \"MA\", add Morocco trust signals (Cash on Delivery, fast city delivery, easy returns, WhatsApp support).\n"
    "- Be concrete and benefit-led. Avoid vague hype.\n"
    "- Headlines: provide exactly 3 per angle, ≤12 words, start with a 2–3 word HOOK and include relevant emojis to add emotion and scannability. Use emotional triggers (relief, pride, comfort, speed, safety) and clear benefits.\n"
    "- Primaries (ad copy): write persuasive multi-line texts (2–4 short lines) that include tasteful emojis. The first 2–3 words must be a HOOK. Lay out the key benefits clearly, then end with a strong CTA that includes an emoji.\n"
    "- Kids products: if PRODUCT_INFO audience indicates parents/kids or target_category is in [girl, boy, unisex_kids], emphasize comfort and beauty, how the product makes the child’s life easier and more delightful, helps them stand out, amuse, educate, and become better. Keep tone warm, caring, and aspirational.\n\n"
    "CRITICAL: Output must be a single valid json object only (no markdown, no explanations).\n"
)

@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, max=8))
def gen_angles_and_copy_full(payload: dict, model: str | None = None, prompt_override: str | None = None) -> dict:
    """Generate angles/copy (or other marketing JSON when prompt_override provided).

    Returns the full parsed JSON object from the model so callers can access
    alternative schemas (e.g., offers) in addition to angles.
    """
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
    try:
        data = json.loads(text)
    except Exception:
        data = {"angles": []}
    # Normalize to ensure angles key exists for legacy callers
    if not isinstance(data.get("angles"), list):
        data["angles"] = []
    return data


@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, max=8))
def gen_angles_and_copy(payload: dict, model: str | None = None, prompt_override: str | None = None) -> list:
    """Legacy helper that returns only the angles list for existing callers."""
    data = gen_angles_and_copy_full(payload, model=model, prompt_override=prompt_override)
    return data.get("angles", [])

# ---------------- Translation ----------------
@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, max=8))
def translate_texts(items: list[str], target_language: str, *, locale: str | None = None, domain: str | None = None, model: str | None = None) -> list[str]:
    """Translate a list of strings to the target language, preserving marketing tone and terminology.

    Args:
        items: list of source strings.
        target_language: e.g., "ar" for Arabic (Fus'ha), "fr" for French.
        locale: optional locale hint like "MA" for Morocco to bias terminology.
        domain: optional domain like "ads" to bias translation style.
        model: override model.

    Returns:
        A list of translated strings of equal length.
    """
    try:
        src_items = [str(x)[:2000] for x in (items or [])]
    except Exception:
        src_items = []
    lang = (target_language or "").strip().lower()
    loc = (locale or "").strip().upper()
    dom = (domain or "").strip().lower()

    instructions = (
        "Translate each item accurately, preserving intent, clarity, and persuasive marketing tone.\n"
        "- Return ONLY a JSON array of strings (no explanations).\n"
        "- Use consistent terminology appropriate for digital ads.\n"
        "- Avoid literal translations when a common marketing phrase exists.\n"
        "- Keep brand/product names in the original language.\n"
        "- Respect punctuation and line breaks.\n"
    )
    if lang == "ar":
        instructions += "- Use Modern Standard Arabic (Fus'ha), clear and neutral.\n"
    # Moroccan Darija (Arabic dialect). Accept common identifiers
    if lang in ("ary", "ar-ma", "darija"):
        instructions += (
            "- Use Moroccan Darija (الدارجة المغربية) with a natural, conversational advertising tone.\n"
            "- Prefer Arabic script (not Latin) unless the source uses Latin for brand terms.\n"
            "- Avoid formal MSA phrasing; keep it friendly and concise for ads.\n"
        )
    if lang == "fr":
        instructions += "- Use standard French; if Morocco context applies, keep terms familiar locally.\n"
    if loc:
        instructions += f"- Optimize word choice for locale: {loc}.\n"
    if dom:
        instructions += f"- Domain emphasis: {dom}.\n"

    messages = [
        {"role": "system", "content": "You are a professional marketing translator. Output JSON only."},
        {
            "role": "user",
            "content": (
                instructions
                + f"\nTarget language: {lang or 'fr'}\n"
                + "Items to translate (JSON array):\n"
                + json.dumps(src_items, ensure_ascii=False)
            ),
        },
    ]
    resp = client.chat.completions.create(
        model=(model or DEFAULT_LLM_MODEL),
        messages=messages,
    )
    text = resp.choices[0].message.content or "[]"
    try:
        parsed = json.loads(text)
        if isinstance(parsed, list):
            out = [str(x) for x in parsed]
        elif isinstance(parsed, dict) and isinstance(parsed.get("translations"), list):
            out = [str(x) for x in parsed.get("translations")]
        else:
            out = []
    except Exception:
        out = []
    if len(out) != len(src_items):
        out = []
        for s in src_items:
            try:
                r = client.chat.completions.create(
                    model=(model or DEFAULT_LLM_MODEL),
                    messages=[
                        {"role": "system", "content": "Translate the following text. Output only the translation."},
                        {"role": "user", "content": f"Target: {lang}\n{s}"},
                    ],
                )
                tr = (r.choices[0].message.content or "").strip()
            except Exception:
                tr = s
            out.append(tr)
    return out

IMAGE_PROMPT = (
    "High-converting ecommerce ad image for {title}. Angle: {angle}. "
    "Clean, product-first, bright neutral backdrop, subtle shadow, crisp edges, retail-ready, 4:5 safe crop."
)

def _compute_midpoint_size_from_payload(payload: dict) -> str | None:
    try:
        sizes = payload.get("sizes") or []
        numeric_values: list[float] = []
        for s in sizes:
            if not isinstance(s, str):
                continue
            import re
            nums = re.findall(r"[-+]?[0-9]*\.?[0-9]+", s)
            for n in nums:
                try:
                    numeric_values.append(float(n))
                except Exception:
                    continue
        if not numeric_values:
            return None
        lo = min(numeric_values)
        hi = max(numeric_values)
        if lo == hi:
            mid = lo
        else:
            mid = (lo + hi) / 2.0
        # format: integer if whole number else keep up to one decimal (e.g., 35 or 35.5)
        if abs(mid - round(mid)) < 1e-6:
            return str(int(round(mid)))
        return f"{mid:.1f}".rstrip("0").rstrip(".")
    except Exception:
        return None


@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, max=8))
def gen_images(angle: dict, payload: dict) -> list:
    base = IMAGE_PROMPT.format(title=payload.get("title") or "product", angle=angle.get("name"))
    # Enforce background replacement and inject midpoint size guidance when available
    background_rule = (
        " Always replace the original background with a new clean neutral studio backdrop. "
        "Never reuse the background from any provided or source images."
    )
    size_rule = ""
    mid = _compute_midpoint_size_from_payload(payload or {})
    if mid:
        size_rule = f" Ensure the product shown is size {mid} (use the midpoint of the provided size range)."
    prompt = base + background_rule + size_rule
    img = client.images.generate(
        model="gpt-image-1",
        prompt=prompt,
        size="1024x1024",
        n=1
    )
    return [img.data[0].url]


# ---------------- Product extraction from image ----------------
@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, max=8))
def gen_product_from_image(image_url: str, model: str | None = None, target_category: str | None = None) -> dict:
    """Analyze a single product photo and extract structured product inputs.

    Returns a dict with keys:
      - title (string)
      - audience (string)
      - benefits (string[])
      - pain_points (string[])
      - colors (string[])
      - sizes (string[])
      - variants (array of { name, description })
    """
    system_base = (
        "You are a senior ecommerce analyst. From ONE product photo, infer only what is visually reliable.\n"
        "Return ONLY a JSON object with keys: title, audience, benefits, pain_points, colors, sizes, variants.\n"
        "- title: brief product name.\n"
        "- audience: the most likely buyer (e.g., 'Parents of toddlers in Morocco').\n"
        "- benefits: 3-6 concrete benefits/outcomes. Include 1-2 that reflect visible design features (e.g., breathable mesh, extra height, reinforced toe, non-slip sole).\n"
        "- pain_points: 3-6 pains the product solves (tie to features when visible).\n"
        "- colors: detected color variants (names).\n"
        "- sizes: visible or typical size hints (if any), else [].\n"
        "- variants: list of distinct visual variants (e.g., colors/patterns/materials/prints) with {name, description}. If unknown, [].\n"
        "Guidance: Note any visible prints/patterns, unique silhouettes, materials, added height/platforms, embroidery, special seams, closures, or accessories in variants.description.\n"
        "If uncertain, add minimal [ASSUMPTION] notes inside descriptions only."
    )
    cat_hint = ""
    if isinstance(target_category, str) and target_category.strip():
        cat = target_category.strip().lower()
        cat_hint = (
            "\nCRITICAL: TARGET_CATEGORY is '" + cat + "'. Constrain outputs (audience, benefits, pain_points, variants) to this category.\n"
            "Examples and mapping guidance:\n"
            "- girl: children's product for girls; audience like 'Parents of girls'.\n"
            "- boy: children's product for boys; audience like 'Parents of boys'.\n"
            "- unisex_kids: children's product for kids (girls and boys); audience like 'Parents of kids'.\n"
            "- men: adult men's product; audience like 'Men' or gift for men.\n"
            "- women: adult women's product; audience like 'Women' or gift for women.\n"
            "- unisex: suitable for all adults; keep audience neutral (e.g., 'Shoppers').\n"
            "If the image suggests a different demographic, still adhere to TARGET_CATEGORY."
        )
    system = system_base + cat_hint
    user = (
        "Analyze the product in this image and extract structured inputs as specified."
    )
    def _call(_messages: list[dict]):
        return client.chat.completions.create(
            model=(model or DEFAULT_LLM_MODEL),
            messages=_messages,
            response_format={"type": "json_object"},
        )

    # Primary attempt: send remote URL directly
    messages = [
        {"role": "system", "content": system},
        {
            "role": "user",
            "content": [
                {"type": "text", "text": user},
                {"type": "image_url", "image_url": {"url": image_url}},
            ],
        },
    ]
    try:
        resp = _call(messages)
    except BadRequestError:
        # Fallback: fetch image bytes and embed as a base64 data URL so the model doesn't have to fetch it remotely
        try:
            r = requests.get(image_url, timeout=20)
            r.raise_for_status()
            blob = r.content
            # Determine mime type: prefer response header; else guess from URL
            ctype = r.headers.get("Content-Type") or mimetypes.guess_type(image_url)[0] or "image/jpeg"
            b64 = base64.b64encode(blob).decode("ascii")
            data_url = f"data:{ctype};base64,{b64}"
            messages = [
                {"role": "system", "content": system},
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": user},
                        {"type": "image_url", "image_url": {"url": data_url}},
                    ],
                },
            ]
            resp = _call(messages)
        except Exception:
            # Last resort: try without the image to surface a graceful structured default
            resp = _call([
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ])
    text = resp.choices[0].message.content
    try:
        data = json.loads(text)
    except Exception:
        data = {}
    # Normalize fields
    out = {
        "title": data.get("title") or None,
        "audience": data.get("audience") or "",
        "benefits": [x for x in (data.get("benefits") or []) if isinstance(x, str)],
        "pain_points": [x for x in (data.get("pain_points") or []) if isinstance(x, str)],
        "colors": [x for x in (data.get("colors") or []) if isinstance(x, str)],
        "sizes": [x for x in (data.get("sizes") or []) if isinstance(x, str)],
        "variants": [
            {"name": (v or {}).get("name"), "description": (v or {}).get("description")}
            for v in (data.get("variants") or [])
            if isinstance(v, dict)
        ],
    }
    return out

LANDING_COPY_PROMPT = (
    "You are a CRO specialist and landing-page copy engineer.\n"
    "\n"
    "Goal\n"
    "Produce ONE valid JSON object with high-converting landing copy AND a complete, self-contained HTML page that embeds only the image URLs provided by the user. No markdown, no prose outside JSON.\n\n"
    "Output Contract\n"
    "Return exactly this JSON shape:\n"
    "{\n"
    "  \"headline\": string,\n"
    "  \"subheadline\": string,\n"
    "  \"sections\": [ { \"id\": \"hero\"|\"highlights\"|\"feature_gallery\"|\"quick_specs\"|\"trust_badges\"|\"reviews\"|\"cta_block\"|\"colors\", \"title\": string, \"body\": string, \"image_url\": string|null, \"image_alt\": string } ],\n"
    "  \"faq\": [ { \"q\": string, \"a\": string } ],\n"
    "  \"cta\": { \"primary_label\": string, \"primary_url\": string, \"secondary_label\": string|null, \"secondary_url\": string|null },\n"
    "  \"html\": string,\n"
    "  \"assets_used\": { \"hero\": string|null, \"feature_gallery\": string[] }\n"
    "}\n\n"
    "Strict Section Requirements\n"
    "- hero: One big idea + 2 short lines + 1–2 CTAs. Include ONE specific proof point above the fold (e.g., \"24–48h city delivery\", \"Non-slip sole tested on tile\"). Use the best available image as hero.\n"
    "- highlights: 4–6 concise, concrete bullets; preempt 2 objections (fit, durability, shipping).\n"
    "- feature_gallery: 3–10 images mapped from provided image URLs; short captions with specific benefits.\n"
    "- quick_specs: materials, sizes, colors, delivery window; write specifics (numbers, materials, windows).\n"
    "- trust_badges: COD, 24–48h delivery (city), Easy Returns, WhatsApp Support.\n"
    "- reviews: 2–4 short quotes with tangible benefits (\"stays on during play\", \"warm after 2 hours\").\n"
    "- cta_block: benefit-led headline + action-oriented button (\"Get Yours Today\", \"Try Risk-Free\"). Add helper microcopy near CTA (\"COD available\", \"24–48h city delivery\").\n\n"
    "Angle & Copy Rules\n"
    "- Persona & Pain: Identify top 1–2 buyer personas; hero copy must state their #1 pain and desired outcome.\n"
    "- Angle: Choose ONE sharp angle (Safety, Comfort, Speed, Savings) and keep it consistent across sections.\n"
    "- Offer Framing: Surface a concrete proof point above the fold.\n"
    "- Specificity: Use numbers, materials, sizes, delivery windows, named features. No hype, no emojis, no ALL CAPS.\n"
    "- Tone: confident, plain-spoken, brand-safe.\n"
    "- Language: default English; if {LANGUAGE} provided, write naturally in that language.\n"
    "- Mobile First: lines ≤ 72 chars; scannable bullets.\n\n"
    "Image Mapping Rules\n"
    "- Use ONLY the provided image URLs. Never invent URLs. Never output placeholders.\n"
    "- Map first best image to hero; remaining to feature_gallery (up to 10). If no suitable image for a section, set image_url = null.\n"
    "- Always provide meaningful image_alt. If colors are provided, include a \"colors\" section with text pills (no color swatches images).\n\n"
    "SEO & Accessibility\n"
    "- <title> ≤ 60 chars; <meta name=\"description\"> 140–160 chars; include the primary keyword in H1 and first paragraph.\n"
    "- All images: descriptive alt text. Buttons are <a> with clear labels; no color-only meaning.\n\n"
    "HTML Requirements\n"
    "- The \"html\" field must be a complete self-contained page with ONE <style> tag (no external CSS/JS).\n"
    "- Mobile-first responsive CSS; improve on desktop.\n"
    "- Render sections in this order: hero, highlights, feature_gallery, quick_specs, trust_badges, reviews, cta_block, faq (optional).\n"
    "- Embed ONLY provided image URLs. No placeholders.\n\n"
    "CRO Checklist (auto-repair before output)\n"
    "- Hero states primary benefit + differentiator within 2 lines.\n"
    "- ≥1 specific proof above the fold.\n"
    "- 4–6 concrete Highlights bullets (objections included).\n"
    "- CTA appears in Hero and in CTA Block.\n"
    "- Sizes/colors/fit in Quick Specs.\n"
    "- Badges present (COD, 24–48h delivery, Easy Returns, WhatsApp Support).\n\n"
    "DATA HOOKS (fill from PRODUCT_INFO when available)\n"
    "- Materials/Features: {MATERIALS_FEATURES}\n"
    "- Sizes/Colors: {SIZES_COLORS}\n"
    "- Proof/Tests/Guarantees: {PROOF_POINTS}\n"
    "- Offers/Delivery/Returns: {OFFER_DELIVERY_RETURNS}\n"
    "- Primary Keyword: {PRIMARY_KEYWORD}\n"
    "- Audience: {AUDIENCE}\n"
    "- Angle: {ANGLE}\n\n"
    "Return ONLY the JSON object described in Output Contract.\n"
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
    if len(images) > 10:
        images = images[:10]
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
    "You are a CRO copywriter. From the given ANGLE and PRODUCT_INFO, first craft 5 HIGH-CONVERTING product title options for the specified audience, each ≤60 characters, plus one extra ultra-short option ≤30 characters. Each title must include the primary keyword, one concrete benefit/outcome, and a unique differentiator (material/feature/offer). Use specific power words, no fluff, no emojis, no ALL CAPS.\n"
    "Then select the single best title and write a concise 1–2 sentence description that is brand-safe, concrete, and benefit-led (no exaggerated claims).\n"
    "Respond ONLY with valid json: {\"title\": string, \"description\": string}. Optionally, you may include {\"candidates\": string[]} but ensure the top-level object contains 'title' and 'description'."
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


# ---------------- Analyze landing page URL ----------------
@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, max=8))
def analyze_landing_page(url: str, model: str | None = None, prompt_override: str | None = None) -> dict:
    """Fetch a landing page and extract structured marketing insights using OpenAI.

    Returns a dict with keys: title, benefits[], pain_points[], offers[], emotions[],
    angles[] (each: {name, headlines[], primaries[]}), images[] (absolute URLs).
    """
    import requests, bs4, urllib.parse
    try:
        r = requests.get(url, timeout=20, headers={"User-Agent": "Mozilla/5.0"})
        r.raise_for_status()
        html = r.text
    except Exception:
        html = ""
    # Lightweight parse for image URLs as a fallback
    images: list[str] = []
    try:
        soup = bs4.BeautifulSoup(html or "", "html.parser")
        srcs = []
        for im in soup.find_all("img"):
            s = im.get("src") or ""
            if s:
                srcs.append(s)
        # Absolutize
        images = [s if s.startswith("http") else urllib.parse.urljoin(url, s) for s in srcs]
        # de-dup and limit
        dedup = []
        for u in images:
            if u not in dedup:
                dedup.append(u)
        images = dedup[:12]
    except Exception:
        images = []

    base_instr = (
        "You are a senior direct-response marketer. Given landing page HTML, extract high-converting inputs. "
        "Respond ONLY as a compact JSON object with keys: title, benefits (array of short bullets), "
        "pain_points (array), offers (array), emotions (array), angles (array of objects with fields: name, "
        "headlines (array of 3-6 short options), primaries (array of 3-6 options))."
    )
    if prompt_override and isinstance(prompt_override, str) and prompt_override.strip():
        system = (prompt_override.strip() + "\n\n" + base_instr)
    else:
        system = base_instr
    user = (
        "Analyze this landing page HTML and produce the JSON. Avoid prose, no markdown. HTML follows:\n\n" + (html[:180000] if html else "")
    )

    def _call(_messages: list[dict]):
        return client.chat.completions.create(
            model=(model or DEFAULT_LLM_MODEL),
            messages=_messages,
            response_format={"type": "json_object"},
        )

    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]
    try:
        resp = _call(messages)
        text = resp.choices[0].message.content
        data = json.loads(text)
    except Exception:
        data = {}
    out = {
        "title": data.get("title") if isinstance(data, dict) else None,
        "benefits": data.get("benefits") if isinstance(data, dict) else None,
        "pain_points": data.get("pain_points") if isinstance(data, dict) else None,
        "offers": data.get("offers") if isinstance(data, dict) else None,
        "emotions": data.get("emotions") if isinstance(data, dict) else None,
        "angles": data.get("angles") if isinstance(data, dict) else None,
        "images": images,
        "url": url,
    }
    # Normalize arrays
    for k in ("benefits", "pain_points", "offers", "emotions"):
        v = out.get(k)
        if not isinstance(v, list):
            out[k] = []
        else:
            out[k] = [str(x).strip() for x in v if isinstance(x, (str, int))]
    # Normalize angles
    try:
        angs = out.get("angles")
        if not isinstance(angs, list):
            out["angles"] = []
        else:
            norm = []
            for a in angs:
                if not isinstance(a, dict):
                    continue
                name = str(a.get("name") or "Angle").strip()
                headlines = a.get("headlines") if isinstance(a.get("headlines"), list) else []
                primaries = a.get("primaries") if isinstance(a.get("primaries"), list) else []
                headlines = [str(h).strip() for h in headlines if str(h).strip()]
                primaries = [str(p).strip() for p in primaries if str(p).strip()]
                norm.append({"name": name, "headlines": headlines, "primaries": primaries})
            out["angles"] = norm
    except Exception:
        out["angles"] = []
    out["prompt_used"] = system
    return out