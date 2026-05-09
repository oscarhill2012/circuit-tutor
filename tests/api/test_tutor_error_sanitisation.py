"""Verify the upstream-error catch in tutor.py emits a sanitised reason.

Tests that when `_run` raises, the JSON body written to the client contains
the opaque marker "server_error" rather than any exception type name or
exception message text. conftest.py ensures api/ is on sys.path before import.
"""

import io
import json
from unittest.mock import patch

import tutor


SECRET_LEAK = "sk-redacted-1234-this-must-not-reach-the-client"


def _invoke_post_with_run_raising(exc: Exception) -> str:
    """Drive handler.do_POST against a stubbed `_run` that raises `exc`.

    Builds a minimal fake handler instance (skipping __init__ to avoid
    opening a real socket), wires up rfile/wfile/headers, patches `_run` to
    raise, then returns the raw JSON the handler wrote to wfile.
    """
    body_in = json.dumps({
        "session_id": "s1",
        "student_message": "hello",
        "circuit_state": {},
        "sim_result": {},
    }).encode("utf-8")

    inst = tutor.handler.__new__(tutor.handler)
    inst.rfile = io.BytesIO(body_in)
    inst.wfile = io.BytesIO()
    inst.headers = {"Content-Length": str(len(body_in))}
    inst.send_response = lambda *a, **k: None
    inst.send_header = lambda *a, **k: None
    inst.end_headers = lambda *a, **k: None

    with patch.object(tutor, "_run", side_effect=exc):
        inst.do_POST()

    return inst.wfile.getvalue().decode("utf-8", errors="replace")


def test_upstream_error_does_not_leak_exception_text():
    """Exception detail (type name and message) must not reach the client."""
    body = _invoke_post_with_run_raising(RuntimeError(f"boom: {SECRET_LEAK}"))

    assert SECRET_LEAK not in body, "exception detail leaked into client response"
    assert "RuntimeError" not in body, "exception type leaked into client response"

    # The opaque sanitised marker must be present instead.
    assert "server_error" in body
