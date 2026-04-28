// Tool/toggle buttons + keyboard shortcuts.
// (Live-readings widget removed — selected-component values live in
// Professor Volt's check-my-circuit response and the in-canvas meters.)

import { state } from '../state/store.js';
import { Sel, isValidTool } from '../state/constants.js';
import { pushHistory, simulate, undo, redo, deleteComponent, deleteWire, clearCircuit, setTool } from '../state/actions.js';
import { render, svg } from '../circuit/renderer.js';

export function initTools() {
  document.querySelectorAll('.tools button[data-tool]').forEach(btn => {
    btn.addEventListener('click', () => setTool(btn.dataset.tool));
  });
  // Dev-time check: every tool button in the DOM must map to a known Tool.
  document.querySelectorAll('.tools button[data-tool]').forEach(b => {
    if (!isValidTool(b.dataset.tool)) console.warn('unknown tool:', b.dataset.tool);
  });
  document.getElementById('btn-undo').onclick = undo;
  document.getElementById('btn-redo').onclick = redo;
  document.getElementById('btn-clear').onclick = () => {
    if (!state.components.length && !state.wires.length) return;
    if (!confirm('Clear the whole circuit?')) return;
    clearCircuit();
  };
  document.querySelectorAll('.toggle').forEach(t => {
    t.addEventListener('click', () => {
      const k = t.dataset.toggle;
      state.toggles[k] = !state.toggles[k];
      t.classList.toggle('on', state.toggles[k]);
      render();
    });
  });
}

export function initKeyboard() {
  document.addEventListener('keydown', (ev) => {
    if (ev.target.tagName === 'INPUT') return;
    const sel = state.selection;
    if (ev.key === 'Delete' && sel) {
      if (Sel.isWire(sel)) deleteWire(sel.id);
      else deleteComponent(sel.id);
    }
    if ((ev.ctrlKey || ev.metaKey) && ev.key === 'z') { ev.preventDefault(); undo(); }
    if ((ev.ctrlKey || ev.metaKey) && (ev.key === 'y' || (ev.shiftKey && ev.key === 'Z'))) { ev.preventDefault(); redo(); }
    if (ev.key === 's' && Sel.isComponent(sel)) {
      const c = state.components.find(x => x.id === sel.id);
      if (c && c.type === 'switch') { pushHistory(); c.props.closed = !c.props.closed; simulate(); render(); }
    }
  });
}
