// Central coordinator. Re-exports the shared state object and owns boot().
// Individual modules import what they need directly from their neighbours;
// this file only wires up the startup sequence and the starter circuit.

import { state } from './state/store.js';
import { simulate, loadInitialCircuit } from './state/actions.js';
import { render, initRenderer } from './circuit/renderer.js';
import { initCanvasInteractions } from './circuit/editor.js';
import { initPalette } from './ui/palette.js';
import { initTools, initKeyboard } from './ui/canvas.js';
import { initTaskControls, loadTasks, openTaskModal } from './tasks/engine.js';
import { initTutorPanel } from './ui/tutorPanel.js';
import { initTopbarContext } from './ui/topbarContext.js';
import { initDevInspector } from './tutor/devInspector.js';
import { maybeRunIntro } from './ui/onboarding.js';

export { state };

export async function boot() {
  initRenderer();
  initPalette();
  initTools();
  initKeyboard();
  initCanvasInteractions();
  initTaskControls();
  initTutorPanel();
  initDevInspector();

  // DEBUG-OVERLAP — verifier hook for iter-improv Phase 1.
  // Exposes the bare minimum surface needed to construct deterministic
  // wire/junction circuits from Playwright. Gated on ?dev=1 so a real student
  // session never sees it. Remove once the overlap iter-improv work lands.
  if (typeof location !== 'undefined' && location.search.includes('dev=1')) {
    window.__circuit = { state, loadInitialCircuit, render, simulate };
  }

  try { await loadTasks(); } catch (err) { console.error('Task load failed:', err); }

  // Topbar context chip mounts after loadTasks() so its first render sees
  // a populated TASKS array (otherwise the progress total would be 0/0
  // until the next active-task change forced a re-render).
  initTopbarContext();

  // Sandbox starts empty so the new topological short-circuit rule (a load
  // component whose terminals collapse to one node is flagged as a short)
  // can't be tripped by a preloaded example. Students pick a task or build
  // freely from the palette.
  state.history = [];
  state.future = [];
  console.assert(state.selection === null, 'selection starts null');
  simulate();
  render();

  // First-launch operational tour. Resolves immediately if disabled
  // (?intro=0 or localStorage.circuitTutor.introSeen === '1'). Otherwise
  // walks the student through the UI and finishes with the task picker
  // already open. See ui/onboarding.js + plans/16-onboarding-intro.md.
  await maybeRunIntro();

  // Open the task loader if the intro didn't already do so. The student
  // picks a task or enters sandbox mode; Professor Volt introduces
  // whichever they chose.
  const modal = document.getElementById('task-modal');
  if (!modal || modal.classList.contains('hidden')) openTaskModal();
}
