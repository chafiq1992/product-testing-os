import os, requests, base64
from tenacity import retry, stop_after_attempt, wait_exponential
from dotenv import load_dotenv
load_dotenv()

def _normalize_shop_domain(val: str) -> str:
    v = (val or "").strip()
    # remove protocol if provided and any stray whitespace or slashes
    if v.lower().startswith("https://"):
        v = v[8:]
    elif v.lower().startswith("http://"):
        v = v[7:]
    v = v.strip().strip("/\t\n\r ")
    return v

SHOP = _normalize_shop_domain(os.getenv("SHOPIFY_SHOP_DOMAIN", ""))  # your-store.myshopify.com
TOKEN = os.getenv("SHOPIFY_ACCESS_TOKEN", "")
API_KEY = os.getenv("SHOPIFY_API_KEY", "")
PASSWORD = os.getenv("SHOPIFY_PASSWORD", "")
API_VERSION = os.getenv("SHOPIFY_API_VERSION", "2025-07")
GQL = f"https://{SHOP}/admin/api/{API_VERSION}/graphql.json"

headers = {
    "Content-Type": "application/json"
}
if TOKEN:
    headers["X-Shopify-Access-Token"] = TOKEN

PRODUCT_CREATE = """
mutation CreateProduct($input: ProductInput!) {
  productCreate(input: $input) {
    product {
      id
      handle
      onlineStoreUrl
      title
      status
      options { name values }
      variants(first: 100) {
        nodes { id inventoryItem { id } }
      }
    }
    userErrors { field message }
  }
}
"""

PAGE_CREATE = """
mutation CreatePage($page: PageCreateInput!) {
  pageCreate(page: $page) {
    page { id handle title }
    userErrors { field message }
  }
}
"""

PRODUCT_UPDATE = """
mutation UpdateProduct($input: ProductInput!) {
  productUpdate(input: $input) {
    product { id handle onlineStoreUrl title status }
    userErrors { field message }
  }
}
"""

@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, max=8))
def _gql(query: str, variables: dict):
    if not SHOP:
        raise RuntimeError("SHOPIFY_SHOP_DOMAIN is not set. Please configure SHOPIFY_SHOP_DOMAIN env var.")
    # Choose auth: prefer Bearer token; else fallback to Basic auth with API key/password
    auth = None
    if not TOKEN:
        if API_KEY and PASSWORD:
            auth = (API_KEY, PASSWORD)
        else:
            raise RuntimeError("Provide either SHOPIFY_ACCESS_TOKEN or both SHOPIFY_API_KEY and SHOPIFY_PASSWORD.")
    r = requests.post(GQL, headers=headers, json={"query": query, "variables": variables}, timeout=60, auth=auth)
    r.raise_for_status()
    j = r.json()
    if "errors" in j:
        raise RuntimeError(j["errors"])
    data = j.get("data")
    ue = (data or {}).get("productCreate", {}).get("userErrors") or (data or {}).get("pageCreate", {}).get("userErrors")
    if ue:
        raise RuntimeError(ue)
    return data


def _rest_post(path: str, payload: dict):
    """Minimal REST helper for endpoints not covered by GraphQL (e.g., product images)."""
    if not SHOP:
        raise RuntimeError("SHOPIFY_SHOP_DOMAIN is not set. Please configure SHOPIFY_SHOP_DOMAIN env var.")
    base = f"https://{SHOP}/admin/api/{API_VERSION}"
    url = f"{base}{path}"
    auth = None
    if not TOKEN:
        if API_KEY and PASSWORD:
            auth = (API_KEY, PASSWORD)
        else:
            raise RuntimeError("Provide either SHOPIFY_ACCESS_TOKEN or both SHOPIFY_API_KEY and SHOPIFY_PASSWORD.")
    r = requests.post(url, headers=headers, json=payload, timeout=60, auth=auth)
    r.raise_for_status()
    return r.json() if r.content else {}


