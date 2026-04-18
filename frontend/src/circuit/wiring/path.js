// Turn a list of orthogonal points into an SVG `d` attribute with slightly
// rounded corners, so the route still reads as axis-aligned but doesn't
// look mechanical. Internal corners are replaced with a quadratic bezier
// whose radius is clamped to half of the shorter adjacent leg.

const CORNER_R = 6;

export function toSvgPath(points) {
  if (!points || points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  if (points.length === 2) {
    return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  }
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const p0 = points[i - 1], p1 = points[i], p2 = points[i + 1];
    const leg1 = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    const leg2 = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const r = Math.min(CORNER_R, leg1 / 2, leg2 / 2);
    const v1x = sign(p1.x - p0.x), v1y = sign(p1.y - p0.y);
    const v2x = sign(p2.x - p1.x), v2y = sign(p2.y - p1.y);
    d += ` L ${p1.x - v1x * r} ${p1.y - v1y * r}`;
    d += ` Q ${p1.x} ${p1.y} ${p1.x + v2x * r} ${p1.y + v2y * r}`;
  }
  const last = points[points.length - 1];
  d += ` L ${last.x} ${last.y}`;
  return d;
}

// Straight two-segment Manhattan path, used for the pending-wire preview.
export function previewPath(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return `M ${a.x} ${a.y}`;
  const horizontalFirst = Math.abs(dx) >= Math.abs(dy);
  const pts = horizontalFirst
    ? [a, { x: b.x, y: a.y }, b]
    : [a, { x: a.x, y: b.y }, b];
  return toSvgPath(pts);
}

function sign(n) { return n > 0 ? 1 : n < 0 ? -1 : 0; }
