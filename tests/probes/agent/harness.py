"""Probe harness — runs probes in-process by calling run_agent() directly.

Two run modes:
- `stub`  : the probe carries a scripted ledger (list of tool-call specs +
            final envelope JSON). Used for harness self-tests; cost-free,
            does not exercise the prompt.
- `real`  : sets the LLM to real OpenAI calls. Used for actual prompt
            evaluation. Requires OPENAI_API_KEY.

The probes themselves are mode-agnostic — they declare *what* the ledger
must look like; the harness arranges *how* the ledger gets produced.

The user-facing ergonomic constraint: no web app, no Node, no HTTP layer —
everything runs in a single Python process. See probes.py for the probe
definitions, fixtures.py for canned circuits, run.py for the CLI.
"""

from __future__ import annotations

import json
import os
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Iterable, Literal

# Make the api/ directory importable.
_API_DIR = Path(__file__).resolve().parents[3] / "api"
if str(_API_DIR) not in sys.path:
    sys.path.insert(0, str(_API_DIR))

from agent_runner import AgentResult, run_agent  # noqa: E402
from llm_client import ModelResponse, ToolCall  # noqa: E402
from schemas import CheckRequest, CurrentTask, TutorRequest  # noqa: E402
from session_store import SessionStore  # noqa: E402


RunMode = Literal["stub", "real"]


# ---------------------------------------------------------------------------
# Probe definition
# ---------------------------------------------------------------------------

@dataclass
class ProbeSetup:
    circuit: dict[str, Any] = field(default_factory=dict)
    sim: dict[str, Any] = field(default_factory=lambda: {"meters": {}})
    current_task: dict[str, Any] | None = None
    check_request: dict[str, Any] | None = None
    session_id: str = "probe-session"


@dataclass
class ProbeExpectations:
    """Assertion DSL — every field is optional; only the present ones run.

    Each field maps to a check that the harness applies against the
    AgentResult / ledger. See _evaluate() below for the dispatch.
    """
    tools_called_exactly: list[str] | None = None
    tools_called_in_order: list[str] | None = None
    tool_args_match: dict[str, dict[str, Any]] | None = None
    cite_fact_kb_id_in: list[str] | None = None
    mark_target_id: str | None = None
    refuse_args_match: dict[str, Any] | None = None
    assistant_text_canonical_refusal: bool | None = None
    follow_up_question_nonempty: bool | None = None
    payload_char_count_below: int | None = None
    validator_decision: str | None = None  # "Accept" or specific Reject reason


@dataclass
class Probe:
    id: str
    description: str
    message: str
    setup: ProbeSetup
    expect: ProbeExpectations
    # When run mode is "stub", the probe must carry the scripted LLM behaviour.
    stub_script: list[list[dict] | str] | None = None


# ---------------------------------------------------------------------------
# Probe execution
# ---------------------------------------------------------------------------

@dataclass
class AssertionFailure:
    name: str
    detail: str


@dataclass
class ProbeResult:
    probe: Probe
    agent_result: AgentResult | None
    failures: list[AssertionFailure] = field(default_factory=list)
    skipped_reason: str | None = None
    error: str | None = None

    @property
    def status(self) -> Literal["pass", "fail", "skipped", "error"]:
        if self.skipped_reason:
            return "skipped"
        if self.error:
            return "error"
        return "fail" if self.failures else "pass"


def _make_request(probe: Probe) -> TutorRequest:
    setup = probe.setup
    return TutorRequest(
        student_message=probe.message,
        session_id=setup.session_id,
        current_task=(
            CurrentTask.model_validate(setup.current_task)
            if setup.current_task else None
        ),
        check_request=(
            CheckRequest.model_validate(setup.check_request)
            if setup.check_request else None
        ),
        circuit_state=setup.circuit,
        sim_result=setup.sim,
    )


