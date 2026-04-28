// First-launch operational tour — see plans/16-onboarding-intro.md.
// Runs once per browser before the task picker opens. Disable with ?intro=0.
// Force-replay with ?intro=1 (overrides the localStorage seen flag).

import { state } from '../state/store.js';
import { addComponent, clearCircuit, simulate } from '../state/actions.js';
import { render } from '../circuit/renderer.js';
import { route as routePath } from '../circuit/wiring/router.js';
import { openTaskModal } from '../tasks/engine.js';
import { showPaletteTooltipFor, hidePaletteTooltip } from './palette.js';
import { showComponentGlossary, hideComponentGlossary } from '../circuit/editor.js';

const FLAG_KEY = 'circuitTutor.introSeen';

function resolveFlag() {
  const search = (typeof location !== 'undefined' && location.search) || '';
  if (/[?&]intro=0(?:&|$)/.test(search)) return { run: false };
  if (/[?&]intro=1(?:&|$)/.test(search)) return { run: true, force: true };
  try {
    if (localStorage.getItem(FLAG_KEY) === '1') return { run: false };
  } catch { /* private mode etc — fall through */ }
  return { run: true };
}

export async function maybeRunIntro() {
  const flag = resolveFlag();
  if (!flag.run) return;
  await runTour();
  // Discard the demo's history entries so Undo can't replay the cell/bulb/wires.
  state.history = [];
  state.future = [];
  try { localStorage.setItem(FLAG_KEY, '1'); } catch { /* ignore */ }
}

// ---- step definitions ---------------------------------------------------

const STEPS = [
  { // 0 — Welcome
    selector: null,
    heading: 'Welcome to Circuit Tutor',
    body: "Hi! Before you start, let me show you around. You can skip any time using the Skip button.",
    buttons: ['next', 'skip'],
    nextLabel: 'Start tour →',
  },
  { // 1 — Components palette (also demonstrates the hover-glossary)
    selector: '.palette .parts',
    heading: 'These are your components',
    body: "Cells, bulbs, switches, resistors, ammeters, voltmeters — drag any of these onto the canvas. **Hover any component to see what it does** (here's the cell as an example).",
    buttons: ['back', 'next', 'skip'],
    onShow: () => {
      // Float the palette tooltip on the cell tile so the student sees
      // exactly the affordance the body sentence is describing. Fires
      // immediately so an early Next click can't leave a stale timer
      // re-showing the tooltip after onLeave has already hidden it.
      showPaletteTooltipFor('cell');
    },
    onLeave: () => hidePaletteTooltip(),
  },
  { // 2 — Tools strip
    selector: '.palette .tools',
    heading: 'And these are your tools',
    body: 'Select moves things. Wire connects them. Delete removes them. Undo, Redo and Clear let you tidy up.',
    buttons: ['back', 'next', 'skip'],
  },
  { // 3 — Place a cell (auto)
    selector: '.parts [data-type="cell"]',
    heading: 'Adding a cell',
    body: "Normally you'd drag this onto the canvas. I'll do it for you so you can see what happens.",
    buttons: ['next', 'skip'],
    afterNext: async () => { await placeCell(); },
  },
  { // 4 — Place a bulb (auto)
    selector: '.parts [data-type="bulb"]',
    heading: 'Now a bulb',
    body: "Same idea. We've got a cell on the left and we'll add a bulb on the right.",
    buttons: ['next', 'skip'],
    afterNext: async () => { await placeBulb(); },
  },
  { // 5 — Wire tool + auto-draw the loop
    selector: '.tools button[data-tool="wire"]',
    heading: 'To connect them, use Wire',
    body: "Click Wire, then click each component's terminal in turn. I'll draw the two wires that close this loop.",
    buttons: ['next', 'skip'],
    afterNext: async () => { await drawLoop(); },
  },
  { // 5b — Bulb is lit (1.5s dwell before Next is enabled)
    selector: '#canvas',
    heading: "That's a complete circuit!",
    body: 'The bulb is lit because current flows around the loop. The simulator updates live whenever you change anything.',
    buttons: ['next', 'skip'],
    enableNextAfter: 1500,
    spotlightOpts: { padding: 12, radius: 16 },
  },
  { // 6 — Clear button
    selector: '#btn-clear',
    heading: 'Starting over',
    body: "Clear empties the canvas in one click. We'll use it now to get ready for your first task.",
    buttons: ['next', 'skip'],
    afterNext: async () => {
      clearCircuit();
      state.history = []; state.future = [];
      await wait(250);
    },
  },
  { // 7 — Task picker (entry — modal opens here)
    selector: '.task-picker',
    heading: 'This is your task list',
    body: "Here's where you pick what to work on. Let's look at the three things you'll use most.",
    buttons: ['next', 'skip'],
    spotlightOpts: { padding: 4, radius: 18 },
  },
  { // 8 — Type filters
    selector: '.tp-filter-group[data-filter="type"]',
    heading: 'Filter by topic',
    body: 'Tasks come in four flavours — Measure, Problem, Scenario and Explore. Tap a chip to narrow the list to just that kind.',
    buttons: ['back', 'next', 'skip'],
  },
  { // 9 — Difficulty filters
    selector: '.tp-filter-group[data-filter="difficulty"]',
    heading: 'Pick a difficulty',
    body: "Beginner through Expert. If you're new to circuits, start with Beginner — you can always level up.",
    buttons: ['back', 'next', 'skip'],
  },
  { // 10 — Description preview
    selector: '.tp-preview',
    heading: 'Read before you start',
    body: "Click any task on the left and its full description appears here — what to build, what to measure, and how you'll know you're done.",
    buttons: ['back', 'next', 'skip'],
  },
  { // 11 — Professor Volt + tutor-quick (two-stage finale; modal closed for visibility)
    stages: [
      {
        selector: '.rightcol .tutor .hd',
        heading: 'Meet Professor Volt',
        body: 'This is your AI tutor. Stuck on a task, a concept, or even what a button does? Type your question in the chat down here.',
        dwell: 1300,
      },
      {
        selector: '.rightcol .tutor',
        heading: 'Three shortcuts in one tap',
        body: "Tap **Ask for a hint** when you're stuck, **Task reminder** to re-read what the current task wants, and **Check my circuit** when you think you've finished — Professor Volt will look at what you've built and tell you if it's right.",
        emphasize: '.tutor-quick',
      },
    ],
    buttons: ['back', 'done'],
    spotlightOpts: { padding: 6, radius: 14 },
  },
];

