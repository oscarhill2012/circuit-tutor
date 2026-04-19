// Central in-memory state + canvas constants.
// Modules import the live `state` reference and mutate fields directly,
// matching the pre-refactor global behaviour.

export const GRID = 20;           // grid size in svg units
export const SVG_W = 1600;
export const SVG_H = 1000;
export const EPS = 1e-9;

export const state = {
  components: [],   // {id, type, x, y, rot, props}
  wires: [],        // {id, a:{compId,term}, b:{compId,term}}
  selectedId: null,
  tool: 'select',
  pendingWire: null,   // {from:{compId,term}, mouseX, mouseY}
  history: [],
  future: [],
  nextId: 1,
  toggles: { current: true, voltage: true, labels: true },
  sim: null,             // last sim result
  currentTaskIndex: 0,
  tasksCompleted: new Set(),
  messages: [],
  lockedIds: new Set(),     // component ids that the current task has pinned
  loadedTaskId: null,       // last task whose initial circuit was loaded
  rollingSummary: '',       // tutor-authored summary of earlier turns
};
