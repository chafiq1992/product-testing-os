import json
from typing import Any, Dict, List, Optional

from openai import OpenAI

from app.integrations.openai_client import (
    analyze_landing_page,
    gen_angles_and_copy_full,
    gen_title_and_description,
    gen_landing_copy,
    gen_product_from_image,
    DEFAULT_LLM_MODEL,
)


client = OpenAI()


# Tool definitions for Chat Completions function-calling
TOOLS: List[dict] = [
    {
        "type": "function",
        "function": {
            "name": "analyze_landing_page_tool",
            "description": "Analyze a landing page URL and extract marketing inputs (title, benefits, pain points, offers, angles, images).",
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {"type": "string"},
                    "model": {"type": "string", "nullable": True},
                    "prompt_override": {"type": "string", "nullable": True},
                },
                "required": ["url"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "gen_angles_tool",
            "description": "Generate ad angles and copy from a product payload.",
            "parameters": {
                "type": "object",
                "properties": {
                    "product": {"type": "object"},
                    "model": {"type": "string", "nullable": True},
                    "prompt_override": {"type": "string", "nullable": True},
                    "num_angles": {"type": "integer", "nullable": True},
                },
                "required": ["product"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "gen_title_desc_tool",
            "description": "Generate product title and short description from an angle and product payload.",
            "parameters": {
                "type": "object",
                "properties": {
                    "product": {"type": "object"},
                    "angle": {"type": "object"},
                    "model": {"type": "string", "nullable": True},
                    "prompt_override": {"type": "string", "nullable": True},
                    "image_urls": {"type": "array", "items": {"type": "string"}, "nullable": True},
                },
                "required": ["product", "angle"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "gen_landing_copy_tool",
            "description": "Generate landing copy JSON and HTML from product + angles.",
            "parameters": {
                "type": "object",
                "properties": {
                    "product": {"type": "object"},
                    "angles": {"type": "array", "items": {"type": "object"}},
                    "model": {"type": "string", "nullable": True},
                    "prompt_override": {"type": "string", "nullable": True},
                    "image_urls": {"type": "array", "items": {"type": "string"}, "nullable": True},
                    "product_url": {"type": "string", "nullable": True},
                },
                "required": ["product"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "product_from_image_tool",
            "description": "Extract structured product inputs from a single image URL.",
            "parameters": {
                "type": "object",
                "properties": {
                    "image_url": {"type": "string"},
                    "model": {"type": "string", "nullable": True},
                    "target_category": {"type": "string", "nullable": True}
                },
                "required": ["image_url"],
            },
        },
    },
]


def _dispatch_tool(name: str, args: Dict[str, Any]) -> Dict[str, Any]:
    try:
        if name == "analyze_landing_page_tool":
            return analyze_landing_page(
                args.get("url"), model=args.get("model"), prompt_override=args.get("prompt_override")
            )
        if name == "gen_angles_tool":
            full = gen_angles_and_copy_full(
                args.get("product") or {},
                model=args.get("model"),
                prompt_override=args.get("prompt_override"),
            )
            k = args.get("num_angles")
            # Enforce exactly 3 angles by default for Ads Agent use-cases
            eff_k = 3 if not (isinstance(k, int) and k > 0) else k
            try:
                full["angles"] = (full.get("angles") or [])[:eff_k]
            except Exception:
                pass
            return {"angles": full.get("angles", []), "raw": full}
        if name == "gen_title_desc_tool":
            data = gen_title_and_description(
                args.get("product") or {},
                args.get("angle") or {},
                prompt_override=args.get("prompt_override"),
                model=args.get("model"),
                image_urls=args.get("image_urls") or [],
            )
            return data
        if name == "gen_landing_copy_tool":
            product = args.get("product") or {}
            angles = args.get("angles") or []
            data = gen_landing_copy(
                product,
                angles,
                model=args.get("model"),
                image_urls=args.get("image_urls") or [],
                prompt_override=args.get("prompt_override"),
                product_url=args.get("product_url"),
            )
            return data
        if name == "product_from_image_tool":
            out = gen_product_from_image(
                args.get("image_url"),
                model=args.get("model"),
                target_category=args.get("target_category"),
            )
            return out
        return {"error": f"unknown tool {name}"}
    except Exception as e:
        return {"error": str(e)}


def run_agent_until_final(
    messages: List[Dict[str, Any]],
    *,
    model: Optional[str] = None,
    max_iters: int = 8,
) -> Dict[str, Any]:
    """Run a Chat Completions loop handling function-calling tools until no more tool calls.

    messages: chat history, e.g., [{"role":"system","content":"..."}, {"role":"user","content":"..."}]
    Returns: { text: str, messages: List[dict] }
    """
    if not isinstance(messages, list):
        raise ValueError("messages must be a list of chat messages")

    working: List[Dict[str, Any]] = list(messages)
    final_text_parts: List[str] = []

    for _ in range(max_iters):
        resp = client.chat.completions.create(
            model=(model or DEFAULT_LLM_MODEL),
            messages=working,
            tools=TOOLS,
            tool_choice="auto",
        )
        choice = resp.choices[0]
        msg = choice.message

        # If the model returned tool calls, execute them
        tool_calls = getattr(msg, "tool_calls", None) or []
        if tool_calls:
            working.append({"role": "assistant", "content": msg.content or "", "tool_calls": [tc.model_dump() for tc in tool_calls]})
            for tc in tool_calls:
                fn_name = tc.function.name
                try:
                    args = json.loads(tc.function.arguments or "{}")
                except Exception:
                    args = {}
                result = _dispatch_tool(fn_name, args)
                working.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "name": fn_name,
                    "content": json.dumps(result, ensure_ascii=False),
                })
            # Continue loop for next assistant turn
            continue

        # No tool calls; capture final assistant text and exit
        if msg.content:
            final_text_parts.append(msg.content)
        return {"text": "\n".join([t for t in final_text_parts if t]).strip(), "messages": working}

    return {"error": "max_iters_exceeded", "messages": working}


# Opinionated Ads Agent: system prompt steers towards ads-specific tools/structure
ADS_AGENT_SYSTEM = {
    "role": "system",
    "content": (
        "You are the Ads Agent. Always prefer tools when available. Typical flow: "
        "(1) If a URL is provided, call analyze_landing_page_tool. "
        "(2) Use gen_angles_tool (num_angles=3 ONLY). "
        "(3) Optionally refine with gen_title_desc_tool (pick best angle). "
        "(4) Optionally prepare gen_landing_copy_tool using title/desc and a few image_urls. "
        "(5) If an image_url is provided without product info, call product_from_image_tool first. "
        "Style constraints: angles must be benefit-led and ultra-focused; headlines must include emojis and start with a short HOOK; ad copies must include emojis, a strong HOOK in the first 2–3 words, a clear benefit layout, and an explicit CTA at the end. If the product targets kids/parents, emphasize comfort, beauty, distinction, delight, education, and improvement. Keep outputs concise and structured."
    ),
}


def run_ads_agent(messages: List[Dict[str, Any]], *, model: Optional[str] = None) -> Dict[str, Any]:
    if not messages or messages[0].get("role") != "system":
        messages = [ADS_AGENT_SYSTEM] + list(messages)
    return run_agent_until_final(messages, model=model)


