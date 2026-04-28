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
function showTaskWidget() {
  document.getElementById('task-widget').classList.remove('hidden');
}

export function enterSandbox() {
  setActiveTask(null);
  hideTaskWidget();
  closeTaskModal();
  clearChat();
  clearCircuit();
  notifyActiveTaskChange();
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
  // Phase 2 (iter-improv 2026-04-28): all task types are now driven from
  // Professor Volt's panel — the floating top-of-canvas widget is hidden
  // for every task type. The widget DOM stays for legacy reasons (and the
  // canvas tooling that targets the canvas-wrap layer), but renders empty.
  hideTaskWidget();
  renderTask();
  introduceTask(t);
  notifyActiveTaskChange();
}

// Seed Professor Volt with the task aim. This is NOT a Socratic question —
// it simply states the goal so the student knows what they're working on.
// Further replies from the tutor remain Socratic. The intro message starts
// with "AIM:" rather than a "New task — Topic (difficulty)" header so the
// reminder action (which re-runs this) can produce the same shape.
function buildTaskIntro(t) {
  const aim = t.data.description || t.data.brief || '';
  if (t.type === 'measure') {
    return `AIM: ${aim}\n\nBuild the circuit, then tell me the reading or ask for a hint if you get stuck.`;
  }
  if (t.type === 'problem') {
    return `AIM: work out the answer to this question — ${t.data.question}\n\nPick an option in the task panel when you're ready, or ask me for a hint.`;
  }
  if (t.type === 'scenario') {
    return `AIM: ${aim}\n\nBuild it and hit "Check my circuit" when you think it's right.`;
  }
  if (t.type === 'exploration') {
    const first = (t.data.guidedQuestions && t.data.guidedQuestions[0]) || '';
    return `AIM: ${aim}${first ? '\n\nStart with this: ' + first : ''}\n\nThere's no single right answer — tell me what you notice.`;
  }
  return `AIM: ${aim}`;
}

function introduceTask(t) {
  appendTutorMsg({ reply_type: 'direct_explanation', assistant_text: buildTaskIntro(t) });
}

// Re-state the current task aim. Same content as the opening message —
// no "New task — …" header. Wired to the Task-Reminder button in the
// Professor Volt panel.
export function remindActiveTask() {
  const t = getActiveTask();
  if (!t) return;
  appendTutorMsg({ reply_type: 'direct_explanation', assistant_text: buildTaskIntro(t) });
}

export function renderTask() {
  const card = document.getElementById('task-card');
  if (!activeTaskId) { card.innerHTML = ''; return; }
  const t = TASKS.find(x => x.id === activeTaskId);
  if (!t) { card.innerHTML = ''; return; }

  const done = state.tasksCompleted.has(t.id);

  if (t.type === 'measure') {
    // Phase 2 (iter-improv 2026-04-28): measure tasks are now driven entirely
    // from Professor Volt's panel \u2014 the student types their reading in chat
    // and clicks "Check my circuit". The widget renders nothing.
    card.innerHTML = '';
  } else if (t.type === 'problem') {
    const opts = shuffleSeed([t.data.correctAnswer, ...t.data.distractors], t.id);
    card.innerHTML = `
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
    // Scenario tasks are driven entirely from Professor Volt's panel:
    // Check-my-circuit lives there, the description lives in the intro
    // message, the widget is hidden in startTask(). The card stays empty.
    card.innerHTML = '';
  } else if (t.type === 'exploration') {
    // Phase 2 (iter-improv 2026-04-28): exploration tasks use the
    // Check-my-circuit button as "I'm done exploring". The widget is hidden.
    card.innerHTML = '';
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
    notifyActiveTaskChange();
    openTaskModal();
  }, 3000);
}

// Drives the "Check my circuit" button (lives in Professor Volt's panel).
// Phase 2 (iter-improv 2026-04-28) extends the dispatch beyond scenario
// tasks: measure tasks merge a local-deterministic reading check with the
// LLM circuit verdict; exploration tasks complete immediately. Returns the
// final verdict so callers can react; the tutor reply (when the backend is
// involved) is appended to the chat by askTutorCheckScenario.
export async function checkActiveTask() {
  const t = getActiveTask();
  if (!t) return null;

  if (t.type === 'exploration') {
    completeTask(t);
    return 'pass';
  }

  if (t.type === 'measure') {
    const userVal = extractReadingFromChat();
    if (userVal === null) {
      // Fallback: no numeric reading in the latest user message → ask for one.
      // No backend call, no completion — once the student types a number and
      // re-clicks Check, we proceed into validation.
      const meterLabel = t.data.targetMeter || 'the meter';
      const unit = t.data.targetUnit ? ` (in ${t.data.targetUnit})` : '';
      appendTutorMsg({
        reply_type: 'direct_explanation',
        assistant_text: `What reading did you get from ${meterLabel}${unit}? Type the number in the chat and I'll check it.`,
      });
      return null;
    }
    const reading = validateMeasureReading(t, userVal);
    const { verdict } = await askTutorCheckScenario(t, {
      claimed_reading: userVal,
      simulated_reading: (reading.actual !== undefined && reading.actual !== null) ? reading.actual : null,
      reading_status: reading.status,
      target_meter: t.data.targetMeter,
      target_unit: t.data.targetUnit,
      expected: t.data.correctAnswer,
      tolerance: t.data.tolerance,
    });
    // Local arithmetic check is authoritative for the reading; LLM verdict is
    // authoritative for the topology. Both must pass for the task to count.
    const finalVerdict = (verdict === 'pass' && reading.status === 'correct') ? 'pass' : 'fail';
    if (finalVerdict === 'pass') completeTask(t);
    return finalVerdict;
  }

  if (t.type === 'scenario') {
    const { verdict } = await askTutorCheckScenario(t);
    if (verdict === 'pass') completeTask(t);
    return verdict;
  }

  return null;
}

