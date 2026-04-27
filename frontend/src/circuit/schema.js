// Component geometry + display metadata used by the canvas, editor and
// palette. Task content lives in frontend/src/data/tasks.json and the
// GCSE knowledge base lives in frontend/api/knowledge_base.json (server-only;
// retrieval runs in tutor.py).

// Visual scale applied to all components: world-space size = COMP.w/h * COMP_SCALE,
// world-space terminal offset = def.x/y * COMP_SCALE. The drawing geometry inside
// renderer.js stays in unscaled "logical" units; the renderer applies a matching
// SVG `scale(COMP_SCALE)` transform so visuals and hit areas stay aligned.
export const COMP_SCALE = 1.4;

export const COMP = {
  cell:      { w: 60, h: 40, terms: [{n:'+', x:-30, y:0}, {n:'-', x:30, y:0}], defaultProps: { voltage: 6 } },
  battery:   { w: 80, h: 40, terms: [{n:'+', x:-40, y:0}, {n:'-', x:40, y:0}], defaultProps: { voltage: 12 } },
  switch:    { w: 60, h: 40, terms: [{n:'a', x:-30, y:0}, {n:'b', x:30, y:0}], defaultProps: { closed: true } },
  bulb:      { w: 60, h: 60, terms: [{n:'a', x:-30, y:0}, {n:'b', x:30, y:0}], defaultProps: { resistance: 4 } },
  resistor:  { w: 80, h: 40, terms: [{n:'a', x:-40, y:0}, {n:'b', x:40, y:0}], defaultProps: { resistance: 10 } },
  ammeter:   { w: 60, h: 60, terms: [{n:'a', x:-30, y:0}, {n:'b', x:30, y:0}], defaultProps: {} },
  voltmeter: { w: 60, h: 60, terms: [{n:'a', x:-30, y:0}, {n:'b', x:30, y:0}], defaultProps: {} },
};

export const COMP_LABELS = { cell:'Cell', battery:'Battery', switch:'Switch', bulb:'Bulb', resistor:'Resistor', ammeter:'Ammeter', voltmeter:'Voltmeter' };
export const COMP_PREFIX = { cell:'C', battery:'B', switch:'S', bulb:'L', resistor:'R', ammeter:'A', voltmeter:'V' };

export const COMP_DESCRIPTIONS = {
  cell:      'A single battery cell. Pushes current around the circuit. The longer line is the + terminal.',
  battery:   'Several cells joined together. Provides a higher voltage than a single cell.',
  switch:    'Opens or closes a circuit. When the switch is open, current cannot flow.',
  bulb:      'Lights up when current flows through it. Brighter with more current; also acts as a resistor.',
  resistor:  'Resists the flow of current. Higher resistance means less current for the same voltage.',
  ammeter:   'Measures current in amps (A). Connect it in series so the current flows through it.',
  voltmeter: 'Measures voltage in volts (V) across a component. Connect it in parallel with that component.',
};