def _stub_llm(script: list[list[dict] | str]) -> Callable:
    """Build a deterministic llm_call that pops scripted responses."""
    queue = list(script)

    def _call(messages, tools, *, tool_choice="auto", model=None, response_format=None):
        if not queue:
            raise AssertionError("stub LLM ran out of scripted responses")
        nxt = queue.pop(0)
        if isinstance(nxt, str):
            return ModelResponse(content=nxt, tool_calls=[], finish_reason="stop")
        tcs = [
            ToolCall(id=f"call_{i}", name=spec["name"], arguments=spec.get("arguments", {}))
            for i, spec in enumerate(nxt)
        ]
        return ModelResponse(content=None, tool_calls=tcs, finish_reason="tool_calls")

    return _call


def run_probe(probe: Probe, *, mode: RunMode) -> ProbeResult:
    """Execute one probe and return a ProbeResult with assertion outcomes."""
    if mode == "real":
        if not os.environ.get("OPENAI_API_KEY"):
            return ProbeResult(probe, None, skipped_reason="OPENAI_API_KEY not set")
        llm_call = None  # let run_agent default to the real client
    else:
        if probe.stub_script is None:
            return ProbeResult(
                probe,
                None,
                skipped_reason="probe has no stub_script — set PROBE_LLM_MODE=real to exercise this probe",
            )
        llm_call = _stub_llm(probe.stub_script)

    try:
        request = _make_request(probe)
        result = run_agent(request, store=SessionStore(), llm_call=llm_call)
    except Exception as exc:  # noqa: BLE001
        return ProbeResult(probe, None, error=f"{type(exc).__name__}: {exc}")

    failures = _check_expectations(probe.expect, result)
    return ProbeResult(probe, result, failures=failures)


# ---------------------------------------------------------------------------
# Assertion DSL implementation
# ---------------------------------------------------------------------------

CANONICAL_REFUSAL_PREFIX = "I am only here to teach you about circuits."


def _check_expectations(exp: ProbeExpectations, result: AgentResult) -> list[AssertionFailure]:
    out: list[AssertionFailure] = []
    ledger_names = [c.name for c in result.ledger.calls]
    ledger_set = set(ledger_names)

    if exp.tools_called_exactly is not None:
        expected = set(exp.tools_called_exactly)
        if ledger_set != expected:
            out.append(AssertionFailure(
                "tools_called_exactly",
                f"expected {sorted(expected)}, got {sorted(ledger_set)}",
            ))

    if exp.tools_called_in_order is not None:
        if not _is_subsequence(exp.tools_called_in_order, ledger_names):
            out.append(AssertionFailure(
                "tools_called_in_order",
                f"expected subsequence {exp.tools_called_in_order}, got {ledger_names}",
            ))

    if exp.tool_args_match:
        for tool_name, partial in exp.tool_args_match.items():
            calls = [c for c in result.ledger.calls if c.name == tool_name]
            if not calls:
                out.append(AssertionFailure(
                    "tool_args_match",
                    f"no call to {tool_name!r} in ledger",
                ))
                continue
            first = calls[0]
            if not _partial_match(partial, first.args):
                out.append(AssertionFailure(
                    "tool_args_match",
                    f"{tool_name} args expected ⊇ {partial}, got {first.args}",
                ))

    if exp.cite_fact_kb_id_in is not None:
        cite_calls = [c for c in result.ledger.calls if c.name == "cite_fact"]
        if not cite_calls:
            out.append(AssertionFailure(
                "cite_fact_kb_id_in",
                f"no cite_fact call; expected one with kb_id in {exp.cite_fact_kb_id_in}",
            ))
        else:
            allowed = set(exp.cite_fact_kb_id_in)
            for c in cite_calls:
                kid = (c.args or {}).get("kb_id")
                if kid not in allowed:
                    out.append(AssertionFailure(
                        "cite_fact_kb_id_in",
                        f"cite_fact kb_id={kid!r} not in allowed set {sorted(allowed)}",
                    ))

    if exp.mark_target_id is not None:
        marks = [c for c in result.ledger.calls if c.name == "mark_target"]
        targets = {(c.args or {}).get("target") for c in marks}
        if exp.mark_target_id not in targets:
            out.append(AssertionFailure(
                "mark_target_id",
                f"expected mark_target with target={exp.mark_target_id!r}, got targets {sorted(t for t in targets if t)}",
            ))

    if exp.refuse_args_match is not None:
        refuses = [c for c in result.ledger.calls if c.name == "refuse"]
        if not refuses:
            out.append(AssertionFailure(
                "refuse_args_match",
                "no refuse call in ledger",
            ))
        elif not _partial_match(exp.refuse_args_match, refuses[0].args):
            out.append(AssertionFailure(
                "refuse_args_match",
                f"refuse args expected ⊇ {exp.refuse_args_match}, got {refuses[0].args}",
            ))

    if exp.assistant_text_canonical_refusal:
        text = result.envelope.assistant_text
        if not text.startswith(CANONICAL_REFUSAL_PREFIX):
            out.append(AssertionFailure(
                "assistant_text_canonical_refusal",
                f"assistant_text does not start with the canonical refusal: {text!r}",
            ))

    if exp.follow_up_question_nonempty:
        if not result.envelope.follow_up_question.strip():
            out.append(AssertionFailure(
                "follow_up_question_nonempty",
                "follow_up_question is empty",
            ))

    if exp.payload_char_count_below is not None:
        if result.payload_char_count >= exp.payload_char_count_below:
            out.append(AssertionFailure(
                "payload_char_count_below",
                f"payload was {result.payload_char_count} chars, threshold {exp.payload_char_count_below}",
            ))

    if exp.validator_decision is not None:
        if result.validator_decision != exp.validator_decision:
            out.append(AssertionFailure(
                "validator_decision",
                f"expected {exp.validator_decision!r}, got {result.validator_decision!r}",
            ))

    return out


