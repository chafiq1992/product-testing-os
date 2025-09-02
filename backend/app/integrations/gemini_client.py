import os
from typing import List, Tuple


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

        # Prefer Imagen 3 generate or edit if available; fall back to text-to-image without conditioning
        images: List[str] = []

        # Attempt Imagen Edit first (conditioned by the input image)
        try:
            # Some SDK versions expose imagen models via GenerativeModel with generate_images/edit methods
            model = genai.GenerativeModel("imagen-3.0-edit-001")
            # SDKs vary: attempt a generic call signature guarded by try/except
            out = model.edit_image(
                prompt=prompt,
                image={"mime_type": mime, "data": blob},
                number_of_images=max(1, int(num_images)),
            )
            # Normalize outputs to bytes
            candidates = getattr(out, "images", None) or getattr(out, "candidates", None) or []
            for c in candidates:
                # Newer SDK: c is bytes; older: c["image"]["data"]
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
            # Fall back to text-to-image generation (no conditioning)
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


