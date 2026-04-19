// Entry point loaded by index.html (type="module"). Imports the coordinator
// and fires boot() once modules have resolved.

import { boot } from './app.js';

boot();  // boot is async; we fire-and-forget here, errors surface in the tutor panel / console.
