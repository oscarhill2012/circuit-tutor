"""Pure-server tool implementations for the tutor agent.

Each tool takes a typed args model + an explicit context (session, circuit,
sim, KB, ledger), and returns a typed return model. Tools are deliberately
pure: no module-level state mutation, no globals beyond the loaded KB.

`tool_dispatch.py` routes tool-call names here; `agent_runner.py` runs the
loop. The post-validator reads the ledger these tools record, so the
args/return shapes are load-bearing.
"""

from __future__ import annotations

import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable

# Make sibling modules importable both when run as a script and when imported
# under pytest's collection (which adds the test file's directory).
sys.path.insert(0, str(Path(__file__).parent))

from refusal_render import render_refusal
from schemas import (
    AnalyseTopologyArgs,
    AnalyseTopologyReturn,
    CiteFactArgs,
    CiteFactReturn,
    CurrentTask,
    InspectCircuitArgs,
    InspectCircuitReturn,
    KnowledgeEntry,
    LookupKnowledgeArgs,
    LookupKnowledgeReturn,
    MarkTargetArgs,
    MarkTargetReturn,
    ReadMeterArgs,
    ReadMeterReturn,
    RefuseArgs,
    RefuseReturn,
    SessionState,
    UpdateSessionStateArgs,
    UpdateSessionStateReturn,
    ValidateTaskArgs,
    ValidateTaskReturn,
)


# ---------------------------------------------------------------------------
# Knowledge-base loader (shared across calls)
# ---------------------------------------------------------------------------

_KB_PATH = Path(__file__).parent / "knowledge_base.json"


def _load_kb() -> tuple[list[KnowledgeEntry], list[KnowledgeEntry]]:
    """Load knowledge_base.json into typed entries.

    Returns (pinned, entries). Unknown roles fall back to "rule"; unknown
    fields are dropped via `extra="ignore"` on the schema.
    """

    if not _KB_PATH.exists():
        return [], []
    raw = json.loads(_KB_PATH.read_text(encoding="utf-8"))
    pinned = [KnowledgeEntry.model_validate(e) for e in raw.get("pinned", []) if isinstance(e, dict)]
    entries = [KnowledgeEntry.model_validate(e) for e in raw.get("entries", []) if isinstance(e, dict)]
    return pinned, entries


_KB_PINNED, _KB_ENTRIES = _load_kb()
_KB_BY_ID: dict[str, KnowledgeEntry] = {e.id: e for e in (_KB_PINNED + _KB_ENTRIES)}
_KB_MISCONCEPTION_IDS: frozenset[str] = frozenset(
    e.id for e in (_KB_PINNED + _KB_ENTRIES) if e.role == "misconception"
)


# ---------------------------------------------------------------------------
# Embeddings sidecar — loaded best-effort at import. If the file is missing
# or malformed, the bag-of-words path stays the primary route.
# ---------------------------------------------------------------------------

_EMB_PATH = Path(__file__).parent / "knowledge_base.embeddings.json"
_EMB_VECTORS: dict[str, list[float]] = {}
_EMB_LOAD_WARNING: str | None = None


