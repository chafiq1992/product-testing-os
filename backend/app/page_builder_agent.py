"""AI Page Builder Agent — generates Shopify OS 2.0 JSON page templates via OpenAI function-calling.

ARCHITECTURE (v3 — Rich Custom-Liquid Visual Sections):
  1. The AI model picks WHICH sections to include (section_types list).
  2. A dedicated server-side OpenAI call (_generate_section_content) extracts/generates
     custom headings, benefits, FAQ, testimonials, etc. from the user's original prompt.
  3. _build_sections_from_order() combines everything into full Shopify JSON.
  4. Visual sections use rich custom-liquid HTML with embedded CSS, animations,
     and responsive design via the page_builder_templates module.
  5. Only product/video/newsletter/collection stay as native Dawn sections.
"""

import json
import logging
import re
from typing import Any, Dict, List, Optional
from uuid import uuid4

from openai import OpenAI

_log = logging.getLogger("page_builder_agent")

# Use gpt-5.4-mini for page builder — fast structured JSON output
PAGE_BUILDER_MODEL = "gpt-5.4-mini"
from app.integrations.shopify_client import (
    create_page_template_json,
    update_page_template_json,
    read_page_template_json,
    create_page_with_template,
    _link_product_landing_page,
)
from app.page_builder_templates import (
    render_hero,
    render_features,
    render_benefits,
    render_testimonials,
    render_faq,
    render_cta,
    render_countdown,
    render_guarantee,
    render_comparison,
    render_why_us,
    render_promo_banner,
    render_image_text,
    render_description,
)


client = OpenAI()


# ==================== Server-Side Content Generation ====================

def _generate_section_content(
    user_prompt: str,
    section_types: List[str],
    product_handle: str = "",
    product_title: str = "",
    page_title: str = "",
) -> Dict[str, Any]:
    """Generate custom content for each section type based on the user's original prompt.

    This makes a focused OpenAI call that reads the user's prompt (which may contain
    detailed conversion strategy, copy instructions, target audience info, etc.) and
    produces structured JSON with headings, subheadings, and items for each section.

    Returns dict with keys: headings_by_type, subheadings_by_type, items_by_type
    """
    display_title = product_title or page_title or "Product"

    # Build the content generation prompt
    sections_list = ", ".join(section_types)
    content_prompt = f"""You are a high-converting e-commerce copywriter and CRO expert.

Based on the USER'S INSTRUCTIONS below, generate custom content for a Shopify landing page.

PRODUCT: {display_title}
PRODUCT HANDLE: {product_handle or 'N/A'}
SECTIONS TO FILL: {sections_list}

USER'S INSTRUCTIONS:
{user_prompt[:3000]}

Generate a JSON object with this EXACT structure:
{{
  "headings_by_type": {{
    "hero": "compelling hero headline",
    "benefits": "benefits section headline",
    "features": "features section headline",
    "testimonials": "testimonials headline",
    "faq": "FAQ headline",
    "cta": "call-to-action headline",
    "guarantee": "guarantee headline",
    "comparison": "comparison headline",
    "countdown": "urgency headline",
    "description": "description headline",
    "image_text": "image+text headline",
    "why_us": "why choose us headline",
    "promo_banner": "promotional banner headline"
  }},
  "subheadings_by_type": {{
    "hero": "compelling subtitle under the hero",
    "cta": "urgency-driven CTA subtitle",
    "guarantee": "trust-building guarantee description",
    "description": "detailed product description",
    "image_text": "side-by-side text content",
    "countdown": "urgency countdown subtitle",
    "promo_banner": "promotional offer subtitle"
  }},
  "items_by_type": {{
    "benefits": [
      {{"text": "benefit point 1"}},
      {{"text": "benefit point 2"}},
      {{"text": "benefit point 3"}},
      {{"text": "benefit point 4"}},
      {{"text": "benefit point 5"}}
    ],
    "features": [
      {{"title": "✨ Feature 1 Title", "text": "Feature 1 description"}},
      {{"title": "🛡️ Feature 2 Title", "text": "Feature 2 description"}},
      {{"title": "🚀 Feature 3 Title", "text": "Feature 3 description"}}
    ],
    "testimonials": [
      {{"title": "Amazing Quality!", "text": "\"Review quote\" — Customer Name"}},
      {{"title": "Best Purchase Ever", "text": "\"Review quote\" — Customer Name"}},
      {{"title": "Highly Recommend", "text": "\"Review quote\" — Customer Name"}}
    ],
    "faq": [
      {{"title": "Question 1?", "text": "Answer 1"}},
      {{"title": "Question 2?", "text": "Answer 2"}},
      {{"title": "Question 3?", "text": "Answer 3"}},
      {{"title": "Question 4?", "text": "Answer 4"}}
    ],
    "comparison": [
      {{"title": "Without {display_title}", "text": "❌ Problem 1\n❌ Problem 2\n❌ Problem 3"}},
      {{"title": "With {display_title}", "text": "✅ Solution 1\n✅ Solution 2\n✅ Solution 3"}}
    ],
    "why_us": [
      {{"title": "🚚 Fast Shipping", "text": "Express delivery to all cities"}},
      {{"title": "🔄 Free Exchanges", "text": "Easy size exchanges at no cost"}},
      {{"title": "💬 24/7 Support", "text": "Instant customer service"}},
      {{"title": "💵 Cash on Delivery", "text": "Pay when you receive"}},
      {{"title": "✅ Quality Guaranteed", "text": "100% premium quality"}}
    ]
  }}
}}

RULES:
- Only include keys for sections that are in the SECTIONS TO FILL list.
- Make content specific to the product and the user's instructions.
- Use emotional, benefit-driven, conversion-focused copy.
- DO NOT use generic/placeholder text. Make it compelling and specific.
- Write copy that makes parents/buyers WANT to purchase.
- Keep it warm, trustworthy, and modern e-commerce style.
- For testimonials: use realistic customer names, no star emojis in title.
- For features: use emoji + title format (e.g. "✨ Premium Quality").
- Return ONLY valid JSON, no markdown, no explanation."""

    try:
        resp = client.chat.completions.create(
            model=PAGE_BUILDER_MODEL,
            messages=[
                {"role": "system", "content": "You are a JSON generator. Output ONLY valid JSON. No markdown, no explanation."},
                {"role": "user", "content": content_prompt},
            ],
            temperature=0.7,
            timeout=25,
        )
        raw = (resp.choices[0].message.content or "").strip()
        # Strip markdown fences if present
        if raw.startswith("```"):
            raw = re.sub(r"^```(?:json)?\s*", "", raw)
            raw = re.sub(r"```\s*$", "", raw)
        content = json.loads(raw)
        _log.info(f"Content generation produced keys: {list(content.keys())}")
        return content
    except Exception as e:
        _log.warning(f"Content generation failed, using defaults: {e}")
        return {}