def _rest_get(path: str):
    if not SHOP:
        raise RuntimeError("SHOPIFY_SHOP_DOMAIN is not set. Please configure SHOPIFY_SHOP_DOMAIN env var.")
    base = f"https://{SHOP}/admin/api/{API_VERSION}"
    url = f"{base}{path}"
    auth = None
    if not TOKEN:
        if API_KEY and PASSWORD:
            auth = (API_KEY, PASSWORD)
        else:
            raise RuntimeError("Provide either SHOPIFY_ACCESS_TOKEN or both SHOPIFY_API_KEY and SHOPIFY_PASSWORD.")
    r = requests.get(url, headers=headers, timeout=60, auth=auth)
    r.raise_for_status()
    return r.json() if r.content else {}


def _rest_put(path: str, payload: dict):
    if not SHOP:
        raise RuntimeError("SHOPIFY_SHOP_DOMAIN is not set. Please configure SHOPIFY_SHOP_DOMAIN env var.")
    base = f"https://{SHOP}/admin/api/{API_VERSION}"
    url = f"{base}{path}"
    auth = None
    if not TOKEN:
        if API_KEY and PASSWORD:
            auth = (API_KEY, PASSWORD)
        else:
            raise RuntimeError("Provide either SHOPIFY_ACCESS_TOKEN or both SHOPIFY_API_KEY and SHOPIFY_PASSWORD.")
    r = requests.put(url, headers=headers, json=payload, timeout=60, auth=auth)
    r.raise_for_status()
    return r.json() if r.content else {}


def _extract_numeric_id_from_gid(gid: str) -> str | None:
    try:
        return (gid or "").split("/")[-1] or None
    except Exception:
        return None


def upload_images_to_product(product_gid: str, image_srcs: list[str], alt_texts: list[str] | None = None) -> list[str]:
    """Attach remote images to a Shopify product and return Shopify CDN URLs.

    Best-effort: continues on individual failures and returns all successful CDN URLs.
    """
    if not image_srcs:
        return []
    numeric_id = _extract_numeric_id_from_gid(product_gid)
    if not numeric_id:
        return []
    cdn_urls: list[str] = []
    for idx, src in enumerate(image_srcs):
        try:
            alt = (alt_texts[idx] if (alt_texts and idx < len(alt_texts)) else None) or "Product image"
            resp = _rest_post(f"/products/{numeric_id}/images.json", {"image": {"src": src, "alt": alt}})
            try:
                cdn = (resp or {}).get("image", {}).get("src")
                if cdn:
                    cdn_urls.append(cdn)
            except Exception:
                pass
        except Exception:
            # Ignore per-image failures to avoid blocking the flow
            continue
    return cdn_urls


def upload_images_to_product_verbose(product_gid: str, image_srcs: list[str], alt_texts: list[str] | None = None) -> dict:
    """Upload images and return detailed per-image outcomes plus collected CDN URLs."""
    results: list[dict] = []
    cdn_urls: list[str] = []
    numeric_id = _extract_numeric_id_from_gid(product_gid)
    if not (numeric_id and image_srcs):
        return {"cdn_urls": [], "per_image": results}
    for idx, src in enumerate(image_srcs):
        try:
            alt = (alt_texts[idx] if (alt_texts and idx < len(alt_texts)) else None) or "Product image"
            resp = _rest_post(f"/products/{numeric_id}/images.json", {"image": {"src": src, "alt": alt}})
            cdn = (resp or {}).get("image", {}).get("src")
            if cdn:
                cdn_urls.append(cdn)
            results.append({"src": src, "ok": True, "cdn": cdn, "resp_keys": list((resp or {}).keys())})
        except Exception as e:
            results.append({"src": src, "ok": False, "error": str(e)})
            continue
    return {"cdn_urls": cdn_urls, "per_image": results}


