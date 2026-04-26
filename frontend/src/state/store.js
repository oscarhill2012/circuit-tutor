// Central in-memory state + canvas constants.
// Modules import the live `state` reference and mutate fields directly,
// matching the pre-refactor global behaviour.

export const GRID = 20;           // grid size in svg units
export const SVG_W = 1600;
export const SVG_H = 1000;
export const EPS = 1e-9;

export const state = {
  components: [],   // {id, type, x, y, props}
  junctions: [],    // {id, x, y} — wire-to-wire T-junctions
  wires: [],        // {id, a, b, path?} — a/b each {compId,term} or {junctionId}
  selection: null,   // null | { kind: 'component'|'wire', id }
  tool: 'select',
  pendingWire: null,   // {from:{compId,term}, mouseX, mouseY}
  history: [],
  future: [],
  nextId: 1,
  toggles: { current: true, voltage: true, labels: true },
  sim: null,             // last sim result
  tasksCompleted: new Set(),
  messages: [],
  lockedIds: new Set(),     // component ids that the current task has pinned
  loadedTaskId: null,       // last task whose initial circuit was loaded
  rollingSummary: '',       // tutor-authored summary of earlier turns
  visuals: {},              // tutor-driven overlays: id → { action, label, expiresAt }
};
