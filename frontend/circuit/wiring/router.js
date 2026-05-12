// Pure client-side orthogonal router.
// Builds a sparse visibility graph from connector positions and padded
// component edges, then runs an A* search whose cost penalizes bends,
// crossings and overlaps. Returns a list of orthogonal points (endpoints
// included) that the renderer can draw with rounded corners.
//
// No backend, no Java, no WebWorker, no layout library — everything runs
// synchronously in the browser.

import { state } from '../../state/store.js';
import { COMP, COMP_BAR_TYPES, BAR_FOOTPRINT } from '../schema.js';
import { endpointPos, endpointDir, advance } from '../geometry.js';
import { collectComponentBoxes, collectWireSegments } from './obstacles.js';

// Tunables --------------------------------------------------------------

// Stub length for endpoints that will display a current bar. Must be at
// least BAR_FOOTPRINT (= TERMINAL_GAP + BAR_LEN + POST_BAR_GAP, defined in
// schema.js) plus a small slack — otherwise the renderer's "is the first
// segment long enough?" gate in computeBarGeom() bails and the bar
// silently doesn't appear. The +8 slack absorbs sub-pixel layout drift
// plus the corner-radius eaten by toSvgPath.
const STUB_BAR = Math.ceil(BAR_FOOTPRINT) + 8;

// Stub length for endpoints that won't show a bar (junctions with <3
// wires, the loser-terminal on bar-emitting components). Just enough
// breathing room to leave the connector cleanly before turning.
const STUB_PLAIN = 40;

const BEND_COST = 22;     // penalty per 90° turn
const CROSSING_COST = 220; // penalty per existing wire crossed — strongly discouraged
const OVERLAP_COST = 240; // penalty per axis-aligned overlap with existing wire
const NEAR_COST = 3;      // penalty per segment that hugs an obstacle edge
const REUSE_BONUS = 8;    // reward per segment reused from previous path
const LANE_STEP = 10;     // offset applied when a cleaner lane is available

// Minimum length any non-stub segment may have after a lane nudge. Below
// roughly 2×CORNER_R the rounded corners on either side overlap and the
// bend visually folds into a "kink". Keeping adjacent legs >= this value
// preserves a clean elbow on each side of the shifted segment.
const MIN_LEG_AFTER_NUDGE = 16;

// Just above BEND_COST so the router is willing to "spend a bend" rather
// than depart srcStub or arrive at tgtStub along the stub axis. Without this
// penalty, A* often takes a parallel-arrival path of equal-or-lower cost,
// and simplify() then collapses the mandatory stub corner — leaving the
// wire's first/last segment shorter than the bar footprint and (downstream)
// breaking the current-bar geometry gate, plus pushing the wire's terminal
// segment inside the destination component's clearance box.
//
// Applied only on bar-eligible endpoints (see endpointBarEligible). On
// non-bar endpoints we WANT the natural straight arrival so simple wires
// take simple paths instead of looping around for an unnecessary bend.
const STUB_PRESERVE_COST = BEND_COST + 1;


/**
 * Predict whether `ep` will receive a current bar after the next render.
 * Used to decide which endpoints get the long bar-fitting stub vs. the
 * short breathing-room stub.
 *
 *   - Junction endpoint:  eligible iff at least 2 other wires already
 *                         touch the junction in state.wires. The wire being
 *                         routed right now is NOT yet committed to
 *                         state.wires, so counting ≥2 here predicts ≥3
 *                         after commit — which is the bar planner's actual
 *                         gate. False positives (the routed wire turns out
 *                         to be the second, not the third) only cost a
 *                         longer-than-needed stub, no visual bug.
 *   - Component terminal: eligible iff the component is a bar-emitting
 *                         type. ANY terminal qualifies, not just the
 *                         rightmost-x one. The bar planner prefers the
 *                         rightmost terminal but falls back to the other
 *                         terminal when the rightmost wire is already
 *                         claimed (e.g. shared with an upstream component
 *                         in a series loop). If only the rightmost side
 *                         got the long stub, the fallback bar would
 *                         silently fail to render because computeBarGeom
 *                         bails on segments shorter than BAR_FOOTPRINT.
 *                         The cost of being symmetric is a slightly longer
 *                         stub on the side that doesn't end up with a bar
 *                         (~92 px), which is well worth a guaranteed bar.
 *
 * @param {{compId?:string,term?:string,junctionId?:string}} ep
 * @returns {boolean}
 */
