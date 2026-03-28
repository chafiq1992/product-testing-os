"""AI Page Builder Agent — generates Shopify OS 2.0 JSON page templates via OpenAI function-calling.

The agent uses Dawn theme sections (image-banner, rich-text, featured-product, etc.)
to compose landing pages and product pages that appear natively in the Shopify Theme Editor.

ARCHITECTURE: The AI model decides WHICH sections to include and provides content/metadata.
The backend _build_sections_from_order() generates the full sections JSON server-side,
since LLMs struggle to produce large nested JSON in tool call arguments reliably.
"""

import json
import re
from typing import Any, Dict, List, Optional

from openai import OpenAI

# Use gpt-5.4-mini for page builder — fast structured JSON output
PAGE_BUILDER_MODEL = "gpt-5.4-mini"
from app.integrations.shopify_client import (
    create_page_template_json,
    update_page_template_json,
    read_page_template_json,
    create_page_with_template,
    _link_product_landing_page,
)


client = OpenAI()


# ==================== System Prompt ====================

PAGE_BUILDER_SYSTEM = {
    "role": "system",
    "content": """You are the Shopify Page Builder Agent. You create beautiful landing pages for products.

WORKFLOW: Call create_shopify_page with page_title, slug, section_types, and product details.
The backend will generate the full template JSON — you just pick which sections to include.

AVAILABLE SECTION TYPES (pass these in section_types array):
- "hero": Full-width hero banner with product title
- "product": Featured product with images, price, add-to-cart
- "features": 3-column benefits grid
- "testimonials": Customer review quotes
- "faq": Frequently asked questions accordion
- "cta": Call-to-action section
- "image_text": Image + text side-by-side
- "newsletter": Email signup section

RULES:
- Always include "hero" and "product" sections.
- Use 5-7 sections for a rich page.
- Call create_shopify_page immediately with your chosen sections.

OUTPUT: After the page is created, briefly confirm with the page URL.""",
}


# ==================== Section Template Builders ====================

