// SVG rendering: canvas, grid, wires, components, terminals, preview.
// Also owns the small DOM helpers and applyVisualInstructions (tutor
// callbacks highlight/dim .comp groups by id).

import { state, SVG_W, SVG_H, EPS } from '../state/store.js';
import { Tool, Sel, SelKind } from '../state/constants.js';
import { COMP, COMP_SCALE } from './schema.js';
import { editor, onCompMouseDown, onTerminalPointerDown } from './editor.js';
import { deleteWire, deleteComponent, splitWireAtCorner } from '../state/actions.js';
import { termPos, endpointPos } from './geometry.js';
import { route as routePath, segOverlap } from './wiring/router.js';
import { collectComponentBoxes, collectWireSegments } from './wiring/obstacles.js';
import { toSvgPath, previewPath } from './wiring/path.js';
import { isDevMode } from '../tutor/devInspector.js';

export const svg = document.getElementById('canvas');
const SVGNS = 'http://www.w3.org/2000/svg';

// Stable layer groups built once by initRenderer(). render() refills the
// dynamic layers each pass; the grid is built once and never touched again.
let layersInited = false;
let gridG = null;
let wiresG = null;
let compsG = null;
let termsG = null;
let previewG = null;
let wireBarsG = null;
// DEBUG-OVERLAP — temporary diagnostic layer; remove with the rest of the
// overlap-debug code once the iter-improv wiring work lands.
let overlapsG = null;