# ==================== System Prompt ====================

PAGE_BUILDER_SYSTEM = {
    "role": "system",
    "content": """You are the Shopify Page Builder Agent. Your ONLY job is to BUILD real Shopify pages by calling tools.

CRITICAL RULES:
1. You MUST ALWAYS call create_shopify_page on the FIRST turn. NEVER respond with text-only.
2. NEVER write strategies, copy, advice, or analysis — just BUILD THE PAGE immediately.
3. The backend generates rich, visually stunning sections with animations, modern CSS, and professional design automatically. You do NOT need to extract or generate copy.
4. For editing existing pages: use add_section_to_page, remove_section_from_page, or reorder_sections.

YOUR ONLY JOB ON NEW PAGES:
1. Pick the right section_types based on what the user wants.
2. ALWAYS include "product" in section_types when a product handle is provided.
3. Call create_shopify_page with section_types, product_handle, product_title.
4. Do NOT fill headings_by_type or items_by_type — the backend auto-generates them from the prompt.

AVAILABLE SECTION TYPES:
- "hero": Full-width gradient banner with animated heading, subheading, pulsing CTA button
- "product": Product showcase with images, price, VARIANTS, ADD-TO-CART (REQUIRED when product handle exists)
    Supports: variant swatches (button) or dropdowns, title size (h1/h2/h3), image gallery size (large/medium/small), image position (left/right)
    To customize: pass items_by_type.product = [{"picker_type": "button", "media_size": "large", "heading_size": "h2", "media_position": "left"}]
- "features": Animated card grid with emoji icons, hover effects, scroll-reveal
- "benefits": Animated benefit cards with checkmarks, slide-in scroll animation
- "testimonials": Styled review cards with avatars, star ratings, colored borders
- "faq": Animated accordion with expand/collapse transitions
- "cta": Gradient section with pulsing CTA button and urgency text
- "image_text": Image + text side-by-side layout
- "newsletter": Email signup section
- "video": Video embed (YouTube/Vimeo)
- "collection": Featured collection product grid
- "countdown": Dark gradient countdown timer with animated digits
- "guarantee": Trust shield card with badge row
- "comparison": Side-by-side red/green before-after columns
- "why_us": Icon cards grid with trust points (shipping, returns, support)
- "promo_banner": Gradient promotional announcement banner
- "description": Rich text description section
- "custom_html": Custom HTML/Liquid section

SECTION GUIDELINES:
- ALWAYS use 8-12 sections for high-converting pages.
- When product handle exists: MUST include "product" section for add-to-cart and variants.
- Recommended structure: promo_banner, hero, product, features, benefits, comparison, testimonials, guarantee, why_us, faq, countdown, cta

EXAMPLE — User says anything about creating a page with a product:
You call create_shopify_page with:
  section_types: ["hero", "product", "features", "benefits", "comparison", "testimonials", "guarantee", "why_us", "faq", "countdown", "cta"]
  product_handle: (from context)
  product_title: (from context)

That's it. The backend handles ALL the copy, styling, and animations. Just pick sections and call the tool.""",
}


# ==================== Section Template Builders ====================

def _html_heading(text: str) -> str:
    """Wrap plain text in <p> tags for Dawn inline_richtext heading settings.
    
    Dawn's heading blocks use inline_richtext type which requires HTML wrapper tags.
    If the text already starts with an HTML tag, it's returned as-is.
    """
    if text.startswith("<"):
        return text
    return f"<p>{text}</p>"


