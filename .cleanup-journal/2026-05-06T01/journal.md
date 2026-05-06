# Cleanup Journal — 2026-05-06

Scope: all JS files in `frontend/src/` and Python files in `frontend/api/`.
Goal: remove plan-file references, iter-improv/Chunk labels, dead typedef field,
wrong file path, stale TODO. No logic changes.

---

## Pass 1

### frontend/src/app.js

**Lines 29–32 (comment rewrite)**
```
  // DEBUG-OVERLAP — verifier hook for iter-improv Phase 1.
  // Exposes the bare minimum surface needed to construct deterministic
  // wire/junction circuits from Playwright. Gated on ?dev=1 so a real student
  // session never sees it. Remove once the overlap iter-improv work lands.
```
Justification: references external plan "iter-improv Phase 1" and "Remove once … work lands" — forward-looking plan note, not code context.

**Lines 55–57 (comment rewrite)**
```
  // First-launch operational tour. Resolves immediately if disabled
  // (?intro=0 or localStorage.circuitTutor.introSeen === '1'). Otherwise
  // walks the student through the UI and finishes with the task picker
  // already open. See ui/onboarding.js + plans/16-onboarding-intro.md.
```
Justification: "plans/16-onboarding-intro.md" is an external plan file.

---

### frontend/src/circuit/renderer.js

**Lines 29–30 (comment rewrite)**
```
// DEBUG-OVERLAP — temporary diagnostic layer; remove with the rest of the
// overlap-debug code once the iter-improv wiring work lands.
```
Justification: references external plan "iter-improv wiring work".

**Lines 86–88 (comment rewrite)**
```
  // DEBUG-OVERLAP — sits above wires, below components, so red bands hide
  // the wire stroke beneath but do not obscure component bodies/labels.
```
Justification: "DEBUG-OVERLAP" label has no meaning outside the old plan; keep the structural note.

**Lines 275–276 (comment rewrite)**
```
  // DEBUG-OVERLAP — paint collinear sub-segments shared by two wires.
```
Justification: same "DEBUG-OVERLAP" label.

**Lines 446–448 (comment rewrite)**
```
// DEBUG-OVERLAP — diagnostic only. Gated on dev mode so the O(N^2) segment-pair
// scan never runs in normal student sessions.
```
Justification: "DEBUG-OVERLAP" label.

**Lines 793–807 (comment rewrite)**
```
// ---------------------------------------------------------------------------
// Current bars overlaid on wires.
//
// Visualisation rules (see project conversation):
```
Justification: "see project conversation" is an external reference.

---

### frontend/src/tasks/engine.js

**Lines 289–296 (comment rewrite)**
```
  // Phase 2 (iter-improv 2026-04-28): all task types are now driven from
  // Professor Volt's panel — the floating top-of-canvas widget is hidden
  // for every task type. The widget DOM stays for legacy reasons (and the
  // canvas tooling that targets the canvas-wrap layer), but renders empty.
```
Justification: "Phase 2 (iter-improv 2026-04-28)" label. Keep structural WHY.

**Lines 342–345 (comment rewrite)**
```
    // Phase 2 (iter-improv 2026-04-28): measure tasks are now driven entirely
    // from Professor Volt's panel — the student types their reading in chat
    // and clicks "Check my circuit". The widget renders nothing.
```
Justification: same.

**Lines 381–383 (comment rewrite)**
```
    // Phase 2 (iter-improv 2026-04-28): exploration tasks use the
    // Check-my-circuit button as "I'm done exploring". The widget is hidden.
```
Justification: same.

**Lines 403–408 (function comment rewrite)**
```
// Drives the "Check my circuit" button (lives in Professor Volt's panel).
// Phase 2 (iter-improv 2026-04-28) extends the dispatch beyond scenario
// tasks: measure tasks merge a local-deterministic reading check with the
// LLM circuit verdict; exploration tasks complete immediately. Returns the
// final verdict so callers can react; the tutor reply (when the backend is
// involved) is appended to the chat by askTutorCheckScenario.
```
Justification: "Phase 2 (iter-improv 2026-04-28)".

---

### frontend/src/ui/onboarding.js

**Line 1 (comment rewrite)**
```
// First-launch operational tour — see plans/16-onboarding-intro.md.
```
Justification: references external plan file.

---

### frontend/src/ui/canvas.js

**Lines 1–3 (comment removal)**
```
// (Live-readings widget removed — selected-component values live in
// Professor Volt's check-my-circuit response and the in-canvas meters.)
```
Justification: describes removed feature as if it is context for the file header — stale historical note; the code itself is clear.

---

### frontend/src/tutor/api.js

**Lines 43–44 (comment rewrite)**
```
// Slim circuit snapshot: NO phrase-based scrubbing. The agent loop's tools
// pull only what they need (full plan C5 fix); the client just hands over the
// authoritative state.
```
Justification: "full plan C5 fix" references external plan.

---

### frontend/src/circuit/wiring/types.js

