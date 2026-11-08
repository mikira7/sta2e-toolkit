/**
 * Tractor beam towing geometry — a leaf with NO imports.
 *
 * A towed ship is held at a rigid offset in the HOST's local frame: the target's
 * centre unrotated by the host's rotation, plus the rotation and elevation
 * differences. The target's pose is then computed from the host's pose alone,
 * so it is idempotent — overlapping or stale updates (the ~44 steps of an
 * impulse arc) can never drift, which the old delta-tracking follow did.
 *
 * Rotation convention matches the rest of the module: Foundry rotation in
 * degrees, ship art drawn nose-south, so at rotation 0 "behind" is −y.
 *
 * Geometry works on a BOX: `{x, y, w, h, rotation, elevation}`, top-left x/y and
 * size in PIXELS. Build one with `towBox`, which takes the size from core's
 * `getSize` (hex grids are not `width × grid.size`).
 */

const DEG = Math.PI / 180;

/**
 * A token document's box.
 *
 * `final: true` (the default) reads `_source` — where the token IS. Core merges
 * every animation frame into the document's own properties, and runs the first
 * frame synchronously inside `_onUpdate`, so in an `updateToken` hook `doc.x`
 * is where the token is DRAWN (about where it started), not where it is going.
 * Reading that was what put the towed ship a move behind. `final: false` is the
 * drawn pose, which is what the render pin wants.
 */
export function towBox(doc, { final = true, gridSize = 100 } = {}) {
  const d = (final ? doc?._source : null) ?? doc ?? {};
  let w = null, h = null;
  try {
    const size = doc?.getSize?.({ width: d.width, height: d.height });
    if (size) { w = size.width; h = size.height; }
  } catch { /* no grid yet */ }
  return {
    x: d.x ?? 0,
    y: d.y ?? 0,
    w: Number.isFinite(w) ? w : (d.width ?? 1) * gridSize,
    h: Number.isFinite(h) ? h : (d.height ?? 1) * gridSize,
    rotation: d.rotation ?? 0,
    elevation: d.elevation ?? 0,
  };
}

function _centre(b) {
  return { x: (b.x ?? 0) + (b.w ?? 0) / 2, y: (b.y ?? 0) + (b.h ?? 0) / 2 };
}

/** Capture the target's current pose relative to the host. */
export function captureTowOffset(src, tgt) {
  const sc = _centre(src);
  const tc = _centre(tgt);
  const wx = tc.x - sc.x;
  const wy = tc.y - sc.y;
  const r  = (src.rotation ?? 0) * DEG;
  const cos = Math.cos(r), sin = Math.sin(r);
  return {
    lx:    wx * cos + wy * sin,
    ly:   -wx * sin + wy * cos,
    drot:  (tgt.rotation ?? 0) - (src.rotation ?? 0),
    delev: (tgt.elevation ?? 0) - (src.elevation ?? 0),
  };
}

/** The target's pose (top-left x/y, its centre too) for a host box and an offset. */
export function towPose(src, offset, tgt) {
  const sc = _centre(src);
  const r  = (src.rotation ?? 0) * DEG;
  const cos = Math.cos(r), sin = Math.sin(r);
  const lx = offset?.lx ?? 0, ly = offset?.ly ?? 0;
  const cx = sc.x + lx * cos - ly * sin;
  const cy = sc.y + lx * sin + ly * cos;
  let rotation = ((src.rotation ?? 0) + (offset?.drot ?? 0)) % 360;
  if (rotation < 0) rotation += 360;
  return {
    x: cx - (tgt?.w ?? 0) / 2,
    y: cy - (tgt?.h ?? 0) / 2,
    cx, cy,
    rotation,
    elevation: (src.elevation ?? 0) + (offset?.delev ?? 0),
  };
}

/** Offset for a lock made before offsets were stored: straight behind at towDist. */
export function legacyTowOffset(towDist) {
  return { lx: 0, ly: -(towDist ?? 0), drot: 0, delev: 0 };
}

/** The default tow distance between two boxes (half of each plus a fifth of a square). */
export function defaultTowDist(src, tgt, gridSize = 100) {
  return (src?.w ?? gridSize) * 0.5 + (tgt?.w ?? gridSize) * 0.5 + gridSize * 0.2;
}

/** The offset a lock tows at: its stored one, else straight behind. */
export function resolveTowOffset(state, src, tgt, gridSize = 100) {
  if (state?.tow) return state.tow;
  return legacyTowOffset(state?.towDist ?? defaultTowDist(src, tgt, gridSize));
}
