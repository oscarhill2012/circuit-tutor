// Mirror of frontend/api/knowledge_base.json for client-side retrieval.
// MUST stay in sync with the JSON (tutor.py loads the JSON; this file is
// used by the frontend so it can do client-side retrieval without an extra
// network round-trip). If you edit one, edit both.
//
// Each entry has a `role` field: definition | rule | misconception | hint_seed | check.
// `retrieve()` post-processes the score-sorted top list to guarantee inclusion
// of one hint_seed and one misconception when available, so coaching turns
// don't get drowned in declarative entries.

// Safety/policy rules live in the system prompt (frontend/api/tutor.py).
// This KB carries physics only. PINNED is kept as an empty hook for future
// pinned-physics entries.
export const PINNED = [];

export const ENTRIES = [
  { id: 'kb.current.definition', topic: 'current', role: 'definition', tags: ['current', 'charge', 'ammeter', 'definition'], fact: 'Current is the rate of flow of electric charge. It is measured in amperes (A) using an ammeter.' },
  { id: 'kb.voltage.definition', topic: 'voltage', role: 'definition', tags: ['voltage', 'pd', 'voltmeter', 'energy', 'definition'], fact: 'Potential difference is the energy transferred per unit charge between two points. It is measured in volts (V) using a voltmeter.' },
  { id: 'kb.resistance.definition', topic: 'resistance', role: 'definition', tags: ['resistance', 'ohms', 'definition'], fact: 'Resistance opposes the flow of current. It is measured in ohms (Ω).' },
  { id: 'kb.power.definition', topic: 'power', role: 'definition', tags: ['power', 'definition'], fact: 'Electrical power is the rate at which energy is transferred. It is measured in watts (W).' },

  { id: 'kb.formula.ohms_law', topic: 'ohms_law', role: 'rule', tags: ['formula', 'ohms_law', 'canonical'], fact: "Ohm's law for an ohmic conductor at constant temperature: V = I × R." },
  { id: 'kb.formula.power_vi', topic: 'power', role: 'rule', tags: ['formula', 'power', 'canonical'], fact: 'Electrical power: P = V × I.' },
  { id: 'kb.formula.energy_transferred', topic: 'energy', role: 'rule', tags: ['formula', 'energy', 'canonical'], fact: 'Energy transferred by an electrical component: E = P × t = V × I × t.' },
  { id: 'kb.formula.charge', topic: 'charge', role: 'rule', tags: ['formula', 'charge', 'canonical'], fact: 'Charge flow: Q = I × t.' },
  { id: 'kb.formula.voltage_divider', topic: 'series', role: 'rule', tags: ['formula', 'series', 'voltage', 'divider'], fact: 'In a series circuit the supply p.d. divides between components in proportion to their resistance: a larger resistance takes a larger share of the supply p.d.' },

  { id: 'kb.series.current', topic: 'series', role: 'rule', tags: ['series', 'current', 'rule'], fact: 'In a series circuit the current is the same at every point.' },
  { id: 'kb.series.voltage', topic: 'series', role: 'rule', tags: ['series', 'voltage', 'rule'], fact: 'In a series circuit the supply potential difference is shared between the components. The sum of the p.d.s across the components equals the supply p.d.' },
  { id: 'kb.series.resistance', topic: 'series', role: 'rule', tags: ['series', 'resistance', 'rule'], fact: 'In a series circuit the total resistance is the sum of the individual resistances.' },

  { id: 'kb.parallel.voltage', topic: 'parallel', role: 'rule', tags: ['parallel', 'voltage', 'rule'], fact: 'In a parallel circuit the potential difference across each branch is the same and equal to the supply p.d.' },
  { id: 'kb.parallel.current', topic: 'parallel', role: 'rule', tags: ['parallel', 'current', 'rule'], fact: 'In a parallel circuit the total current from the supply is the sum of the currents in each branch.' },
  { id: 'kb.parallel.resistance', topic: 'parallel', role: 'rule', tags: ['parallel', 'resistance', 'rule'], fact: 'Adding resistors in parallel decreases the total resistance because there are more paths for current to flow.' },

  { id: 'kb.ammeter.placement', topic: 'meters', role: 'rule', tags: ['ammeter', 'series', 'meter', 'placement'], fact: 'An ammeter is connected in series with the component whose current you want to measure. An ideal ammeter has very low resistance.' },
  { id: 'kb.voltmeter.placement', topic: 'meters', role: 'rule', tags: ['voltmeter', 'parallel', 'meter', 'placement'], fact: 'A voltmeter is connected in parallel across the component whose potential difference you want to measure. An ideal voltmeter has very high resistance.' },

  { id: 'kb.cell_vs_battery', topic: 'components', role: 'definition', tags: ['cell', 'battery', 'definition'], fact: 'A cell is a single source of potential difference. A battery is two or more cells connected together.' },
  { id: 'kb.switch.role', topic: 'components', role: 'rule', tags: ['switch', 'open', 'closed'], fact: 'A closed switch allows current to flow. An open switch breaks the circuit so no current flows.' },
  { id: 'kb.bulb.behaviour', topic: 'components', role: 'rule', tags: ['bulb', 'non_ohmic', 'resistance'], fact: 'A filament bulb is non-ohmic. Its resistance increases as it heats up.' },
  { id: 'kb.symbols.standard', topic: 'symbols', role: 'definition', tags: ['symbols', 'components'], fact: 'Standard GCSE circuit symbols include cell, battery, switch, bulb, fixed resistor, variable resistor, ammeter, and voltmeter.' },

  { id: 'kb.fault.open_circuit', topic: 'faults', role: 'rule', tags: ['open_circuit', 'break', 'fault'], fact: 'If there is a break anywhere in a series circuit, no current flows anywhere in that loop.' },
  { id: 'kb.fault.short_circuit', topic: 'faults', role: 'rule', tags: ['short_circuit', 'fault', 'safety'], fact: 'A short circuit is a very low-resistance path that bypasses components, causing a very large current that can damage the supply or wires.' },

  { id: 'kb.misconception.current_used_up', topic: 'misconceptions', role: 'misconception', tags: ['misconception', 'current', 'energy'], fact: 'Current is not used up by components. Energy is transferred by the components, not current.' },
  { id: 'kb.misconception.voltage_flows', topic: 'misconceptions', role: 'misconception', tags: ['misconception', 'voltage'], fact: 'Voltage does not flow around a circuit. Potential difference describes energy transferred per unit charge between two points.' },
  { id: 'kb.misconception.battery_fixed_current', topic: 'misconceptions', role: 'misconception', tags: ['misconception', 'battery', 'current'], fact: 'A cell or battery provides potential difference. The current depends on the total resistance of the circuit.' },
  { id: 'kb.misconception.voltmeter_in_series', topic: 'misconceptions', role: 'misconception', tags: ['misconception', 'voltmeter', 'meter'], fact: 'A voltmeter placed in series will not correctly measure the potential difference across a component and will prevent normal current from flowing.' },
  { id: 'kb.misconception.ammeter_in_parallel', topic: 'misconceptions', role: 'misconception', tags: ['misconception', 'ammeter', 'meter', 'short_circuit'], fact: 'An ammeter connected in parallel across a component acts like a short circuit and can damage the circuit.' },
  { id: 'kb.misconception.parallel_more_paths', topic: 'misconceptions', role: 'misconception', tags: ['misconception', 'parallel', 'resistance'], fact: 'Parallel branches give more paths for current, which decreases total resistance.' },
  { id: 'kb.misconception.series_brightness', topic: 'misconceptions', role: 'misconception', tags: ['misconception', 'series', 'bulb'], fact: 'In a simple series circuit with identical bulbs, the same current flows through each bulb.' },

  { id: 'kb.check.units_current', topic: 'check_work', role: 'check', tags: ['units', 'current', 'check_work'], fact: 'Current should be given in amperes (A).' },
  { id: 'kb.check.units_voltage', topic: 'check_work', role: 'check', tags: ['units', 'voltage', 'check_work'], fact: 'Potential difference should be given in volts (V).' },
  { id: 'kb.check.units_resistance', topic: 'check_work', role: 'check', tags: ['units', 'resistance', 'check_work'], fact: 'Resistance should be given in ohms (Ω).' },
  { id: 'kb.check.units_power', topic: 'check_work', role: 'check', tags: ['units', 'power', 'check_work'], fact: 'Power should be given in watts (W).' },

  { id: 'kb.tutor.observe_before_explain', topic: 'pedagogy', role: 'hint_seed', tags: ['pedagogy', 'hint'], fact: 'When possible, first direct the student to notice one visible feature of the circuit before explaining the rule.' },
  { id: 'kb.tutor.one_question', topic: 'pedagogy', role: 'hint_seed', tags: ['pedagogy', 'question'], fact: 'Ask at most one short Socratic question per turn.' },
  { id: 'kb.tutor.one_concept', topic: 'pedagogy', role: 'hint_seed', tags: ['pedagogy', 'focus'], fact: 'Teach one concept per reply to reduce overload.' },
  { id: 'kb.tutor.shortest_helpful_response', topic: 'pedagogy', role: 'hint_seed', tags: ['pedagogy', 'concise', 'style'], fact: 'Use the shortest response that still helps the student make progress.' },
  { id: 'kb.tutor.priority_first_error', topic: 'pedagogy', role: 'hint_seed', tags: ['pedagogy', 'priority', 'correction'], fact: 'If multiple issues are present, address the highest-priority error first rather than explaining everything at once.' },

  { id: 'kb.hint.dim_bulb_voltage_split', topic: 'series', role: 'hint_seed', tags: ['hint', 'series', 'voltage', 'bulb', 'brightness'], fact: 'Notice how much of the supply p.d. drops across each component: a dim bulb in series often means another component is taking the larger share of the p.d.' },
  { id: 'kb.hint.voltmeter_loop_check', topic: 'meters', role: 'hint_seed', tags: ['hint', 'voltmeter', 'placement', 'loop'], fact: 'Check whether a voltmeter sits in the main loop or across the component: a voltmeter wired in the loop interrupts current rather than reading p.d.' },
  { id: 'kb.hint.ammeter_short_check', topic: 'meters', role: 'hint_seed', tags: ['hint', 'ammeter', 'placement', 'short'], fact: 'When an ammeter shares both ends with a single component, it offers a near-zero-resistance path that bypasses that component.' },
  { id: 'kb.hint.dead_branch_observation', topic: 'faults', role: 'hint_seed', tags: ['hint', 'dead_branch', 'topology'], fact: "Trace each component's wires from the + terminal back to the − terminal: any component not on a complete path carries no current." },
  { id: 'kb.hint.open_switch_observation', topic: 'faults', role: 'hint_seed', tags: ['hint', 'open_circuit', 'switch'], fact: 'If a switch in the main loop is open, the loop is broken and no current flows anywhere on that loop.' },
  { id: 'kb.hint.series_identification', topic: 'series', role: 'hint_seed', tags: ['hint', 'series', 'topology'], fact: 'Components are in series when the same current must pass through each in turn — there are no junctions splitting the path between them.' },
  { id: 'kb.hint.parallel_identification', topic: 'parallel', role: 'hint_seed', tags: ['hint', 'parallel', 'topology'], fact: 'Components are in parallel when each sits on its own branch between the same two junctions, so each branch sees the same p.d.' },
  { id: 'kb.hint.bulb_brightness_signal', topic: 'components', role: 'hint_seed', tags: ['hint', 'bulb', 'brightness', 'power'], fact: 'Bulb brightness reflects power dissipated in the bulb; a brighter bulb is taking more power than a dimmer one.' },
  { id: 'kb.hint.short_circuit_path', topic: 'faults', role: 'hint_seed', tags: ['hint', 'short_circuit', 'path'], fact: 'Look for a wire that connects directly across a component or across the supply with no resistance between — that path will carry the bulk of the current.' },
  { id: 'kb.hint.ohm_relationship', topic: 'ohms_law', role: 'hint_seed', tags: ['hint', 'ohms_law', 'relationship'], fact: 'For a fixed resistor, increasing the supply p.d. increases the current in proportion; increasing the resistance decreases the current.' },
];

