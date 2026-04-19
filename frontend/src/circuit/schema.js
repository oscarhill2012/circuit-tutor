// Component geometry + display metadata used by the canvas, editor and
// palette. Task content lives in frontend/src/data/tasks.json and the
// GCSE knowledge base lives in frontend/src/data/knowledgeBase.js.

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
