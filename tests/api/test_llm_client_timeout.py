"""Verify llm_client constructs the OpenAI client with the 20s timeout.

We don't actually call the API — just inspect the kwargs passed to OpenAI().

Note: api/llm_client.py imports OpenAI lazily inside call_model() and
constructs the client there, so the test invokes call_model() once with
fake messages/tools to trigger construction. The fake OpenAI class
captures kwargs and returns a stub response shaped like the SDK's
chat.completions.create() output so call_model() can finish without
crashing.
"""

import sys
from types import ModuleType, SimpleNamespace
from unittest.mock import patch


def test_openai_client_constructed_with_timeout(monkeypatch):
    """call_model must build OpenAI(timeout=20.0) so spinners don't hang."""
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    captured: dict = {}

    def _fake_create(**_kwargs):
        # Mirror the bits of the SDK response that call_model touches.
        message = SimpleNamespace(content="ok", tool_calls=None)
        choice = SimpleNamespace(message=message, finish_reason="stop")
        return SimpleNamespace(choices=[choice])

    class _FakeOpenAI:
        def __init__(self, **kwargs):
            captured.update(kwargs)
            self.chat = SimpleNamespace(
                completions=SimpleNamespace(create=_fake_create)
            )

    # The lazy `from openai import OpenAI` inside call_model resolves
    # against sys.modules, so install a fake `openai` module.
    fake_openai = ModuleType("openai")
    fake_openai.OpenAI = _FakeOpenAI

    with patch.dict(sys.modules, {"openai": fake_openai}):
        import importlib
        import llm_client
        importlib.reload(llm_client)
        llm_client.call_model(messages=[], tools=[])

    assert captured.get("timeout") == 20.0, (
        f"OpenAI() must be constructed with timeout=20.0; got kwargs={captured}"
    )