// Tokenise on word chars; lowercase. Drop short/common words.
const STOP = new Set(['the','a','an','is','it','to','of','and','or','in','on','at','for','with','how','what','why','do','does','i','my','me','can','be','as','if','this','that','are','was','were','will','would','should','could','have','has','had','not','no','yes','but','so','you','your','we','us','they','them','their','there','here']);
function tokens(s) {
  return (s || '').toString().toLowerCase().match(/[a-z0-9]+/g)?.filter(t => t.length > 1 && !STOP.has(t)) || [];
}

// Rank ENTRIES by simple term overlap against the query + optional topic hint.
// Returns the top `limit` entries (excluding pinned — those are added separately).
//
// Post-processing guarantees a mix of roles in the returned list:
//   - At least 1 hint_seed (highest scored hint_seed, even if score 0)
//   - At least 1 misconception when one scored > 0
// This breaks the bag-of-words bias toward declarative definitions/rules.
export function retrieve(query, { topic = null, limit = 8 } = {}) {
  const qTokens = new Set(tokens(query));
  if (topic) qTokens.add(String(topic).toLowerCase());

  const score = (e) => {
    if (qTokens.size === 0) return 0;
    const hay = new Set([...tokens(e.fact), ...e.tags.map(t => t.toLowerCase()), e.topic.toLowerCase()]);
    let s = 0;
    for (const t of qTokens) if (hay.has(t)) s++;
    if (topic && e.topic.toLowerCase() === String(topic).toLowerCase()) s += 2;
    return s;
  };
  const scored = ENTRIES.map(e => ({ e, score: score(e) })).sort((a, b) => b.score - a.score);

  // Build initial top by score (>0 preferred; fall back to first N if nothing matched).
  let top = scored.filter(s => s.score > 0).slice(0, limit).map(s => s.e);
  if (top.length < Math.min(limit, 3)) {
    top = ENTRIES.slice(0, limit);
  }

  // Force-include one hint_seed (highest-scored, then by list order) and one
  // misconception (only if it actually scored > 0 — don't manufacture a
  // misconception for an unrelated query).
  const inTop = new Set(top.map(e => e.id));
  const bestHint = scored.find(s => s.e.role === 'hint_seed');
  const bestMisc = scored.find(s => s.e.role === 'misconception' && s.score > 0);

  function ensure(entry) {
    if (!entry || inTop.has(entry.id)) return;
    if (top.length < limit) {
      top.push(entry); inTop.add(entry.id); return;
    }
    // Replace the lowest-scored definition/rule entry to keep the slot count.
    for (let i = top.length - 1; i >= 0; i--) {
      const r = top[i].role;
      if (r === 'definition' || r === 'rule') {
        top[i] = entry; inTop.add(entry.id); return;
      }
    }
    // Last resort: replace tail.
    top[top.length - 1] = entry; inTop.add(entry.id);
  }
  if (bestHint) ensure(bestHint.e);
  if (bestMisc) ensure(bestMisc.e);

  return top;
}
