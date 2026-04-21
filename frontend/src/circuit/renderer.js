// SVG rendering: canvas, grid, wires, components, terminals, preview.
// Also owns the small DOM helpers and applyVisualInstructions (tutor
// callbacks highlight/dim .comp groups by id).

import { state, SVG_W, SVG_H, EPS } from '../state/store.js';
import { COMP } from './schema.js';
import { editor, onCompMouseDown, onTerminalPointerDown } from './editor.js';
import { deleteWire, deleteComponent, splitWireAtCorner } from '../state/actions.js';
import { updateHUD, updateReadout } from '../ui/canvas.js';
import { termPos, endpointPos } from './geometry.js';
import { route as routePath } from './wiring/router.js';
import { toSvgPath, previewPath } from './wiring/path.js';

export const svg = document.getElementById('canvas');
const SVGNS = 'http://www.w3.org/2000/svg';

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
  const el = state.sim.elements.find(e => e.comp && e.comp.id === meter.id);
  if (!el) return null;
  if (meter.type === 'ammeter' && Math.abs(el.current) < 1e-5) return 'warn';
  if (meter.type === 'voltmeter' && Math.abs(el.current) > 1e-3) return 'warn';
  return null;
}

export function render() {
  // Set viewbox
  svg.setAttribute('viewBox', `0 0 ${SVG_W} ${SVG_H}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  while (svg.firstChild) svg.removeChild(svg.firstChild);

  // Grid
  const grid = svgEl('g', { class: 'grid' });
  const GRID_PX = 20;
  for (let x = 0; x <= SVG_W; x += GRID_PX) grid.appendChild(svgEl('line', { class:'grid-line', x1:x, y1:0, x2:x, y2:SVG_H }));
  for (let y = 0; y <= SVG_H; y += GRID_PX) grid.appendChild(svgEl('line', { class:'grid-line', x1:0, y1:y, x2:SVG_W, y2:y }));
  svg.appendChild(grid);

  // Plan all current bars before drawing wires. The wires render at full
  // length; each bar's opaque background covers the wire underneath so the
  // bar appears to sit on top of a continuous wire (visible on both sides).
  const wireBars = planWireBars();

  // Render wires (before components so they are below)
  const wiresG = svgEl('g', { class: 'wires' });
  const draggingComp = editor.dragging ? editor.dragging.compId : null;
  const pendingNow = state.pendingWire;
  for (const w of state.wires) {
    // During a drag, route the live wires without writing to w.path so a
    // single drop still gets a proper post-drag reroute.
    const isLive = draggingComp && (w.a.compId === draggingComp || w.b.compId === draggingComp);
    const pts = isLive ? null : resolveWirePath(w);
    const fullPts = isLive ? dragPreviewPts(w) : pts;
    if (!fullPts) continue;
    const drawPts = fullPts;
    if (!drawPts || drawPts.length < 2) continue;
    let cls = 'wire';
    if (state.selectedId === 'wire:' + w.id) cls += ' selected';
    if (state.sim && state.sim.ok && !state.sim.empty && !state.sim.isOpen && state.toggles.current) {
      const nodeA = state.sim.getNodeByEp ? state.sim.getNodeByEp(w.a) : state.sim.getNode(w.a.compId, w.a.term);
      const anyCurrent = state.sim.elements.some(e => (e.na===nodeA||e.nb===nodeA) && Math.abs(e.current) > 1e-4);
      if (anyCurrent) cls += ' active';
    }
    const wireGroup = svgEl('g', {
      class: 'wire-group',
      'data-wid': w.id,
      onpointerenter: () => {
        if (editor.hoveredWireId !== w.id) { editor.hoveredWireId = w.id; render(); }
      },
      onpointerleave: () => {
        if (editor.hoveredWireId === w.id) { editor.hoveredWireId = null; render(); }
      },
    });
    wireGroup.appendChild(svgEl('path', {
      class: cls, d: toSvgPath(drawPts),
      'data-wid': w.id,
      onclick: (ev) => {
        ev.stopPropagation();
        if (state.tool === 'delete') { deleteWire(w.id); return; }
        state.selectedId = 'wire:' + w.id;
        render();
        updateReadout();
      },
    }));
    wireGroup.appendChild(svgEl('path', {
      class: 'wire-hover-hit',
      d: toSvgPath(drawPts),
      fill: 'none',
      stroke: 'transparent',
      'stroke-width': 16,
      'data-wid': w.id,
    }));
    // Corner-connector dots appear while this wire is the hover target and
    // nothing else is pending. They live inside the wire's own group so the
    // hover state doesn't flicker as the cursor travels between wire and dot.
    if (editor.hoveredWireId === w.id && !pendingNow && drawPts.length >= 3) {
      for (let i = 1; i < drawPts.length - 1; i++) {
        const cp = drawPts[i];
        wireGroup.appendChild(svgEl('circle', { class: 'wire-corner', cx: cp.x, cy: cp.y, r: 5 }));
        wireGroup.appendChild(svgEl('circle', {
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
    wiresG.appendChild(wireGroup);
  }
  svg.appendChild(wiresG);

  // Render components
  const compsG = svgEl('g', { class: 'comps' });
  for (const c of state.components) compsG.appendChild(renderComponent(c));
  svg.appendChild(compsG);

  // Terminal hit areas with explicit connector visual states.
  const termG = svgEl('g', { class: 'terms' });
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
      termG.appendChild(svgEl('circle', { class: cls, cx: p.x, cy: p.y, r: 4 }));
      termG.appendChild(svgEl('circle', {
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
    termG.appendChild(svgEl('circle', { class: cls, cx: j.x, cy: j.y, r: 4.5 }));
    termG.appendChild(svgEl('circle', {
      class: 'terminal hit', cx: j.x, cy: j.y, r: 14,
      'data-term': k,
      'data-junction': j.id,
      onpointerdown: (ev) => { ev.stopPropagation(); onTerminalPointerDown(ev, null, null, j.id); },
    }));
  }

  svg.appendChild(termG);

  // Preview wire
  editor.previewEl = null;
  if (state.pendingWire) {
    const p1 = endpointPos(state.pendingWire.from);
    if (p1) {
      const p2 = { x: state.pendingWire.mouseX, y: state.pendingWire.mouseY };
      editor.previewEl = svgEl('path', {
        class: 'wire preview', d: previewPath(p1, p2),
        'pointer-events': 'none',
      });
      svg.appendChild(editor.previewEl);
    }
  }

  // Current bars overlaid on each wire (component bars + KCL junction bars).
  renderWireBars(svg, wireBars);

  updateHUD();
  updateReadout();
}

export function renderComponent(c) {
  const isLocked = state.lockedIds && state.lockedIds.has(c.id);
  const g = svgEl('g', {
    class: 'comp' + (state.selectedId === c.id ? ' selected' : '') + (isLocked ? ' locked' : ''),
    transform: `translate(${c.x}, ${c.y})`,
    'data-cid': c.id,
    onpointerdown: (ev) => onCompMouseDown(ev, c),
    onclick: (ev) => {
      ev.stopPropagation();
      if (state.tool === 'delete') { deleteComponent(c.id); return; }
      state.selectedId = c.id; render(); updateReadout();
    },
  });

  const boxRaw = COMP[c.type];
  const bw = boxRaw.w;
  const bh = boxRaw.h;
  g.appendChild(svgEl('rect', {
    class:'frame', x: -bw/2-14, y: -bh/2-32, width: bw+28, height: bh+64,
    rx: 10, ry: 10, fill: 'transparent', stroke: 'transparent'
  }));

  const simEl = state.sim && state.sim.ok ? state.sim.elements.find(e => e.comp && e.comp.id === c.id) : null;

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
    if (state.toggles.labels) {
      g.appendChild(svgEl('text', { x:-w/2+4, y:-16, class:'label' }, '+'));
      g.appendChild(svgEl('text', { x: w/2-10, y:-16, class:'label' }, '−'));
      g.appendChild(svgEl('text', { x:0, y: bh/2 + 14, 'text-anchor':'middle', class:'val v' }, `${c.props.voltage} V`));
      g.appendChild(svgEl('text', { x:0, y: -bh/2 - 6, 'text-anchor':'middle', class:'label' }, c.id));
    }
  } else if (c.type === 'switch') {
    g.appendChild(svgEl('line', { class:'body', x1:-30, y1:0, x2:-12, y2:0 }));
    g.appendChild(svgEl('line', { class:'body', x1:12, y1:0, x2:30, y2:0 }));
    g.appendChild(svgEl('circle', { class:'fill', cx:-12, cy:0, r:3 }));
    g.appendChild(svgEl('circle', { class:'fill', cx:12, cy:0, r:3 }));
    if (c.props.closed) g.appendChild(svgEl('line', { class:'body', x1:-12, y1:0, x2:12, y2:0 }));
    else g.appendChild(svgEl('line', { class:'body', x1:-12, y1:0, x2:10, y2:-14 }));
    if (state.toggles.labels) {
      g.appendChild(svgEl('text', { x:0, y: bh/2 + 18, 'text-anchor':'middle', class:'val' }, c.props.closed ? 'closed' : 'open'));
      g.appendChild(svgEl('text', { x:0, y: -bh/2 - 4, 'text-anchor':'middle', class:'label' }, c.id));
    }
  } else if (c.type === 'resistor') {
    g.appendChild(svgEl('line', { class:'body', x1:-40, y1:0, x2:-20, y2:0 }));
    g.appendChild(svgEl('rect', { class:'fill', x:-20, y:-10, width:40, height:20, rx:2 }));
    g.appendChild(svgEl('line', { class:'body', x1:20, y1:0, x2:40, y2:0 }));
    if (state.toggles.labels) {
      g.appendChild(svgEl('text', { x:0, y: bh/2 + 13, 'text-anchor':'middle', class:'val r' }, `${Number(c.props.resistance).toFixed(2)} Ω`));
      g.appendChild(svgEl('text', { x:0, y: -bh/2 - 4, 'text-anchor':'middle', class:'label' }, c.id));
    }
  } else if (c.type === 'bulb') {
    const brightness = simEl && state.sim && state.sim.ok ? Math.min(1, Math.abs(simEl.current) * Math.abs(simEl.current) * simEl.value / 10) : 0;
    g.appendChild(svgEl('line', { class:'body', x1:-30, y1:0, x2:-14, y2:0 }));
    g.appendChild(svgEl('line', { class:'body', x1:14, y1:0, x2:30, y2:0 }));
    g.appendChild(svgEl('circle', { class:'fill', cx:0, cy:0, r:14 }));
    if (brightness > 0.02) {
      g.appendChild(svgEl('circle', { cx:0, cy:0, r: 14 + brightness*8, fill:`rgba(255,207,92,${0.3 + 0.5*brightness})`, 'stroke':'none' }));
      g.appendChild(svgEl('circle', { cx:0, cy:0, r: 10, fill:`rgba(255,235,150,${brightness})`, 'stroke':'none' }));
    }
    g.appendChild(svgEl('line', { class:'body', x1:-9, y1:-9, x2:9, y2:9 }));
    g.appendChild(svgEl('line', { class:'body', x1:-9, y1:9, x2:9, y2:-9 }));
    if (state.toggles.labels) {
      g.appendChild(svgEl('text', { x:0, y: bh/2 + 16, 'text-anchor':'middle', class:'val r' }, `${Number(c.props.resistance).toFixed(2)} Ω`));
      g.appendChild(svgEl('text', { x:0, y: -bh/2 - 8, 'text-anchor':'middle', class:'label' }, c.id));
    }
  } else if (c.type === 'ammeter' || c.type === 'voltmeter') {
    const isA = c.type === 'ammeter';
    g.appendChild(svgEl('line', { class:'body', x1:-30, y1:0, x2:-14, y2:0 }));
    g.appendChild(svgEl('line', { class:'body', x1:14, y1:0, x2:30, y2:0 }));
    g.appendChild(svgEl('circle', { class:'fill', cx:0, cy:0, r:14 }));
    g.appendChild(svgEl('text', { x:0, y:4, 'text-anchor':'middle', class:'label', 'font-size': 13 }, isA ? 'A' : 'V'));

    // Digital LCD-style readout sitting just above the meter (upright).
    let digits = '- - . - -';
    const unit = isA ? 'A' : 'V';
    if (simEl && state.sim && state.sim.ok && !state.sim.empty && !state.sim.isShort) {
      const raw = isA ? Math.abs(simEl.current) : Math.abs(simEl.drop);
      digits = raw < 10 ? raw.toFixed(2) : raw.toFixed(1);
    }
    const lcdW = 54, lcdH = 18, lcdY = -(bh/2 + lcdH + 4);
    g.appendChild(svgEl('rect', {
      class: 'meter-lcd-bg' + (isA ? '' : ' v'),
      x: -lcdW/2, y: lcdY, width: lcdW, height: lcdH, rx: 3,
    }));
    g.appendChild(svgEl('text', {
      x: lcdW/2 - 4, y: lcdY + lcdH - 5,
      'text-anchor': 'end',
      class: 'meter-lcd-text' + (isA ? '' : ' v'),
    }, digits));
    g.appendChild(svgEl('text', {
      x: -lcdW/2 + 4, y: lcdY + lcdH - 5,
      class: 'meter-lcd-text' + (isA ? '' : ' v'),
      'font-size': 10,
    }, unit));

    if (state.toggles.labels) {
      g.appendChild(svgEl('text', { x:0, y: bh/2 + 18, 'text-anchor':'middle', class:'label' }, c.id));
    }
    if (checkMeterPlacement(c) === 'warn') {
      g.classList.add('error');
    }
  }

  // Voltage drop bar for resistors/bulbs, placed below the body. The current
  // bar that used to live here was promoted to a wire overlay (see
  // planWireBars / drawWireBar below) so it can also visualise KCL splits at
  // junctions.
  const showVBar = simEl && (c.type === 'bulb' || c.type === 'resistor')
    && state.sim && state.sim.ok && !state.sim.isShort
    && state.toggles.voltage && state.sim.supplyV > 0;
  if (showVBar) {
    const barLen = 64, barT = 7;
    const yBase = bh / 2 + 14;
    const vfrac = Math.min(1, Math.abs(simEl.drop) / state.sim.supplyV);
    g.appendChild(svgEl('rect', { class:'vbar-bg', x:-barLen/2, y: yBase, width: barLen, height: barT, rx:2 }));
    g.appendChild(svgEl('rect', { class:'vbar-fg', x:-barLen/2, y: yBase, width: barLen*vfrac, height: barT, rx:2 }));
    g.appendChild(svgEl('text', { x: -barLen/2 - 4, y: yBase + barT - 1, 'text-anchor':'end', class:'bar-label v' }, 'V'));
    g.appendChild(svgEl('text', { x: barLen/2 + 4, y: yBase + barT - 1, class:'bar-label v' }, `${Math.abs(simEl.drop).toFixed(2)}V`));
  }

  return g;
}

// Sum the current flowing from junction J out into `wire` (toward its far
// end). Implemented by DFS through wires and junctions from the far end of
// `wire`, collecting component terminals reached (without crossing J), then
// summing the signed current each of them draws out of the MNA node.
function kclCurrentThroughWire(j, wire) {
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
      for (const w of state.wires) {
        if (visitedWires.has(w.id)) continue;
        if (w.a.junctionId === ep.junctionId) { visitedWires.add(w.id); stack.push(w.b); }
        else if (w.b.junctionId === ep.junctionId) { visitedWires.add(w.id); stack.push(w.a); }
      }
    } else {
      terminals.push(ep);
    }
  }
  let sum = 0;
  for (const t of terminals) {
    const el = state.sim.elements.find(e => e.comp && e.comp.id === t.compId);
    if (!el) continue;
    const isPositiveTerm = (t.term === 'a' || t.term === '+');
    sum += (isPositiveTerm ? 1 : -1) * (el.current || 0);
  }
  return sum;
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
const BAR_LEN = 64;          // length along the wire (matches voltage bar)
const BAR_T = 7;             // thickness perpendicular to the wire (matches voltage bar)
const TERMINAL_GAP = 24;     // breathing space between terminal and bar
const POST_BAR_GAP = 24;     // space between bar end and next 90° turn

function planWireBars() {
  // Returns Map<wireId, { start?: barInfo, end?: barInfo }>
  // where 'start' means the wire's `a` endpoint and 'end' means `b`.
  const bars = new Map();
  if (!state.sim || !state.sim.ok || state.sim.empty || state.sim.isOpen || state.sim.isShort) return bars;
  if (!state.toggles.current) return bars;

  const claim = (wid, atStart, info) => {
    let entry = bars.get(wid);
    if (!entry) { entry = {}; bars.set(wid, entry); }
    entry[atStart ? 'start' : 'end'] = info;
  };

  // 1) Junction bars on every wire of every ≥3-way junction.
  for (const j of state.junctions) {
    const attached = state.wires.filter(w =>
      w.a.junctionId === j.id || w.b.junctionId === j.id);
    if (attached.length < 3) continue;
    const stubs = attached.map(w => ({ wire: w, I: kclCurrentThroughWire(j, w) }));
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
    const simEl = state.sim.elements.find(e => e.comp && e.comp.id === c.id);
    if (!simEl || Math.abs(simEl.current) < 1e-5) continue;
    // Sort terminals by x descending so the rightmost is tried first.
    const terms = [...COMP[c.type].terms].sort((a, b) => b.x - a.x);
    for (const t of terms) {
      const wire = state.wires.find(w =>
        (w.a.compId === c.id && w.a.term === t.n) ||
        (w.b.compId === c.id && w.b.term === t.n));
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

function renderWireBars(root, bars) {
  const g = svgEl('g', { class: 'wire-bars', 'pointer-events': 'none' });
  for (const w of state.wires) {
    const entry = bars.get(w.id);
    if (!entry) continue;
    const pts = resolveWirePath(w);
    if (!pts || pts.length < 2) continue;
    if (entry.start) drawWireBar(g, pts, true, entry.start);
    if (entry.end) drawWireBar(g, pts, false, entry.end);
  }
  root.appendChild(g);
}

function drawWireBar(g, pts, atStart, info) {
  const a = atStart ? pts[0] : pts[pts.length - 1];
  const b = atStart ? pts[1] : pts[pts.length - 2];
  const dx = b.x - a.x, dy = b.y - a.y;
  const segLen = Math.hypot(dx, dy);
  if (segLen < TERMINAL_GAP + BAR_LEN + POST_BAR_GAP) return; // first segment too short — bail
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
  g.appendChild(svgEl('rect', {
    class: 'ibar-bg', x: rectX, y: rectY, width: rectW, height: rectH, rx: 3,
  }));

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
  g.appendChild(svgEl('rect', {
    class: 'ibar-fg', x: fx, y: fy, width: fw, height: fh, rx: 3,
  }));

  // Reading text just below (or beside, for vertical bars) the bar.
  const cx = rectX + rectW / 2;
  const cy = rectY + rectH / 2;
  const label = `${Math.abs(info.I).toFixed(2)}A`;
  if (horiz) {
    g.appendChild(svgEl('text', {
      x: cx, y: rectY + rectH + 12,
      'text-anchor': 'middle', class: 'bar-label i',
    }, label));
  } else {
    g.appendChild(svgEl('text', {
      x: rectX + rectW + 6, y: cy + 4,
      class: 'bar-label i',
    }, label));
  }
}

export function applyVisualInstructions(instrs) {
  document.querySelectorAll('.comp').forEach(g => g.classList.remove('error','success'));
  for (const ins of instrs) {
    if (!ins || !ins.target) continue;
    if (ins.target === 'whole_circuit') {
      document.querySelectorAll('.comp').forEach(g => g.classList.add('success'));
      setTimeout(() => document.querySelectorAll('.comp').forEach(g => g.classList.remove('success')), 2000);
      continue;
    }
    const g = document.querySelector(`.comp[data-cid="${ins.target}"]`);
    if (!g) continue;
    if (ins.action === 'mark_error') g.classList.add('error');
    else if (ins.action === 'mark_success' || ins.action === 'glow' || ins.action === 'pulse' || ins.action === 'highlight') g.classList.add('success');
  }
}
