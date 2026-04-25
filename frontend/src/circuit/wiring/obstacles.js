// Obstacle collection for the router.
// Reads the live state, filters by exclusions, and returns rectangles + wire
// segment lists that the router treats as avoidables.

import { state } from '../../state/store.js';
import { COMP } from '../schema.js';
import { endpointPos } from '../geometry.js';

export const CLEARANCE = 12;

/** @returns {import('./types.js').RoutingObstacle[]} */
export function collectComponentBoxes(excludeIds = []) {
  const ex = new Set(excludeIds);
  const out = [];
  for (const c of state.components) {
    if (ex.has(c.id)) continue;
    const m = COMP[c.type];
    out.push({
      id: c.id,
      x1: c.x - m.w / 2 - CLEARANCE, y1: c.y - m.h / 2 - CLEARANCE,
      x2: c.x + m.w / 2 + CLEARANCE, y2: c.y + m.h / 2 + CLEARANCE,
    });
  }
  return out;
}

// Reconstruct the point sequence of an existing wire, preferring its cached
// path so the router sees stable geometry during component drag.
export function wirePoints(w) {
  const p0 = endpointPos(w.a);
  const pn = endpointPos(w.b);
  if (!p0 || !pn) return null;
  if (w.path && w.path.length >= 2) {
    const pts = w.path.slice();
    pts[0] = p0; pts[pts.length - 1] = pn;
    return pts;
  }
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
