# Tutor agent — gold-standard pattern for Genesis tools

> Status: shipped (post tutor-redo Chunk 6). Audience: future-Claude / future
> contributors building fraction-quest, projectile-sim, or any other Genesis
> tool that needs an AI tutor.
>
> This doc is the durable template. It is written from the actual code
> (`api/`), not from the plan — quote real file paths and real
> function signatures rather than aspirational ones. If the code drifts, fix
> the code, then update this doc.

The plan that built this surface is at `plans/tutor-redo/00-full-plan.md`;
read it once before adopting the pattern. The chunk files (`01-…` through
`06-…`) are the build sequence.

---

## 1. Pattern overview

A Genesis tutor is a **tool-augmented agent that cannot speak without first
calling at least one tool**. The model loses authority over what is true,
what is in scope, and what the live state is; it gains authority over
pedagogy, sequencing, and tone.

```
client  →  POST /api/tutor?v=2   (slim payload)
              │
              ▼
         agent_runner.run_agent()    ← the loop
              │
              ├─ load session from session_store
              ├─ build messages: [system_prompt, slim_user]
              └─ for iter 0..MAX_ITERS:
                   ├─ llm_client.call_model(messages, tools, tool_choice)
                   │     iter 0: tool_choice="required"
                   ├─ if tool_calls → tool_dispatch.dispatch each
                   │     records to ledger
                   │     dedupes oracle tools
                   ├─ if final assistant content:
                   │     ├─ parse envelope
                   │     ├─ rebuild visual_instructions / fact_checks
                   │     │   from ledger truth
                   │     └─ validate_final_reply(envelope, ledger, inbound)
                   ├─ Reject → corrective re-invoke once, then fallback
                   └─ Accept → break
              │
              └─ persist session, return AgentResult to HTTP layer
```

Every line of this flow is mechanically tested in
`api/test_agent_runner.py` with a stub LLM. **Build the same shape
for the next Genesis tool.**

---

## 2. The six tools shape

The catalogue lives in `api/tools.py`. Pydantic schemas are in
`api/schemas.py`. The dispatcher is `api/tool_dispatch.py`.

| Group | Tool | Purpose | Pydantic args | Pydantic return |
|---|---|---|---|---|
| **A — knowledge** | `lookup_knowledge` | Cosine-top-k against the embeddings sidecar; fall back to bag-of-words. Records ids into the per-turn ledger. | `LookupKnowledgeArgs` | `LookupKnowledgeReturn` |
| | `cite_fact` | Mark a kb_id as backing a claim. Rejects ids not in this turn's lookup ledger. | `CiteFactArgs` | `CiteFactReturn` |
| **B — oracle** | `analyse_topology` | `circuit_validator.analyse()` + advisory `suggested_focus`. | `AnalyseTopologyArgs` | `AnalyseTopologyReturn` |
| | `inspect_circuit` | Read selected fields of the live circuit — components, wires, meters, props, readings. Numerics return as-is. | `InspectCircuitArgs` | `InspectCircuitReturn` |
| | `read_meter` | Simulated reading of one meter. | `ReadMeterArgs` | `ReadMeterReturn` |
| **C — pedagogy** | `mark_target` | Apply a visual highlight. Validates target id against the live circuit. | `MarkTargetArgs` | `MarkTargetReturn` |
| | `validate_task` | Judge whether the active task's success criteria are met. Required when a `check_request` is in flight. | `ValidateTaskArgs` | `ValidateTaskReturn` |
| | `refuse` | Render canonical refusal prose; mandatory for off-scope/injection turns. | `RefuseArgs` | `RefuseReturn` |
| | `update_session_state` | Append-only updates to rolling state. KB-misconception ids must exist. | `UpdateSessionStateArgs` | `UpdateSessionStateReturn` |

**Renaming for a different tool** (e.g. fraction-quest):
- Group A is identical (every tool needs a KB).
- Group B is domain-specific. For fraction-quest you'd swap `analyse_topology` → `analyse_fraction_setup`, `read_meter` → `read_simplification`, etc.
- Group C is mostly identical. `mark_target` becomes "highlight a numerator/denominator", `validate_task` keeps the same shape, `refuse` is unchanged.

The contract surface is small enough that adding a tool means: pydantic
schema in `schemas.py`, pure function in `tools.py`, dispatch entry in
`tool_dispatch.py:_run_tool`, validator update if it owns part of the
contract, probe in `tests/tutor-probes/v2/probes.py`.

