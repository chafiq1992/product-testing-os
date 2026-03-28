"""AI Page Builder Agent — generates Shopify OS 2.0 JSON page templates via OpenAI function-calling.

The agent uses Dawn theme sections (image-banner, rich-text, featured-product, etc.)
to compose landing pages and product pages that appear natively in the Shopify Theme Editor.

OPTIMIZED: Sections data is embedded in the system prompt to eliminate the list_available_sections
tool call. The generate_page_template step is merged into create_shopify_page to reduce
the total number of OpenAI round-trips from 3+ down to 2 (one tool call + one final response).
"""

import json
from typing import Any, Dict, List, Optional

from openai import OpenAI

# Use gpt-5.3-codex for page builder — fast structured JSON output
PAGE_BUILDER_MODEL = "gpt-5.3-codex"
from app.integrations.shopify_client import (
    create_page_template_json,
    update_page_template_json,
    read_page_template_json,
    create_page_with_template,
    _link_product_landing_page,
)


client = OpenAI()


# ==================== System Prompt (with embedded sections) ====================

PAGE_BUILDER_SYSTEM = {
    "role": "system",
    "content": """You are the Shopify Page Builder Agent. Your job is to generate beautiful, high-converting landing pages and product pages using ONLY native Shopify Dawn theme sections.

AVAILABLE DAWN SECTIONS (use ONLY these types):
- "image-banner": Full-width hero banner. Settings: image, image_overlay_opacity, heading, heading_size, subheading, button_label, button_link, color_scheme, desktop_content_position, desktop_content_alignment.
- "rich-text": Text section. Settings: color_scheme, full_width. Blocks: heading, text, buttons.
- "featured-product": Product display with images, price, add-to-cart. Settings: product (handle), color_scheme, media_size, media_fit. Blocks: title, price, variant_picker, buy_buttons, description, rating.
- "collapsible-content": FAQ accordion. Settings: caption, heading, heading_size, color_scheme, open_first_collapsible_row. Blocks: collapsible_row (each with heading + body).
- "multicolumn": Grid columns for features/benefits. Settings: title, columns_desktop, color_scheme, image_width, image_ratio. Blocks: column (each with title, text, image).
- "image-with-text": Side-by-side image + text. Settings: image, height, layout, color_scheme. Blocks: heading, text, buttons.
- "video": Embedded video. Settings: heading, video_url, cover_image, color_scheme.
- "featured-collection": Products grid from collection. Settings: title, collection, products_to_show, columns_desktop.
- "contact-form": Contact form. Settings: heading, color_scheme.
- "custom-liquid": Custom HTML/Liquid. Settings: custom_liquid, color_scheme.
- "newsletter": Email signup. Settings: color_scheme. Blocks: heading, paragraph, email_form.

WORKFLOW FOR CREATING A NEW PAGE:
1. Call create_shopify_page with the full sections JSON, order array, page_title, and slug.
   The tool will write the template to the theme AND create the page in one step.
   DO NOT call any other tools first — go straight to create_shopify_page.

WORKFLOW FOR EDITING AN EXISTING PAGE:
1. The current template JSON will be provided in the conversation.
2. Call update_shopify_page with the modified sections.

SECTION RULES:
- Each section needs a unique string ID (e.g., "hero", "features", "faq_section").
- The "order" array must list section IDs in display order.
- For product pages, ALWAYS include a "featured-product" section with the product handle in settings.product.
- Use "image-banner" for hero sections with heading, subheading, and CTA button.
- Use "rich-text" for text content with blocks for heading/text/buttons.
- Use "multicolumn" for features/benefits grids with column blocks.
- Use "collapsible-content" for FAQs with collapsible_row blocks (heading + body).

COLLAPSIBLE_ROW BLOCK FORMAT:
Each FAQ block must have type "collapsible_row" with settings: {"heading": "Question?", "row_content": "<p>Answer text</p>"}

RICH-TEXT BLOCK FORMAT:
- heading block: type "heading", settings: {"heading": "Text here"}
- text block: type "text", settings: {"text": "<p>Paragraph text</p>"}
- buttons block: type "buttons", settings: {"button_label_1": "Shop Now", "button_link_1": "/collections/all"}

MULTICOLUMN BLOCK FORMAT:
Each column block: type "column", settings: {"title": "Feature Title", "text": "<p>Description</p>"}

DESIGN PRINCIPLES:
- Create visually rich pages with 5-8 sections.
- Always include: hero, product showcase, benefits/features, trust signals, CTA.
- Use color_scheme settings (e.g., "scheme-1", "scheme-2") for visual variety between sections.
- Keep text concise and benefit-focused.

OUTPUT: Always respond with a brief summary of what you created and the page URL.""",
}


