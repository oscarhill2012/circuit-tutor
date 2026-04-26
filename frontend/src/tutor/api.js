// Tutor HTTP client: builds the payload sent to /api/tutor (server-side key),
// handles thinking/assistant message plumbing, and applies visual highlights
// from the tutor's visual_instructions array.

import { state } from '../state/store.js';
import { SelKind } from '../state/constants.js';
import { applyVisualInstructions } from '../circuit/renderer.js';
import { getActiveTask } from '../tasks/engine.js';
import { pushUserMsg, appendThinking, removeThinking, appendTutorMsg } from '../ui/tutorPanel.js';
import { PINNED, retrieve } from '../data/knowledgeBase.js';

const TUTOR_URL = '/api/tutor';

// Context-window caps.
const HISTORY_TURNS = 4;                 // last N raw turns sent as recent_history
const HISTORY_CHAR_CAP = 500;            // truncate each history entry's content
const RETRIEVED_KB_LIMIT = 8;            // top-N retrieved snippets (pinned always sent on top)
const MAX_COMPONENTS_IN_SNAPSHOT = 40;   // defensive cap for pathological circuits
const MAX_WIRES_IN_SNAPSHOT = 80;
const MAX_READINGS_IN_SNAPSHOT = 40;

// Boundary conversion: the server schema for `selected` is a string — wires
// are still serialised as `"wire:<id>"` here so the API contract is unchanged.
function selectionForServer(sel) {
  if (!sel) return null;
  return sel.kind === SelKind.WIRE ? 'wire:' + sel.id : sel.id;
}

function circuitSnapshot() {
  const comps = state.components.slice(0, MAX_COMPONENTS_IN_SNAPSHOT).map(c => ({
    id: c.id, type: c.type, props: c.props,
  }));
  const epLabel = (ep) => ep.junctionId ? `J:${ep.junctionId}` : `${ep.compId}.${ep.term}`;
  const wires = state.wires.slice(0, MAX_WIRES_IN_SNAPSHOT).map(w => ({
    id: w.id, from: epLabel(w.a), to: epLabel(w.b),
  }));
  const meters = state.components
    .filter(c => c.type === 'ammeter' || c.type === 'voltmeter')
    .slice(0, MAX_COMPONENTS_IN_SNAPSHOT)
    .map(m => ({ id: m.id, type: m.type }));
  let readings = {};
  if (state.sim && state.sim.ok && !state.sim.empty) {
    readings = {
      status: state.sim.isOpen ? 'open' : (state.sim.isShort ? 'short' : 'live'),
      supplyV: state.sim.supplyV || 0,
      totalI: state.sim.totalI || 0,
      components: state.sim.elements.slice(0, MAX_READINGS_IN_SNAPSHOT).map(e => ({
        id: e.comp.id,
        current: Number((e.current || 0).toFixed(4)),
        drop: Number((e.drop || 0).toFixed(4)),
      })),
    };
  }
  return {
    components: comps,
    wires,
    meters,
    readings,
    truncated: state.components.length > MAX_COMPONENTS_IN_SNAPSHOT
            || state.wires.length > MAX_WIRES_IN_SNAPSHOT,
  };
}

function truncateHistory(messages) {
  return messages.slice(-HISTORY_TURNS).map(m => {
    const raw = typeof m.content === 'string'
      ? m.content
      : (m.content.assistant_text || JSON.stringify(m.content));
    const content = raw.length > HISTORY_CHAR_CAP
      ? raw.slice(0, HISTORY_CHAR_CAP) + '…'
      : raw;
    return { role: m.role, content };
  });
}

function buildUserPayload(studentMessage) {
  const t = getActiveTask();
  const recent = truncateHistory(state.messages);

  // Pinned safeguarding + foundational rules are ALWAYS sent on every turn.
  // Retrieved snippets are ranked per-turn against the student's message and
  // current task topic.
  const retrieved = retrieve(studentMessage, {
    topic: t ? t.topicId : null,
    limit: RETRIEVED_KB_LIMIT,
  });
  const knowledge_snippets = [...PINNED, ...retrieved];

  return {
    student_message: studentMessage,
    circuit_state: circuitSnapshot(),
    selected: selectionForServer(state.selection),
    current_task: t ? { id: t.id, topic: t.topicId, type: t.type, difficulty: t.difficulty, data: t.data } : null,
    recent_history: recent,
    knowledge_snippets,
    rolling_summary: state.rollingSummary || '',
  };
}

