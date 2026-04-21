// Mirror of frontend/api/knowledge_base.json for client-side retrieval.
// MUST stay in sync with the JSON (tutor.py loads the JSON; this file is
// used by the frontend so it can do client-side retrieval without an extra
// network round-trip). If you edit one, edit both.

export const PINNED = [
  {
    "id": "safe.topic_boundary",
    "topic": "safety",
    "tags": ["safety", "scope"],
    "fact": "Teach only electronic circuits and directly related GCSE physics. If asked about anything else, respond exactly: \"I am only here to teach you about circuits\"."
  },
  {
    "id": "safe.no_invention",
    "topic": "safety",
    "tags": ["safety", "grounding"],
    "fact": "Never invent formulas, numbers, component behaviour, or physics rules. Every physics claim must be traceable to retrieved snippet ids."
  },
  {
    "id": "safe.analysis_priority",
    "topic": "safety",
    "tags": ["analysis", "grounding"],
    "fact": "Treat server-computed analysis as authoritative for the current circuit."
  },
  {
    "id": "safe.concise_one_move",
    "topic": "pedagogy",
    "tags": ["pedagogy", "concise"],
    "fact": "Use one main teaching move per turn and keep the reply brief."
  }
];

export const ENTRIES = [
  { id: 'kb.current.definition', topic: 'current', tags: ['current', 'charge', 'ammeter', 'definition'], fact: 'Current is the rate of flow of electric charge. It is measured in amperes (A) using an ammeter.' },
  { id: 'kb.voltage.definition', topic: 'voltage', tags: ['voltage', 'pd', 'voltmeter', 'energy', 'definition'], fact: 'Potential difference is the energy transferred per unit charge between two points. It is measured in volts (V) using a voltmeter.' },
  { id: 'kb.resistance.definition', topic: 'resistance', tags: ['resistance', 'ohms', 'definition'], fact: 'Resistance opposes the flow of current. It is measured in ohms (Ω).' },
  { id: 'kb.power.definition', topic: 'power', tags: ['power', 'definition'], fact: 'Electrical power is the rate at which energy is transferred. It is measured in watts (W).' },

  { id: 'kb.formula.ohms_law', topic: 'ohms_law', tags: ['formula', 'ohms_law', 'canonical'], fact: "Ohm's law for an ohmic conductor at constant temperature: V = I × R." },
  { id: 'kb.formula.power_vi', topic: 'power', tags: ['formula', 'power', 'canonical'], fact: 'Electrical power: P = V × I.' },
  { id: 'kb.formula.energy_transferred', topic: 'energy', tags: ['formula', 'energy', 'canonical'], fact: 'Energy transferred by an electrical component: E = P × t = V × I × t.' },
  { id: 'kb.formula.charge', topic: 'charge', tags: ['formula', 'charge', 'canonical'], fact: 'Charge flow: Q = I × t.' },

  { id: 'kb.series.current', topic: 'series', tags: ['series', 'current', 'rule'], fact: 'In a series circuit the current is the same at every point.' },
  { id: 'kb.series.voltage', topic: 'series', tags: ['series', 'voltage', 'rule'], fact: 'In a series circuit the supply potential difference is shared between the components. The sum of the p.d.s across the components equals the supply p.d.' },
  { id: 'kb.series.resistance', topic: 'series', tags: ['series', 'resistance', 'rule'], fact: 'In a series circuit the total resistance is the sum of the individual resistances.' },

  { id: 'kb.parallel.voltage', topic: 'parallel', tags: ['parallel', 'voltage', 'rule'], fact: 'In a parallel circuit the potential difference across each branch is the same and equal to the supply p.d.' },
  { id: 'kb.parallel.current', topic: 'parallel', tags: ['parallel', 'current', 'rule'], fact: 'In a parallel circuit the total current from the supply is the sum of the currents in each branch.' },
  { id: 'kb.parallel.resistance', topic: 'parallel', tags: ['parallel', 'resistance', 'rule'], fact: 'Adding resistors in parallel decreases the total resistance because there are more paths for current to flow.' },

  { id: 'kb.ammeter.placement', topic: 'meters', tags: ['ammeter', 'series', 'meter', 'placement'], fact: 'An ammeter is connected in series with the component whose current you want to measure. An ideal ammeter has very low resistance.' },
  { id: 'kb.voltmeter.placement', topic: 'meters', tags: ['voltmeter', 'parallel', 'meter', 'placement'], fact: 'A voltmeter is connected in parallel across the component whose potential difference you want to measure. An ideal voltmeter has very high resistance.' },

  { id: 'kb.cell_vs_battery', topic: 'components', tags: ['cell', 'battery', 'definition'], fact: 'A cell is a single source of potential difference. A battery is two or more cells connected together.' },
  { id: 'kb.switch.role', topic: 'components', tags: ['switch', 'open', 'closed'], fact: 'A closed switch allows current to flow. An open switch breaks the circuit so no current flows.' },
  { id: 'kb.bulb.behaviour', topic: 'components', tags: ['bulb', 'non_ohmic', 'resistance'], fact: 'A filament bulb is non-ohmic. Its resistance increases as it heats up.' },
  { id: 'kb.symbols.standard', topic: 'symbols', tags: ['symbols', 'components'], fact: 'Standard GCSE circuit symbols include cell, battery, switch, bulb, fixed resistor, variable resistor, ammeter, and voltmeter.' },

  { id: 'kb.fault.open_circuit', topic: 'faults', tags: ['open_circuit', 'break', 'fault'], fact: 'If there is a break anywhere in a series circuit, no current flows anywhere in that loop.' },
  { id: 'kb.fault.short_circuit', topic: 'faults', tags: ['short_circuit', 'fault', 'safety'], fact: 'A short circuit is a very low-resistance path that bypasses components, causing a very large current that can damage the supply or wires.' },

  { id: 'kb.misconception.current_used_up', topic: 'misconceptions', tags: ['misconception', 'current', 'energy'], fact: 'Current is not used up by components. Energy is transferred by the components, not current.' },
  { id: 'kb.misconception.voltage_flows', topic: 'misconceptions', tags: ['misconception', 'voltage'], fact: 'Voltage does not flow around a circuit. Potential difference describes energy transferred per unit charge between two points.' },
  { id: 'kb.misconception.battery_fixed_current', topic: 'misconceptions', tags: ['misconception', 'battery', 'current'], fact: 'A cell or battery provides potential difference. The current depends on the total resistance of the circuit.' },
  { id: 'kb.misconception.voltmeter_in_series', topic: 'misconceptions', tags: ['misconception', 'voltmeter', 'meter'], fact: 'A voltmeter placed in series will not correctly measure the potential difference across a component and will prevent normal current from flowing.' },
  { id: 'kb.misconception.ammeter_in_parallel', topic: 'misconceptions', tags: ['misconception', 'ammeter', 'meter', 'short_circuit'], fact: 'An ammeter connected in parallel across a component acts like a short circuit and can damage the circuit.' },
  { id: 'kb.misconception.parallel_more_paths', topic: 'misconceptions', tags: ['misconception', 'parallel', 'resistance'], fact: 'Parallel branches give more paths for current, which decreases total resistance.' },
  { id: 'kb.misconception.series_brightness', topic: 'misconceptions', tags: ['misconception', 'series', 'bulb'], fact: 'In a simple series circuit with identical bulbs, the same current flows through each bulb.' },

  { id: 'kb.check.units_current', topic: 'check_work', tags: ['units', 'current', 'check_work'], fact: 'Current should be given in amperes (A).' },
  { id: 'kb.check.units_voltage', topic: 'check_work', tags: ['units', 'voltage', 'check_work'], fact: 'Potential difference should be given in volts (V).' },
  { id: 'kb.check.units_resistance', topic: 'check_work', tags: ['units', 'resistance', 'check_work'], fact: 'Resistance should be given in ohms (Ω).' },
  { id: 'kb.check.units_power', topic: 'check_work', tags: ['units', 'power', 'check_work'], fact: 'Power should be given in watts (W).' },

  { id: 'kb.tutor.observe_before_explain', topic: 'pedagogy', tags: ['pedagogy', 'hint'], fact: 'When possible, first direct the student to notice one visible feature of the circuit before explaining the rule.' },
  { id: 'kb.tutor.one_question', topic: 'pedagogy', tags: ['pedagogy', 'question'], fact: 'Ask at most one short Socratic question per turn.' },
  { id: 'kb.tutor.one_concept', topic: 'pedagogy', tags: ['pedagogy', 'focus'], fact: 'Teach one concept per reply to reduce overload.' },
  { id: 'kb.tutor.shortest_helpful_response', topic: 'pedagogy', tags: ['pedagogy', 'concise', 'style'], fact: 'Use the shortest response that still helps the student make progress.' },
  { id: 'kb.tutor.priority_first_error', topic: 'pedagogy', tags: ['pedagogy', 'priority', 'correction'], fact: 'If multiple issues are present, address the highest-priority error first rather than explaining everything at once.' },
];

