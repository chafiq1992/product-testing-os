import os
from typing import List, Tuple, Dict, Any


def _try_import_genai():
    try:
        import google.generativeai as genai  # type: ignore
        return genai
    except Exception:
        return None


def _to_data_url(mime: str, b: bytes) -> str:
    import base64
    return f"data:{mime};base64,{base64.b64encode(b).decode('ascii')}"


def _fetch_image_bytes(url: str) -> Tuple[str, bytes] | None:
    try:
        import requests
        resp = requests.get(url, timeout=20)
        resp.raise_for_status()
        mime = resp.headers.get("content-type") or "image/jpeg"
        return mime, resp.content
    except Exception:
        return None


def _extract_inline_images(resp) -> List[Tuple[str, bytes]]:
    """Best-effort extraction of inline image bytes from Gemini SDK responses.

    Returns list of (mime, bytes).
    """
    results: List[Tuple[str, bytes]] = []
    try:
        # New SDK style: resp.candidates[i].content.parts[j].inline_data { mime_type, data(b64) }
        candidates = getattr(resp, "candidates", None) or []
        for c in candidates:
            content = None
            if isinstance(c, dict):
                content = (c.get("content") or {})
                parts = (content.get("parts") or [])
            else:
                content = getattr(c, "content", None)
                parts = getattr(content, "parts", []) if content is not None else []
            for p in parts or []:
                inline = None
                if isinstance(p, dict):
                    inline = p.get("inline_data")
                else:
                    inline = getattr(p, "inline_data", None)
                if inline:
                    mime = (inline.get("mime_type") if isinstance(inline, dict) else getattr(inline, "mime_type", None)) or "image/png"
                    data = (inline.get("data") if isinstance(inline, dict) else getattr(inline, "data", None))
                    if data:
                        # data is base64-encoded string per SDK; support raw bytes just in case
                        if isinstance(data, (bytes, bytearray)):
                            results.append((mime, bytes(data)))
                        else:
                            import base64
                            try:
                                results.append((mime, base64.b64decode(data)))
                            except Exception:
                                continue
    except Exception:
        return []
    return results


def gen_ad_images_from_image(image_url: str, prompt: str, num_images: int = 1) -> List[str]:
    """Generate ad images using Google Gemini/Imagen, conditioned on a source image.

    Returns a list of data URLs. If Gemini isn't configured/available, returns the
    original image URL as a single-item list as a graceful fallback.
    """
    api_key = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")
    genai = _try_import_genai()

    # Fallback: no library or key → return the source image URL
    if not (genai and api_key):
        return [image_url]

    fetched = _fetch_image_bytes(image_url)
    if not fetched:
        # If we can't fetch the image bytes, still return the original URL
        return [image_url]

    mime, blob = fetched

    try:
        # Configure client
        genai.configure(api_key=api_key)

        # Prefer Gemini 2.5 Flash Image preview; fall back to Imagen 3 or source image
        images: List[str] = []
        # Attempt Gemini 2.5 Flash Image generation with image conditioning
        try:
            model = genai.GenerativeModel("gemini-2.5-flash-image-preview")
            # Some SDKs support batch via generation_config num_images; otherwise loop
            count = max(1, int(num_images))
            for _ in range(count):
                try:
                    out = model.generate_content([
                        {"mime_type": mime, "data": blob},
                        prompt,
                    ])
                    pairs = _extract_inline_images(out)
                    for mm, bb in pairs:
                        images.append(_to_data_url(mm or "image/png", bb))
                except Exception:
                    continue
        except Exception:
            pass

        # If Gemini 2.5 path failed, try Imagen edit, then Imagen generate as legacy fallbacks
        if not images:
            try:
                model = genai.GenerativeModel("imagen-3.0-edit-001")
                out = model.edit_image(
                    prompt=prompt,
                    image={"mime_type": mime, "data": blob},
                    number_of_images=max(1, int(num_images)),
                )
                candidates = getattr(out, "images", None) or getattr(out, "candidates", None) or []
                for c in candidates:
                    if isinstance(c, (bytes, bytearray)):
                        images.append(_to_data_url(mime, bytes(c)))
                    else:
                        try:
                            data = c.get("image", {}).get("data")
                            if isinstance(data, (bytes, bytearray)):
                                images.append(_to_data_url(mime, bytes(data)))
                        except Exception:
                            continue
            except Exception:
                try:
                    model = genai.GenerativeModel("imagen-3.0-generate-001")
                    out = model.generate_images(
                        prompt=f"{prompt}\nReference photo URL: {image_url}",
                        number_of_images=max(1, int(num_images)),
                    )
                    candidates = getattr(out, "images", None) or getattr(out, "candidates", None) or []
                    for c in candidates:
                        if isinstance(c, (bytes, bytearray)):
                            images.append(_to_data_url("image/png", bytes(c)))
                        else:
                            try:
                                data = c.get("image", {}).get("data")
                                if isinstance(data, (bytes, bytearray)):
                                    images.append(_to_data_url("image/png", bytes(data)))
                            except Exception:
                                continue
                except Exception:
                    images = []

        # If generation failed, gracefully return the original URL
        if not images:
            return [image_url]
        return images
    except Exception:
        # Ultimate fallback
        return [image_url]