**`Wire.via` typedef field (dead field removal)**
```
 * @property {{x:number,y:number}[]=} via   Legacy waypoint list (pre-router).
```
Justification: `via` is never set or read in any module (confirmed by search across all JS). The active field is `path`.

---

### frontend/src/sim/physics.js

**Lines 5–7 (comment rewrite — wrong path)**
```
// The matching Python module is backend/circuit_validator.py — the server-side
// tutor endpoint re-derives topology there from the raw circuit state so the
// AI's grounding context can't be spoofed by a tampered client.
```
Justification: `backend/circuit_validator.py` does not exist. Correct path is `api/circuit_validator.py`.

---

### frontend/api/agent_runner.py

**Lines 1–10 (module docstring rewrite)**
```
"""Agent runner — post-validator + (Chunk 3) the agent loop.
...
Plan ref: tutor-redo/02-post-validator-and-embeddings.md §2.2, full plan §5.
"""
```
Justification: references external plan files and chunk labels.

**`_summarise_calls` docstring (line 338)**
```
    """Per-turn compact tool-calls summary for history (full plan M6)."""
```
Justification: "full plan M6".

**`run_agent` docstring (lines 345–362)**
Multiple "full plan §..." and "Chunk" references inside.

---

### frontend/api/system_prompt.py

**Lines 1–9 (module docstring rewrite)**
```
"""System prompt + 3 exemplars + first-user-message builder.
The legacy 240-line system prompt is deleted in Chunk 6. ...
Plan ref: tutor-redo/03-agent-loop-behind-flag.md §3.2, full plan §3.5.
"""
```
Justification: references external plan docs, legacy "Chunk 6" label.

**`build_corrective_message` docstring**
```
    Plan ref: full plan §3.4 — re-invoke once with rejection reason as a
    system message, then fall back if rejected again.
```
Justification: "Plan ref: full plan §3.4".

---

### frontend/api/tools.py

**Lines 1–13 (module docstring rewrite)**
Multiple plan/chunk references.

**Lines 147–149 (stale TODO removal)**
```
# TODO: Chunk 2 — replace this bag-of-words path with the embeddings sidecar.
```
Justification: dead — the embeddings path is already implemented (`_embedding_retrieve`, `_embed_query_cached`, `_EMB_VECTORS`).

**`_extract_state_for_analysis` docstring**
```
    Mirrors tutor.py:_extract_state_for_analysis (lifted, not imported, so the
    Chunk 6 deletion of tutor.py doesn't break us).
```
Justification: references deleted file and plan chunk.

**`inspect_circuit` docstring**
```
    (full plan C5).
```
Justification: external plan reference.

**`mark_target` docstring**
```
    (full plan C1 fix).
```

**`update_session_state` docstring**
```
    (full plan C4 / §4 point 3)
```

**`validate_task` docstring**
```
    ... (full plan M5 fix). For Chunk 1 we surface ...
```

---

### frontend/api/tool_dispatch.py

**Lines 1–8 (module docstring rewrite)** — plan refs.
**Inline comment (lines 59–60)** — no plan ref, actually fine.

---

### frontend/api/llm_client.py

**Lines 1–7 (module docstring rewrite)** — plan refs.

---

### frontend/api/schemas.py

**Lines 1–8 (module docstring rewrite)** — plan refs.
**`KnowledgeEntry` docstring** — Chunk 2 reference.
**`AnalyseTopologyReturn` docstring** — "full plan §3.6".
**`TutorRequest` docstring** — "In Chunk 3 the circuit snapshot...Chunk 5".
**`HistoryTurn` docstring** — "full plan M6 fix".

---

### frontend/api/session_store.py

**Lines 1–12 (module docstring rewrite)** — TODO R6 plan ref, "Plan ref:" line.

---

### frontend/api/claim_classifier.py

**Lines 1–15 (module docstring rewrite)** — "Plan ref:" line.

---

### frontend/api/refusal_render.py

**Lines 1–8 (module docstring rewrite)** — "Plan ref:" line.

**`CANONICAL_REFUSAL` comment**
```
# Canonical refusal sentence — lifted from tutor.py's Rule 1 ("I am only here
# to teach you about circuits") so the voice does not change for users who
# experienced the legacy tutor.
```
Justification: references deleted `tutor.py` and "Rule 1" from an external plan; the literal string is self-documenting.

---

### frontend/api/tutor.py

**Lines 6–9 (module docstring — history note removal)**
```
The legacy heuristic stack (793 lines of regex zoo, _triage_focus,
_inject_suggested_kb, the 240-line SYSTEM_PROMPT, etc.) was deleted in the
tutor-redo Chunk 6 cutover. The agent loop in `agent_runner.py` is now the
only path; the validator + tools enforce the contract that the legacy
heuristics tried to approximate.
```
Justification: describes deleted code history via plan labels ("Chunk 6 cutover"), not current code.

---

## Flagged for human review

None.

## Skill self-critique

All issues were found in Pass 1. Pass 2 found nothing additional.
JS has no test suite; user should smoke-test the running app after this diff.
