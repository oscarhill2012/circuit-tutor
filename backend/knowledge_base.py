"""Curated GCSE circuits knowledge base.

Every entry has a stable id used as a source_id in the tutor's fact_checks
array. Only facts in this file may be cited by the tutor at runtime — the
backend enforces that by retrieving exclusively from KB_ENTRIES.
"""

KB_ENTRIES = [
    # --- Core quantities ---------------------------------------------------
    {
        "id": "kb.current.definition",
        "topic": "current",
        "tags": ["current", "charge", "ammeter"],
        "fact": "Current is the rate of flow of electric charge. It is measured in amperes (A) using an ammeter.",
        "level": "gcse",
    },
    {
        "id": "kb.voltage.definition",
        "topic": "voltage",
        "tags": ["voltage", "pd", "voltmeter", "energy"],
        "fact": "Potential difference (voltage) is the energy transferred per unit charge between two points. It is measured in volts (V) using a voltmeter.",
        "level": "gcse",
    },
    {
        "id": "kb.resistance.definition",
        "topic": "resistance",
        "tags": ["resistance", "ohms"],
        "fact": "Resistance opposes the flow of current. It is measured in ohms (Ω).",
        "level": "gcse",
    },
    {
        "id": "kb.power.definition",
        "topic": "power",
        "tags": ["power", "energy"],
        "fact": "Electrical power is the rate at which energy is transferred. It is measured in watts (W).",
        "level": "gcse",
    },

    # --- Formulas (verified GCSE spec) ------------------------------------
    {
        "id": "kb.formula.ohms_law",
        "topic": "ohms_law",
        "tags": ["ohms_law", "formula", "V", "I", "R"],
        "fact": "Ohm's law for an ohmic conductor at constant temperature: V = I × R, where V is potential difference in volts, I is current in amperes, and R is resistance in ohms.",
        "level": "gcse",
    },
    {
        "id": "kb.formula.power_vi",
        "topic": "power",
        "tags": ["power", "formula"],
        "fact": "Electrical power: P = V × I, where P is power in watts, V is potential difference in volts, and I is current in amperes.",
        "level": "gcse",
    },
    {
        "id": "kb.formula.energy_transferred",
        "topic": "energy",
        "tags": ["energy", "formula"],
        "fact": "Energy transferred by an electrical component: E = P × t = V × I × t, where E is energy in joules, P is power in watts, and t is time in seconds.",
        "level": "gcse",
    },
    {
        "id": "kb.formula.charge",
        "topic": "charge",
        "tags": ["charge", "formula"],
        "fact": "Charge flow: Q = I × t, where Q is charge in coulombs, I is current in amperes, and t is time in seconds.",
        "level": "gcse",
    },

    # --- Series circuit rules ---------------------------------------------
    {
        "id": "kb.series.current",
        "topic": "series",
        "tags": ["series", "current"],
        "fact": "In a series circuit the current is the same at every point.",
        "level": "gcse",
    },
    {
        "id": "kb.series.voltage",
        "topic": "series",
        "tags": ["series", "voltage"],
        "fact": "In a series circuit the total potential difference of the supply is shared between the components. The sum of the p.d.s across each component equals the supply p.d.",
        "level": "gcse",
    },
    {
        "id": "kb.series.resistance",
        "topic": "series",
        "tags": ["series", "resistance"],
        "fact": "In a series circuit the total resistance is the sum of the individual resistances: R_total = R1 + R2 + ...",
        "level": "gcse",
    },

    # --- Parallel circuit rules -------------------------------------------
    {
        "id": "kb.parallel.voltage",
        "topic": "parallel",
        "tags": ["parallel", "voltage"],
        "fact": "In a parallel circuit the potential difference across each branch is the same and equal to the supply p.d.",
        "level": "gcse",
    },
    {
        "id": "kb.parallel.current",
        "topic": "parallel",
        "tags": ["parallel", "current"],
        "fact": "In a parallel circuit the total current from the supply is the sum of the currents in each branch.",
        "level": "gcse",
    },
    {
        "id": "kb.parallel.resistance",
        "topic": "parallel",
        "tags": ["parallel", "resistance"],
        "fact": "Adding resistors in parallel decreases the total resistance of the circuit because there are more paths for current to flow.",
        "level": "gcse",
    },

    # --- Meters ------------------------------------------------------------
    {
        "id": "kb.ammeter.placement",
        "topic": "meters",
        "tags": ["ammeter", "series"],
        "fact": "An ammeter is always connected in series with the component whose current you want to measure. An ideal ammeter has zero resistance.",
        "level": "gcse",
    },
    {
        "id": "kb.voltmeter.placement",
        "topic": "meters",
        "tags": ["voltmeter", "parallel"],
        "fact": "A voltmeter is always connected in parallel across the component whose potential difference you want to measure. An ideal voltmeter has very high resistance.",
        "level": "gcse",
    },

    # --- Components -------------------------------------------------------
    {
        "id": "kb.cell_vs_battery",
        "topic": "components",
        "tags": ["cell", "battery"],
        "fact": "A cell is a single source of p.d. A battery is two or more cells connected together.",
        "level": "gcse",
    },
    {
        "id": "kb.switch.role",
        "topic": "components",
        "tags": ["switch"],
        "fact": "A closed switch allows current to flow; an open switch breaks the circuit so no current flows.",
        "level": "gcse",
    },
    {
        "id": "kb.bulb.behaviour",
        "topic": "components",
        "tags": ["bulb", "resistance", "temperature"],
        "fact": "A filament bulb is a non-ohmic component: its resistance increases as it heats up, so current is not directly proportional to p.d.",
        "level": "gcse",
    },

    # --- Symbols (recognition) --------------------------------------------
    {
        "id": "kb.symbols.standard",
        "topic": "symbols",
        "tags": ["symbols"],
        "fact": "Standard GCSE circuit symbols include: cell (long and short parallel lines), battery (two or more cells in series), switch (gap with lever), bulb (cross inside a circle), fixed resistor (rectangle), variable resistor (rectangle with arrow), ammeter (A in a circle), voltmeter (V in a circle).",
        "level": "gcse",
    },

    # --- Fault-finding & misconceptions -----------------------------------
    {
        "id": "kb.fault.open_circuit",
        "topic": "faults",
        "tags": ["open", "break", "no_current"],
        "fact": "If there is a break anywhere in a series circuit, no current flows anywhere in that loop.",
        "level": "gcse",
    },
    {
        "id": "kb.fault.short_circuit",
        "topic": "faults",
        "tags": ["short_circuit"],
        "fact": "A short circuit is a very low-resistance path that bypasses components, causing a very large current that can damage the supply or wires.",
        "level": "gcse",
    },
    {
        "id": "kb.misconception.current_used_up",
        "topic": "misconceptions",
        "tags": ["misconception", "current"],
        "fact": "Current is not 'used up' by components. The same current leaves and returns to the cell in a series loop; energy is transferred by the components, not current.",
        "level": "gcse",
    },
    {
        "id": "kb.misconception.voltmeter_in_series",
        "topic": "misconceptions",
        "tags": ["misconception", "voltmeter"],
        "fact": "A voltmeter placed in series (in line with a component) will not read the p.d. across that component and, because of its very high resistance, will prevent normal current from flowing.",
        "level": "gcse",
    },
    {
        "id": "kb.misconception.ammeter_in_parallel",
        "topic": "misconceptions",
        "tags": ["misconception", "ammeter"],
        "fact": "An ammeter connected in parallel across a component acts like a short circuit because of its very low resistance and can damage the circuit.",
        "level": "gcse",
    },
]


def all_ids():
    return [e["id"] for e in KB_ENTRIES]


def retrieve(tags=None, topic=None, limit=6):
    """Tiny retrieval helper. The production backend can swap this for an
    embedding search; at build time we just expose tag/topic filtering so the
    generator can demonstrate how retrieval slots into the tutor prompt."""
    results = []
    for entry in KB_ENTRIES:
        if topic and entry["topic"] != topic:
            continue
        if tags and not set(tags).intersection(entry["tags"]):
            continue
        results.append(entry)
        if len(results) >= limit:
            break
    return results
