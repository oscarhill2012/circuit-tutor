// Task engine: loads the ordered task list from frontend/src/data/tasks.json
// at boot. Task selection now happens in a central modal (openTaskModal).
// When a task is picked, the floating #task-widget is populated with the
// card UI, the initial circuit is loaded (for measure tasks), and
// Professor Volt is asked to outline the aim of the task. On completion
// the modal re-opens so the student can choose what to do next.
//
// Supported task types: measure, problem, scenario, exploration.
// The scenario checker supports three modes, selected by successCriteria:
//   - ammeter_mode/voltmeter_mode: meter-placement check
//   - fault: break_in_loop detection
//   - verify_ohms_law: full build-and-verify — requires a named ammeter and
//     voltmeter correctly placed on a target component, with current,
//     voltage and inferred R = V/I all matching expected values within tol.

import { state } from '../state/store.js';
import { askTutorAbout } from '../tutor/api.js';
import { loadInitialCircuit } from '../state/actions.js';
import { appendTutorMsg } from '../ui/tutorPanel.js';

export const TASKS = [];

// null = sandbox mode (no active task)
let activeTaskId = null;

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

function setActiveTask(taskId) {
  activeTaskId = taskId;
  if (taskId) {
    const idx = TASKS.findIndex(t => t.id === taskId);
    if (idx >= 0) state.currentTaskIndex = idx;
  }
}

// --- Task picker state (local to the modal) -------------------------------
const pickerFilters = { type: 'all', difficulty: 'all', search: '', recommendedOnly: false };
let selectedPreviewId = null;
let pickerWired = false;

function taskTitle(t) {
  return t.data.brief || t.data.question || t.data.challenge || t.data.concept || t.id;
}

const DIFFICULTY_ORDER = ['beginner', 'intermediate', 'advanced', 'expert'];
function normDifficulty(d) {
  const s = String(d || '').toLowerCase();
  return DIFFICULTY_ORDER.includes(s) ? s : s;
}

const TYPE_LABEL = { measure: 'Measure', problem: 'Problem', scenario: 'Scenario', exploration: 'Explore' };

function recommendedTaskId() {
  // The next incomplete task in natural order — simple heuristic that matches
  // the curriculum ordering already baked into tasks.json.
  const next = TASKS.find(t => !state.tasksCompleted.has(t.id));
  return next ? next.id : null;
}

function matchesFilters(t, recId) {
  if (pickerFilters.type !== 'all' && t.type !== pickerFilters.type) return false;
  if (pickerFilters.difficulty !== 'all' && normDifficulty(t.difficulty) !== pickerFilters.difficulty) return false;
  if (pickerFilters.recommendedOnly && t.id !== recId) return false;
  const q = pickerFilters.search.trim().toLowerCase();
  if (q) {
    const hay = [t.id, t.topicName, t.topicId, taskTitle(t)].join(' ').toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

function renderProgress() {
  const total = TASKS.length;
  const done = TASKS.filter(t => state.tasksCompleted.has(t.id)).length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const fill = document.getElementById('tp-progress-fill');
  const label = document.getElementById('tp-progress-label');
  const pctEl = document.getElementById('tp-progress-pct');
  if (fill) fill.style.width = pct + '%';
  if (label) label.textContent = `${done} / ${total} complete`;
  if (pctEl) pctEl.textContent = pct + '%';
}

function renderGroups() {
  const host = document.getElementById('tp-groups');
  host.innerHTML = '';
  const recId = recommendedTaskId();

  // Group by topicName (falls back to topicId).
  const groups = new Map();
  for (const t of TASKS) {
    if (!matchesFilters(t, recId)) continue;
    const key = t.topicName || t.topicId || 'Other';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }

  if (groups.size === 0) {
    host.innerHTML = `<div class="tp-empty">No tasks match those filters. Clear the search or pick a different type / level.</div>`;
    return;
  }

  for (const [topic, items] of groups) {
    const completed = items.filter(t => state.tasksCompleted.has(t.id)).length;
    const section = document.createElement('details');
    section.className = 'tp-group';
    section.open = true;
    const itemsHtml = items.map(t => {
      const done = state.tasksCompleted.has(t.id);
      const rec  = t.id === recId;
      const sel  = t.id === selectedPreviewId;
      return `<button class="tp-item${done ? ' done' : ''}${sel ? ' selected' : ''}${rec ? ' recommended' : ''}" data-task-id="${escapeHtml(t.id)}">
        <span class="tp-item-title">${escapeHtml(shorten(taskTitle(t), 80))}</span>
        <span class="tp-item-meta">
          <span class="tp-badge tp-badge-type">${escapeHtml(TYPE_LABEL[t.type] || t.type)}</span>
          <span class="tp-badge tp-badge-diff diff-${escapeHtml(normDifficulty(t.difficulty))}">${escapeHtml(t.difficulty)}</span>
          ${rec ? '<span class="tp-badge tp-badge-rec">★ next</span>' : ''}
          ${done ? '<span class="tp-badge tp-badge-done">✓ done</span>' : ''}
        </span>
      </button>`;
    }).join('');

    section.innerHTML = `
      <summary class="tp-group-head">
        <span class="tp-group-caret"></span>
        <span class="tp-group-title">${escapeHtml(topic)}</span>
        <span class="tp-group-count">${completed} / ${items.length}</span>
      </summary>
      <div class="tp-group-items">${itemsHtml}</div>
    `;
    host.appendChild(section);
  }

  host.querySelectorAll('.tp-item').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedPreviewId = btn.dataset.taskId;
      renderGroups();
      renderPreview();
    });
    btn.addEventListener('dblclick', () => startTask(btn.dataset.taskId));
  });
}

