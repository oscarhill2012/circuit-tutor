// Canvas HUD chips, readout panel, tool/toggle buttons, keyboard shortcuts.

import { state } from '../state/store.js';
import { pushHistory, simulate, undo, redo, deleteComponent, deleteWire, clearCircuit } from '../state/actions.js';
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
  let status = 'idle';
  if (!s || s.empty) status = 'empty';
  else if (!s.ok) status = 'error';
  else if (s.noSource) status = 'no supply';
  else if (s.isShort) status = 'short';
  else if (s.isOpen) status = 'open';
  else status = 'live';
  document.getElementById('ro-status').textContent = status;

  const hd = document.getElementById('ro-sel-hd');
  const vEl = document.getElementById('ro-sel-v');
  const iEl = document.getElementById('ro-sel-i');
  const rEl = document.getElementById('ro-sel-r');
  vEl.textContent = iEl.textContent = rEl.textContent = '—';

  const sel = state.selectedId;
  if (!sel) { hd.textContent = 'Select a component'; return; }
  if (sel.startsWith('wire:')) { hd.textContent = sel + ' — wire segment'; return; }

  const c = state.components.find(x => x.id === sel);
  if (!c) { hd.textContent = 'Select a component'; return; }
  hd.textContent = `${c.id} · ${c.type}`;

  const el = s && s.ok ? s.elements.find(e => e.comp && e.comp.id === c.id) : null;
  const live = s && s.ok && !s.empty && !s.isShort;
  if (el && live) {
    vEl.textContent = Math.abs(el.drop).toFixed(2) + ' V';
    iEl.textContent = Math.abs(el.current).toFixed(3) + ' A';
  }
  if (c.type === 'cell' || c.type === 'battery') {
    vEl.textContent = Number(c.props.voltage).toFixed(2) + ' V';
  }
  if (c.type === 'resistor' || c.type === 'bulb') {
    rEl.textContent = Number(c.props.resistance).toFixed(2) + ' Ω';
  } else if (c.type === 'ammeter' || c.type === 'voltmeter') {
    const ideal = c.type === 'ammeter' ? window.Physics.settings.ammeterR : window.Physics.settings.voltmeterR;
    rEl.textContent = formatResistance(ideal);
  }
}

function formatResistance(r) {
  if (!isFinite(r) || r >= 1e7) return '∞ Ω';
  if (r <= 1e-3) return '≈0 Ω';
  if (r >= 1000) return (r / 1000).toFixed(2) + ' kΩ';
  return r.toFixed(2) + ' Ω';
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