def _ensure_html(text: str) -> str:
    """Ensure text is wrapped in valid HTML block-level tags for Shopify richtext settings.
    
    Shopify Dawn theme requires all top-level nodes in richtext settings to be
    <p>, <ul>, <ol>, or <h1>-<h6> tags. Plain text causes schema validation errors.
    """
    if not text:
        return "<p></p>"
    text = text.strip()
    # Already has block-level HTML wrapping
    if text.startswith("<p>") or text.startswith("<ul>") or text.startswith("<ol>") or text.startswith("<h"):
        return text
    return f"<p>{text}</p>"


def _build_single_section(
    section_type: str,
    *,
    product_handle: str = "",
    product_title: str = "",
    page_title: str = "",
    color_scheme: str = "scheme-1",
    heading: str | None = None,
    subheading: str | None = None,
    items: list[dict] | None = None,
    faq_items: list[dict] | None = None,
    button_label: str | None = None,
    button_link: str | None = None,
    video_url: str | None = None,
    custom_liquid: str | None = None,
    collection_handle: str | None = None,
    position: str | None = None,
) -> dict | None:
    """Build a single section dict.

    Returns the section config dict, or None if the type is unknown.

    v3: Most visual sections use rich custom-liquid with embedded CSS/JS.
    Only product, video, newsletter, and collection stay as native Dawn sections.
    """
    display_title = product_title or page_title or "Shop Now"
    st = section_type

    # ── Accent color: default purple, could be customized per page later ──
    accent = "#6C27B0"
    accent_light = "#9C4DCC"

    # Helper: wrap rich HTML into a custom-liquid section
    def _custom_liquid_section(html: str) -> dict:
        return {
            "type": "custom-liquid",
            "settings": {
                "custom_liquid": html,
                "color_scheme": "",
            },
        }

    # ==================== RICH CUSTOM-LIQUID SECTIONS ====================

    if st == "hero":
        link = button_link or (f"/products/{product_handle}" if product_handle else "/collections/all")
        html = render_hero(
            heading=heading or "",
            subheading=subheading or "",
            button_label=button_label or "Shop Now",
            button_link=link,
            product_title=display_title,
            accent=accent,
            accent_light=accent_light,
            include_font=True,
        )
        return _custom_liquid_section(html)

    elif st == "features":
        html = render_features(
            heading=heading or "",
            items=items,
            accent=accent,
            accent_light=accent_light,
        )
        return _custom_liquid_section(html)

    elif st == "benefits":
        html = render_benefits(
            heading=heading or "",
            items=items,
            accent=accent,
            accent_light=accent_light,
        )
        return _custom_liquid_section(html)

    elif st == "testimonials":
        html = render_testimonials(
            heading=heading or "",
            items=items,
            accent=accent,
            accent_light=accent_light,
        )
        return _custom_liquid_section(html)

    elif st == "faq":
        # Normalize faq_items format
        faq_data = faq_items or items
        if faq_data and faq_data[0] and "title" in faq_data[0] and "heading" not in faq_data[0]:
            faq_data = [{"heading": f.get("title",""), "text": f.get("text","")} for f in faq_data]
        html = render_faq(
            heading=heading or "",
            items=faq_data,
            accent=accent,
            accent_light=accent_light,
        )
        return _custom_liquid_section(html)

    elif st == "cta":
        link = button_link or (f"/products/{product_handle}" if product_handle else "/collections/all")
        html = render_cta(
            heading=heading or "",
            subheading=subheading or "",
            button_label=button_label or "Order Now",
            button_link=link,
            product_handle=product_handle,
            accent=accent,
            accent_light=accent_light,
        )
        return _custom_liquid_section(html)

    elif st == "countdown":
        html = render_countdown(
            heading=heading or "",
            subheading=subheading or "",
            button_label=button_label or "Grab the Deal",
            button_link=button_link or "",
            product_handle=product_handle,
            product_title=display_title,
            accent=accent,
            accent_light=accent_light,
        )
        return _custom_liquid_section(html)

    elif st == "guarantee":
        html = render_guarantee(
            heading=heading or "",
            subheading=subheading or "",
            product_title=display_title,
            accent=accent,
            accent_light=accent_light,
        )
        return _custom_liquid_section(html)

    elif st == "comparison":
        html = render_comparison(
            heading=heading or "",
            items=items,
            product_title=display_title,
            accent=accent,
            accent_light=accent_light,
        )
        return _custom_liquid_section(html)

    elif st == "why_us":
        html = render_why_us(
            heading=heading or "",
            items=items,
            accent=accent,
            accent_light=accent_light,
        )
        return _custom_liquid_section(html)

    elif st == "promo_banner":
        html = render_promo_banner(
            heading=heading or "",
            subheading=subheading or "",
            accent=accent,
            accent_light=accent_light,
        )
        return _custom_liquid_section(html)

    elif st == "image_text":
        html = render_image_text(
            heading=heading or "",
            subheading=subheading or "",
            product_title=display_title,
            accent=accent,
            accent_light=accent_light,
        )
        return _custom_liquid_section(html)

    elif st == "description":
        html = render_description(
            heading=heading or "",
            subheading=subheading or "",
            product_title=display_title,
            accent=accent,
            accent_light=accent_light,
        )
        return _custom_liquid_section(html)

    # ==================== NATIVE DAWN SECTIONS ====================
    # These need Shopify platform features (add-to-cart, video player, etc.)

    elif st == "product":
        # Extract product-specific display options from items if provided
        product_opts = {}
        if items and isinstance(items, list) and len(items) > 0 and isinstance(items[0], dict):
            product_opts = items[0]

        # Variant picker type: "dropdown" or "button" (button = color/size swatches)
        picker_type = product_opts.get("picker_type", "button")
        # Media settings
        p_media_size = product_opts.get("media_size", "large")
        p_media_fit = product_opts.get("media_fit", "contain")
        p_media_position = product_opts.get("media_position", "left")
        # Heading size for title block
        p_heading_size = product_opts.get("heading_size", "h2")

        blocks = {}
        block_order = []

        # Title block with heading size
        blocks["product_title"] = {
            "type": "title",
            "settings": {"heading_size": p_heading_size},
        }
        block_order.append("product_title")

        # Price block
        blocks["product_price"] = {"type": "price", "settings": {}}
        block_order.append("product_price")

        # Variant picker (button = swatches for colors/sizes, dropdown = select menus)
        blocks["product_variant_picker"] = {
            "type": "variant_picker",
            "settings": {"picker_type": picker_type},
        }
        block_order.append("product_variant_picker")

        # Quantity selector
        blocks["product_quantity_selector"] = {"type": "quantity_selector", "settings": {}}
        block_order.append("product_quantity_selector")

        # Buy buttons with dynamic checkout
        blocks["product_buy_buttons"] = {
            "type": "buy_buttons",
            "settings": {"show_dynamic_checkout": True},
        }
        block_order.append("product_buy_buttons")

        return {
            "type": "featured-product",
            "settings": {
                "product": product_handle,
                "color_scheme": color_scheme,
                "media_size": p_media_size,
                "media_fit": p_media_fit,
                "media_position": p_media_position,
                "secondary_background": False,
            },
            "blocks": blocks,
            "block_order": block_order,
        }

    elif st == "newsletter":
        blocks = {
            "nl_heading": {"type": "heading", "settings": {"heading": _html_heading(heading or "Stay in the Loop")}},
            "nl_text": {"type": "paragraph", "settings": {"text": subheading or "<p>Subscribe for exclusive deals, new arrivals, and insider tips.</p>"}},
            "nl_form": {"type": "email_form", "settings": {}},
        }
        return {
            "type": "newsletter",
            "settings": {"color_scheme": color_scheme, "full_width": True},
            "blocks": blocks,
            "block_order": ["nl_heading", "nl_text", "nl_form"],
        }

    elif st == "video":
        return {
            "type": "video",
            "settings": {
                "heading": heading or "",
                "heading_size": "h2",
                "video_url": video_url or "https://www.youtube.com/watch?v=_9VUPq3SxOc",
                "full_width": False,
                "color_scheme": color_scheme,
            },
        }

    elif st == "collection":
        return {
            "type": "featured-collection",
            "settings": {
                "title": heading or "You May Also Like",
                "heading_size": "h2",
                "collection": collection_handle or "",
                "products_to_show": 4,
                "columns_desktop": 4,
                "color_scheme": color_scheme,
                "show_secondary_image": True,
                "show_vendor": False,
                "show_rating": True,
                "swipe_on_mobile": True,
                "enable_desktop_slider": True,
            },
        }

    elif st == "custom_html":
        return {
            "type": "custom-liquid",
            "settings": {
                "custom_liquid": custom_liquid or f"<div style='text-align:center;padding:40px 20px;'><h2>{heading or display_title}</h2><p>{subheading or ''}</p></div>",
                "color_scheme": color_scheme,
            },
        }

    else:
        return None