// Repeated-message batching: if the student fires off several messages in
// quick succession (or while a previous request is still in flight), wait
// for a short debounce and then send them to the tutor as a single
// combined student_message. Recent history already carries each individual
// turn as context, so the tutor sees them one-by-one as well.
const DEBOUNCE_MS = 450;
let pendingRequest = null;  // Promise while a fetch is in flight
let queued = [];            // Student messages waiting to be sent
let debounceTimer = null;

export async function askTutor(message) {
  pushUserMsg(message);
  queued.push(message);
  if (pendingRequest) return;           // drained after current completes
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(flushTutorQueue, DEBOUNCE_MS);
}

async function flushTutorQueue() {
  debounceTimer = null;
  if (pendingRequest || queued.length === 0) return;
  const batch = queued.length === 1
    ? queued[0]
    : queued.join('\n\n');
  queued = [];
  pendingRequest = sendOneTutorRequest(batch);
  try { await pendingRequest; }
  finally {
    pendingRequest = null;
    if (queued.length > 0) flushTutorQueue();
  }
}

async function sendOneTutorRequest(combinedMessage) {
  const thinkingId = appendThinking();
  try {
    const res = await fetch(TUTOR_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildUserPayload(combinedMessage)),
    });
    if (!res.ok) {
      removeThinking(thinkingId);
      appendTutorMsg({ reply_type:'direct_explanation', assistant_text: `I couldn't reach the tutor service (${res.status}).` });
      return;
    }
    const data = await res.json();
    const parsed = data.reply || { reply_type:'direct_explanation', assistant_text: 'No reply.' };
    state.lastAnalysis = data.analysis || null;
    if (typeof parsed.rolling_summary === 'string' && parsed.rolling_summary.trim()) {
      state.rollingSummary = parsed.rolling_summary.trim();
    }
    removeThinking(thinkingId);
    appendTutorMsg(parsed);
    applyVisualInstructions(parsed.visual_instructions || []);
    state.messages.push({ role: 'assistant', content: parsed });
  } catch (err) {
    removeThinking(thinkingId);
    appendTutorMsg({ reply_type:'direct_explanation', assistant_text: `Network error: ${err.message}` });
  }
}

// Scenario validation: ask Professor Volt to judge whether the current circuit
// solves the given scenario. The tutor returns a structured `verdict` field
// ("pass" | "fail") alongside the usual coaching reply. Runs out-of-band from
// the normal chat queue so it doesn't get merged with debounced student turns.
export async function askTutorCheckScenario(task) {
  const message = `Please check my circuit — I believe I've solved the scenario: "${task.data.challenge}".`;
  pushUserMsg(message);
  const thinkingId = appendThinking();
  try {
    const payload = buildUserPayload(message);
    payload.check_request = {
      type: 'scenario_validation',
      challenge: task.data.challenge || '',
      narrative: task.data.narrative || '',
      parameters: task.data.parameters || {},
      success_criteria: task.data.successCriteria || {},
    };
    const res = await fetch(TUTOR_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    removeThinking(thinkingId);
    if (!res.ok) {
      const reply = { reply_type: 'direct_explanation', assistant_text: `I couldn't reach the tutor service (${res.status}).` };
      appendTutorMsg(reply);
      return { verdict: 'fail', reply };
    }
    const data = await res.json();
    const parsed = data.reply || { reply_type: 'direct_explanation', assistant_text: 'No reply.' };
    state.lastAnalysis = data.analysis || null;
    if (typeof parsed.rolling_summary === 'string' && parsed.rolling_summary.trim()) {
      state.rollingSummary = parsed.rolling_summary.trim();
    }
    appendTutorMsg(parsed);
    applyVisualInstructions(parsed.visual_instructions || []);
    state.messages.push({ role: 'assistant', content: parsed });
    const verdict = parsed.verdict === 'pass' ? 'pass' : 'fail';
    return { verdict, reply: parsed };
  } catch (err) {
    removeThinking(thinkingId);
    const reply = { reply_type: 'direct_explanation', assistant_text: `Network error: ${err.message}` };
    appendTutorMsg(reply);
    return { verdict: 'fail', reply };
  }
}

export function askTutorAbout(prompt) {
  const input = document.getElementById('chat-input');
  input.value = prompt;
  askTutor(prompt);
  input.value = '';
}
