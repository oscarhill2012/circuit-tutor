// Right-hand tutor panel: chat messages, quick prompts, input field, help,
// clear-chat and greet. Also owns the KaTeX inline renderer for $…$ spans.

import { state } from '../state/store.js';
import {
  escapeHtml,
  getActiveTask,
  remindActiveTask,
  checkActiveTask,
  onActiveTaskChange,
} from '../tasks/engine.js';
import { askTutor } from '../tutor/api.js';

// Persona-state helper: drives the Professor Volt portrait's animated ring
// (idle / thinking / speaking / error). The visual ring lives in CSS via
// `[data-state="…"]`; this function flips the attribute and the status text
// underneath. Tutor api.js calls it via the appendThinking / appendTutorMsg
// path so the avatar visibly reacts to every tutor turn.
let _personaResetTimer = null;
export function setPersonaState(state, label) {
  const personaEl = document.querySelector('.persona-avatar');
  const statusEl  = document.getElementById('persona-status');
  if (!personaEl) return;
  personaEl.dataset.state = state;
  if (statusEl && label) statusEl.textContent = label;
}
function schedulePersonaReset(delayMs) {
  clearTimeout(_personaResetTimer);
  _personaResetTimer = setTimeout(
    () => setPersonaState('idle', 'Watching the bench'),
    delayMs
  );
}

// Hard cap on in-memory chat length. Prevents unbounded growth of
// state.messages and the #messages DOM, which would otherwise slowly
// lag the panel and bloat memory on long sessions. The tutor API
// already truncates what gets sent per-turn (HISTORY_TURNS in api.js),
// so trimming older turns here has no effect on prompt size — it just
// stops the app from hoarding them forever.
const MAX_CHAT_MESSAGES = 60;

function trimChatIfTooLong() {
  if (state.messages.length > MAX_CHAT_MESSAGES) {
    state.messages.splice(0, state.messages.length - MAX_CHAT_MESSAGES);
  }
  const host = document.getElementById('messages');
  if (!host) return;
  while (host.children.length > MAX_CHAT_MESSAGES) host.removeChild(host.firstChild);
}

export function clearChat() {
  state.messages = [];
  state.rollingSummary = '';
  const host = document.getElementById('messages');
  if (host) host.innerHTML = '';
}

export function pushUserMsg(text) {
  // First real exchange — drop the cold-open greeting bubble so the chat
  // doesn't grow stale.
  const greet = document.getElementById('volt-greeting');
  if (greet) greet.remove();
  state.messages.push({ role: 'user', content: text });
  const m = document.createElement('div');
  m.className = 'msg user-msg';
  m.textContent = text;
  document.getElementById('messages').appendChild(m);
  trimChatIfTooLong();
  scrollMsgs();
}

let thinkingCounter = 0;
export function appendThinking() {
  const id = 'think-' + (++thinkingCounter);
  const m = document.createElement('div');
  m.className = 'msg tutor-msg thinking';
  m.id = id;
  m.textContent = 'Professor Volt is thinking…';
  document.getElementById('messages').appendChild(m);
  scrollMsgs();
  setPersonaState('thinking', 'Thinking…');
  clearTimeout(_personaResetTimer);
  return id;
}

export function removeThinking(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
}

// When the model returns a separate follow_up_question, strip any trailing
// interrogative sentence from the prose so the student doesn't see the same
// question twice (once in grey, once in green). The system prompt also asks
// the model not to do this, but belt-and-braces against older replies.
function stripTrailingQuestion(text) {
  if (!text) return text;
  const trimmed = String(text).trimEnd();
  if (!trimmed.endsWith('?')) return text;
  const m = trimmed.match(/([.!?…])[^.!?…]*\?\s*$/);
  if (m) return trimmed.slice(0, m.index + 1);
  // Whole text is a single trailing question — keep it; the follow-up
  // block will show it again, but dropping the prose leaves an empty bubble.
  return text;
}