function clearChildren(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

// Diff `parent`'s children against `items`, keyed by `makeKey(item)`. Items
// without an existing node are built; existing nodes get `update(node, item)`
// (which may mutate in place or return a replacement); orphaned nodes are
// removed. Order in `parent` is kept in sync with `items`.
function reconcile(parent, items, makeKey, build, update) {
  const existing = new Map();
  for (const child of Array.from(parent.children)) {
    const k = child.dataset && child.dataset.key;
    if (k !== undefined && k !== '') existing.set(k, child);
  }
  const seen = new Set();
  let prev = null;
  for (const item of items) {
    const key = String(makeKey(item));
    seen.add(key);
    let node = existing.get(key);
    if (!node) {
      node = build(item);
      node.dataset.key = key;
    } else {
      const replaced = update(node, item);
      if (replaced && replaced !== node) {
        replaced.dataset.key = key;
        node.replaceWith(replaced);
        node = replaced;
      }
    }
    const expectedNext = prev ? prev.nextSibling : parent.firstChild;
    if (expectedNext !== node) parent.insertBefore(node, expectedNext);
    prev = node;
  }
  for (const [k, node] of existing) {
    if (!seen.has(k)) node.remove();
  }
}

export function initRenderer() {
  if (layersInited) return;
  svg.setAttribute('viewBox', `0 0 ${SVG_W} ${SVG_H}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  while (svg.firstChild) svg.removeChild(svg.firstChild);

  gridG = svgEl('g', { class: 'grid' });
  const GRID_PX = 20;
  for (let x = 0; x <= SVG_W; x += GRID_PX) gridG.appendChild(svgEl('line', { class:'grid-line', x1:x, y1:0, x2:x, y2:SVG_H }));
  for (let y = 0; y <= SVG_H; y += GRID_PX) gridG.appendChild(svgEl('line', { class:'grid-line', x1:0, y1:y, x2:SVG_W, y2:y }));
  svg.appendChild(gridG);

  wiresG = svgEl('g', { class: 'wires' });
  svg.appendChild(wiresG);
  // DEBUG-OVERLAP — sits above wires, below components, so red bands hide
  // the wire stroke beneath but do not obscure component bodies/labels.
  overlapsG = svgEl('g', { class: 'wire-overlaps-debug', 'pointer-events': 'none' });
  svg.appendChild(overlapsG);
  compsG = svgEl('g', { class: 'comps' });
  svg.appendChild(compsG);
  termsG = svgEl('g', { class: 'terms' });
  svg.appendChild(termsG);
  previewG = svgEl('g', { class: 'preview' });
  svg.appendChild(previewG);
  wireBarsG = svgEl('g', { class: 'wire-bars', 'pointer-events': 'none' });
  svg.appendChild(wireBarsG);

  layersInited = true;
}

export function svgEl(tag, attrs, ...children) {
  const e = document.createElementNS(SVGNS, tag);
  for (const k in attrs) {
    if (k === 'class') e.setAttribute('class', attrs[k]);
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), attrs[k]);
    else if (attrs[k] !== undefined && attrs[k] !== null) e.setAttribute(k, attrs[k]);
  }
  for (const c of children) if (c) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  return e;
}

export function keyOfTerm(cid, tn) { return cid + '.' + tn; }

// Pull the committed path for a wire, routing and caching on demand.
export function resolveWirePath(w) {
  const p0 = endpointPos(w.a);
  const pn = endpointPos(w.b);
  if (!p0 || !pn) return null;
  const cached = w.path;
  const endpointsMoved = !cached || cached.length < 2 ||
    !near(cached[0], p0) || !near(cached[cached.length - 1], pn);
  if (endpointsMoved) {
    const next = routePath(w.a, w.b, {
      excludeComps: [w.a.compId, w.b.compId].filter(Boolean),
      excludeWires: [w.id],
      previousPath: cached,
    });
    if (next && next.length >= 2) {
      w.path = next;
      return next;
    }
    // Fallback: two-segment preview keeps endpoints correct even if routing
    // fails for some reason.
    return [p0, { x: pn.x, y: p0.y }, pn];
  }
  return cached;
}

function near(a, b) {
  return Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5;
}

// While a component is being dragged, reroute wires attached to it in real
// time so they stay obstacle-aware instead of cutting through other parts.
function dragPreviewPts(w) {
  const next = routePath(w.a, w.b, {
    excludeComps: [w.a.compId, w.b.compId].filter(Boolean),
    excludeWires: [w.id],
    previousPath: w.path,
  });
  if (next && next.length >= 2) return next;
  const p0 = endpointPos(w.a);
  const pn = endpointPos(w.b);
  if (!p0 || !pn) return null;
  const dx = pn.x - p0.x, dy = pn.y - p0.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return [p0, { x: p0.x + dx / 2, y: p0.y }, { x: p0.x + dx / 2, y: pn.y }, pn];
  }
  return [p0, { x: p0.x, y: p0.y + dy / 2 }, { x: pn.x, y: p0.y + dy / 2 }, pn];
}

// Reroute wires that touch any of the given components. Called from the
// editor after a drag finishes so only affected wires move.
export function rerouteWiresFor(componentIds) {
  const touched = new Set(componentIds);
  for (const w of state.wires) {
    const aHit = w.a.compId && touched.has(w.a.compId);
    const bHit = w.b.compId && touched.has(w.b.compId);
    if (!aHit && !bHit) continue;
    const next = routePath(w.a, w.b, {
      excludeComps: [w.a.compId, w.b.compId].filter(Boolean),
      excludeWires: [w.id],
      previousPath: w.path,
    });
    if (next && next.length >= 2) w.path = next;
  }
}

export function checkMeterPlacement(meter) {
  // Warn if ammeter has voltmeter placement (no current through it means maybe in parallel as bypass) —
  // Simplification: warn if ammeter current == 0 while circuit is live, or voltmeter has significant current.
  if (!state.sim || !state.sim.ok || state.sim.empty || state.sim.isOpen) return null;
  const el = state.sim.elementByCompId.get(meter.id);
  if (!el) return null;
  if (meter.type === 'ammeter' && Math.abs(el.current) < 1e-5) return 'warn';
  if (meter.type === 'voltmeter' && Math.abs(el.current) > 1e-3) return 'warn';
  return null;
}

export function render() {
  if (!layersInited) initRenderer();
  clearChildren(termsG);

  // Plan all current bars before drawing wires. The wires render at full
  // length; each bar's opaque background covers the wire underneath so the
  // bar appears to sit on top of a continuous wire (visible on both sides).
  const wireBars = planWireBars();

  // Per-wire reconcile: unchanged wires skip DOM work entirely, class-only
  // changes (selected / active / reverse) mutate the existing path, and only
  // path-shape changes trigger a node replacement.
  const draggingComp = editor.dragging ? editor.dragging.compId : null;
  const showCurrent = state.sim && state.sim.ok && !state.sim.empty && !state.sim.isOpen && state.toggles.current;
  // Build the set of "live" sim nodes once per render so per-wire active
  // detection is O(1) instead of O(elements).
  const liveNodes = showCurrent ? new Set() : null;
  if (showCurrent) {
    for (const e of state.sim.elements) {
      if (Math.abs(e.current) > 1e-4) {
        if (e.na !== undefined) liveNodes.add(e.na);
        if (e.nb !== undefined) liveNodes.add(e.nb);
      }
    }
  }
  // Reference current for normalising flow speed: max |I| across all elements
  // this render. Falls back to supplyV if no comps yet. Used to set
  // `--flow-dur` per active wire so wires carrying more current visibly cycle
  // their dashes faster than wires with a trickle.
  let refCurrent = 0;
  if (showCurrent) {
    for (const e of state.sim.elements) {
      const a = Math.abs(e.current);
      if (a > refCurrent) refCurrent = a;
    }
  }
  const wireInfos = [];
  for (const w of state.wires) {
    // During a drag, route the live wires without writing to w.path so a
    // single drop still gets a proper post-drag reroute.
    const isLive = draggingComp && (w.a.compId === draggingComp || w.b.compId === draggingComp);
    const pts = isLive ? null : resolveWirePath(w);
    const fullPts = isLive ? dragPreviewPts(w) : pts;
    if (!fullPts || fullPts.length < 2) continue;
    let cls = 'wire';
    let flowDur = null;     // seconds — null = inactive
    let currentMag = 0;
    if (Sel.matches(state.selection, SelKind.WIRE, w.id)) cls += ' selected';
    if (showCurrent) {
      const nodeA = state.sim.getNodeByEp ? state.sim.getNodeByEp(w.a) : state.sim.getNode(w.a.compId, w.a.term);
      if (liveNodes.has(nodeA)) {
        cls += ' active';
        const nodeB = state.sim.getNodeByEp ? state.sim.getNodeByEp(w.b) : state.sim.getNode(w.b.compId, w.b.term);
        const Va = state.sim.nodes && nodeA !== undefined ? state.sim.nodes[nodeA] : undefined;
        const Vb = state.sim.nodes && nodeB !== undefined ? state.sim.nodes[nodeB] : undefined;
        if (Va !== undefined && Vb !== undefined && Vb > Va) cls += ' reverse';
        // Pick a representative current magnitude for this wire — try the
        // attached component on either end, falling back to the global max
        // when both ends sit on junctions.
        const elA = w.a.compId ? state.sim.elementByCompId.get(w.a.compId) : null;
        const elB = w.b.compId ? state.sim.elementByCompId.get(w.b.compId) : null;
        currentMag = Math.max(
          elA ? Math.abs(elA.current) : 0,
          elB ? Math.abs(elB.current) : 0,
        );
        if (currentMag <= 0) currentMag = refCurrent;
        const norm = refCurrent > 0 ? Math.min(1, currentMag / refCurrent) : 0;
        // Fast at high current, slow at low current. 0.55s..2.4s.
        flowDur = +(2.4 - 1.85 * norm).toFixed(2);
      }
    }
    wireInfos.push({
      w, drawPts: fullPts, cls, flowDur,
      isHovered: editor.hoveredWireId === w.id,
    });
  }
  reconcile(
    wiresG,
    wireInfos,
    info => info.w.id,
    info => buildWireGroup(info),
    (node, info) => updateWireGroup(node, info),
  );

  // DEBUG-OVERLAP — paint collinear sub-segments shared by two wires.
  renderOverlapsDebug(wireInfos);

  // Per-component reconcile: each component owns a stable <g data-cid="..">
  // node. Updates currently rebuild the whole sub-tree (cheapest correct path
  // until label/brightness/meter visuals are split out), but the keyed node
  // is what makes the drag fast-path possible — `applyDragFrame` mutates the
  // dragged comp's transform + terminals in place without rebuilding.
  reconcile(
    compsG,
    state.components,
    c => c.id,
    c => renderComponent(c),
    (_node, c) => renderComponent(c),
  );

  // Terminal hit areas with explicit connector visual states.
  const pending = state.pendingWire;
  const invalid = editor.invalidHoverKey;
  for (const c of state.components) {
    for (const t of COMP[c.type].terms) {
      const p = termPos(c, t.n);
      const k = keyOfTerm(c.id, t.n);
      const isActiveSource = pending && pending.from.compId === c.id && pending.from.term === t.n;
      const isHovered = editor.hoveredTerm === k && !isActiveSource;
      const isInvalid = invalid === k;
      const isValidTarget = pending && !isActiveSource && !isInvalid;
      let cls = 'terminal';
      if (isActiveSource) cls += ' source';
      else if (isInvalid) cls += ' invalid';
      else if (isHovered) cls += ' hover';
      else if (isValidTarget) cls += ' valid';
      termsG.appendChild(svgEl('circle', {
        class: cls, cx: p.x, cy: p.y, r: 4,
        'data-comp': c.id, 'data-tname': t.n,
      }));
      termsG.appendChild(svgEl('circle', {
        class: 'terminal hit', cx: p.x, cy: p.y, r: 16,
        'data-term': k,
        'data-comp': c.id,
        'data-tname': t.n,
        onpointerdown: (ev) => { ev.stopPropagation(); onTerminalPointerDown(ev, c.id, t.n); },
      }));
    }
  }

  // Junctions — persistent T-junction dots. These are also wire endpoints,
  // so they get a hit area and behave as terminals under the pending-wire
  // controller.
  for (const j of state.junctions) {
    const k = 'J:' + j.id;
    const isActiveSource = pending && pending.from.junctionId === j.id;
    const isHovered = editor.hoveredTerm === k && !isActiveSource;
    const isInvalid = invalid === k;
    const isValidTarget = pending && !isActiveSource && !isInvalid;
    let cls = 'junction';
    if (isActiveSource) cls += ' source';
    else if (isInvalid) cls += ' invalid';
    else if (isHovered) cls += ' hover';
    else if (isValidTarget) cls += ' valid';
    termsG.appendChild(svgEl('circle', { class: cls, cx: j.x, cy: j.y, r: 4.5 }));
    termsG.appendChild(svgEl('circle', {
      class: 'terminal hit', cx: j.x, cy: j.y, r: 14,
      'data-term': k,
      'data-junction': j.id,
      onpointerdown: (ev) => { ev.stopPropagation(); onTerminalPointerDown(ev, null, null, j.id); },
    }));
  }

  // Preview wire — single stable node, mutated in place between renders.
  reconcilePreview();

  // Current bars overlaid on each wire (component bars + KCL junction bars).
  renderWireBars(wireBars);
}

// Build a fresh <g.wire-group> for a wire. Used by reconcile() when no
// existing node is found for this wire id.
//
// A wire is rendered as TWO layered visible paths plus a fat invisible hit
// path:
//   * .wire-base — solid, continuous, dim. Always shown so the conductor
//     reads as unbroken even when the flow overlay's dashes happen to land
//     across a corner.
//   * .wire-flow — bright dashed overlay, animated via stroke-dashoffset.
//     Only carries class "active" when current flows; the dasharray stays
//     attached so deactivation simply hides the overlay (CSS opacity 0).
//   * .wire-hover-hit — fat transparent hit target for pointer events.
//
// The class list (selected / active / reverse) lives on .wire-flow so the
// existing CSS selectors keep working.
function buildWireGroup(info) {
  const { w, drawPts, cls, flowDur, isHovered } = info;
  const d = toSvgPath(drawPts);
  const wireGroup = svgEl('g', {
    class: 'wire-group',
    'data-wid': w.id,
    onpointerenter: () => setHoveredWire(w.id),
    onpointerleave: () => { if (editor.hoveredWireId === w.id) setHoveredWire(null); },
    onclick: (ev) => {
      ev.stopPropagation();
      if (state.tool === Tool.DELETE) { deleteWire(w.id); return; }
      setSelection(Sel.wire(w.id));
    },
  });
  // Base path — always solid, never dashed. Selected/hover state lives here.
  const baseCls = 'wire-base' + (cls.includes('selected') ? ' selected' : '');
  wireGroup.appendChild(svgEl('path', {
    class: baseCls, d,
    'data-wid': w.id,
    'data-role': 'base',
  }));
  // Flow overlay — bright dashed layer. Hidden when no current flows.
  const flowCls = cls.replace(/\bwire\b/, 'wire-flow').trim();
  const flowAttrs = {
    class: flowCls, d,
    'data-wid': w.id,
    'data-role': 'flow',
  };
  if (flowDur != null) flowAttrs.style = `--flow-dur:${flowDur}s`;
  wireGroup.appendChild(svgEl('path', flowAttrs));
  wireGroup.appendChild(svgEl('path', {
    class: 'wire-hover-hit',
    d, fill: 'none', stroke: 'transparent', 'stroke-width': 16,
    'data-wid': w.id,
    'data-role': 'hit',
  }));
  if (isHovered && drawPts.length >= 3) appendHoverDots(wireGroup, w, drawPts);
  return wireGroup;
}

// Patch an existing wire group in place. Class-only changes touch a single
// attribute; geometry changes also rewrite the three `d`s and refresh the
// hover dots so they stay glued to the new corner positions.
function updateWireGroup(node, info) {
  const { w, drawPts, cls, flowDur, isHovered } = info;
  const d = toSvgPath(drawPts);
  const base = node.querySelector(':scope > path[data-role="base"]');
  const flow = node.querySelector(':scope > path[data-role="flow"]');
  const hit  = node.querySelector(':scope > path[data-role="hit"]');
  if (!base || !flow || !hit) return buildWireGroup(info); // unexpected shape — rebuild
  if (base.getAttribute('d') !== d) {
    base.setAttribute('d', d);
    flow.setAttribute('d', d);
    hit.setAttribute('d', d);
    // Corner positions moved — reset and re-add if currently hovered.
    node.querySelectorAll('.wire-corner, .wire-corner-hit').forEach(n => n.remove());
    if (isHovered && drawPts.length >= 3) appendHoverDots(node, w, drawPts);
  } else {
    // Path unchanged. The hover dots are owned by setHoveredWire/clearWireHoverDots
    // between renders, so don't touch them here — but if the cached state
    // disagrees with the DOM (e.g. first render after a hover began before the
    // group existed), reconcile it now.
    const hasDots = !!node.querySelector(':scope > .wire-corner');
    if (isHovered && !hasDots && drawPts.length >= 3) appendHoverDots(node, w, drawPts);
    else if (!isHovered && hasDots) {
      node.querySelectorAll('.wire-corner, .wire-corner-hit').forEach(n => n.remove());
    }
  }
  const baseCls = 'wire-base' + (cls.includes('selected') ? ' selected' : '');
  if (base.getAttribute('class') !== baseCls) base.setAttribute('class', baseCls);
  const flowCls = cls.replace(/\bwire\b/, 'wire-flow').trim();
  if (flow.getAttribute('class') !== flowCls) flow.setAttribute('class', flowCls);
  const flowStyle = flowDur != null ? `--flow-dur:${flowDur}s` : '';
  if ((flow.getAttribute('style') || '') !== flowStyle) {
    if (flowStyle) flow.setAttribute('style', flowStyle);
    else flow.removeAttribute('style');
  }
  return node;
}

// DEBUG-OVERLAP — diagnostic only. Gated on dev mode so the O(N^2) segment-pair
// scan never runs in normal student sessions.
function renderOverlapsDebug(wireInfos) {
  if (!overlapsG) return;
  clearChildren(overlapsG);
  if (!isDevMode()) return;
  const segs = [];
  for (const info of wireInfos) {
    const pts = info.drawPts;
    for (let i = 1; i < pts.length; i++) {
      segs.push({ wid: info.w.id, a: pts[i - 1], b: pts[i] });
    }
  }
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const s1 = segs[i], s2 = segs[j];
      if (s1.wid === s2.wid) continue;
      if (!segOverlap(s1.a, s1.b, s2.a, s2.b)) continue;
      const span = overlapSpan(s1, s2);
      if (!span) continue;
      overlapsG.appendChild(svgEl('line', {
        class: 'wire-debug-overlap',
        x1: span.x1, y1: span.y1, x2: span.x2, y2: span.y2,
      }));
    }
  }
}

function overlapSpan(s1, s2) {
  // Both segments are axis-aligned and collinear (segOverlap precondition).
  if (s1.a.x === s1.b.x && s2.a.x === s2.b.x && s1.a.x === s2.a.x) {
    const lo = Math.max(Math.min(s1.a.y, s1.b.y), Math.min(s2.a.y, s2.b.y));
    const hi = Math.min(Math.max(s1.a.y, s1.b.y), Math.max(s2.a.y, s2.b.y));
    if (hi <= lo) return null;
    return { x1: s1.a.x, y1: lo, x2: s1.a.x, y2: hi };
  }
  if (s1.a.y === s1.b.y && s2.a.y === s2.b.y && s1.a.y === s2.a.y) {
    const lo = Math.max(Math.min(s1.a.x, s1.b.x), Math.min(s2.a.x, s2.b.x));
    const hi = Math.min(Math.max(s1.a.x, s1.b.x), Math.max(s2.a.x, s2.b.x));
    if (hi <= lo) return null;
    return { x1: lo, y1: s1.a.y, x2: hi, y2: s1.a.y };
  }
  return null;
}

function appendHoverDots(g, w, pts) {
  for (let i = 1; i < pts.length - 1; i++) {
    const cp = pts[i];
    g.appendChild(svgEl('circle', { class: 'wire-corner', cx: cp.x, cy: cp.y, r: 5 }));
    g.appendChild(svgEl('circle', {
      class: 'terminal hit wire-corner-hit',
      cx: cp.x, cy: cp.y, r: 14,
      'data-wire-corner': w.id + ':' + i,
      onpointerdown: (ev) => {
        ev.stopPropagation();
        const jid = splitWireAtCorner(w.id, { x: cp.x, y: cp.y }, i);
        if (jid) onTerminalPointerDown(ev, null, null, jid);
      },
    }));
  }
}

// Tracks the previous `closed` state of every switch so renderComponent can
// detect a flip and trigger a one-shot snap+spark animation. Cleared
// implicitly when a switch is deleted because the next render won't read it.
const _prevSwitchClosed = new Map();

export function renderComponent(c) {
  const isLocked = state.lockedIds && state.lockedIds.has(c.id);
  const vis = state.visuals && state.visuals[c.id];
  const visCls = vis ? ' tutor-' + vis.action : '';

  // Physics-derived per-component CSS variables. These power the slow
  // shimmer + warm/lume effects in base.css. Computed once before the SVG
  // group is built so we can write them in a single style="" attribute.
  const simEl = state.sim && state.sim.ok ? state.sim.elementByCompId.get(c.id) : null;
  const power = simEl ? Math.abs((simEl.current || 0) * (simEl.drop || 0)) : 0;
  // Reference power: the supply's V × max-element-current — gives a sensible
  // 0..1 normalisation across most circuits in the curriculum.
  let refPower = 0;
  if (state.sim && state.sim.ok && !state.sim.empty) {
    refPower = Math.max(0.0001,
      (state.sim.supplyV || 0) * (state.sim.totalI || 0));
  }
  const heat = refPower > 0 ? Math.min(1, power / refPower) : 0;
  const lume = refPower > 0 ? Math.min(1, power / (refPower * 0.6)) : 0;
  const supply = (c.type === 'cell' || c.type === 'battery')
    && state.sim && state.sim.ok && !state.sim.empty && !state.sim.isOpen
    && (state.sim.totalI || 0) > 1e-4 ? 1 : 0;

  let extraCls = '';
  // Switch flip detection — set the previous state to current state by the
  // end of this render. If they disagree we tag the comp with a transient
  // class so the CSS arm-rotation + spark keyframes fire once.
  if (c.type === 'switch') {
    const prev = _prevSwitchClosed.get(c.id);
    if (prev !== undefined && prev !== c.props.closed) {
      extraCls += c.props.closed ? ' switch-snap-closed' : ' switch-snap-open';
    }
    _prevSwitchClosed.set(c.id, !!c.props.closed);
  }

  const styleParts = [`--heat:${heat.toFixed(3)}`, `--lume:${lume.toFixed(3)}`, `--supply:${supply}`];
  const g = svgEl('g', {
    class: 'comp' + (Sel.matches(state.selection, SelKind.COMPONENT, c.id) ? ' selected' : '') + (isLocked ? ' locked' : '') + visCls + extraCls,
    transform: `translate(${c.x}, ${c.y}) scale(${COMP_SCALE})`,
    style: styleParts.join('; '),
    'data-cid': c.id,
    onpointerdown: (ev) => onCompMouseDown(ev, c),
    onclick: (ev) => {
      ev.stopPropagation();
      if (state.tool === Tool.DELETE) { deleteComponent(c.id); return; }
      setSelection(Sel.component(c.id));
    },
  });

  const boxRaw = COMP[c.type];
  const bw = boxRaw.w;
  const bh = boxRaw.h;
  g.appendChild(svgEl('rect', {
    class:'frame', x: -bw/2-14, y: -bh/2-32, width: bw+28, height: bh+64,
    rx: 10, ry: 10, fill: 'transparent', stroke: 'transparent'
  }));

  if (c.type === 'cell' || c.type === 'battery') {
    const w = c.type === 'battery' ? 80 : 60;
    const n = c.type === 'battery' ? 2 : 1;
    const spacing = 16;
    const startX = -spacing*(n-1)/2 - 6;
    g.appendChild(svgEl('line', { class:'body', x1:-w/2, y1:0, x2:startX-8, y2:0 }));
    g.appendChild(svgEl('line', { class:'body', x1:startX + spacing*(n-1)+20, y1:0, x2:w/2, y2:0 }));
    for (let i = 0; i < n; i++) {
      const sx = startX + spacing*i;
      g.appendChild(svgEl('line', { class:'body', x1:sx, y1:-14, x2:sx, y2:14 }));
      g.appendChild(svgEl('line', { class:'body', x1:sx+10, y1:-8, x2:sx+10, y2:8 }));
    }
    // Faint pulsing dots at each end of the cell — only visible while the
    // battery is actually sourcing current. The `.term-pulse` keyframe in
    // base.css drives the breathing glow; --supply gates visibility.
    g.appendChild(svgEl('circle', { class: 'term-pulse pos', cx: -w/2, cy: 0, r: 3 }));
    g.appendChild(svgEl('circle', { class: 'term-pulse neg', cx:  w/2, cy: 0, r: 3 }));
    if (state.toggles.labels) {
      g.appendChild(svgEl('text', { x:-w/2+4, y:-16, class:'label' }, '+'));
      g.appendChild(svgEl('text', { x: w/2-10, y:-16, class:'label' }, '−'));
      g.appendChild(svgEl('text', { x:0, y: bh/2 + 10, 'text-anchor':'middle', class:'val v' }, `${c.props.voltage} V`));
      g.appendChild(svgEl('text', { x:0, y: -bh/2 - 6, 'text-anchor':'middle', class:'label' }, c.id));
    }
  } else if (c.type === 'switch') {
    g.appendChild(svgEl('line', { class:'body', x1:-30, y1:0, x2:-12, y2:0 }));
    g.appendChild(svgEl('line', { class:'body', x1:12, y1:0, x2:30, y2:0 }));
    g.appendChild(svgEl('circle', { class:'fill pivot', cx:-12, cy:0, r:3 }));
    g.appendChild(svgEl('circle', { class:'fill', cx:12, cy:0, r:3 }));
    // The lever arm is wrapped in its own <g> with a pivot at (-12, 0) so a
    // CSS rotation animates it like a snap-action toggle. Closed → arm at
    // 0deg; open → arm rotated upward. The CSS classes
    // .switch-snap-closed / .switch-snap-open run a brief overshoot.
    const arm = svgEl('g', { class: 'switch-arm' });
    if (c.props.closed) arm.appendChild(svgEl('line', { class:'body arm', x1:-12, y1:0, x2:12, y2:0 }));
    else arm.appendChild(svgEl('line', { class:'body arm', x1:-12, y1:0, x2:10, y2:-14 }));
    g.appendChild(arm);
    // One-shot spark group — only emitted on the very render where the
    // switch was just flipped. The CSS animation removes itself by ending
    // at opacity 0 (the next render rebuilds without it).
    if (extraCls.includes('switch-snap')) {
      const spark = svgEl('g', { class: 'switch-spark' });
      // Three short radial flares + a central flash at the closing contact.
      const cx = c.props.closed ? 0 : -12;
      spark.appendChild(svgEl('circle', { class: 'spark-core', cx, cy: 0, r: 2 }));
      for (let i = 0; i < 6; i++) {
        const ang = (i / 6) * Math.PI * 2 + 0.3;
        const r1 = 3, r2 = 9;
        spark.appendChild(svgEl('line', {
          class: 'spark-ray',
          x1: cx + Math.cos(ang) * r1,
          y1:      Math.sin(ang) * r1,
          x2: cx + Math.cos(ang) * r2,
          y2:      Math.sin(ang) * r2,
        }));
      }
      g.appendChild(spark);
    }
    if (state.toggles.labels) {
      g.appendChild(svgEl('text', { x:0, y: bh/2 + 14, 'text-anchor':'middle', class:'val' }, c.props.closed ? 'closed' : 'open'));
      g.appendChild(svgEl('text', { x:0, y: -bh/2 - 4, 'text-anchor':'middle', class:'label' }, c.id));
    }
  } else if (c.type === 'resistor') {
    g.appendChild(svgEl('line', { class:'body', x1:-40, y1:0, x2:-20, y2:0 }));
    g.appendChild(svgEl('rect', { class:'fill', x:-20, y:-10, width:40, height:20, rx:2 }));
    g.appendChild(svgEl('line', { class:'body', x1:20, y1:0, x2:40, y2:0 }));
    // Warm-halo overlay — visible only when --heat > 0 (CSS uses opacity
    // proportional to heat). Sits on top of the body rectangle so the warm
    // tint reads as the resistor heating up rather than a separate part.
    g.appendChild(svgEl('rect', {
      class: 'r-heat', x: -22, y: -12, width: 44, height: 24, rx: 4,
    }));
    if (state.toggles.labels) {
      g.appendChild(svgEl('text', { x:0, y: 4, 'text-anchor':'middle', class:'val r' }, `${Math.round(c.props.resistance)}Ω`));
      g.appendChild(svgEl('text', { x:0, y: -bh/2 - 4, 'text-anchor':'middle', class:'label' }, c.id));
    }
  } else if (c.type === 'bulb') {
    const brightness = simEl && state.sim && state.sim.ok ? Math.min(1, Math.abs(simEl.current) * Math.abs(simEl.current) * simEl.value / 10) : 0;
    g.appendChild(svgEl('line', { class:'body', x1:-30, y1:0, x2:-14, y2:0 }));
    g.appendChild(svgEl('line', { class:'body', x1:14, y1:0, x2:30, y2:0 }));
    g.appendChild(svgEl('circle', { class:'fill', cx:0, cy:0, r:14 }));
    if (brightness > 0.02) {
      g.appendChild(svgEl('circle', { class: 'bulb-halo bulb-halo-outer', cx:0, cy:0, r: 14 + brightness*8, fill:`rgba(255,207,92,${0.3 + 0.5*brightness})`, 'stroke':'none' }));
      g.appendChild(svgEl('circle', { class: 'bulb-halo bulb-halo-inner', cx:0, cy:0, r: 10, fill:`rgba(255,235,150,${brightness})`, 'stroke':'none' }));
    }
    g.appendChild(svgEl('line', { class:'body', x1:-9, y1:-9, x2:9, y2:9 }));
    g.appendChild(svgEl('line', { class:'body', x1:-9, y1:9, x2:9, y2:-9 }));
    if (state.toggles.labels) {
      g.appendChild(svgEl('text', { x:0, y: -bh/2 - 8, 'text-anchor':'middle', class:'label' }, c.id));
    }
  } else if (c.type === 'ammeter' || c.type === 'voltmeter') {
    const isA = c.type === 'ammeter';
    g.appendChild(svgEl('line', { class:'body', x1:-30, y1:0, x2:-14, y2:0 }));
    g.appendChild(svgEl('line', { class:'body', x1:14, y1:0, x2:30, y2:0 }));
    g.appendChild(svgEl('circle', { class:'fill', cx:0, cy:0, r:14 }));
    g.appendChild(svgEl('text', { x:0, y:4, 'text-anchor':'middle', class:'label', 'font-size': 10 }, isA ? 'A' : 'V'));

    // Digital LCD-style readout sitting just above the meter (upright).
    const unit = isA ? 'A' : 'V';
    let digits = '0.00';
    if (simEl && state.sim && state.sim.ok && !state.sim.empty && !state.sim.isShort) {
      const raw = isA ? Math.abs(simEl.current) : Math.abs(simEl.drop);
      digits = raw < 10 ? raw.toFixed(2) : raw.toFixed(1);
    }
    const lcdW = 54, lcdH = 18, lcdY = -(bh/2 + lcdH + 4);
    g.appendChild(svgEl('rect', {
      class: 'meter-lcd-bg' + (isA ? '' : ' v'),
      x: -lcdW/2, y: lcdY, width: lcdW, height: lcdH, rx: 3,
    }));
    // True geometric centring of the readout: anchor at the box centre
    // (x=0, y=lcdY+lcdH/2) with both axes' anchors set to middle/central
    // so the glyph cell is symmetric around that point regardless of
    // font metrics. Old code used text-anchor="end" with hand-rolled
    // padding which left the digits offset right + up.
    g.appendChild(svgEl('text', {
      x: 0, y: lcdY + lcdH/2,
      'text-anchor': 'middle',
      'dominant-baseline': 'central',
      class: 'meter-lcd-text' + (isA ? '' : ' v'),
    }, digits + unit));

    if (state.toggles.labels) {
      g.appendChild(svgEl('text', { x:0, y: bh/2 + 18, 'text-anchor':'middle', class:'label' }, c.id));
    }
    if (checkMeterPlacement(c) === 'warn') {
      g.classList.add('error');
    }
  }

  // Voltage drop bar for resistors/bulbs, placed below the body. The current
  // bar that used to live here was promoted to a wire overlay (see
  // planWireBars / renderWireBars below) so it can also visualise KCL splits at
  // junctions.
  const showVBar = simEl && (c.type === 'bulb' || c.type === 'resistor')
    && state.sim && state.sim.ok && !state.sim.isShort
    && state.toggles.voltage && state.sim.supplyV > 0;
  if (showVBar) {
    const barLen = BAR_LEN_LOCAL, barT = BAR_T_LOCAL;
    // Fixed local-space yBase across every V-bar component, so resistor and
    // bulb V-bars share one absolute offset (≥10px below the largest body).
    const yBase = 24;
    const vfrac = Math.min(1, Math.abs(simEl.drop) / state.sim.supplyV);
    g.appendChild(svgEl('rect', { class:'vbar-bg', x:-barLen/2, y: yBase, width: barLen, height: barT, rx:2 }));
    g.appendChild(svgEl('rect', { class:'vbar-fg', x:-barLen/2, y: yBase, width: barLen*vfrac, height: barT, rx:2 }));
    g.appendChild(svgEl('text', {
      x: barLen/2 + 4, y: yBase + barT/2,
      'dominant-baseline': 'middle',
      style: `font-size: ${BAR_LABEL_LOCAL_PX}px`,
      class: 'bar-label v',
    }, `${Math.abs(simEl.drop).toFixed(2)}V`));
  }

  return g;
}

// Sum the current flowing from junction J out into `wire` (toward its far
// end). Implemented by DFS through wires and junctions from the far end of
// `wire`, collecting component terminals reached (without crossing J), then
// summing the signed current each of them draws out of the MNA node.
//
// `junctionAdj` is a precomputed Map<junctionId, wire[]> shared by all
// junction bars on the same render pass — avoids O(W) `state.wires` scans
// per junction step.
function kclCurrentThroughWire(j, wire, junctionAdj) {
  if (!state.sim || !state.sim.ok) return 0;
  const startEp = (wire.a.junctionId === j.id) ? wire.b : wire.a;
  const visitedWires = new Set([wire.id]);
  const visitedJunctions = new Set([j.id]);
  const terminals = [];
  const stack = [startEp];
  while (stack.length) {
    const ep = stack.pop();
    if (!ep) continue;
    if (ep.junctionId) {
      if (visitedJunctions.has(ep.junctionId)) continue;
      visitedJunctions.add(ep.junctionId);
      const adjWires = junctionAdj.get(ep.junctionId) || [];
      for (const w of adjWires) {
        if (visitedWires.has(w.id)) continue;
        visitedWires.add(w.id);
        stack.push(w.a.junctionId === ep.junctionId ? w.b : w.a);
      }
    } else {
      terminals.push(ep);
    }
  }
  let sum = 0;
  for (const t of terminals) {
    const el = state.sim.elementByCompId.get(t.compId);
    if (!el) continue;
    const isPositiveTerm = (t.term === 'a' || t.term === '+');
    sum += (isPositiveTerm ? 1 : -1) * (el.current || 0);
  }
  return sum;
}

// Build Map<junctionId, wire[]> and Map<"compId.term", wire> for one render
// pass. Both are O(W); each consumer would otherwise rescan state.wires per
// lookup (junction iter: O(J*W); component bar iter: O(C*T*W)).
function buildWireIndices() {
  const junctionAdj = new Map();
  const compTermWire = new Map();
  for (const w of state.wires) {
    if (w.a.junctionId) {
      let arr = junctionAdj.get(w.a.junctionId);
      if (!arr) { arr = []; junctionAdj.set(w.a.junctionId, arr); }
      arr.push(w);
    } else if (w.a.compId) {
      compTermWire.set(w.a.compId + '.' + w.a.term, w);
    }
    if (w.b.junctionId) {
      let arr = junctionAdj.get(w.b.junctionId);
      if (!arr) { arr = []; junctionAdj.set(w.b.junctionId, arr); }
      arr.push(w);
    } else if (w.b.compId) {
      compTermWire.set(w.b.compId + '.' + w.b.term, w);
    }
  }
  return { junctionAdj, compTermWire };
}

// ---------------------------------------------------------------------------
// Current bars overlaid on wires.
//
// Visualisation rules (see project conversation):
//  * One bar per circuit component (cell/battery/resistor/bulb), placed on
//    the wire leaving its right-side terminal by default. Filled to 100%
//    because all of the component's current flows through that wire.
//  * One bar per outgoing wire at every ≥3-way junction, filled as a
//    fraction of the total current entering the junction (sum |I|/2). This
//    makes Kirchhoff's current law visible: a wire carrying half the
//    junction's flow looks half-full.
//  * If a wire already has a junction bar (at either end), the connected
//    component's bar is suppressed for that wire — try the component's
//    other terminal, otherwise no bar at all. So a series loop of N
//    components shows at most N bars total.
//  * The wire is trimmed back from each "barred" end so the bar sits
//    cleanly on the wire instead of underlapping it.
// ---------------------------------------------------------------------------

const COMP_BAR_TYPES = new Set(['cell', 'battery', 'resistor', 'bulb']);
// Shared bar dimensions in component-local space — voltage bar uses these
// directly (auto-scaled by the comp's scale(COMP_SCALE) transform), current bar
// multiplies by COMP_SCALE so both render at the same world-space size at any
// COMP_SCALE setting. Same coupling for the bar-label font size: V-label
// divides by COMP_SCALE to compensate for being inside the scaled group.
const BAR_LEN_LOCAL = 54;
const BAR_T_LOCAL = 6;
const BAR_LEN = BAR_LEN_LOCAL * COMP_SCALE;
const BAR_T = BAR_T_LOCAL * COMP_SCALE;
const BAR_LABEL_WORLD_PX = 12;
const BAR_LABEL_LOCAL_PX = BAR_LABEL_WORLD_PX / COMP_SCALE;
const TERMINAL_GAP = 24;     // breathing space between terminal and bar
const POST_BAR_GAP = 24;     // space between bar end and next 90° turn

function planWireBars() {
  // Returns Map<wireId, { start?: barInfo, end?: barInfo }>
  // where 'start' means the wire's `a` endpoint and 'end' means `b`.
  const bars = new Map();
  if (!state.sim || !state.sim.ok || state.sim.empty || state.sim.isOpen || state.sim.isShort) return bars;
  if (!state.toggles.current) return bars;

  const { junctionAdj, compTermWire } = buildWireIndices();

  const claim = (wid, atStart, info) => {
    let entry = bars.get(wid);
    if (!entry) { entry = {}; bars.set(wid, entry); }
    entry[atStart ? 'start' : 'end'] = info;
  };

  // 1) Junction bars on every wire of every ≥3-way junction.
  for (const j of state.junctions) {
    const attached = junctionAdj.get(j.id) || [];
    if (attached.length < 3) continue;
    const stubs = attached.map(w => ({ wire: w, I: kclCurrentThroughWire(j, w, junctionAdj) }));
    // Kirchhoff: total current arriving at the junction = sum of out-flows
    // = (sum of |branch currents|) / 2. Use that as the denominator so
    // smaller branches read as obviously not-full.
    const total = stubs.reduce((s, x) => s + Math.abs(x.I), 0) / 2;
    for (const s of stubs) {
      const frac = total > EPS ? Math.min(1, Math.abs(s.I) / total) : 0;
      const atStart = s.wire.a.junctionId === j.id;
      claim(s.wire.id, atStart, { I: s.I, frac });
    }
  }

  // 2) One bar per eligible component, on the right-side terminal's wire
  //    if available, falling back to the other terminal.
  for (const c of state.components) {
    if (!COMP_BAR_TYPES.has(c.type)) continue;
    const simEl = state.sim.elementByCompId.get(c.id);
    if (!simEl || Math.abs(simEl.current) < 1e-5) continue;
    // Sort terminals by x descending so the rightmost is tried first.
    const terms = [...COMP[c.type].terms].sort((a, b) => b.x - a.x);
    for (const t of terms) {
      const wire = compTermWire.get(c.id + '.' + t.n);
      if (!wire) continue;
      const existing = bars.get(wire.id);
      if (existing && (existing.start || existing.end)) continue; // claimed by junction
      const atStart = (wire.a.compId === c.id && wire.a.term === t.n);
      claim(wire.id, atStart, { I: simEl.current, frac: 1 });
      break;
    }
  }

  return bars;
}

function renderWireBars(bars) {
  // Flatten the per-wire start/end map into a keyed list and reconcile it
  // against the existing bar groups. Unchanged bars skip DOM work; geometry
  // / label changes mutate attributes in place on the existing nodes.
  const items = [];
  for (const w of state.wires) {
    const entry = bars.get(w.id);
    if (!entry) continue;
    const pts = resolveWirePath(w);
    if (!pts || pts.length < 2) continue;
    if (entry.start) {
      const geom = computeBarGeom(pts, true, entry.start);
      if (geom) items.push({ key: w.id + ':start', geom, info: entry.start });
    }
    if (entry.end) {
      const geom = computeBarGeom(pts, false, entry.end);
      if (geom) items.push({ key: w.id + ':end', geom, info: entry.end });
    }
  }
  reconcile(
    wireBarsG,
    items,
    item => item.key,
    item => buildWireBar(item),
    (node, item) => updateWireBar(node, item),
  );
}

function computeBarGeom(pts, atStart, info) {
  const a = atStart ? pts[0] : pts[pts.length - 1];
  const b = atStart ? pts[1] : pts[pts.length - 2];
  const dx = b.x - a.x, dy = b.y - a.y;
  const segLen = Math.hypot(dx, dy);
  if (segLen < TERMINAL_GAP + BAR_LEN + POST_BAR_GAP) return null; // first segment too short — bail
  const ux = dx / segLen, uy = dy / segLen;

  const bx0 = a.x + ux * TERMINAL_GAP;
  const by0 = a.y + uy * TERMINAL_GAP;

  const horiz = Math.abs(ux) > Math.abs(uy);
  let rectX, rectY, rectW, rectH;
  if (horiz) {
    rectX = ux > 0 ? bx0 : bx0 - BAR_LEN;
    rectY = by0 - BAR_T / 2;
    rectW = BAR_LEN;
    rectH = BAR_T;
  } else {
    rectX = bx0 - BAR_T / 2;
    rectY = uy > 0 ? by0 : by0 - BAR_LEN;
    rectW = BAR_T;
    rectH = BAR_LEN;
  }

  const frac = Math.min(1, Math.max(0, info.frac));
  const fillLen = BAR_LEN * frac;
  let fx = rectX, fy = rectY, fw = rectW, fh = rectH;
  if (horiz) {
    fw = fillLen;
    if (ux < 0) fx = rectX + (BAR_LEN - fillLen);
  } else {
    fh = fillLen;
    if (uy < 0) fy = rectY + (BAR_LEN - fillLen);
  }

  const cx = rectX + rectW / 2;
  const cy = rectY + rectH / 2;
  const label = `${Math.abs(info.I).toFixed(2)}A`;
  const labelX = horiz ? cx : rectX + rectW + 6;
  const labelY = horiz ? rectY + rectH + 12 : cy + 4;
  const labelAnchor = horiz ? 'middle' : 'start';

  return { rectX, rectY, rectW, rectH, fx, fy, fw, fh, label, labelX, labelY, labelAnchor };
}

function buildWireBar(item) {
  const { geom } = item;
  const g = svgEl('g', { class: 'ibar' });
  g.appendChild(svgEl('rect', {
    class: 'ibar-bg', 'data-role': 'bg',
    x: geom.rectX, y: geom.rectY, width: geom.rectW, height: geom.rectH, rx: 3,
  }));
  g.appendChild(svgEl('rect', {
    class: 'ibar-fg', 'data-role': 'fg',
    x: geom.fx, y: geom.fy, width: geom.fw, height: geom.fh, rx: 3,
  }));
  g.appendChild(svgEl('text', {
    'data-role': 'label',
    x: geom.labelX, y: geom.labelY,
    'text-anchor': geom.labelAnchor,
    style: `font-size: ${BAR_LABEL_WORLD_PX}px`,
    class: 'bar-label i',
  }, geom.label));
  return g;
}

function updateWireBar(node, item) {
  const { geom } = item;
  const bg = node.querySelector(':scope > rect[data-role="bg"]');
  const fg = node.querySelector(':scope > rect[data-role="fg"]');
  const tx = node.querySelector(':scope > text[data-role="label"]');
  if (!bg || !fg || !tx) return buildWireBar(item); // unexpected shape — rebuild
  setIfChanged(bg, 'x', geom.rectX);
  setIfChanged(bg, 'y', geom.rectY);
  setIfChanged(bg, 'width', geom.rectW);
  setIfChanged(bg, 'height', geom.rectH);
  setIfChanged(fg, 'x', geom.fx);
  setIfChanged(fg, 'y', geom.fy);
  setIfChanged(fg, 'width', geom.fw);
  setIfChanged(fg, 'height', geom.fh);
  setIfChanged(tx, 'x', geom.labelX);
  setIfChanged(tx, 'y', geom.labelY);
  setIfChanged(tx, 'text-anchor', geom.labelAnchor);
  if (tx.textContent !== geom.label) tx.textContent = geom.label;
  return node;
}

function setIfChanged(node, attr, value) {
  const next = String(value);
  if (node.getAttribute(attr) !== next) node.setAttribute(attr, next);
}

// Stable preview-wire node. While `pendingWire` is null the path is detached
// (kept as a reference so subsequent renders can re-attach without rebuilding);
// while pending it sits in `previewG` and only the `d` attribute changes.
function reconcilePreview() {
  const pending = state.pendingWire;
  if (!pending) {
    if (editor.previewEl && editor.previewEl.parentNode === previewG) {
      previewG.removeChild(editor.previewEl);
    }
    editor.previewEl = null;
    return;
  }
  const p1 = endpointPos(pending.from);
  if (!p1) {
    if (editor.previewEl && editor.previewEl.parentNode === previewG) {
      previewG.removeChild(editor.previewEl);
    }
    editor.previewEl = null;
    return;
  }
  const p2 = { x: pending.mouseX, y: pending.mouseY };
  const d = previewPath(p1, p2);
  if (!editor.previewEl) {
    editor.previewEl = svgEl('path', {
      class: 'wire preview', d,
      'pointer-events': 'none',
    });
  } else {
    setIfChanged(editor.previewEl, 'd', d);
  }
  if (editor.previewEl.parentNode !== previewG) previewG.appendChild(editor.previewEl);
}

// Tutor-driven visual overlays. Instructions are stored in state.visuals so
// they survive subsequent re-renders (hover, selection, sim ticks), and are
// auto-cleared after a short window so the canvas stays calm.
const VISUAL_TTL_MS = 6000;
const ALLOWED_ACTIONS = new Set([
  'highlight', 'dim', 'glow', 'pulse',
  'mark_error', 'mark_success',
]);
let visualsCleanupTimer = null;

function scheduleVisualsCleanup() {
  if (visualsCleanupTimer) clearTimeout(visualsCleanupTimer);
  let next = Infinity;
  const now = Date.now();
  for (const id in state.visuals) {
    const v = state.visuals[id];
    if (v.expiresAt < next) next = v.expiresAt;
  }
  if (next === Infinity) return;
  visualsCleanupTimer = setTimeout(() => {
    visualsCleanupTimer = null;
    const t = Date.now();
    let changed = false;
    for (const id in state.visuals) {
      if (state.visuals[id].expiresAt <= t) { delete state.visuals[id]; changed = true; }
    }
    if (changed) render();
    if (Object.keys(state.visuals).length > 0) scheduleVisualsCleanup();
  }, Math.max(50, next - now));
}

// Hover and selection toggles: mutate classes on existing nodes instead of
// rebuilding the entire SVG. Falls back to a no-op when the target node has
// not been rendered yet (the next render() will pick the state up via
// editor.hoveredWireId / state.selection).

export function setHoveredWire(id) {
  if (editor.hoveredWireId === id) return;
  const prev = editor.hoveredWireId;
  editor.hoveredWireId = id;
  if (prev) clearWireHoverDots(prev);
  if (id) drawWireHoverDots(id);
}

function clearWireHoverDots(wireId) {
  if (!wiresG) return;
  const g = wiresG.querySelector(`g.wire-group[data-wid="${wireId}"]`);
  if (!g) return;
  g.querySelectorAll('.wire-corner, .wire-corner-hit').forEach(n => n.remove());
}

function drawWireHoverDots(wireId) {
  if (!wiresG) return;
  const g = wiresG.querySelector(`g.wire-group[data-wid="${wireId}"]`);
  if (!g) return;
  const wire = state.wires.find(w => w.id === wireId);
  if (!wire) return;
  const pts = resolveWirePath(wire);
  if (!pts || pts.length < 3) return;
  appendHoverDots(g, wire, pts);
}

// ---------------------------------------------------------------------------
// Drag fast-path. Used by the editor's pointermove handler while a component
// is being dragged. Bypasses render() entirely:
//   * Pre-collect routing obstacles ONCE per drag (other components don't
//     move while one is being dragged), and the wire segments to avoid
//     (every committed wire except the ones attached to the dragged comp).
//   * On each move, mutate transform on the dragged comp's <g>, recompute
//     and write cx/cy on its terminals, and rewrite path `d` on each
//     attached wire — without writing w.path so a single drop still
//     triggers a proper post-drag reroute via rerouteWiresFor.
// ---------------------------------------------------------------------------

export function beginDragFrame(compId) {
  const attached = state.wires.filter(w =>
    w.a.compId === compId || w.b.compId === compId);
  const obstacles = collectComponentBoxes([compId]);
  const wireSegs = collectWireSegments(attached.map(w => w.id));
  return { compId, attached, obstacles, wireSegs };
}

export function applyDragFrame(ctx) {
  if (!ctx || !layersInited) return;
  const c = state.components.find(x => x.id === ctx.compId);
  if (!c) return;

  const compNode = compsG.querySelector(`g.comp[data-cid="${c.id}"]`);
  if (compNode) compNode.setAttribute('transform', `translate(${c.x}, ${c.y}) scale(${COMP_SCALE})`);

  for (const t of COMP[c.type].terms) {
    const p = termPos(c, t.n);
    const sel = `[data-comp="${c.id}"][data-tname="${t.n}"]`;
    termsG.querySelectorAll(sel).forEach(node => {
      node.setAttribute('cx', p.x);
      node.setAttribute('cy', p.y);
    });
  }

  for (const w of ctx.attached) {
    const drawPts = dragRoute(w, ctx);
    if (!drawPts || drawPts.length < 2) continue;
    const d = toSvgPath(drawPts);
    const wireG = wiresG.querySelector(`g.wire-group[data-wid="${w.id}"]`);
    if (!wireG) continue;
    const base = wireG.querySelector(':scope > path[data-role="base"]');
    const flow = wireG.querySelector(':scope > path[data-role="flow"]');
    const hit  = wireG.querySelector(':scope > path[data-role="hit"]');
    if (base) base.setAttribute('d', d);
    if (flow) flow.setAttribute('d', d);
    if (hit)  hit.setAttribute('d', d);
  }
}

function dragRoute(w, ctx) {
  const next = routePath(w.a, w.b, {
    excludeComps: [w.a.compId, w.b.compId].filter(Boolean),
    excludeWires: ctx.attached.map(x => x.id),
    obstacles: ctx.obstacles,
    wireSegs: ctx.wireSegs,
    previousPath: w.path,
  });
  if (next && next.length >= 2) return next;
  // Last-ditch L-shape so the wire stays glued to its endpoints even if
  // the router fails (e.g. no clearance found).
  const p0 = endpointPos(w.a);
  const pn = endpointPos(w.b);
  if (!p0 || !pn) return null;
  const dx = pn.x - p0.x, dy = pn.y - p0.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return [p0, { x: p0.x + dx / 2, y: p0.y }, { x: p0.x + dx / 2, y: pn.y }, pn];
  }
  return [p0, { x: p0.x, y: p0.y + dy / 2 }, { x: pn.x, y: p0.y + dy / 2 }, pn];
}

export function setSelection(sel) {
  const prev = state.selection;
  if (prev === sel || (prev && sel && prev.kind === sel.kind && prev.id === sel.id)) return;
  state.selection = sel;
  applySelectionClasses();
}

function applySelectionClasses() {
  const sel = state.selection;
  if (wiresG) {
    wiresG.querySelectorAll('path.wire-base.selected').forEach(n => n.classList.remove('selected'));
    if (Sel.isWire(sel)) {
      const base = wiresG.querySelector(`g.wire-group[data-wid="${sel.id}"] path.wire-base`);
      if (base) base.classList.add('selected');
    }
  }
  if (compsG) {
    compsG.querySelectorAll('g.comp.selected').forEach(n => n.classList.remove('selected'));
    if (Sel.isComponent(sel)) {
      const g = compsG.querySelector(`g.comp[data-cid="${sel.id}"]`);
      if (g) g.classList.add('selected');
    }
  }
}

export function applyVisualInstructions(instrs) {
  state.visuals = {};
  const expiresAt = Date.now() + VISUAL_TTL_MS;
  const validIds = new Set(state.components.map(c => c.id));
  for (const ins of instrs) {
    if (!ins || !ins.target) continue;
    const action = ALLOWED_ACTIONS.has(ins.action) ? ins.action : 'highlight';
    if (ins.target === 'whole_circuit') {
      for (const c of state.components) {
        state.visuals[c.id] = { action, expiresAt };
      }
      continue;
    }
    if (!validIds.has(ins.target)) continue;
    state.visuals[ins.target] = { action, expiresAt };
  }
  render();
  scheduleVisualsCleanup();
}