# ==================== Tool Definitions (optimized — 3 tools only) ====================

PAGE_BUILDER_TOOLS: List[dict] = [
    {
        "type": "function",
        "function": {
            "name": "create_shopify_page",
            "description": "Create a new Shopify page with a JSON template. Generates the template and creates the page in one step. Call this directly — do not call any other tools first.",
            "parameters": {
                "type": "object",
                "properties": {
                    "page_title": {"type": "string", "description": "Title of the page"},
                    "slug": {"type": "string", "description": "URL-friendly slug (e.g., 'summer-shoes-landing'). Lowercase, hyphens only."},
                    "sections": {"type": "object", "description": "Dict of section_id -> section config. Each section has 'type', 'settings', optionally 'blocks' and 'block_order'."},
                    "order": {"type": "array", "items": {"type": "string"}, "description": "Array of section IDs in display order."},
                    "layout": {"type": "string", "description": "Optional layout override. Use 'none' to hide header/footer."},
                    "product_gid": {"type": "string", "description": "Optional product GID to link via metafield"},
                },
                "required": ["page_title", "slug", "sections", "order"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "update_shopify_page",
            "description": "Update an existing page template with modified sections. Use this for iterative edits.",
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
    {
        "type": "function",
        "function": {
            "name": "set_page_layout",
            "description": "Change the layout of an existing page template to show or hide header/footer.",
            "parameters": {
                "type": "object",
                "properties": {
                    "slug": {"type": "string", "description": "The template slug"},
                    "show_header_footer": {"type": "boolean", "description": "True = show header/footer, False = hide both"},
                },
                "required": ["slug", "show_header_footer"],
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
            sections = args.get("sections", {})
            order = args.get("order", [])
            layout = args.get("layout")
            page_title = args.get("page_title", "AI Page")
            product_gid = args.get("product_gid")

            # Step 1: Write template to theme
            tmpl = create_page_template_json(
                slug, sections, order,
                layout=layout,
                store=store,
            )

            # Step 2: Create the page using the template
            page = create_page_with_template(
                page_title,
                tmpl["template_suffix"],
                store=store,
            )

            # Step 3: Link to product if provided
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
                "theme_editor_url": f"https://admin.shopify.com/themes/current/editor?template=page.{tmpl.get('template_suffix', '')}",
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

        if name == "set_page_layout":
            slug = args.get("slug", "")
            show = args.get("show_header_footer", True)

            # Read current template
            current = read_page_template_json(slug, store=store)
            if not current:
                return {"error": f"Template not found for slug: {slug}"}

            sections = current.get("sections", {})
            order = current.get("order", [])
            layout = None if show else "none"

            tmpl = update_page_template_json(
                slug, sections, order,
                layout=layout,
                store=store,
            )

            return {
                "status": "layout_updated",
                "layout": layout or "default",
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

    Optimized flow (2 OpenAI rounds for page creation):
      Round 1: AI sees prompt → calls create_shopify_page with full JSON
      Round 2: AI sees tool result → returns summary text

    Args:
        messages: Chat history (user + assistant messages).
        model: OpenAI model to use.
        store: Multi-store label for Shopify API calls.
        max_iters: Max tool-calling iterations.

    Returns:
        { text: str, messages: list, page_url?: str, slug?: str, template_suffix?: str }
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

    for _ in range(max_iters):
        resp = client.chat.completions.create(
            model=(model or PAGE_BUILDER_MODEL),
            messages=working,
            tools=PAGE_BUILDER_TOOLS,
            tool_choice="auto",
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

            # FAST PATH: If page was created, return immediately without another OpenAI round
            # This saves 15-25s by skipping the AI summary generation
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
