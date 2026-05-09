"""Reusable circuit fixtures for the agent probe suite.

Each fixture returns a `circuit_state` dict in the shape `api/tools.py`
expects. Probes in probes.py reference these by name.
"""

from __future__ import annotations

from typing import Any


def working_series_loop() -> dict[str, Any]:
    return {
        "components": [
            {"id": "C1", "type": "cell", "props": {"voltage": 6}},
            {"id": "S1", "type": "switch", "props": {"closed": True}},
            {"id": "B1", "type": "bulb", "props": {"resistance": 4}},
            {"id": "A1", "type": "ammeter"},
        ],
        "wires": [
            {"id": "W1", "from": "C1.+", "to": "S1.a"},
            {"id": "W2", "from": "S1.b", "to": "A1.a"},
            {"id": "W3", "from": "A1.b", "to": "B1.a"},
            {"id": "W4", "from": "B1.b", "to": "C1.-"},
        ],
        "meters": [{"id": "A1", "mode": "series", "measuring": "B1"}],
    }


def voltmeter_in_main_loop() -> dict[str, Any]:
    """V1 wired into the main loop (canonical misconception)."""
    return {
        "components": [
            {"id": "C1", "type": "cell", "props": {"voltage": 6}},
            {"id": "V1", "type": "voltmeter"},
            {"id": "L1", "type": "bulb", "props": {"resistance": 4}},
        ],
        "wires": [
            {"id": "W1", "from": "C1.+", "to": "V1.a"},
            {"id": "W2", "from": "V1.b", "to": "L1.a"},
            {"id": "W3", "from": "L1.b", "to": "C1.-"},
        ],
        "meters": [{"id": "V1", "mode": "series"}],
    }


def voltmeter_shorted() -> dict[str, Any]:
    """A working loop with V1 shorted across one node."""
    return {
        "components": [
            {"id": "C1", "type": "cell", "props": {"voltage": 6}},
            {"id": "B1", "type": "bulb", "props": {"resistance": 4}},
            {"id": "V1", "type": "voltmeter"},
        ],
        "wires": [
            {"id": "W1", "from": "C1.+", "to": "B1.a"},
            {"id": "W2", "from": "B1.b", "to": "C1.-"},
            {"id": "W3", "from": "V1.a", "to": "B1.a"},
            {"id": "W4", "from": "V1.b", "to": "B1.a"},
        ],
        "meters": [{"id": "V1", "mode": "parallel"}],
    }


def open_switch() -> dict[str, Any]:
    return {
        "components": [
            {"id": "C1", "type": "cell", "props": {"voltage": 6}},
            {"id": "S1", "type": "switch", "props": {"closed": False}},
            {"id": "B1", "type": "bulb", "props": {"resistance": 4}},
        ],
        "wires": [
            {"id": "W1", "from": "C1.+", "to": "S1.a"},
            {"id": "W2", "from": "S1.b", "to": "B1.a"},
            {"id": "W3", "from": "B1.b", "to": "C1.-"},
        ],
        "meters": [],
    }


def dead_short() -> dict[str, Any]:
    """Cell terminals wired directly together — dead short."""
    return {
        "components": [
            {"id": "C1", "type": "cell", "props": {"voltage": 6}},
            {"id": "B1", "type": "bulb", "props": {"resistance": 4}},
        ],
        "wires": [
            {"id": "W1", "from": "C1.+", "to": "C1.-"},
            {"id": "W2", "from": "C1.+", "to": "B1.a"},
            {"id": "W3", "from": "B1.b", "to": "C1.-"},
        ],
        "meters": [],
    }


def ammeter_in_parallel() -> dict[str, Any]:
    """A1 wired across B1 instead of in series — short-circuits the bulb."""
    return {
        "components": [
            {"id": "C1", "type": "cell", "props": {"voltage": 6}},
            {"id": "B1", "type": "bulb", "props": {"resistance": 4}},
            {"id": "A1", "type": "ammeter"},
        ],
        "wires": [
            {"id": "W1", "from": "C1.+", "to": "B1.a"},
            {"id": "W2", "from": "B1.b", "to": "C1.-"},
            {"id": "W3", "from": "A1.a", "to": "B1.a"},
            {"id": "W4", "from": "A1.b", "to": "B1.b"},
        ],
        "meters": [{"id": "A1", "mode": "series", "measuring": "B1"}],
    }


def working_loop_with_sim() -> dict[str, Any]:
    """Companion sim_result for `working_series_loop`."""
    return {"meters": {"A1": {"value": 1.5, "status": "live"}}}


def empty_sim() -> dict[str, Any]:
    return {"meters": {}}
