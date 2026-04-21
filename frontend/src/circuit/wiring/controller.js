// WireInteractionController — the two-click wiring state machine.
//
// IDLE               + click valid connector   -> AWAITING_TARGET (pending)
// AWAITING_TARGET    + click compatible target -> commit, back to IDLE
// AWAITING_TARGET    + click same port         -> cancel
// AWAITING_TARGET    + click another connector -> restart from that port
// AWAITING_TARGET    + click empty canvas      -> cancel
// AWAITING_TARGET    + Escape                  -> cancel
//
// The controller owns no DOM. Callers feed it semantic events and receive
// state transitions via the onChange callback.

import { samePort } from '../geometry.js';

export const WireState = Object.freeze({
  IDLE: 'IDLE',
  AWAITING_TARGET: 'AWAITING_TARGET',
});

export function createWireInteractionController({ validator, onCommit, onChange, onReject }) {
  let status = WireState.IDLE;
  /** @type {import('./types.js').PendingWire|null} */
  let pending = null;
  let invalidHover = null; // ConnectorPort|null — most recent rejected target

  function emit(extra = {}) {
    onChange && onChange({ status, pending, invalidHover, ...extra });
  }

  function reset() {
    status = WireState.IDLE;
    pending = null;
    invalidHover = null;
    emit();
  }

  function normalizePort(port) {
    return port.junctionId
      ? { junctionId: port.junctionId }
      : { compId: port.compId, term: port.term };
  }

  function startFrom(port, pt) {
    const v = validator.canStart(port);
    if (!v.ok) { onReject && onReject(port, v.reason); return; }
    pending = { from: normalizePort(port), mouseX: pt.x, mouseY: pt.y };
    invalidHover = null;
    status = WireState.AWAITING_TARGET;
    emit();
  }

  function onConnectorClick(port, pt) {
    if (status === WireState.IDLE) { startFrom(port, pt); return; }
    if (samePort(port, pending.from)) { reset(); return; }
    const v = validator.canConnect(pending.from, port);
    if (!v.ok) {
      // Restart from the new connector if the *target* is invalid only because
      // the pair doesn't make sense; that matches the "click another connector
      // to restart" rule. Duplicates and same-terminal count as hard rejects.
      if (v.reason === 'duplicate' || v.reason === 'same-terminal') {
        invalidHover = port;
        emit();
        onReject && onReject(port, v.reason);
        return;
      }
      startFrom(port, pt);
      return;
    }
    const from = pending.from;
    const committed = onCommit(from, normalizePort(port));
    status = WireState.IDLE;
    pending = null;
    invalidHover = null;
    emit({ committed });
  }

  function onCanvasClick() {
    if (status === WireState.AWAITING_TARGET) reset();
  }

  function onEscape() {
    if (status === WireState.AWAITING_TARGET) reset();
  }

  function onPointerMove(pt) {
    if (status !== WireState.AWAITING_TARGET || !pending) return;
    pending.mouseX = pt.x; pending.mouseY = pt.y;
    emit({ previewMove: true });
  }

  function onHoverTarget(port) {
    if (status !== WireState.AWAITING_TARGET) { invalidHover = null; return; }
    if (!port) { if (invalidHover) { invalidHover = null; emit(); } return; }
    const v = validator.canConnect(pending.from, port);
    const next = v.ok ? null : port;
    if ((next && (!invalidHover || !samePort(next, invalidHover))) ||
        (!next && invalidHover)) {
      invalidHover = next;
      emit();
    }
  }

  return {
    getStatus: () => status,
    getPending: () => pending,
    getInvalidHover: () => invalidHover,
    onConnectorClick,
    onCanvasClick,
    onEscape,
    onPointerMove,
    onHoverTarget,
    reset,
  };
}
