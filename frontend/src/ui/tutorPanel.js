// Right-hand tutor panel: chat messages, quick prompts, input field, help,
// clear-chat and greet. Also owns the KaTeX inline renderer for $…$ spans.

import { state } from '../state/store.js';
import { TASKS, escapeHtml } from '../tasks/engine.js';
import { askTutor } from '../tutor/api.js';

export function pushUserMsg(text) {
  state.messages.push({ role: 'user', content: text });
  const m = document.createElement('div');
  m.className = 'msg user-msg';
  m.textContent = text;
  document.getElementById('messages').appendChild(m);
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
  return id;
}

export function removeThinking(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
}

export function appendTutorMsg(payload) {
  const m = document.createElement('div');
  m.className = 'msg tutor-msg ' + (payload.reply_type || 'direct_explanation');
  const who = document.createElement('div');
  who.className = 'who'; who.textContent = 'Professor Volt · ' + (payload.reply_type || 'reply');
  m.appendChild(who);
  const body = document.createElement('div');
  body.innerHTML = renderWithKatex(payload.assistant_text || '');
  m.appendChild(body);
  if (payload.follow_up_question) {
    const f = document.createElement('div');
    f.className = 'follow-up';
    f.innerHTML = renderWithKatex('→ ' + payload.follow_up_question);
    m.appendChild(f);
  }
  document.getElementById('messages').appendChild(m);
  scrollMsgs();
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

export function greet() {
  appendTutorMsg({
    reply_type:'direct_explanation',
    assistant_text:`Welcome! I'm **Professor Volt**, your Socratic tutor for GCSE circuits. I'll ask short questions and help you learn by experimenting. Try the challenge on the right — or build your own circuit.`,
    follow_up_question:`What shall we tackle first?`,
  });
}

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
  document.querySelectorAll('.tutor-quick button').forEach(b => {
    b.onclick = () => {
      const t = TASKS[state.currentTaskIndex];
      const map = {
        hint: t ? `Give me a single small hint for the current challenge. Don't tell me the answer.` : `Give me a small hint about what to try.`,
        check: `Look at my current circuit and tell me if there's a mistake or an improvement I should make.`,
        explain: t ? `Briefly explain the key idea of the current topic in one or two sentences suitable for GCSE.` : `Briefly explain Ohm's law.`,
      };
      askTutor(map[b.dataset.quick]);
    };
  });
  document.getElementById('btn-clear-chat').onclick = () => {
    state.messages = [];
    document.getElementById('messages').innerHTML = '';
    greet();
  };
  document.getElementById('btn-help').onclick = () => {
    appendTutorMsg({
      reply_type: 'direct_explanation',
      assistant_text: 'Drag components from the left palette. Click two terminals to draw a wire. Press "s" while a switch is selected to toggle it. Use Delete or the Delete tool to remove items. Ask me anything about circuits.',
      follow_up_question: 'Ready to try the first challenge?'
    });
  };
}
