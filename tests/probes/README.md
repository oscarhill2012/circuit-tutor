# Probes

Two complementary safety-net suites for the tutor agent.

## `e2e.spec.js` — Playwright end-to-end

Drives the live UI in a browser, hits `/api/tutor` over HTTP, asserts on rendered DOM. Run with:

```
npm run test:e2e
```

Use this to verify integration: the dev server, the network layer, the chat panel, the topology snapshot the client serialises. It is the only thing that catches regressions in payload shape, debouncing, and the visual reaction to a returned envelope.

## `agent/` — In-process Python probes

Calls `run_agent` directly with a stub LLM (or the real one if `OPENAI_API_KEY` is set). Asserts on the ledger, validator decision, and final envelope — not on rendered text. Run with:

```
npm run test:agent
```

Use this to verify the architectural moats: tool-call discipline, refusal exclusivity, claim grounding, visual-target allow-list, verdict consistency. The stub mode is cost-free; real-mode probes (G-series) are gated and intended to be run sparingly.

## When to use which

- New tutor behaviour → write an `agent/` probe first (cheaper, faster feedback).
- New UI behaviour or payload shape → write an `e2e.spec.js` probe.
- Suspected safety regression → run both before shipping.
