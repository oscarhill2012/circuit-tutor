"""Pure regex/rule classifier for physics claims in assistant text.

The post-validator uses this to decide whether a reply needs a `cite_fact`
call to back it. The claim taxonomy:

- `formula`           — text contains a canonical formula token (V = I × R …)
- `numeric_with_unit` — text contains a number paired with a circuit unit
- `definitional`      — "X is the …" / "the … is …" over physics nouns
- `procedural`        — instruction or scaffolding ("first try …")
- `observation`       — anything else (questions, acknowledgements)

Plan ref: tutor-redo/02-post-validator-and-embeddings.md §2.1, full plan §5
post-validator step 3, R4 (start permissive — Chunk 5 tightens if false
positives drive re-invoke loops).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

ClaimKind = Literal["formula", "numeric_with_unit", "definitional", "procedural", "observation"]


@dataclass(frozen=True)
class Claim:
    text: str
    kind: ClaimKind


# Canonical-formula tokens (unicode × or ASCII *, optional spaces, optional /).
# Matches the bare formula form; we don't try to parse worked algebra.
_FORMULA_PATTERNS = (
    re.compile(r"\bV\s*=\s*I\s*[×*x]\s*R\b", re.I),
    re.compile(r"\bP\s*=\s*V\s*[×*x]\s*I\b", re.I),
    re.compile(r"\bP\s*=\s*I\s*[×*x]\s*R\b", re.I),
    re.compile(r"\bQ\s*=\s*I\s*[×*x]\s*t\b", re.I),
    re.compile(r"\bE\s*=\s*V\s*[×*x]\s*Q\b", re.I),
    re.compile(r"\bE\s*=\s*P\s*[×*x]\s*t\b", re.I),
    re.compile(r"\bE\s*=\s*V\s*[×*x]\s*I\s*[×*x]\s*t\b", re.I),
    re.compile(r"\bV\s*=\s*W\s*/\s*Q\b", re.I),
    re.compile(r"\bI\s*=\s*Q\s*/\s*t\b", re.I),
)

# A digit (optional decimal) followed by a circuit unit. Matches "0.3 A",
# "6V", "4.5 mA", "10 kΩ", "200J". Lower-case `s` (seconds) excluded — too
# many false positives ("the bulb is").
_UNIT_RE = re.compile(
    r"(?<![A-Za-z])(?:\d+(?:\.\d+)?)\s*(mV|kV|μA|uA|mA|kA|kΩ|MΩ|"
    r"V|A|Ω|W|J|C)\b",
)

# Physics-noun list for definitional detection. Multi-word phrases like
# "potential difference" need to come before single-word "difference".
_PHYSICS_NOUNS = (
    "potential difference",
    "current",
    "voltage",
    "resistance",
    "power",
    "charge",
    "energy",
    "ammeter",
    "voltmeter",
)
_DEFINITIONAL_RES: tuple[re.Pattern[str], ...] = tuple(
    # Either: "<noun> is <something>" or "the <noun> is <something>"
    # but exclude trivial state observations like "the bulb is on" by
    # requiring the predicate to be ≥ 2 words.
    re.compile(rf"\b(?:the\s+)?{re.escape(noun)}\s+is\s+\S+\s+\S+", re.I)
    for noun in _PHYSICS_NOUNS
)
_DEFINITIONAL_REVERSE_RES: tuple[re.Pattern[str], ...] = tuple(
    # "Voltage describes …" / "Current measures …" — alternate phrasing.
    re.compile(rf"\b{re.escape(noun)}\s+(describes|measures|equals|means)\b", re.I)
    for noun in _PHYSICS_NOUNS
)

# Keywords that flip a sentence into "procedural" — instructions / scaffolding.
_PROCEDURAL_HINTS = re.compile(
    r"\b(let'?s|try|first|next|now|move|wire|connect|place|put|notice|look|trace|check|press)\b",
    re.I,
)


def _split_sentences(text: str) -> list[str]:
    """Cheap sentence split. The classifier is regex-based; this is enough."""
    if not text:
        return []
    parts = re.split(r"(?<=[.!?])\s+", text.strip())
    return [p for p in parts if p.strip()]


def _classify_sentence(sent: str) -> ClaimKind:
    s = sent.strip()
    if not s:
        return "observation"
    for pat in _FORMULA_PATTERNS:
        if pat.search(s):
            return "formula"
    if _UNIT_RE.search(s):
        return "numeric_with_unit"
    for pat in _DEFINITIONAL_RES:
        if pat.search(s):
            return "definitional"
    for pat in _DEFINITIONAL_REVERSE_RES:
        if pat.search(s):
            return "definitional"
    if _PROCEDURAL_HINTS.search(s):
        return "procedural"
    return "observation"


def extract_physics_claims(assistant_text: str) -> list[Claim]:
    """Split assistant_text into sentences and classify each."""
    return [Claim(text=sent, kind=_classify_sentence(sent))
            for sent in _split_sentences(assistant_text)]


CITATION_REQUIRED_KINDS: frozenset[ClaimKind] = frozenset(
    {"formula", "definitional", "numeric_with_unit"}
)


def claims_requiring_citation(text: str) -> list[Claim]:
    """Return only the claims that the post-validator will demand a cite for."""
    return [c for c in extract_physics_claims(text) if c.kind in CITATION_REQUIRED_KINDS]
