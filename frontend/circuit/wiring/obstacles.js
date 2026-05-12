// Obstacle collection for the router.
// Reads the live state, filters by exclusions, and returns rectangles + wire
// segment lists that the router treats as avoidables.

import { state } from '../../state/store.js';
import { COMP, COMP_SCALE } from '../schema.js';
import { endpointPos } from '../geometry.js';

export const CLEARANCE = 12;

/** @returns {import('./types.js').RoutingObstacle[]} */
export function collectComponentBoxes(excludeIds = []) {
  const ex = new Set(excludeIds);
  const out = [];
  for (const c of state.components) {
    if (ex.has(c.id)) continue;
    out.push(boxFor(c));
  }
  return out;
}

// Inclusion-only variant of collectComponentBoxes: returns boxes ONLY for the
// listed component ids. Used by the drag-aware reroute to find wires whose
// stale paths now cut through a moved component's new footprint (those wires
// don't touch the moved component, so the standard "reroute wires attached
// to the dragged component" pass misses them).
//
// @param {string[]} ids - component ids to include
// @returns {import('./types.js').RoutingObstacle[]}
export function componentBoxesFor(ids) {
  const want = new Set(ids);
  const out = [];
  for (const c of state.components) {
    if (!want.has(c.id)) continue;
    out.push(boxFor(c));
  }
  return out;
}

// Build a single padded bounding box for a component. Centralised so that
// collectComponentBoxes and componentBoxesFor share the exact same geometry —
// any drift between the two would cause the drag-intersection check to
// disagree with the router's own obstacle picture.
function boxFor(c) {
  const m = COMP[c.type];
  const halfW = (m.w * COMP_SCALE) / 2;
  const halfH = (m.h * COMP_SCALE) / 2;
  return {
    id: c.id,
    x1: c.x - halfW - CLEARANCE, y1: c.y - halfH - CLEARANCE,
    x2: c.x + halfW + CLEARANCE, y2: c.y + halfH + CLEARANCE,
  };
}

// True if any segment of the orthogonal point sequence `pts` passes through
// (the interior of) any of the supplied axis-aligned boxes. Used to detect
// cached wire paths that need rerouting because a component has been dragged
// onto them. Boundary-touching segments do not count as intersecting — those
// just graze the obstacle edge.
//
// @param {{x:number,y:number}[]} pts
// @param {{x1:number,y1:number,x2:number,y2:number}[]} boxes
// @returns {boolean}
export function pathHitsAnyBox(pts, boxes) {
  if (!pts || pts.length < 2 || !boxes || !boxes.length) return false;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const minX = Math.min(a.x, b.x), maxX = Math.max(a.x, b.x);
    const minY = Math.min(a.y, b.y), maxY = Math.max(a.y, b.y);
    for (const ob of boxes) {
      // Strict interior overlap on each axis. Equal-edge contact (segment
      // running along the box boundary) is not a hit, matching the router's
      // own strictlyInside / segCrossesObstacle semantics.
      if (maxX <= ob.x1 || minX >= ob.x2) continue;
      if (maxY <= ob.y1 || minY >= ob.y2) continue;
      return true;
    }
  }
  return false;
}

// Reconstruct the point sequence of an existing wire, preferring its cached
// path so the router sees stable geometry during component drag. Wires
// without a cached path return null — they are not yet placed anywhere on
// the canvas, and emitting a straight-line placeholder between endpoints
// can fabricate phantom obstacle segments that aren't real (e.g. a
// junction-to-component pseudo-segment that happens to lie on the same row
// as a wire being routed, triggering OVERLAP_COST against the legitimate
// straight path while the eventual real route would have bent away).
export function wirePoints(w) {
  const p0 = endpointPos(w.a);
  const pn = endpointPos(w.b);
  if (!p0 || !pn) return null;
  if (!w.path || w.path.length < 2) return null;
  const pts = w.path.slice();
  pts[0] = p0; pts[pts.length - 1] = pn;
  return pts;
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
