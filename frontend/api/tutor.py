"""Vercel Python serverless function: /api/tutor.

Accepts POST {student_message, circuit_state, selected, current_task,
recent_history, knowledge_snippets, rolling_summary}, runs circuit_validator
server-side so the AI's grounding context is authoritative (not whatever the
client sent), then calls OpenAI and returns the structured JSON reply.

The server ALWAYS injects the pinned safeguarding + foundational physics
entries from knowledge_base.json into knowledge_snippets (belt-and-braces:
even if a tampered client sent an empty list, the model still sees them).

Env vars:
  OPENAI_API_KEY   required; set in the Vercel project settings.
  OPENAI_MODEL     optional; defaults to gpt-4o-mini.
"""
import json
import os
import sys
import traceback
from http.server import BaseHTTPRequestHandler
from pathlib import Path

try:
    from openai import OpenAI
    _OPENAI_IMPORT_ERROR = None
except Exception as _exc:  # noqa: BLE001 — surface import issues as a JSON error
    OpenAI = None
    _OPENAI_IMPORT_ERROR = f"{type(_exc).__name__}: {_exc}"

try:
    from circuit_validator import analyse
    _VALIDATOR_IMPORT_ERROR = None
except Exception as _exc:  # noqa: BLE001
    analyse = None
    _VALIDATOR_IMPORT_ERROR = f"{type(_exc).__name__}: {_exc}"


# --- Knowledge base ---------------------------------------------------------
_KB_PATH = Path(__file__).parent / "knowledge_base.json"
try:
    _KB = json.loads(_KB_PATH.read_text(encoding="utf-8"))
    _PINNED = _KB.get("pinned", [])
    _ENTRIES = _KB.get("entries", [])
    _KB_LOAD_ERROR = None
except Exception as _exc:  # noqa: BLE001
    _PINNED, _ENTRIES = [], []
    _KB_LOAD_ERROR = f"{type(_exc).__name__}: {_exc}"


# Context-window budget. ~4 chars ≈ 1 token (rough). 12k chars ≈ 3k tokens.
# gpt-4o-mini has a 128k window so this is generous; the point is to catch
# runaway payloads rather than to optimise.
_PAYLOAD_CHAR_BUDGET = 24000


