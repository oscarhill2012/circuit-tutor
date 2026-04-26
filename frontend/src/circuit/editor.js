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
import { Tool, Sel } from '../state/constants.js';
import { pushHistory, simulate, snap } from '../state/actions.js';
import { render, svg, rerouteWiresFor, keyOfTerm, setSelection, beginDragFrame, applyDragFrame } from './renderer.js';
import { termPos, endpointPos, endpointKey } from './geometry.js';
import { route as routePath, segCross } from './wiring/router.js';
import { previewPath } from './wiring/path.js';
import { createValidator } from './wiring/validation.js';
import { createWireInteractionController } from './wiring/controller.js';

export const editor = {
  hoveredTerm: null,
  invalidHoverKey: null,
  hoveredWireId: null, // id of the wire currently under the cursor
  dragging: null,   // {compId, offsetX, offsetY, moved, started}
  previewEl: null,  // set by renderer.render() for the pending preview wire
};

const validator = createValidator(() => state);

const controller = createWireInteractionController({
  validator,
  onCommit(from, to) {
    pushHistory();
    const wire = {
      id: 'W' + (state.nextId++),
      a: from,
      b: to,
      path: null,
    };
    state.wires.push(wire);
    // Route AFTER pushing so assignJunctionDirs sees the new wire and can
    // lock in its junction cardinal (persisted on wire.junctionDirs). If
    // we routed before push, the wire would go through the "new wire"
    // branch of endpointDir, which picks a cardinal but never persists it
    // — a later reroute could then choose a different cardinal, leaving
    // the cached path's stub direction out of sync with the assignment.
    const path = routePath(from, to, {
      excludeComps: [from.compId, to.compId].filter(Boolean),
      excludeWires: [wire.id],
    });
    if (path && path.length >= 2) wire.path = path;
    simulate();
    return wire.id;
  },
  onChange({ status, pending, invalidHover, previewMove }) {
    state.pendingWire = pending;
    editor.invalidHoverKey = invalidHover ? endpointKey(invalidHover) : null;
    svg.classList.toggle('wiring', !!pending);
    // Pointer-move updates while a wire is pending are extremely frequent.
    // Doing a full SVG rebuild on every move destroys the terminal element
    // under the cursor — which was making the second click fiddly and caused
    // the cursor to flicker as hover states were rebuilt from scratch.
    // For pure preview-follow updates, mutate the existing preview path's `d`
    // attribute in place instead.
    if (previewMove && pending && editor.previewEl) {
      const p1 = endpointPos(pending.from);
      if (p1) {
        const p2 = { x: pending.mouseX, y: pending.mouseY };
        editor.previewEl.setAttribute('d', previewPath(p1, p2));
      }
      return;
    }
    render();
  },
  onReject(port, reason) {
    editor.invalidHoverKey = endpointKey(port);
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

function countPathCrossings(p1, p2) {
  if (!p1 || !p2 || p1.length < 2 || p2.length < 2) return 0;
  let n = 0;
  for (let i = 1; i < p1.length; i++) {
    for (let j = 1; j < p2.length; j++) {
      if (segCross(p1[i-1], p1[i], p2[j-1], p2[j])) n++;
    }
  }
  return n;
}

// After a component moves, if two wires that both attach to it now cross
// each other, swap which terminal each wire uses (on the moved component
// only) and reroute — provided the swap actually removes a crossing.
export function maybeSwapCrossedTerminals(compId) {
  const attached = state.wires.filter(w => w.a.compId === compId || w.b.compId === compId);
  if (attached.length !== 2) return false;
  const [w1, w2] = attached;
  const end1 = w1.a.compId === compId ? 'a' : 'b';
  const end2 = w2.a.compId === compId ? 'a' : 'b';
  if (!w1[end1].term || !w2[end2].term) return false;
  if (w1[end1].term === w2[end2].term) return false;
  const before = countPathCrossings(w1.path, w2.path);
  if (before === 0) return false;
  const t1 = w1[end1].term, t2 = w2[end2].term;
  w1[end1].term = t2;
  w2[end2].term = t1;
  const np1 = routePath(w1.a, w1.b, { excludeComps: [w1.a.compId, w1.b.compId], excludeWires: [w1.id, w2.id] });
  const np2 = routePath(w2.a, w2.b, { excludeComps: [w2.a.compId, w2.b.compId], excludeWires: [w1.id, w2.id] });
  if (!np1 || !np2) { w1[end1].term = t1; w2[end2].term = t2; return false; }
  const after = countPathCrossings(np1, np2);
  if (after < before) {
    w1.path = np1; w2.path = np2;
    return true;
  }
  w1[end1].term = t1; w2[end2].term = t2;
  return false;
}

export function onCompMouseDown(ev, c) {
  if (state.tool !== Tool.SELECT) return;
  ev.stopPropagation();
  const p = svgPoint(ev);
  editor.dragging = {
    compId: c.id, offsetX: p.x - c.x, offsetY: p.y - c.y,
    moved: false, started: JSON.stringify(c),
    // Pre-collected obstacles + attached wires shared across every
    // pointermove frame for this drag — see beginDragFrame in renderer.js.
    frame: beginDragFrame(c.id),
  };
  setSelection(Sel.component(c.id));
}

export function onTerminalPointerDown(ev, compId, term, junctionId) {
  const port = junctionId ? { junctionId } : { compId, term };
  if (state.tool === Tool.DELETE) {
    const matches = junctionId
      ? (w) => w.a.junctionId === junctionId || w.b.junctionId === junctionId
      : (w) => (w.a.compId === compId && w.a.term === term)
            || (w.b.compId === compId && w.b.term === term);
    const before = state.wires.length;
    state.wires = state.wires.filter(w => !matches(w));
    if (state.wires.length !== before) { pushHistory(); simulate(); render(); }
    return;
  }
  const pt = svgPoint(ev);
  controller.onConnectorClick(port, pt);
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
  const jid = hit.getAttribute('data-junction');
  if (jid) return { junctionId: jid };
  return { compId: hit.getAttribute('data-comp'), term: hit.getAttribute('data-tname') };
}

export function updateWireHoverTarget(clientX, clientY) {
  const tgt = findTerminalAtClient(clientX, clientY);
  const tgtKey = tgt ? (tgt.junctionId ? 'J:' + tgt.junctionId : keyOfTerm(tgt.compId, tgt.term)) : null;
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
    const sel = tgt.junctionId
      ? '.terminal.hit[data-junction="' + tgt.junctionId + '"]'
      : '.terminal.hit[data-comp="' + tgt.compId + '"][data-tname="' + tgt.term + '"]';
    const hit = document.querySelector(sel);
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
        // Drag fast-path: mutate transform + reroute attached wires only.
        // No render(): the rest of the SVG is untouched, and w.path is left
        // as-is so the post-drop rerouteWiresFor still runs against the
        // committed previous path.
        applyDragFrame(editor.dragging.frame);
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
        maybeSwapCrossedTerminals(editor.dragging.compId);
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
      setSelection(null);
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