def _build_sections_from_order(
    section_types: List[str],
    product_handle: str = "",
    product_title: str = "",
    page_title: str = "",
    faq_items: List[Dict[str, str]] | None = None,
    feature_items: List[Dict[str, str]] | None = None,
    testimonial_items: List[Dict[str, str]] | None = None,
) -> tuple[Dict[str, Any], List[str]]:
    """Build full sections JSON + order array from a list of section type names.

    This runs SERVER-SIDE so the LLM doesn't need to generate huge JSON.
    Returns (sections_dict, order_list).
    """
    sections: Dict[str, Any] = {}
    order: List[str] = []
    display_title = product_title or page_title or "Shop Now"
    color_schemes = ["scheme-1", "scheme-2", "scheme-3", "scheme-4"]

    for i, st in enumerate(section_types):
        cs = color_schemes[i % len(color_schemes)]
        sid = st  # section ID = section type name

        if st == "hero":
            sections[sid] = {
                "type": "image-banner",
                "settings": {
                    "heading": display_title,
                    "heading_size": "h0",
                    "subheading": f"Discover the perfect {display_title.lower()}",
                    "button_label": "Shop Now",
                    "button_link": f"/products/{product_handle}" if product_handle else "/collections/all",
                    "color_scheme": cs,
                    "desktop_content_position": "middle-center",
                    "desktop_content_alignment": "center",
                    "image_overlay_opacity": 40,
                },
            }

        elif st == "product":
            blocks = {}
            block_order = []
            for btype in ["title", "price", "variant_picker", "buy_buttons"]:
                bid = f"product_{btype}"
                blocks[bid] = {"type": btype, "settings": {}}
                block_order.append(bid)

            sections[sid] = {
                "type": "featured-product",
                "settings": {
                    "product": product_handle,
                    "color_scheme": cs,
                    "media_size": "large",
                    "media_fit": "contain",
                },
                "blocks": blocks,
                "block_order": block_order,
            }

        elif st == "features":
            items = feature_items or [
                {"title": "Premium Quality", "text": "<p>Crafted with the finest materials for lasting durability.</p>"},
                {"title": "Fast Shipping", "text": "<p>Free express delivery on all orders. Get it in 2-3 days.</p>"},
                {"title": "Easy Returns", "text": "<p>30-day hassle-free return policy. Shop with confidence.</p>"},
            ]
            blocks = {}
            block_order = []
            for j, item in enumerate(items):
                bid = f"feature_{j}"
                blocks[bid] = {
                    "type": "column",
                    "settings": {"title": item["title"], "text": item["text"]},
                }
                block_order.append(bid)

            sections[sid] = {
                "type": "multicolumn",
                "settings": {
                    "title": "Why Choose Us",
                    "columns_desktop": 3,
                    "color_scheme": cs,
                },
                "blocks": blocks,
                "block_order": block_order,
            }

        elif st == "testimonials":
            items = testimonial_items or [
                {"title": "⭐⭐⭐⭐⭐ Amazing Quality!", "text": "<p>\"Absolutely love this product! Exceeded all my expectations.\" — Sarah M.</p>"},
                {"title": "⭐⭐⭐⭐⭐ Best Purchase Ever", "text": "<p>\"Fast shipping and incredible quality. Will buy again!\" — James R.</p>"},
                {"title": "⭐⭐⭐⭐⭐ Highly Recommend", "text": "<p>\"Perfect in every way. My friends are all ordering one too!\" — Emily K.</p>"},
            ]
            blocks = {}
            block_order = []
            for j, item in enumerate(items):
                bid = f"testimonial_{j}"
                blocks[bid] = {
                    "type": "column",
                    "settings": {"title": item["title"], "text": item["text"]},
                }
                block_order.append(bid)

            sections[sid] = {
                "type": "multicolumn",
                "settings": {
                    "title": "What Our Customers Say",
                    "columns_desktop": 3,
                    "color_scheme": cs,
                },
                "blocks": blocks,
                "block_order": block_order,
            }

        elif st == "faq":
            items = faq_items or [
                {"heading": "What materials is this made from?", "row_content": f"<p>The {display_title} is crafted from premium, high-quality materials designed for lasting durability and everyday use.</p>"},
                {"heading": "How long does shipping take?", "row_content": "<p>We offer free express shipping on all orders. Most orders arrive within 2-3 business days.</p>"},
                {"heading": "What is your return policy?", "row_content": "<p>We offer a 30-day hassle-free return policy. If you're not completely satisfied, simply return the product for a full refund.</p>"},
                {"heading": "Is this product suitable as a gift?", "row_content": f"<p>Absolutely! The {display_title} makes a perfect gift. We also offer gift wrapping options at checkout.</p>"},
            ]
            blocks = {}
            block_order = []
            for j, item in enumerate(items):
                bid = f"faq_{j}"
                blocks[bid] = {
                    "type": "collapsible_row",
                    "settings": {"heading": item["heading"], "row_content": item["row_content"]},
                }
                block_order.append(bid)

            sections[sid] = {
                "type": "collapsible-content",
                "settings": {
                    "heading": "Frequently Asked Questions",
                    "heading_size": "h1",
                    "color_scheme": cs,
                    "open_first_collapsible_row": True,
                },
                "blocks": blocks,
                "block_order": block_order,
            }

        elif st == "cta":
            blocks = {
                "cta_heading": {
                    "type": "heading",
                    "settings": {"heading": f"Ready to Get Your {display_title}?"},
                },
                "cta_text": {
                    "type": "text",
                    "settings": {"text": "<p>Order now and experience the difference. Limited stock available!</p>"},
                },
                "cta_button": {
                    "type": "button",
                    "settings": {
                        "button_label": "Order Now",
                        "button_link": f"/products/{product_handle}" if product_handle else "/collections/all",
                    },
                },
            }
            sections[sid] = {
                "type": "rich-text",
                "settings": {"color_scheme": cs, "full_width": True},
                "blocks": blocks,
                "block_order": ["cta_heading", "cta_text", "cta_button"],
            }

        elif st == "image_text":
            blocks = {
                "it_heading": {
                    "type": "heading",
                    "settings": {"heading": f"Why {display_title}?"},
                },
                "it_text": {
                    "type": "text",
                    "settings": {"text": f"<p>Experience premium quality and thoughtful design. The {display_title} combines style with functionality for the perfect everyday companion.</p>"},
                },
                "it_button": {
                    "type": "button",
                    "settings": {
                        "button_label": "Learn More",
                        "button_link": f"/products/{product_handle}" if product_handle else "/collections/all",
                    },
                },
            }
            sections[sid] = {
                "type": "image-with-text",
                "settings": {
                    "height": "adapt",
                    "layout": "image_first",
                    "color_scheme": cs,
                },
                "blocks": blocks,
                "block_order": ["it_heading", "it_text", "it_button"],
            }

        elif st == "newsletter":
            blocks = {
                "nl_heading": {"type": "heading", "settings": {"heading": "Stay in the Loop"}},
                "nl_text": {"type": "text", "settings": {"text": "<p>Subscribe for exclusive deals, new arrivals, and insider tips.</p>"}},
                "nl_form": {"type": "email_form", "settings": {}},
            }
            sections[sid] = {
                "type": "newsletter",
                "settings": {"color_scheme": cs},
                "blocks": blocks,
                "block_order": ["nl_heading", "nl_text", "nl_form"],
            }

        else:
            # Unknown section type — skip
            continue

        order.append(sid)

    return sections, order


