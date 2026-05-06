// Tutor HTTP client — slim payload, calls /api/tutor.
//
// The server is the tool-augmented agent runner (api/tutor.py
// → agent_runner.run_agent). Knowledge retrieval, circuit analysis, and
// safety judgements all happen via tool calls server-side; the client just
// hands over the live circuit state, the student message, and the active
// task.

import { state } from '../state/store.js';
import { SelKind } from '../state/constants.js';
import { applyVisualInstructions } from '../circuit/renderer.js';
import { getActiveTask } from '../tasks/engine.js';
import { pushUserMsg, appendThinking, removeThinking, appendTutorMsg } from '../ui/tutorPanel.js';
import { isDevMode, captureRequest, captureResponse, captureError, captureToolLedger } from './devInspector.js';

const TUTOR_URL = '/api/tutor';
const SESSION_KEY = 'tutor.sessionId';

function getSessionId() {
  try {
    let id = sessionStorage.getItem(SESSION_KEY);
    if (!id) {
      id = `s-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
      sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch (_err) {
    // Private browsing / disabled storage — fall back to a per-page id.
    if (!getSessionId._fallback) {
      getSessionId._fallback = `s-fallback-${Math.random().toString(36).slice(2, 10)}`;
    }
    return getSessionId._fallback;
  }
}

function selectionForServer(sel) {
  if (!sel) return null;
  return sel.kind === SelKind.WIRE ? 'wire:' + sel.id : sel.id;
}

// Slim circuit snapshot: no phrase-based scrubbing. The agent loop's tools
// pull only what they need; the client hands over the authoritative state.
function circuitSnapshot() {
  const epLabel = (ep) => ep.junctionId ? `J:${ep.junctionId}` : `${ep.compId}.${ep.term}`;
  const components = state.components.map(c => ({
    id: c.id, type: c.type, props: c.props || {},
  }));
  const wires = state.wires.map(w => ({
    id: w.id, from: epLabel(w.a), to: epLabel(w.b),
  }));
  const meters = components.filter(c => c.type === 'ammeter' || c.type === 'voltmeter');
  return { components, wires, meters };
}

function simSnapshot() {
  if (!state.sim || !state.sim.ok || state.sim.empty) return { meters: {} };
  const out = { meters: {} };
  // Map every ammeter/voltmeter to its current sim reading.
  for (const e of (state.sim.elements || [])) {
    const c = e.comp;
    if (!c || (c.type !== 'ammeter' && c.type !== 'voltmeter')) continue;
    out.meters[c.id] = {
      value: Number((e.current ?? e.drop ?? 0).toFixed(4)),
      status: state.sim.isOpen ? 'open' : (state.sim.isShort ? 'short' : 'live'),
    };
  }
  return out;
}

function buildSlimPayload(studentMessage, extras = {}) {
  const t = getActiveTask();
  return {
    student_message: studentMessage,
    selected: selectionForServer(state.selection),
    current_task: t ? {
      id: t.id, topic: t.topicId, type: t.type, difficulty: t.difficulty, data: t.data,
    } : null,
    session_id: getSessionId(),
    check_request: extras.check_request || null,
    circuit_state: circuitSnapshot(),
    sim_result: simSnapshot(),
  };
}

async function postOnce(payload) {
  if (isDevMode()) payload.debug = true;
  captureRequest(payload);
  const res = await fetch(TUTOR_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    captureError(`HTTP ${res.status}`);
    return null;
  }
  const data = await res.json();
  captureResponse(data);
  if (data.debug && data.debug.tool_ledger && typeof captureToolLedger === 'function') {
    captureToolLedger(data.debug.tool_ledger);
  }
  return data;
}

// Repeated-message debouncing: same as legacy api.js.
const DEBOUNCE_MS = 200;
let pendingRequest = null;
let queued = [];
let debounceTimer = null;

export async function askTutor(message) {
  pushUserMsg(message);
  queued.push(message);
  if (pendingRequest) return;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(flushQueue, DEBOUNCE_MS);
}

async function flushQueue() {
  debounceTimer = null;
  if (pendingRequest || queued.length === 0) return;
  const batch = queued.length === 1 ? queued[0] : queued.join('\n\n');
  queued = [];
  pendingRequest = sendOneRequest(batch);
  try { await pendingRequest; }
  finally {
    pendingRequest = null;
    if (queued.length > 0) flushQueue();
  }
}

async function sendOneRequest(combinedMessage) {
  const thinkingId = appendThinking();
  try {
    const data = await postOnce(buildSlimPayload(combinedMessage));
    removeThinking(thinkingId);
    if (!data) {
      appendTutorMsg({ reply_type: 'direct_explanation', assistant_text: "I couldn't reach the tutor service." });
      return;
    }
    const parsed = data.reply || { reply_type: 'direct_explanation', assistant_text: 'No reply.' };
    appendTutorMsg(parsed);
    applyVisualInstructions(parsed.visual_instructions || []);
    state.messages.push({ role: 'assistant', content: parsed });
  } catch (err) {
    removeThinking(thinkingId);
    captureError(err);
    appendTutorMsg({ reply_type: 'direct_explanation', assistant_text: `Network error: ${err.message}` });
  }
}

export async function askTutorCheckScenario(task, extra = {}) {
  const headline = task.data.brief || task.data.description || 'this task';
  const message = `Please check my circuit — I believe I've solved the task: "${headline}".`;
  pushUserMsg(message);
  const thinkingId = appendThinking();
  try {
    const data = await postOnce(buildSlimPayload(message, {
      check_request: {
        claimed_reading: extra.claimed_reading ?? null,
        reading_status: extra.reading_status ?? null,
        simulated_reading: extra.simulated_reading ?? null,
        target_unit: extra.target_unit ?? null,
      },
    }));
    removeThinking(thinkingId);
    if (!data) {
      const reply = { reply_type: 'direct_explanation', assistant_text: "I couldn't reach the tutor service." };
      appendTutorMsg(reply);
      return { verdict: 'fail', reply };
    }
    const parsed = data.reply || { reply_type: 'direct_explanation', assistant_text: 'No reply.' };
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
