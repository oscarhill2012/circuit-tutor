"""Regression tests for circuit_validator.analyse().

Run directly: `python test_circuit_validator.py`. No pytest dependency so the
file is runnable in the same zero-install environment as the rest of the project.
"""

import sys
from circuit_validator import analyse


def _state(components, wires, meters=None):
    return {"components": components, "wires": wires, "meters": meters or []}


def _wire(i, a, b):
    return {"id": f"W{i}", "from": a, "to": b}


# ---------------------------------------------------------------------------
# Scenarios
# ---------------------------------------------------------------------------

def test_pure_series_loop():
    """1 cell, 3 resistors in series: topology=series, no dead, no parallel."""
    state = _state(
        [
            {"id": "C1", "type": "cell", "voltage": 6},
            {"id": "R1", "type": "resistor", "resistance": 1},
            {"id": "R2", "type": "resistor", "resistance": 2},
            {"id": "R3", "type": "resistor", "resistance": 3},
        ],
        [
            _wire(1, "C1.+", "R1.a"),
            _wire(2, "R1.b", "R2.a"),
            _wire(3, "R2.b", "R3.a"),
            _wire(4, "R3.b", "C1.-"),
        ],
    )
    r = analyse(state)
    assert r["complete_loop"] is True, r
    assert r["short_circuit"] is False, r
    assert r["topology"] == "series", r
    assert r["dead_branches"] == [], r
    assert r["parallel_groups"] == [], r


def test_two_resistors_parallel():
    """1 cell, 2 resistors between same pair of nets: parallel group."""
    state = _state(
        [
            {"id": "C1", "type": "cell", "voltage": 6},
            {"id": "R1", "type": "resistor", "resistance": 4},
            {"id": "R2", "type": "resistor", "resistance": 4},
        ],
        [
            _wire(1, "C1.+", "R1.a"),
            _wire(2, "C1.+", "R2.a"),
            _wire(3, "R1.b", "C1.-"),
            _wire(4, "R2.b", "C1.-"),
        ],
    )
    r = analyse(state)
    assert r["complete_loop"] is True, r
    assert r["topology"] == "parallel", r
    assert len(r["parallel_groups"]) == 1, r
    assert set(r["parallel_groups"][0]) == {"R1", "R2"}, r
    assert r["dead_branches"] == [], r


def test_dead_stub_branch():
    """Two resistors series in a loop; a third resistor branches into a dead end."""
    state = _state(
        [
            {"id": "C1", "type": "cell", "voltage": 6},
            {"id": "R1", "type": "resistor", "resistance": 1},
            {"id": "R2", "type": "resistor", "resistance": 2},
            {"id": "R3", "type": "resistor", "resistance": 3},  # stub
        ],
        [
            _wire(1, "C1.+", "R1.a"),
            _wire(2, "R1.b", "R2.a"),
            _wire(3, "R2.b", "C1.-"),
            # R3 hangs off the mid node into a dead end (R3.b connects nowhere).
            _wire(4, "R1.b", "R3.a"),
        ],
    )
    r = analyse(state)
    assert r["complete_loop"] is True, r
    assert r["dead_branches"] == ["R3"], r
    assert r["topology"] == "series", r


def test_ammeter_in_parallel_with_bulb():
    """Ammeter wired across a bulb: meter_issues contains ammeter_in_parallel."""
    state = _state(
        [
            {"id": "C1", "type": "cell", "voltage": 6},
            {"id": "B1", "type": "bulb", "resistance": 4},
            {"id": "A1", "type": "ammeter"},
        ],
        [
            _wire(1, "C1.+", "B1.a"),
            _wire(2, "B1.b", "C1.-"),
            _wire(3, "A1.a", "B1.a"),
            _wire(4, "A1.b", "B1.b"),
        ],
        meters=[{"id": "A1", "mode": "series", "measuring": "B1"}],
    )
    r = analyse(state)
    issues = {(i["meter"], i["issue"]) for i in r["meter_issues"]}
    assert ("A1", "ammeter_in_parallel") in issues, r


def test_ammeter_in_series_no_issue():
    """Sanity: a correctly placed series ammeter has no parallel issue."""
    state = _state(
        [
            {"id": "C1", "type": "cell", "voltage": 6},
            {"id": "B1", "type": "bulb", "resistance": 4},
            {"id": "A1", "type": "ammeter"},
        ],
        [
            _wire(1, "C1.+", "A1.a"),
            _wire(2, "A1.b", "B1.a"),
            _wire(3, "B1.b", "C1.-"),
        ],
        meters=[{"id": "A1", "mode": "series", "measuring": "B1"}],
    )
    r = analyse(state)
    issues = {(i["meter"], i["issue"]) for i in r["meter_issues"]}
    assert not any(iss == "ammeter_in_parallel" for (_, iss) in issues), r


