// Pure state mutations: history, id allocation, add/delete, simulation shim.
// Rendering is triggered by callers via render() after a mutation.

import { state, GRID } from './store.js';
import { COMP, COMP_PREFIX } from '../circuit/schema.js';
import { render } from '../circuit/renderer.js';

export function uid(type) {
  const p = COMP_PREFIX[type] || 'X';
  let n = 1;
  const taken = new Set(state.components.filter(c=>c.id.startsWith(p)).map(c=>c.id));
  while (taken.has(p+n)) n++;
  return p+n;
}

export function snap(v) { return Math.round(v / GRID) * GRID; }

export function pushHistory() {
  state.history.push(JSON.stringify({components: state.components, wires: state.wires}));
  if (state.history.length > 80) state.history.shift();
  state.future.length = 0;
}

export function undo() {
  if (!state.history.length) return;
  state.future.push(JSON.stringify({components: state.components, wires: state.wires}));
  const prev = JSON.parse(state.history.pop());
  state.components = prev.components; state.wires = prev.wires;
  state.selectedId = null; simulate(); render();
}

export function redo() {
  if (!state.future.length) return;
  state.history.push(JSON.stringify({components: state.components, wires: state.wires}));
  const nxt = JSON.parse(state.future.pop());
  state.components = nxt.components; state.wires = nxt.wires;
  state.selectedId = null; simulate(); render();
}

// Physics lives in sim/physics.js (loaded as classic script, window.Physics).
// Thin wrapper keeps existing call sites working.
export function simulate() { state.sim = window.Physics.simulate(state, COMP); }

export function deleteComponent(cid) {
  pushHistory();
  state.components = state.components.filter(c => c.id !== cid);
  state.wires = state.wires.filter(w => w.a.compId !== cid && w.b.compId !== cid);
  if (state.selectedId === cid) state.selectedId = null;
  simulate(); render();
}

export function deleteWire(wid) {
  pushHistory();
  state.wires = state.wires.filter(w => w.id !== wid);
  simulate(); render();
}

export function addComponent(type, x, y) {
  pushHistory();
  const id = uid(type);
  const props = { ...(COMP[type].defaultProps || {}) };
  state.components.push({ id, type, x: snap(x), y: snap(y), rot: 0, props });
  state.selectedId = id;
  simulate(); render();
}
