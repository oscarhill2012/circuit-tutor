// Tutor HTTP client: builds the payload sent to /api/tutor (server-side key),
// handles thinking/assistant message plumbing, and applies visual highlights
// from the tutor's visual_instructions array.
//
// KB retrieval runs server-side — see frontend/api/tutor.py. The client sends
// the student message + circuit state and the server retrieves relevant KB
// snippets against the canonical knowledge_base.json.

import { state } from '../state/store.js';
import { SelKind } from '../state/constants.js';
import { applyVisualInstructions } from '../circuit/renderer.js';
import { getActiveTask } from '../tasks/engine.js';
import { pushUserMsg, appendThinking, removeThinking, appendTutorMsg } from '../ui/tutorPanel.js';
import { isDevMode, captureRequest, captureResponse, captureError } from './devInspector.js';

const TUTOR_URL = '/api/tutor';

// Context-window caps.
const HISTORY_TURNS = 4;                 // last N raw turns sent as recent_history
const HISTORY_USER_CHAR_CAP = 500;       // truncate user history content
const HISTORY_ASSISTANT_CHAR_CAP = 500;  // prose-only assistant turns; next_step prefix fits comfortably
const MAX_COMPONENTS_IN_SNAPSHOT = 40;   // defensive cap for pathological circuits
const MAX_WIRES_IN_SNAPSHOT = 80;
const MAX_READINGS_IN_SNAPSHOT = 40;

// A student message that mentions any of these implies they want numbers.
// When none match, per-component current/drop readings are stripped from
// the snapshot so the tutor doesn't pre-quote values the student didn't ask
// for. The simulator still runs locally; we just hide its per-component
// numerics from the model.
const NUMERIC_INTENT_RE = /\b(current|voltage|reading|measure|measurement|how much|how many|amps?|amperes?|volts?|ohms?|p\.?d\.?|drop|power|watts?|value|number|[0-9])/i;

// Boundary conversion: the server schema for `selected` is a string — wires
// are still serialised as `"wire:<id>"` here so the API contract is unchanged.
function selectionForServer(sel) {
  if (!sel) return null;
  return sel.kind === SelKind.WIRE ? 'wire:' + sel.id : sel.id;
}

function circuitSnapshot(studentMessage) {
  // When the student's message has no numeric intent, also strip the static
  // numeric props (`voltage` on cells, `resistance` on resistors). Otherwise
  // the model can fabricate `I = V/R` calculations on a one-word affirmation
  // like "ok thanks" — Plan 10 defect #2.
  const wantsNumbers = NUMERIC_INTENT_RE.test(studentMessage || '');
  const scrubProps = (props) => {
    if (wantsNumbers || !props || typeof props !== 'object') return props;
    const { voltage, resistance, ...rest } = props;
    return rest;
  };
  const comps = state.components.slice(0, MAX_COMPONENTS_IN_SNAPSHOT).map(c => ({
    id: c.id, type: c.type, props: scrubProps(c.props),
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
    };
    if (wantsNumbers) {
      readings.components = state.sim.elements.slice(0, MAX_READINGS_IN_SNAPSHOT).map(e => ({
        id: e.comp.id,
        current: Number((e.current || 0).toFixed(4)),
        drop: Number((e.drop || 0).toFixed(4)),
      }));
    }
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

// Compress assistant turns to prose only (assistant_text + a `[next_step: …]`
// prefix lifted from state_summary.next_step) so the model isn't re-reading
// its own prior structured JSON every turn. Continuity comes from
// rolling_summary; the next_step prefix preserves the planned move.
function truncateHistory(messages) {
  return messages.slice(-HISTORY_TURNS).map(m => {
    let raw;
    let cap;
    if (m.role === 'assistant' && m.content && typeof m.content === 'object') {
      const nextStep = m.content.state_summary?.next_step?.trim();
      const body = m.content.assistant_text || '';
      raw = nextStep ? `[next_step: ${nextStep}] ${body}` : body;
      cap = HISTORY_ASSISTANT_CHAR_CAP;
    } else {
      raw = typeof m.content === 'string'
        ? m.content
        : (m.content?.assistant_text || '');
      cap = HISTORY_USER_CHAR_CAP;
    }
    const content = raw.length > cap ? raw.slice(0, cap) + '…' : raw;
    return { role: m.role, content };
  });
}

function buildUserPayload(studentMessage) {
  const t = getActiveTask();
  const recent = truncateHistory(state.messages);

  // KB retrieval runs server-side against knowledge_base.json so the client
  // payload no longer carries `knowledge_snippets`. The server uses
  // student_message + current_task.topic for ranking.
  return {
    student_message: studentMessage,
    circuit_state: circuitSnapshot(studentMessage),
    selected: selectionForServer(state.selection),
    current_task: t ? { id: t.id, topic: t.topicId, type: t.type, difficulty: t.difficulty, data: t.data } : null,
    recent_history: recent,
    rolling_summary: state.rollingSummary || '',
  };
}

// Repeated-message batching: if the student fires off several messages in
// quick succession (or while a previous request is still in flight), wait
// for a short debounce and then send them to the tutor as a single
// combined student_message. Recent history already carries each individual
// turn as context, so the tutor sees them one-by-one as well.
const DEBOUNCE_MS = 200;
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
    const payload = buildUserPayload(combinedMessage);
    if (isDevMode()) payload.debug = true;
    captureRequest(payload);
    const res = await fetch(TUTOR_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      removeThinking(thinkingId);
      captureError(`HTTP ${res.status}`);
      appendTutorMsg({ reply_type:'direct_explanation', assistant_text: `I couldn't reach the tutor service (${res.status}).` });
      return;
    }
    const data = await res.json();
    captureResponse(data);
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
    captureError(err);
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
    if (isDevMode()) payload.debug = true;
    captureRequest(payload);
    const res = await fetch(TUTOR_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    removeThinking(thinkingId);
    if (!res.ok) {
      captureError(`HTTP ${res.status}`);
      const reply = { reply_type: 'direct_explanation', assistant_text: `I couldn't reach the tutor service (${res.status}).` };
      appendTutorMsg(reply);
      return { verdict: 'fail', reply };
    }
    const data = await res.json();
    captureResponse(data);
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
    captureError(err);
    const reply = { reply_type: 'direct_explanation', assistant_text: `Network error: ${err.message}` };
    appendTutorMsg(reply);
    return { verdict: 'fail', reply };
  }
}