def upload_image_attachments_to_product(product_gid: str, files: list[tuple[str, bytes]], alt_texts: list[str] | None = None) -> dict:
    """Upload local files as base64 attachments to a Shopify product. Returns cdn_urls and per-image outcomes.

    files: list of (filename, bytes)
    """
    results: list[dict] = []
    cdn_urls: list[str] = []
    numeric_id = _extract_numeric_id_from_gid(product_gid)
    if not (numeric_id and files):
        return {"cdn_urls": [], "per_image": results}
    for idx, (filename, blob) in enumerate(files):
        try:
            b64 = base64.b64encode(blob).decode("ascii")
            alt = (alt_texts[idx] if (alt_texts and idx < len(alt_texts)) else None) or "Product image"
            payload = {"image": {"attachment": b64, "filename": filename, "alt": alt}}
            resp = _rest_post(f"/products/{numeric_id}/images.json", payload)
            cdn = (resp or {}).get("image", {}).get("src")
            if cdn:
                cdn_urls.append(cdn)
            results.append({"filename": filename, "ok": True, "cdn": cdn, "resp_keys": list((resp or {}).keys())})
        except Exception as e:
            results.append({"filename": filename, "ok": False, "error": str(e)})
            continue
    return {"cdn_urls": cdn_urls, "per_image": results}


def list_product_images(product_gid: str) -> list[dict]:
    numeric_id = _extract_numeric_id_from_gid(product_gid)
    if not numeric_id:
        return []
    try:
        data = _rest_get(f"/products/{numeric_id}/images.json")
        return (data or {}).get("images", []) or []
    except Exception:
        return []


def _get_primary_location_id() -> str | None:
    try:
        data = _rest_get("/locations.json")
        locs = (data or {}).get("locations") or []
        for loc in locs:
            try:
                if loc.get("active", True):
                    return str(loc.get("id"))
            except Exception:
                continue
        # Fallback to first location if none marked active
        if locs:
            return str(locs[0].get("id"))
    except Exception:
        return None
    return None


def _set_inventory_tracked(inventory_item_id: str, tracked: bool = True) -> None:
    try:
        _rest_put(f"/inventory_items/{inventory_item_id}.json", {"inventory_item": {"id": int(inventory_item_id), "tracked": bool(tracked)}})
    except Exception:
        # best-effort; do not raise to avoid blocking the flow
        pass


def _set_inventory_level(location_id: str, inventory_item_id: str, available: int) -> None:
    try:
        _rest_post("/inventory_levels/set.json", {
            "location_id": int(location_id),
            "inventory_item_id": int(inventory_item_id),
            "available": int(available)
        })
    except Exception:
        # best-effort; do not raise to avoid blocking the flow
        pass


def create_product_only(title: str, description_html: str | None = None, status: str = "ACTIVE", price: float | None = None, sizes: list[str] | None = None, colors: list[str] | None = None) -> dict:
    inp: dict = {
        "title": title or "Offer",
        "status": status,
    }
    # Build product options and variants if provided
    option_names: list[str] = []
    values_size = [s for s in (sizes or []) if isinstance(s, str) and s.strip()]
    values_color = [c for c in (colors or []) if isinstance(c, str) and c.strip()]
    if values_size:
        option_names.append("Size")
    if values_color:
        option_names.append("Color")
    if option_names:
        inp["options"] = option_names
        # Cartesian product of options
        size_vals = values_size or ["Default"]
        color_vals = values_color or ["Default"]
        combos: list[list[str]] = []
        if values_size and values_color:
            for sv in size_vals:
                for cv in color_vals:
                    combos.append([sv, cv])
        elif values_size:
            for sv in size_vals:
                combos.append([sv])
        elif values_color:
            for cv in color_vals:
                combos.append([cv])
        variants: list[dict] = []
        for opts in combos:
            v: dict = {"options": opts}
            if price is not None:
                # GraphQL expects a decimal string for price
                v["price"] = str(price)
            variants.append(v)
        if variants:
            inp["variants"] = variants
    else:
        # Single variant price if provided
        if price is not None:
            inp["variants"] = [{"price": str(price)}]
    if description_html:
        inp["descriptionHtml"] = description_html
    data = _gql(PRODUCT_CREATE, {"input": inp})
    prod = data["productCreate"]["product"]
    # Best-effort inventory tracking and quantity set to 2 for each variant
    try:
        location_id = _get_primary_location_id()
        if location_id:
            nodes = (((prod or {}).get("variants") or {}).get("nodes") or [])
            for n in nodes:
                try:
                    inv_item_id = (((n or {}).get("inventoryItem") or {}).get("id") or "").split("/")[-1]
                    if inv_item_id:
                        _set_inventory_tracked(inv_item_id, True)
                        _set_inventory_level(location_id, inv_item_id, 2)
                except Exception:
                    continue
    except Exception:
        pass
    return prod


