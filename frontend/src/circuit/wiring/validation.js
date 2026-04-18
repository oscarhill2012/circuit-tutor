// Connection validation rules.
// Kept framework-agnostic: pass in the state object, get pure verdicts.

/**
 * @typedef {{ok:boolean, reason?:string}} Verdict
 */

export function createValidator(getState) {
  const state = () => (typeof getState === 'function' ? getState() : getState);

  /** @returns {Verdict} */
  function canStart(port) {
    if (!port || !port.compId || !port.term) return { ok: false, reason: 'invalid-port' };
    const comp = state().components.find(c => c.id === port.compId);
    if (!comp) return { ok: false, reason: 'missing-component' };
    return { ok: true };
  }

  /** @returns {Verdict} */
  function canConnect(from, to) {
    if (!from || !to) return { ok: false, reason: 'invalid-port' };
    if (from.compId === to.compId && from.term === to.term) {
      return { ok: false, reason: 'same-terminal' };
    }
    const wires = state().wires;
    const dup = wires.find(w =>
      (w.a.compId === from.compId && w.a.term === from.term && w.b.compId === to.compId && w.b.term === to.term) ||
      (w.b.compId === from.compId && w.b.term === from.term && w.a.compId === to.compId && w.a.term === to.term)
    );
    if (dup) return { ok: false, reason: 'duplicate' };
    return { ok: true };
  }

  return { canStart, canConnect };
}
