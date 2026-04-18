// Small geometry helpers shared by the renderer and the routing engine.
// Kept in its own module to avoid circular imports between them.

import { COMP } from './schema.js';

export function termPos(comp, termName) {
  const def = COMP[comp.type].terms.find(t => t.n === termName);
  return { x: comp.x + def.x, y: comp.y + def.y };
}

// Which side of the component body a terminal emerges from.
export function exitDir(comp, termName) {
  const def = COMP[comp.type].terms.find(t => t.n === termName);
  if (Math.abs(def.x) >= Math.abs(def.y)) return def.x < 0 ? 'W' : 'E';
  return def.y < 0 ? 'N' : 'S';
}

export function advance(p, dir, d) {
  if (dir === 'E') return { x: p.x + d, y: p.y };
  if (dir === 'W') return { x: p.x - d, y: p.y };
  if (dir === 'N') return { x: p.x, y: p.y - d };
  return { x: p.x, y: p.y + d };
}

export function samePort(a, b) {
  return !!(a && b && a.compId === b.compId && a.term === b.term);
}
