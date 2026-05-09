// Named circuit builders for probe setup.
//
// Each function returns an object accepted by loadInitialCircuit():
// { components: [{id, type, x, y, props?}], wires: [{id, a, b}], junctions: [] }.
//
// Wire endpoints reference component terminals by name (see schema.js):
//   cell      → '+', '-'
//   resistor/bulb/ammeter/voltmeter/switch → 'a', 'b'
//
// Positions are arbitrary — the simulator uses net topology, not geometry.
// Co-located terminals (e.g. two wires both ending at L1.a) are how we
// express parallel branches without wire-to-wire junctions.

const W = (id, ac, at, bc, bt) => ({ id, a: { compId: ac, term: at }, b: { compId: bc, term: bt } });

// Cell + resistor + bulb in series, all good.
function seriesCellR100Bulb() {
  return {
    components: [
      { id: 'C1', type: 'cell',     x: 200, y: 300, props: { voltage: 6 } },
      { id: 'R1', type: 'resistor', x: 400, y: 300, props: { resistance: 100 } },
      { id: 'L1', type: 'bulb',     x: 600, y: 300 },
    ],
    wires: [
      W('W1', 'C1', '-', 'R1', 'a'),
      W('W2', 'R1', 'b', 'L1', 'a'),
      W('W3', 'L1', 'b', 'C1', '+'),
    ],
    junctions: [],
  };
}

// Cell + resistor + ammeter in series, all good (low-resistance loop).
function seriesCellR3Ammeter() {
  return {
    components: [
      { id: 'C1', type: 'cell',     x: 200, y: 300, props: { voltage: 6 } },
      { id: 'R1', type: 'resistor', x: 400, y: 300, props: { resistance: 3 } },
      { id: 'A1', type: 'ammeter',  x: 600, y: 300 },
    ],
    wires: [
      W('W1', 'C1', '-', 'R1', 'a'),
      W('W2', 'R1', 'b', 'A1', 'a'),
      W('W3', 'A1', 'b', 'C1', '+'),
    ],
    junctions: [],
  };
}

// Cell + bulb only — minimal working circuit.
function workingCellBulb() {
  return {
    components: [
      { id: 'C1', type: 'cell', x: 200, y: 300, props: { voltage: 6 } },
      { id: 'L1', type: 'bulb', x: 500, y: 300 },
    ],
    wires: [
      W('W1', 'C1', '-', 'L1', 'a'),
      W('W2', 'L1', 'b', 'C1', '+'),
    ],
    junctions: [],
  };
}

// Cell + bulb with a voltmeter wired *in series* with the bulb (misuse).
function voltmeterInSeriesWithBulb() {
  return {
    components: [
      { id: 'C1', type: 'cell',      x: 200, y: 300, props: { voltage: 6 } },
      { id: 'V1', type: 'voltmeter', x: 400, y: 300 },
      { id: 'L1', type: 'bulb',      x: 600, y: 300 },
    ],
    wires: [
      W('W1', 'C1', '-', 'V1', 'a'),
      W('W2', 'V1', 'b', 'L1', 'a'),
      W('W3', 'L1', 'b', 'C1', '+'),
    ],
    junctions: [],
  };
}

// Cell + bulb with an ammeter wired *across* the bulb (parallel — shorts it).
function ammeterInParallelWithBulb() {
  return {
    components: [
      { id: 'C1', type: 'cell',    x: 200, y: 300, props: { voltage: 6 } },
      { id: 'L1', type: 'bulb',    x: 500, y: 300 },
      { id: 'A1', type: 'ammeter', x: 500, y: 450 },
    ],
    wires: [
      W('W1', 'C1', '-', 'L1', 'a'),
      W('W2', 'L1', 'b', 'C1', '+'),
      W('W3', 'A1', 'a', 'L1', 'a'),
      W('W4', 'A1', 'b', 'L1', 'b'),
    ],
    junctions: [],
  };
}

// Cell + open switch + voltmeter in series with bulb — two coexisting issues.
function openSwitchPlusVoltmeterInSeries() {
  return {
    components: [
      { id: 'C1', type: 'cell',      x: 200, y: 300, props: { voltage: 6 } },
      { id: 'S1', type: 'switch',    x: 350, y: 300, props: { closed: false } },
      { id: 'V1', type: 'voltmeter', x: 500, y: 300 },
      { id: 'L1', type: 'bulb',      x: 700, y: 300 },
    ],
    wires: [
      W('W1', 'C1', '-', 'S1', 'a'),
      W('W2', 'S1', 'b', 'V1', 'a'),
      W('W3', 'V1', 'b', 'L1', 'a'),
      W('W4', 'L1', 'b', 'C1', '+'),
    ],
    junctions: [],
  };
}

// Two resistors in series with a cell — single-loop.
function seriesCellTwoResistors() {
  return {
    components: [
      { id: 'C1', type: 'cell',     x: 200, y: 300, props: { voltage: 6 } },
      { id: 'R1', type: 'resistor', x: 400, y: 300, props: { resistance: 10 } },
      { id: 'R2', type: 'resistor', x: 600, y: 300, props: { resistance: 20 } },
    ],
    wires: [
      W('W1', 'C1', '-', 'R1', 'a'),
      W('W2', 'R1', 'b', 'R2', 'a'),
      W('W3', 'R2', 'b', 'C1', '+'),
    ],
    junctions: [],
  };
}

export const empty = () => null;
export {
  seriesCellR100Bulb,
  seriesCellR3Ammeter,
  workingCellBulb,
  voltmeterInSeriesWithBulb,
  ammeterInParallelWithBulb,
  openSwitchPlusVoltmeterInSeries,
  seriesCellTwoResistors,
};
