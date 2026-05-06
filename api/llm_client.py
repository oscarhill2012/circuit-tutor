"""Thin provider shim around openai.chat.completions.create(...).

Keeps the agent loop provider-agnostic: swapping to another provider is a
one-file change here, not a rewrite of agent_runner.py.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from typing import Any, Literal


@dataclass
class ToolCall:
    """A function call the model is asking the dispatcher to make."""
    id: str
    name: str
    arguments: dict[str, Any] = field(default_factory=dict)


@dataclass
class ModelResponse:
    """Provider-neutral response shape."""
    content: str | None
    tool_calls: list[ToolCall] = field(default_factory=list)
    finish_reason: str | None = None
    raw: Any = None


def call_model(
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]],
    *,
    tool_choice: Literal["required", "auto", "none"] = "auto",
    model: str | None = None,
    response_format: dict[str, Any] | None = None,
) -> ModelResponse:
    """Make one chat-completion call. Failures bubble.

    The caller is responsible for retrying / corrective re-invokes — full
    plan §3.4: failures are not silently swallowed here.
    """

    from openai import OpenAI  # lazy import keeps this module cheap

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY not set")
    client = OpenAI(api_key=api_key)
    model = model or os.environ.get("OPENAI_MODEL", "gpt-4o-mini")

    kwargs: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "tools": tools,
        "tool_choice": tool_choice,
    }
    if response_format is not None:
        kwargs["response_format"] = response_format

    resp = client.chat.completions.create(**kwargs)
    msg = resp.choices[0].message

    tool_calls: list[ToolCall] = []
    for tc in (getattr(msg, "tool_calls", None) or []):
        # OpenAI returns arguments as a JSON string; parse once here so the
        # dispatcher gets a dict, but stay lenient on bad JSON.
        raw_args = getattr(tc.function, "arguments", "{}") or "{}"
        try:
            parsed_args = json.loads(raw_args)
        except json.JSONDecodeError:
            parsed_args = {"_invalid_json": raw_args}
        tool_calls.append(ToolCall(
            id=getattr(tc, "id", "") or "",
            name=tc.function.name,
            arguments=parsed_args if isinstance(parsed_args, dict) else {},
        ))

    return ModelResponse(
        content=getattr(msg, "content", None),
        tool_calls=tool_calls,
        finish_reason=resp.choices[0].finish_reason,
        raw=resp,
    )


def make_tool_message(tool_call: ToolCall, result: dict[str, Any]) -> dict[str, Any]:
    """Build the `role=tool` message that closes a tool round-trip."""
    return {
        "role": "tool",
        "tool_call_id": tool_call.id,
        "name": tool_call.name,
        "content": json.dumps(result, ensure_ascii=False),
    }


def make_assistant_tool_call_message(tool_calls: list[ToolCall]) -> dict[str, Any]:
    """Re-render the model's tool_calls turn so we can append it to messages."""
    return {
        "role": "assistant",
        "content": None,
        "tool_calls": [
            {
                "id": tc.id,
                "type": "function",
                "function": {
                    "name": tc.name,
                    "arguments": json.dumps(tc.arguments, ensure_ascii=False),
                },
            }
            for tc in tool_calls
        ],
    }
