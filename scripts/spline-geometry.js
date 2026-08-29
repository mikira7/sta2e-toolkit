/**
 * sta2e-toolkit | spline-geometry.js
 *
 * Closed centripetal Catmull-Rom tessellation over FLAT [x0,y0,x1,y1,…] point
 * arrays — the shape a Foundry polygon shape stores.
 *
 * A leaf module: it imports nothing, so the region drawing tool, the Region
 * config panel and anything else can use it without pulling a dependency in.
 * That is also why it does not import ship-vfx-anchors.js, whose
 * _catmullRomPoint this is modelled on — that module is heavy, its curve is
 * OPEN (neighbours clamp at the ends rather than wrapping) and it works in
 * {x, y} objects. The knot spacing here is the same centripetal (alpha = 0.5)
 * form, and for the same reason: uniform spacing bows and overshoots badly on
 * unevenly spaced control points, which is exactly what hand-clicked points are.
 *
 * The curve passes THROUGH every control point. That is the whole contract —
 * a GM clicking a point expects the outline to touch it.
 */

// ── Tuning ───────────────────────────────────────────────────────────────────

/** Centripetal parameterisation. 0 = uniform, 1 = chordal. */
const ALPHA = 0.5;

/** Nominal samples per control-point span, before the chord-length scaling. */
export const SMOOTHNESS_MIN     = 4;
export const SMOOTHNESS_MAX     = 24;
export const SMOOTHNESS_DEFAULT = 12;

/** Hard floor/ceiling on samples per span, whatever the chord length asks for. */
const MIN_SEGMENTS = 4;
const MAX_SEGMENTS = 24;

/**
 * Overshoot guard. A Hermite tangent longer than the segment's own chord loops
 * the curve back through itself on a tight corner; capping it at the shorter of
 * the two chords meeting at that point keeps every span inside a sane envelope.
 * Centripetal spacing already removes cusps WITHIN a span — this covers the
 * pathological control polygons (tight zigzags, near-duplicate clicks) it does
 * not. The clamp is scale-free, so it only ever binds where it is needed.
 */
const TANGENT_CLAMP = 1.0;

/** Two clicks closer than this are one click. */
const DEDUPE_EPSILON = 1e-3;

/** Tolerance in pixels for the outline comparison. Regeneration is deterministic. */
const MATCH_TOLERANCE = 0.5;

// ── Small helpers ────────────────────────────────────────────────────────────

const _clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const _dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

/**
 * Flat [x,y,…] to {x,y}[], dropping consecutive duplicates and a final point
 * that merely repeats the first (a closed curve supplies its own closing edge).
 * @param {number[]} flat
 * @returns {{x:number,y:number}[]}
 */
