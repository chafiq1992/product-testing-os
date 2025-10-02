import json
from typing import Any, Dict, List, Optional

from openai import OpenAI

from app.integrations.openai_client import (
    analyze_landing_page,
    gen_angles_and_copy_full,
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
            if isinstance(k, int) and k > 0:
                try:
                    full["angles"] = (full.get("angles") or [])[:k]
                except Exception:
                    pass
            return {"angles": full.get("angles", []), "raw": full}
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


