// Component geometry + display metadata used by the canvas, editor and
// palette. Task content lives in frontend/data/tasks.json and the
// GCSE knowledge base lives in api/knowledge_base.json (server-only;
// retrieval runs in tutor.py).

// Visual scale applied to all components: world-space size = COMP.w/h * COMP_SCALE,
// world-space terminal offset = def.x/y * COMP_SCALE. The drawing geometry inside
// renderer.js stays in unscaled "logical" units; the renderer applies a matching
// SVG `scale(COMP_SCALE)` transform so visuals and hit areas stay aligned.
export const COMP_SCALE = 1.4;


// ---------------------------------------------------------------------------
// Current/voltage bar geometry — shared by renderer.js (draws the bars) and
// wiring/router.js (reserves enough stub length on bar-eligible endpoints so
// the bar can render at all). Keeping these in one place is the only way to
// stop the router's STUB length and the renderer's "is the first segment
// long enough to fit a bar?" gate from drifting apart and silently dropping
// bars on wires whose first segment is just barely too short.
//
// BAR_LEN_LOCAL / BAR_T_LOCAL are in component-local space (inside the
// COMP_SCALE transform) — voltage bars use them directly. BAR_LEN / BAR_T
// are the world-space sizes — wire-current bars use these so both bar
// flavours render at the same physical size on screen regardless of
// COMP_SCALE.
// ---------------------------------------------------------------------------

export const BAR_LEN_LOCAL = 54;
export const BAR_T_LOCAL = 6;

export const BAR_LEN = BAR_LEN_LOCAL * COMP_SCALE;
export const BAR_T = BAR_T_LOCAL * COMP_SCALE;

// Breathing room around a wire-current bar: TERMINAL_GAP between the
// connector and the bar, POST_BAR_GAP between the bar's far end and the
// first 90° turn.
export const BAR_TERMINAL_GAP = 24;
export const BAR_POST_GAP = 24;

// Total footprint a wire-current bar needs along its mount segment.
// The router uses this (plus a small slack) as the minimum stub length on
// bar-eligible endpoints, and the renderer uses it as the "is this segment
// long enough to draw a bar?" gate. One source of truth.
export const BAR_FOOTPRINT = BAR_TERMINAL_GAP + BAR_LEN + BAR_POST_GAP;

// Component types whose wires can carry a current bar. Used both by the
// renderer (to decide which components emit a bar) and by the router (to
// predict which endpoints are bar-eligible so it reserves the long stub
// only where needed).
export const COMP_BAR_TYPES = new Set(['cell', 'battery', 'resistor', 'bulb']);

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
