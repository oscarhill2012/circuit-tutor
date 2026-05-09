"""Vercel Python serverless function: /api/tutor.

Thin router that hands every request to agent_runner.run_agent().

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

# Ensure sibling modules resolve under both Vercel's Python runtime and
# local invocation (where sys.path may not include this dir).
sys.path.insert(0, str(Path(__file__).parent))

from agent_runner import run_agent  # noqa: E402
from schemas import TutorRequest  # noqa: E402


def _safe_envelope(reason: str) -> dict:
    """Returned when the server can't reach the agent loop at all (e.g. bad
    request body, transport error). The agent loop has its own internal
    fallback for when the model is unreachable; this is the outer layer."""
    return {
        "reply_type": "teaching",
        "assistant_text": "I hit a hiccup while thinking. Please try again in a moment.",
        "follow_up_question": "",
        "verdict": "",
        "visual_instructions": [],
        "safety": {"in_scope": True, "reason": reason},
        "fact_checks": [],
        "state_summary": {"current_goal": "", "observed_misconceptions": [], "next_step": ""},
        "rolling_summary": "",
    }


def _run(req: dict) -> dict:
    """Build the response body for a tutor request."""
    inbound = TutorRequest.model_validate(req)
    result = run_agent(inbound)
    body = {
        "reply": result.envelope.model_dump(),
        "analysis": result.analysis,
        "teaching_focus": None,  # deprecated; kept for client compatibility
    }
    if inbound.debug:
        body["debug"] = {
            "tool_ledger": [c.model_dump() for c in result.ledger.calls],
            "model": os.environ.get("OPENAI_MODEL", "gpt-4o-mini"),
            "payload_char_count": result.payload_char_count,
            "loop_iterations": result.loop_iterations,
            "validator_decision": result.validator_decision,
            "redundant_calls": result.redundant_calls,
        }
    return body


class handler(BaseHTTPRequestHandler):
    def _respond(self, status: int, obj: dict) -> None:
        body = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:
        try:
            length = int(self.headers.get("Content-Length", "0") or 0)
            raw = self.rfile.read(length).decode("utf-8") if length else "{}"
            req = json.loads(raw or "{}")
        except (ValueError, json.JSONDecodeError):
            self._respond(400, {"reply": _safe_envelope("Bad request body."), "analysis": None})
            return

        try:
            self._respond(200, _run(req))
        except Exception as exc:  # noqa: BLE001 — never 500 the student
            traceback.print_exc(file=sys.stderr)
            self._respond(200, {
                "reply": _safe_envelope("server_error"),
                "analysis": None,
                "teaching_focus": None,
            })

    def do_GET(self) -> None:
        self._respond(200, {
            "ok": True,
            "service": "tutor",
            "openai_key_set": bool(os.environ.get("OPENAI_API_KEY")),
            "model": os.environ.get("OPENAI_MODEL", "gpt-4o-mini"),
            "python": sys.version,
        })