function _toPoints(flat) {
  if (!Array.isArray(flat)) return [];
  const out = [];
  for (let i = 0; i + 1 < flat.length; i += 2) {
    const x = Number(flat[i]);
    const y = Number(flat[i + 1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const prev = out[out.length - 1];
    if (prev && Math.abs(prev.x - x) < DEDUPE_EPSILON && Math.abs(prev.y - y) < DEDUPE_EPSILON) continue;
    out.push({ x, y });
  }
  // Wrap-around duplicate.
  while (out.length > 1) {
    const a = out[0];
    const b = out[out.length - 1];
    if (Math.abs(a.x - b.x) < DEDUPE_EPSILON && Math.abs(a.y - b.y) < DEDUPE_EPSILON) out.pop();
    else break;
  }
  return out;
}

/** Mean of a flat point array. Not the area centroid — this only has to be stable. */
function _mean(flat) {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let i = 0; i + 1 < flat.length; i += 2) {
    sx += flat[i];
    sy += flat[i + 1];
    n++;
  }
  return n ? { x: sx / n, y: sy / n, n } : { x: 0, y: 0, n: 0 };
}

// ── The curve ────────────────────────────────────────────────────────────────

/**
 * How many samples one span earns. Long spans get more than short ones — a
 * fixed count either facets a span running the width of the map or squanders
 * points on a span shorter than a grid square.
 * @param {number} chord      Span length in pixels.
 * @param {number} smoothness The GM's setting.
 * @param {number} gridSize   Scene grid size in pixels.
 * @returns {number}
 */
function _segmentsFor(chord, smoothness, gridSize) {
  const spacing = Math.max(4, gridSize / Math.max(1, smoothness / 4));
  return _clamp(Math.round(chord / spacing), MIN_SEGMENTS, MAX_SEGMENTS);
}

/** Shorten a tangent in place if it exceeds max. Direction is preserved. */
function _capTangent(m, max) {
  const len = Math.hypot(m.x, m.y);
  if (!(len > max) || !(len > 0)) return;
  const k = max / len;
  m.x *= k;
  m.y *= k;
}

/**
 * The two Hermite tangents for the span p1→p2, in the unit interval, under
 * centripetal knot spacing.
 *
 * Standard non-uniform Catmull-Rom: the parametric tangent at p1 is
 * (p2-p0)/(t2-t0); reparametrising t = t1 + s*(t2-t1) scales it by (t2-t1).
 * With every chord equal this reduces to (p2-p0)/2 — plain uniform
 * Catmull-Rom — which is the check that the formulation is right.
 */
function _tangents(p0, p1, p2, p3) {
  const d01 = Math.pow(_dist(p0, p1), ALPHA) || 1e-4;
  const d12 = Math.pow(_dist(p1, p2), ALPHA) || 1e-4;
  const d23 = Math.pow(_dist(p2, p3), ALPHA) || 1e-4;

  const m1 = {
    x: ((p2.x - p0.x) / (d01 + d12)) * d12,
    y: ((p2.y - p0.y) / (d01 + d12)) * d12,
  };
  const m2 = {
    x: ((p3.x - p1.x) / (d12 + d23)) * d12,
    y: ((p3.y - p1.y) / (d12 + d23)) * d12,
  };

  // Overshoot guard, applied per endpoint against the chords meeting there.
  const cPrev = _dist(p0, p1);
  const cThis = _dist(p1, p2);
  const cNext = _dist(p2, p3);
  _capTangent(m1, TANGENT_CLAMP * Math.min(cPrev || cThis, cThis));
  _capTangent(m2, TANGENT_CLAMP * Math.min(cNext || cThis, cThis));

  return { m1, m2 };
}

/**
 * Tessellate a CLOSED centripetal Catmull-Rom curve through controlPoints.
 *
 * @param {number[]} controlPoints   Flat [x,y,…] control points.
 * @param {object}  [options]
 * @param {number}  [options.smoothness] Nominal samples per span.
 * @param {number}  [options.gridSize]   Scene grid size, for chord scaling.
 * @returns {number[]|null}  Flat [x,y,…] curve, or null when the input is
 *                           degenerate (fewer than three distinct points) and
 *                           the caller should fall back to a straight polygon.
 */
export function splineClosed(controlPoints, { smoothness = SMOOTHNESS_DEFAULT, gridSize = 100 } = {}) {
  const pts = _toPoints(controlPoints);
  const n = pts.length;
  if (n < 3) return null;

  const s = _clamp(Number(smoothness) || SMOOTHNESS_DEFAULT, SMOOTHNESS_MIN, SMOOTHNESS_MAX);
  const g = Number(gridSize) > 0 ? Number(gridSize) : 100;

  const out = [];
  for (let i = 0; i < n; i++) {
    // Closed: neighbours wrap. This is the whole difference from the open form
    // in ship-vfx-anchors.js, which clamps at the ends instead.
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];

    const { m1, m2 } = _tangents(p0, p1, p2, p3);
    const segs = _segmentsFor(_dist(p1, p2), s, g);

    // t = 0 emits p1 itself, so the curve provably passes through every control
    // point; t = 1 is the next span's t = 0 and is left to it.
    for (let k = 0; k < segs; k++) {
      const t  = k / segs;
      const t2 = t * t;
      const t3 = t2 * t;
      const h00 =  (2 * t3) - (3 * t2) + 1;
      const h10 =  t3 - (2 * t2) + t;
      const h01 = (-2 * t3) + (3 * t2);
      const h11 =  t3 - t2;
      out.push(
        (h00 * p1.x) + (h10 * m1.x) + (h01 * p2.x) + (h11 * m2.x),
        (h00 * p1.y) + (h10 * m1.y) + (h01 * p2.y) + (h11 * m2.y),
      );
    }
  }
  return out.length >= 6 ? out : null;
}

/**
 * Count the distinct control points in a flat array — the caller's cheap test
 * for "is there enough here to curve?".
 * @param {number[]} flat
 * @returns {number}
 */
export function distinctPointCount(flat) {
  return _toPoints(flat).length;
}

// ── Matching a stored control set back to a live shape ───────────────────────

/**
 * Do two flat point arrays describe the same outline, allowing for the whole
 * thing having been translated?
 *
 * Matching by regeneration rather than by shape index is what survives a shape
 * being deleted, reordered, or the Region being dragged. It does NOT survive
 * the scale or rotate handles — a transformed shape simply stops matching and
 * reverts to being an ordinary fixed polygon.
 *
 * @param {number[]} a
 * @param {number[]} b
 * @returns {boolean}
 */
export function sameOutline(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length < 6) return false;
  const ca = _mean(a);
  const cb = _mean(b);
  for (let i = 0; i + 1 < a.length; i += 2) {
    if (Math.abs((a[i] - ca.x) - (b[i] - cb.x)) > MATCH_TOLERANCE) return false;
    if (Math.abs((a[i + 1] - ca.y) - (b[i + 1] - cb.y)) > MATCH_TOLERANCE) return false;
  }
  return true;
}

/**
 * The translation that carries `from` onto `to` — how far the Region was moved
 * since its control points were recorded.
 * @param {number[]} from
 * @param {number[]} to
 * @returns {{x:number,y:number}}
 */
export function outlineOffset(from, to) {
  const a = _mean(from);
  const b = _mean(to);
  return { x: b.x - a.x, y: b.y - a.y };
}

/**
 * A copy of a flat point array translated by `offset`.
 * @param {number[]} flat
 * @param {{x:number,y:number}} offset
 * @returns {number[]}
 */
export function translatePoints(flat, offset) {
  const out = flat.slice();
  for (let i = 0; i + 1 < out.length; i += 2) {
    out[i] += offset.x;
    out[i + 1] += offset.y;
  }
  return out;
}
