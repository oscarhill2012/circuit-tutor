// Small geometry helpers shared by the renderer and the routing engine.
// Kept in its own module to avoid circular imports between them.

import { COMP } from './schema.js';
import { state } from '../state/store.js';

export function termPos(comp, termName) {
  const def = COMP[comp.type].terms.find(t => t.n === termName);
  return { x: comp.x + def.x, y: comp.y + def.y };
}

export function exitDir(comp, termName) {
  const def = COMP[comp.type].terms.find(t => t.n === termName);
  if (Math.abs(def.x) >= Math.abs(def.y)) return def.x < 0 ? 'W' : 'E';
  return def.y < 0 ? 'N' : 'S';
}

// A wire endpoint is either a component terminal `{compId, term}` or a
// wire-to-wire junction `{junctionId}`. These helpers abstract over both.
export function endpointPos(ep) {
  if (!ep) return null;
  if (ep.junctionId) {
    const j = state.junctions.find(x => x.id === ep.junctionId);
    return j ? { x: j.x, y: j.y } : null;
  }
  const c = state.components.find(x => x.id === ep.compId);
  if (!c) return null;
  return termPos(c, ep.term);
}

export function endpointKey(ep) {
  if (!ep) return null;
  if (ep.junctionId) return 'J:' + ep.junctionId;
  return ep.compId + '.' + ep.term;
}

// Heuristic exit direction for routing. For a component terminal, use the
// anchor's side; for a junction, consult the per-junction assignment so
// every wire at the same junction leaves on a distinct cardinal (N/E/S/W).
// That caps practical junctions at 4 wires but keeps each bar cleanly
// visible without overlap.
export function endpointDir(ep, other) {
  if (!ep) return 'E';
  if (ep.junctionId) {
    const assigned = assignJunctionDirs(ep.junctionId);
    const wid = findWireIdBetween(ep, other);
    if (wid && assigned.has(wid)) return assigned.get(wid);
    // New wire not yet committed: pick the best direction among cardinals not
    // already used by existing wires at this junction, so the new wire always
    // leaves at 90° to its neighbours and its current bar has a clear stub.
    const usedDirs = new Set(assigned.values());
    const here = endpointPos(ep);
    const there = endpointPos(other) || here;
    const dx = there.x - here.x, dy = there.y - here.y;
    const ranked = rankCardinals(dx, dy);
    const available = ranked.filter(d => !usedDirs.has(d));
    return available.length ? available[0] : ranked[0];
  }
  const c = state.components.find(x => x.id === ep.compId);
  if (!c) return 'E';
  return exitDir(c, ep.term);
}

function findWireIdBetween(ep, other) {
  if (!ep || !other) return null;
  const k1 = endpointKey(ep), k2 = endpointKey(other);
  for (const w of state.wires) {
    const ka = endpointKey(w.a), kb = endpointKey(w.b);
    if ((ka === k1 && kb === k2) || (ka === k2 && kb === k1)) return w.id;
  }
  return null;
}

// For all wires at junction `jId`, assign each one a distinct cardinal
// direction (N/E/S/W) based on the direction to its far endpoint. Wires
// with the strongest directional preference are placed first; later wires
// fall back to their next-best available cardinal. Returns Map<wireId, dir>.
function assignJunctionDirs(jId) {
  const out = new Map();
  const j = state.junctions.find(x => x.id === jId);
  if (!j) return out;
  const wires = state.wires.filter(w =>
    w.a.junctionId === jId || w.b.junctionId === jId);
  if (!wires.length) return out;

  const entries = wires.map(w => {
    const far = (w.a.junctionId === jId) ? w.b : w.a;
    const p = endpointPos(far) || { x: j.x, y: j.y };
    const dx = p.x - j.x, dy = p.y - j.y;
    // Strength = how pronounced the preferred cardinal is. Wires with
    // strong preference get first pick.
    const strength = Math.max(Math.abs(dx), Math.abs(dy));
    return { wire: w, dx, dy, strength };
  });
  // Tie-break by wire id for stable assignment across rerenders.
  entries.sort((a, b) => b.strength - a.strength || (a.wire.id < b.wire.id ? -1 : 1));

  const used = new Set();
  const allDirs = ['E', 'W', 'S', 'N'];
  for (const e of entries) {
    const ranked = rankCardinals(e.dx, e.dy);
    let pick = ranked.find(d => !used.has(d));
    if (!pick) pick = allDirs.find(d => !used.has(d)) || ranked[0];
    used.add(pick);
    out.set(e.wire.id, pick);
  }
  return out;
}

function rankCardinals(dx, dy) {
  // Score each cardinal by how well it points along (dx, dy). Higher = better.
  const scores = [
    { d: 'E', v: dx },
    { d: 'W', v: -dx },
    { d: 'S', v: dy },
    { d: 'N', v: -dy },
  ];
  scores.sort((a, b) => b.v - a.v);
  return scores.map(s => s.d);
}

export function advance(p, dir, d) {
  if (dir === 'E') return { x: p.x + d, y: p.y };
  if (dir === 'W') return { x: p.x - d, y: p.y };
  if (dir === 'N') return { x: p.x, y: p.y - d };
  return { x: p.x, y: p.y + d };
}

export function samePort(a, b) {
  if (!a || !b) return false;
  if (a.junctionId || b.junctionId) return a.junctionId === b.junctionId;
  return a.compId === b.compId && a.term === b.term;
}
