// Tutor HTTP client: builds the payload sent to /api/tutor (server-side key),
// handles thinking/assistant message plumbing, and applies visual highlights
// from the tutor's visual_instructions array.

import { state } from '../state/store.js';
import { TOOL_DATA } from '../circuit/schema.js';
import { applyVisualInstructions } from '../circuit/renderer.js';
import { TASKS } from '../tasks/engine.js';
import { pushUserMsg, appendThinking, removeThinking, appendTutorMsg } from '../ui/tutorPanel.js';

const TUTOR_URL = '/api/tutor';

function circuitSnapshot() {
  const comps = state.components.map(c => ({
    id: c.id, type: c.type, props: c.props,
  }));
  const wires = state.wires.map(w => ({ id: w.id, from: `${w.a.compId}.${w.a.term}`, to: `${w.b.compId}.${w.b.term}` }));
  const meters = state.components.filter(c => c.type==='ammeter'||c.type==='voltmeter').map(m => ({
    id: m.id, type: m.type,
  }));
  let readings = {};
  if (state.sim && state.sim.ok && !state.sim.empty) {
    readings = {
      status: state.sim.isOpen ? 'open' : 'live',
      supplyV: state.sim.supplyV || 0,
      totalI: state.sim.totalI || 0,
      components: state.sim.elements.map(e => ({
        id: e.comp.id, current: Number((e.current||0).toFixed(4)), drop: Number((e.drop||0).toFixed(4))
      })),
    };
  }
  return { components: comps, wires, meters, readings };
}

function buildUserPayload(studentMessage) {
  const t = TASKS[state.currentTaskIndex];
  const recent = state.messages.slice(-4).map(m => ({ role: m.role, content: typeof m.content === 'string' ? m.content : m.content.assistant_text || JSON.stringify(m.content) }));
  const rag = TOOL_DATA.reference.knowledgeBase.slice(0, 12); // send subset to keep payload small
  return JSON.stringify({
    student_message: studentMessage,
    circuit_state: circuitSnapshot(),
    selected: state.selectedId,
    current_task: t ? { id: t.id, topic: t.topicId, type: t.type, difficulty: t.difficulty, data: t.data } : null,
    recent_history: recent,
    knowledge_snippets: rag,
    rolling_summary: state.rollingSummary || '',
  });
}

export async function askTutor(message) {
  pushUserMsg(message);
  const thinkingId = appendThinking();
  try {
    const res = await fetch(TUTOR_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: buildUserPayload(message),
    });
    if (!res.ok) {
      removeThinking(thinkingId);
      appendTutorMsg({ reply_type:'direct_explanation', assistant_text: `I couldn't reach the tutor service (${res.status}).` });
      return;
    }
    const data = await res.json();
    const parsed = data.reply || { reply_type:'direct_explanation', assistant_text: 'No reply.' };
    state.lastAnalysis = data.analysis || null;
    removeThinking(thinkingId);
    appendTutorMsg(parsed);
    applyVisualInstructions(parsed.visual_instructions || []);
    state.messages.push({ role: 'assistant', content: parsed });
  } catch (err) {
    removeThinking(thinkingId);
    appendTutorMsg({ reply_type:'direct_explanation', assistant_text: `Network error: ${err.message}` });
  }
}

export function askTutorAbout(prompt) {
  const input = document.getElementById('chat-input');
  input.value = prompt;
  askTutor(prompt);
  input.value = '';
}