// Steps where the task picker modal must be visible. Indexes line up with
// STEPS above: 8 = task picker entry, 9 = type filters, 10 = difficulty
// filters, 11 = description preview. Step 12 (the tutor finale) closes
// the modal so the spotlight can reach the right column unobstructed.
const MODAL_STEPS = new Set([8, 9, 10, 11]);

// ---- demo helpers --------------------------------------------------------

async function placeCell() {
  // Cell at the top, centred horizontally. Bulb is placed directly
  // below in placeBulb(), so the two wires drawLoop() adds form
  // matching U-shapes down the left and right — a clean textbook loop
  // rather than a flat horizontal line.
  addComponent('cell', 800, 360);
  await wait(450);
}

async function placeBulb() {
  addComponent('bulb', 800, 640);
  await wait(450);
}

async function drawLoop() {
  const cell = state.components.find(c => c.type === 'cell');
  const bulb = state.components.find(c => c.type === 'bulb');
  if (!cell || !bulb) return;
  await wait(500);
  // Pair like-side terminals so each wire stays on one side of the
  // stack: + (cell left) ↔ a (bulb left), and - (cell right) ↔ b
  // (bulb right). The wires don't cross and the loop reads cleanly.
  pushWire({ compId: cell.id, term: '+' }, { compId: bulb.id, term: 'a' });
  simulate(); render();
  await wait(350);
  pushWire({ compId: cell.id, term: '-' }, { compId: bulb.id, term: 'b' });
  simulate(); render();
  await wait(180);
}

function pushWire(from, to) {
  const wire = { id: 'W' + (state.nextId++), a: from, b: to, path: null };
  state.wires.push(wire);
  const path = routePath(from, to, {
    excludeComps: [from.compId, to.compId].filter(Boolean),
    excludeWires: [wire.id],
  });
  if (path && path.length >= 2) wire.path = path;
}

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