---

## 3. The post-validator (the architectural moat)

Lives in `api/agent_runner.py:validate_final_reply`. Pure function:
`(envelope, ledger, inbound) → Accept(envelope) | Reject(reason, detail)`.

### Reject branches every Genesis tool needs

These are domain-agnostic and should be ported verbatim:

| Reason | Trigger |
|---|---|
| `no_tools_called` | Empty ledger. Every turn must call ≥1 tool. |
| `refusal_with_other_tools` | `reply_type == "refusal"` and ledger contains tools other than `refuse`. |
| `refusal_text_mismatch` | `assistant_text` doesn't match the canonical refusal rendered by the `refuse` tool. |
| `uncited_physics_claim` | Reply contains a claim (formula / definitional / numeric+unit) but no `cite_fact` call. |
| `cite_without_lookup` | A cited kb_id wasn't returned by `lookup_knowledge` this turn. |
| `unauthorised_visual_target` | An envelope visual_instruction targets an id not in the ledger's successful `mark_target` calls. |
| `verdict_without_validate` | `inbound.has_check_request` and no `validate_task` call. |
| `verdict_mismatch` | Envelope verdict ≠ tool's verdict. |
| `schema_failure` | Envelope doesn't pass pydantic. |

### Domain-specific reject branches

For each new tool, ask "is there a contract a malicious or sloppy model
could violate that the existing branches don't catch?" — then add the
branch. The validator is the moat; if it doesn't reject, the model can lie.

### The corrective re-invoke + safe fallback

Reject → one re-invoke with `build_corrective_message(reason, detail)` as a
system message. Reject again → `_safe_fallback_envelope(...)`. This shape is
in `agent_runner.run_agent`; copy it.

---

## 4. Probe authoring (assertion DSL)

Probes live in `tests/tutor-probes/v2/probes.py`. The harness
(`harness.py`) calls `run_agent()` directly, asserts on the **tool
ledger**, not on assistant text.

### Skeleton for a new probe

```python
from .fixtures import working_series_loop  # or your domain fixtures
from .harness import Probe, ProbeExpectations, ProbeSetup

NEW_PROBE = Probe(
    id="X1_short_name",
    description="One-line statement of what the probe is checking.",
    message="the student message that triggers it",
    setup=ProbeSetup(circuit=working_series_loop(), sim={"meters": {}}),
    expect=ProbeExpectations(
        tools_called_in_order=["analyse_topology", "lookup_knowledge", "cite_fact"],
        cite_fact_kb_id_in=["kb.your.expected.id"],
        # ...
    ),
    stub_script=[  # optional — only required when running in stub mode
        [{"name": "analyse_topology", "arguments": {}}],
        [{"name": "lookup_knowledge", "arguments": {"query": "..."}}],
        [{"name": "cite_fact", "arguments": {"kb_id": "...", "claim": "..."}}],
        # final envelope JSON string
    ],
)
```

Then append to `ALL_PROBES`.

### Run modes

- `stub` (default) — uses the probe's `stub_script` to simulate the LLM.
  Cost-free; verifies dispatch + validator + ledger assembly.
- `real` — real OpenAI calls. Set `PROBE_LLM_MODE=real` and ensure
  `OPENAI_API_KEY`. ~£0.0001 per probe.

### Probe authoring rules

1. Prefer `tools_called_in_order` (subsequence) over `tools_called_exactly`
   (set-equality). The latter is reserved for refusal turns where extra
   tools are themselves a fail.
2. The stub_script is a *demonstration of one valid trajectory*, not the
   only one. Real-mode probes verify the prompt converges to *some* valid
   trajectory.
3. One probe per behaviour. When a probe assertion gets complicated, split
   it.

---

## 5. What goes in the prompt vs the tools

This is the discipline that prevents the heuristic-stack failure mode.

| In the prompt | In the tools |
|---|---|
| Voice / tone / pedagogical style | Truth retrieval (`lookup_knowledge`) |
| When to call `refuse` (scope judgement) | The canonical refusal prose (rendered server-side) |
| Tool sequencing decisions | The actual circuit / domain state (`inspect_*`) |
| Misconception priorities (as exemplars, not rules) | The validator's verdict (`validate_task`) |
| Citation requirements (model proposes; validator enforces) | The cite-vs-lookup ledger check (`cite_fact`) |

