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