def create_product_and_page(payload: dict, angles: list, creatives: list, landing_copy: dict | None = None) -> dict:
    title = payload.get("title") or (angles and angles[0].get("titles", ["Offer"])[0]) or "Offer"
    ksp = (angles[0].get("ksp") if angles else [])[:3]
    # Prefer structured landing HTML if provided; otherwise derive a short feature list
    structured_html = (landing_copy or {}).get("html") if landing_copy else None
    desc_html = structured_html or ("<ul>" + "".join([f"<li>{p}</li>" for p in ksp]) + "</ul>" if ksp else "")

    # Collate image URLs requested for upload: prefer uploaded images from payload; otherwise fall back to creatives
    requested_images = (payload.get("uploaded_images") or []) or [c.get("image_url") for c in (creatives or []) if c.get("image_url")]

    # Do not set description at product creation time. Include variants/options/pricing if provided.
    product_in: dict = {
        "title": title,
        "status": "ACTIVE",
    }
    try:
        base_price = payload.get("base_price")
        sizes = [s for s in (payload.get("sizes") or []) if isinstance(s, str) and s.strip()]
        colors = [c for c in (payload.get("colors") or []) if isinstance(c, str) and c.strip()]
        option_names: list[str] = []
        if sizes:
            option_names.append("Size")
        if colors:
            option_names.append("Color")
        if option_names:
            product_in["options"] = option_names
            size_vals = sizes or ["Default"]
            color_vals = colors or ["Default"]
            combos: list[list[str]] = []
            if sizes and colors:
                for sv in size_vals:
                    for cv in color_vals:
                        combos.append([sv, cv])
            elif sizes:
                for sv in size_vals:
                    combos.append([sv])
            elif colors:
                for cv in color_vals:
                    combos.append([cv])
            variants: list[dict] = []
            for opts in combos:
                v: dict = {"options": opts}
                if base_price is not None:
                    v["price"] = str(base_price)
                variants.append(v)
            if variants:
                product_in["variants"] = variants
        else:
            if base_price is not None:
                product_in["variants"] = [{"price": str(base_price)}]
    except Exception:
        pass

    pdata = _gql(PRODUCT_CREATE, {"input": product_in})["productCreate"]["product"]
    # Attach images via REST after creation and capture Shopify CDN URLs
    shopify_image_urls: list[str] = []
    alt_texts: list[str] = []
    if requested_images:
        # Prepare alt texts from landing copy sections or description/title
        sections = (landing_copy or {}).get("sections") or []
        base_title = title
        base_desc = (payload.get("description") or "")
        for idx, _ in enumerate(requested_images):
            sec = sections[idx] if idx < len(sections) else {}
            sec_title = sec.get("title") or "Product image"
            sec_body = sec.get("body") or base_desc
            alt_texts.append(f"{base_title} — {sec_title}: {sec_body[:80]}")
        # Perform upload step and prefer returned Shopify CDN URLs
        shopify_image_urls = upload_images_to_product(pdata["id"], requested_images, alt_texts)

    # Build landing page body with sections matched to images (by index)
    sections = (landing_copy or {}).get("sections") or []
    headline = (landing_copy or {}).get("headline") or title
    subheadline = (landing_copy or {}).get("subheadline") or ""
    body_parts = [
        f"<section style=\"text-align:center;padding:16px 0;\"><h2 style=\"margin:0 0 8px;\">{headline}</h2>"
        + (f"<p style=\"margin:0;color:#555;\">{subheadline}</p>" if subheadline else "")
        + "</section>"
    ]
    if sections:
        for idx, sec in enumerate(sections):
            sec_title = sec.get("title") or ""
            sec_body = sec.get("body") or ""
            # Allow LLM to specify an image per section; else fall back by index
            specified_img = (sec.get("image_url") or "").strip()
            effective_images = shopify_image_urls or requested_images
            img_url = specified_img or (effective_images[idx % len(effective_images)] if effective_images else "")
            alt = alt_texts[idx % len(alt_texts)] if alt_texts else title
            img_tag = (
                f"<img src=\"{img_url}\" alt=\"{alt}\" style=\"width:100%;max-width:720px;display:block;margin:12px auto;border-radius:8px;\"/>"
                if img_url else ""
            )
            body_parts.append(
                "<section style=\"padding:16px 0;\">"
                + (f"<h3 style=\"margin:0 0 8px;\">{sec_title}</h3>" if sec_title else "")
                + (img_tag or "")
                + (f"<p style=\"margin:8px 0 0;line-height:1.5;color:#333;\">{sec_body}</p>" if sec_body else "")
                + "</section>"
            )
    else:
        # Fallback: description HTML followed by a simple gallery
        body_parts.append(desc_html)
        effective_images = shopify_image_urls or requested_images
        if effective_images:
            gallery = "".join([f"<img src=\"{u}\" alt=\"{title}\" style=\"width:100%;max-width:320px;margin:8px;border-radius:8px;\"/>" for u in effective_images])
            body_parts.append(f"<div style=\"display:flex;flex-wrap:wrap;justify-content:center;\">{gallery}</div>")

    page_body_html = "".join(body_parts)

    handle = f"offer-{pdata['id'].split('/')[-1]}"
    page_in = {
        "title": f"{title} – Offer",
        "handle": handle,
        "templateSuffix": "product_test",
        "isPublished": True,
        "body": page_body_html
    }

    page = _gql(PAGE_CREATE, {"page": page_in})["pageCreate"]["page"]
    page_url = f"https://{SHOP}/pages/{page['handle']}"

    # After landing page is generated, update product description HTML to match the provided/generated content
    try:
        final_desc = structured_html or page_body_html or ""
        if final_desc:
            update_product_description(pdata["id"], final_desc)
    except Exception:
        pass

    # Best-effort: enable tracking and set inventory to 2 for each variant
    try:
        location_id = _get_primary_location_id()
        if location_id:
            nodes = (((pdata or {}).get("variants") or {}).get("nodes") or [])
            for n in nodes:
                try:
                    inv_item_id = (((n or {}).get("inventoryItem") or {}).get("id") or "").split("/")[-1]
                    if inv_item_id:
                        _set_inventory_tracked(inv_item_id, True)
                        _set_inventory_level(location_id, inv_item_id, 2)
                except Exception:
                    continue
    except Exception:
        pass

    # Include Shopify CDN image URLs used/attached so the UI can display them later
    return {
        "product_gid": pdata["id"],
        "page_gid": page["id"],
        "url": page_url,
        "image_urls": shopify_image_urls or requested_images or [],
    }


