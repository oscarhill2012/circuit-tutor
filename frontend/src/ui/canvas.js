// Canvas HUD chips, readout panel, tool/toggle buttons, keyboard shortcuts.

import { state } from '../state/store.js';
import { pushHistory, simulate, undo, redo, deleteComponent, deleteWire } from '../state/actions.js';
import { render, svg } from '../circuit/renderer.js';

export function topologyGuess() { return window.Physics.topologyGuess(state.sim); }

export function updateHUD() {
  const s = state.sim;
  const stateChip = document.getElementById('circuit-state');
  if (!s || s.empty) {
    stateChip.innerHTML = 'Circuit: <b>empty</b>';
    stateChip.className = 'chip';
  } else if (!s.ok) {
    stateChip.innerHTML = 'Circuit: <b>short / error</b>';
    stateChip.className = 'chip bad';
  } else if (s.noSource) {
    stateChip.innerHTML = 'Circuit: <b>no supply</b>';
    stateChip.className = 'chip warn';
  } else if (s.isShort) {
    stateChip.innerHTML = 'Circuit: <b>short circuit — add a bulb or resistor</b>';
    stateChip.className = 'chip bad';
  } else if (s.isOpen) {
    stateChip.innerHTML = 'Circuit: <b>open loop — no current flows</b>';
    stateChip.className = 'chip warn';
  } else {
    stateChip.innerHTML = 'Circuit: <b>live · ' + topologyGuess() + '</b>';
    stateChip.className = 'chip good';
  }
}

export function updateReadout() {
  const s = state.sim;
  document.getElementById('ro-vs').textContent = s && s.supplyV ? s.supplyV.toFixed(1) + ' V' : '—';
  document.getElementById('ro-it').textContent = s && typeof s.totalI === 'number' ? s.totalI.toFixed(3) + ' A' : '—';
  let status = 'idle';
  if (!s || s.empty) status = 'empty';
  else if (!s.ok) status = 'error';
  else if (s.noSource) status = 'no supply';
  else if (s.isOpen) status = 'open';
  else status = 'live';
  document.getElementById('ro-status').textContent = status;

  let selText = '—';
  if (state.selectedId && !state.selectedId.startsWith('wire:')) {
    const c = state.components.find(x => x.id === state.selectedId);
    if (c) {
      const el = s && s.ok ? s.elements.find(e => e.comp && e.comp.id === c.id) : null;
      if (el) selText = `${c.id} · ${Math.abs(el.current).toFixed(2)} A, ${Math.abs(el.drop).toFixed(2)} V`;
      else selText = c.id;
    }
  } else if (state.selectedId && state.selectedId.startsWith('wire:')) selText = state.selectedId;
  document.getElementById('ro-sel').textContent = selText;
}

export function initTools() {
  document.querySelectorAll('.tools button[data-tool]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.tool = btn.dataset.tool;
      document.querySelectorAll('.tools button[data-tool]').forEach(b => b.classList.toggle('active', b === btn));
      svg.className.baseVal = 'tool-' + state.tool;
      state.pendingWire = null;
      render();
    });
  });
  document.getElementById('btn-undo').onclick = undo;
  document.getElementById('btn-redo').onclick = redo;
  document.getElementById('btn-clear').onclick = () => {
    if (!state.components.length && !state.wires.length) return;
    if (!confirm('Clear the whole circuit?')) return;
    pushHistory();
    state.components = []; state.wires = []; state.selectedId = null;
    simulate(); render();
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
    if (ev.key === 'Delete' && state.selectedId) {
      if (state.selectedId.startsWith('wire:')) deleteWire(state.selectedId.slice(5));
      else deleteComponent(state.selectedId);
    }
    if ((ev.ctrlKey || ev.metaKey) && ev.key === 'z') { ev.preventDefault(); undo(); }
    if ((ev.ctrlKey || ev.metaKey) && (ev.key === 'y' || (ev.shiftKey && ev.key === 'Z'))) { ev.preventDefault(); redo(); }
    if (ev.key === 's' && state.selectedId) {
      const c = state.components.find(x => x.id === state.selectedId);
      if (c && c.type === 'switch') { pushHistory(); c.props.closed = !c.props.closed; simulate(); render(); }
    }
  });
}
