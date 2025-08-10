import os, json
from tenacity import retry, stop_after_attempt, wait_exponential
from openai import OpenAI

client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))

ANGLE_JSON_INSTRUCTIONS = {
    "type": "json_object"
}

ANGLE_PROMPT = (
    "You are a direct-response strategist. Given PRODUCT INFO as JSON, return exactly this JSON schema: "
    "{\"angles\":[{\"name\":str,\"ksp\":[str,str,str],\"headlines\":[str,str,str,str,str],\"titles\":[str,str],\"primaries\":[str,str]}]}\n"
    "Rules: headlines ≤ 40 chars; titles ≤ 30; primaries ≤ 120; avoid claims that might be disallowed by ads policies.\n"
    "PRODUCT INFO:\n{info}\nAudience: {aud}"
)

@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, max=8))
def gen_angles_and_copy(payload: dict) -> list:
    msg = ANGLE_PROMPT.format(info=json.dumps(payload, ensure_ascii=False), aud=payload.get("audience"))
    resp = client.responses.create(
        model="gpt-5",
        input=msg,
        response_format=ANGLE_JSON_INSTRUCTIONS,
    )
    data = json.loads(resp.output_text)
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
