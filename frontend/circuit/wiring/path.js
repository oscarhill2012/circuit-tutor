// Turn a list of orthogonal points into an SVG `d` attribute with rounded
// corners, so the route still reads as axis-aligned but doesn't look
// mechanical. Each interior corner is replaced with a TRUE quarter-circle
// using the SVG arc command (`A`). The earlier implementation used a
// quadratic bezier (`Q`) which is a crude approximation of an arc and
// bowed visibly away from the true circle at the radius we draw (6px) —
// readers reported it as a "kink" at every bend.
//
// Radius is clamped to half of the shorter adjacent leg so a tiny segment
// can't make the curve overshoot its endpoint.

const CORNER_R = 6;

export function toSvgPath(points) {
  if (!points || points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  if (points.length === 2) {
    return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  }

  let d = `M ${points[0].x} ${points[0].y}`;

  for (let i = 1; i < points.length - 1; i++) {
    const p0 = points[i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];

    const leg1 = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    const leg2 = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const r = Math.min(CORNER_R, leg1 / 2, leg2 / 2);

    // Unit step vectors along each adjacent leg. For an orthogonal path
    // exactly one of (v1x, v1y) and one of (v2x, v2y) is non-zero.
    const v1x = sign(p1.x - p0.x), v1y = sign(p1.y - p0.y);
    const v2x = sign(p2.x - p1.x), v2y = sign(p2.y - p1.y);

    // Sweep direction. The 2D cross product of the incoming and outgoing
    // step vectors picks the turn direction; in SVG's y-down screen
    // coordinates a positive cross corresponds to a clockwise sweep,
    // which is sweep-flag 1.
    const cross = v1x * v2y - v1y * v2x;
    const sweep = cross > 0 ? 1 : 0;

    d += ` L ${p1.x - v1x * r} ${p1.y - v1y * r}`;
    d += ` A ${r} ${r} 0 0 ${sweep} ${p1.x + v2x * r} ${p1.y + v2y * r}`;
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