def _build_page_body_html(title: str, landing_copy: dict | None, requested_images: list[str] | None, alt_texts: list[str] | None) -> str:
    # If a full HTML body is provided, use it verbatim for the page body
    html_override = (landing_copy or {}).get("html") if landing_copy else None
    if html_override:
        body = str(html_override)
        # Ensure at least some product images are visible: append a small gallery
        # using up to two provided image URLs (prefer Shopify CDN URLs when supplied).
        req = requested_images or []
        if req:
            selected = req[:2]
            alts = alt_texts or []
            imgs = []
            for idx, url in enumerate(selected):
                alt = (alts[idx] if (alts and idx < len(alts)) else title)
                imgs.append(
                    f"<img src=\"{url}\" alt=\"{alt}\" style=\"width:100%;max-width:320px;margin:8px;border-radius:8px;\"/>"
                )
            if imgs:
                body += "<div style=\"display:flex;flex-wrap:wrap;justify-content:center;\">" + "".join(imgs) + "</div>"
        return body
    sections = (landing_copy or {}).get("sections") or []
    headline = (landing_copy or {}).get("headline") or title
    subheadline = (landing_copy or {}).get("subheadline") or ""
    body_parts = [
        f"<section style=\"text-align:center;padding:16px 0;\"><h2 style=\"margin:0 0 8px;\">{headline}</h2>"
        + (f"<p style=\"margin:0;color:#555;\">{subheadline}</p>" if subheadline else "")
        + "</section>"
    ]
    if sections:
        for idx, sec in enumerate(sections):
            sec_title = sec.get("title") or ""
            sec_body = sec.get("body") or ""
            specified_img = (sec.get("image_url") or "").strip()
            effective_images = requested_images or []
            img_url = specified_img or (effective_images[idx % len(effective_images)] if effective_images else "")
            alt = (alt_texts[idx % len(alt_texts)] if alt_texts else title) if img_url else title
            img_tag = (
                f"<img src=\"{img_url}\" alt=\"{alt}\" style=\"width:100%;max-width:720px;display:block;margin:12px auto;border-radius:8px;\"/>"
                if img_url else ""
            )
            body_parts.append(
                "<section style=\"padding:16px 0;\">"
                + (f"<h3 style=\"margin:0 0 8px;\">{sec_title}</h3>" if sec_title else "")
                + (img_tag or "")
                + (f"<p style=\"margin:8px 0 0;line-height:1.5;color:#333;\">{sec_body}</p>" if sec_body else "")
                + "</section>"
            )
    else:
        desc_html = (landing_copy or {}).get("html") or ""
        body_parts.append(desc_html)
        effective_images = requested_images or []
        if effective_images:
            gallery = "".join([f"<img src=\"{u}\" alt=\"{title}\" style=\"width:100%;max-width:320px;margin:8px;border-radius:8px;\"/>" for u in effective_images])
            body_parts.append(f"<div style=\"display:flex;flex-wrap:wrap;justify-content:center;\">{gallery}</div>")
    return "".join(body_parts)


