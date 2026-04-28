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
import { askTutorCheckScenario } from '../tutor/api.js';
import { loadInitialCircuit, clearCircuit } from '../state/actions.js';
import { appendTutorMsg, clearChat } from '../ui/tutorPanel.js';

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
}

// --- Task picker state (local to the modal) -------------------------------
const pickerFilters = { type: 'all', difficulty: 'all', search: '', recommendedOnly: false };
let selectedPreviewId = null;
let pickerWired = false;

function taskTitle(t) {
  return t.data.brief || t.data.question || t.id;
}

function normDifficulty(d) {
  return String(d || '').toLowerCase();
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

  // Preview body: `description` is the goal-focused paragraph (what the
  // student is trying to do, without prescribing wiring or formulas).
  // `brief` is the short premise that already labels the button on the left,
  // so we don't repeat it here. Exploration tasks additionally tease the
  // first three guided questions so the student knows what they'll investigate.
  const desc = t.data.description || t.data.brief || title;
  let detailsHtml = `<p>${escapeHtml(desc)}</p>`;
  if (t.type === 'exploration' && t.data.guidedQuestions?.length) {
    detailsHtml += `<ul class="tp-guide">${t.data.guidedQuestions.slice(0, 3).map(q => `<li>${escapeHtml(q)}</li>`).join('')}</ul>`;
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
  clearChat();
  clearCircuit();
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
  // Fresh task = fresh chat + fresh canvas. The previous task's wiring
  // and tutor context would otherwise confuse both the student and
  // Professor Volt on the new problem.
  clearChat();
  if ((t.type === 'measure' || t.type === 'scenario') && t.data.initial) {
    loadInitialCircuit(t.data.initial, t.id);
  } else {
    clearCircuit();
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
  const header = `New task — **${t.topicName}** (${t.difficulty}).`;
  const aim = t.data.description || t.data.brief || '';
  if (t.type === 'measure') {
    text = `${header}\n\nAim: ${aim}\n\nBuild the circuit, then tell me the reading or ask for a hint if you get stuck.`;
  } else if (t.type === 'problem') {
    text = `${header}\n\nAim: work out the answer to this question — ${t.data.question}\n\nPick an option in the task panel when you're ready, or ask me for a hint.`;
  } else if (t.type === 'scenario') {
    text = `${header}\n\nAim: ${aim}\n\nBuild it and hit "Check my circuit" when you think it's right.`;
  } else if (t.type === 'exploration') {
    const first = (t.data.guidedQuestions && t.data.guidedQuestions[0]) || '';
    text = `New exploration — **${t.topicName}**.\n\n${aim}${first ? '\n\nStart with this: ' + first : ''}\n\nThere's no single right answer — tell me what you notice.`;
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
      <div class="pill">Build &amp; measure</div>
      <p class="task-desc">${escapeHtml(t.data.description || t.data.brief || '')}</p>
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
      const simEl = sim && sim.ok && !sim.empty ? sim.elementByCompId.get(t.data.targetMeter) : null;
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
        fb.innerHTML = `<b>Correct!</b> ${actual.toFixed(2)} ${escapeHtml(t.data.targetUnit)} matches the expected reading.`;
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
      <div class="pill">Problem</div>
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
    card.innerHTML = `
      <div class="pill">Scenario</div>
      <p class="task-desc">${escapeHtml(t.data.description || t.data.brief || '')}</p>
      <div class="row">
        <button id="btn-check-scenario">Check my circuit</button>
        ${t.data.initial ? '<button class="ghost" id="btn-reload-scenario">Reset task</button>' : ''}
      </div>
      <div class="feedback" id="feedback"></div>
    `;
    document.getElementById('btn-check-scenario').onclick = async () => {
      const fb = document.getElementById('feedback');
      const btn = document.getElementById('btn-check-scenario');
      btn.disabled = true;
      fb.className = 'feedback show';
      fb.textContent = 'Asking Professor Volt to review your circuit…';
      try {
        const { verdict, reply } = await askTutorCheckScenario(t);
        const passed = verdict === 'pass';
        fb.className = 'feedback show ' + (passed ? 'good' : 'bad');
        const msg = reply && reply.assistant_text ? reply.assistant_text : '';
        fb.innerHTML = passed
          ? `<b>Approved by Professor Volt.</b> ${escapeHtml(msg)}`
          : (msg ? escapeHtml(msg) : 'Not quite — check Professor Volt\'s reply in the chat.');
        if (passed) completeTask(t);
      } finally {
        btn.disabled = false;
      }
    };
    const rel = document.getElementById('btn-reload-scenario');
    if (rel) rel.onclick = () => loadInitialCircuit(t.data.initial, t.id);
  } else if (t.type === 'exploration') {
    const questions = t.data.guidedQuestions || [];
    card.innerHTML = `
      <div class="pill">Exploration</div>
      <p class="task-desc">${escapeHtml(t.data.description || t.data.brief || '')}</p>
      ${questions.length ? `<ol style="color: var(--muted); font-size: 13px; padding-left: 18px;">
        ${questions.map(q => `<li style="margin-bottom:4px">${escapeHtml(q)}</li>`).join('')}
      </ol>` : ''}
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
