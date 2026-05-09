"""Agent runner — post-validator + agent loop.

This file owns the architectural moat: `validate_final_reply()`. The function
is pure. It takes the proposed envelope, the per-turn ledger, and the inbound
request; it returns Accept(envelope) or Reject(reason, detail). It does not
mutate state, does not call the model, does not retry. The agent loop in
`run_agent()` is the consumer that decides what to do on Reject.
"""

from __future__ import annotations

import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

sys.path.insert(0, str(Path(__file__).parent))

from claim_classifier import claims_requiring_citation
from schemas import (
    ToolCallRecord,
    TutorReplyEnvelope,
)


# ---------------------------------------------------------------------------
# Decision types
# ---------------------------------------------------------------------------

RejectReason = Literal[
    "no_tools_called",
    "ack_text_not_pleasantry",
    "refusal_with_other_tools",
    "refusal_text_mismatch",
    "uncited_physics_claim",
    "cite_without_lookup",
    "unauthorised_visual_target",
    "verdict_without_validate",
    "verdict_mismatch",
    "schema_failure",
]


@dataclass(frozen=True)
class Accept:
    envelope: TutorReplyEnvelope


@dataclass(frozen=True)
class Reject:
    reason: RejectReason
    detail: str


# ---------------------------------------------------------------------------
# Ack envelope shape — close the jailbreak bypass
# ---------------------------------------------------------------------------

# Short keywords that must appear (case-insensitive) for an ack to qualify
# as a social pleasantry. Anything that is not greeting-shaped is suspect:
# the ack reply_type bypasses the no-tools-called rule, so any longer or
# off-topic content riding the ack envelope would otherwise reach the user
# without grounding. See `_ack_text_is_pleasantry` and the validator's
# tool-invariant branch in `validate_final_reply`.
_ACK_PLEASANTRY_KEYWORDS = (
    "hi", "hello", "hey", "thanks", "thank you", "thx", "cheers",
    "welcome", "great", "ok", "okay", "got it", "sure",
    "no problem", "you're welcome", "glad",
)


def _ack_text_is_pleasantry(text: str) -> bool:
    """True iff `text` looks like a short social acknowledgement.

    Must be <= 120 chars, contain at least one pleasantry keyword, and
    not contain a question mark (questions are pedagogy, not pleasantries).
    """
    if not text or len(text) > 120:
        return False
    if "?" in text:
        return False
    lowered = text.lower()
    return any(kw in lowered for kw in _ACK_PLEASANTRY_KEYWORDS)


# ---------------------------------------------------------------------------
# Ledger view (read-only convenience over the raw ToolCallRecord list)
# ---------------------------------------------------------------------------

@dataclass
class Ledger:
    """Per-turn record of every tool call.

    Populated by the agent loop; tests can build it by hand from synthetic ToolCallRecord lists.
    """

    calls: list[ToolCallRecord] = field(default_factory=list)

    @property
    def tool_names(self) -> set[str]:
        return {c.name for c in self.calls}

    def calls_named(self, name: str) -> list[ToolCallRecord]:
        return [c for c in self.calls if c.name == name]

    @property
    def lookup_kb_ids(self) -> set[str]:
        """Every kb_id that came back from a successful lookup_knowledge call."""
        seen: set[str] = set()
        for c in self.calls_named("lookup_knowledge"):
            entries = c.result.get("entries") or []
            for e in entries:
                if isinstance(e, dict) and e.get("id"):
                    seen.add(e["id"])
        return seen

    @property
    def cite_fact_kb_ids(self) -> set[str]:
        return {c.args.get("kb_id") for c in self.calls_named("cite_fact") if c.ok}

    @property
    def successful_mark_targets(self) -> set[str]:
        return {
            c.args.get("target")
            for c in self.calls_named("mark_target")
            if c.ok and bool(c.result.get("ok"))
        }

    @property
    def refuse_call(self) -> ToolCallRecord | None:
        calls = self.calls_named("refuse")
        return calls[0] if calls else None

    @property
    def validate_task_call(self) -> ToolCallRecord | None:
        calls = self.calls_named("validate_task")
        return calls[0] if calls else None


# ---------------------------------------------------------------------------
# Inbound view used by the validator (subset of TutorRequest)
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class ValidatorInbound:
    """The slice of the request the validator needs to render its decision."""
    has_check_request: bool


