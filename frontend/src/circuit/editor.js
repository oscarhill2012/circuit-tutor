// Canvas interaction: component drag, wire creation, terminal hit-testing.
// Holds the small amount of transient editing state (hover/drag/preview).

import { state } from '../state/store.js';
import { pushHistory, simulate, snap } from '../state/actions.js';
import { render, svg, termPos, manhattanPath } from './renderer.js';
import { updateReadout } from '../ui/canvas.js';

export const editor = {
  hoveredTerm: null,
  dragging: null,  // {compId, offsetX, offsetY, moved, started}
  previewEl: null, // set by renderer.render() when a pending wire exists
};

export function svgPoint(ev) {
  const pt = svg.createSVGPoint();
  pt.x = ev.clientX; pt.y = ev.clientY;
  const ctm = svg.getScreenCTM().inverse();
  const p = pt.matrixTransform(ctm);
  return { x: p.x, y: p.y };
}

export function onCompMouseDown(ev, c) {
  if (state.tool !== 'select') return;
  ev.stopPropagation();
  const p = svgPoint(ev);
  editor.dragging = { compId: c.id, offsetX: p.x - c.x, offsetY: p.y - c.y, moved: false, started: JSON.stringify(c) };
  state.selectedId = c.id;
  render();
}

export function onTerminalPointerDown(ev, compId, term) {
  if (state.tool === 'delete') {
    const before = state.wires.length;
    state.wires = state.wires.filter(w =>
      !(w.a.compId===compId && w.a.term===term) &&
      !(w.b.compId===compId && w.b.term===term));
    if (state.wires.length !== before) { pushHistory(); simulate(); render(); }
    return;
  }
  const p = svgPoint(ev);
  state.pendingWire = { from: { compId, term }, mouseX: p.x, mouseY: p.y };
  try { svg.setPointerCapture(ev.pointerId); } catch (_) {}
  render();
}

export function findTerminalAtClient(clientX, clientY) {
  // Hide preview so it doesn't intercept hit-testing, then query element under pointer.
  const hadPreview = !!editor.previewEl;
  let prevPE = null;
  if (hadPreview) { prevPE = editor.previewEl.getAttribute('pointer-events'); editor.previewEl.setAttribute('pointer-events', 'none'); }
  const el = document.elementFromPoint(clientX, clientY);
  if (hadPreview) {
    if (prevPE === null) editor.previewEl.removeAttribute('pointer-events');
    else editor.previewEl.setAttribute('pointer-events', prevPE);
  }
  if (!el) return null;
  const hit = el.closest && el.closest('.terminal.hit');
  if (!hit) return null;
  return { compId: hit.getAttribute('data-comp'), term: hit.getAttribute('data-tname') };
}

export function updateWireHoverTarget(clientX, clientY) {
  const tgt = findTerminalAtClient(clientX, clientY);
  const tgtKey = tgt ? (tgt.compId + '.' + tgt.term) : null;
  if (tgtKey === editor.hoveredTerm) return;
  editor.hoveredTerm = tgtKey;
  // Adjust classes directly to avoid a full SVG rebuild.
  document.querySelectorAll('#canvas .terminal').forEach(el => {
    if (el.classList.contains('hit')) return;
    el.classList.remove('hover');
  });
  if (tgt) {
    const hit = document.querySelector('.terminal.hit[data-comp="' + tgt.compId + '"][data-tname="' + tgt.term + '"]');
    if (hit) {
      const visible = hit.previousElementSibling;
      if (visible && visible.classList.contains('terminal')) visible.classList.add('hover');
    }
  }
}

// Register canvas-level pointer handlers. Called once during boot.
export function initCanvasInteractions() {
  svg.addEventListener('pointermove', (ev) => {
    const p = svgPoint(ev);
    if (editor.dragging) {
      const c = state.components.find(x => x.id === editor.dragging.compId);
      if (c) {
        c.x = snap(p.x - editor.dragging.offsetX);
        c.y = snap(p.y - editor.dragging.offsetY);
        editor.dragging.moved = true;
        render();
      }
      return;
    }
    if (state.pendingWire) {
      state.pendingWire.mouseX = p.x;
      state.pendingWire.mouseY = p.y;
      if (editor.previewEl) {
        const ca = state.components.find(c => c.id === state.pendingWire.from.compId);
        if (ca) {
          const p1 = termPos(ca, state.pendingWire.from.term);
          editor.previewEl.setAttribute('d', manhattanPath(p1, p));
        }
      }
      updateWireHoverTarget(ev.clientX, ev.clientY);
    }
  });

  svg.addEventListener('pointerup', (ev) => {
    if (editor.dragging) {
      if (editor.dragging.moved) { pushHistory(); simulate(); render(); }
      editor.dragging = null;
      return;
    }
    if (state.pendingWire) {
      const from = state.pendingWire.from;
      const tgt = findTerminalAtClient(ev.clientX, ev.clientY);
      state.pendingWire = null;
      if (tgt && !(tgt.compId === from.compId && tgt.term === from.term)) {
        const dup = state.wires.find(w =>
          (w.a.compId===from.compId && w.a.term===from.term && w.b.compId===tgt.compId && w.b.term===tgt.term) ||
          (w.b.compId===from.compId && w.b.term===from.term && w.a.compId===tgt.compId && w.a.term===tgt.term)
        );
        if (!dup) {
          pushHistory();
          state.wires.push({ id: 'W' + (state.nextId++), a: from, b: { compId: tgt.compId, term: tgt.term } });
          simulate();
        }
      }
      try { svg.releasePointerCapture(ev.pointerId); } catch (_) {}
      editor.hoveredTerm = null;
      render();
      return;
    }
    if (ev.target === svg) {
      state.selectedId = null;
      render();
      updateReadout();
    }
  });

  svg.addEventListener('pointercancel', () => {
    state.pendingWire = null;
    editor.dragging = null;
    editor.hoveredTerm = null;
    render();
  });
}
