// Canvas interaction layer.
//
// Responsibilities:
//   - Component drag (pointer down/move/up on a .comp group).
//   - Terminal hit-testing for wire hover / click.
//   - Forwarding semantic events (connector click, canvas click, Escape,
//     pointer move) to the WireInteractionController.
//
// Routing, validation and state-machine logic live in wiring/*.

import { state } from '../state/store.js';
import { pushHistory, simulate, snap } from '../state/actions.js';
import { render, svg, rerouteWiresFor, keyOfTerm } from './renderer.js';
import { termPos } from './geometry.js';
import { route as routePath } from './wiring/router.js';
import { previewPath } from './wiring/path.js';
import { updateReadout } from '../ui/canvas.js';
import { createValidator } from './wiring/validation.js';
import { createWireInteractionController } from './wiring/controller.js';

export const editor = {
  hoveredTerm: null,
  invalidHoverKey: null,
  dragging: null,   // {compId, offsetX, offsetY, moved, started}
  previewEl: null,  // set by renderer.render() for the pending preview wire
};

const validator = createValidator(() => state);

const controller = createWireInteractionController({
  validator,
  onCommit(from, to) {
    const path = routePath(from, to, { excludeComps: [from.compId, to.compId] });
    pushHistory();
    const wire = {
      id: 'W' + (state.nextId++),
      a: from,
      b: to,
      path: path && path.length >= 2 ? path : null,
    };
    state.wires.push(wire);
    simulate();
    return wire.id;
  },
  onChange({ status, pending, invalidHover, previewMove }) {
    state.pendingWire = pending;
    editor.invalidHoverKey = invalidHover ? keyOfTerm(invalidHover.compId, invalidHover.term) : null;
    svg.classList.toggle('wiring', !!pending);
    // Pointer-move updates while a wire is pending are extremely frequent.
    // Doing a full SVG rebuild on every move destroys the terminal element
    // under the cursor — which was making the second click fiddly and caused
    // the cursor to flicker as hover states were rebuilt from scratch.
    // For pure preview-follow updates, mutate the existing preview path's `d`
    // attribute in place instead.
    if (previewMove && pending && editor.previewEl) {
      const ca = state.components.find(c => c.id === pending.from.compId);
      if (ca) {
        const p1 = termPos(ca, pending.from.term);
        const p2 = { x: pending.mouseX, y: pending.mouseY };
        editor.previewEl.setAttribute('d', previewPath(p1, p2));
      }
      return;
    }
    render();
  },
  onReject(port, reason) {
    editor.invalidHoverKey = keyOfTerm(port.compId, port.term);
    render();
    if (reason === 'duplicate') flashInvalidHint();
  },
});

export { controller as wireController };

function flashInvalidHint() {
  // Brief visual flash — handled entirely in CSS via the .invalid class we
  // already apply. Clear it after a moment so the state recovers cleanly.
  setTimeout(() => {
    if (editor.invalidHoverKey) { editor.invalidHoverKey = null; render(); }
  }, 500);
}

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
  editor.dragging = {
    compId: c.id, offsetX: p.x - c.x, offsetY: p.y - c.y,
    moved: false, started: JSON.stringify(c),
  };
  state.selectedId = c.id;
  render();
}

export function onTerminalPointerDown(ev, compId, term) {
  if (state.tool === 'delete') {
    const before = state.wires.length;
    state.wires = state.wires.filter(w =>
      !(w.a.compId === compId && w.a.term === term) &&
      !(w.b.compId === compId && w.b.term === term));
    if (state.wires.length !== before) { pushHistory(); simulate(); render(); }
    return;
  }
  const pt = svgPoint(ev);
  controller.onConnectorClick({ compId, term }, pt);
}

export function findTerminalAtClient(clientX, clientY) {
  const hadPreview = !!editor.previewEl;
  let prevPE = null;
  if (hadPreview) {
    prevPE = editor.previewEl.getAttribute('pointer-events');
    editor.previewEl.setAttribute('pointer-events', 'none');
  }
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
  const tgtKey = tgt ? keyOfTerm(tgt.compId, tgt.term) : null;
  if (tgtKey === editor.hoveredTerm) {
    controller.onHoverTarget(tgt);
    return;
  }
  editor.hoveredTerm = tgtKey;
  // Adjust classes directly to avoid a full SVG rebuild on every pointermove.
  document.querySelectorAll('#canvas .terminal').forEach(el => {
    if (el.classList.contains('hit')) return;
    el.classList.remove('hover');
  });
  if (tgt) {
    const hit = document.querySelector(
      '.terminal.hit[data-comp="' + tgt.compId + '"][data-tname="' + tgt.term + '"]'
    );
    if (hit) {
      const visible = hit.previousElementSibling;
      if (visible && visible.classList.contains('terminal')) visible.classList.add('hover');
    }
  }
  controller.onHoverTarget(tgt);
}

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
      controller.onPointerMove(p);
      updateWireHoverTarget(ev.clientX, ev.clientY);
    }
  });

  svg.addEventListener('pointerup', (ev) => {
    if (editor.dragging) {
      if (editor.dragging.moved) {
        pushHistory();
        rerouteWiresFor([editor.dragging.compId]);
        simulate();
        render();
      }
      editor.dragging = null;
      return;
    }
    // Clicking empty canvas cancels any pending wire and clears selection.
    const t = ev.target;
    const isBg = t === svg || (t.classList && t.classList.contains('grid-line'));
    if (isBg) {
      if (state.pendingWire) {
        controller.onCanvasClick();
        editor.hoveredTerm = null;
        return;
      }
      state.selectedId = null;
      render();
      updateReadout();
    }
  });

  svg.addEventListener('pointercancel', () => {
    editor.dragging = null;
    editor.hoveredTerm = null;
    controller.reset();
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      controller.onEscape();
      editor.hoveredTerm = null;
    }
  });
}