def _build_sections_from_order(
    section_types: List[str],
    product_handle: str = "",
    product_title: str = "",
    page_title: str = "",
    faq_items: List[Dict[str, str]] | None = None,
    feature_items: List[Dict[str, str]] | None = None,
    testimonial_items: List[Dict[str, str]] | None = None,
    items_by_type: Dict[str, list] | None = None,
    headings_by_type: Dict[str, str] | None = None,
    subheadings_by_type: Dict[str, str] | None = None,
) -> tuple[Dict[str, Any], List[str]]:
    """Build full sections JSON + order array from a list of section type names.

    This runs SERVER-SIDE so the LLM doesn't need to generate huge JSON.
    Returns (sections_dict, order_list).
    """
    sections: Dict[str, Any] = {}
    order: List[str] = []
    color_schemes = ["scheme-1", "scheme-2", "scheme-3", "scheme-4"]
    items_map = items_by_type or {}
    headings_map = headings_by_type or {}
    subheadings_map = subheadings_by_type or {}

    for i, st in enumerate(section_types):
        cs = color_schemes[i % len(color_schemes)]
        sid = st  # section ID = section type name

        # Determine items for this section type
        section_items = items_map.get(st) or None
        if st == "features" and not section_items:
            section_items = feature_items
        elif st == "testimonials" and not section_items:
            section_items = testimonial_items
        # FAQ items can come from items_by_type or direct faq_items
        section_faq = None
        if st == "faq":
            section_faq = items_map.get("faq") or faq_items
            # Convert items format to faq format if needed
            if section_faq and section_faq[0] and "title" in section_faq[0] and "heading" not in section_faq[0]:
                section_faq = [{"heading": f.get("title",""), "row_content": _ensure_html(f.get("text",""))} for f in section_faq]

        section = _build_single_section(
            st,
            product_handle=product_handle,
            product_title=product_title,
            page_title=page_title,
            color_scheme=cs,
            heading=headings_map.get(st),
            subheading=subheadings_map.get(st),
            items=section_items,
            faq_items=section_faq,
        )

        if section is None:
            continue

        sections[sid] = section
        order.append(sid)

    return sections, order


