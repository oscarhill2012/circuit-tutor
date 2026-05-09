"""Verify the agent loop injects prior-turn history into the next turn.

The architecture doc claims server-side memory: `session_store` records every
student/assistant turn, and the next turn's prompt is supposed to receive that
history so the model has continuity. This test pins down that contract by
running two `run_agent` calls with the same `session_id` and asserting that
turn 2's `messages` array fed to the LLM contains turn 1's student utterance.

Companion to api/agent_runner.py:run_agent and api/session_store.py.
"""

import json

import pytest

from agent_runner import run_agent
from llm_client import ModelResponse
from schemas import TutorRequest
from session_store import SessionStore


def _ack_envelope_json(text: str = "Got it.") -> str:
    """Build a minimal envelope JSON string the agent loop will Accept.

    `reply_type="ack"` with an empty ledger is the one branch that passes
    `validate_final_reply` without any tool calls — see
    tests/api/test_validate_final_reply.py::test_ack_with_empty_ledger_is_accepted.
    """
    return json.dumps({
        "reply_type": "ack",
        "assistant_text": text,
        "follow_up_question": "",
        "verdict": "",
        "visual_instructions": [],
        "safety": {"in_scope": True, "reason": ""},
        "fact_checks": [],
        "state_summary": {
            "current_goal": "",
            "observed_misconceptions": [],
            "next_step": "",
        },
        "rolling_summary": "",
    })


class CapturingStub:
    """Stub `call_model` that records every `messages` argument it sees.

    Returns a fixed ack envelope so `run_agent` always reaches Accept on the
    first iteration (no tool calls, no corrective re-invoke).
    """

    def __init__(self):
        self.calls: list[list[dict]] = []

    def __call__(self, messages, tools, *, tool_choice="auto", **_kwargs):
        # Snapshot the messages list — `run_agent` mutates it across iterations
        # via `.append(...)`, so we copy here to capture the state at call time.
        self.calls.append(list(messages))
        return ModelResponse(
            content=_ack_envelope_json(),
            tool_calls=[],
            finish_reason="stop",
        )


def _request(session_id: str, message: str) -> TutorRequest:
    """Build a minimal valid TutorRequest for the given session + utterance."""
    return TutorRequest(
        student_message=message,
        session_id=session_id,
        circuit_state={},
        sim_result={},
    )


def test_turn_two_messages_include_turn_one_student_utterance():
    """Two-turn run on the same session_id must surface turn 1's user message
    inside turn 2's prompt. Otherwise server-side history is dead weight."""

    store = SessionStore()
    stub = CapturingStub()
    session_id = "history-injection-test"

    # Turn 1
    run_agent(_request(session_id, "What is voltage?"), store=store, llm_call=stub)
    # Turn 2
    run_agent(_request(session_id, "And current?"), store=store, llm_call=stub)

    # `stub.calls` is a list of message-lists, one per LLM invocation. With ack
    # envelopes there's exactly one invocation per `run_agent` call, so:
    #   stub.calls[0] = turn 1's messages
    #   stub.calls[1] = turn 2's messages
    assert len(stub.calls) >= 2, f"expected >=2 LLM calls, got {len(stub.calls)}"

    turn_two_messages = stub.calls[1]
    serialised = json.dumps(turn_two_messages, default=str)

    assert "What is voltage?" in serialised, (
        "turn 2 messages did not include turn 1 student utterance — "
        "session history is being dropped. messages were:\n"
        + json.dumps(turn_two_messages, indent=2, default=str)
    )


def test_rolling_summary_is_injected_when_set():
    """If the session has a rolling_summary, it must appear in the prompt so
    the model gets condensed prior context even when raw history is short."""

    store = SessionStore()
    stub = CapturingStub()
    session_id = "rolling-summary-test"

    # Seed the session with a rolling summary as if a prior turn produced one.
    store.update(session_id, rolling_summary="Student is exploring Ohm's law.")

    run_agent(_request(session_id, "What's next?"), store=store, llm_call=stub)

    serialised = json.dumps(stub.calls[0], default=str)
    assert "Student is exploring Ohm's law." in serialised, (
        "rolling_summary was not injected into the LLM messages list"
    )


def test_session_store_persists_next_step():
    """`session_store.update(next_step=...)` must actually set
    `SessionState.next_step` — previously it was a no-op."""

    store = SessionStore()
    state = store.update("next-step-test", next_step="ask the student to wire V1 across L1")
    assert state.next_step == "ask the student to wire V1 across L1"


# ---------------------------------------------------------------------------
# Fix 1 regression: update_session_state tool must write to session object
# ---------------------------------------------------------------------------

def test_update_session_state_tool_sets_next_step_on_session():
    """update_session_state must write next_step to the session object, not
    just record it in the audit dict.

    Covers the regression where `session.next_step = args.next_step` was
    missing — the tool returned applied["next_step"] but the session was
    never mutated, so history never persisted the value.
    """
    from schemas import SessionState, UpdateSessionStateArgs
    from tools import update_session_state

    session = SessionState(session_id="tool-next-step-test")
    args = UpdateSessionStateArgs(next_step="ask about parallel circuits")

    result = update_session_state(args, session=session)

    assert result.ok, f"tool returned not-ok: {result.rejected}"
    assert result.applied.get("next_step") == "ask about parallel circuits"
    assert session.next_step == "ask about parallel circuits", (
        "update_session_state did not mutate session.next_step — "
        "the write to session was missing"
    )


# ---------------------------------------------------------------------------
# Fix 2 regression: run_agent must persist next_step + rolling_summary
# ---------------------------------------------------------------------------

def _envelope_with_state_json(next_step: str, rolling_summary: str) -> str:
    """Build an ack envelope JSON that carries a non-empty next_step and
    rolling_summary so the agent-loop persist path is exercised."""
    return json.dumps({
        "reply_type": "ack",
        "assistant_text": "Got it.",
        "follow_up_question": "",
        "verdict": "",
        "visual_instructions": [],
        "safety": {"in_scope": True, "reason": ""},
        "fact_checks": [],
        "state_summary": {
            "current_goal": "",
            "observed_misconceptions": [],
            "next_step": next_step,
        },
        "rolling_summary": rolling_summary,
    })


class StatefulStub:
    """Stub `call_model` that returns a single fixed envelope carrying
    state fields so the agent-loop persist path in run_agent is exercised."""

    def __init__(self, next_step: str, rolling_summary: str) -> None:
        self._json = _envelope_with_state_json(next_step, rolling_summary)

    def __call__(self, messages, tools, *, tool_choice="auto", **_kwargs):
        return ModelResponse(
            content=self._json,
            tool_calls=[],
            finish_reason="stop",
        )


def test_run_agent_persists_next_step_and_rolling_summary():
    """After run_agent completes, the session store must contain the
    next_step and rolling_summary values that were in the final envelope.

    Covers the regression where agent_runner.py only persisted
    observed_misconceptions and left the other two fields as dead reads.
    """
    store = SessionStore()
    session_id = "agent-persist-state-test"
    stub = StatefulStub(
        next_step="ask about parallel circuits",
        rolling_summary="student is exploring series circuits",
    )

    run_agent(_request(session_id, "How do I wire two bulbs?"), store=store, llm_call=stub)

    state = store.get_or_create(session_id)
    assert state.next_step == "ask about parallel circuits", (
        "run_agent did not persist next_step from the envelope's state_summary"
    )
    assert state.rolling_summary == "student is exploring series circuits", (
        "run_agent did not persist rolling_summary from the envelope"
    )
