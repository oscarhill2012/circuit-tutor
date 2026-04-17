// SVG rendering: canvas, grid, wires, components, terminals, preview.
// Also owns the small DOM helpers and applyVisualInstructions (tutor
// callbacks highlight/dim .comp groups by id).

import { state, SVG_W, SVG_H, EPS } from '../state/store.js';
import { COMP } from './schema.js';
import { editor, onCompMouseDown, onTerminalPointerDown } from './editor.js';
import { deleteWire, deleteComponent } from '../state/actions.js';
import { updateHUD, updateReadout } from '../ui/canvas.js';

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

// terminal world position
export function termPos(comp, termName) {
  const def = COMP[comp.type].terms.find(t => t.n === termName);
  return { x: comp.x + def.x, y: comp.y + def.y };
}

export function keyOfTerm(cid, tn) { return cid + '.' + tn; }

export function manhattanPath(a, b) {
  // Routing: horizontal then vertical (or vice versa) with rounded corner
  const dx = b.x - a.x, dy = b.y - a.y;
  if (Math.abs(dx) < 1 || Math.abs(dy) < 1) return `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
  const mx = a.x + dx;
  return `M ${a.x} ${a.y} L ${mx} ${a.y} L ${mx} ${b.y} L ${b.x} ${b.y}`;
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
  for (const w of state.wires) {
    const ca = state.components.find(c=>c.id===w.a.compId);
    const cb = state.components.find(c=>c.id===w.b.compId);
    if (!ca || !cb) continue;
    const p1 = termPos(ca, w.a.term);
    const p2 = termPos(cb, w.b.term);
    const d = manhattanPath(p1, p2);
    let cls = 'wire';
    if (state.sim && state.sim.ok && !state.sim.empty && !state.sim.isOpen && state.toggles.current) {
      const nodeA = state.sim.getNode(w.a.compId, w.a.term);
      const nodeB = state.sim.getNode(w.b.compId, w.b.term);
      const anyCurrent = state.sim.elements.some(e => (e.na===nodeA||e.nb===nodeA) && Math.abs(e.current) > 1e-4);
      if (anyCurrent) cls = 'wire active';
    }
    const path = svgEl('path', {
      class: cls, d,
      'data-wid': w.id,
      onclick: (ev) => { ev.stopPropagation(); if (state.tool === 'delete') deleteWire(w.id); else { state.selectedId = 'wire:'+w.id; render(); updateReadout(); } },
    });
    wiresG.appendChild(path);
  }
  svg.appendChild(wiresG);

  // Render components
  const compsG = svgEl('g', { class: 'comps' });
  for (const c of state.components) compsG.appendChild(renderComponent(c));
  svg.appendChild(compsG);

  // Terminal hit areas
  const termG = svgEl('g', { class: 'terms' });
  for (const c of state.components) {
    for (const t of COMP[c.type].terms) {
      const p = termPos(c, t.n);
      const k = keyOfTerm(c.id, t.n);
      const isHovered = editor.hoveredTerm === k;
      const isPending = state.pendingWire && state.pendingWire.from.compId === c.id && state.pendingWire.from.term === t.n;
      const isValidTarget = state.pendingWire && !isPending;
      let cls = 'terminal';
      if (isHovered) cls += ' hover';
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
}

export function renderComponent(c) {
  const g = svgEl('g', {
    class: 'comp' + (state.selectedId === c.id ? ' selected' : ''),
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
      g.appendChild(svgEl('text', { x:0, y:28, 'text-anchor':'middle', class:'val' }, `${c.props.voltage} V`));
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
      g.appendChild(svgEl('text', { x:0, y:26, 'text-anchor':'middle', class:'val' }, `${c.props.resistance} Ω`));
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
      g.appendChild(svgEl('text', { x:0, y:30, 'text-anchor':'middle', class:'val' }, `${c.props.resistance} Ω`));
      g.appendChild(svgEl('text', { x:0, y:-22, 'text-anchor':'middle', class:'label' }, c.id));
    }
  } else if (c.type === 'ammeter' || c.type === 'voltmeter') {
    const isA = c.type === 'ammeter';
    g.appendChild(svgEl('line', { class:'body', x1:-30, y1:0, x2:-14, y2:0 }));
    g.appendChild(svgEl('line', { class:'body', x1:14, y1:0, x2:30, y2:0 }));
    g.appendChild(svgEl('circle', { class:'fill', cx:0, cy:0, r:14 }));
    g.appendChild(svgEl('text', { x:0, y:4, 'text-anchor':'middle', class:'label', 'font-size': 13 }, isA ? 'A' : 'V'));
    let reading = '—';
    if (simEl && state.sim && state.sim.ok && !state.sim.empty) {
      if (isA) reading = Math.abs(simEl.current).toFixed(2) + ' A';
      else reading = Math.abs(simEl.drop).toFixed(2) + ' V';
    }
    if (state.toggles.labels) {
      g.appendChild(svgEl('text', { x:0, y:30, 'text-anchor':'middle', class:'val' }, reading));
      g.appendChild(svgEl('text', { x:0, y:-22, 'text-anchor':'middle', class:'label' }, c.id));
    }
    if (checkMeterPlacement(c) === 'warn') {
      g.classList.add('error');
    }
  }

  // Voltage drop bar for resistors/bulbs
  if (state.toggles.voltage && simEl && (c.type === 'bulb' || c.type === 'resistor') && state.sim && state.sim.ok && state.sim.supplyV > 0) {
    const vfrac = Math.min(1, Math.abs(simEl.drop) / state.sim.supplyV);
    const bw = 40;
    g.appendChild(svgEl('rect', { class:'vbar-bg', x:-bw/2, y: COMP[c.type].h/2 + 12, width: bw, height: 3, rx:1.5 }));
    g.appendChild(svgEl('rect', { class:'vbar-fg', x:-bw/2, y: COMP[c.type].h/2 + 12, width: bw*vfrac, height: 3, rx:1.5 }));
  }
  if (state.toggles.current && simEl && state.sim && state.sim.ok && state.sim.totalI > 0) {
    const ifrac = Math.min(1, Math.abs(simEl.current) / Math.max(state.sim.totalI, EPS));
    const bw = 40;
    g.appendChild(svgEl('rect', { class:'vbar-bg', x:-bw/2, y: COMP[c.type].h/2 + 18, width: bw, height: 3, rx:1.5 }));
    g.appendChild(svgEl('rect', { class:'ibar-fg', x:-bw/2, y: COMP[c.type].h/2 + 18, width: bw*ifrac, height: 3, rx:1.5 }));
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
