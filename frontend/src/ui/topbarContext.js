// Topbar context chip. Surfaces the active task (type · title · overall
// progress) in the middle of the topbar so the student always knows what
// they're working on without scrolling the tutor chat. Clicking the chip
// opens the task picker — same destination as the explicit "Tasks"
// button on the right, but discoverable from the active context too.

import { state } from '../state/store.js';
import { TASKS, getActiveTask, onActiveTaskChange, openTaskModal } from '../tasks/engine.js';

const TYPE_ICON = {
  measure:     '<path d="M3 12h3l2-7 4 14 2-9 2 5h5"/>',
  problem:     '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 1.5-2.5 2-2.5 4"/><circle cx="12" cy="17" r="0.6" fill="currentColor"/>',
  scenario:    '<path d="M5 4h10l4 4v12H5z"/><path d="M15 4v4h4"/><path d="M9 12h6"/><path d="M9 16h4"/>',
  exploration: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>',
};

const TYPE_LABEL = { measure: 'Measure', problem: 'Problem', scenario: 'Scenario', exploration: 'Explore' };

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function taskTitle(t) {
  return t.data.brief || t.data.question || t.id;
}

function progress() {
  const total = TASKS.length;
  const done = TASKS.filter(x => state.tasksCompleted.has(x.id)).length;
  return { total, done, pct: total ? Math.round((done / total) * 100) : 0 };
}

function progressMarkup({ done, total, pct }) {
  return `
    <span class="chip-progress" aria-label="Overall progress: ${done} of ${total} tasks complete">
      <span class="chip-progress-num">${done}<span class="chip-progress-sep">/</span>${total}</span>
      <span class="chip-progress-bar"><span class="chip-progress-fill" style="width:${pct}%"></span></span>
    </span>`;
}

function render() {
  const el = document.getElementById('topbar-context');
  if (!el) return;
  const t = getActiveTask();
  const p = progress();

  if (!t) {
    el.dataset.state = 'sandbox';
    el.removeAttribute('data-type');
    el.innerHTML = `
      <button class="topbar-chip" id="topbar-chip-btn" type="button" title="Open the task picker">
        <span class="chip-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 3v6L4.5 18a2 2 0 0 0 1.8 3h11.4a2 2 0 0 0 1.8-3L15 9V3"/>
            <path d="M9 3h6"/><path d="M7.5 14h9"/>
          </svg>
        </span>
        <span class="chip-text">
          <span class="chip-eyebrow">Bench</span>
          <span class="chip-title">Sandbox mode</span>
        </span>
        ${progressMarkup(p)}
      </button>
    `;
  } else {
    const type = t.type || 'measure';
    const diff = String(t.difficulty || '').toLowerCase();
    const eyebrow = (TYPE_LABEL[type] || 'Task') + (diff ? ` · ${diff}` : '');
    el.dataset.state = 'active';
    el.dataset.type = type;
    el.innerHTML = `
      <button class="topbar-chip" id="topbar-chip-btn" type="button" title="Switch task">
        <span class="chip-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${TYPE_ICON[type] || TYPE_ICON.measure}</svg>
        </span>
        <span class="chip-text">
          <span class="chip-eyebrow">${escapeHtml(eyebrow)}</span>
          <span class="chip-title">${escapeHtml(taskTitle(t))}</span>
        </span>
        ${progressMarkup(p)}
      </button>
    `;
  }

  const btn = document.getElementById('topbar-chip-btn');
  if (btn) btn.onclick = openTaskModal;
}

export function initTopbarContext() {
  // onActiveTaskChange fires once on subscribe (initial paint) and then on
  // every active-task change + every completeTask() — which is enough to
  // keep both the title and the progress bar live without our own ticker.
  onActiveTaskChange(() => render());
}