SYSTEM_PROMPT = """You are Professor Volt, a safe GCSE circuits tutor inside a school simulator.

Goal:
Help the student understand and improve one circuits idea at a time using the live circuit.

Scope:
Teach only electronic circuits and directly related GCSE physics: current, potential difference, resistance, power, energy, charge, series/parallel circuits, cells, batteries, switches, bulbs, resistors, variable resistors, ammeters, voltmeters, open circuits, short circuits, and common circuit misconceptions.
If the user asks about anything else, reply exactly:
"I am only here to teach you about circuits"

Grounding:
- Never invent formulas, values, rules, or component behaviour.
- Every physics claim in `assistant_text` must be supported by ids in `fact_checks`.
- Use only supplied knowledge snippets for physics claims.
- Trust `analysis` over the student if they conflict.
- If a needed rule is missing, do not guess. Give a safe observational hint or a brief grounded response without adding new physics claims.

Priority:
1. Out-of-scope or unsafe request
2. Dangerous or invalid meter placement
3. Broken circuit, short circuit, dead branch, open switch
4. Major misconception
5. Immediate circuit interpretation
6. Simple calculation or check-work
7. Quiz or extension

Teaching style:
- Be concise, but sound natural and helpful rather than rigid.
- Focus on one main teaching point per turn.
- Use the live circuit as the anchor whenever possible.
- Do not repeat the same rule or correction on consecutive turns unless the circuit state has changed or the student is still acting on that exact mistake.
- Prefer the shortest response that genuinely helps.
- Usually write 1–3 short sentences. You may use 4 short sentences if the student asks "why", "how", "explain", or says they are confused.

How to choose between explanation and questions:
- Match the student's intent.
- If the student asks "why", "how", "explain", or expresses confusion, prefer a direct explanation.
- Use a Socratic question only when the student seems close and one short prompt is likely to help them get there.
- Do not ask a follow-up question every turn.
- If the student already reached the right idea, confirm it briefly and move forward instead of asking them to restate it.
- If the student has already tried twice, reduce questioning and explain more directly.

Questions:
- Ask at most one short question in `follow_up_question`.
- Leave `follow_up_question` empty when a question is not needed.
- `assistant_text` must not end with a question.

Correction style:
- If the student's answer or setup is correct, you may begin with "Correct — well done." when that feels natural, but do not use it every time.
- If partly right, use a brief natural correction such as "Close, but actually..." only when useful.
- If wrong, use a brief natural correction such as "Not quite..." only when useful.
- Avoid sounding like a quiz marker on every turn.
- After any correction, give only the single most useful next point.

Teaching moves:
- observe
- compare
- predict
- calculate
- correct
- verify
- none (refusal only)

Reply types:
- socratic_hint
- direct_explanation
- check_work
- quiz_prompt
- refusal
- correction

When to use each reply type:
- Use `direct_explanation` when the student asks for explanation, says they are confused, asks "why", or needs a clear next step.
- Use `socratic_hint` only when a short prompt is likely to unlock the answer.
- Use `correction` when fixing a misconception or wrong setup.
- Use `check_work` for validating a reading, value, or unit.
- Use `quiz_prompt` mainly for extension or a quick knowledge check, not as the default next step after every reply.
- Use `refusal` only for out-of-scope requests.

Visual instructions:
Use only if they support the single teaching point. Prefer 1–3 items. Use `mark_error` for faults and `mark_success` for correct actions.

Scenario validation mode:
If the user payload contains a non-null `check_request` with `type == "scenario_validation"`, you are being asked to judge whether the student's current circuit actually solves the scenario described in `check_request` (use `challenge`, `narrative`, `parameters`, `success_criteria`, plus the server-authoritative `analysis` and `circuit_state`). In this mode:
- Set `verdict` to exactly "pass" if the circuit correctly satisfies the scenario, or "fail" otherwise.
- Be strict: only "pass" if the topology, component roles, meter placements, and any numeric targets in `success_criteria` or `parameters` all match within a reasonable tolerance.
- Keep the response brief and point to the single most useful next fix if failing.
- In this mode, concise verdict language is preferred over extended tutoring.
- In all other ordinary coaching turns, set `verdict` to "".

Return only valid JSON:
{
  "reply_type": "socratic_hint | direct_explanation | check_work | quiz_prompt | refusal | correction",
  "teaching_move": "observe | compare | predict | calculate | correct | verify | none",
  "assistant_text": "string",
  "follow_up_question": "string",
  "verdict": "pass | fail | \"\"",
  "visual_instructions": [{"target": "id", "action": "highlight|dim|glow|pulse|show_label|mark_error|mark_success", "label": "string"}],
  "safety": {"in_scope": true, "reason": "string"},
  "fact_checks": [{"claim": "string", "source_ids": ["kb.xxx"]}],
  "state_summary": {"current_goal": "string", "observed_misconceptions": ["string"], "next_step": "string"},
  "rolling_summary": "string"
}

Field rules:
- `fact_checks` is required for every physics claim in `assistant_text`.
- Use `teaching_move = none` only for refusal.
- `follow_up_question` must contain at most one short question, otherwise use an empty string.
- Do not put a question in `assistant_text`.
- `rolling_summary` should stay compact and useful.
"""

ALLOWED_REPLY_TYPES = {
    "socratic_hint", "direct_explanation", "check_work",
    "quiz_prompt", "refusal", "correction",
}


def _safe_fallback(reason):
    return {
        "reply_type": "direct_explanation",
        "assistant_text": "I hit a hiccup while thinking. Please try again in a moment.",
        "follow_up_question": "",
        "verdict": "",
        "visual_instructions": [],
        "safety": {"in_scope": True, "reason": reason},
        "fact_checks": [],
        "state_summary": {"current_goal": "", "observed_misconceptions": [], "next_step": ""},
        "rolling_summary": "",
    }