// ---- modal coordination --------------------------------------------------

function ensureModalOpen() {
  const modal = document.getElementById('task-modal');
  if (modal && modal.classList.contains('hidden')) openTaskModal();
}

function ensureModalClosed() {
  const modal = document.getElementById('task-modal');
  if (modal) modal.classList.add('hidden');
}

// ---- overlay/DOM ---------------------------------------------------------

let overlayEl = null;
let svgEl = null;
let svgMaskRect = null;
let emphasisRect = null;
let cardEl = null;
let cardHeadingEl = null;
let cardBodyEl = null;
let progressEl = null;
let backBtn = null;
let nextBtn = null;
let skipBtn = null;
let doneBtn = null;
let currentSelector = null;
let currentPadding = 6;
let currentRadius = 12;
let resizeRaf = 0;

function mountOverlay() {
  // Body-level flag so layout.css can keep the right column visible
  // alongside the task picker during the modal walkthrough — without
  // this, the centred picker covers Professor Volt's panel entirely.
  document.body.classList.add('onboarding-active');
  const root = document.getElementById('onboarding-root') || document.body;
  overlayEl = document.createElement('div');
  overlayEl.className = 'onboarding-overlay';
  overlayEl.innerHTML = `
    <svg class="onboarding-mask" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none">
      <defs>
        <mask id="onb-mask" maskUnits="userSpaceOnUse">
          <rect class="onb-mask-full" x="0" y="0" width="100%" height="100%" fill="white"/>
          <rect class="onb-mask-hole" x="-100" y="-100" width="0" height="0" rx="12" ry="12" fill="black"/>
        </mask>
      </defs>
      <rect class="onb-dim" x="0" y="0" width="100%" height="100%" mask="url(#onb-mask)"/>
      <rect class="onb-emphasize" x="-100" y="-100" width="0" height="0" rx="12" ry="12"/>
    </svg>
    <div class="onboarding-card" role="dialog" aria-live="polite">
      <h3 class="onb-card-heading"></h3>
      <p class="onb-card-body"></p>
      <div class="onb-card-actions">
        <button class="onb-btn onb-back" type="button">← Back</button>
        <div class="onb-progress" aria-hidden="true"></div>
        <button class="onb-btn onb-skip" type="button">Skip tour</button>
        <button class="onb-btn primary onb-next" type="button">Next →</button>
        <button class="onb-btn primary onb-done" type="button">Done ✓</button>
      </div>
    </div>
  `;
  root.appendChild(overlayEl);
  svgEl = overlayEl.querySelector('.onboarding-mask');
  svgMaskRect = overlayEl.querySelector('.onb-mask-hole');
  emphasisRect = overlayEl.querySelector('.onb-emphasize');
  cardEl = overlayEl.querySelector('.onboarding-card');
  cardHeadingEl = overlayEl.querySelector('.onb-card-heading');
  cardBodyEl = overlayEl.querySelector('.onb-card-body');
  progressEl = overlayEl.querySelector('.onb-progress');
  backBtn = overlayEl.querySelector('.onb-back');
  nextBtn = overlayEl.querySelector('.onb-next');
  skipBtn = overlayEl.querySelector('.onb-skip');
  doneBtn = overlayEl.querySelector('.onb-done');
  syncSvgSize();
  window.addEventListener('resize', onResize);
  window.addEventListener('scroll', onResize, true);
}

function unmountOverlay() {
  document.body.classList.remove('onboarding-active');
  // Belt-and-braces: any glossary tooltips left up by a step's onShow
  // (palette or canvas) are dismissed before the overlay disappears.
  hidePaletteTooltip();
  hideComponentGlossary();
  window.removeEventListener('resize', onResize);
  window.removeEventListener('scroll', onResize, true);
  overlayEl?.remove();
  overlayEl = svgEl = svgMaskRect = emphasisRect = cardEl = null;
  cardHeadingEl = cardBodyEl = progressEl = null;
  backBtn = nextBtn = skipBtn = doneBtn = null;
}

