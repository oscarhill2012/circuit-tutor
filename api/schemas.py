"""Pydantic models — single source of truth for the tutor agent contract.

Imported by tools.py, agent_runner.py, tool_dispatch.py, and the post-validator.
The reply envelope mirrors the field set the client consumes in
frontend/ui/tutorPanel.js.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


# ---------------------------------------------------------------------------
# Common closed-set vocab
# ---------------------------------------------------------------------------

ReplyType = Literal["teaching", "refusal", "verdict", "ack"]

VisualAction = Literal[
    "highlight", "dim", "glow", "pulse", "mark_error", "mark_success",
]

RefuseReason = Literal["off_topic", "injection", "unsafe", "unsupported"]

RedirectKind = Literal["current_task", "current_focus", "none"]

VerdictValue = Literal["pass", "fail"]

KbRole = Literal["definition", "rule", "misconception", "hint_seed", "check"]


# ---------------------------------------------------------------------------
# Knowledge base entry
# ---------------------------------------------------------------------------

class KnowledgeEntry(BaseModel):
    """One row of knowledge_base.json."""

    model_config = ConfigDict(extra="ignore")

    id: str
    role: KbRole
    fact: str
    topic: str | None = None
    tags: list[str] = Field(default_factory=list)
    requires_citation: bool = False
    latex: str | None = None


# ---------------------------------------------------------------------------
# Group A — knowledge / truth
# ---------------------------------------------------------------------------

class LookupKnowledgeArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")
    query: str
    topic: str | None = None
    limit: int = Field(default=4, ge=1, le=8)


class LookupKnowledgeReturn(BaseModel):
    entries: list[KnowledgeEntry]


class CiteFactArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kb_id: str
    claim: str


class CiteFactReturn(BaseModel):
    ok: bool
    reason: str | None = None


# ---------------------------------------------------------------------------
# Group B — circuit oracle
# ---------------------------------------------------------------------------

class AnalyseTopologyArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")


class AnalyseTopologyReturn(BaseModel):
    """Wraps circuit_validator.analyse() output plus the suggested-focus hint.

    `analysis` is kept loose (Any) so the validator output can evolve without
    breaking schemas. The agent should treat `suggested_focus` as advisory, not authoritative.
    """

    model_config = ConfigDict(extra="ignore")

    analysis: dict[str, Any]
    suggested_focus: dict[str, Any] | None = None


InspectField = Literal["components", "wires", "meters", "readings", "props"]


class InspectCircuitArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")
    fields: list[InspectField]


class InspectCircuitReturn(BaseModel):
    model_config = ConfigDict(extra="allow")
    components: list[dict[str, Any]] | None = None
    wires: list[dict[str, Any]] | None = None
    meters: list[dict[str, Any]] | None = None
    readings: dict[str, Any] | None = None
    props: dict[str, Any] | None = None


class ReadMeterArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")
    meter_id: str


MeterStatus = Literal["live", "open", "short", "missing"]


class ReadMeterReturn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    value: float | None = None
    unit: Literal["A", "V"] | None = None
    status: MeterStatus


# ---------------------------------------------------------------------------
# Group C — pedagogy
# ---------------------------------------------------------------------------

class MarkTargetArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")
    target: str
    action: VisualAction


class MarkTargetReturn(BaseModel):
    ok: bool
    reason: str | None = None


class ValidateTaskArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ValidateTaskReturn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    topology_ok: bool
    reading_ok: bool | None = None
    simulated_reading: float | None = None
    expected_reading: float | None = None
    fix_hint: str | None = None
    verdict: VerdictValue


class Redirect(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: RedirectKind = "none"


class RefuseArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reason: RefuseReason
    redirect: Redirect | None = None


class RefuseReturn(BaseModel):
    rendered: str


class UpdateSessionStateArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")
    current_goal: str | None = None
    next_step: str | None = None
    observed_misconceptions: list[str] | None = None


class UpdateSessionStateReturn(BaseModel):
    ok: bool
    applied: dict[str, Any]
    rejected: dict[str, Any]


# ---------------------------------------------------------------------------
# Final reply envelope (mirrors what tutorPanel.appendTutorMsg already eats)
# ---------------------------------------------------------------------------

class VisualInstruction(BaseModel):
    model_config = ConfigDict(extra="forbid")
    target: str
    action: VisualAction


class SafetyBlock(BaseModel):
    model_config = ConfigDict(extra="forbid")
    in_scope: bool = True
    reason: str = ""


class FactCheck(BaseModel):
    model_config = ConfigDict(extra="forbid")
    claim: str
    source_ids: list[str] = Field(default_factory=list)


class StateSummary(BaseModel):
    model_config = ConfigDict(extra="forbid")
    current_goal: str = ""
    observed_misconceptions: list[str] = Field(default_factory=list)
    next_step: str = ""


class TutorReplyEnvelope(BaseModel):
    """The shape returned to the client (under `reply` in the response body).

    Matches the legacy envelope so `appendTutorMsg(parsed)` does not change.
    The agent loop assembles this from the tool ledger after post-validation.
    """

    model_config = ConfigDict(extra="forbid")

    reply_type: ReplyType
    assistant_text: str
    follow_up_question: str = ""
    verdict: VerdictValue | Literal[""] = ""
    visual_instructions: list[VisualInstruction] = Field(default_factory=list)
    safety: SafetyBlock = Field(default_factory=SafetyBlock)
    fact_checks: list[FactCheck] = Field(default_factory=list)
    state_summary: StateSummary = Field(default_factory=StateSummary)
    rolling_summary: str = ""


# ---------------------------------------------------------------------------
# Inbound request from the client
# ---------------------------------------------------------------------------

class CheckRequest(BaseModel):
    """Verdict-mode payload (the student typed a meter reading + asked to check)."""

    model_config = ConfigDict(extra="ignore")
    claimed_reading: float | str | None = None
    reading_status: str | None = None
    simulated_reading: float | None = None
    target_unit: Literal["A", "V"] | None = None


class CurrentTask(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: str | None = None
    topic: str | None = None
    type: str | None = None
    difficulty: str | None = None
    data: dict[str, Any] | None = None


class TutorRequest(BaseModel):
    """Inbound request body for /api/tutor?v=2."""

    model_config = ConfigDict(extra="ignore")
    student_message: str
    selected: str | None = None
    current_task: CurrentTask | None = None
    session_id: str
    check_request: CheckRequest | None = None
    debug: bool = False
    circuit_state: dict[str, Any] = Field(default_factory=dict)
    sim_result: dict[str, Any] = Field(default_factory=dict)


# ---------------------------------------------------------------------------
# Session-state object (what session_store persists per session_id)
# ---------------------------------------------------------------------------

class HistoryTurn(BaseModel):
    """One turn in the rolling history (last 4 kept).

    Assistant turns retain a compact `tool_calls_summary` so the model can
    see "I used mark_error on V1 last turn" rather than just the prose.
    """

    model_config = ConfigDict(extra="forbid")
    role: Literal["student", "assistant", "tutor"]
    content: str
    tool_calls_summary: list[dict[str, Any]] = Field(default_factory=list)


class SessionState(BaseModel):
    model_config = ConfigDict(extra="forbid")
    session_id: str
    current_goal: str = ""
    observed_misconceptions: list[str] = Field(default_factory=list)
    last_fix_target_id: str | None = None
    history: list[HistoryTurn] = Field(default_factory=list)
    rolling_summary: str = ""
    active_task: CurrentTask | None = None


# ---------------------------------------------------------------------------
# Ledger entries — one record per tool call, populated by the agent loop per turn.
# ---------------------------------------------------------------------------

class ToolCallRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str
    args: dict[str, Any]
    result: dict[str, Any]
    ms: float = 0.0
    ok: bool = True
    error: str | None = None


# Names used by the agent loop, the dispatcher, the validator, and the
# probe harness — all keyed off this single tuple so a typo in one place
# fails loudly everywhere.
TOOL_NAMES: tuple[str, ...] = (
    "lookup_knowledge",
    "cite_fact",
    "analyse_topology",
    "inspect_circuit",
    "read_meter",
    "mark_target",
    "validate_task",
    "refuse",
    "update_session_state",
)
