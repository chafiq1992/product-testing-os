"""AI Page Builder Agent — generates Shopify OS 2.0 JSON page templates via OpenAI function-calling.

The agent uses Dawn theme sections (image-banner, rich-text, featured-product, etc.)
to compose landing pages and product pages that appear natively in the Shopify Theme Editor.
"""

import json
from typing import Any, Dict, List, Optional

from openai import OpenAI

from app.integrations.openai_client import DEFAULT_LLM_MODEL
from app.integrations.shopify_client import (
    list_available_sections,
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
    "content": """You are the Shopify Page Builder Agent. Your job is to generate beautiful, high-converting landing pages and product pages using ONLY native Shopify Dawn theme sections.

WORKFLOW:
1. When asked to create a page, FIRST call list_available_sections to see what section types you can use.
2. Then call generate_page_template to produce the JSON template structure.
3. Finally call create_shopify_page to write the template to Shopify and create the page.

WHEN EDITING an existing page:
1. The current template JSON will be provided in the conversation.
2. Analyze the user's requested changes.
3. Call update_shopify_page with the modified sections.

SECTION RULES:
- Use ONLY the section types returned by list_available_sections.
- Each section needs a unique string ID (e.g., "hero", "features", "product_showcase", "faq_section").
- The "order" array must list section IDs in display order.
- For product pages, ALWAYS include a "featured-product" section with the product handle in settings.product.
- Use "image-banner" for hero sections.
- Use "rich-text" for text content, headlines, CTAs.
- Use "multicolumn" for features/benefits grids.
- Use "collapsible-content" for FAQs.
- Use "image-with-text" for feature spotlights.

LAYOUT CONTROL:
- Default: normal layout (with header/footer).
- To hide header AND footer, set layout to "none".
- When user asks to hide header/footer, use set_page_layout tool.

DESIGN PRINCIPLES:
- Create visually rich pages with 5-8 sections minimum.
- Always include: hero, product showcase, benefits/features, trust signals, CTA.
- For landing pages: add urgency, social proof, FAQ.
- Keep text concise and benefit-focused.
- Use color_scheme settings for visual variety between sections.

OUTPUT: Always respond with a brief summary of what you created/changed and the page URL.""",
}


# ==================== Tool Definitions ====================

PAGE_BUILDER_TOOLS: List[dict] = [
    {
        "type": "function",
        "function": {
            "name": "list_available_sections",
            "description": "Get the list of Shopify Dawn theme sections available for building pages. Call this first to know what section types you can use.",
            "parameters": {
                "type": "object",
                "properties": {},
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "generate_page_template",
            "description": "Generate a JSON template structure for a Shopify page. Returns the template spec that can be passed to create_shopify_page.",
            "parameters": {
                "type": "object",
                "properties": {
                    "page_title": {
                        "type": "string",
                        "description": "Title for the page",
                    },
                    "slug": {
                        "type": "string",
                        "description": "URL-friendly slug for the template (e.g., 'summer-shoes-landing'). Lowercase, hyphens only.",
                    },
                    "sections": {
                        "type": "object",
                        "description": "Dict of section_id -> section config. Each section must have 'type' (string matching a Dawn section type), 'settings' (object), and optionally 'blocks' (object of block_id -> block config) and 'block_order' (array of block IDs).",
                    },
                    "order": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Array of section IDs in display order.",
                    },
                    "layout": {
                        "type": "string",
                        "description": "Layout override. Use 'none' to hide header/footer. Omit for default layout.",
                    },
                    "product_handle": {
                        "type": "string",
                        "description": "Shopify product handle to link via featured-product section.",
                    },
                },
                "required": ["page_title", "slug", "sections", "order"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_shopify_page",
            "description": "Write the JSON template to the Shopify theme and create a page using it. Call this after generate_page_template.",
            "parameters": {
                "type": "object",
                "properties": {
                    "page_title": {"type": "string", "description": "Title of the page"},
                    "slug": {"type": "string", "description": "Same slug used in generate_page_template"},
                    "sections": {"type": "object", "description": "The sections dict from generate_page_template"},
                    "order": {"type": "array", "items": {"type": "string"}, "description": "The order array"},
                    "layout": {"type": "string", "description": "Optional layout override ('none' to hide header/footer)"},
                    "product_gid": {"type": "string", "description": "Optional product GID to link the page to the product via metafield"},
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
                    "show_header_footer": {"type": "boolean", "description": "True = normal layout (show header/footer), False = 'none' layout (hide both)"},
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
        if name == "list_available_sections":
            return {"sections": list_available_sections()}

        if name == "generate_page_template":
            # This is a "planning" step — the AI generates the template spec.
            # We just return it so the agent can then call create_shopify_page.
            return {
                "template_spec": {
                    "page_title": args.get("page_title", ""),
                    "slug": args.get("slug", ""),
                    "sections": args.get("sections", {}),
                    "order": args.get("order", []),
                    "layout": args.get("layout"),
                    "product_handle": args.get("product_handle"),
                },
                "status": "ready_to_create",
                "message": "Template spec generated. Call create_shopify_page to write it to Shopify.",
            }

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
    max_iters: int = 10,
) -> Dict[str, Any]:
    """Run the page builder agent loop with tool-calling.

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
            model=(model or DEFAULT_LLM_MODEL),
            messages=working,
            tools=PAGE_BUILDER_TOOLS,
            tool_choice="auto",
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
