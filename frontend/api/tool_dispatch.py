"""Maps tool name → tool function. Validates args. Records to ledger.

Single hand-off point between the LLM's tool_call and the typed tool
implementation. Centralising this keeps `agent_runner.run_agent()` thin —
the loop just iterates tool_calls and shovels them through this function.

Plan ref: tutor-redo/03-agent-loop-behind-flag.md §3.3, full plan §11 R3
(dedupe of redundant oracle tool calls).
"""

from __future__ import annotations

import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).parent))

from llm_client import ToolCall
from schemas import (
    AnalyseTopologyArgs,
    CiteFactArgs,
    InspectCircuitArgs,
    LookupKnowledgeArgs,
    MarkTargetArgs,
    ReadMeterArgs,
    RefuseArgs,
    SessionState,
    ToolCallRecord,
    UpdateSessionStateArgs,
    ValidateTaskArgs,
)
from tools import (
    LookupLedger,
    analyse_topology,
    cite_fact,
    inspect_circuit,
    lookup_knowledge,
    mark_target,
    read_meter,
    refuse,
    update_session_state,
    validate_task,
)


# Read-only oracle tools — safe to dedupe within a turn (the second call would
# return the same result, just costing tokens).
_DEDUPE_TOOLS = frozenset({
    "analyse_topology",
    "inspect_circuit",
    "read_meter",
    "lookup_knowledge",
})

# Tools that need a fresh dispatch every time even if args repeat.
# `mark_target`, `cite_fact`, `update_session_state`, `refuse`, `validate_task`
# are all in this set implicitly (anything not in _DEDUPE_TOOLS).


@dataclass
class ExecutionContext:
    """Per-turn dependency bag passed into every tool dispatch."""
    session: SessionState
    circuit_state: dict[str, Any]
    sim_result: dict[str, Any]
    check_request: dict[str, Any] | None
    lookup_ledger: LookupLedger = field(default_factory=LookupLedger)
    call_records: list[ToolCallRecord] = field(default_factory=list)
    redundant_calls: int = 0
    # Cache of (name, frozen_args) -> result_dict for dedupe.
    _dedupe_cache: dict[tuple[str, str], dict[str, Any]] = field(default_factory=dict)


def _freeze_args(args: dict[str, Any]) -> str:
    """Stable repr for dedupe key. Pydantic args are JSON-serialisable."""
    import json as _json
    try:
        return _json.dumps(args, sort_keys=True, ensure_ascii=False)
    except TypeError:
        return repr(sorted(args.items()))


def _record(
    context: ExecutionContext,
    name: str,
    args: dict[str, Any],
    result: dict[str, Any],
    *,
    ms: float,
    ok: bool = True,
    error: str | None = None,
) -> ToolCallRecord:
    rec = ToolCallRecord(
        name=name,
        args=args,
        result=result,
        ms=ms,
        ok=ok,
        error=error,
    )
    context.call_records.append(rec)
    return rec


def _invalid_args(
    context: ExecutionContext,
    tool_call: ToolCall,
    detail: str,
) -> ToolCallRecord:
    return _record(
        context,
        tool_call.name,
        tool_call.arguments,
        {"ok": False, "error": detail},
        ms=0.0,
        ok=False,
        error=f"invalid_arguments: {detail}",
    )


def dispatch(tool_call: ToolCall, context: ExecutionContext) -> ToolCallRecord:
    """Validate args, call the tool, record to ledger.

    Returns the ToolCallRecord (which is already appended to
    `context.call_records`) — the agent loop pulls `record.result` out and
    feeds it back into the conversation as a tool message.
    """
    name = tool_call.name
    raw_args = tool_call.arguments

    # ---- Dedupe (read-only oracle tools only) ------------------------------
    if name in _DEDUPE_TOOLS:
        key = (name, _freeze_args(raw_args))
        cached = context._dedupe_cache.get(key)
        if cached is not None:
            context.redundant_calls += 1
            return _record(context, name, raw_args, cached, ms=0.0, ok=True)
    else:
        key = None  # type: ignore[assignment]

    start = time.perf_counter()
    try:
        result_dict = _run_tool(name, raw_args, context)
        ok = True
        error = None
    except _ArgValidationError as exc:
        return _invalid_args(context, tool_call, str(exc))
    except _UnknownToolError as exc:
        return _invalid_args(context, tool_call, str(exc))
    except Exception as exc:  # noqa: BLE001 — surface to model, don't crash
        result_dict = {"ok": False, "error": f"{type(exc).__name__}: {exc}"}
        ok = False
        error = result_dict["error"]
    elapsed_ms = (time.perf_counter() - start) * 1000.0

    rec = _record(context, name, raw_args, result_dict, ms=elapsed_ms, ok=ok, error=error)
    if name in _DEDUPE_TOOLS and key is not None and ok:
        context._dedupe_cache[key] = result_dict
    return rec


# ---------------------------------------------------------------------------
# Per-tool runners (all return plain dicts so the LLM message round-trip
# is easy — pydantic models go in, dicts come out).
# ---------------------------------------------------------------------------

class _ArgValidationError(ValueError):
    pass


