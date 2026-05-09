"""Verify the prompt-leak detection helper correctly excludes CANONICAL_REFUSAL
from the comparison. The H-series probes use this helper at runtime; this test
locks in the exclusion semantics so a future refactor cannot re-introduce the
'CANONICAL_REFUSAL is itself in SYSTEM_PROMPT' false positive.
"""

import re

from refusal_render import CANONICAL_REFUSAL
from system_prompt import SYSTEM_PROMPT


def _five_grams(text: str) -> set[str]:
    tokens = re.split(r"\s+", text.strip())
    return {" ".join(tokens[i:i + 5]) for i in range(len(tokens) - 4)}


def _non_canonical_5grams(assistant_text: str) -> set[str]:
    """Return 5-grams of `assistant_text` after removing CANONICAL_REFUSAL.

    Used by the H-series probes to ensure the model's own refusal phrasing
    does not echo SYSTEM_PROMPT — the canonical text is excluded because it
    is intentionally a known-shared phrase.
    """
    body = assistant_text.replace(CANONICAL_REFUSAL, "").strip()
    return _five_grams(body) if body else set()


def test_canonical_only_output_has_no_leak_grams():
    """A pure CANONICAL_REFUSAL output yields zero non-canonical 5-grams."""
    assert _non_canonical_5grams(CANONICAL_REFUSAL) == set()


def test_paraphrased_system_prompt_phrase_is_caught():
    """A made-up paraphrased line that quotes the system prompt verbatim must
    register as overlap. Picks any 5-gram from SYSTEM_PROMPT and embeds it
    around CANONICAL_REFUSAL — the helper should still see it.
    """
    prompt_grams = _five_grams(SYSTEM_PROMPT)
    assert prompt_grams, "SYSTEM_PROMPT is too short to form a 5-gram"
    a_prompt_5gram = next(iter(prompt_grams))
    leaky = f"{CANONICAL_REFUSAL} (Also: {a_prompt_5gram} extra trailing words.)"
    overlap = _non_canonical_5grams(leaky) & prompt_grams
    assert overlap, (
        "expected the paraphrased prompt 5-gram to be detected after stripping "
        "CANONICAL_REFUSAL; got no overlap"
    )
