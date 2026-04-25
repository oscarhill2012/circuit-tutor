// Connection validation rules.
// Kept framework-agnostic: pass in the state object, get pure verdicts.

import { endpointKey, samePort } from '../geometry.js';

/**
 * @typedef {{ok:boolean, reason?:string}} Verdict
 */

export function createValidator(getState) {
  const state = () => (typeof getState === 'function' ? getState() : getState);

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
    if (samePort(from, to)) return { ok: false, reason: 'same-terminal' };
    const fk = endpointKey(from), tk = endpointKey(to);
    if (!fk || !tk) return { ok: false, reason: 'invalid-port' };
    const dup = state().wires.find(w => {
      const ak = endpointKey(w.a), bk = endpointKey(w.b);
      return (ak === fk && bk === tk) || (ak === tk && bk === fk);
    });
    if (dup) return { ok: false, reason: 'duplicate' };
    return { ok: true };
  }

  return { canStart, canConnect };
}