# ==================== Tool Definitions ====================

PAGE_BUILDER_TOOLS: List[dict] = [
    {
        "type": "function",
        "function": {
            "name": "create_shopify_page",
            "description": "Create a new Shopify landing page with the given sections and custom content. ALWAYS call this — never respond with text only.",
            "parameters": {
                "type": "object",
                "properties": {
                    "page_title": {"type": "string", "description": "Title of the page"},
                    "slug": {"type": "string", "description": "URL-friendly slug. Lowercase, hyphens only."},
                    "section_types": {
                        "type": "array",
                        "items": {"type": "string", "enum": [
                            "hero", "product", "features", "benefits", "testimonials",
                            "faq", "cta", "image_text", "newsletter", "video",
                            "collection", "countdown", "guarantee", "comparison",
                            "why_us", "promo_banner", "custom_html", "description",
                        ]},
                        "description": "List of section types to include, in display order. Use 8-12 for high-converting pages.",
                    },
                    "product_handle": {"type": "string", "description": "Shopify product handle for featured-product section"},
                    "product_title": {"type": "string", "description": "Product title for display in headings"},
                    "product_gid": {"type": "string", "description": "Product GID for metafield linking"},
                    "headings_by_type": {
                        "type": "object",
                        "description": "Custom heading per section type, e.g. {\"hero\": \"Dress Your Little One\", \"benefits\": \"Why Parents Love It\"}",
                        "additionalProperties": {"type": "string"},
                    },
                    "subheadings_by_type": {
                        "type": "object",
                        "description": "Custom subheading/subtitle per section type.",
                        "additionalProperties": {"type": "string"},
                    },
                    "items_by_type": {
                        "type": "object",
                        "description": "Custom items per section. Keys: section type. Values: array of {title, text} objects. For FAQ: {title, text} where title=question, text=answer.",
                        "additionalProperties": {
                            "type": "array",
                            "items": {"type": "object", "properties": {"title": {"type": "string"}, "text": {"type": "string"}}},
                        },
                    },
                },
                "required": ["page_title", "slug", "section_types"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "add_section_to_page",
            "description": "Add a new section to an existing page. The backend builds the section JSON — you just pick the type and provide optional content.",
            "parameters": {
                "type": "object",
                "properties": {
                    "slug": {"type": "string", "description": "The template slug of the existing page"},
                    "section_type": {
                        "type": "string",
                        "enum": [
                            "hero", "product", "features", "benefits", "testimonials",
                            "faq", "cta", "image_text", "newsletter", "video",
                            "collection", "countdown", "guarantee", "comparison",
                            "why_us", "promo_banner", "custom_html", "description",
                        ],
                        "description": "Type of section to add",
                    },
                    "heading": {"type": "string", "description": "Optional custom heading for the section"},
                    "subheading": {"type": "string", "description": "Optional custom subheading/body text"},
                    "items": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "title": {"type": "string"},
                                "text": {"type": "string"},
                            },
                        },
                        "description": "Optional items for features/benefits/testimonials/comparison sections",
                    },
                    "faq_items": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "heading": {"type": "string"},
                                "row_content": {"type": "string"},
                            },
                        },
                        "description": "Optional FAQ items (for faq section)",
                    },
                    "button_label": {"type": "string", "description": "Optional CTA button label"},
                    "button_link": {"type": "string", "description": "Optional CTA button link"},
                    "video_url": {"type": "string", "description": "YouTube/Vimeo URL (for video section)"},
                    "custom_liquid": {"type": "string", "description": "Custom HTML/Liquid code (for custom_html section)"},
                    "position": {
                        "type": "string",
                        "enum": ["start", "end", "after_product", "before_cta"],
                        "description": "Where to insert the section. Default: end.",
                    },
                    "product_handle": {"type": "string", "description": "Product handle for product-linked sections"},
                    "product_title": {"type": "string", "description": "Product title for display text"},
                },
                "required": ["slug", "section_type"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "remove_section_from_page",
            "description": "Remove a section from an existing page by section ID.",
            "parameters": {
                "type": "object",
                "properties": {
                    "slug": {"type": "string", "description": "The template slug"},
                    "section_id": {"type": "string", "description": "The section ID to remove (e.g. 'faq', 'testimonials', 'benefits')"},
                },
                "required": ["slug", "section_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "reorder_sections",
            "description": "Reorder sections on an existing page.",
            "parameters": {
                "type": "object",
                "properties": {
                    "slug": {"type": "string", "description": "The template slug"},
                    "order": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "New order of section IDs",
                    },
                },
                "required": ["slug", "order"],
            },
        },
    },
]


# ==================== Tool Dispatch ====================