If you're tempted to add a Python heuristic to "help" the model — don't.
That was the legacy-tutor failure mode (full plan §1.2 H1-H8). Either
the model needs more prompting (add an exemplar), the validator needs a
new branch (it's a soundness gap), or the contract is wrong (rare).

---

## 6. Cost discipline

| Lever | Where | Effect |
|---|---|---|
| Slim payload | `frontend/tutor/api_v2.js` | The wire carries `{student_message, selected, current_task, session_id}` plus the live `circuit_state`. No 8 kB KB snippets, no 4-turn history (kept server-side), no triage flags. |
| `tool_choice="required"` only on iter 0 | `agent_runner.run_agent` | Subsequent iters allow text-only replies, so a simple "ok thanks" can finish in one round-trip after the mandatory first tool call. |
| Oracle dedupe | `tool_dispatch.py:_DEDUPE_TOOLS` | Repeated calls to `analyse_topology` / `inspect_circuit` / `read_meter` / `lookup_knowledge` with identical args return the cached result and increment `redundant_calls`. |
| Iter cap | `agent_runner.MAX_ITERS = 5` | A misbehaving prompt cannot spiral forever — the loop force-falls to a safe envelope after 5 iters. |
| Embedding cache | `tools.py:_EMB_QUERY_CACHE` | Repeated lookups in a session do not re-embed. |
| Embeddings sidecar | `api/knowledge_base.embeddings.json` | Run `scripts/embed_kb.py` once after every KB edit; runtime gracefully falls back to bag-of-words if the sidecar is stale or missing. |

### Trivial turn budget

A "ok thanks"-class turn should ship under ~4 kB total payload. The probe
suite's `G2_trivial_turn_short_payload` watches this — tighten the cap in
Chunk 5 / known-defects iteration if the prompt drifts.

---

## 7. Risks revisited (full plan §11 with circuit-tutor lessons)

- **R1 — Tool-loop latency.** Mitigated by parallel oracle calls. Real-mode
  probes confirm the prompt actually emits parallel calls.
- **R2 — `tool_choice="required"` provider variance.** The validator's
  `no_tools_called` reject branch is the safety net; `agent_runner` has the
  corrective re-invoke ready.
- **R3 — Cost ceiling per turn.** Hard cap (`MAX_ITERS = 5`) + dedupe; the
  `redundant_calls` counter surfaces in dev panel.
- **R4 — Model under-calls tools.** The post-validator's
  `claim_classifier.py` is the arbiter. Start permissive (Chunk 2),
  tighten with probes (Chunk 5).
- **R5 — Schema drift.** Single source of truth: pydantic models →
  `model_json_schema()` → `tool_dispatch.build_tools_spec()` → OpenAI
  `tools=[...]`.
- **R6 — Session stickiness across servers.** In-process LRU
  (`session_store.py`); flag for shared store if Vercel scales out.
- **R7 — Prompt injection via tool inputs.** Pydantic args validation +
  no shell/SQL interpolation anywhere in tool bodies.
- **R8 — Out-of-distribution physics.** Caught by the citation requirement:
  no lookup → no cite → reject → corrective re-invoke → fall back.
- **R9 — Backwards compat.** `appendTutorMsg(parsed)` shape is preserved by
  `TutorReplyEnvelope` — Chunk 6 cutover does not change the consumer.

---

## 8. Adopting this pattern in a new Genesis tool

For each new tool that needs a tutor:

1. Copy the file set:
   ```
   api/{schemas,tools,session_store,refusal_render,tool_dispatch,
                  agent_runner,system_prompt,llm_client,claim_classifier}.py
   tests/tutor-probes/v2/{harness,fixtures,probes,run}.py
   scripts/embed_kb.py
   ```
2. Rename Group B oracle tools for your domain (the function bodies, the
   pydantic schemas, and the `tool_dispatch.build_tools_spec()` entry).
3. Replace `circuit_validator.py` with your domain's analysis primitive.
4. Author a domain-specific KB (`knowledge_base.json`) and re-run
   `scripts/embed_kb.py`.
5. Write a domain-specific `system_prompt.py` with three exemplars
   (refusal, misconception, verdict).
6. Write 15–25 probes covering the same categories (D refusal,
   B misconception, C multi-step, E verdict, F visual, G cost).
7. Run the suite in stub mode first (must pass), then real mode while
   tuning the prompt.

The investment in this rebuild pays back in every subsequent tool only if
the pattern is documented before memory of "why we did it this way"
fades. **This doc IS the payback.**
