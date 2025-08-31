import os, json
from tenacity import retry, stop_after_attempt, wait_exponential
from openai import OpenAI

# Initialize OpenAI client (reads OPENAI_API_KEY from env)
client = OpenAI()

ANGLE_JSON_INSTRUCTIONS = {"type": "json_object"}

# We build the prompt with an f-string so that only the payload vars are substituted and
# the JSON braces inside the schema remain intact (no KeyError from str.format).
BASE_PROMPT = (
    "You are a direct-response strategist. Given the PRODUCT INFO as JSON, respond with ONLY valid JSON following this exact schema: "
    "{\"angles\":[{\"name\":str,\"ksp\":[str,str,str],\"headlines\":[str,str,str,str,str],\"titles\":[str,str],\"primaries\":[str,str]}]}.\n"
    "Rules: headlines <= 40 chars; titles <= 30; primaries <= 120; avoid disallowed ad claims.\n"
)

@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, max=8))
def gen_angles_and_copy(payload: dict) -> list:
    msg = (
        BASE_PROMPT
        + "PRODUCT INFO:\n"
        + json.dumps(payload, ensure_ascii=False)
        + f"\nAudience: {payload.get('audience')}"
    )
    resp = client.chat.completions.create(
        model="gpt-4o-mini",
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
def gen_landing_copy(payload: dict, angles: list) -> dict:
    msg = (
        LANDING_COPY_PROMPT
        + "\nPRODUCT INFO:\n"
        + json.dumps(payload, ensure_ascii=False)
        + "\nTOP ANGLES:\n"
        + json.dumps(angles[:3], ensure_ascii=False)
    )
    resp = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role":"user","content":msg}],
        response_format={"type":"json_object"}
    )
    text = resp.choices[0].message.content
    try:
        return json.loads(text)
    except Exception:
        return {"headline": None, "subheadline": None, "sections": [], "faq": [], "cta": None, "html": None}