function renderPreview() {
  const el = document.getElementById('tp-preview');
  if (!selectedPreviewId) {
    el.innerHTML = `<div class="tp-preview-empty">Select a task on the left to see what it involves.</div>`;
    return;
  }
  const t = TASKS.find(x => x.id === selectedPreviewId);
  if (!t) { el.innerHTML = ''; return; }
  const done = state.tasksCompleted.has(t.id);
  const title = taskTitle(t);

  let detailsHtml = '';
  if (t.type === 'measure') {
    const pinned = (t.data.initial?.components || []).map(c => c.id).join(', ');
    detailsHtml = `
      <p>${escapeHtml(title)}</p>
      <dl class="tp-kv">
        ${pinned ? `<dt>Pinned</dt><dd>${escapeHtml(pinned)}</dd>` : ''}
        <dt>Target meter</dt><dd>${escapeHtml(t.data.targetMeter || '—')} (${escapeHtml(t.data.targetUnit || '')})</dd>
      </dl>`;
  } else if (t.type === 'problem') {
    detailsHtml = `<p>${escapeHtml(t.data.question || title)}</p>`;
  } else if (t.type === 'scenario') {
    detailsHtml = `<p>${escapeHtml(t.data.challenge || title)}</p>
      ${t.data.narrative ? `<p class="tp-muted">${escapeHtml(t.data.narrative)}</p>` : ''}`;
  } else if (t.type === 'exploration') {
    detailsHtml = `<p>${escapeHtml(t.data.concept || title)}</p>
      ${t.data.guidedQuestions?.length
        ? `<ul class="tp-guide">${t.data.guidedQuestions.slice(0, 3).map(q => `<li>${escapeHtml(q)}</li>`).join('')}</ul>`
        : ''}`;
  }

  el.innerHTML = `
    <div class="tp-preview-head">
      <span class="tp-badge tp-badge-type">${escapeHtml(TYPE_LABEL[t.type] || t.type)}</span>
      <span class="tp-badge tp-badge-diff diff-${escapeHtml(normDifficulty(t.difficulty))}">${escapeHtml(t.difficulty)}</span>
      ${done ? '<span class="tp-badge tp-badge-done">✓ done</span>' : ''}
    </div>
    <h3 class="tp-preview-topic">${escapeHtml(t.topicName || t.topicId)}</h3>
    <div class="tp-preview-body">${detailsHtml}</div>
    <div class="tp-preview-cta">
      <button class="primary" id="tp-start-btn">${done ? 'Revisit task' : 'Start task'}</button>
    </div>
  `;
  const btn = el.querySelector('#tp-start-btn');
  if (btn) btn.onclick = () => startTask(t.id);
}

function shorten(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function wirePickerOnce() {
  if (pickerWired) return;
  pickerWired = true;

  const search = document.getElementById('tp-search');
  search.addEventListener('input', () => {
    pickerFilters.search = search.value;
    renderGroups();
  });

  document.querySelectorAll('.tp-filter-group').forEach(group => {
    const filterKey = group.dataset.filter;
    group.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => {
        group.querySelectorAll('button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        pickerFilters[filterKey] = btn.dataset.val;
        renderGroups();
      });
    });
  });

  const recBtn = document.getElementById('tp-recommended-btn');
  recBtn.addEventListener('click', () => {
    pickerFilters.recommendedOnly = !pickerFilters.recommendedOnly;
    recBtn.classList.toggle('active', pickerFilters.recommendedOnly);
    if (pickerFilters.recommendedOnly) {
      selectedPreviewId = recommendedTaskId();
      renderPreview();
    }
    renderGroups();
  });
}

