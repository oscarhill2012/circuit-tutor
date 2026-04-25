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

// From two orthogonal-grid points, return the cardinal direction from
// `a` toward `b` ('E', 'W', 'N', 'S'). Used to seed wire junction
// cardinals from path geometry.
function cardinalFromTo(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'E' : 'W';
  return dy >= 0 ? 'S' : 'N';
}

function snapshot() {
  return JSON.stringify({
    components: state.components,
    wires: state.wires,
    junctions: state.junctions,
  });
}

export function pushHistory() {
  state.history.push(snapshot());
  if (state.history.length > 80) state.history.shift();
  state.future.length = 0;
}

function restore(snap) {
  const s = JSON.parse(snap);
  state.components = s.components;
  state.wires = s.wires;
  state.junctions = s.junctions || [];
}

export function undo() {
  if (!state.history.length) return;
  state.future.push(snapshot());
  restore(state.history.pop());
  state.selectedId = null; simulate(); render();
}

export function redo() {
  if (!state.future.length) return;
  state.history.push(snapshot());
  restore(state.future.pop());
  state.selectedId = null; simulate(); render();
}

// Physics lives in sim/physics.js (loaded as classic script, window.Physics).
// Thin wrapper keeps existing call sites working.
export function simulate() { state.sim = window.Physics.simulate(state, COMP); }

export function deleteComponent(cid) {
  if (state.lockedIds && state.lockedIds.has(cid)) {
    // Locked by the current task — refuse delete silently.
    return;
  }
  pushHistory();
  state.components = state.components.filter(c => c.id !== cid);
  state.wires = state.wires.filter(w => w.a.compId !== cid && w.b.compId !== cid);
  pruneOrphanJunctions();
  if (state.selectedId === cid) state.selectedId = null;
  simulate(); render();
}

// A junction with fewer than 2 wires attached has no reason to exist; drop
// it. A junction with exactly 2 wires is just a kink — also drop it and
// merge the two wires back into one so the diagram stays tidy.
export function pruneOrphanJunctions() {
  const attachMap = {};
  for (const w of state.wires) {
    if (w.a.junctionId) (attachMap[w.a.junctionId] ||= []).push({ w, end: 'a' });
    if (w.b.junctionId) (attachMap[w.b.junctionId] ||= []).push({ w, end: 'b' });
  }
  const toRemove = new Set();
  for (const j of state.junctions) {
    const list = attachMap[j.id] || [];
    if (list.length < 2) {
      toRemove.add(j.id);
      // Orphan any wires still pointing at this junction (they'll be dropped).
      state.wires = state.wires.filter(w => w.a.junctionId !== j.id && w.b.junctionId !== j.id);
    } else if (list.length === 2) {
      const [p, q] = list;
      const farP = p.end === 'a' ? p.w.b : p.w.a;
      const farQ = q.end === 'a' ? q.w.b : q.w.a;
      // Replace the two wires with a single one endpoint→endpoint.
      state.wires = state.wires.filter(w => w !== p.w && w !== q.w);
      state.wires.push({
        id: 'W' + (state.nextId++),
        a: farP, b: farQ, path: null,
      });
      toRemove.add(j.id);
    }
  }
  if (toRemove.size) state.junctions = state.junctions.filter(j => !toRemove.has(j.id));
}

export function loadInitialCircuit(initial, taskId) {
  pushHistory();
  state.components = (initial.components || []).map(c => ({
    id: c.id, type: c.type,
    x: snap(c.x), y: snap(c.y),
    props: { ...(COMP[c.type].defaultProps || {}), ...(c.props || {}) },
  }));
  state.wires = (initial.wires || []).map(w => ({ ...w }));
  state.junctions = (initial.junctions || []).map(j => ({ ...j }));
  state.selectedId = null;
  state.lockedIds = new Set(initial.locked || []);
  state.loadedTaskId = taskId;
  // Make sure id allocator keeps generating unique ids beyond the pinned set.
  state.nextId = Math.max(
    state.nextId,
    ...state.components.map(c => parseInt(c.id.replace(/\D+/g, ''), 10) || 0),
    ...state.wires.map(w => parseInt(String(w.id).replace(/\D+/g, ''), 10) || 0),
  ) + 1;
  simulate(); render();
}

export function clearCircuit() {
  pushHistory();
  state.components = [];
  state.wires = [];
  state.junctions = [];
  state.selectedId = null;
  state.lockedIds = new Set();
  state.loadedTaskId = null;
  simulate(); render();
}

export function deleteWire(wid) {
  pushHistory();
  state.wires = state.wires.filter(w => w.id !== wid);
  pruneOrphanJunctions();
  simulate(); render();
}

// Create a T-junction on an existing wire at the given point. The original
// wire is split into two halves meeting at the new junction. Returns the
// new junction's id, or null if the split couldn't be applied.
export function splitWireAtCorner(wireId, pt, cornerIndex) {
  const w = state.wires.find(x => x.id === wireId);
  if (!w || !w.path || cornerIndex <= 0 || cornerIndex >= w.path.length - 1) return null;
  pushHistory();
  const jid = 'J' + (state.nextId++);
  const j = { id: jid, x: snap(pt.x), y: snap(pt.y) };
  state.junctions.push(j);
  const left = w.path.slice(0, cornerIndex + 1).map(p => ({ x: p.x, y: p.y }));
  const right = w.path.slice(cornerIndex).map(p => ({ x: p.x, y: p.y }));
  // Snap the shared vertex to the junction's grid-aligned point.
  left[left.length - 1] = { x: j.x, y: j.y };
  right[0] = { x: j.x, y: j.y };
  // Seed junctionDirs from the sliced path so assignJunctionDirs honours
  // the existing geometry instead of re-picking a cardinal that would
  // leave the cached path's stub direction out of sync with the logical
  // assignment.
  const w1 = {
    id: 'W' + (state.nextId++),
    a: w.a, b: { junctionId: jid }, path: left,
    junctionDirs: { [jid]: cardinalFromTo(left[left.length - 1], left[left.length - 2]) },
  };
  const w2 = {
    id: 'W' + (state.nextId++),
    a: { junctionId: jid }, b: w.b, path: right,
    junctionDirs: { [jid]: cardinalFromTo(right[0], right[1]) },
  };
  state.wires = state.wires.filter(x => x.id !== wireId).concat([w1, w2]);
  simulate(); render();
  return jid;
}

export function addComponent(type, x, y) {
  pushHistory();
  const id = uid(type);
  const props = { ...(COMP[type].defaultProps || {}) };
  state.components.push({ id, type, x: snap(x), y: snap(y), props });
  state.selectedId = id;
  simulate(); render();
}