def _envelope_from_dict(envelope_obj: Any) -> TutorReplyEnvelope | Reject:
    """Coerce dict-or-envelope to TutorReplyEnvelope, returning Reject on schema fail."""
    if isinstance(envelope_obj, TutorReplyEnvelope):
        return envelope_obj
    try:
        return TutorReplyEnvelope.model_validate(envelope_obj)
    except Exception as exc:  # noqa: BLE001 — surface as schema_failure
        return Reject("schema_failure", f"envelope failed pydantic validation: {exc}")


# ---------------------------------------------------------------------------
# The validator (the architectural moat)
# ---------------------------------------------------------------------------

def validate_final_reply(
    envelope: TutorReplyEnvelope | dict,
    ledger: Ledger,
    inbound: ValidatorInbound,
) -> Accept | Reject:
    """Decide whether the proposed final reply is allowed to leave the server.

    The function is the only thing standing between the model and the user
    in the new architecture. Every reject branch enforces a soundness property
    of the protocol.

    Pure: no state mutation, no retries, no model calls.
    """

    # ---- 0. schema -------------------------------------------------------
    coerced = _envelope_from_dict(envelope)
    if isinstance(coerced, Reject):
        return coerced
    env: TutorReplyEnvelope = coerced

    # ---- 1. tool invariant ------------------------------------------------
    # `ack` turns (greetings, thanks, acknowledgements) are pure social
    # pleasantries with no physics content and so are exempt from the
    # tool-call requirement. Every other reply type must ground itself in
    # at least one tool call. Ack envelopes have additional shape rules
    # (see `_ack_text_is_pleasantry`) so the bypass cannot be used to
    # smuggle off-topic content past validation.
    if env.reply_type == "ack":
        if not _ack_text_is_pleasantry(env.assistant_text):
            return Reject(
                "ack_text_not_pleasantry",
                f"ack assistant_text must be a short greeting/thanks; saw {env.assistant_text!r}",
            )
    elif not ledger.calls:
        return Reject("no_tools_called", "ledger is empty; at least one tool call is required")

    # ---- 2. refusal exclusivity -------------------------------------------
    if env.reply_type == "refusal":
        names = ledger.tool_names
        if names != {"refuse"}:
            extra = sorted(names - {"refuse"})
            return Reject(
                "refusal_with_other_tools",
                f"refusal turn ledger must contain only `refuse`; saw also {extra}",
            )
        refuse_call = ledger.refuse_call
        if refuse_call is None:
            return Reject(
                "refusal_with_other_tools",
                "reply_type is refusal but no `refuse` call in ledger",
            )
        rendered = (refuse_call.result or {}).get("rendered")
        if rendered is None or env.assistant_text.strip() != str(rendered).strip():
            return Reject(
                "refusal_text_mismatch",
                f"assistant_text must match rendered refusal exactly; rendered={rendered!r}",
            )
        # Refusal turns skip the rest of the checks — by definition no claims,
        # no visual instructions, no verdict.
        return Accept(env)

    # ---- 3. claim grounding -----------------------------------------------
    needs_citation = claims_requiring_citation(env.assistant_text)
    if needs_citation:
        cited_ids = ledger.cite_fact_kb_ids
        looked_up_ids = ledger.lookup_kb_ids
        if not cited_ids:
            sample = needs_citation[0].text
            return Reject(
                "uncited_physics_claim",
                f"physics claim found but no successful cite_fact call: {sample!r}",
            )
        not_in_lookup = cited_ids - looked_up_ids
        if not_in_lookup:
            return Reject(
                "cite_without_lookup",
                f"cited kb_ids not retrieved this turn via lookup_knowledge: {sorted(not_in_lookup)}",
            )

    # ---- 4. visual instruction allow-list ---------------------------------
    successful_targets = ledger.successful_mark_targets
    for vi in env.visual_instructions:
        if vi.target not in successful_targets:
            return Reject(
                "unauthorised_visual_target",
                f"visual_instructions references {vi.target!r}, no successful mark_target call",
            )

    # ---- 5. verdict turns -------------------------------------------------
    if inbound.has_check_request:
        v_call = ledger.validate_task_call
        if v_call is None:
            return Reject(
                "verdict_without_validate",
                "check_request set on the inbound; ledger must contain a validate_task call",
            )
        tool_verdict = (v_call.result or {}).get("verdict")
        if env.verdict not in ("pass", "fail") or env.verdict != tool_verdict:
            return Reject(
                "verdict_mismatch",
                f"envelope verdict={env.verdict!r} does not match validate_task verdict={tool_verdict!r}",
            )

    return Accept(env)


# ---------------------------------------------------------------------------
# Agent loop.
# ---------------------------------------------------------------------------

import json as _json

