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
    "You are a direct-response strategist. Given the PRODUCT INFO as JSON, respond with ONLY valid JSON following this exact schema: "
    "{\"angles\":[{\"name\":str,\"ksp\":[str,str,str],\"headlines\":[str,str,str,str,str],\"titles\":[str,str],\"primaries\":[str,str]}]}.\n"
    "Rules: headlines <= 40 chars; titles <= 30; primaries <= 120; avoid disallowed ad claims.\n"
)

@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, max=8))
def gen_angles_and_copy(payload: dict, model: str | None = None) -> list:
    msg = (
        BASE_PROMPT
        + "PRODUCT INFO:\n"
        + json.dumps(payload, ensure_ascii=False)
        + f"\nAudience: {payload.get('audience')}"
    )
    resp = client.chat.completions.create(
        model=(model or DEFAULT_LLM_MODEL),
        messages=[{"role":"user","content":msg}],
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
    "You are a CRO specialist. Given PRODUCT INFO and top angles, output ONLY valid JSON with keys: "
    "{\"headline\": str, \"subheadline\": str, \"sections\": [{\"title\": str, \"body\": str}], \"faq\": [{\"q\": str, \"a\": str}], \"cta\": str, \"html\": str}. "
    "The html should be a concise landing snippet with semantic tags, no external CSS, safe inline styles."
)

@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, max=8))
def gen_landing_copy(payload: dict, angles: list, model: str | None = None) -> dict:
    msg = (
        LANDING_COPY_PROMPT
        + "\nPRODUCT INFO:\n"
        + json.dumps(payload, ensure_ascii=False)
        + "\nTOP ANGLES:\n"
        + json.dumps(angles[:3], ensure_ascii=False)
    )
    resp = client.chat.completions.create(
        model=(model or DEFAULT_LLM_MODEL),
        messages=[{"role":"user","content":msg}],
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
            messages = [{"role":"user","content": content}]
        else:
            messages = [{"role":"user","content": msg_text}]
        resp = _call(messages)
    except BadRequestError as e:
        # If image fetch failed on OpenAI side, retry once without images as a graceful fallback
        if images:
            resp = _call([{ "role":"user", "content": msg_text }])
        else:
            raise
    text = resp.choices[0].message.content
    try:
        data = json.loads(text)
        return {"title": data.get("title"), "description": data.get("description")}
    except Exception:
        return {"title": None, "description": None}