function endpointBarEligible(ep) {
  if (!ep) return false;

  if (ep.junctionId) {
    let degree = 0;
    for (const w of state.wires) {
      if (w.a.junctionId === ep.junctionId || w.b.junctionId === ep.junctionId) {
        degree++;
        if (degree >= 2) return true;
      }
    }
    return false;
  }

  if (!ep.compId) return false;
  const comp = state.components.find(c => c.id === ep.compId);
  if (!comp || !COMP_BAR_TYPES.has(comp.type)) return false;

  // Both terminals get the long stub on bar-emitting components — the bar
  // planner can claim either side and we need space reserved on whichever
  // it picks. See the rationale block above.
  return true;
}

// Public API ------------------------------------------------------------

/**
 * Route a wire from one connector to another.
 * @param {{compId:string,term:string}} source
 * @param {{compId:string,term:string}} target
 * @param {Object} [opts]
 * @param {string[]} [opts.excludeComps]  components whose bodies should not
 *   block the search (defaults to the two endpoint components).
 * @param {string[]} [opts.excludeWires]  wires whose segments should not be
 *   treated as obstacles (e.g. the wire being rerouted).
 * @param {{x:number,y:number}[]} [opts.previousPath] prior route for this
 *   wire — edges along it get a small reuse bonus to keep layouts stable.
 * @param {Array} [opts.obstacles] pre-collected component bounding boxes
 *   (matching collectComponentBoxes output). When supplied, the router skips
 *   re-collecting them — used by the drag fast-path to share one obstacle
 *   set across every attached wire reroute in a single pointermove frame.
 * @param {Array} [opts.wireSegs] pre-collected wire segments (matching
 *   collectWireSegments output). Same purpose as opts.obstacles.
 * @returns {{x:number,y:number}[]|null}
 */
