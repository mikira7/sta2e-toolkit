/**
 * sta2e-toolkit | forcefield-data.js
 *
 * The rules of the forcefield door, with NO imports, so tests/forcefield.mjs
 * can load it bare: the wall flags, the style table, which walls carry a field,
 * whether a field is up, the quad that frames a wall, the power ramp, and the
 * nearest point on a wall (for the contact flare).
 *
 * A forcefield is a DOOR wall with the flag `forcefield`. Its field is up while
 * the door is Closed or Locked and down while it is Open — so anything that
 * already drives doors (the door control, Door & Light Control, Region Logic,
 * a macro) drives the field, and Foundry replicates the state itself.
 */

export const MODULE = "sta2e-toolkit";

/** Flag keys on the WallDocument, all on their native form path. */
export const FF_FLAGS = Object.freeze({
  enabled:   "forcefield",
  style:     "ffStyle",
  color:     "ffColor",
  intensity: "ffIntensity",
  thickness: "ffThickness",
  above:     "ffAboveTokens",
  soundUp:   "ffSoundUp",
  soundDown: "ffSoundDown",
  soundHit:  "ffSoundContact",
  volume:    "ffVolume",
  radius:    "ffSoundRadius",
});

/**
 * Looks. `pattern` is the shader's pattern index: 0 hexagonal cells, 1 bands
 * running along the field (a brig), 2 churning plasma. `color` is the field,
 * `core` the emitter line and the nodes at each end.
 */
export const FF_STYLES = Object.freeze({
  starfleet:  { label: "Starfleet",        color: "#4d9dff", core: "#d8ecff", pattern: 0 },
  brig:       { label: "Starfleet Brig",   color: "#5fc8ff", core: "#e6f8ff", pattern: 1 },
  klingon:    { label: "Klingon",          color: "#ff3a1f", core: "#ffc2a8", pattern: 0 },
  romulan:    { label: "Romulan",          color: "#2fd06a", core: "#c8ffd8", pattern: 2 },
  cardassian: { label: "Cardassian",       color: "#ff9a2a", core: "#ffe2b0", pattern: 1 },
  borg:       { label: "Borg",             color: "#46d42a", core: "#d4ffc0", pattern: 2 },
});
export const FF_STYLE_ORDER = Object.freeze(Object.keys(FF_STYLES));

export const FF_DEFAULTS = Object.freeze({
  style: "starfleet",
  color: "",          // blank = the style's own colour
  intensity: 80,      // 0–100
  thickness: 30,      // % of a grid square for the whole glow
  above: false,
  volume: 0.8,
});

/** Ramp lengths, ms. Exported so the tests and the renderer agree. */
export const FF_RAMP_UP_MS = 750;
export const FF_RAMP_DOWN_MS = 420;

// Foundry's CONST values, restated so this file needs no globals.
const DOOR_NONE = 0;
const DS_OPEN = 1;

function _flags(doc) {
  return doc?.flags?.[MODULE] ?? doc?._source?.flags?.[MODULE] ?? {};
}

