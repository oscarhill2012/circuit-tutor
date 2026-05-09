"""Verify the ammeter-issue → misconception_id mapping is split:
ammeter_shorted_by_wire (terminals on same junction) and
ammeter_in_parallel (across a load) point to distinct KB entries.
"""

from circuit_validator import analyse


def _ammeter_terminals_shorted_circuit():
    """Both ammeter terminals tied to the same node — a wiring slip."""
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
            {"id": "W4", "from": "A1.b", "to": "B1.a"},
        ],
        "meters": [{"id": "A1", "mode": "series"}],
    }


def _ammeter_in_parallel_circuit():
    """A1 across B1 — genuine pedagogical error."""
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
        "meters": [{"id": "A1", "mode": "series"}],
    }


def test_ammeter_terminals_shorted_uses_distinct_misconception():
    result = analyse(_ammeter_terminals_shorted_circuit())
    issues = [m for m in result.get("meter_issues", []) if m.get("issue") == "ammeter_shorted_by_wire"]
    assert issues, f"expected ammeter_shorted_by_wire issue, got {result.get('meter_issues')}"
    assert issues[0]["misconception_id"] == "kb.misconception.ammeter_terminals_shorted"


def test_ammeter_in_parallel_unchanged():
    result = analyse(_ammeter_in_parallel_circuit())
    issues = [m for m in result.get("meter_issues", []) if m.get("issue") == "ammeter_in_parallel"]
    assert issues, f"expected ammeter_in_parallel issue, got {result.get('meter_issues')}"
    assert issues[0]["misconception_id"] == "kb.misconception.ammeter_in_parallel"