export function route(source, target, opts = {}) {
  const srcPt = endpointPos(source);
  const tgtPt = endpointPos(target);
  if (!srcPt || !tgtPt) return null;

  const srcDir = endpointDir(source, target);
  const tgtDir = endpointDir(target, source);

  const excludeComps = opts.excludeComps
    || [source.compId, target.compId].filter(Boolean);
  const excludeWires = opts.excludeWires || [];
  const obstacles = opts.obstacles || collectComponentBoxes(excludeComps);
  const wireSegs = opts.wireSegs || collectWireSegments(excludeWires);

  // Stub length depends on whether the endpoint will display a current
  // bar. Bar-eligible endpoints reserve BAR_FOOTPRINT-sized room so the
  // bar can actually render (see endpointBarEligible / STUB_BAR comments).
  // Non-bar endpoints get a much shorter stub so simple wires take simple
  // paths instead of being forced to walk 100+ px in their exit cardinal
  // before they can bend.
  const srcBarEligible = endpointBarEligible(source);
  const tgtBarEligible = endpointBarEligible(target);
  const srcStubLen = srcBarEligible ? STUB_BAR : STUB_PLAIN;
  const tgtStubLen = tgtBarEligible ? STUB_BAR : STUB_PLAIN;
  const srcStub = advance(srcPt, srcDir, srcStubLen);
  const tgtStub = advance(tgtPt, tgtDir, tgtStubLen);

  // Lines of the sparse routing grid. We include the stub and terminal
  // coordinates so they always land on grid intersections.
  const xs = new Set([srcPt.x, srcStub.x, tgtPt.x, tgtStub.x]);
  const ys = new Set([srcPt.y, srcStub.y, tgtPt.y, tgtStub.y]);
  for (const ob of obstacles) {
    xs.add(ob.x1); xs.add(ob.x2);
    ys.add(ob.y1); ys.add(ob.y2);
  }
  // Add midlines between source and target so long runs have an elbow option.
  xs.add((srcPt.x + tgtPt.x) / 2);
  ys.add((srcPt.y + tgtPt.y) / 2);

  const xArr = [...xs].sort((a, b) => a - b);
  const yArr = [...ys].sort((a, b) => a - b);
  const xIdx = new Map(xArr.map((v, i) => [v, i]));
  const yIdx = new Map(yArr.map((v, i) => [v, i]));

  const prevSet = makeSegSet(opts.previousPath);

  // Walk the grid from the source stub. We keep direction in the state so
  // bends can be scored correctly.
  const startKey = key(srcStub.x, srcStub.y, srcDir);
  const goalXY = srcXYKey(tgtStub.x, tgtStub.y);

  const gScore = new Map([[startKey, 0]]);
  const came = new Map();
  const open = new Map([[startKey, heuristic(srcStub, tgtStub)]]);

  while (open.size) {
    const curKey = popMin(open);
    const cur = parseKey(curKey);
    if (srcXYKey(cur.x, cur.y) === goalXY) {
      const corners = reconstruct(came, curKey);
      return finalize(srcPt, corners, tgtPt, wireSegs, obstacles);
    }
    // Suppress stub-preservation when src and tgt stubs share an axis: the
    // natural straight-line collapse is geometrically clean (it can't route
    // through a component body since both stubs already cleared the source
    // and target). Forcing a detour here would route the wire across other
    // wires for no payoff. Detected by comparing srcStub and tgtStub on the
    // shared coordinate of one or both stub-axes.
    //
    // Also suppress on endpoints that won't display a current bar: there's
    // nothing to make room for, so forcing a corner at the stub end just
    // produces gratuitous turns (Issue 2 in the wiring fix work).
    //
    // Also suppress on junction endpoints regardless of bar-eligibility:
    // junctions have no component body the wire could cut through, so the
    // stub-preserve corner is pure overhead. The bar (if any) still has
    // room because srcStub/tgtStub are pre-advanced by STUB_BAR before A*
    // even runs — that reserves the geometry; the preserve-cost penalty
    // only enforces a turn there, which junctions don't need.
    const stubsCollinear = srcStub && tgtStub && (
      ((srcDir === 'E' || srcDir === 'W') && (tgtDir === 'E' || tgtDir === 'W') && srcStub.y === tgtStub.y) ||
      ((srcDir === 'N' || srcDir === 'S') && (tgtDir === 'N' || tgtDir === 'S') && srcStub.x === tgtStub.x)
    );
    const srcIsJunction = !!source.junctionId;
    const tgtIsJunction = !!target.junctionId;
    const ssArg = (stubsCollinear || !srcBarEligible || srcIsJunction) ? null : srcStub;
    const tsArg = (stubsCollinear || !tgtBarEligible || tgtIsJunction) ? null : tgtStub;
    for (const nb of neighbors(cur, xArr, yArr, xIdx, yIdx, obstacles)) {
      const step = edgeCost(cur, nb, wireSegs, obstacles, prevSet,
        ssArg, srcDir, tsArg, tgtDir);
      const nKey = key(nb.x, nb.y, nb.dir);
      const tentative = gScore.get(curKey) + step;
      if (tentative < (gScore.get(nKey) ?? Infinity)) {
        gScore.set(nKey, tentative);
        came.set(nKey, curKey);
        open.set(nKey, tentative + heuristic(nb, tgtStub));
      }
    }
  }
  return fallback(srcPt, srcStub, tgtStub, tgtPt);
}

// Internals --------------------------------------------------------------

function key(x, y, dir) { return `${x},${y}|${dir}`; }
function srcXYKey(x, y) { return `${x},${y}`; }
function parseKey(k) {
  const [xy, dir] = k.split('|');
  const [x, y] = xy.split(',').map(Number);
  return { x, y, dir };
}

function heuristic(p, q) {
  return Math.abs(p.x - q.x) + Math.abs(p.y - q.y);
}

function popMin(open) {
  let bestK = null, bestF = Infinity;
  for (const [k, f] of open) if (f < bestF) { bestF = f; bestK = k; }
  open.delete(bestK);
  return bestK;
}

function neighbors(cur, xArr, yArr, xIdx, yIdx, obstacles) {
  const ix = xIdx.get(cur.x);
  const iy = yIdx.get(cur.y);
  const out = [];
  const push = (nx, ny, dir) => {
    if (nx === cur.x && ny === cur.y) return;
    if (strictlyInside(nx, ny, obstacles)) return;
    if (segCrossesObstacle({ x: cur.x, y: cur.y }, { x: nx, y: ny }, obstacles)) return;
    out.push({ x: nx, y: ny, dir });
  };
  if (ix !== undefined) {
    if (ix + 1 < xArr.length) push(xArr[ix + 1], cur.y, 'E');
    if (ix > 0) push(xArr[ix - 1], cur.y, 'W');
  }
  if (iy !== undefined) {
    if (iy + 1 < yArr.length) push(cur.x, yArr[iy + 1], 'S');
    if (iy > 0) push(cur.x, yArr[iy - 1], 'N');
  }
  return out;
}