// Tokenise on word chars; lowercase. Drop short/common words.
const STOP = new Set(['the','a','an','is','it','to','of','and','or','in','on','at','for','with','how','what','why','do','does','i','my','me','can','be','as','if','this','that','are','was','were','will','would','should','could','have','has','had','not','no','yes','but','so','you','your','we','us','they','them','their','there','here']);
function tokens(s) {
  return (s || '').toString().toLowerCase().match(/[a-z0-9]+/g)?.filter(t => t.length > 1 && !STOP.has(t)) || [];
}

// Rank ENTRIES by simple term overlap against the query + optional topic hint.
// Returns the top `limit` entries (excluding pinned — those are added separately).
export function retrieve(query, { topic = null, limit = 8 } = {}) {
  const qTokens = new Set(tokens(query));
  if (topic) qTokens.add(String(topic).toLowerCase());
  if (qTokens.size === 0) return ENTRIES.slice(0, limit);

  const scored = ENTRIES.map(e => {
    const hay = new Set([...tokens(e.fact), ...e.tags.map(t => t.toLowerCase()), e.topic.toLowerCase()]);
    let score = 0;
    for (const t of qTokens) if (hay.has(t)) score++;
    if (topic && e.topic.toLowerCase() === String(topic).toLowerCase()) score += 2;
    return { e, score };
  }).sort((a, b) => b.score - a.score);

  const top = scored.filter(s => s.score > 0).slice(0, limit).map(s => s.e);
  if (top.length >= Math.min(limit, 3)) return top;
  // Fallback: if nothing matched, return the first N entries so the model has something.
  return ENTRIES.slice(0, limit);
}
