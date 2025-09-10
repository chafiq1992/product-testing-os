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


def _compute_midpoint_size_from_product(product: Dict[str, Any]) -> str | None:
    try:
        sizes = (product or {}).get("sizes") or []
        values: List[float] = []
        import re
        for s in sizes:
            if not isinstance(s, str):
                continue
            nums = re.findall(r"[-+]?[0-9]*\.?[0-9]+", s)
            for n in nums:
                try:
                    values.append(float(n))
                except Exception:
                    continue
        if not values:
            return None
        lo = min(values)
        hi = max(values)
        mid = (lo + hi) / 2.0 if lo != hi else lo
        if abs(mid - round(mid)) < 1e-6:
            return str(int(round(mid)))
        return f"{mid:.1f}".rstrip("0").rstrip(".")
    except Exception:
        return None


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
        "crisp edges, subtle shadow, retail-ready, safe 4:5 crop. "
        "CRITICAL: Replace the original background with a new clean neutral studio backdrop; DO NOT reuse the source background."
    )
    prompts: List[str] = []
    angles = angles or []
    for i in range(max(1, int(count))):
        a = angles[i % len(angles)] if angles else {}
        name = (a or {}).get("name") or (a or {}).get("big_idea") or "Angle"
        promise = (a or {}).get("promise") or ""
        ksp = ", ".join(((a or {}).get("ksp") or [])[:3])
        price_str = f" — Price {price} {currency}" if isinstance(price, (int, float)) else ""
        mid = _compute_midpoint_size_from_product(product)
        size_text = f" Ensure the product shown is size {mid} (midpoint of provided range)." if mid else ""
        p = (
            f"Promotional image for {title}. Angle: {name}. {promise} {price_str}. "
            f"Key points: {ksp}. Target: {audience}. {base_style}{size_text}"
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



# ---------------- Feature/Benefit close-up set ----------------
def build_feature_benefit_prompts(product: Dict[str, Any], count: int = 6) -> List[str]:
    """Create prompts focusing on specific features/benefits and macro close-ups.

    Prioritizes close-up shots that highlight materials, stitching, seams, grip, ports, and any
    product parts that visually communicate the listed benefits.
    """
    title = (product or {}).get("title") or "product"
    audience = (product or {}).get("audience") or "shoppers"
    benefits = [(product or {}).get("benefits") or []]
    # Normalize benefits list of strings
    raw_benefits: List[str] = []
    try:
        for b in (product or {}).get("benefits") or []:
            if isinstance(b, str) and b.strip():
                raw_benefits.append(b.strip())
    except Exception:
        raw_benefits = []

    # If no explicit benefits, use generic feature areas
    if not raw_benefits:
        raw_benefits = [
            "Premium stitching and seams",
            "Material texture and quality",
            "Sole/Grip details",
            "Cushioning and comfort zones",
            "Breathability/vents",
            "Durability reinforcements",
        ]

    base_style = (
        "Ecommerce macro photo from the REFERENCE IMAGE ONLY (no invention). Extreme close-up, "
        "shallow depth of field, soft studio lighting, neutral clean backdrop. Keep product identity, "
        "exact materials, stitching, textures, colors, proportions, and any marks identical to the reference. "
        "Replace any visible original background with a clean neutral studio backdrop; DO NOT reuse the source background. "
        "ACT ONLY AS A CROP/ENHANCEMENT of the reference, do not change or add parts, no text, no logos. 4:5 crop."
    )

    prompts: List[str] = []
    k = max(1, int(count))
    for i in range(k):
        benefit = raw_benefits[i % len(raw_benefits)]
        mid = _compute_midpoint_size_from_product(product)
        size_text = f" Ensure the product shown is size {mid} (midpoint of provided range)." if mid else ""
        p = (
            f"Create a MACRO CLOSE-UP derived strictly from the provided reference photo of {title}. "
            f"Focus on the exact area that demonstrates: {benefit}. "
            f"Use ONLY the reference as source (no re-drawing). If unsure, choose the most visually clear area from the reference. "
            f"Do not change color/material/shape/branding. {base_style} Audience: {audience}.{size_text}"
        )
        prompts.append(p)
    return prompts


def gen_feature_benefit_images(
    image_url: str,
    product: Dict[str, Any],
    count: int = 6,
) -> List[Dict[str, str]]:
    """Generate a set of close-up images that showcase features/benefits.

    Returns: [{"prompt": str, "image": data_url}]
    Falls back to returning the source image if generation isn't available.
    """
    prompts = build_feature_benefit_prompts(product, count=count)
    gen = _try_import_genai()
    api_key = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")
    fetched = _fetch_image_bytes(image_url)
    if not (gen and api_key and fetched):
        return [{"prompt": p, "image": image_url} for p in prompts]
    mime, blob = fetched
    try:
        gen.configure(api_key=api_key)
        model = gen.GenerativeModel("gemini-2.5-flash-image-preview")
        results: List[Dict[str, str]] = []
        for p in prompts:
            success = False
            try:
                out = model.generate_content([
                    {"mime_type": mime, "data": blob},
                    p,
                ])
                pairs = _extract_inline_images(out)
                if pairs:
                    mm, bb = pairs[0]
                    results.append({"prompt": p, "image": _to_data_url(mm or "image/png", bb)})
                    success = True
            except Exception:
                success = False

            # Fallback to Imagen edit (acts more like an edit of the source image)
            if not success:
                try:
                    im = gen.GenerativeModel("imagen-3.0-edit-001")
                    out2 = im.edit_image(
                        prompt=(
                            p + "\nSTRICT: Preserve the product exactly. Perform a close crop and lighting enhancement only."
                        ),
                        image={"mime_type": mime, "data": blob},
                        number_of_images=1,
                    )
                    candidates = getattr(out2, "images", None) or getattr(out2, "candidates", None) or []
                    added = False
                    for c in candidates:
                        if isinstance(c, (bytes, bytearray)):
                            results.append({"prompt": p, "image": _to_data_url(mime, bytes(c))})
                            added = True
                            break
                        else:
                            try:
                                data = c.get("image", {}).get("data")
                                if isinstance(data, (bytes, bytearray)):
                                    results.append({"prompt": p, "image": _to_data_url(mime, bytes(data))})
                                    added = True
                                    break
                            except Exception:
                                pass
                    if not added:
                        results.append({"prompt": p, "image": image_url})
                except Exception:
                    results.append({"prompt": p, "image": image_url})
        return results
    except Exception:
        return [{"prompt": p, "image": image_url} for p in prompts]

# ---------------- Variant extraction + per-variant product images ----------------
def _parse_json_safely(text: str) -> dict | list | None:
    try:
        import json as _json
        # Try to extract the first JSON object/array if extra text is around
        s = text.strip()
        # Find first JSON bracket
        start = min([p for p in [s.find("{"), s.find("[")] if p != -1]) if any(p != -1 for p in [s.find("{"), s.find("[")]) else -1
        if start > 0:
            s = s[start:]
        # Trim trailing non-JSON
        # naive approach: ensure balanced braces/brackets
        def _trim_balanced(val: str) -> str:
            stack = []
            end_idx = len(val)
            for i, ch in enumerate(val):
                if ch in "[{":
                    stack.append(ch)
                elif ch in "]}":
                    if stack:
                        stack.pop()
                        if not stack:
                            end_idx = i + 1
                            break
            return val[:end_idx]
        s = _trim_balanced(s)
        return _json.loads(s)
    except Exception:
        return None


def analyze_variants_from_image(image_url: str, max_variants: int | None = None) -> list[dict]:
    """Analyze a source image and return a list of distinct product variants.

    Each variant is a dict: { "name": str, "description": str, "attributes": { ... } }
    Fallback: returns up to 4 generic variants if analysis is unavailable.
    """
    genai = _try_import_genai()
    api_key = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")
    fetched = _fetch_image_bytes(image_url)
    k = max(1, min(6, int(max_variants) if isinstance(max_variants, int) else 5))
    if not (genai and api_key and fetched):
        return [
            {"name": f"Variant {i+1}", "description": "Distinct product variant detected in the image.", "attributes": {}}
            for i in range(min(4, k))
        ]
    mime, blob = fetched
    try:
        genai.configure(api_key=api_key)
        # Use a multimodal text model for analysis
        model = genai.GenerativeModel("gemini-1.5-flash")
        prompt = (
            "Analyze this photo. List each distinct shoe variant present (colorway/material/style differences). "
            "Respond with ONLY strict JSON: {\n  \"variants\": [ { \"name\": string, \"description\": string, \"attributes\": object } ]\n}. "
            "Keep names short and human-friendly. Limit to 5 variants."
        )
        out = model.generate_content([
            {"mime_type": mime, "data": blob},
            prompt,
        ])
        text = getattr(out, "text", None) or getattr(out, "candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text") if isinstance(getattr(out, "candidates", None), list) else None
        data = _parse_json_safely(text or "") if isinstance(text, str) else None
        variants = []
        if isinstance(data, dict):
            variants = data.get("variants") or []
        elif isinstance(data, list):
            variants = data
        # Normalize
        norm = []
        for i, v in enumerate(variants[:k] if variants else []):
            name = (v or {}).get("name") or f"Variant {i+1}"
            desc = (v or {}).get("description") or "Distinct product variant detected in the image."
            attrs = (v or {}).get("attributes") or {}
            norm.append({"name": name, "description": desc, "attributes": attrs})
        if norm:
            return norm
        # Fallback generic if parsing failed
        return [
            {"name": f"Variant {i+1}", "description": "Distinct product variant detected in the image.", "attributes": {}}
            for i in range(min(4, k))
        ]
    except Exception:
        return [
            {"name": f"Variant {i+1}", "description": "Distinct product variant detected in the image.", "attributes": {}}
            for i in range(min(4, k))
        ]


def gen_variant_images_from_image(
    image_url: str,
    style_prompt: str | None = None,
    max_variants: int | None = None,
    variants_override: list[dict] | None = None,
) -> list[dict]:
    """Generate per-variant product images plus a composite image.

    Returns list of items:
      - { kind: "variant", name, description, image, prompt }
      - { kind: "composite", image, prompt }
    """
    # Use provided variants if available; otherwise analyze from image
    variants: list[dict] = []
    if variants_override:
        for i, v in enumerate(variants_override):
            if not isinstance(v, dict):
                continue
            name = (v or {}).get("name") or f"Variant {i+1}"
            desc = (v or {}).get("description") or "Product variant"
            variants.append({"name": name, "description": desc, "attributes": {}})
    if not variants:
        variants = analyze_variants_from_image(image_url, max_variants=max_variants)
    if not variants:
        variants = [{"name": "Variant", "description": "Product variant", "attributes": {}}]

    genai = _try_import_genai()
    api_key = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")
    fetched = _fetch_image_bytes(image_url)
    if not (genai and api_key and fetched):
        # Fallback to returning the original image as all outputs
        items = []
        for v in variants:
            items.append({
                "kind": "variant",
                "name": v.get("name"),
                "description": v.get("description"),
                "image": image_url,
                "prompt": "fallback",
            })
        items.append({"kind": "composite", "image": image_url, "prompt": "fallback"})
        return items

    mime, blob = fetched
    try:
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel("gemini-2.5-flash-image-preview")
        base_style = (
            "Professional ecommerce product photo, clean neutral background, soft studio lighting, crisp focus, "
            "subtle ground shadow, premium look, 45-degree camera angle, 4:5 crop. "
            "CRITICAL: Replace the original background with a new clean neutral studio backdrop; DO NOT reuse the source background."
        )
        items: list[dict] = []

        # Generate one product image per variant
        for v in variants:
            name = v.get("name") or "Variant"
            desc = v.get("description") or ""
            style = f"{base_style} " + (style_prompt or "")
            prompt = (
                f"Create a clean standalone product image isolating the '{name}' product variant from the reference photo. "
                f"Use the visual characteristics described: {desc}. {style}"
            )
            try:
                out = model.generate_content([
                    {"mime_type": mime, "data": blob},
                    prompt,
                ])
                pairs = _extract_inline_images(out)
                if pairs:
                    mm, bb = pairs[0]
                    items.append({
                        "kind": "variant",
                        "name": name,
                        "description": desc,
                        "image": _to_data_url(mm or "image/png", bb),
                        "prompt": prompt,
                    })
                else:
                    items.append({
                        "kind": "variant",
                        "name": name,
                        "description": desc,
                        "image": image_url,
                        "prompt": prompt,
                    })
            except Exception:
                items.append({
                    "kind": "variant",
                    "name": name,
                    "description": desc,
                    "image": image_url,
                    "prompt": prompt,
                })

        # Generate a composite group shot of all variants together
        names = ", ".join([v.get("name") or "Variant" for v in variants])
        style = f"{base_style} " + (style_prompt or "")
        comp_prompt = (
            f"Create a single hero product image showing all distinct product variants together: {names}. "
            f"Arrange them in a balanced composition, visually appealing and well-posed. {style}"
        )
        try:
            out = model.generate_content([
                {"mime_type": mime, "data": blob},
                comp_prompt,
            ])
            pairs = _extract_inline_images(out)
            if pairs:
                mm, bb = pairs[0]
                items.append({
                    "kind": "composite",
                    "image": _to_data_url(mm or "image/png", bb),
                    "prompt": comp_prompt,
                })
            else:
                items.append({"kind": "composite", "image": image_url, "prompt": comp_prompt})
        except Exception:
            items.append({"kind": "composite", "image": image_url, "prompt": comp_prompt})

        return items
    except Exception:
        # On failure return fallbacks
        items = []
        for v in variants:
            items.append({
                "kind": "variant",
                "name": v.get("name"),
                "description": v.get("description"),
                "image": image_url,
                "prompt": "fallback",
            })
        items.append({"kind": "composite", "image": image_url, "prompt": "fallback"})
        return items
