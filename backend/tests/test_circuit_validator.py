"""Canonical-case tests for circuit_validator.analyse.

Run with:  python -m unittest backend/tests/test_circuit_validator.py
or simply: python backend/tests/test_circuit_validator.py
"""
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.abspath(os.path.join(HERE, "..")))

from circuit_validator import analyse  # noqa: E402


def cell(id_="C1", v=6):
    return {"id": id_, "type": "cell", "voltage": v}


def bulb(id_, r=4):
    return {"id": id_, "type": "bulb", "resistance": r}


def resistor(id_, r=10):
    return {"id": id_, "type": "resistor", "resistance": r}


def sw(id_, closed=True):
    return {"id": id_, "type": "switch", "closed": closed}


def wire(a, b, id_=None):
    return {"id": id_ or f"W_{a}_{b}", "from": a, "to": b}


class TestSeries(unittest.TestCase):
    def test_single_bulb_series_loop(self):
        state = {
            "components": [cell(), bulb("B1")],
            "wires": [
                wire("C1.+", "B1.a"),
                wire("B1.b", "C1.-"),
            ],
            "meters": [],
        }
        r = analyse(state)
        self.assertTrue(r["complete_loop"])
        self.assertFalse(r["short_circuit"])
        self.assertEqual(r["topology"], "series")
        self.assertEqual(r["parallel_groups"], [])
        self.assertEqual(r["dead_branches"], [])

    def test_two_bulbs_series(self):
        state = {
            "components": [cell(), bulb("B1"), bulb("B2")],
            "wires": [
                wire("C1.+", "B1.a"),
                wire("B1.b", "B2.a"),
                wire("B2.b", "C1.-"),
            ],
            "meters": [],
        }
        r = analyse(state)
        self.assertEqual(r["topology"], "series")
        self.assertEqual(r["parallel_groups"], [])


class TestParallel(unittest.TestCase):
    def test_two_bulbs_parallel(self):
        state = {
            "components": [cell(), bulb("B1"), bulb("B2")],
            "wires": [
                wire("C1.+", "B1.a"),
                wire("C1.+", "B2.a"),
                wire("B1.b", "C1.-"),
                wire("B2.b", "C1.-"),
            ],
            "meters": [],
        }
        r = analyse(state)
        self.assertTrue(r["complete_loop"])
        self.assertFalse(r["short_circuit"])
        self.assertEqual(r["topology"], "parallel")
        self.assertEqual(len(r["parallel_groups"]), 1)
        self.assertEqual(set(r["parallel_groups"][0]), {"B1", "B2"})

    def test_series_parallel_mixed(self):
        # R1 in series with (B1 || B2)
        state = {
            "components": [cell(), resistor("R1"), bulb("B1"), bulb("B2")],
            "wires": [
                wire("C1.+", "R1.a"),
                wire("R1.b", "B1.a"),
                wire("R1.b", "B2.a"),
                wire("B1.b", "C1.-"),
                wire("B2.b", "C1.-"),
            ],
            "meters": [],
        }
        r = analyse(state)
        self.assertEqual(r["topology"], "series_parallel")
        self.assertEqual(len(r["parallel_groups"]), 1)
        self.assertEqual(set(r["parallel_groups"][0]), {"B1", "B2"})