def build_promotional_prompts(product: Dict[str, Any], angles: List[Dict[str, Any]], count: int = 4) -> List[str]:
    """Create a list of concise, high-converting ad prompts derived from provided angles.

    Each prompt is product-first, ecommerce-ready, and tailored to the audience.
    """
    title = (product or {}).get("title") or "product"
    audience = (product or {}).get("audience") or "shoppers"
    price = (product or {}).get("base_price")
    currency = (product or {}).get("currency") or "MAD"
    base_style = (
        "High-converting ecommerce promo photo, product-first, bright neutral backdrop, soft studio light, "
        "crisp edges, subtle shadow, retail-ready, safe 4:5 crop."
    )
    prompts: List[str] = []
    angles = angles or []
    for i in range(max(1, int(count))):
        a = angles[i % len(angles)] if angles else {}
        name = (a or {}).get("name") or (a or {}).get("big_idea") or "Angle"
        promise = (a or {}).get("promise") or ""
        ksp = ", ".join(((a or {}).get("ksp") or [])[:3])
        price_str = f" — Price {price} {currency}" if isinstance(price, (int, float)) else ""
        p = (
            f"Promotional image for {title}. Angle: {name}. {promise} {price_str}. "
            f"Key points: {ksp}. Target: {audience}. {base_style}"
        )
        prompts.append(p)
    return prompts


def gen_promotional_images_from_angles(
    image_url: str,
    product: Dict[str, Any],
    angles: List[Dict[str, Any]],
    count: int = 4,
) -> List[Dict[str, str]]:
    """Generate a set of promotional images (and their prompts) from a source image and angles.

    Returns: [{"prompt": str, "image": data_url}]
    """
    prompts = build_promotional_prompts(product, angles, count=count)
    # Reuse core generator with Gemini 2.5; one image per prompt
    results: List[Dict[str, str]] = []
    gen = _try_import_genai()
    api_key = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")
    fetched = _fetch_image_bytes(image_url)
    if not (gen and api_key and fetched):
        # graceful fallback: return the source image
        return [{"prompt": p, "image": image_url} for p in prompts]
    mime, blob = fetched
    try:
        gen.configure(api_key=api_key)
        model = gen.GenerativeModel("gemini-2.5-flash-image-preview")
        for p in prompts:
            try:
                out = model.generate_content([
                    {"mime_type": mime, "data": blob},
                    p,
                ])
                pairs = _extract_inline_images(out)
                if pairs:
                    mm, bb = pairs[0]
                    results.append({"prompt": p, "image": _to_data_url(mm or "image/png", bb)})
                else:
                    results.append({"prompt": p, "image": image_url})
            except Exception:
                results.append({"prompt": p, "image": image_url})
        return results
    except Exception:
        return [{"prompt": p, "image": image_url} for p in prompts]