const _num = (v, fallback) => {
  if (v === null || v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const _clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** "#rgb" / "#rrggbb" → [r, g, b] in 0–1, or null. */
export function hexToRgb(hex) {
  let s = String(hex ?? "").trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(s)) s = s.split("").map(c => c + c).join("");
  if (!/^[0-9a-f]{6}$/i.test(s)) return null;
  const n = parseInt(s, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Does this wall carry a forcefield? Only door walls do. */
export function isForcefieldWall(doc) {
  if (!doc) return false;
  if ((Number(doc.door) || DOOR_NONE) === DOOR_NONE) return false;
  return _flags(doc)[FF_FLAGS.enabled] === true;
}

/** Is the field up? Closed and Locked are up; Open is down. */
export function isFieldUp(doc) {
  return isForcefieldWall(doc) && Number(doc.ds) !== DS_OPEN;
}

/** The wall's look, every value resolved and clamped. */
export function forcefieldConfig(doc) {
  const f = _flags(doc);
  const styleId = FF_STYLES[f[FF_FLAGS.style]] ? f[FF_FLAGS.style] : FF_DEFAULTS.style;
  const style = FF_STYLES[styleId];
  const custom = hexToRgb(f[FF_FLAGS.color]);
  return {
    style: styleId,
    pattern: style.pattern,
    color: custom ?? hexToRgb(style.color),
    // A custom colour gets a core lifted toward white from itself, so the two
    // never disagree in hue.
    core: custom ? custom.map(c => c + (1 - c) * 0.75) : hexToRgb(style.core),
    intensity: _clamp(_num(f[FF_FLAGS.intensity], FF_DEFAULTS.intensity), 0, 100) / 100,
    thickness: _clamp(_num(f[FF_FLAGS.thickness], FF_DEFAULTS.thickness), 5, 100) / 100,
    above: f[FF_FLAGS.above] === true,
    soundUp: String(f[FF_FLAGS.soundUp] ?? "").trim(),
    soundDown: String(f[FF_FLAGS.soundDown] ?? "").trim(),
    soundHit: String(f[FF_FLAGS.soundHit] ?? "").trim(),
    volume: _clamp(_num(f[FF_FLAGS.volume], FF_DEFAULTS.volume), 0, 1),
    radius: Math.max(0, _num(f[FF_FLAGS.radius], 0)),
  };
}

/**
 * The quad that frames a wall. The shader draws in a unit quad, so this gives
 * where its origin goes, how it is turned and how big it is:
 *
 *   x runs along the wall, from `pad` before its first end to `pad` past its
 *   second (the emitter nodes glow past the ends); y runs across it, centred.
 *
 * `thick` is the full width of the glow in px. Returns null for a wall with no
 * length.
 */
export function wallQuad(c, gridSize, thicknessFrac) {
  const [x0, y0, x1, y1] = (c ?? []).map(Number);
  if (![x0, y0, x1, y1].every(Number.isFinite)) return null;
  const dx = x1 - x0, dy = y1 - y0;
  const seg = Math.hypot(dx, dy);
  if (seg < 1) return null;
  const grid = Math.max(1, Number(gridSize) || 100);
  const thick = Math.max(6, grid * thicknessFrac);
  const pad = Math.max(4, thick * 0.5);
  const ux = dx / seg, uy = dy / seg;
  return {
    x: x0 - ux * pad,
    y: y0 - uy * pad,
    rotation: Math.atan2(dy, dx),
    length: seg + pad * 2,
    thick,
    pad,
    seg,
  };
}

/** The point on segment c nearest (px, py), and how far along it lies (px). */
export function nearestOnWall(c, px, py) {
  const [x0, y0, x1, y1] = (c ?? []).map(Number);
  const dx = x1 - x0, dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? _clamp(((px - x0) * dx + (py - y0) * dy) / len2, 0, 1) : 0;
  const x = x0 + dx * t, y = y0 + dy * t;
  return { x, y, t, along: t * Math.sqrt(len2), dist: Math.hypot(px - x, py - y) };
}

/**
 * Did a move from p0 toward p1 run into the wall? The move is extended by
 * `reach` px past p1, because a token stopped by a closed door ends short of
 * it — so a token that walked up to a field and stopped counts, and one that
 * walked along beside it does not. Returns the crossing point and how far
 * along the wall it is (px), or null.
 */
export function moveHitsWall(c, p0, p1, reach = 0) {
  const [x0, y0, x1, y1] = (c ?? []).map(Number);
  let mx = p1.x - p0.x, my = p1.y - p0.y;
  const mlen = Math.hypot(mx, my);
  if (mlen < 0.5) return null;
  const ex = p1.x + (mx / mlen) * reach, ey = p1.y + (my / mlen) * reach;
  mx = ex - p0.x; my = ey - p0.y;
  const wx = x1 - x0, wy = y1 - y0;
  const den = mx * wy - my * wx;
  if (Math.abs(den) < 1e-9) return null;                 // parallel
  const ox = x0 - p0.x, oy = y0 - p0.y;
  const s = (ox * wy - oy * wx) / den;                   // along the move, 0..1
  const u = (ox * my - oy * mx) / den;                   // along the wall, 0..1
  if (s < 0 || s > 1 || u < 0 || u > 1) return null;
  return { x: x0 + wx * u, y: y0 + wy * u, along: u * Math.hypot(wx, wy) };
}

/**
 * Where a ramp stands. `ramp` is {from, to, start, ms}; returns power 0–1 and
 * whether it is still moving. Up eases out, down eases in, so a field snaps
 * up and drains away.
 */
export function rampPower(ramp, now) {
  if (!ramp) return { power: 0, moving: false };
  const ms = Math.max(1, ramp.ms);
  const k = _clamp((now - ramp.start) / ms, 0, 1);
  const rising = ramp.to > ramp.from;
  const e = rising ? 1 - (1 - k) * (1 - k) : k * k;
  return { power: ramp.from + (ramp.to - ramp.from) * e, moving: k < 1, k, rising };
}

/**
 * The flicker while a field comes up: a few hard dropouts in the first half,
 * steady after. Purely local: each client flickers on its own clock, which
 * nobody can compare.
 */
export function riseFlicker(k, seed, now) {
  if (k >= 0.6) return 1;
  const step = Math.floor(now / 45) + Math.floor(seed * 97);
  const h = (Math.sin(step * 12.9898) * 43758.5453) % 1;   // small arguments only
  const r = Math.abs(h);
  const gate = r < 0.35 * (1 - k / 0.6) ? 0.15 : 1;
  return gate;
}
