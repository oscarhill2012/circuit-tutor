"""CLI for running the agent probe suite.

Examples:

    # Stub-LLM, full suite, write baseline-report.md
    python tests/probes/agent/run.py

    # Stub-LLM, single probe, verbose
    python tests/probes/agent/run.py --probe D5

    # Real LLM (requires OPENAI_API_KEY); writes report.md
    PROBE_LLM_MODE=real python tests/probes/agent/run.py

The harness calls run_agent() in-process — no HTTP, no web app, no Node.
See harness.py for the dispatch + assertion engine, probes.py for the
probe definitions, fixtures.py for the canned circuits.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE))  # so `harness`, `probes`, `fixtures` resolve

from harness import RunMode, SuiteReport, run_probe, run_suite  # noqa: E402
import probes as probes_mod  # noqa: E402


def _verbose_print(result):
    print(f"\n=== {result.probe.id} ===")
    print(f"description: {result.probe.description}")
    print(f"message:     {result.probe.message!r}")
    print(f"status:      {result.status}")
    if result.skipped_reason:
        print(f"skipped:     {result.skipped_reason}")
        return
    if result.error:
        print(f"error:       {result.error}")
        return
    ar = result.agent_result
    if ar is None:
        return
    print(f"validator:   {ar.validator_decision}")
    print(f"iterations:  {ar.loop_iterations}")
    print(f"payload:     {ar.payload_char_count} chars")
    print(f"redundant:   {ar.redundant_calls}")
    print(f"assistant_text: {ar.envelope.assistant_text!r}")
    print(f"verdict:     {ar.envelope.verdict!r}")
    print(f"follow_up:   {ar.envelope.follow_up_question!r}")
    print(f"visual:      {[vi.model_dump() for vi in ar.envelope.visual_instructions]}")
    print(f"fact_checks: {[fc.model_dump() for fc in ar.envelope.fact_checks]}")
    print("ledger:")
    for c in ar.ledger.calls:
        ok_marker = "OK " if c.ok else "FAIL"
        try:
            args_str = json.dumps(c.args, ensure_ascii=True)
        except (TypeError, ValueError):
            args_str = repr(c.args)
        print(f"  {ok_marker} {c.name}({args_str})")
        if not c.ok:
            print(f"      error: {c.error}")
    if result.failures:
        print("FAILURES:")
        for f in result.failures:
            print(f"  - {f.name}: {f.detail}")


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--probe", help="Run a single probe by id (e.g. D5).")
    parser.add_argument(
        "--mode",
        choices=("stub", "real"),
        default=os.environ.get("PROBE_LLM_MODE", "stub"),
        help="LLM mode (default: stub, or PROBE_LLM_MODE env var).",
    )
    parser.add_argument(
        "--report",
        default=str(_HERE / "baseline-report.md"),
        help="Path to write the markdown report (default: baseline-report.md).",
    )
    parser.add_argument(
        "--no-write",
        action="store_true",
        help="Don't write the report file; just print to stdout.",
    )
    args = parser.parse_args(argv)

    mode: RunMode = args.mode  # type: ignore[assignment]

    if args.probe:
        probe = probes_mod.by_id(args.probe)
        if probe is None:
            print(f"unknown probe id: {args.probe}", file=sys.stderr)
            return 1
        result = run_probe(probe, mode=mode)
        _verbose_print(result)
        return 0 if result.status in ("pass", "skipped") else 2

    report: SuiteReport = run_suite(probes_mod.ALL_PROBES, mode=mode)
    s = report.summary
    print(
        f"agent probe suite ({mode}): pass={s['pass']} fail={s['fail']} "
        f"skipped={s['skipped']} error={s['error']}"
    )
    for r in report.results:
        if r.status == "fail":
            print(f"  FAIL {r.probe.id}: {'; '.join(f.name for f in r.failures)}")
        elif r.status == "error":
            print(f"  ERR  {r.probe.id}: {r.error}")
        elif r.status == "skipped":
            print(f"  SKIP {r.probe.id}: {r.skipped_reason}")
    if not args.no_write:
        Path(args.report).write_text(report.to_markdown(), encoding="utf-8")
        print(f"\nReport written to {args.report}")
    return 0 if s["fail"] == 0 and s["error"] == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