# ==================== Tool Definitions ====================

PAGE_BUILDER_TOOLS: List[dict] = [
    {
        "type": "function",
        "function": {
            "name": "create_shopify_page",
            "description": "Create a new Shopify landing page. Provide the section types you want and the backend auto-generates the full template. Call this directly.",
            "parameters": {
                "type": "object",
                "properties": {
                    "page_title": {"type": "string", "description": "Title of the page"},
                    "slug": {"type": "string", "description": "URL-friendly slug. Lowercase, hyphens only."},
                    "section_types": {
                        "type": "array",
                        "items": {"type": "string", "enum": ["hero", "product", "features", "testimonials", "faq", "cta", "image_text", "newsletter"]},
                        "description": "List of section types to include, in display order.",
                    },
                    "product_handle": {"type": "string", "description": "Shopify product handle for featured-product section"},
                    "product_title": {"type": "string", "description": "Product title for display in headings"},
                    "product_gid": {"type": "string", "description": "Product GID for metafield linking"},
                },
                "required": ["page_title", "slug", "section_types"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "update_shopify_page",
            "description": "Update an existing page template with modified sections.",
            "parameters": {
                "type": "object",
                "properties": {
                    "slug": {"type": "string", "description": "The template slug to update"},
                    "sections": {"type": "object", "description": "Updated sections dict"},
                    "order": {"type": "array", "items": {"type": "string"}, "description": "Updated order array"},
                    "layout": {"type": "string", "description": "Optional layout override"},
                },
                "required": ["slug", "sections", "order"],
            },
        },
    },
]


# ==================== Tool Dispatch ====================

def _dispatch_page_builder_tool(name: str, args: Dict[str, Any], *, store: str | None = None) -> Dict[str, Any]:
    """Execute a page builder tool call."""
    try:
        if name == "create_shopify_page":
            slug = args.get("slug", "")
            page_title = args.get("page_title", "AI Page")
            product_handle = args.get("product_handle", "")
            product_title = args.get("product_title", "")
            product_gid = args.get("product_gid")
            section_types = args.get("section_types", ["hero", "product", "features", "faq", "cta"])

            # Build sections server-side from the section types list
            sections, order = _build_sections_from_order(
                section_types,
                product_handle=product_handle,
                product_title=product_title,
                page_title=page_title,
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
            }

        if name == "update_shopify_page":
            slug = args.get("slug", "")
            sections = args.get("sections", {})
            order = args.get("order", [])
            layout = args.get("layout")

            tmpl = update_page_template_json(
                slug, sections, order,
                layout=layout,
                store=store,
            )

            return {
                "status": "updated",
                "template_suffix": tmpl.get("template_suffix"),
                "slug": slug,
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
    max_iters: int = 4,
) -> Dict[str, Any]:
    """Run the page builder agent loop with tool-calling.

    Optimized flow:
      Round 1: AI sees prompt → calls create_shopify_page with section_types list
      Backend builds full JSON and creates page → returns page_url immediately.
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

    for iteration in range(max_iters):
        # Force tool call on first iteration; allow text responses after
        choice_mode = "required" if iteration == 0 else "auto"
        resp = client.chat.completions.create(
            model=(model or PAGE_BUILDER_MODEL),
            messages=working,
            tools=PAGE_BUILDER_TOOLS,
            tool_choice=choice_mode,
            timeout=50,
        )
        choice = resp.choices[0]
        msg = choice.message

        tool_calls = getattr(msg, "tool_calls", None) or []
        if tool_calls:
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

                # Extract product info from conversation if not in args
                if fn_name == "create_shopify_page":
                    # Search messages for product context
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
                            if not args.get("product_gid"):
                                match = re.search(r"Product GID:\s*(gid://shopify/Product/\d+)", content)
                                if match:
                                    args["product_gid"] = match.group(1).strip()

                result = _dispatch_page_builder_tool(fn_name, args, store=store)

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

            # FAST PATH: If page was created, return immediately
            if page_url:
                return {
                    "text": f"✅ Page created successfully! View it here: {page_url}",
                    "messages": working,
                    "page_url": page_url,
                    "slug": slug,
                    "template_suffix": template_suffix,
                }
            continue

        # No tool calls — final response
        final_text = msg.content or ""
        return {
            "text": final_text,
            "messages": working,
            "page_url": page_url,
            "slug": slug,
            "template_suffix": template_suffix,
        }

    return {"error": "max_iters_exceeded", "messages": working}
