// Pure client-side orthogonal router.
// Builds a sparse visibility graph from connector positions and padded
// component edges, then runs an A* search whose cost penalizes bends,
// crossings and overlaps. Returns a list of orthogonal points (endpoints
// included) that the renderer can draw with rounded corners.
//
// No backend, no Java, no WebWorker, no layout library — everything runs
// synchronously in the browser.

import { state } from '../../state/store.js';
import { endpointPos, endpointDir, advance } from '../geometry.js';
import { collectComponentBoxes, collectWireSegments } from './obstacles.js';

// Tunables --------------------------------------------------------------
const STUB = 112;         // length of mandatory source/target stub
                           // (sized to fit a current-readout bar plus
                           // breathing room: 24px gap + 64px bar + 24px tail)
const BEND_COST = 22;     // penalty per 90° turn
const CROSSING_COST = 220; // penalty per existing wire crossed — strongly discouraged
const OVERLAP_COST = 240; // penalty per axis-aligned overlap with existing wire
const NEAR_COST = 3;      // penalty per segment that hugs an obstacle edge
const REUSE_BONUS = 8;    // reward per segment reused from previous path
const LANE_STEP = 10;     // offset applied when a cleaner lane is available
// Just above BEND_COST so the router is willing to "spend a bend" rather
// than depart srcStub or arrive at tgtStub along the stub axis. Without this
// penalty, A* often takes a parallel-arrival path of equal-or-lower cost,
// and simplify() then collapses the mandatory stub corner — leaving the
// wire's first/last segment shorter than STUB and (downstream) breaking the
// current-bar geometry gate, plus pushing the wire's terminal segment
// inside the destination component's clearance box.
const STUB_PRESERVE_COST = BEND_COST + 1;

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

  // Force the same stub length on every endpoint (including junctions) so
  // each wire has room for a current-readout bar before any 90° bend.
  const srcStubLen = STUB;
  const tgtStubLen = STUB;
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
    const stubsCollinear = srcStub && tgtStub && (
      ((srcDir === 'E' || srcDir === 'W') && (tgtDir === 'E' || tgtDir === 'W') && srcStub.y === tgtStub.y) ||
      ((srcDir === 'N' || srcDir === 'S') && (tgtDir === 'N' || tgtDir === 'S') && srcStub.x === tgtStub.x)
    );
    const ssArg = stubsCollinear ? null : srcStub;
    const tsArg = stubsCollinear ? null : tgtStub;
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