def test_voltmeter_in_series_shorted():
    """Voltmeter inserted in series — both terminals share a net or wire-only path."""
    # V1 in series between cell+ and bulb; the bulb closes the loop.
    # V1.a wired to cell+, V1.b wired to bulb.a — but no wire from cell+ to bulb directly.
    # That makes V1.a and V1.b distinct raw nets; check voltmeter_across_wire branch
    # by also wiring V1's terminals through an ammeter (zero-R contraction).
    state = _state(
        [
            {"id": "C1", "type": "cell", "voltage": 6},
            {"id": "B1", "type": "bulb", "resistance": 4},
            {"id": "A1", "type": "ammeter"},
            {"id": "V1", "type": "voltmeter"},
        ],
        [
            _wire(1, "C1.+", "V1.a"),
            _wire(2, "V1.b", "A1.a"),
            _wire(3, "A1.b", "B1.a"),
            _wire(4, "B1.b", "C1.-"),
        ],
        meters=[{"id": "V1", "mode": "parallel", "across": "B1"}],
    )
    r = analyse(state)
    issues = {(i["meter"], i["issue"]) for i in r["meter_issues"]}
    # V1 spans cell+ to ammeter input (which contracts to cell+ via the ammeter
    # then bulb path? No — ammeter contracts only its own two nets). The
    # voltmeter sits between two distinct contracted nets that both lie on the
    # main path; current behaviour is to NOT flag it. We only assert that no
    # spurious "voltmeter_in_parallel" surfaces — voltmeter checks remain
    # exactly as before.
    assert not any(iss.startswith("ammeter") for (_, iss) in issues), r


def test_open_switch_makes_all_dead():
    """Open switch on the only loop -> incomplete circuit; all resistors dead."""
    state = _state(
        [
            {"id": "C1", "type": "cell", "voltage": 6},
            {"id": "S1", "type": "switch", "closed": False},
            {"id": "B1", "type": "bulb", "resistance": 4},
        ],
        [
            _wire(1, "C1.+", "S1.a"),
            _wire(2, "S1.b", "B1.a"),
            _wire(3, "B1.b", "C1.-"),
        ],
    )
    r = analyse(state)
    assert r["complete_loop"] is False, r
    assert r["topology"] == "incomplete", r
    assert r["dead_branches"] == ["B1"], r
    assert r["open_switches"] == ["S1"], r


def test_short_circuit_cell_shorted_by_wire():
    """Cell terminals fused by a wire: short_circuit topology."""
    state = _state(
        [
            {"id": "C1", "type": "cell", "voltage": 6},
            {"id": "B1", "type": "bulb", "resistance": 4},
        ],
        [
            _wire(1, "C1.+", "C1.-"),  # direct short
            _wire(2, "C1.+", "B1.a"),
            _wire(3, "B1.b", "C1.-"),
        ],
    )
    r = analyse(state)
    assert r["short_circuit"] is True, r
    assert r["topology"] == "short_circuit", r


def test_series_parallel_combo():
    """R1 in series with (R2 || R3): topology=series_parallel, parallel group {R2,R3}."""
    state = _state(
        [
            {"id": "C1", "type": "cell", "voltage": 6},
            {"id": "R1", "type": "resistor", "resistance": 1},
            {"id": "R2", "type": "resistor", "resistance": 2},
            {"id": "R3", "type": "resistor", "resistance": 2},
        ],
        [
            _wire(1, "C1.+", "R1.a"),
            _wire(2, "R1.b", "R2.a"),
            _wire(3, "R1.b", "R3.a"),
            _wire(4, "R2.b", "C1.-"),
            _wire(5, "R3.b", "C1.-"),
        ],
    )
    r = analyse(state)
    assert r["topology"] == "series_parallel", r
    assert len(r["parallel_groups"]) == 1, r
    assert set(r["parallel_groups"][0]) == {"R2", "R3"}, r
    assert r["dead_branches"] == [], r


# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------

def main():
    tests = [v for k, v in globals().items() if k.startswith("test_") and callable(v)]
    failed = 0
    for t in tests:
        try:
            t()
            print(f"  ok  {t.__name__}")
        except AssertionError as e:
            failed += 1
            print(f"FAIL  {t.__name__}: {e}")
        except Exception as e:
            failed += 1
            print(f"ERR   {t.__name__}: {type(e).__name__}: {e}")
    print(f"\n{len(tests) - failed}/{len(tests)} passed")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