class _UnknownToolError(ValueError):
    pass


def _run_tool(name: str, raw_args: dict[str, Any], ctx: ExecutionContext) -> dict[str, Any]:
    if name == "lookup_knowledge":
        args = _validate(LookupKnowledgeArgs, raw_args)
        out = lookup_knowledge(args, ledger=ctx.lookup_ledger)
        return out.model_dump()

    if name == "cite_fact":
        args = _validate(CiteFactArgs, raw_args)
        out = cite_fact(args, ledger=ctx.lookup_ledger)
        return out.model_dump()

    if name == "analyse_topology":
        args = _validate(AnalyseTopologyArgs, raw_args)
        out = analyse_topology(args, circuit_state=ctx.circuit_state)
        return out.model_dump()

    if name == "inspect_circuit":
        args = _validate(InspectCircuitArgs, raw_args)
        out = inspect_circuit(
            args, circuit_state=ctx.circuit_state, sim_result=ctx.sim_result,
        )
        return out.model_dump(exclude_none=True)

    if name == "read_meter":
        args = _validate(ReadMeterArgs, raw_args)
        out = read_meter(args, circuit_state=ctx.circuit_state, sim_result=ctx.sim_result)
        return out.model_dump()

    if name == "mark_target":
        args = _validate(MarkTargetArgs, raw_args)
        out = mark_target(args, circuit_state=ctx.circuit_state)
        return out.model_dump()

    if name == "validate_task":
        args = _validate(ValidateTaskArgs, raw_args)
        out = validate_task(
            args,
            session=ctx.session,
            circuit_state=ctx.circuit_state,
            sim_result=ctx.sim_result,
            check_request=ctx.check_request,
        )
        return out.model_dump()

    if name == "refuse":
        args = _validate(RefuseArgs, raw_args)
        out = refuse(args, session=ctx.session)
        return out.model_dump()

    if name == "update_session_state":
        args = _validate(UpdateSessionStateArgs, raw_args)
        out = update_session_state(args, session=ctx.session)
        return out.model_dump()

    raise _UnknownToolError(f"unknown tool: {name!r}")


def _validate(model_cls, raw_args: dict[str, Any]):
    try:
        return model_cls.model_validate(raw_args)
    except Exception as exc:  # noqa: BLE001
        raise _ArgValidationError(str(exc)) from exc


# ---------------------------------------------------------------------------
# Tool spec generator — feeds OpenAI tools=[...] from a single pydantic source
# (full plan R5).
# ---------------------------------------------------------------------------

_TOOL_DESCRIPTIONS = {
    "lookup_knowledge": "Retrieve grounding facts from the curated KB. Required before any physics-claim turn. Returns up to `limit` entries.",
    "cite_fact": "Mark a previously-looked-up KB id as backing a claim in the upcoming reply. Required for any reply with a physics claim. Rejects if the kb_id was not returned by lookup_knowledge this turn.",
    "analyse_topology": "Run the circuit validator and return its analysis dict plus a suggested-focus hint.",
    "inspect_circuit": "Read selected fields of the live circuit (components, wires, meters, props, readings). Numerics return as-is.",
    "read_meter": "Get the simulated reading and status of one meter.",
    "mark_target": "Apply a visual highlight to a component by id. Server validates the id against the live circuit.",
    "validate_task": "Judge whether the active task's success criteria are met. Required when a check_request is in flight.",
    "refuse": "Signal that the student's message is out-of-scope or unsafe. Required when refusing; nothing else may be emitted alongside.",
    "update_session_state": "Append-only updates to rolling session state. Misconception ids must exist in the KB.",
}


def _model_to_openai_schema(model_cls) -> dict[str, Any]:
    """Convert a pydantic model to an OpenAI-tools-compatible JSON schema.

    Strips the `$defs` indirection OpenAI sometimes rejects and inlines
    properties directly. Also forces additionalProperties=False to match
    `extra="forbid"` on most arg models.
    """
    schema = model_cls.model_json_schema()
    # OpenAI tolerates standard JSON schema; just patch a couple of fields
    # that have caused issues historically.
    schema.pop("title", None)
    if "properties" not in schema:
        schema["properties"] = {}
    return schema


def build_tools_spec() -> list[dict[str, Any]]:
    """Build the tools=[...] list passed to chat.completions.create.

    Single source of truth for tool schemas — derived from the same pydantic
    models the dispatcher validates against (full plan R5).
    """
    tools = (
        ("lookup_knowledge", LookupKnowledgeArgs),
        ("cite_fact", CiteFactArgs),
        ("analyse_topology", AnalyseTopologyArgs),
        ("inspect_circuit", InspectCircuitArgs),
        ("read_meter", ReadMeterArgs),
        ("mark_target", MarkTargetArgs),
        ("validate_task", ValidateTaskArgs),
        ("refuse", RefuseArgs),
        ("update_session_state", UpdateSessionStateArgs),
    )
    return [
        {
            "type": "function",
            "function": {
                "name": name,
                "description": _TOOL_DESCRIPTIONS.get(name, ""),
                "parameters": _model_to_openai_schema(cls),
            },
        }
        for name, cls in tools
    ]