export function appendTutorMsg(payload) {
  const m = document.createElement('div');
  m.className = 'msg tutor-msg ' + (payload.reply_type || 'direct_explanation');
  const who = document.createElement('div');
  who.className = 'who'; who.textContent = 'Professor Volt';
  m.appendChild(who);
  const body = document.createElement('div');
  const raw = payload.assistant_text || '';
  const prose = payload.follow_up_question ? stripTrailingQuestion(raw) : raw;
  body.innerHTML = renderWithKatex(prose);
  m.appendChild(body);
  if (payload.follow_up_question) {
    const f = document.createElement('div');
    f.className = 'follow-up';
    f.innerHTML = renderWithKatex('→ ' + payload.follow_up_question);
    m.appendChild(f);
  }
  document.getElementById('messages').appendChild(m);
  trimChatIfTooLong();
  scrollMsgs();
  // React on the avatar: refusals → brief error flash; everything else →
  // speaking ring while the student reads, then ease back to idle.
  if (payload.reply_type === 'refusal') {
    setPersonaState('error', 'Hmm, try again');
    schedulePersonaReset(1800);
  } else {
    setPersonaState('speaking', 'Explaining');
    schedulePersonaReset(2200);
  }
}

function renderWithKatex(text) {
  if (!window.katex) return escapeHtml(text);
  const parts = String(text).split(/(\$[^$]+\$)/g);
  return parts.map(p => {
    if (p.startsWith('$') && p.endsWith('$') && p.length > 2) {
      try { return window.katex.renderToString(p.slice(1,-1), { throwOnError: false }); } catch { return escapeHtml(p); }
    }
    return escapeHtml(p);
  }).join('');
}

function scrollMsgs() { const el = document.getElementById('messages'); el.scrollTop = el.scrollHeight; }

export function initTutorPanel() {
  document.getElementById('chat-send').onclick = () => {
    const input = document.getElementById('chat-input');
    const v = input.value.trim();
    if (!v) return;
    input.value = '';
    askTutor(v);
  };
  document.getElementById('chat-input').addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') document.getElementById('chat-send').click();
  });
  // Three quick-actions live in the tutor panel: Task reminder (re-states
  // the aim), Ask for a hint (existing Socratic nudge), and Check my circuit
  // (drives the scenario-validation flow that used to sit in the floating
  // task widget).
  const remindBtn = document.querySelector('.tutor-quick button[data-action="remind"]');
  const hintBtn   = document.querySelector('.tutor-quick button[data-action="hint"]');
  const checkBtn  = document.querySelector('.tutor-quick button[data-action="check"]');

  if (remindBtn) {
    remindBtn.onclick = () => remindActiveTask();
  }
  if (hintBtn) {
    hintBtn.onclick = () => {
      const t = getActiveTask();
      const msg = t
        ? `Give me a single small hint for the current task. Don't tell me the answer.`
        : `I'm exploring in sandbox mode — give me a small prompt or idea to try.`;
      askTutor(msg);
    };
  }
  if (checkBtn) {
    checkBtn.onclick = async () => {
      checkBtn.disabled = true;
      try { await checkActiveTask(); }
      finally {
        // Re-evaluate enabled state from current task — completion may have
        // cleared the active task in the meantime.
        syncQuickButtons(getActiveTask());
      }
    };
  }

  // Sync button enabled-state with active task: both Task-Reminder and
  // Check-my-circuit are enabled whenever any task is active (scenario,
  // measure, or exploration — they each have a meaningful Check action
  // since iter-improv Phase 2). Disabled buttons remain visible so the
  // layout doesn't shift between sandbox and active-task modes.
  function syncQuickButtons(t) {
    if (remindBtn) remindBtn.disabled = !t;
    if (checkBtn)  checkBtn.disabled  = !t;
  }
  onActiveTaskChange(syncQuickButtons);
  document.getElementById('btn-clear-chat').onclick = () => {
    clearChat();
  };
  document.getElementById('btn-help').onclick = () => {
    appendTutorMsg({
      reply_type: 'direct_explanation',
      assistant_text: 'Drag components from the left palette. Click two terminals to draw a wire. Press "s" while a switch is selected to toggle it. Use Delete or the Delete tool to remove items. Ask me anything about circuits.',
      follow_up_question: 'Ready to try the first challenge?'
    });
  };
}
