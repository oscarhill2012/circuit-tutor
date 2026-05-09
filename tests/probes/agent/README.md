# Agent probe suite

Probes that assert on **tool ledgers**, not text. The harness calls
`run_agent()` from `api/agent_runner.py` directly — same code path as
the production `/api/tutor` endpoint, no HTTP layer, no dev server.

## Run modes

| Mode | What it does | Cost |
|---|---|---|
| `stub` (default) | Each probe carries a scripted LLM behaviour. Verifies dispatch + validator + ledger assembly. | £0 |
| `real` | Calls OpenAI with the live system prompt; the model picks tools. Real prompt evaluation. | ~£0.0001 per probe |

## Quickstart

```bash
# Stub-mode, all probes, baseline-report.md generated
python tests/probes/agent/run.py

# Single probe, verbose ledger output
python tests/probes/agent/run.py --probe D5

# Real LLM (requires OPENAI_API_KEY)
PROBE_LLM_MODE=real python tests/probes/agent/run.py
```

The npm shortcut for the full stub-mode suite is `npm run test:agent`.

## Probe categories

- **D-series** — refusal / safety. D1-D4 cover off-topic + injection;
  D5 + D6 are the adversarial set.
- **B-series** — misconception correction. The core teaching path.
- **C-series** — multi-step reasoning. C3 is the adversarial two-step
  diagnostic.
- **E-series** — verdict turns. Asserts the envelope verdict matches
  `validate_task`'s return.
- **F-series** — visual instructions. F2 forces the validator's
  `unauthorised_visual_target` reject branch to fire.
- **G-series** — cost / parallelism. G1 asserts oracle tools fire in
  one model turn; G2 caps payload size on trivial turns.

## Adding a probe

1. Add a fixture (if a new circuit is needed) in `fixtures.py`.
2. Add a `Probe` to `probes.py` with `id`, `description`, `message`,
   `setup`, `expect`, and (for stub mode) `stub_script`.
3. Append to `ALL_PROBES`.
4. Run `python tests/probes/agent/run.py --probe <id>` to verify.

## Assertion DSL

See `harness.py:ProbeExpectations`. Each field is optional and only the
present ones run. Subsequence checks (`tools_called_in_order`) are
preferred over set-equality (`tools_called_exactly`); the latter is
reserved for refusal turns where extra tools are themselves a fail.

## Baseline report

`baseline-report.md` is regenerated on every full-suite run.