def _dispatch_page_builder_tool(
    name: str,
    args: Dict[str, Any],
    *,
    store: str | None = None,
    user_prompt: str = "",
) -> Dict[str, Any]:
    """Execute a page builder tool call."""
    try:
        if name == "create_shopify_page":
            slug = args.get("slug", "")
            page_title = args.get("page_title", "AI Page")
            product_handle = args.get("product_handle", "")
            product_title = args.get("product_title", "")
            product_gid = args.get("product_gid")
            section_types = args.get("section_types", ["hero", "product", "features", "faq", "cta"])

            # ── Force product section when handle is provided ──
            if product_handle and "product" not in section_types:
                # Insert after hero if present, otherwise at position 1
                if "hero" in section_types:
                    idx = section_types.index("hero") + 1
                else:
                    idx = min(1, len(section_types))
                section_types.insert(idx, "product")
                _log.info(f"Forced 'product' section at index {idx} for handle={product_handle}")

            # ── Ensure minimum section count for quality pages ──
            if len(section_types) < 6:
                _log.info(f"Section types too few ({len(section_types)}), expanding")
                extras = ["hero", "product", "features", "benefits", "testimonials",
                          "guarantee", "faq", "countdown", "cta"]
                for ext in extras:
                    if ext not in section_types:
                        section_types.append(ext)
                    if len(section_types) >= 8:
                        break

            # ── Server-side content generation from user prompt ──
            headings_by_type = args.get("headings_by_type") or {}
            subheadings_by_type = args.get("subheadings_by_type") or {}
            items_by_type = args.get("items_by_type") or {}

            # If the AI didn't provide custom content (which it usually won't in v2),
            # generate it server-side from the user's original prompt
            if user_prompt and not headings_by_type and not items_by_type:
                _log.info("Generating section content from user prompt...")
                generated = _generate_section_content(
                    user_prompt,
                    section_types,
                    product_handle=product_handle,
                    product_title=product_title,
                    page_title=page_title,
                )
                headings_by_type = generated.get("headings_by_type") or {}
                subheadings_by_type = generated.get("subheadings_by_type") or {}
                items_by_type = generated.get("items_by_type") or {}
                _log.info(f"Generated headings for: {list(headings_by_type.keys())}")
                _log.info(f"Generated items for: {list(items_by_type.keys())}")

            # Build sections server-side from the section types list + custom content
            sections, order = _build_sections_from_order(
                section_types,
                product_handle=product_handle,
                product_title=product_title,
                page_title=page_title,
                headings_by_type=headings_by_type,
                subheadings_by_type=subheadings_by_type,
                items_by_type=items_by_type,
            )

            # Write template to theme
            tmpl = create_page_template_json(
                slug, sections, order,
                store=store,
            )

            # Create the page using the template
            page = create_page_with_template(
                page_title,
                tmpl["template_suffix"],
                store=store,
            )

            # Link to product if provided
            if product_gid and page.get("page_gid"):
                try:
                    _link_product_landing_page(product_gid, page["page_gid"], store=store)
                except Exception:
                    pass

            return {
                "page_url": page.get("page_url"),
                "page_gid": page.get("page_gid"),
                "page_handle": page.get("page_handle"),
                "template_suffix": tmpl.get("template_suffix"),
                "slug": slug,
                "sections_created": list(order),
            }

        elif name == "add_section_to_page":
            slug = args.get("slug", "")
            section_type = args.get("section_type", "")
            product_handle = args.get("product_handle", "")
            product_title = args.get("product_title", "")
            position = args.get("position", "end")

            if not slug:
                return {"error": "slug is required"}
            if not section_type:
                return {"error": "section_type is required"}

            # Read current template
            current = read_page_template_json(slug, store=store)
            if not current:
                return {"error": f"Template not found for slug: {slug}"}

            existing_sections = current.get("sections", {})
            existing_order = current.get("order", [])
            current_layout = current.get("layout")

            # Determine color scheme (rotate based on existing count)
            color_schemes = ["scheme-1", "scheme-2", "scheme-3", "scheme-4"]
            cs = color_schemes[len(existing_order) % len(color_schemes)]

            # Build the new section
            new_section = _build_single_section(
                section_type,
                product_handle=product_handle,
                product_title=product_title,
                color_scheme=cs,
                heading=args.get("heading"),
                subheading=args.get("subheading"),
                items=args.get("items"),
                faq_items=args.get("faq_items"),
                button_label=args.get("button_label"),
                button_link=args.get("button_link"),
                video_url=args.get("video_url"),
                custom_liquid=args.get("custom_liquid"),
                position=position,
            )

            if new_section is None:
                return {"error": f"Unknown section type: {section_type}"}

            # Generate unique section ID
            section_id = section_type
            if section_id in existing_sections:
                section_id = f"{section_type}_{uuid4().hex[:6]}"

            # Add section to dict
            existing_sections[section_id] = new_section

            # Determine insertion position
            if position == "start":
                existing_order.insert(0, section_id)
            elif position == "after_product":
                # Find 'product' in order and insert after it
                idx = None
                for i, sid in enumerate(existing_order):
                    if sid == "product" or existing_sections.get(sid, {}).get("type") == "featured-product":
                        idx = i + 1
                        break
                if idx is not None:
                    existing_order.insert(idx, section_id)
                else:
                    existing_order.append(section_id)
            elif position == "before_cta":
                # Find 'cta' in order and insert before it
                idx = None
                for i, sid in enumerate(existing_order):
                    if sid == "cta" or (existing_sections.get(sid, {}).get("type") == "rich-text" and "cta" in sid):
                        idx = i
                        break
                if idx is not None:
                    existing_order.insert(idx, section_id)
                else:
                    existing_order.append(section_id)
            else:
                existing_order.append(section_id)

            # Write updated template
            tmpl = update_page_template_json(
                slug, existing_sections, existing_order,
                layout=current_layout,
                store=store,
            )

            return {
                "status": "section_added",
                "section_id": section_id,
                "section_type": section_type,
                "template_suffix": tmpl.get("template_suffix"),
                "slug": slug,
                "total_sections": len(existing_order),
                "order": existing_order,
            }

        elif name == "remove_section_from_page":
            slug = args.get("slug", "")
            section_id = args.get("section_id", "")

            if not slug or not section_id:
                return {"error": "slug and section_id are required"}

            current = read_page_template_json(slug, store=store)
            if not current:
                return {"error": f"Template not found for slug: {slug}"}

            existing_sections = current.get("sections", {})
            existing_order = current.get("order", [])
            current_layout = current.get("layout")

            if section_id not in existing_sections:
                return {"error": f"Section '{section_id}' not found. Available: {list(existing_sections.keys())}"}

            del existing_sections[section_id]
            existing_order = [s for s in existing_order if s != section_id]

            tmpl = update_page_template_json(
                slug, existing_sections, existing_order,
                layout=current_layout,
                store=store,
            )

            return {
                "status": "section_removed",
                "removed_section_id": section_id,
                "slug": slug,
                "remaining_sections": existing_order,
            }

        elif name == "reorder_sections":
            slug = args.get("slug", "")
            new_order = args.get("order", [])

            if not slug or not new_order:
                return {"error": "slug and order are required"}

            current = read_page_template_json(slug, store=store)
            if not current:
                return {"error": f"Template not found for slug: {slug}"}

            existing_sections = current.get("sections", {})
            current_layout = current.get("layout")

            # Validate all IDs exist
            invalid = [sid for sid in new_order if sid not in existing_sections]
            if invalid:
                return {"error": f"Unknown section IDs: {invalid}. Available: {list(existing_sections.keys())}"}

            tmpl = update_page_template_json(
                slug, existing_sections, new_order,
                layout=current_layout,
                store=store,
            )

            return {
                "status": "reordered",
                "slug": slug,
                "order": new_order,
            }

        return {"error": f"Unknown tool: {name}"}

    except Exception as e:
        return {"error": str(e)}