function syncSvgSize() {
  if (!svgEl) return;
  svgEl.setAttribute('width', String(window.innerWidth));
  svgEl.setAttribute('height', String(window.innerHeight));
}

function onResize() {
  if (resizeRaf) cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(() => {
    syncSvgSize();
    if (currentSelector) applySpotlightFromSelector(currentSelector, currentPadding, currentRadius);
  });
}

function applySpotlightFromSelector(selector, padding, radius) {
  if (!selector) {
    setSpotlightRect(null);
    cardEl?.classList.add('centered');
    cardEl?.classList.remove('left', 'right');
    return;
  }
  const el = document.querySelector(selector);
  if (!el) {
    setSpotlightRect(null);
    cardEl?.classList.add('centered');
    cardEl?.classList.remove('left', 'right');
    return;
  }
  const r = el.getBoundingClientRect();
  setSpotlightRect({
    x: r.left - padding,
    y: r.top - padding,
    width: r.width + padding * 2,
    height: r.height + padding * 2,
  }, radius);
  positionCard(r);
}

function setSpotlightRect(rect, radius = 12) {
  if (!svgMaskRect) return;
  if (!rect) {
    svgMaskRect.setAttribute('x', '-100');
    svgMaskRect.setAttribute('y', '-100');
    svgMaskRect.setAttribute('width', '0');
    svgMaskRect.setAttribute('height', '0');
    return;
  }
  svgMaskRect.setAttribute('x', String(rect.x));
  svgMaskRect.setAttribute('y', String(rect.y));
  svgMaskRect.setAttribute('width', String(Math.max(0, rect.width)));
  svgMaskRect.setAttribute('height', String(Math.max(0, rect.height)));
  svgMaskRect.setAttribute('rx', String(radius));
  svgMaskRect.setAttribute('ry', String(radius));
}

function setEmphasis(selector) {
  if (!emphasisRect) return;
  if (!selector) {
    emphasisRect.setAttribute('width', '0');
    emphasisRect.setAttribute('height', '0');
    emphasisRect.classList.remove('show');
    return;
  }
  const el = document.querySelector(selector);
  if (!el) return;
  const r = el.getBoundingClientRect();
  emphasisRect.setAttribute('x', String(r.left - 4));
  emphasisRect.setAttribute('y', String(r.top - 4));
  emphasisRect.setAttribute('width', String(r.width + 8));
  emphasisRect.setAttribute('height', String(r.height + 8));
  emphasisRect.classList.add('show');
}

function positionCard(targetRect) {
  if (!cardEl) return;
  cardEl.classList.remove('centered', 'left', 'right', 'top', 'bottom');
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  // When the task picker modal is open it covers the centre of the screen,
  // so a left/right anchored card lands on top of task rows. Switch to a
  // top/bottom layout that floats above or below the modal contents.
  const modal = document.getElementById('task-modal');
  const modalOpen = !!(modal && !modal.classList.contains('hidden'));
  if (modalOpen) {
    const targetCenterY = targetRect.top + targetRect.height / 2;
    cardEl.classList.add(targetCenterY < vh / 2 ? 'bottom' : 'top');
    return;
  }
  const targetCenterX = targetRect.left + targetRect.width / 2;
  cardEl.classList.add(targetCenterX < vw / 2 ? 'right' : 'left');
}

// ---- step rendering ------------------------------------------------------

