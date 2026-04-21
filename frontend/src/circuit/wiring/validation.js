// Connection validation rules.
// Kept framework-agnostic: pass in the state object, get pure verdicts.

/**
 * @typedef {{ok:boolean, reason?:string}} Verdict
 */

export function createValidator(getState) {
  const state = () => (typeof getState === 'function' ? getState() : getState);

  function epId(ep) {
    if (!ep) return null;
    if (ep.junctionId) return 'J:' + ep.junctionId;
    if (ep.compId && ep.term) return ep.compId + '.' + ep.term;
    return null;
  }

  function epMatches(a, b) {
    return a && b && epId(a) && epId(a) === epId(b);
  }

  /** @returns {Verdict} */
  function canStart(port) {
    if (!port) return { ok: false, reason: 'invalid-port' };
    if (port.junctionId) {
      const j = state().junctions.find(x => x.id === port.junctionId);
      if (!j) return { ok: false, reason: 'missing-junction' };
      return { ok: true };
    }
    if (!port.compId || !port.term) return { ok: false, reason: 'invalid-port' };
    const comp = state().components.find(c => c.id === port.compId);
    if (!comp) return { ok: false, reason: 'missing-component' };
    return { ok: true };
  }

  /** @returns {Verdict} */
  function canConnect(from, to) {
    if (!from || !to) return { ok: false, reason: 'invalid-port' };
    if (epMatches(from, to)) return { ok: false, reason: 'same-terminal' };
    const wires = state().wires;
    const dup = wires.find(w =>
      (epMatches(w.a, from) && epMatches(w.b, to)) ||
      (epMatches(w.b, from) && epMatches(w.a, to))
    );
    if (dup) return { ok: false, reason: 'duplicate' };
    return { ok: true };
  }

  return { canStart, canConnect };
}