def _inject_pinned(client_snippets):
    """Always put pinned safeguarding entries at the top, de-duplicating by id.

    Belt-and-braces: even if the client omits or tampers with safeguarding,
    the model still receives the full pinned core from the server-side KB.
    """
    seen = set()
    merged = []
    for entry in _PINNED:
        eid = entry.get("id")
        if eid and eid not in seen:
            seen.add(eid)
            merged.append(entry)
    for entry in (client_snippets or []):
        eid = entry.get("id") if isinstance(entry, dict) else None
        if eid and eid in seen:
            continue
        if eid:
            seen.add(eid)
        merged.append(entry)
    return merged


def _apply_budget(req):
    """Trim retrievable (non-pinned) snippets, then history, to fit a rough
    char budget. Pinned safeguarding entries are NEVER dropped.
    """
    snippets = req.get("knowledge_snippets", []) or []
    history = req.get("recent_history", []) or []
    pinned_ids = {p.get("id") for p in _PINNED if p.get("id")}
    pinned = [s for s in snippets if isinstance(s, dict) and s.get("id") in pinned_ids]
    retrievable = [s for s in snippets if not (isinstance(s, dict) and s.get("id") in pinned_ids)]

    def size():
        return len(json.dumps({
            "student_message": req.get("student_message", ""),
            "circuit_state": req.get("circuit_state", {}),
            "current_task": req.get("current_task"),
            "recent_history": history,
            "knowledge_snippets": pinned + retrievable,
            "rolling_summary": req.get("rolling_summary", ""),
        }, ensure_ascii=False))

    trimmed_note = None
    while size() > _PAYLOAD_CHAR_BUDGET and retrievable:
        retrievable.pop()
        trimmed_note = "trimmed_retrieved"
    while size() > _PAYLOAD_CHAR_BUDGET and len(history) > 1:
        history.pop(0)
        trimmed_note = "trimmed_history"

    req["knowledge_snippets"] = pinned + retrievable
    req["recent_history"] = history
    if trimmed_note:
        print(f"[tutor] payload over budget, {trimmed_note}", file=sys.stderr)
    return req


def _build_user_payload(req, analysis):
    return json.dumps({
        "student_message": req.get("student_message", ""),
        "circuit_state": req.get("circuit_state", {}),
        "analysis": analysis,
        "selected": req.get("selected"),
        "current_task": req.get("current_task"),
        "check_request": req.get("check_request"),
        "recent_history": req.get("recent_history", []),
        "knowledge_snippets": req.get("knowledge_snippets", []),
        "rolling_summary": req.get("rolling_summary", ""),
    }, ensure_ascii=False)


def _call_openai(user_payload):
    if OpenAI is None:
        return _safe_fallback(f"OpenAI SDK not importable: {_OPENAI_IMPORT_ERROR}")
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        return _safe_fallback("OPENAI_API_KEY not configured on the server.")

    client = OpenAI(api_key=api_key)
    model = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")

    common = {
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_payload},
        ],
        "response_format": {"type": "json_object"},
    }

    # Newer OpenAI models (gpt-4.1+, o-series) reject `max_tokens` and require
    # `max_completion_tokens`; older ones (gpt-4o-mini, gpt-3.5-*) reject the
    # new param. Some reasoning models also reject custom `temperature`. Be
    # tolerant of both regimes by retrying on TypeError / BadRequestError.
    def _create(**extra):
        return client.chat.completions.create(**common, **extra)

    last_exc = None
    for kwargs in (
        {"temperature": 0.3, "max_completion_tokens": 600},
        {"temperature": 0.3, "max_tokens": 600},
        {"max_completion_tokens": 600},
        {"max_tokens": 600},
    ):
        try:
            resp = _create(**kwargs)
            break
        except TypeError as exc:
            last_exc = exc
            continue
        except Exception as exc:  # noqa: BLE001 — retry on param-rejection 400s
            msg = str(exc).lower()
            if ("max_tokens" in msg or "max_completion_tokens" in msg
                    or "temperature" in msg or "unsupported" in msg):
                last_exc = exc
                continue
            raise
    else:
        return _safe_fallback(f"OpenAI param-mismatch: {last_exc}")

    raw = resp.choices[0].message.content or "{}"
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return _safe_fallback("Model returned non-JSON output.")

    if parsed.get("reply_type") not in ALLOWED_REPLY_TYPES:
        parsed["reply_type"] = "direct_explanation"
    parsed.setdefault("visual_instructions", [])
    parsed.setdefault("fact_checks", [])
    parsed.setdefault("follow_up_question", "")
    parsed.setdefault("safety", {"in_scope": True, "reason": ""})
    parsed.setdefault("state_summary", {"current_goal": "", "observed_misconceptions": [], "next_step": ""})
    parsed.setdefault("rolling_summary", "")
    if parsed.get("verdict") not in ("pass", "fail"):
        parsed["verdict"] = ""
    return parsed