// Local-deterministic measure-task validator. Returns the simulation's actual
// meter reading and a status string consumed by both the verdict-merge logic
// in checkActiveTask() and the LLM prompt suffix on the backend (so the model
// can address the reading without re-doing the arithmetic).
function validateMeasureReading(t, userVal) {
  if (!isFinite(userVal)) return { status: 'not_a_number' };
  const sim = state.sim;
  const meter = state.components.find(c => c.id === t.data.targetMeter);
  const simEl = sim && sim.ok && !sim.empty ? sim.elementByCompId.get(t.data.targetMeter) : null;
  if (!meter || !simEl) return { status: 'meter_missing' };
  if (sim.isShort) return { status: 'shorted' };
  if (sim.isOpen) return { status: 'open' };
  const actual = meter.type === 'ammeter' ? Math.abs(simEl.current) : Math.abs(simEl.drop);
  const matchesActual = Math.abs(userVal - actual) < 0.05;
  const matchesExpected = Math.abs(actual - t.data.correctAnswer) < t.data.tolerance;
  if (matchesActual && matchesExpected) return { status: 'correct', actual };
  if (!matchesActual) return { status: 'wrong_value', actual };
  return { status: 'wrong_circuit', actual };
}

// Walk state.messages backwards for the most recent student-typed numeric
// reading. The auto-generated "Please check my circuit — …" turn that
// askTutorCheckScenario pushes is skipped (otherwise a re-click of the
// Check button would treat the auto-message as "the latest student turn"
// and either find no number or accidentally pick up a numeric token from
// the task brief). Returns null if no genuine student turn carries a number.
const _AUTO_CHECK_PREFIX = "Please check my circuit";
function extractReadingFromChat() {
  for (let i = state.messages.length - 1; i >= 0; i--) {
    const m = state.messages[i];
    if (m.role !== 'user') continue;
    const text = String(m.content || '');
    if (text.startsWith(_AUTO_CHECK_PREFIX)) continue;
    const match = text.match(/-?\d+(?:\.\d+)?/);
    if (match) return parseFloat(match[0]);
    // Found a genuine (non-auto) student turn with no number → caller
    // should fall back to asking. Don't keep walking past it.
    return null;
  }
  return null;
}

// Active-task change notifications. The tutor panel uses this to enable
// or disable the Task-Reminder and Check-my-circuit buttons depending on
// whether a task is active (and whether it is a scenario task).
const activeTaskListeners = new Set();
export function onActiveTaskChange(fn) {
  activeTaskListeners.add(fn);
  // Fire once with the current state so the listener can render itself
  // immediately rather than waiting for the next change.
  try { fn(getActiveTask()); } catch {}
  return () => activeTaskListeners.delete(fn);
}
function notifyActiveTaskChange() {
  const t = getActiveTask();
  for (const fn of activeTaskListeners) {
    try { fn(t); } catch {}
  }
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