function edgeCost(from, to, wireSegs, obstacles, prevSet,
                  srcStub, srcDir, tgtStub, tgtDir) {
  const len = Math.abs(from.x - to.x) + Math.abs(from.y - to.y);
  let cost = len;
  if (from.dir && from.dir !== to.dir) cost += BEND_COST;
  for (const s of wireSegs) {
    if (segOverlap(from, to, s.a, s.b)) cost += OVERLAP_COST;
    else if (segCross(from, to, s.a, s.b)) cost += CROSSING_COST;
  }
  if (hugsObstacle(from, to, obstacles)) cost += NEAR_COST * len / 20;
  if (prevSet && prevSet.has(segKey(from, to))) cost -= REUSE_BONUS;
  // Stub preservation: reject parallel-arrival/departure at the mandatory
  // STUB-length endpoints. See STUB_PRESERVE_COST.
  if (srcStub && from.x === srcStub.x && from.y === srcStub.y && to.dir === srcDir) {
    cost += STUB_PRESERVE_COST;
  }
  if (tgtStub && to.x === tgtStub.x && to.y === tgtStub.y && to.dir === tgtDir) {
    cost += STUB_PRESERVE_COST;
  }
  return cost;
}

function reconstruct(came, endKey) {
  const pts = [];
  let k = endKey;
  while (k) {
    pts.push(parseKey(k));
    k = came.get(k);
  }
  pts.reverse();
  return pts.map(p => ({ x: p.x, y: p.y }));
}

function finalize(srcPt, midPts, tgtPt, wireSegs, obstacles) {
  // Prepend the true source and append the true target so the path starts
  // and ends exactly on the connector positions.
  const raw = [srcPt, ...midPts, tgtPt];
  const compact = simplify(dedupe(raw));
  return nudgeLanes(compact, wireSegs, obstacles);
}

function dedupe(pts) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i], q = out[out.length - 1];
    if (Math.abs(p.x - q.x) < 0.5 && Math.abs(p.y - q.y) < 0.5) continue;
    out.push(p);
  }
  return out;
}

function simplify(pts) {
  if (pts.length < 3) return pts.slice();
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1], b = pts[i], c = pts[i + 1];
    if ((a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y)) continue;
    out.push(b);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

// For each interior orthogonal segment, if it exactly overlaps an existing
// wire segment, try shifting it by +/- LANE_STEP. We leave the neighbouring
// stubs anchored so the endpoints never move.
//
// Guard: skip the shift if either adjacent leg (prev→a or b→next) would
// become shorter than MIN_LEG_AFTER_NUDGE. Below ~2×CORNER_R the rounded
// corners on each side overlap and the bend visually folds into a "kink".
function nudgeLanes(pts, wireSegs, obstacles) {
  if (pts.length < 4) return pts;
  const out = pts.map(p => ({ x: p.x, y: p.y }));
  for (let i = 1; i < out.length - 2; i++) {
    const a = out[i], b = out[i + 1];
    const horiz = a.y === b.y;
    for (const sign of [1, -1, 2, -2]) {
      if (!hasOverlap(a, b, wireSegs)) break;
      const shift = sign * LANE_STEP;
      const na = horiz ? { x: a.x, y: a.y + shift } : { x: a.x + shift, y: a.y };
      const nb = horiz ? { x: b.x, y: b.y + shift } : { x: b.x + shift, y: b.y };
      const prev = out[i - 1], next = out[i + 2];

      // After the shift the adjacent legs change length: prev→a along
      // the perpendicular axis grows or shrinks by |shift|, same for
      // b→next. Reject the shift if either leg would collapse below the
      // anti-kink threshold.
      const legPrev = Math.abs(prev.x - na.x) + Math.abs(prev.y - na.y);
      const legNext = Math.abs(next.x - nb.x) + Math.abs(next.y - nb.y);
      if (legPrev < MIN_LEG_AFTER_NUDGE) continue;
      if (legNext < MIN_LEG_AFTER_NUDGE) continue;

      const okA = !segCrossesObstacle(prev, na, obstacles);
      const okB = !segCrossesObstacle(nb, next, obstacles);
      const okMid = !segCrossesObstacle(na, nb, obstacles);
      if (okA && okB && okMid) { a.x = na.x; a.y = na.y; b.x = nb.x; b.y = nb.y; break; }
    }
  }
  return simplify(out);
}