import llm_client as _llm
from llm_client import (
    ModelResponse,
    ToolCall,
    make_assistant_tool_call_message,
    make_tool_message,
)
from schemas import TutorRequest, FactCheck, StateSummary, SafetyBlock, VisualInstruction
from session_store import SessionStore, get_default_store
from system_prompt import (
    SYSTEM_PROMPT,
    build_corrective_message,
    build_first_user_message,
)
from tool_dispatch import ExecutionContext, build_tools_spec, dispatch


MAX_ITERS = 5


@dataclass
class AgentResult:
    """What the HTTP layer needs to assemble the response body."""
    envelope: TutorReplyEnvelope
    ledger: Ledger
    analysis: dict[str, Any] | None
    payload_char_count: int
    loop_iterations: int
    validator_decision: str
    redundant_calls: int
    model_name: str = ""


def _safe_fallback_envelope(reason: str, detail: str) -> TutorReplyEnvelope:
    """Used when the validator rejects twice or the loop exhausts."""
    return TutorReplyEnvelope(
        reply_type="teaching",
        assistant_text="I hit a hiccup while thinking. Let's look at your circuit together — what would you like to try?",
        follow_up_question="",
        verdict="",
        visual_instructions=[],
        safety=SafetyBlock(in_scope=True, reason=f"safe_fallback:{reason}"),
        fact_checks=[],
        state_summary=StateSummary(),
        rolling_summary="",
    )


def _parse_envelope(content: str | None) -> TutorReplyEnvelope | Reject:
    """Parse the model's final-reply JSON. Schema fail → Reject."""
    if not content:
        return Reject("schema_failure", "model returned empty content")
    text = content.strip()
    # Defensive: strip markdown fences if the model wrapped its JSON.
    if text.startswith("```"):
        text = text.strip("`")
        if text.lower().startswith("json"):
            text = text[4:].strip()
    try:
        obj = _json.loads(text)
    except _json.JSONDecodeError as exc:
        return Reject("schema_failure", f"final reply is not valid JSON: {exc}")
    coerced = _envelope_from_dict(obj)
    if isinstance(coerced, Reject):
        return coerced
    return coerced


def _rebuild_envelope_from_ledger(env: TutorReplyEnvelope, ledger: Ledger) -> TutorReplyEnvelope:
    """Backstop: ensure visual_instructions / fact_checks reflect ledger truth.

    The validator rejects naked targets / cites already; this is a belt-and-
    braces step the agent loop runs *before* the validator so the model gets
    the benefit of the doubt when it merely listed a successful mark in a
    different order.
    """

    successful_targets = ledger.successful_mark_targets
    valid_visuals = [vi for vi in env.visual_instructions if vi.target in successful_targets]
    cited_ids = ledger.cite_fact_kb_ids
    looked_up = ledger.lookup_kb_ids
    filtered_facts = [
        fc for fc in env.fact_checks
        if any(sid in cited_ids and sid in looked_up for sid in fc.source_ids)
    ]
    if valid_visuals == env.visual_instructions and filtered_facts == env.fact_checks:
        return env
    return env.model_copy(update={
        "visual_instructions": valid_visuals,
        "fact_checks": filtered_facts,
    })


def _summarise_calls(calls: list[ToolCallRecord]) -> list[dict[str, Any]]:
    """Per-turn compact tool-calls summary for history."""
    out = []
    for c in calls:
        out.append({"name": c.name, "args": c.args, "ok": c.ok})
    return out


