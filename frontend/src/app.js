// Central coordinator. Re-exports the shared state object and owns boot().
// Individual modules import what they need directly from their neighbours;
// this file only wires up the startup sequence and the starter circuit.

import { state } from './state/store.js';
import { simulate } from './state/actions.js';
import { render } from './circuit/renderer.js';
import { initCanvasInteractions } from './circuit/editor.js';
import { initPalette } from './ui/palette.js';
import { initTools, initKeyboard, updateReadout } from './ui/canvas.js';
import { renderTask, initTaskControls } from './tasks/engine.js';
import { initTutorPanel, greet } from './ui/tutorPanel.js';

export { state };

export function boot() {
  initPalette();
  initTools();
  initKeyboard();
  initCanvasInteractions();
  initTaskControls();
  initTutorPanel();

  // Starter: give students a live example.
  // Lay the starter out as a visible rectangular loop so students see the
  // closed path. cell bottom-left, switch top, bulb right.
  state.components.push(
    { id: 'C1', type: 'cell',   x: 400,  y: 700, rot: 0, props: { voltage: 6 } },
    { id: 'S1', type: 'switch', x: 900,  y: 300, rot: 0, props: { closed: true } },
    { id: 'L1', type: 'bulb',   x: 1200, y: 700, rot: 0, props: { resistance: 4 } },
  );
  state.wires.push(
    { id: 'W' + (state.nextId++), a:{compId:'C1',term:'+'}, b:{compId:'S1',term:'a'} },
    { id: 'W' + (state.nextId++), a:{compId:'S1',term:'b'}, b:{compId:'L1',term:'a'} },
    { id: 'W' + (state.nextId++), a:{compId:'L1',term:'b'}, b:{compId:'C1',term:'-'} },
  );
  state.history = [];
  state.future = [];
  simulate();
  render();
  renderTask();
  updateReadout();

  greet();
}
