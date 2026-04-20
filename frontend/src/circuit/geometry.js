// Small geometry helpers shared by the renderer and the routing engine.
// Kept in its own module to avoid circular imports between them.

import { COMP } from './schema.js';

export function rotatePt(x, y, rotDeg) {
  const r = ((((rotDeg || 0) % 360) + 360) % 360) * Math.PI / 180;
  const c = Math.cos(r), s = Math.sin(r);
  return { x: x * c - y * s, y: x * s + y * c };
}

export function termPos(comp, termName) {
  const def = COMP[comp.type].terms.find(t => t.n === termName);
  const p = rotatePt(def.x, def.y, comp.rot);
  return { x: comp.x + p.x, y: comp.y + p.y };
}

// Which side of the component body a terminal emerges from, accounting
// for the component's rotation.
export function exitDir(comp, termName) {
  const def = COMP[comp.type].terms.find(t => t.n === termName);
  let base;
  if (Math.abs(def.x) >= Math.abs(def.y)) base = def.x < 0 ? 'W' : 'E';
  else base = def.y < 0 ? 'N' : 'S';
  const steps = Math.round(((((comp.rot || 0) % 360) + 360) % 360) / 90) % 4;
  const order = ['E','S','W','N'];
  const idx = order.indexOf(base);
  return order[(idx + steps) % 4];
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
