"""AI Page Builder Agent — generates Shopify OS 2.0 JSON page templates via OpenAI function-calling.

The agent uses Dawn theme sections (image-banner, rich-text, featured-product, etc.)
to compose landing pages and product pages that appear natively in the Shopify Theme Editor.

ARCHITECTURE: The AI model decides WHICH sections to include and provides content/metadata.
The backend _build_sections_from_order() generates the full sections JSON server-side,
since LLMs struggle to produce large nested JSON in tool call arguments reliably.

All edit operations (add/remove/reorder sections) are also server-side — the LLM never
produces raw section JSON, only picks section types and provides text content.
"""

import json
import re
from typing import Any, Dict, List, Optional
from uuid import uuid4

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
    "content": """You are the Shopify Page Builder Agent. You create beautiful, state-of-the-art landing pages and product pages.

WORKFLOW:
- To CREATE a new page: call create_shopify_page with page_title, slug, section_types, and product details.
- To ADD a section to an existing page: call add_section_to_page with slug and section_type.
- To REMOVE a section: call remove_section_from_page with slug and section_id.
- To REORDER sections: call reorder_sections with slug and the new order.

The backend generates all section JSON server-side — you never write raw JSON.

AVAILABLE SECTION TYPES (for section_types array and add_section_to_page):
- "hero": Full-width hero banner with heading, subheading, and CTA button
- "product": Featured product showcase with images, price, variants, add-to-cart
- "features": 3-column benefits/features grid with icons
- "benefits": Bullet-point benefits list (rich text with checkmarks)
- "testimonials": Customer review quotes in 3 columns
- "faq": Frequently asked questions accordion
- "cta": Call-to-action section with heading, text, and button
- "image_text": Image + text side-by-side layout
- "newsletter": Email signup section
- "video": Video embed section (YouTube/Vimeo URL)
- "collection": Featured collection product grid
- "countdown": Urgency/scarcity countdown section
- "guarantee": Trust/guarantee section with badge
- "comparison": Comparison/before-after columns
- "custom_html": Custom HTML/Liquid section (provide custom_liquid content)
- "description": Rich text description section

RULES:
- Always include "hero" and "product" sections for product pages.
- Use 5-8 sections for a rich, professional page.
- When user asks to "add a section", use add_section_to_page (NOT create_shopify_page).
- When user asks to "add bullet points of benefits", use section_type "benefits".
- Call tools immediately — don't ask the user for confirmation.

CUSTOMIZATION: Many tools accept optional content parameters:
- heading: Custom heading text
- subheading: Custom subtitle text
- items: Array of {title, text} for features/benefits/testimonials
- faq_items: Array of {heading, row_content} for FAQ
- button_label / button_link: CTA button customization
- video_url: YouTube/Vimeo URL for video section
- custom_liquid: Raw HTML/Liquid for custom_html section

OUTPUT: After any operation, briefly confirm with the page URL.""",
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
    """Build a single Dawn-compatible section dict.

    Returns the section config dict, or None if the type is unknown.
    All sections are built to match the Dawn theme's actual schema.
    """
    display_title = product_title or page_title or "Shop Now"
    st = section_type

    if st == "hero":
        # Dawn image-banner: heading/subheading go in BLOCKS, not settings
        blocks = {}
        block_order = []
        bid_h = "hero_heading"
        blocks[bid_h] = {
            "type": "heading",
            "settings": {
                "heading": heading or display_title,
                "heading_size": "h0",
            },
        }
        block_order.append(bid_h)

        bid_s = "hero_subheading"
        blocks[bid_s] = {
            "type": "text",
            "settings": {
                "text": subheading or f"Discover the perfect {display_title.lower()}",
            },
        }
        block_order.append(bid_s)

        bid_b = "hero_button"
        blocks[bid_b] = {
            "type": "buttons",
            "settings": {
                "button_label_1": button_label or "Shop Now",
                "button_link_1": button_link or (f"/products/{product_handle}" if product_handle else "/collections/all"),
                "button_style_secondary_1": False,
                "button_label_2": "",
                "button_link_2": "",
            },
        }
        block_order.append(bid_b)

        return {
            "type": "image-banner",
            "settings": {
                "image_overlay_opacity": 40,
                "color_scheme": color_scheme,
                "desktop_content_position": "middle-center",
                "desktop_content_alignment": "center",
                "show_text_box": False,
                "mobile_content_alignment": "center",
            },
            "blocks": blocks,
            "block_order": block_order,
        }

    elif st == "product":
        blocks = {}
        block_order = []
        for btype in ["title", "price", "variant_picker", "quantity_selector", "buy_buttons"]:
            bid = f"product_{btype}"
            blocks[bid] = {"type": btype, "settings": {}}
            block_order.append(bid)

        return {
            "type": "featured-product",
            "settings": {
                "product": product_handle,
                "color_scheme": color_scheme,
                "media_size": "large",
                "media_fit": "contain",
                "media_position": "left",
                "secondary_background": False,
            },
            "blocks": blocks,
            "block_order": block_order,
        }

    elif st == "features":
        feature_items = items or [
            {"title": "✨ Premium Quality", "text": "<p>Crafted with the finest materials for lasting durability and everyday luxury.</p>"},
            {"title": "🚚 Fast Shipping", "text": "<p>Free express delivery on all orders. Get it in 2-3 business days.</p>"},
            {"title": "↩️ Easy Returns", "text": "<p>30-day hassle-free return policy. Shop with complete confidence.</p>"},
        ]
        blocks = {}
        block_order = []
        for j, item in enumerate(feature_items):
            bid = f"feature_{j}"
            blocks[bid] = {
                "type": "column",
                "settings": {"title": item.get("title", ""), "text": item.get("text", "")},
            }
            block_order.append(bid)

        return {
            "type": "multicolumn",
            "settings": {
                "title": heading or "Why Choose Us",
                "heading_size": "h2",
                "columns_desktop": 3,
                "color_scheme": color_scheme,
                "column_alignment": "center",
                "swipe_on_mobile": True,
            },
            "blocks": blocks,
            "block_order": block_order,
        }

    elif st == "benefits":
        # Rich-text section with bullet-point benefits
        benefit_items = items or [
            {"text": f"Premium quality materials that last"},
            {"text": f"Perfectly designed for everyday use"},
            {"text": f"Loved by thousands of happy customers"},
            {"text": f"Free shipping and easy returns"},
            {"text": f"100% satisfaction guaranteed"},
        ]
        # Build benefit text as HTML list
        benefits_html = "<ul>"
        for item in benefit_items:
            txt = item.get("text", item.get("title", ""))
            benefits_html += f"<li>✅ {txt}</li>"
        benefits_html += "</ul>"

        blocks = {
            "benefits_heading": {
                "type": "heading",
                "settings": {"heading": _html_heading(heading or f"Benefits of {display_title}")},
            },
            "benefits_text": {
                "type": "text",
                "settings": {"text": benefits_html},
            },
        }
        return {
            "type": "rich-text",
            "settings": {"color_scheme": color_scheme, "full_width": False},
            "blocks": blocks,
            "block_order": ["benefits_heading", "benefits_text"],
        }

    elif st == "description":
        # Rich-text description section
        blocks = {
            "desc_heading": {
                "type": "heading",
                "settings": {"heading": _html_heading(heading or f"About {display_title}")},
            },
            "desc_text": {
                "type": "text",
                "settings": {"text": subheading or f"<p>Discover everything you need to know about the {display_title}. Premium quality, thoughtful design, and exceptional value — all in one product.</p>"},
            },
        }
        return {
            "type": "rich-text",
            "settings": {"color_scheme": color_scheme, "full_width": False},
            "blocks": blocks,
            "block_order": ["desc_heading", "desc_text"],
        }

    elif st == "testimonials":
        test_items = items or [
            {"title": "⭐⭐⭐⭐⭐ Amazing Quality!", "text": '<p>"Absolutely love this product! Exceeded all my expectations." — Sarah M.</p>'},
            {"title": "⭐⭐⭐⭐⭐ Best Purchase Ever", "text": '<p>"Fast shipping and incredible quality. Will buy again!" — James R.</p>'},
            {"title": "⭐⭐⭐⭐⭐ Highly Recommend", "text": '<p>"Perfect in every way. My friends are all ordering one too!" — Emily K.</p>'},
        ]
        blocks = {}
        block_order = []
        for j, item in enumerate(test_items):
            bid = f"testimonial_{j}"
            blocks[bid] = {
                "type": "column",
                "settings": {"title": item.get("title", ""), "text": item.get("text", "")},
            }
            block_order.append(bid)

        return {
            "type": "multicolumn",
            "settings": {
                "title": heading or "What Our Customers Say",
                "heading_size": "h2",
                "columns_desktop": 3,
                "color_scheme": color_scheme,
                "column_alignment": "center",
                "swipe_on_mobile": True,
            },
            "blocks": blocks,
            "block_order": block_order,
        }

    elif st == "faq":
        faq_data = faq_items or [
            {"heading": "What materials is this made from?", "row_content": f"<p>The {display_title} is crafted from premium, high-quality materials designed for lasting durability and everyday use.</p>"},
            {"heading": "How long does shipping take?", "row_content": "<p>We offer free express shipping on all orders. Most orders arrive within 2-3 business days.</p>"},
            {"heading": "What is your return policy?", "row_content": "<p>We offer a 30-day hassle-free return policy. If you're not completely satisfied, simply return the product for a full refund.</p>"},
            {"heading": "Is this product suitable as a gift?", "row_content": f"<p>Absolutely! The {display_title} makes a perfect gift. We also offer gift wrapping options at checkout.</p>"},
        ]
        blocks = {}
        block_order = []
        for j, item in enumerate(faq_data):
            bid = f"faq_{j}"
            blocks[bid] = {
                "type": "collapsible_row",
                "settings": {"heading": item.get("heading", ""), "row_content": item.get("row_content", "")},
            }
            block_order.append(bid)

        return {
            "type": "collapsible-content",
            "settings": {
                "caption": "",
                "heading": heading or "Frequently Asked Questions",
                "heading_size": "h1",
                "heading_alignment": "center",
                "color_scheme": color_scheme,
                "container_color_scheme": "",
                "open_first_collapsible_row": True,
            },
            "blocks": blocks,
            "block_order": block_order,
        }

    elif st == "cta":
        blocks = {
            "cta_heading": {
                "type": "heading",
                "settings": {"heading": _html_heading(heading or f"Ready to Get Your {display_title}?")},
            },
            "cta_text": {
                "type": "text",
                "settings": {"text": subheading or "<p>Order now and experience the difference. Limited stock available!</p>"},
            },
            "cta_button": {
                "type": "buttons",
                "settings": {
                    "button_label_1": button_label or "Order Now",
                    "button_link_1": button_link or (f"/products/{product_handle}" if product_handle else "/collections/all"),
                    "button_style_secondary_1": False,
                    "button_label_2": "",
                    "button_link_2": "",
                },
            },
        }
        return {
            "type": "rich-text",
            "settings": {"color_scheme": color_scheme, "full_width": True},
            "blocks": blocks,
            "block_order": ["cta_heading", "cta_text", "cta_button"],
        }

    elif st == "image_text":
        blocks = {
            "it_heading": {
                "type": "heading",
                "settings": {"heading": _html_heading(heading or f"Why {display_title}?")},
            },
            "it_text": {
                "type": "text",
                "settings": {"text": subheading or f"<p>Experience premium quality and thoughtful design. The {display_title} combines style with functionality for the perfect everyday companion.</p>"},
            },
            "it_button": {
                "type": "buttons",
                "settings": {
                    "button_label_1": button_label or "Learn More",
                    "button_link_1": button_link or (f"/products/{product_handle}" if product_handle else "/collections/all"),
                    "button_style_secondary_1": False,
                    "button_label_2": "",
                    "button_link_2": "",
                },
            },
        }
        return {
            "type": "image-with-text",
            "settings": {
                "height": "adapt",
                "layout": "image_first",
                "desktop_image_width": "medium",
                "desktop_content_position": "middle",
                "desktop_content_alignment": "left",
                "color_scheme": color_scheme,
            },
            "blocks": blocks,
            "block_order": ["it_heading", "it_text", "it_button"],
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

    elif st == "countdown":
        # Countdown using custom-liquid section — wrap JS in {% raw %} to prevent Liquid parse errors
        product_link = f'/products/{product_handle}' if product_handle else '/collections/all'
        countdown_html = custom_liquid or (
            f'<div style="text-align:center;padding:40px 20px;background:linear-gradient(135deg,#1a1a2e,#16213e);border-radius:16px;color:#fff;margin:20px 0;">'
            f'<h2 style="font-size:28px;margin:0 0 8px;">🔥 Limited Time Offer</h2>'
            f'<p style="font-size:16px;color:#e0e0e0;margin:0 0 20px;">Don\'t miss out on {display_title} — this deal won\'t last!</p>'
            f'<div id="countdown-timer" style="display:flex;justify-content:center;gap:16px;font-size:32px;font-weight:bold;">'
            f'<div style="background:rgba(255,255,255,0.1);padding:12px 20px;border-radius:12px;"><span id="cd-hours">23</span><div style="font-size:11px;font-weight:normal;color:#aaa;">HOURS</div></div>'
            f'<div style="background:rgba(255,255,255,0.1);padding:12px 20px;border-radius:12px;"><span id="cd-mins">59</span><div style="font-size:11px;font-weight:normal;color:#aaa;">MINUTES</div></div>'
            f'<div style="background:rgba(255,255,255,0.1);padding:12px 20px;border-radius:12px;"><span id="cd-secs">59</span><div style="font-size:11px;font-weight:normal;color:#aaa;">SECONDS</div></div>'
            f'</div>'
            f'<a href="{product_link}" style="display:inline-block;margin-top:24px;padding:14px 36px;background:#e74c3c;color:#fff;text-decoration:none;border-radius:8px;font-size:16px;font-weight:bold;">Grab the Deal →</a>'
            f'</div>'
            '{%raw%}<script>'
            '(function(){var h=document.getElementById("cd-hours"),m=document.getElementById("cd-mins"),s=document.getElementById("cd-secs");if(!h||!m||!s)return;var t=86399;setInterval(function(){t--;if(t<0)t=86399;h.textContent=String(Math.floor(t/3600)).padStart(2,"0");m.textContent=String(Math.floor((t%3600)/60)).padStart(2,"0");s.textContent=String(t%60).padStart(2,"0");},1000);})();'
            '</script>{%endraw%}'
        )
        return {
            "type": "custom-liquid",
            "settings": {
                "custom_liquid": countdown_html,
                "color_scheme": color_scheme,
            },
        }

    elif st == "guarantee":
        blocks = {
            "guarantee_heading": {
                "type": "heading",
                "settings": {"heading": _html_heading(heading or "100% Satisfaction Guaranteed")},
            },
            "guarantee_text": {
                "type": "text",
                "settings": {"text": subheading or f"<p>We stand behind the quality of every {display_title} we sell. If you're not completely satisfied with your purchase, simply return it within 30 days for a full refund — no questions asked. Your happiness is our priority.</p>"},
            },
            "guarantee_button": {
                "type": "buttons",
                "settings": {
                    "button_label_1": button_label or "Shop Risk-Free",
                    "button_link_1": button_link or (f"/products/{product_handle}" if product_handle else "/collections/all"),
                    "button_style_secondary_1": False,
                    "button_label_2": "",
                    "button_link_2": "",
                },
            },
        }
        return {
            "type": "image-with-text",
            "settings": {
                "height": "adapt",
                "layout": "text_first",
                "desktop_image_width": "medium",
                "desktop_content_position": "middle",
                "desktop_content_alignment": "left",
                "color_scheme": color_scheme,
            },
            "blocks": blocks,
            "block_order": ["guarantee_heading", "guarantee_text", "guarantee_button"],
        }

    elif st == "comparison":
        comp_items = items or [
            {"title": "Without " + display_title, "text": "<p>❌ Ordinary quality<br>❌ Slow delivery<br>❌ No guarantee<br>❌ Generic design</p>"},
            {"title": "With " + display_title, "text": "<p>✅ Premium quality<br>✅ Fast free shipping<br>✅ 30-day guarantee<br>✅ Unique, stylish design</p>"},
        ]
        blocks = {}
        block_order = []
        for j, item in enumerate(comp_items):
            bid = f"compare_{j}"
            blocks[bid] = {
                "type": "column",
                "settings": {"title": item.get("title", ""), "text": item.get("text", "")},
            }
            block_order.append(bid)

        return {
            "type": "multicolumn",
            "settings": {
                "title": heading or "See the Difference",
                "heading_size": "h2",
                "columns_desktop": 2,
                "color_scheme": color_scheme,
                "column_alignment": "center",
            },
            "blocks": blocks,
            "block_order": block_order,
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

    for i, st in enumerate(section_types):
        cs = color_schemes[i % len(color_schemes)]
        sid = st  # section ID = section type name

        # Determine items for this section type
        section_items = items_map.get(st) or None
        if st == "features" and not section_items:
            section_items = feature_items
        elif st == "testimonials" and not section_items:
            section_items = testimonial_items

        section = _build_single_section(
            st,
            product_handle=product_handle,
            product_title=product_title,
            page_title=page_title,
            color_scheme=cs,
            heading=headings_map.get(st),
            items=section_items,
            faq_items=faq_items if st == "faq" else None,
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
            "description": "Create a new Shopify landing page. Provide the section types you want and the backend auto-generates the full template. Call this directly.",
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
                            "custom_html", "description",
                        ]},
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
                            "custom_html", "description",
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
    max_iters: int = 6,
) -> Dict[str, Any]:
    """Run the page builder agent loop with tool-calling.

    Optimized flow:
      Round 1: AI sees prompt → calls create_shopify_page with section_types list
      Backend builds full JSON and creates page → returns page_url immediately.
      For edits: AI uses add/remove/reorder tools — all server-side.
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

                result = _dispatch_page_builder_tool(fn_name, args, store=store)
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

            # FAST PATH: If page was created, return immediately
            if page_url and fn_name == "create_shopify_page":
                return {
                    "text": f"✅ Page created successfully! View it here: {page_url}",
                    "messages": working,
                    "page_url": page_url,
                    "slug": slug,
                    "template_suffix": template_suffix,
                }

            # If section was added/removed/reordered successfully, return
            if last_result and not last_result.get("error") and fn_name in ("add_section_to_page", "remove_section_from_page", "reorder_sections"):
                action_text = {
                    "add_section_to_page": f"✅ Section '{last_result.get('section_type', '')}' added successfully!",
                    "remove_section_from_page": f"✅ Section '{last_result.get('removed_section_id', '')}' removed successfully!",
                    "reorder_sections": "✅ Sections reordered successfully!",
                }.get(fn_name, "✅ Done!")

                return {
                    "text": action_text,
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
