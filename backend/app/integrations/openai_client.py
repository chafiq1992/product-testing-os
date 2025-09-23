import os, json
from tenacity import retry, stop_after_attempt, wait_exponential
from openai import OpenAI, BadRequestError
import base64
import mimetypes
import requests
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
def gen_product_from_image(image_url: str, model: str | None = None) -> dict:
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
    system = (
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
    "Goal: Produce a single json object with high-converting landing copy and a complete HTML page (self-contained) that embeds only the image URLs provided by the user.\n\n"
    "Output Contract\n"
    "Return one valid json object (no markdown, no prose) with these keys:\n"
    "- headline (string)\n"
    "- subheadline (string)\n"
    "- sections (array of { id, title, body, image_url|null, image_alt })\n"
    "  Recommended IDs: \"hero\",\"highlights\",\"colors\",\"feature_gallery\",\"quick_specs\",\"trust_badges\",\"reviews\",\"cta_block\"\n"
    "- faq (array of { q, a })\n"
    "- cta ({ primary_label, primary_url, secondary_label, secondary_url })\n"
    "- html (string) — a complete, self-contained page that includes ONE <style> tag (no external CSS/JS) with mobile-first responsive CSS for both mobile and desktop\n"
    "- assets_used (object) mapping provided images actually used\n\n"
    "Image Mapping Rules\n"
    "- Use only provided image URLs; never invent URLs.\n"
    "- Prefer an image labeled \"hero\" for the hero section; else first wide image.\n"
    "- Map remaining images to \"feature_gallery\" (≤10) and \"reviews\" if labels include \"review\".\n"
    "- If input includes \"colors\", render a \"colors\" section with pills (no images).\n"
    "- Always set meaningful image_alt; if no suitable image for a section, image_url = null.\n\n"
    "Copy Guidelines\n"
    "- IMPORTANT: Write everything in English (en) regardless of inputs.\n"
    "- Follow audience & tone from input; default to parents in Morocco (warm, trustworthy).\n"
    "- Focus on benefits, differentiation, clear outcomes; short paragraphs; bullets where helpful.\n"
    "- If region is \"MA\", include trust signals: Cash on Delivery, fast city delivery, easy returns, WhatsApp support.\n"
    "- Ignore any non-English preferences and keep language strictly English.\n\n"
    "Layout Spec for html\n"
    "- Include <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" /> in the <head>.\n"
    "- Wrap content in a centered container: .lp-container { max-width:1200px; margin:0 auto; padding:0 16px; }\n"
    "- Sections (mobile-first):\n"
    "  1) Hero (.lp-hero: big headline, subhead, primary CTA, optional hero image)\n"
    "  2) Highlights (4–6 bullet benefits)\n"
    "  3) Color Options (if provided)\n"
    "  4) Feature Gallery (image + short copy cards)\n"
    "  5) Quick Specs (compact list/table)\n"
    "  6) Trust Badges (styled text badges)\n"
    "  7) Reviews (2–3 short testimonials)\n"
    "  8) CTA Block (bold final CTA + optional secondary CTA)\n"
    "  9) Footer (small print, contact)\n\n"
    "Styling constraints (embedded <style> only, no external CSS/JS):\n"
    "- Define minimal classes and media queries: .lp-container, .lp-hero, .lp-section, .lp-img, .lp-text, .lp-grid, .cols-2, .cols-3.\n"
    "- Mobile: single column. Desktop (>=1024px): use grid for .lp-section (2 columns) and 3 columns for galleries (.lp-grid.cols-3).\n"
    "- Use brand primary (fallback #004AAD); rounded cards, soft shadows, generous spacing, system fonts.\n"
    "- Buttons large & accessible; ensure color contrast.\n"
    "- All images: loading=\"lazy\", width:100%, height:auto, border-radius:12px.\n\n"
    "Validation:\n"
    "- html must be valid and self-contained (no external CSS/JS).\n"
    "- Use only provided image URLs.\n"
    "- Ensure all CTAs use provided URLs; if missing, use \"#\".\n"
    "- CRITICAL: Output must be a single valid json object only (no markdown, no explanations).\n"
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