// Typed constants for tool palette modes and selection state.

export const Tool = Object.freeze({
  SELECT: 'select',
  WIRE: 'wire',
  DELETE: 'delete',
  // The CSS class `tool-<value>` is set on the SVG root and the
  // `data-tool="<value>"` attributes in index.html depend on these
  // literal values, so don't change them without updating CSS / HTML.
});

export const TOOL_VALUES = new Set(Object.values(Tool));

export function isValidTool(t) {
  return TOOL_VALUES.has(t);
}

export const SelKind = Object.freeze({
  COMPONENT: 'component',
  WIRE: 'wire',
});

/**
 * @typedef {{ kind: 'component'|'wire', id: string }|null} Selection
 */

export const Sel = Object.freeze({
  none: () => null,
  component: (id) => ({ kind: SelKind.COMPONENT, id }),
  wire: (id) => ({ kind: SelKind.WIRE, id }),
  isWire: (s) => !!s && s.kind === SelKind.WIRE,
  isComponent: (s) => !!s && s.kind === SelKind.COMPONENT,
  matches: (s, kind, id) => !!s && s.kind === kind && s.id === id,
});