def create_page_from_copy(title: str, landing_copy: dict, image_urls: list[str] | None = None, alt_texts: list[str] | None = None) -> dict:
    body_html = _build_page_body_html(title, landing_copy, image_urls or [], alt_texts or [])
    # Generate a deterministic-ish base handle from title, and on collision retry with a short suffix
    handle = f"offer-{abs(hash(title)) % 10_000_000}"
    page_in = {
        "title": f"{title} – Offer",
        "handle": handle,
        "templateSuffix": "product_test",
        "isPublished": True,
        "body": body_html,
    }
    try:
        page = _gql(PAGE_CREATE, {"page": page_in})["pageCreate"]["page"]
    except RuntimeError as e:
        # Handle collision: 'Handle has already been taken' → append a short random suffix and retry once
        if "Handle has already been taken" in str(e):
            from uuid import uuid4
            page_in["handle"] = f"{handle}-{uuid4().hex[:6]}"
            page = _gql(PAGE_CREATE, {"page": page_in})["pageCreate"]["page"]
        else:
            raise
    page_url = f"https://{SHOP}/pages/{page['handle']}"
    return {"page_gid": page["id"], "url": page_url}


@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, max=8))
def update_product_description(product_gid: str, description_html: str) -> dict:
    inp = {
        "id": product_gid,
        "descriptionHtml": description_html or ""
    }
    data = _gql(PRODUCT_UPDATE, {"input": inp})
    prod = data["productUpdate"]["product"]
    return prod