def _extract_state_for_analysis(circuit_state):
    """Translate the frontend's circuit snapshot into analyse()'s expected shape."""
    comps_in = circuit_state.get("components", []) or []
    wires_in = circuit_state.get("wires", []) or []
    meters_in = circuit_state.get("meters", []) or []

    components = []
    for c in comps_in:
        props = c.get("props", {}) or {}
        entry = {"id": c.get("id"), "type": c.get("type")}
        if "voltage" in props:
            entry["voltage"] = props["voltage"]
        if "resistance" in props:
            entry["resistance"] = props["resistance"]
        if "closed" in props:
            entry["closed"] = props["closed"]
        components.append(entry)

    wires = [{"id": w.get("id"), "from": w.get("from"), "to": w.get("to")} for w in wires_in]
    # Validator only reads id (type is looked up from components_by_id).
    meters = [{"id": m.get("id")} for m in meters_in]
    return {"components": components, "wires": wires, "meters": meters}


class handler(BaseHTTPRequestHandler):
    def _respond(self, status, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", "0") or 0)
            raw = self.rfile.read(length).decode("utf-8") if length else "{}"
            req = json.loads(raw or "{}")
        except (ValueError, json.JSONDecodeError):
            self._respond(400, _safe_fallback("Bad request body."))
            return

        # Server-side safeguards on the payload: pinned safeguarding is always
        # present; token budget trims retrievable snippets / history if needed.
        req["knowledge_snippets"] = _inject_pinned(req.get("knowledge_snippets"))
        req = _apply_budget(req)

        circuit_state = req.get("circuit_state") or {}
        try:
            if analyse is None:
                analysis = {"error": f"validator not importable: {_VALIDATOR_IMPORT_ERROR}"}
            else:
                analysis = analyse(_extract_state_for_analysis(circuit_state))
        except Exception as exc:  # noqa: BLE001 - defensive; don't 500 the student
            analysis = {"error": f"analysis failed: {exc}"}

        try:
            parsed = _call_openai(_build_user_payload(req, analysis))
        except Exception as exc:  # noqa: BLE001
            traceback.print_exc(file=sys.stderr)
            parsed = _safe_fallback(f"upstream model error: {type(exc).__name__}: {exc}")

        self._respond(200, {"reply": parsed, "analysis": analysis})

    def do_GET(self):
        self._respond(200, {
            "ok": True,
            "service": "tutor",
            "openai_key_set": bool(os.environ.get("OPENAI_API_KEY")),
            "model": os.environ.get("OPENAI_MODEL", "gpt-4o-mini"),
            "openai_import_error": _OPENAI_IMPORT_ERROR,
            "validator_import_error": _VALIDATOR_IMPORT_ERROR,
            "kb_load_error": _KB_LOAD_ERROR,
            "kb_pinned_count": len(_PINNED),
            "kb_entries_count": len(_ENTRIES),
            "python": sys.version,
        })