# ==================== Agent Loop ====================

def run_page_builder_agent(
    messages: List[Dict[str, Any]],
    *,
    model: Optional[str] = None,
    store: str | None = None,
    max_iters: int = 5,
    user_prompt: str = "",
) -> Dict[str, Any]:
    """Run the page builder agent loop with tool-calling.

    Optimized flow (v2):
      1. AI picks section_types → calls create_shopify_page
      2. Backend generates content from user_prompt via _generate_section_content()
      3. Backend builds full JSON and creates page → returns immediately.

    For edits: AI uses add/remove/reorder tools — all server-side.
    max_iters=5 is enough: 1 for create, 1-2 for edits, with retries. Content generation is server-side.
    """
    if not isinstance(messages, list):
        raise ValueError("messages must be a list")

    # Ensure system prompt is first
    if not messages or messages[0].get("role") != "system":
        messages = [PAGE_BUILDER_SYSTEM] + list(messages)

    working: List[Dict[str, Any]] = list(messages)
    page_url: str | None = None
    slug: str | None = None
    template_suffix: str | None = None
    last_result: Dict[str, Any] | None = None

    # Extract the original user prompt for content generation
    # (either passed explicitly or extracted from messages)
    original_prompt = user_prompt
    if not original_prompt:
        for m in reversed(messages):
            if m.get("role") == "user":
                original_prompt = m.get("content", "")
                # Strip the product info lines that we append
                lines = original_prompt.split("\n")
                prompt_lines = []
                for line in lines:
                    if line.startswith("Product handle:") or line.startswith("Product title:") or line.startswith("Product GID:") or line.startswith("Hide header"):
                        continue
                    prompt_lines.append(line)
                original_prompt = "\n".join(prompt_lines).strip()
                break

    _log.info(f"Agent loop starting with {len(messages)} messages, max_iters={max_iters}, prompt_len={len(original_prompt)}")

    # --- Simplify user message for the tool-calling model ---
    # The full detailed prompt goes to _generate_section_content(), but the tool-calling
    # model only needs a short instruction like "create a landing page for X".
    # Long prompts with strategies/copy guidance confuse the tool-calling model.
    for i, m in enumerate(working):
        if m.get("role") == "user" and len(m.get("content", "")) > 500:
            content = m["content"]
            # Preserve product handle/title/GID lines
            preserved_lines = []
            simplified = ""
            for line in content.split("\n"):
                if line.startswith("Product handle:") or line.startswith("Product title:") or line.startswith("Product GID:") or line.startswith("Hide header"):
                    preserved_lines.append(line)
                elif not simplified:
                    # Keep the first meaningful line as the instruction
                    stripped = line.strip()
                    if stripped and not stripped.startswith("WHAT") and not stripped.startswith("---"):
                        simplified = stripped[:200]
            if not simplified:
                simplified = "Create a complete high-converting Shopify landing page"
            short_msg = simplified + "\n\n" + "\n".join(preserved_lines)
            working[i] = {**m, "content": short_msg.strip()}
            _log.info(f"Simplified user message from {len(content)} to {len(short_msg)} chars for tool calling")

    for iteration in range(max_iters):
        _log.info(f"Agent iteration {iteration + 1}/{max_iters}")
        # Force tool call on EVERY iteration — agent must always use tools
        try:
            resp = client.chat.completions.create(
                model=(model or PAGE_BUILDER_MODEL),
                messages=working,
                tools=PAGE_BUILDER_TOOLS,
                tool_choice="required",
                timeout=30,
            )
        except Exception as e:
            _log.error(f"OpenAI call failed on iteration {iteration + 1}: {e}")
            return {"error": f"AI model error: {e}", "messages": working}

        choice = resp.choices[0]
        msg = choice.message

        tool_calls = getattr(msg, "tool_calls", None) or []
        if not tool_calls:
            # No tool calls — final response (shouldn't happen with tool_choice=required)
            final_text = msg.content or ""
            _log.info(f"No tool calls on iteration {iteration + 1}, returning text")
            return {
                "text": final_text,
                "messages": working,
                "page_url": page_url,
                "slug": slug,
                "template_suffix": template_suffix,
            }

        working.append({
            "role": "assistant",
            "content": msg.content or "",
            "tool_calls": [tc.model_dump() for tc in tool_calls],
        })

        for tc in tool_calls:
            fn_name = tc.function.name
            try:
                args = json.loads(tc.function.arguments or "{}")
            except Exception:
                args = {}

            _log.info(f"Tool call: {fn_name}, args keys: {list(args.keys())}")

            # Extract product info from conversation if not in args
            if fn_name in ("create_shopify_page", "add_section_to_page"):
                for m in messages:
                    content = m.get("content", "")
                    if isinstance(content, str):
                        if not args.get("product_handle"):
                            match = re.search(r"Product handle:\s*(.+)", content)
                            if match:
                                args["product_handle"] = match.group(1).strip()
                        if not args.get("product_title"):
                            match = re.search(r"Product title:\s*(.+)", content)
                            if match:
                                args["product_title"] = match.group(1).strip()
                        if not args.get("product_gid") and fn_name == "create_shopify_page":
                            match = re.search(r"Product GID:\s*(gid://shopify/Product/\d+)", content)
                            if match:
                                args["product_gid"] = match.group(1).strip()

                # For add_section_to_page, inject slug from conversation state
                if fn_name == "add_section_to_page" and not args.get("slug") and slug:
                    args["slug"] = slug

            result = _dispatch_page_builder_tool(
                fn_name, args,
                store=store,
                user_prompt=original_prompt,
            )
            last_result = result

            # Capture page URL if created
            if result.get("page_url"):
                page_url = result["page_url"]
            if result.get("slug"):
                slug = result["slug"]
            if result.get("template_suffix"):
                template_suffix = result["template_suffix"]

            working.append({
                "role": "tool",
                "tool_call_id": tc.id,
                "name": fn_name,
                "content": json.dumps(result, ensure_ascii=False),
            })

            # ── FAST RETURN: After any successful operation, return immediately ──
            if not result.get("error"):
                if fn_name == "create_shopify_page" and page_url:
                    sections_list = ", ".join(result.get("sections_created", []))
                    _log.info(f"Page created successfully: {page_url}")
                    return {
                        "text": f"✅ Page created with {len(result.get('sections_created', []))} sections: {sections_list}\n\nView it here: {page_url}",
                        "messages": working,
                        "page_url": page_url,
                        "slug": slug,
                        "template_suffix": template_suffix,
                    }

                if fn_name in ("add_section_to_page", "remove_section_from_page", "reorder_sections"):
                    action_text = {
                        "add_section_to_page": f"✅ Section '{result.get('section_type', '')}' added successfully!",
                        "remove_section_from_page": f"✅ Section '{result.get('removed_section_id', '')}' removed!",
                        "reorder_sections": "✅ Sections reordered successfully!",
                    }.get(fn_name, "✅ Done!")

                    _log.info(f"Edit successful: {action_text}")
                    return {
                        "text": action_text,
                        "messages": working,
                        "page_url": page_url,
                        "slug": slug,
                        "template_suffix": template_suffix,
                    }

        # If we get here, tool call had an error — let the loop retry
        _log.warning(f"Tool call had error, retrying. Error: {last_result.get('error') if last_result else 'unknown'}")

    _log.error(f"max_iters ({max_iters}) exceeded")
    # Instead of returning an error, return whatever we have
    return {
        "text": page_url and f"✅ Page available at: {page_url}" or "⚠️ Page generation took too long. Please try with a simpler prompt.",
        "messages": working,
        "page_url": page_url,
        "slug": slug,
        "template_suffix": template_suffix,
        "error": None if page_url else "max_iters_exceeded",
    }