function hasOverlap(a, b, wireSegs) {
  for (const s of wireSegs) if (segOverlap(a, b, s.a, s.b)) return true;
  return false;
}

// Geometry primitives ---------------------------------------------------

function strictlyInside(x, y, obstacles) {
  for (const ob of obstacles) {
    if (x > ob.x1 && x < ob.x2 && y > ob.y1 && y < ob.y2) return true;
  }
  return false;
}

function segCrossesObstacle(p, q, obstacles) {
  for (const ob of obstacles) {
    if (p.x === q.x) {
      if (p.x <= ob.x1 || p.x >= ob.x2) continue;
      const sy = Math.min(p.y, q.y), ey = Math.max(p.y, q.y);
      if (ey > ob.y1 && sy < ob.y2) return true;
    } else if (p.y === q.y) {
      if (p.y <= ob.y1 || p.y >= ob.y2) continue;
      const sx = Math.min(p.x, q.x), ex = Math.max(p.x, q.x);
      if (ex > ob.x1 && sx < ob.x2) return true;
    }
  }
  return false;
}

function hugsObstacle(p, q, obstacles) {
  for (const ob of obstacles) {
    if (p.y === q.y && (Math.abs(p.y - ob.y1) < 2 || Math.abs(p.y - ob.y2) < 2)) {
      const sx = Math.min(p.x, q.x), ex = Math.max(p.x, q.x);
      if (ex > ob.x1 && sx < ob.x2) return true;
    }
    if (p.x === q.x && (Math.abs(p.x - ob.x1) < 2 || Math.abs(p.x - ob.x2) < 2)) {
      const sy = Math.min(p.y, q.y), ey = Math.max(p.y, q.y);
      if (ey > ob.y1 && sy < ob.y2) return true;
    }
  }
  return false;
}

export function segCross(a, b, c, d) {
  if (a.x === b.x && c.y === d.y) {
    const vx = a.x, vy1 = Math.min(a.y, b.y), vy2 = Math.max(a.y, b.y);
    const hy = c.y, hx1 = Math.min(c.x, d.x), hx2 = Math.max(c.x, d.x);
    return vx > hx1 && vx < hx2 && hy > vy1 && hy < vy2;
  }
  if (a.y === b.y && c.x === d.x) return segCross(c, d, a, b);
  return false;
}

export function segOverlap(a, b, c, d) {
  if (a.x === b.x && c.x === d.x && a.x === c.x) {
    const a1 = Math.min(a.y, b.y), a2 = Math.max(a.y, b.y);
    const b1 = Math.min(c.y, d.y), b2 = Math.max(c.y, d.y);
    return Math.min(a2, b2) - Math.max(a1, b1) > 0;
  }
  if (a.y === b.y && c.y === d.y && a.y === c.y) {
    const a1 = Math.min(a.x, b.x), a2 = Math.max(a.x, b.x);
    const b1 = Math.min(c.x, d.x), b2 = Math.max(c.x, d.x);
    return Math.min(a2, b2) - Math.max(a1, b1) > 0;
  }
  return false;
}

function segKey(a, b) {
  const [x1, y1, x2, y2] = a.x < b.x || (a.x === b.x && a.y < b.y)
    ? [a.x, a.y, b.x, b.y] : [b.x, b.y, a.x, a.y];
  return `${x1},${y1}-${x2},${y2}`;
}

function makeSegSet(pts) {
  if (!pts || pts.length < 2) return null;
  const s = new Set();
  for (let i = 1; i < pts.length; i++) s.add(segKey(pts[i - 1], pts[i]));
  return s;
}

function fallback(srcPt, srcStub, tgtStub, tgtPt) {
  return simplify(dedupe([
    srcPt, srcStub,
    { x: tgtStub.x, y: srcStub.y }, tgtStub, tgtPt,
  ]));
}