function showStep(step, idx, total) {
  return new Promise((resolve) => {
    let resolved = false;
    let stageTimer = 0;
    const finish = (action) => {
      if (resolved) return;
      resolved = true;
      if (stageTimer) clearTimeout(stageTimer);
      resolve(action);
    };

    const buttons = step.buttons || ['back', 'next', 'skip'];
    backBtn.style.display = buttons.includes('back') ? '' : 'none';
    nextBtn.style.display = buttons.includes('next') ? '' : 'none';
    skipBtn.style.display = buttons.includes('skip') ? '' : 'none';
    doneBtn.style.display = buttons.includes('done') ? '' : 'none';
    nextBtn.textContent = step.nextLabel || 'Next →';
    nextBtn.disabled = false;
    doneBtn.disabled = false;

    progressEl.innerHTML = '';
    for (let i = 0; i < total; i++) {
      const dot = document.createElement('span');
      dot.className = 'onb-dot' + (i === idx ? ' active' : '') + (i < idx ? ' done' : '');
      progressEl.appendChild(dot);
    }

    backBtn.onclick = () => finish('back');
    nextBtn.onclick = () => finish('next');
    skipBtn.onclick = () => finish('skip');
    doneBtn.onclick = () => finish('done');

    const padding = step.spotlightOpts?.padding ?? 6;
    const radius = step.spotlightOpts?.radius ?? 12;
    currentPadding = padding;
    currentRadius = radius;

    if (step.stages && step.stages.length) {
      doneBtn.disabled = true;
      runStages(step.stages, padding, radius, () => resolved).then(() => {
        if (!resolved) doneBtn.disabled = false;
      });
    } else {
      cardHeadingEl.textContent = step.heading;
      setBody(cardBodyEl, step.body);
      setEmphasis(null);
      currentSelector = step.selector;
      applySpotlightFromSelector(step.selector, padding, radius);

      if (typeof step.enableNextAfter === 'number' && nextBtn.style.display !== 'none') {
        nextBtn.disabled = true;
        stageTimer = setTimeout(() => { if (!resolved) nextBtn.disabled = false; }, step.enableNextAfter);
      }
    }

    // Per-step demo hook (e.g. step 1 floats a palette tooltip to show
    // off the hover-glossary). Fires after the spotlight has been
    // applied so positioning is settled.
    if (typeof step.onShow === 'function') {
      try { step.onShow(); } catch (err) { console.error('Onboarding onShow failed:', err); }
    }
  });
}

async function runStages(stages, padding, radius, isDone) {
  for (let s = 0; s < stages.length; s++) {
    if (isDone()) return;
    const stage = stages[s];
    cardHeadingEl.textContent = stage.heading;
    setBody(cardBodyEl, stage.body);
    currentSelector = stage.selector;
    applySpotlightFromSelector(stage.selector, padding, radius);
    setEmphasis(stage.emphasize || null);
    if (s < stages.length - 1) {
      await wait(stage.dwell || 1200);
    }
  }
}

function setBody(el, text) {
  // Tiny-markdown: **bold** only. Everything else is escaped.
  const escaped = String(text).replace(/[&<>]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;' }[c]));
  el.innerHTML = escaped.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
}

// ---- orchestrator --------------------------------------------------------

async function runTour() {
  mountOverlay();
  // Allow CSS transition to fade the overlay in.
  requestAnimationFrame(() => overlayEl?.classList.add('visible'));

  let i = 0;
  while (i >= 0 && i < STEPS.length) {
    const step = STEPS[i];

    if (MODAL_STEPS.has(i)) ensureModalOpen();
    else ensureModalClosed();

    // Defensive cleanup so tooltips left up by hover or by the
    // previous step's onShow don't bleed into the new step.
    hidePaletteTooltip();
    hideComponentGlossary();

    // Wait one frame so any layout change from open/close settles before measure.
    await new Promise(r => requestAnimationFrame(r));

    const action = await showStep(step, i, STEPS.length);

    // Per-step teardown hook — fires regardless of which button was
    // clicked. Lets a step that opened a tooltip etc. clean up before
    // we move on or tear down the overlay.
    if (typeof step.onLeave === 'function') {
      try { step.onLeave(); } catch (err) { console.error('Onboarding onLeave failed:', err); }
    }

    if (action === 'skip') {
      try {
        clearCircuit();
        state.history = []; state.future = [];
      } catch { /* ignore */ }
      ensureModalOpen();
      await fadeOut();
      return;
    }
    if (action === 'done') {
      ensureModalOpen();
      await fadeOut();
      return;
    }
    if (action === 'back') {
      i = Math.max(0, i - 1);
      continue;
    }
    // 'next'
    if (step.afterNext) {
      nextBtn.disabled = true;
      try { await step.afterNext(); }
      catch (err) { console.error('Onboarding afterNext failed:', err); }
    }
    i++;
  }
  ensureModalOpen();
  await fadeOut();
}

async function fadeOut() {
  overlayEl?.classList.add('fading');
  await wait(280);
  unmountOverlay();
}