class TestBroken(unittest.TestCase):
    def test_open_circuit(self):
        state = {
            "components": [cell(), bulb("B1")],
            "wires": [wire("C1.+", "B1.a")],  # missing return
            "meters": [],
        }
        r = analyse(state)
        self.assertFalse(r["complete_loop"])
        self.assertEqual(r["topology"], "incomplete")

    def test_open_switch_breaks_only_loop(self):
        state = {
            "components": [cell(), sw("S1", closed=False), bulb("B1")],
            "wires": [
                wire("C1.+", "S1.a"),
                wire("S1.b", "B1.a"),
                wire("B1.b", "C1.-"),
            ],
            "meters": [],
        }
        r = analyse(state)
        self.assertFalse(r["complete_loop"])
        self.assertEqual(r["topology"], "incomplete")

    def test_open_switch_on_side_branch_does_not_kill_loop(self):
        # Main loop: C1 -> B1 -> C1. Side branch with open switch + B2.
        state = {
            "components": [cell(), bulb("B1"), sw("S1", closed=False), bulb("B2")],
            "wires": [
                wire("C1.+", "B1.a"),
                wire("B1.b", "C1.-"),
                wire("C1.+", "S1.a"),
                wire("S1.b", "B2.a"),
                wire("B2.b", "C1.-"),
            ],
            "meters": [],
        }
        r = analyse(state)
        self.assertTrue(r["complete_loop"],
                        "open switch on a side branch must not disable the main loop")
        # B2 is unreachable through an open switch -> dead branch.
        self.assertIn("B2", r["dead_branches"])
        self.assertNotIn("B1", r["dead_branches"])

    def test_short_circuit_wire_across_cell(self):
        state = {
            "components": [cell(), bulb("B1")],
            "wires": [
                wire("C1.+", "C1.-"),  # direct short
                wire("C1.+", "B1.a"),
                wire("B1.b", "C1.-"),
            ],
            "meters": [],
        }
        r = analyse(state)
        self.assertTrue(r["short_circuit"])
        self.assertEqual(r["topology"], "short_circuit")


class TestMeters(unittest.TestCase):
    def test_ammeter_in_series_ok(self):
        state = {
            "components": [cell(), sw("S1"), bulb("B1"),
                           {"id": "A1", "type": "ammeter"}],
            "wires": [
                wire("C1.+", "S1.a"),
                wire("S1.b", "A1.a"),
                wire("A1.b", "B1.a"),
                wire("B1.b", "C1.-"),
            ],
            "meters": [{"id": "A1", "mode": "series", "measuring": "B1"}],
        }
        r = analyse(state)
        self.assertTrue(r["complete_loop"])
        self.assertEqual(r["meter_issues"], [])

    def test_ammeter_in_parallel_flagged(self):
        # A1 wired across B1 -> would short it.
        state = {
            "components": [cell(), bulb("B1"),
                           {"id": "A1", "type": "ammeter"}],
            "wires": [
                wire("C1.+", "B1.a"),
                wire("B1.b", "C1.-"),
                wire("A1.a", "B1.a"),
                wire("A1.b", "B1.b"),
            ],
            "meters": [{"id": "A1", "mode": "parallel", "across": "B1"}],
        }
        r = analyse(state)
        issues = {i["issue"] for i in r["meter_issues"]}
        self.assertTrue(any("ammeter" in x for x in issues),
                        f"expected an ammeter wiring issue, got {r['meter_issues']}")

    def test_voltmeter_in_parallel_ok(self):
        state = {
            "components": [cell(), bulb("B1"),
                           {"id": "V1", "type": "voltmeter"}],
            "wires": [
                wire("C1.+", "B1.a"),
                wire("B1.b", "C1.-"),
                wire("V1.a", "B1.a"),
                wire("V1.b", "B1.b"),
            ],
            "meters": [{"id": "V1", "mode": "parallel", "across": "B1"}],
        }
        r = analyse(state)
        self.assertEqual(r["meter_issues"], [])

    def test_voltmeter_shorted_flagged(self):
        # Both voltmeter leads on the same net.
        state = {
            "components": [cell(), bulb("B1"),
                           {"id": "V1", "type": "voltmeter"}],
            "wires": [
                wire("C1.+", "B1.a"),
                wire("B1.b", "C1.-"),
                wire("V1.a", "B1.a"),
                wire("V1.b", "B1.a"),
            ],
            "meters": [{"id": "V1", "mode": "parallel", "across": "B1"}],
        }
        r = analyse(state)
        self.assertTrue(any(i["issue"].startswith("voltmeter") for i in r["meter_issues"]),
                        f"expected voltmeter issue, got {r['meter_issues']}")


if __name__ == "__main__":
    unittest.main()
