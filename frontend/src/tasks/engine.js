// Challenge engine: flattens TOOL_DATA topics into a task list and renders
// the task card (multiple choice, scenario check, exploration) into the
// right-hand panel.

import { state } from '../state/store.js';
import { TOOL_DATA } from '../circuit/schema.js';
import { askTutorAbout } from '../tutor/api.js';

// Flatten topics into an ordered task list.
export const TASKS = [];
for (const topic of TOOL_DATA.content.topics) {
  for (const item of topic.items) {
    TASKS.push({ topicId: topic.id, topicName: topic.name, ...item });
  }
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function shuffleSeed(arr, seed) {
  // simple deterministic shuffle
  let h = 0; for (const ch of seed) h = (h*31 + ch.charCodeAt(0)) & 0xffff;
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    h = (h * 9301 + 49297) % 233280;
    const j = h % (i+1);
    [a[i],a[j]] = [a[j],a[i]];
  }
  return a;
}

export function renderTask() {
  const card = document.getElementById('task-card');
  const t = TASKS[state.currentTaskIndex];
  if (!t) { card.innerHTML = '<p>No tasks.</p>'; return; }

  const done = state.tasksCompleted.has(t.id);
  document.getElementById('prog-bar').style.width = (state.tasksCompleted.size / TASKS.length * 100) + '%';

  if (t.type === 'problem') {
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
          document.getElementById('prog-bar').style.width = (state.tasksCompleted.size / TASKS.length * 100) + '%';
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
      document.getElementById('prog-bar').style.width = (state.tasksCompleted.size / TASKS.length * 100) + '%';
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
      document.getElementById('prog-bar').style.width = (state.tasksCompleted.size / TASKS.length * 100) + '%';
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
