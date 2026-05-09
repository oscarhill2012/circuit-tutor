"""Unit tests for the validator at api/agent_runner.py.

One test per Reject branch + a happy-path Accept. Constructs minimal
Ledger / Envelope / ValidatorInbound fixtures by hand so a failure
points at exactly one invariant.
"""

import pytest

from agent_runner import (
    Accept,
    Reject,
    Ledger,
    ValidatorInbound,
    validate_final_reply,
)
from schemas import (
    SafetyBlock,
    StateSummary,
    ToolCallRecord,
    TutorReplyEnvelope,
    VisualInstruction,
)


def _envelope(**overrides) -> TutorReplyEnvelope:
    """Minimal valid envelope; override fields per test."""
    base = dict(
        reply_type="teaching",
        assistant_text="Try checking the bulb's terminals.",
        follow_up_question="",
        verdict="",
        visual_instructions=[],
        safety=SafetyBlock(in_scope=True, reason=""),
        fact_checks=[],
        state_summary=StateSummary(),
        rolling_summary="",
    )
    base.update(overrides)
    return TutorReplyEnvelope(**base)


def _call(name, args=None, result=None, ok=True) -> ToolCallRecord:
    """Build a ToolCallRecord — schemas.py:306 defines the actual shape."""
    return ToolCallRecord(name=name, args=args or {}, result=result or {}, ok=ok)


# ---- ack / no-tool branch ------------------------------------------------

def test_ack_with_empty_ledger_is_accepted():
    env = _envelope(reply_type="ack", assistant_text="Hi! Glad you're here.")
    decision = validate_final_reply(env, Ledger(calls=[]), ValidatorInbound(has_check_request=False))
    assert isinstance(decision, Accept)


def test_no_tools_called_rejects_non_ack():
    env = _envelope(reply_type="teaching", assistant_text="Try this.")
    decision = validate_final_reply(env, Ledger(calls=[]), ValidatorInbound(has_check_request=False))
    assert isinstance(decision, Reject)
    assert decision.reason == "no_tools_called"


def test_ack_with_long_text_rejects():
    env = _envelope(reply_type="ack", assistant_text="A" * 200)
    decision = validate_final_reply(env, Ledger(calls=[]), ValidatorInbound(has_check_request=False))
    assert isinstance(decision, Reject)
    assert decision.reason == "ack_text_not_pleasantry"


def test_ack_with_question_rejects():
    env = _envelope(reply_type="ack", assistant_text="Hi! What is voltage?")
    decision = validate_final_reply(env, Ledger(calls=[]), ValidatorInbound(has_check_request=False))
    assert isinstance(decision, Reject)
    assert decision.reason == "ack_text_not_pleasantry"


def test_ack_with_pleasantry_keyword_accepts():
    env = _envelope(reply_type="ack", assistant_text="Hi! Glad you're here.")
    decision = validate_final_reply(env, Ledger(calls=[]), ValidatorInbound(has_check_request=False))
    assert isinstance(decision, Accept)


def test_ack_with_no_keyword_rejects():
    # Off-topic prose without any pleasantry keyword: shape rule rejects.
    env = _envelope(
        reply_type="ack",
        assistant_text="Paris is the capital of France and has many museums.",
    )
    decision = validate_final_reply(env, Ledger(calls=[]), ValidatorInbound(has_check_request=False))
    assert isinstance(decision, Reject)
    assert decision.reason == "ack_text_not_pleasantry"


# ---- refusal branches ----------------------------------------------------

def test_refusal_with_other_tools_rejects():
    env = _envelope(reply_type="refusal", assistant_text="(any text)")
    ledger = Ledger(calls=[_call("refuse"), _call("lookup_knowledge")])
    decision = validate_final_reply(env, ledger, ValidatorInbound(has_check_request=False))
    assert isinstance(decision, Reject)
    assert decision.reason == "refusal_with_other_tools"


def test_refusal_text_must_match_rendered():
    rendered = "I am only here to teach you about circuits."
    env = _envelope(reply_type="refusal", assistant_text="Sorry, I can't help with that.")
    ledger = Ledger(calls=[_call("refuse", result={"rendered": rendered})])
    decision = validate_final_reply(env, ledger, ValidatorInbound(has_check_request=False))
    assert isinstance(decision, Reject)
    assert decision.reason == "refusal_text_mismatch"


def test_refusal_with_matching_text_accepts():
    rendered = "I am only here to teach you about circuits."
    env = _envelope(reply_type="refusal", assistant_text=rendered)
    ledger = Ledger(calls=[_call("refuse", result={"rendered": rendered})])
    decision = validate_final_reply(env, ledger, ValidatorInbound(has_check_request=False))
    assert isinstance(decision, Accept)


# ---- claim grounding -----------------------------------------------------

def test_uncited_physics_claim_rejects():
    env = _envelope(assistant_text="Voltage equals current times resistance, V=IR.")
    ledger = Ledger(calls=[_call("inspect_circuit")])  # tool called but no cite_fact
    decision = validate_final_reply(env, ledger, ValidatorInbound(has_check_request=False))
    assert isinstance(decision, Reject)
    assert decision.reason == "uncited_physics_claim"


def test_cite_without_lookup_rejects():
    env = _envelope(assistant_text="Voltage equals current times resistance, V=IR.")
    ledger = Ledger(calls=[
        _call("cite_fact", args={"kb_id": "kb.ohms_law"}, result={"ok": True}),
        # NB: no lookup_knowledge call for kb.ohms_law
    ])
    decision = validate_final_reply(env, ledger, ValidatorInbound(has_check_request=False))
    assert isinstance(decision, Reject)
    assert decision.reason == "cite_without_lookup"


# ---- visual target allow-list -------------------------------------------

def test_unauthorised_visual_target_rejects():
    env = _envelope(
        visual_instructions=[VisualInstruction(target="C1", action="highlight")],
    )
    ledger = Ledger(calls=[_call("inspect_circuit")])  # no mark_target call
    decision = validate_final_reply(env, ledger, ValidatorInbound(has_check_request=False))
    assert isinstance(decision, Reject)
    assert decision.reason == "unauthorised_visual_target"


# ---- verdict turns ------------------------------------------------------

def test_verdict_without_validate_rejects():
    env = _envelope(verdict="pass")
    ledger = Ledger(calls=[_call("inspect_circuit")])
    decision = validate_final_reply(env, ledger, ValidatorInbound(has_check_request=True))
    assert isinstance(decision, Reject)
    assert decision.reason == "verdict_without_validate"


def test_verdict_mismatch_rejects():
    env = _envelope(verdict="pass")
    ledger = Ledger(calls=[
        _call("validate_task", result={"verdict": "fail"}),
    ])
    decision = validate_final_reply(env, ledger, ValidatorInbound(has_check_request=True))
    assert isinstance(decision, Reject)
    assert decision.reason == "verdict_mismatch"
