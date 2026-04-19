// Task engine: loads the ordered task list from frontend/src/data/tasks.json
// at boot, then renders the current task card into the right-hand panel.
// Supported task types: measure (build-and-read a meter), problem (multiple
// choice), scenario (check circuit against criteria), exploration (free).

import { state } from '../state/store.js';
import { askTutorAbout } from '../tutor/api.js';
import { loadInitialCircuit } from '../state/actions.js';

export const TASKS = [];

export async function loadTasks() {
  const res = await fetch('./src/data/tasks.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Failed to load tasks.json (${res.status})`);
  const data = await res.json();
  TASKS.length = 0;
  for (const t of data.tasks) TASKS.push(t);
  return TASKS;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function shuffleSeed(arr, seed) {
  let h = 0; for (const ch of seed) h = (h*31 + ch.charCodeAt(0)) & 0xffff;
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    h = (h * 9301 + 49297) % 233280;
    const j = h % (i+1);
    [a[i],a[j]] = [a[j],a[i]];
  }
  return a;
}

function updateProgressBar() {
  const el = document.getElementById('prog-bar');
  if (el && TASKS.length) el.style.width = (state.tasksCompleted.size / TASKS.length * 100) + '%';
}

export function renderTask() {
  const card = document.getElementById('task-card');
  const t = TASKS[state.currentTaskIndex];
  if (!t) { card.innerHTML = '<p>No tasks.</p>'; return; }

  if (t.type === 'measure' && state.loadedTaskId !== t.id) {
    loadInitialCircuit(t.data.initial, t.id);
  }

  const done = state.tasksCompleted.has(t.id);
  updateProgressBar();

  if (t.type === 'measure') {
    card.innerHTML = `
      <div class="pill">${t.topicName} \u00b7 ${t.difficulty} \u00b7 build &amp; measure</div>
      <h4>${escapeHtml(t.data.brief)}</h4>
      <div class="criteria"><b>Pinned:</b> ${t.data.initial.components.map(c => c.id).join(', ')} \u00b7 <b>Read:</b> ${t.data.targetMeter}</div>
      <div class="row" style="align-items:center; gap:8px;">
        <label style="font-size:13px; color:var(--muted);">Your ${t.data.targetMeter} reading:</label>
        <input id="measure-input" type="number" step="0.01" style="width:90px; padding:4px 6px; background:var(--panel-2); color:var(--text); border:1px solid var(--line); border-radius:4px;" />
        <span style="color:var(--muted);">${t.data.targetUnit}</span>
      </div>
      <div class="row">
        <button id="btn-check-measure">Check answer</button>
        <button class="ghost" id="btn-reload-task">Reset task</button>
        <button class="ghost" id="btn-hint">Hint</button>
        <button class="ghost" id="btn-ask-tutor">Ask Professor Volt</button>
      </div>
      <div class="feedback" id="feedback"></div>
    `;
    document.getElementById('btn-check-measure').onclick = () => {
      const fb = document.getElementById('feedback');
      const input = document.getElementById('measure-input');
      const userVal = parseFloat(input.value);
      if (!isFinite(userVal)) {
        fb.className = 'feedback show bad';
        fb.textContent = 'Enter the reading shown on ' + t.data.targetMeter + '.';
        return;
      }
      const sim = state.sim;
      const meter = state.components.find(c => c.id === t.data.targetMeter);
      const simEl = sim && sim.ok && !sim.empty ? sim.elements.find(e => e.comp && e.comp.id === t.data.targetMeter) : null;
      if (!meter || !simEl) {
        fb.className = 'feedback show bad';
        fb.textContent = 'I can\u2019t see ' + t.data.targetMeter + ' in the circuit yet \u2014 add it or connect it.';
        return;
      }
      if (sim.isShort) { fb.className = 'feedback show bad'; fb.textContent = 'The circuit is shorted \u2014 add a bulb or resistor in the loop.'; return; }
      if (sim.isOpen)  { fb.className = 'feedback show bad'; fb.textContent = 'The circuit is open \u2014 check for a missing wire.'; return; }

      const actual = meter.type === 'ammeter' ? Math.abs(simEl.current) : Math.abs(simEl.drop);
      const matchesActual = Math.abs(userVal - actual) < 0.05;
      const matchesExpected = Math.abs(actual - t.data.correctAnswer) < t.data.tolerance;

      if (matchesActual && matchesExpected) {
        state.tasksCompleted.add(t.id);
        fb.className = 'feedback show good';
        fb.innerHTML = `<b>Correct!</b> ${escapeHtml(t.data.explanation)}`;
        updateProgressBar();
      } else if (!matchesActual) {
        fb.className = 'feedback show bad';
        fb.innerHTML = `Your typed value (${userVal.toFixed(2)} ${t.data.targetUnit}) doesn\u2019t match what ${t.data.targetMeter} is showing (${actual.toFixed(2)} ${t.data.targetUnit}). Re-read the meter.`;
      } else {
        fb.className = 'feedback show bad';
        fb.innerHTML = `The meter reads ${actual.toFixed(2)} ${t.data.targetUnit}, but the circuit isn\u2019t what the task asks for. Check the wiring.`;
      }
    };
    document.getElementById('btn-reload-task').onclick = () => loadInitialCircuit(t.data.initial, t.id);
    document.getElementById('btn-hint').onclick = () => {
      const fb = document.getElementById('feedback');
      fb.className = 'feedback show';
      fb.textContent = t.data.hint;
    };
    document.getElementById('btn-ask-tutor').onclick = () => askTutorAbout(`I\u2019m on this build task: ${t.data.brief}`);
  } else if (t.type === 'problem') {
    const opts = shuffleSeed([t.data.correctAnswer, ...t.data.distractors], t.id);
    card.innerHTML = `
      <div class="pill">${t.topicName} · ${t.difficulty}</div>
      <h4>${escapeHtml(t.data.question)}</h4>
      <div class="mc" id="mc-opts">
        ${opts.map((o,i) => `<button data-val="${o}">${o} ${t.data.unit}</button>`).join('')}
      </div>
      <div class="row">
        <button class="ghost" id="btn-hint">Hint</button>
        <button class="ghost" id="btn-ask-tutor">Ask Professor Volt</button>
      </div>
      <div class="feedback" id="feedback"></div>
    `;
    card.querySelectorAll('#mc-opts button').forEach(b => {
      b.onclick = () => {
        const val = parseFloat(b.dataset.val);
        const correct = Math.abs(val - t.data.correctAnswer) < 0.01;
        card.querySelectorAll('#mc-opts button').forEach(x => x.disabled = true);
        b.classList.add(correct ? 'correct' : 'wrong');
        const fb = document.getElementById('feedback');
        if (correct) {
          state.tasksCompleted.add(t.id);
          fb.className = 'feedback show good';
          fb.innerHTML = `<b>Correct!</b> Working:<ol>${t.data.workingSteps.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ol>`;
          updateProgressBar();
        } else {
          fb.className = 'feedback show bad';
          fb.innerHTML = `<b>Not quite.</b> Try again, or ask Professor Volt for a hint.`;
          card.querySelectorAll('#mc-opts button').forEach(x => { if (!x.classList.contains('wrong')) x.disabled = false; });
          b.disabled = true;
        }
      };
    });
    document.getElementById('btn-hint').onclick = () => askTutorAbout(`Give me a small hint for this problem: "${t.data.question}". Don't give me the answer.`);
    document.getElementById('btn-ask-tutor').onclick = () => askTutorAbout(`I'm working on: "${t.data.question}". Can you help me think about it?`);
  } else if (t.type === 'scenario') {
    card.innerHTML = `
      <div class="pill">${t.topicName} · ${t.difficulty} · scenario</div>
      <h4>${escapeHtml(t.data.challenge)}</h4>
      <p style="color: var(--muted); font-size: 13px; margin: 6px 0;">${escapeHtml(t.data.narrative)}</p>
      <div class="criteria"><b>Given:</b> ${Object.entries(t.data.parameters).map(([k,v]) => `${k}=${v}`).join(', ')}</div>
      <div class="row">
        <button id="btn-check-scenario">Check my circuit</button>
        <button class="ghost" id="btn-ask-tutor">Ask Professor Volt</button>
      </div>
      <div class="feedback" id="feedback"></div>
    `;
    document.getElementById('btn-check-scenario').onclick = () => {
      const res = checkScenario(t);
      const fb = document.getElementById('feedback');
      fb.className = 'feedback show ' + (res.ok ? 'good' : 'bad');
      fb.innerHTML = res.message;
      if (res.ok) state.tasksCompleted.add(t.id);
      updateProgressBar();
    };
    document.getElementById('btn-ask-tutor').onclick = () => askTutorAbout(`I'm on this challenge: ${t.data.challenge}. ${t.data.narrative}`);
  } else if (t.type === 'exploration') {
    card.innerHTML = `
      <div class="pill">${t.topicName} · exploration</div>
      <h4>${escapeHtml(t.data.concept)}</h4>
      <ol style="color: var(--muted); font-size: 13px; padding-left: 18px;">
        ${t.data.guidedQuestions.map(q => `<li style="margin-bottom:4px">${escapeHtml(q)}</li>`).join('')}
      </ol>
      <div class="row">
        <button id="btn-mark-done">Mark as explored</button>
        <button class="ghost" id="btn-ask-tutor">Discuss with Professor Volt</button>
      </div>
    `;
    document.getElementById('btn-mark-done').onclick = () => {
      state.tasksCompleted.add(t.id);
      updateProgressBar();
      nextTask();
    };
    document.getElementById('btn-ask-tutor').onclick = () => askTutorAbout(`I'm exploring: ${t.data.concept}. ${t.data.guidedQuestions[0]}`);
  }
  if (done) {
    const fb = card.querySelector('#feedback');
    if (fb) { fb.className = 'feedback show good'; fb.textContent = '✓ Already completed — feel free to move on.'; }
  }
}

function checkScenario(t) {
  const s = state.sim;
  if (!s || s.empty) return { ok: false, message: 'Your circuit is empty. Build something first!' };
  const sc = t.data.successCriteria || {};
  if (sc.ammeter_mode && sc.voltmeter_mode) {
    const bulbs = state.components.filter(c => c.type === 'bulb');
    const amm = state.components.find(c => c.type === 'ammeter');
    const volt = state.components.find(c => c.type === 'voltmeter');
    if (!bulbs.length) return { ok:false, message:'You need a bulb in the circuit.' };
    if (!amm) return { ok:false, message:'You need an ammeter.' };
    if (!volt) return { ok:false, message:'You need a voltmeter.' };
    const ammEl = s.elements.find(e => e.comp.id === amm.id);
    const voltEl = s.elements.find(e => e.comp.id === volt.id);
    const ammOk = ammEl && Math.abs(ammEl.current) > 1e-4;
    const voltOk = voltEl && Math.abs(voltEl.current) < 1e-3 && Math.abs(voltEl.drop) > 1e-3;
    if (ammOk && voltOk) return { ok:true, message:'<b>Great work!</b> Your ammeter is in series (measuring current) and your voltmeter is in parallel across the bulb (measuring p.d.).' };
    if (!ammOk) return { ok:false, message:'Your ammeter isn\'t reading any current. An ammeter must be placed <b>in series</b> with the bulb.' };
    if (!voltOk) return { ok:false, message:'Your voltmeter isn\'t correctly placed. It must be connected <b>in parallel across</b> the bulb.' };
  }
  if (sc.fault === 'break_in_loop') {
    if (s.isOpen) return { ok:true, message:'<b>Correct!</b> The circuit is open — no current can flow. Now repair it.' };
    return { ok:false, message:'The circuit is still live. Can you spot the break in the loop? If the circuit is already complete, try creating a break and explaining what happens.' };
  }
  return { ok:false, message:'Keep experimenting — Professor Volt can help.' };
}

export function nextTask() {
  state.currentTaskIndex = Math.min(TASKS.length - 1, state.currentTaskIndex + 1);
  renderTask();
}
export function prevTask() {
  state.currentTaskIndex = Math.max(0, state.currentTaskIndex - 1);
  renderTask();
}

export function initTaskControls() {
  document.getElementById('btn-next-task').onclick = nextTask;
  document.getElementById('btn-prev-task').onclick = prevTask;
}