def _load_embeddings() -> tuple[dict[str, list[float]], str | None]:
    if not _EMB_PATH.exists():
        return {}, "embeddings sidecar missing — using bag-of-words"
    try:
        raw = json.loads(_EMB_PATH.read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001
        return {}, f"embeddings sidecar unreadable: {exc}"
    vecs: dict[str, list[float]] = {}
    for entry in raw.get("entries", []):
        if not isinstance(entry, dict):
            continue
        kid = entry.get("id")
        vec = entry.get("vector")
        if isinstance(kid, str) and isinstance(vec, list):
            vecs[kid] = [float(x) for x in vec]
    return vecs, None


_EMB_VECTORS, _EMB_LOAD_WARNING = _load_embeddings()


def all_kb_entries() -> list[KnowledgeEntry]:
    return list(_KB_PINNED) + list(_KB_ENTRIES)


def kb_by_id(kb_id: str) -> KnowledgeEntry | None:
    return _KB_BY_ID.get(kb_id)


# ---------------------------------------------------------------------------
# Lookup ledger (per-turn). Created once per request by the dispatcher
# so cite_fact() can validate against this turn's lookups.
# ---------------------------------------------------------------------------

@dataclass
class LookupLedger:
    """Per-turn record of which kb_ids have been retrieved by lookup_knowledge.

    The post-validator and cite_fact both consult this so the model cannot
    cite a fact it never retrieved.
    """

    looked_up: set[str] = field(default_factory=set)

    def record(self, ids: Iterable[str]) -> None:
        for kid in ids:
            if kid:
                self.looked_up.add(kid)

    def __contains__(self, kb_id: object) -> bool:
        return kb_id in self.looked_up


# ---------------------------------------------------------------------------
# Bag-of-words retrieval — fallback when the embeddings sidecar is unavailable.
# ---------------------------------------------------------------------------

_STOP_WORDS = frozenset((
    "the", "a", "an", "is", "it", "to", "of", "and", "or", "in", "on", "at",
    "for", "with", "how", "what", "why", "do", "does", "i", "my", "me", "can",
    "be", "as", "if", "this", "that", "are", "was", "were", "will", "would",
    "should", "could", "have", "has", "had", "not", "no", "yes", "but", "so",
    "you", "your", "we", "us", "they", "them", "their", "there", "here",
))
_TOKEN_RE = re.compile(r"[a-z0-9]+")


def _tokens(s: str) -> list[str]:
    if not s:
        return []
    return [
        t for t in _TOKEN_RE.findall(s.lower())
        if len(t) > 1 and t not in _STOP_WORDS
    ]


def _entry_haystack(entry: KnowledgeEntry) -> set[str]:
    hay: set[str] = set(_tokens(entry.fact))
    for tag in entry.tags:
        hay.add(str(tag).lower())
    if entry.topic:
        hay.add(str(entry.topic).lower())
    return hay


def embeddings_available() -> bool:
    return bool(_EMB_VECTORS)


def embeddings_warning() -> str | None:
    return _EMB_LOAD_WARNING


def _embed_query(query: str) -> list[float] | None:
    """Embed a single query via openai. Returns None on any failure so the
    caller can fall back to bag-of-words.

    Cached per-process via a small LRU keyed on (query, topic-as-prefix);
    repeated lookups in a session do not re-embed.
    """
    return _embed_query_cached(query)


def _embed_query_cached(query: str) -> list[float] | None:
    if query in _EMB_QUERY_CACHE:
        return _EMB_QUERY_CACHE[query]
    try:
        # Lazy import — keeps tools.py import time low when openai is missing.
        from openai import OpenAI  # type: ignore[import-not-found]
        import os
        api_key = os.environ.get("OPENAI_API_KEY")
        if not api_key:
            return None
        client = OpenAI(api_key=api_key)
        resp = client.embeddings.create(
            model=os.environ.get("OPENAI_EMBED_MODEL", "text-embedding-3-small"),
            input=query,
        )
        vec = list(resp.data[0].embedding)
    except Exception:  # noqa: BLE001 — fall back gracefully
        return None
    if len(_EMB_QUERY_CACHE) >= _EMB_QUERY_CACHE_CAP:
        _EMB_QUERY_CACHE.pop(next(iter(_EMB_QUERY_CACHE)))
    _EMB_QUERY_CACHE[query] = vec
    return vec


_EMB_QUERY_CACHE: dict[str, list[float]] = {}
_EMB_QUERY_CACHE_CAP = 256


def _cosine(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = 0.0
    na = 0.0
    nb = 0.0
    for x, y in zip(a, b):
        dot += x * y
        na += x * x
        nb += y * y
    if na == 0.0 or nb == 0.0:
        return 0.0
    return dot / (na ** 0.5 * nb ** 0.5)


def _embedding_retrieve(
    query: str,
    topic: str | None,
    limit: int,
) -> list[KnowledgeEntry] | None:
    """Cosine top-k against the sidecar. Returns None on any embedding failure
    so the caller can fall back to bag-of-words.
    """
    if not _EMB_VECTORS:
        return None
    if not query and not topic:
        return []
    qvec = _embed_query(query or topic or "")
    if qvec is None:
        return None

    scored: list[tuple[float, KnowledgeEntry]] = []
    topic_lc = (topic or "").lower()
    for entry in _KB_ENTRIES:
        vec = _EMB_VECTORS.get(entry.id)
        if vec is None:
            continue
        score = _cosine(qvec, vec)
        if topic_lc and (entry.topic or "").lower() == topic_lc:
            # Small topic boost so explicit topic hints rank correctly.
            score += 0.05
        scored.append((score, entry))
    if not scored:
        return None
    scored.sort(key=lambda s: s[0], reverse=True)
    return [e for _, e in scored[:limit]]


def _bag_of_words_retrieve(
    query: str,
    topic: str | None,
    limit: int,
) -> list[KnowledgeEntry]:
    if not query and not topic:
        return []
    q_tokens = set(_tokens(query))
    topic_lc = str(topic).lower() if topic else ""
    if topic_lc:
        q_tokens.add(topic_lc)

    scored: list[tuple[int, KnowledgeEntry]] = []
    for entry in _KB_ENTRIES:
        hay = _entry_haystack(entry)
        score = sum(1 for t in q_tokens if t in hay) if q_tokens else 0
        if topic_lc and (entry.topic or "").lower() == topic_lc:
            score += 2
        scored.append((score, entry))
    scored.sort(key=lambda s: s[0], reverse=True)
    return [e for s, e in scored if s > 0][:limit]


# ---------------------------------------------------------------------------
# Group A — knowledge / truth
# ---------------------------------------------------------------------------

def lookup_knowledge(
    args: LookupKnowledgeArgs,
    *,
    ledger: LookupLedger | None = None,
) -> LookupKnowledgeReturn:
    """Retrieve top-k KB entries for a query.

    Tries the embeddings sidecar first; falls back to bag-of-words if the
    sidecar is missing or the embed call fails (no API key, network, etc.).
    Records every returned id into the per-turn lookup ledger so cite_fact()
    can later verify a citation was actually retrieved this turn.
    """

    entries = _embedding_retrieve(args.query, args.topic, args.limit)
    if entries is None:
        entries = _bag_of_words_retrieve(args.query, args.topic, args.limit)
    if ledger is not None:
        ledger.record(e.id for e in entries)
    return LookupKnowledgeReturn(entries=entries)


def cite_fact(
    args: CiteFactArgs,
    *,
    ledger: LookupLedger,
) -> CiteFactReturn:
    """Mark a fact as backing a claim in the upcoming reply.

    Rejects if `args.kb_id` was not returned by a `lookup_knowledge` call
    earlier in the same turn (or if the id doesn't exist in the KB).
    """

    if args.kb_id not in _KB_BY_ID:
        return CiteFactReturn(ok=False, reason="kb_id_unknown")
    if args.kb_id not in ledger:
        return CiteFactReturn(ok=False, reason="kb_id_not_looked_up_this_turn")
    return CiteFactReturn(ok=True)


# ---------------------------------------------------------------------------
# Group B — circuit oracle
# ---------------------------------------------------------------------------

def _extract_state_for_analysis(circuit_state: dict[str, Any]) -> dict[str, Any]:
    """Translate the frontend's snapshot into the shape expected by circuit_validator.analyse()."""

    comps_in = circuit_state.get("components") or []
    wires_in = circuit_state.get("wires") or []
    meters_in = circuit_state.get("meters") or []

    components = []
    for c in comps_in:
        if not isinstance(c, dict):
            continue
        props = c.get("props", {}) or {}
        entry: dict[str, Any] = {"id": c.get("id"), "type": c.get("type")}
        if "voltage" in props:
            entry["voltage"] = props["voltage"]
        if "resistance" in props:
            entry["resistance"] = props["resistance"]
        if "closed" in props:
            entry["closed"] = props["closed"]
        components.append(entry)

    wires = [
        {"id": w.get("id"), "from": w.get("from"), "to": w.get("to")}
        for w in wires_in if isinstance(w, dict)
    ]
    meters = [{"id": m.get("id")} for m in meters_in if isinstance(m, dict)]
    return {"components": components, "wires": wires, "meters": meters}


def _suggested_focus(analysis: dict[str, Any]) -> dict[str, Any] | None:
    """Pick the highest-priority issue as a HINT (not an override).

    Returns advisory context only — the model is free to ignore it (e.g. when
    the student is deliberately exploring a wrong configuration).
    """

    if not analysis or not isinstance(analysis, dict) or analysis.get("error"):
        return None

    meters = analysis.get("meter_issues") or []
    if meters:
        m = meters[0]
        return {
            "kind": "meter_issue",
            "target_id": m.get("meter") or m.get("id"),
            "summary": m.get("issue") or "meter is incorrectly placed",
            "suggested_kb_id": m.get("misconception_id"),
        }

    open_switches = analysis.get("open_switches") or []
    if open_switches:
        sw = open_switches[0]
        sid = sw.get("id") if isinstance(sw, dict) else sw
        return {
            "kind": "broken_circuit",
            "target_id": sid,
            "summary": "an open switch is breaking the loop",
            "suggested_kb_id": "kb.fault.open_circuit",
        }

    if analysis.get("complete_loop") is False:
        return {
            "kind": "broken_circuit",
            "target_id": None,
            "summary": "the loop is not complete",
            "suggested_kb_id": "kb.fault.open_circuit",
        }

    if analysis.get("short_circuit"):
        return {
            "kind": "short",
            "target_id": None,
            "summary": "a short-circuit path is bypassing components",
            "suggested_kb_id": "kb.fault.short_circuit",
        }

    dead = analysis.get("dead_branches") or []
    if dead:
        d = dead[0]
        target = d.get("id") if isinstance(d, dict) else d
        return {
            "kind": "dead_branch",
            "target_id": target,
            "summary": "a component is on a branch that carries no current",
            "suggested_kb_id": "kb.fault.open_circuit",
        }

    return None


def analyse_topology(
    args: AnalyseTopologyArgs,
    *,
    circuit_state: dict[str, Any],
) -> AnalyseTopologyReturn:
    """Run circuit_validator.analyse() and tag a suggested-focus hint."""

    # Imported lazily so tools.py imports cleanly even if circuit_validator
    # has a syntax error in dev (the agent loop will surface the error).
    from circuit_validator import analyse  # type: ignore[import-not-found]

    state = _extract_state_for_analysis(circuit_state)
    analysis = analyse(state)
    return AnalyseTopologyReturn(
        analysis=analysis,
        suggested_focus=_suggested_focus(analysis),
    )


def inspect_circuit(
    args: InspectCircuitArgs,
    *,
    circuit_state: dict[str, Any],
    sim_result: dict[str, Any] | None = None,
) -> InspectCircuitReturn:
    """Return only the requested fields of the live circuit.

    Numerics in `props` are returned as-is — no phrase-based scrubbing.
    The contract: ask for fields, get them.
    """

    sim_result = sim_result or {}
    out: dict[str, Any] = {}

    if "components" in args.fields:
        out["components"] = [
            {"id": c.get("id"), "type": c.get("type")}
            for c in (circuit_state.get("components") or [])
            if isinstance(c, dict)
        ]

    if "wires" in args.fields:
        out["wires"] = [
            {"id": w.get("id"), "from": w.get("from"), "to": w.get("to")}
            for w in (circuit_state.get("wires") or [])
            if isinstance(w, dict)
        ]

    if "meters" in args.fields:
        out["meters"] = [
            {k: m.get(k) for k in ("id", "mode", "measuring", "across") if k in m}
            for m in (circuit_state.get("meters") or [])
            if isinstance(m, dict)
        ]

    if "props" in args.fields:
        props: dict[str, Any] = {}
        for c in (circuit_state.get("components") or []):
            if not isinstance(c, dict):
                continue
            cid = c.get("id")
            if cid and isinstance(c.get("props"), dict):
                props[cid] = dict(c["props"])
        out["props"] = props

    if "readings" in args.fields:
        out["readings"] = dict(sim_result.get("meters") or {})

    return InspectCircuitReturn(**out)


def _meter_status(
    meter_id: str,
    circuit_state: dict[str, Any],
    sim_result: dict[str, Any],
) -> tuple[str, float | None, str | None]:
    """Return (status, value, unit) for a meter.

    Status values mirror the schema's MeterStatus literal.
    """

    components = circuit_state.get("components") or []
    by_id = {c.get("id"): c for c in components if isinstance(c, dict)}
    meta = by_id.get(meter_id)
    if meta is None:
        return "missing", None, None

    mtype = meta.get("type")
    unit = "A" if mtype == "ammeter" else ("V" if mtype == "voltmeter" else None)

    readings = (sim_result or {}).get("meters") or {}
    reading = readings.get(meter_id)
    if reading is None:
        return "missing", None, unit

    if isinstance(reading, dict):
        status = reading.get("status") or "live"
        value = reading.get("value")
    else:
        status = "live"
        value = reading

    if status not in ("live", "open", "short", "missing"):
        status = "live"

    if value is not None:
        try:
            value = float(value)
        except (TypeError, ValueError):
            value = None

    return status, value, unit


def read_meter(
    args: ReadMeterArgs,
    *,
    circuit_state: dict[str, Any],
    sim_result: dict[str, Any] | None = None,
) -> ReadMeterReturn:
    sim_result = sim_result or {}
    status, value, unit = _meter_status(args.meter_id, circuit_state, sim_result)
    return ReadMeterReturn(
        value=value,
        unit=unit,  # type: ignore[arg-type]
        status=status,  # type: ignore[arg-type]
    )


# ---------------------------------------------------------------------------
# Group C — pedagogy
# ---------------------------------------------------------------------------

def mark_target(
    args: MarkTargetArgs,
    *,
    circuit_state: dict[str, Any],
) -> MarkTargetReturn:
    """Validate the target id against the live circuit.

    Rejects any target id not present in `circuit_state.components` — prevents
    the model from inventing ids that would silently no-op on the client.
    """

    component_ids = {
        c.get("id") for c in (circuit_state.get("components") or [])
        if isinstance(c, dict) and c.get("id")
    }
    if args.target not in component_ids:
        return MarkTargetReturn(ok=False, reason="unknown_target_id")
    return MarkTargetReturn(ok=True)


def refuse(
    args: RefuseArgs,
    *,
    session: SessionState | None = None,
) -> RefuseReturn:
    """Render the canonical refusal sentence + optional on-ramp."""
    return RefuseReturn(rendered=render_refusal(args, session))


def update_session_state(
    args: UpdateSessionStateArgs,
    *,
    session: SessionState,
) -> UpdateSessionStateReturn:
    """Append-only session updates.

    Rejects unknown KB-misconception ids so the model cannot invent misconception
    names that the rest of the system relies on.
    """

    applied: dict[str, Any] = {}
    rejected: dict[str, Any] = {}

    if args.current_goal is not None:
        session.current_goal = args.current_goal
        applied["current_goal"] = args.current_goal

    if args.next_step is not None:
        applied["next_step"] = args.next_step

    if args.observed_misconceptions is not None:
        accepted_misc: list[str] = []
        rejected_misc: list[str] = []
        existing = set(session.observed_misconceptions)
        for mid in args.observed_misconceptions:
            if mid not in _KB_MISCONCEPTION_IDS:
                rejected_misc.append(mid)
                continue
            if mid in existing:
                continue
            session.observed_misconceptions.append(mid)
            existing.add(mid)
            accepted_misc.append(mid)
        if accepted_misc:
            applied["observed_misconceptions"] = accepted_misc
        if rejected_misc:
            rejected["observed_misconceptions"] = rejected_misc

    return UpdateSessionStateReturn(
        ok=not rejected,
        applied=applied,
        rejected=rejected,
    )


def validate_task(
    args: ValidateTaskArgs,
    *,
    session: SessionState,
    circuit_state: dict[str, Any],
    sim_result: dict[str, Any] | None = None,
    check_request: dict[str, Any] | None = None,
) -> ValidateTaskReturn:
    """Judge whether the active task's success criteria are met.

    The model writes the prose; this tool writes the verdict. The check_request
    payload is server-authoritative for `reading_status`.
    """

    sim_result = sim_result or {}
    check_request = check_request or {}

    task = session.active_task
    if task is None:
        return ValidateTaskReturn(
            topology_ok=False,
            verdict="fail",
            fix_hint="No active task is set; ask the student to pick a task.",
        )

    # Reading-side: trust the server-authoritative reading_status.
    reading_status = check_request.get("reading_status")
    claimed_reading = check_request.get("claimed_reading")
    simulated_reading = check_request.get("simulated_reading")
    target_unit = check_request.get("target_unit")
    expected_reading: float | None = None
    if isinstance(task.data, dict):
        for key in ("expected_reading", "target_value", "target_reading"):
            if key in task.data:
                try:
                    expected_reading = float(task.data[key])
                    break
                except (TypeError, ValueError):
                    pass

    has_reading_check = claimed_reading is not None or reading_status is not None
    if has_reading_check:
        reading_ok = reading_status == "correct"
    else:
        reading_ok = None

    # Topology-side: the legacy contract has the server-side analyse() expose
    # whether the circuit is well-formed; we look up complete_loop / short.
    try:
        from circuit_validator import analyse  # type: ignore[import-not-found]
        analysis = analyse(_extract_state_for_analysis(circuit_state))
    except Exception:
        analysis = {}
    topology_ok = bool(analysis.get("complete_loop")) and not analysis.get("short_circuit")

    fix_hint: str | None = None
    verdict_value: str
    if topology_ok and (reading_ok is True or (reading_ok is None and has_reading_check is False)):
        verdict_value = "pass"
    else:
        verdict_value = "fail"
        if not topology_ok:
            fix_hint = "The circuit topology does not match the task yet."
        elif reading_ok is False:
            if simulated_reading is not None and target_unit:
                fix_hint = f"The meter shows {simulated_reading} {target_unit}; check what the task is asking for."
            else:
                fix_hint = "The reading does not match the simulator."

    return ValidateTaskReturn(
        topology_ok=topology_ok,
        reading_ok=reading_ok,
        simulated_reading=(
            float(simulated_reading) if simulated_reading is not None else None
        ),
        expected_reading=expected_reading,
        fix_hint=fix_hint,
        verdict=verdict_value,  # type: ignore[arg-type]
    )


# ---------------------------------------------------------------------------
# Convenience: a name->callable map for the dispatcher in tool_dispatch.py.
# ---------------------------------------------------------------------------

TOOL_FN_MAP = {
    "lookup_knowledge": lookup_knowledge,
    "cite_fact": cite_fact,
    "analyse_topology": analyse_topology,
    "inspect_circuit": inspect_circuit,
    "read_meter": read_meter,
    "mark_target": mark_target,
    "validate_task": validate_task,
    "refuse": refuse,
    "update_session_state": update_session_state,
}
