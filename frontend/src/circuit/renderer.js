// SVG rendering: canvas, grid, wires, components, terminals, preview.
// Also owns the small DOM helpers and applyVisualInstructions (tutor
// callbacks highlight/dim .comp groups by id).

import { state, SVG_W, SVG_H, EPS } from '../state/store.js';
import { COMP } from './schema.js';
import { editor, onCompMouseDown, onTerminalPointerDown } from './editor.js';
import { deleteWire, deleteComponent } from '../state/actions.js';
import { updateHUD, updateReadout } from '../ui/canvas.js';
import { termPos } from './geometry.js';
import { route as routePath } from './wiring/router.js';
import { toSvgPath, previewPath } from './wiring/path.js';

export { termPos };

export const svg = document.getElementById('canvas');
const SVGNS = 'http://www.w3.org/2000/svg';

export function svgPointFromEvent(ev) {
  if (!svg.createSVGPoint) return null;
  const pt = svg.createSVGPoint();
  pt.x = ev.clientX; pt.y = ev.clientY;
  const ctm = svg.getScreenCTM();
  if (!ctm) return null;
  const p = pt.matrixTransform(ctm.inverse());
  return { x: p.x, y: p.y };
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

// Routing is delegated to RouterService; rendering is delegated to
// wiring/path. These helpers just expose the shape legacy callers expect.

// Backwards-compat: build an SVG `d` for a pending-wire preview.
export function manhattanPath(a, b) { return previewPath(a, b); }

// Thin shim used by editor.js when a wire is committed. Returns the full
// routed path (including endpoints) so the wire can cache it on the model.
export function routeWire(source, target, opts = {}) {
  return routePath(source, target, opts);
}

// Pull the committed path for a wire, routing and caching on demand.
export function resolveWirePath(w) {
  const ca = state.components.find(c => c.id === w.a.compId);
  const cb = state.components.find(c => c.id === w.b.compId);
  if (!ca || !cb) return null;
  const p0 = termPos(ca, w.a.term);
  const pn = termPos(cb, w.b.term);
  const cached = w.path;
  const endpointsMoved = !cached || cached.length < 2 ||
    !near(cached[0], p0) || !near(cached[cached.length - 1], pn);
  if (endpointsMoved) {
    const next = routePath(w.a, w.b, {
      excludeComps: [w.a.compId, w.b.compId],
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

// While a component is being dragged, draw a cheap two-segment Manhattan
// path for wires attached to it instead of calling the full router on every
// pointermove.
function dragPreviewPts(w, draggingCompId) {
  const ca = state.components.find(c => c.id === w.a.compId);
  const cb = state.components.find(c => c.id === w.b.compId);
  if (!ca || !cb) return null;
  const p0 = termPos(ca, w.a.term);
  const pn = termPos(cb, w.b.term);
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
    if (!touched.has(w.a.compId) && !touched.has(w.b.compId)) continue;
    const next = routePath(w.a, w.b, {
      excludeComps: [w.a.compId, w.b.compId],
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

  // Render wires (before components so they are below)
  const wiresG = svgEl('g', { class: 'wires' });
  const draggingComp = editor.dragging ? editor.dragging.compId : null;
  for (const w of state.wires) {
    const pts = resolveWirePath(w);
    if (!pts) continue;
    // During a drag, show a transient preview from the current endpoints so
    // the wire tracks the component in real time without a full reroute.
    const isLive = draggingComp && (w.a.compId === draggingComp || w.b.compId === draggingComp);
    const drawPts = isLive ? dragPreviewPts(w, draggingComp) : pts;
    let cls = 'wire';
    if (state.selectedId === 'wire:' + w.id) cls += ' selected';
    if (state.sim && state.sim.ok && !state.sim.empty && !state.sim.isOpen && state.toggles.current) {
      const nodeA = state.sim.getNode(w.a.compId, w.a.term);
      const anyCurrent = state.sim.elements.some(e => (e.na===nodeA||e.nb===nodeA) && Math.abs(e.current) > 1e-4);
      if (anyCurrent) cls += ' active';
    }
    const path = svgEl('path', {
      class: cls, d: toSvgPath(drawPts),
      'data-wid': w.id,
      onclick: (ev) => {
        ev.stopPropagation();
        if (state.tool === 'delete') { deleteWire(w.id); return; }
        state.selectedId = 'wire:' + w.id;
        render();
        updateReadout();
      },
    });
    wiresG.appendChild(path);
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
  svg.appendChild(termG);

  // Preview wire
  editor.previewEl = null;
  if (state.pendingWire) {
    const ca = state.components.find(c=>c.id===state.pendingWire.from.compId);
    if (ca) {
      const p1 = termPos(ca, state.pendingWire.from.term);
      const p2 = { x: state.pendingWire.mouseX, y: state.pendingWire.mouseY };
      editor.previewEl = svgEl('path', { class:'wire preview', d: manhattanPath(p1,p2) });
      svg.appendChild(editor.previewEl);
    }
  }

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
    onclick: (ev) => { ev.stopPropagation(); if (state.tool === 'delete') deleteComponent(c.id); else { state.selectedId = c.id; render(); updateReadout(); } },
  });

  // selection frame
  const box = COMP[c.type];
  g.appendChild(svgEl('rect', {
    class:'frame', x: -box.w/2-14, y: -box.h/2-32, width: box.w+28, height: box.h+64,
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
      g.appendChild(svgEl('text', { x:w/2-10, y:-16, class:'label' }, '−'));
      g.appendChild(svgEl('text', { x:0, y:28, 'text-anchor':'middle', class:'val v' }, `${c.props.voltage} V`));
      g.appendChild(svgEl('text', { x:0, y:-24, 'text-anchor':'middle', class:'label' }, c.id));
    }
  } else if (c.type === 'switch') {
    g.appendChild(svgEl('line', { class:'body', x1:-30, y1:0, x2:-12, y2:0 }));
    g.appendChild(svgEl('line', { class:'body', x1:12, y1:0, x2:30, y2:0 }));
    g.appendChild(svgEl('circle', { class:'fill', cx:-12, cy:0, r:3 }));
    g.appendChild(svgEl('circle', { class:'fill', cx:12, cy:0, r:3 }));
    if (c.props.closed) g.appendChild(svgEl('line', { class:'body', x1:-12, y1:0, x2:12, y2:0 }));
    else g.appendChild(svgEl('line', { class:'body', x1:-12, y1:0, x2:10, y2:-14 }));
    if (state.toggles.labels) {
      g.appendChild(svgEl('text', { x:0, y:28, 'text-anchor':'middle', class:'val' }, c.props.closed ? 'closed' : 'open'));
      g.appendChild(svgEl('text', { x:0, y:-14, 'text-anchor':'middle', class:'label' }, c.id));
    }
  } else if (c.type === 'resistor') {
    g.appendChild(svgEl('line', { class:'body', x1:-40, y1:0, x2:-20, y2:0 }));
    g.appendChild(svgEl('rect', { class:'fill', x:-20, y:-10, width:40, height:20, rx:2 }));
    g.appendChild(svgEl('line', { class:'body', x1:20, y1:0, x2:40, y2:0 }));
    if (state.toggles.labels) {
      g.appendChild(svgEl('text', { x:0, y:26, 'text-anchor':'middle', class:'val r' }, `${c.props.resistance} Ω`));
      g.appendChild(svgEl('text', { x:0, y:-14, 'text-anchor':'middle', class:'label' }, c.id));
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
      g.appendChild(svgEl('text', { x:0, y:30, 'text-anchor':'middle', class:'val r' }, `${c.props.resistance} Ω`));
      g.appendChild(svgEl('text', { x:0, y:-22, 'text-anchor':'middle', class:'label' }, c.id));
    }
  } else if (c.type === 'ammeter' || c.type === 'voltmeter') {
    const isA = c.type === 'ammeter';
    g.appendChild(svgEl('line', { class:'body', x1:-30, y1:0, x2:-14, y2:0 }));
    g.appendChild(svgEl('line', { class:'body', x1:14, y1:0, x2:30, y2:0 }));
    g.appendChild(svgEl('circle', { class:'fill', cx:0, cy:0, r:14 }));
    g.appendChild(svgEl('text', { x:0, y:4, 'text-anchor':'middle', class:'label', 'font-size': 13 }, isA ? 'A' : 'V'));

    // Digital LCD-style readout sitting just above the meter
    let digits = '- - . - -';
    let unit = isA ? 'A' : 'V';
    if (simEl && state.sim && state.sim.ok && !state.sim.empty && !state.sim.isShort) {
      const raw = isA ? Math.abs(simEl.current) : Math.abs(simEl.drop);
      digits = raw < 10 ? raw.toFixed(2) : raw.toFixed(1);
    }
    const lcdW = 54, lcdH = 18, lcdY = -38;
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
      // Id label sits below the circle; the digital reading owns the space above.
      g.appendChild(svgEl('text', { x:0, y:30, 'text-anchor':'middle', class:'label' }, c.id));
    }
    if (checkMeterPlacement(c) === 'warn') {
      g.classList.add('error');
    }
  }

  // Voltage drop + current bars for resistors/bulbs — now larger with numeric
  // labels so students can read them without hovering.
  const showBars = simEl && (c.type === 'bulb' || c.type === 'resistor')
    && state.sim && state.sim.ok && !state.sim.isShort;
  if (showBars) {
    const bw = 60, bh = 7;
    const yBase = COMP[c.type].h / 2 + 16;
    if (state.toggles.voltage && state.sim.supplyV > 0) {
      const vfrac = Math.min(1, Math.abs(simEl.drop) / state.sim.supplyV);
      g.appendChild(svgEl('rect', { class:'vbar-bg', x:-bw/2, y: yBase, width: bw, height: bh, rx:2 }));
      g.appendChild(svgEl('rect', { class:'vbar-fg', x:-bw/2, y: yBase, width: bw*vfrac, height: bh, rx:2 }));
      g.appendChild(svgEl('text', {
        x: -bw/2 - 4, y: yBase + bh - 1, 'text-anchor':'end', class:'bar-label v',
      }, 'V'));
      g.appendChild(svgEl('text', {
        x: bw/2 + 4, y: yBase + bh - 1, class:'bar-label v',
      }, `${Math.abs(simEl.drop).toFixed(2)}V`));
    }
    if (state.toggles.current && state.sim.totalI > 0) {
      const ifrac = Math.min(1, Math.abs(simEl.current) / Math.max(state.sim.totalI, EPS));
      const y2 = yBase + bh + 4;
      g.appendChild(svgEl('rect', { class:'vbar-bg', x:-bw/2, y: y2, width: bw, height: bh, rx:2 }));
      g.appendChild(svgEl('rect', { class:'ibar-fg', x:-bw/2, y: y2, width: bw*ifrac, height: bh, rx:2 }));
      g.appendChild(svgEl('text', {
        x: -bw/2 - 4, y: y2 + bh - 1, 'text-anchor':'end', class:'bar-label i',
      }, 'I'));
      g.appendChild(svgEl('text', {
        x: bw/2 + 4, y: y2 + bh - 1, class:'bar-label i',
      }, `${Math.abs(simEl.current).toFixed(2)}A`));
    }
  }

  return g;
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
