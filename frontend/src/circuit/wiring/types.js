// Shared wiring concepts, documented as JSDoc typedefs.
// This file is load-safe and exports nothing runtime; it exists so other
// modules can point at canonical type names.

/**
 * @typedef {Object} ConnectorPort
 * @property {string} compId
 * @property {string} term
 */

/**
 * @typedef {Object} Wire
 * @property {string} id
 * @property {ConnectorPort} a
 * @property {ConnectorPort} b
 * @property {{x:number,y:number}[]=} path  Cached full route, endpoints included.
 * @property {{x:number,y:number}[]=} via   Legacy waypoint list (pre-router).
 */

/**
 * @typedef {Object} PendingWire
 * @property {ConnectorPort} from
 * @property {number} mouseX
 * @property {number} mouseY
 */

/**
 * @typedef {Object} RoutingObstacle
 * @property {string} id
 * @property {number} x1
 * @property {number} y1
 * @property {number} x2
 * @property {number} y2
 */

/**
 * @typedef {Object} RoutedPath
 * @property {{x:number,y:number}[]} points
 * @property {number} cost
 */

export {};