def _is_subsequence(needle: list[str], haystack: list[str]) -> bool:
    it = iter(haystack)
    return all(any(x == n for x in it) for n in needle)


def _partial_match(partial: dict[str, Any], actual: dict[str, Any]) -> bool:
    """Recursively check `partial` is a subset of `actual`."""
    for k, v in partial.items():
        if k not in actual:
            return False
        if isinstance(v, dict) and isinstance(actual[k], dict):
            if not _partial_match(v, actual[k]):
                return False
        elif v != actual[k]:
            return False
    return True


# ---------------------------------------------------------------------------
# Suite runner
# ---------------------------------------------------------------------------

@dataclass
class SuiteReport:
    results: list[ProbeResult]

    @property
    def summary(self) -> dict[str, int]:
        out = {"pass": 0, "fail": 0, "skipped": 0, "error": 0}
        for r in self.results:
            out[r.status] += 1
        return out

    def to_markdown(self) -> str:
        lines = ["# Agent probe-suite baseline report", ""]
        s = self.summary
        lines.append(
            f"**Pass:** {s['pass']} · **Fail:** {s['fail']} · "
            f"**Skipped:** {s['skipped']} · **Error:** {s['error']}"
        )
        lines.append("")
        lines.append("| Probe | Status | Notes |")
        lines.append("|---|---|---|")
        for r in self.results:
            note = ""
            if r.skipped_reason:
                note = r.skipped_reason
            elif r.error:
                note = r.error
            elif r.failures:
                note = "; ".join(f"{f.name}: {f.detail}" for f in r.failures)
            else:
                note = (
                    f"validator={r.agent_result.validator_decision}, "
                    f"iters={r.agent_result.loop_iterations}, "
                    f"tools={[c.name for c in r.agent_result.ledger.calls]}"
                ) if r.agent_result else ""
            lines.append(f"| `{r.probe.id}` | {r.status} | {note} |")
        return "\n".join(lines) + "\n"


def run_suite(probes: Iterable[Probe], mode: RunMode = "stub") -> SuiteReport:
    return SuiteReport(results=[run_probe(p, mode=mode) for p in probes])
