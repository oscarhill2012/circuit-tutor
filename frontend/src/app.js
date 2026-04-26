// Central coordinator. Re-exports the shared state object and owns boot().
// Individual modules import what they need directly from their neighbours;
// this file only wires up the startup sequence and the starter circuit.

import { state } from './state/store.js';
import { simulate } from './state/actions.js';
import { render, initRenderer } from './circuit/renderer.js';
import { initCanvasInteractions } from './circuit/editor.js';
import { initPalette } from './ui/palette.js';
import { initTools, initKeyboard, updateReadout } from './ui/canvas.js';
import { initTaskControls, loadTasks, openTaskModal } from './tasks/engine.js';
import { initTutorPanel } from './ui/tutorPanel.js';

export { state };

export async function boot() {
  initRenderer();
  initPalette();
  initTools();
  initKeyboard();
  initCanvasInteractions();
  initTaskControls();
  initTutorPanel();

  try { await loadTasks(); } catch (err) { console.error('Task load failed:', err); }

  // Sandbox starts empty so the new topological short-circuit rule (a load
  // component whose terminals collapse to one node is flagged as a short)
  // can't be tripped by a preloaded example. Students pick a task or build
  // freely from the palette.
  state.history = [];
  state.future = [];
  console.assert(state.selection === null, 'selection starts null');
  simulate();
  render();
  updateReadout();

  // Open the task loader on first boot. The student picks a task or
  // enters sandbox mode; Professor Volt introduces whichever they chose.
  openTaskModal();
}
