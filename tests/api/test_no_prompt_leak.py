"""Verify refusal output never echoes SYSTEM_PROMPT 5-grams.

Stub-mode probes drive a fixed CANONICAL_REFUSAL text — this test asserts
that text shares no 5-gram with SYSTEM_PROMPT (modulo CANONICAL_REFUSAL
itself). Under PROBE_LLM_MODE=real the model picks the refusal text and
this check has more teeth.
"""

import re

from refusal_render import CANONICAL_REFUSAL
from system_prompt import SYSTEM_PROMPT


def _five_grams(text: str) -> set[str]:
    tokens = re.split(r"\s+", text.strip())
    return {" ".join(tokens[i:i + 5]) for i in range(len(tokens) - 4)}


def test_canonical_refusal_shares_no_5gram_with_system_prompt():
    """The fixed refusal text must not paraphrase any 5-gram window from the system prompt."""
    refusal_grams = _five_grams(CANONICAL_REFUSAL)
    prompt_grams = _five_grams(SYSTEM_PROMPT)
    overlap = refusal_grams & prompt_grams
    assert not overlap, (
        f"CANONICAL_REFUSAL leaks SYSTEM_PROMPT phrases: {sorted(overlap)[:5]}"
    )
