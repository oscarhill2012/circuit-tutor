// Entry point loaded by index.html (type="module"). Imports the coordinator
// and fires boot() once modules have resolved.

import { boot } from './app.js';
import { startAmbient } from './ui/ambient.js';

boot();  // boot is async; we fire-and-forget here, errors surface in the tutor panel / console.
startAmbient();  // schedules the occasional distant arc on the canvas backdrop
