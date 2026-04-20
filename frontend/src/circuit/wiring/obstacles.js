// Obstacle collection for the router.
// Reads the live state, filters by exclusions, and returns rectangles + wire
// segment lists that the router treats as avoidables.

import { state } from '../../state/store.js';
import { COMP } from '../schema.js';
import { termPos } from '../geometry.js';

export const CLEARANCE = 12;

/** @returns {import('./types.js').RoutingObstacle[]} */
export function collectComponentBoxes(excludeIds = []) {
  const ex = new Set(excludeIds);
  const out = [];
  for (const c of state.components) {
    if (ex.has(c.id)) continue;
    const m = COMP[c.type];
    const rot = ((((c.rot || 0) % 360) + 360) % 360);
    const vert = (rot === 90 || rot === 270);
    const w = vert ? m.h : m.w;
    const h = vert ? m.w : m.h;
    out.push({
      id: c.id,
      x1: c.x - w / 2 - CLEARANCE, y1: c.y - h / 2 - CLEARANCE,
      x2: c.x + w / 2 + CLEARANCE, y2: c.y + h / 2 + CLEARANCE,
    });
  }
  return out;
}

// Reconstruct the point sequence of an existing wire, preferring its cached
// path so the router sees stable geometry during component drag.
export function wirePoints(w) {
  const ca = state.components.find(c => c.id === w.a.compId);
  const cb = state.components.find(c => c.id === w.b.compId);
  if (!ca || !cb) return null;
  const p0 = termPos(ca, w.a.term);
  const pn = termPos(cb, w.b.term);
  if (w.path && w.path.length >= 2) {
    const pts = w.path.slice();
    pts[0] = p0; pts[pts.length - 1] = pn;
    return pts;
  }
  if (w.via && w.via.length) return [p0, ...w.via, pn];
  return [p0, pn];
}

// Flatten every committed wire into its orthogonal segments, so the router
// can penalize crossings and overlaps.
export function collectWireSegments(excludeWireIds = []) {
  const ex = new Set(excludeWireIds);
  const segs = [];
  for (const w of state.wires) {
    if (ex.has(w.id)) continue;
    const pts = wirePoints(w);
    if (!pts) continue;
    for (let i = 1; i < pts.length; i++) segs.push({ wid: w.id, a: pts[i - 1], b: pts[i] });
  }
  return segs;
}