export function openTaskModal() {
  const modal = document.getElementById('task-modal');
  wirePickerOnce();
  // Default the preview to the recommended task so the user immediately sees
  // where to start rather than an empty right pane.
  if (!selectedPreviewId || !TASKS.find(t => t.id === selectedPreviewId)) {
    selectedPreviewId = recommendedTaskId();
  }
  renderProgress();
  renderGroups();
  renderPreview();
  modal.classList.remove('hidden');
}

export function closeTaskModal() {
  document.getElementById('task-modal').classList.add('hidden');
}

function hideTaskWidget() {
  document.getElementById('task-widget').classList.add('hidden');
}
function showTaskWidget(titleText) {
  document.getElementById('task-widget').classList.remove('hidden');
  document.getElementById('task-widget-title').textContent = titleText;
}

export function enterSandbox() {
  setActiveTask(null);
  hideTaskWidget();
  closeTaskModal();
  appendTutorMsg({
    reply_type: 'direct_explanation',
    assistant_text: "You're in sandbox mode — build whatever you like. Feel free to ask any questions if you find anything interesting or confusing you'd like to discuss.",
  });
}

export function startTask(taskId) {
  const t = TASKS.find(x => x.id === taskId);
  if (!t) return;
  setActiveTask(taskId);
  closeTaskModal();
  // Both measure and scenario tasks may pre-load an initial circuit (pinned
  // components) so the learner just has to wire them up correctly.
  if ((t.type === 'measure' || t.type === 'scenario')
      && t.data.initial
      && state.loadedTaskId !== t.id) {
    loadInitialCircuit(t.data.initial, t.id);
  }
  showTaskWidget(`${t.topicName} · ${t.difficulty}`);
  renderTask();
  introduceTask(t);
}

// Seed Professor Volt with the task aim. This is NOT a Socratic question —
// it simply states the goal so the student knows what they're working on.
// Further replies from the tutor remain Socratic.
function introduceTask(t) {
  let text = '';
  if (t.type === 'measure') {
    text = `New task — **${t.topicName}** (${t.difficulty}).\n\nAim: ${t.data.brief}\n\nBuild the circuit, then tell me the reading or ask for a hint if you get stuck.`;
  } else if (t.type === 'problem') {
    text = `New task — **${t.topicName}** (${t.difficulty}).\n\nAim: work out the answer to this question — ${t.data.question}\n\nPick an option in the task panel when you're ready, or ask me for a hint.`;
  } else if (t.type === 'scenario') {
    text = `New task — **${t.topicName}** (${t.difficulty}).\n\nAim: ${t.data.challenge} ${t.data.narrative ? '\n\n' + t.data.narrative : ''}\n\nBuild it and hit "Check my circuit" when you think it's right.`;
  } else if (t.type === 'exploration') {
    const first = (t.data.guidedQuestions && t.data.guidedQuestions[0]) || '';
    text = `New exploration — **${t.topicName}**.\n\nAim: investigate "${t.data.concept}". ${first ? 'Start with this: ' + first : ''}\n\nThere's no single right answer — tell me what you notice.`;
  }
  appendTutorMsg({ reply_type: 'direct_explanation', assistant_text: text });
}

