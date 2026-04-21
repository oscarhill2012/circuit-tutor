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
// anchor's side; for a junction, pick the cardinal direction pointing at the
// other endpoint so the stub looks sensible.
export function endpointDir(ep, other) {
  if (!ep) return 'E';
  if (ep.junctionId) {
    const here = endpointPos(ep);
    const there = endpointPos(other) || here;
    const dx = there.x - here.x, dy = there.y - here.y;
    if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'E' : 'W';
    return dy >= 0 ? 'S' : 'N';
  }
  const c = state.components.find(x => x.id === ep.compId);
  if (!c) return 'E';
  return exitDir(c, ep.term);
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