def run_agent(
    inbound: TutorRequest | dict[str, Any],
    *,
    store: SessionStore | None = None,
    llm_call=None,  # injection for tests
) -> AgentResult:
    """Run the agent loop end-to-end.

    1. Load or create the session.
    2. Build initial messages (system + slim user).
    3. Up to MAX_ITERS times: call the model, dispatch any tool_calls,
       feed results back. On a final assistant message, run the
       post-validator.
    4. If the validator rejects: re-invoke once with a corrective message,
       then fall back if it rejects again.
    5. Persist updated session state. Return the assembled envelope.
    """
    if isinstance(inbound, dict):
        inbound = TutorRequest.model_validate(inbound)

    if store is None:
        store = get_default_store()
    if llm_call is None:
        llm_call = _llm.call_model

    session = store.get_or_create(inbound.session_id, active_task=inbound.current_task)
    ctx = ExecutionContext(
        session=session,
        circuit_state=inbound.circuit_state,
        sim_result=inbound.sim_result,
        check_request=(
            inbound.check_request.model_dump(exclude_none=True)
            if inbound.check_request else None
        ),
    )

    tools_spec = build_tools_spec()
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": SYSTEM_PROMPT},
    ]

    # Inject the rolling summary + last few turns so the model has continuity.
    # `session.history` is appended to at the end of every prior `run_agent`
    # call (see `store.append_history(...)` below), capped at _HISTORY_LIMIT
    # turns by `session_store.append_history`.
    if session.rolling_summary:
        messages.append({
            "role": "system",
            "content": f"Rolling summary of prior turns: {session.rolling_summary}",
        })
    if session.next_step:
        messages.append({
            "role": "system",
            "content": f"Next pedagogical step recorded last turn: {session.next_step}",
        })
    for turn in session.history:
        if turn.role == "student":
            messages.append({"role": "user", "content": turn.content})
        elif turn.role in ("assistant", "tutor"):
            messages.append({"role": "assistant", "content": turn.content})

    messages.append(build_first_user_message(inbound))

    has_check = inbound.check_request is not None
    validator_inbound = ValidatorInbound(has_check_request=has_check)
    already_re_invoked = False
    payload_char_count = sum(len(_json.dumps(m, ensure_ascii=False)) for m in messages)
    iterations_used = 0
    final_envelope: TutorReplyEnvelope | None = None
    decision_label = "Pending"

    for iter_idx in range(MAX_ITERS):
        iterations_used = iter_idx + 1
        # `tool_choice = "auto"` throughout: the post-validator enforces the
        # tool-call requirement for non-ack replies, so we don't need the API
        # to force a tool. Forcing one would push pure-pleasantry turns
        # (greetings, thanks) into a spurious `refuse` call.
        tool_choice = "auto"

        response: ModelResponse = llm_call(
            messages,
            tools_spec,
            tool_choice=tool_choice,
        )

        if response.tool_calls:
            # Append the model's tool_call turn so OpenAI's API stays happy.
            messages.append(make_assistant_tool_call_message(response.tool_calls))
            for tc in response.tool_calls:
                rec = dispatch(tc, ctx)
                messages.append(make_tool_message(tc, rec.result))
            continue

        # No tool_calls this turn — this should be the final reply.
        parsed = _parse_envelope(response.content)
        if isinstance(parsed, Reject):
            decision = parsed
        else:
            envelope = _rebuild_envelope_from_ledger(parsed, Ledger(calls=ctx.call_records))
            decision = validate_final_reply(
                envelope,
                Ledger(calls=ctx.call_records),
                validator_inbound,
            )

        if isinstance(decision, Accept):
            final_envelope = decision.envelope
            decision_label = "Accept"
            break

        # Reject: corrective re-invoke once.
        if not already_re_invoked:
            messages.append(build_corrective_message(decision.reason, decision.detail))
            already_re_invoked = True
            continue

        # Second rejection → safe fallback.
        final_envelope = _safe_fallback_envelope(decision.reason, decision.detail)
        decision_label = f"Reject({decision.reason})"
        break

    if final_envelope is None:
        # Iter cap exhausted with no Accept.
        final_envelope = _safe_fallback_envelope("iter_cap_exhausted", "")
        decision_label = "Reject(iter_cap_exhausted)"

    # Persist a compact history entry so subsequent turns see context.
    store.append_history(
        inbound.session_id,
        role="student",
        content=inbound.student_message,
    )
    store.append_history(
        inbound.session_id,
        role="assistant",
        content=final_envelope.assistant_text,
        tool_calls_summary=_summarise_calls(ctx.call_records),
    )
    state_summary = final_envelope.state_summary
    update_kwargs: dict[str, Any] = {}
    if state_summary.observed_misconceptions:
        update_kwargs["observed_misconceptions"] = state_summary.observed_misconceptions
    if final_envelope.rolling_summary:
        update_kwargs["rolling_summary"] = final_envelope.rolling_summary
    if state_summary.next_step:
        update_kwargs["next_step"] = state_summary.next_step
    if update_kwargs:
        store.update(inbound.session_id, **update_kwargs)

    # Pull the analysis (if any) out of the ledger for the response envelope.
    analysis_dict: dict[str, Any] | None = None
    for c in ctx.call_records:
        if c.name == "analyse_topology" and c.ok:
            analysis_dict = c.result.get("analysis")
            break

    payload_char_count += sum(
        len(_json.dumps(m, ensure_ascii=False)) for m in messages[2:]
    )

    return AgentResult(
        envelope=final_envelope,
        ledger=Ledger(calls=ctx.call_records),
        analysis=analysis_dict,
        payload_char_count=payload_char_count,
        loop_iterations=iterations_used,
        validator_decision=decision_label,
        redundant_calls=ctx.redundant_calls,
    )