export function renderTask() {
  const card = document.getElementById('task-card');
  if (!activeTaskId) { card.innerHTML = ''; return; }
  const t = TASKS.find(x => x.id === activeTaskId);
  if (!t) { card.innerHTML = ''; return; }

  const done = state.tasksCompleted.has(t.id);

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
        completeTask(t);
        fb.className = 'feedback show good';
        fb.innerHTML = `<b>Correct!</b> ${escapeHtml(t.data.explanation)}`;
      } else if (!matchesActual) {
        fb.className = 'feedback show bad';
        fb.innerHTML = `Your typed value (${userVal.toFixed(2)} ${t.data.targetUnit}) doesn\u2019t match what ${t.data.targetMeter} is showing (${actual.toFixed(2)} ${t.data.targetUnit}). Re-read the meter.`;
      } else {
        fb.className = 'feedback show bad';
        fb.innerHTML = `The meter reads ${actual.toFixed(2)} ${t.data.targetUnit}, but the circuit isn\u2019t what the task asks for. Check the wiring.`;
      }
    };
    document.getElementById('btn-reload-task').onclick = () => loadInitialCircuit(t.data.initial, t.id);
  } else if (t.type === 'problem') {
    const opts = shuffleSeed([t.data.correctAnswer, ...t.data.distractors], t.id);
    card.innerHTML = `
      <div class="pill">${t.topicName} · ${t.difficulty}</div>
      <h4>${escapeHtml(t.data.question)}</h4>
      <div class="mc" id="mc-opts">
        ${opts.map((o) => `<button data-val="${o}">${o} ${t.data.unit}</button>`).join('')}
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
          fb.className = 'feedback show good';
          fb.innerHTML = `<b>Correct!</b> Working:<ol>${t.data.workingSteps.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ol>`;
          completeTask(t);
        } else {
          fb.className = 'feedback show bad';
          fb.innerHTML = `<b>Not quite.</b> Try again, or ask Professor Volt for a hint.`;
          card.querySelectorAll('#mc-opts button').forEach(x => { if (!x.classList.contains('wrong')) x.disabled = false; });
          b.disabled = true;
        }
      };
    });
  } else if (t.type === 'scenario') {
    const pinned = t.data.initial
      ? `<div class="criteria"><b>Pinned:</b> ${t.data.initial.components.map(c => c.id).join(', ')}</div>`
      : '';
    card.innerHTML = `
      <div class="pill">${t.topicName} · ${t.difficulty} · scenario</div>
      <h4>${escapeHtml(t.data.challenge)}</h4>
      <p style="color: var(--muted); font-size: 13px; margin: 6px 0;">${escapeHtml(t.data.narrative)}</p>
      <div class="criteria"><b>Given:</b> ${Object.entries(t.data.parameters || {}).map(([k,v]) => `${k}=${v}`).join(', ')}</div>
      ${pinned}
      <div class="row">
        <button id="btn-check-scenario">Check my circuit</button>
        ${t.data.initial ? '<button class="ghost" id="btn-reload-scenario">Reset task</button>' : ''}
      </div>
      <div class="feedback" id="feedback"></div>
    `;
    document.getElementById('btn-check-scenario').onclick = () => {
      const res = checkScenario(t);
      const fb = document.getElementById('feedback');
      fb.className = 'feedback show ' + (res.ok ? 'good' : 'bad');
      fb.innerHTML = res.message;
      if (res.ok) completeTask(t);
    };
    const rel = document.getElementById('btn-reload-scenario');
    if (rel) rel.onclick = () => loadInitialCircuit(t.data.initial, t.id);
  } else if (t.type === 'exploration') {
    card.innerHTML = `
      <div class="pill">${t.topicName} · exploration</div>
      <h4>${escapeHtml(t.data.concept)}</h4>
      <ol style="color: var(--muted); font-size: 13px; padding-left: 18px;">
        ${t.data.guidedQuestions.map(q => `<li style="margin-bottom:4px">${escapeHtml(q)}</li>`).join('')}
      </ol>
      <div class="row">
        <button id="btn-mark-done">Mark as explored</button>
      </div>
    `;
    document.getElementById('btn-mark-done').onclick = () => completeTask(t);
  }
  if (done) {
    const fb = card.querySelector('#feedback');
    if (fb) { fb.className = 'feedback show good'; fb.textContent = '✓ Already completed — feel free to move on.'; }
  }
}

function completeTask(t) {
  state.tasksCompleted.add(t.id);
  // Let the student read the feedback, then reopen the task picker.
  setTimeout(() => {
    hideTaskWidget();
    activeTaskId = null;
    openTaskModal();
  }, 3000);
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
  // Ohm's-law verification scenario. Validates:
  //   - a named ammeter is present, in series (|I| > eps), and reading the
  //     current through the target component (|I_amm - I_target| < tol)
  //   - a named voltmeter is present, in parallel (|I| ~ 0, |V| > eps), and
  //     placed across the target component (|V_volt - V_target| < tol)
  //   - the ammeter reading matches the expected current (within tol)
  //   - the voltmeter reading matches the expected voltage (within tol)
  //   - the inferred resistance R = V / I matches the expected value (within tol)
  if (sc.verify_ohms_law) {
    const ammId   = sc.ammeter;
    const voltId  = sc.voltmeter;
    const tgtId   = sc.target_component;
    const expI    = sc.expected_current;
    const expV    = sc.expected_voltage;
    const expR    = sc.expected_resistance;
    const tolI    = sc.current_tol ?? 0.1;
    const tolV    = sc.voltage_tol ?? 0.2;
    const tolR    = sc.resistance_tol ?? 0.2;

    const amm  = state.components.find(c => c.id === ammId  && c.type === 'ammeter');
    const volt = state.components.find(c => c.id === voltId && c.type === 'voltmeter');
    const tgt  = state.components.find(c => c.id === tgtId);
    if (!amm)  return { ok:false, message:`I can't see ammeter ${ammId} in the circuit.` };
    if (!volt) return { ok:false, message:`I can't see voltmeter ${voltId} in the circuit.` };
    if (!tgt)  return { ok:false, message:`I can't see component ${tgtId} in the circuit.` };
    if (s.isOpen)  return { ok:false, message:'The circuit is open — no current is flowing. Check the wiring.' };
    if (s.isShort) return { ok:false, message:'The circuit is shorted — add the resistor/bulb back into the loop.' };

    const ammEl  = s.elements.find(e => e.comp.id === ammId);
    const voltEl = s.elements.find(e => e.comp.id === voltId);
    const tgtEl  = s.elements.find(e => e.comp.id === tgtId);
    if (!ammEl || !voltEl || !tgtEl) {
      return { ok:false, message:'Some pinned components aren\'t wired into the live circuit yet.' };
    }

    const Iamm  = Math.abs(ammEl.current);
    const Vvolt = Math.abs(voltEl.drop);
    const Ivolt = Math.abs(voltEl.current);
    const Itgt  = Math.abs(tgtEl.current);
    const Vtgt  = Math.abs(tgtEl.drop);

    if (Iamm < 1e-4)   return { ok:false, message:`${ammId} isn't reading any current. An ammeter must be placed <b>in series</b> with ${tgtId}.` };
    if (Ivolt > 1e-3 || Vvolt < 1e-3) {
      return { ok:false, message:`${voltId} isn't correctly placed. A voltmeter must sit <b>in parallel across</b> ${tgtId}.` };
    }
    if (Math.abs(Iamm - Itgt) > tolI) {
      return { ok:false, message:`${ammId} isn't measuring the current through ${tgtId}. Put it <b>in series with ${tgtId}</b>.` };
    }
    if (Math.abs(Vvolt - Vtgt) > tolV) {
      return { ok:false, message:`${voltId} isn't measuring the p.d. across ${tgtId}. Connect it <b>directly across ${tgtId}</b>.` };
    }
    if (Math.abs(Iamm - expI) > tolI) {
      return { ok:false, message:`The current through ${tgtId} should be about ${expI} A, but ${ammId} reads ${Iamm.toFixed(2)} A. Check the circuit.` };
    }
    if (Math.abs(Vvolt - expV) > tolV) {
      return { ok:false, message:`The p.d. across ${tgtId} should be about ${expV} V, but ${voltId} reads ${Vvolt.toFixed(2)} V. Check the circuit.` };
    }
    const inferredR = Vvolt / Iamm;
    if (Math.abs(inferredR - expR) > tolR) {
      return { ok:false, message:`Your readings give R = ${Vvolt.toFixed(2)} / ${Iamm.toFixed(2)} = ${inferredR.toFixed(2)} Ω, which doesn't match the expected ${expR} Ω.` };
    }
    return {
      ok: true,
      message: `<b>Verified.</b> ${ammId} = ${Iamm.toFixed(2)} A, ${voltId} = ${Vvolt.toFixed(2)} V, so R = V / I = ${inferredR.toFixed(2)} Ω ≈ ${expR} Ω. ✔`
    };
  }
  if (sc.fault === 'break_in_loop') {
    if (s.isOpen) return { ok:true, message:'<b>Correct!</b> The circuit is open — no current can flow. Now repair it.' };
    return { ok:false, message:'The circuit is still live. Can you spot the break in the loop? If the circuit is already complete, try creating a break and explaining what happens.' };
  }
  return { ok:false, message:'Keep experimenting — Professor Volt can help.' };
}

export function initTaskControls() {
  document.getElementById('btn-open-tasks').onclick = openTaskModal;
  const btn2 = document.getElementById('btn-open-tasks-2');
  if (btn2) btn2.onclick = openTaskModal;
  document.getElementById('btn-sandbox').onclick = enterSandbox;
}

// Expose so the hint quick-button can ask about the active task only
// (sandbox mode: no task context).
export function getActiveTask() {
  return activeTaskId ? TASKS.find(x => x.id === activeTaskId) : null;
}
