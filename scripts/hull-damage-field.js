/**
 * sta2e-toolkit | hull-damage-field.js
 *
 * The maths behind painted hull damage. A LEAF with NO IMPORTS, so it runs
 * under Node for the tests and in a plain browser page for the preview.
 *
 * Every hit paints a brush into one scalar DAMAGE FIELD laid over the token
 * art (field pixel = art pixel, downscaled to at most FIELD_MAX). Overlapping
 * hits add, so a wound deepens under repeated fire. `composeDamage` then turns
 * that one number into layers by threshold:
 *
 *   < scorch          untouched hull (transparent overlay)
 *   scorch .. peel    soot and heat tint over the plating
 *   ~peel             the torn edge of the outer plating, lit by a fixed light
 *   peel .. breach    the inner hull: decks, ribs, conduits, a few lit rooms
 *   > breach          open to space: near-black void
 *
 * A second, additive layer carries the heat: a glowing rim on the peel edge
 * and embers deep in the wound, both scaled by each hit's `heat` (which the
 * renderer cools over combat rounds). Depth is faked from a blurred copy of
 * the field used as a height map: wall shading and the shadow under the lip.
 *
 * Everything is deterministic from each hit's `seed`, so every client
 * regenerates the same wound from the flag alone — no pixels are stored.
 */

export const FIELD_MAX = 384;

/** Field thresholds. Tuned together with SEVERITY strengths below. */
export const T = Object.freeze({ scorch: 0.12, peel: 0.42, breach: 0.95 });

/**
 * `size` is the old decal diameter as a fraction of the ship's drawn extent
 * (kept so the two styles mark a ship at the same scale); `strength` is the
 * field value at the centre of a hit. Light hits open the plating, medium ones
 * reach deep, only heavy ones reliably hole the hull.
 */
export const SEVERITY = Object.freeze({
  light:  { size: 0.16, strength: 0.7 },
  medium: { size: 0.22, strength: 0.92 },
  heavy:  { size: 0.32, strength: 1.15 },
});

/** beam = phaser gouge · bolt = disruptor/cannon splatter · torpedo = crater with cracks. */
export const KINDS = Object.freeze(["beam", "bolt", "torpedo"]);

// ── small maths ──────────────────────────────────────────────────────────────

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

export function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** FNV-style hash of a few numbers to a uint32 seed. */
export function hashSeed(...nums) {
  let h = 2166136261;
  for (const n of nums) {
    h ^= Math.round(num(n) * 10000) | 0;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function _h2(ix, iy, s) {
  let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iy | 0, 0x165667b1) ^ Math.imul(s | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function _vnoise(x, y, s) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = _h2(ix, iy, s), b = _h2(ix + 1, iy, s);
  const c = _h2(ix, iy + 1, s), d = _h2(ix + 1, iy + 1, s);
  return (a + (b - a) * ux) + ((c + (d - c) * ux) - (a + (b - a) * ux)) * uy;
}

/** Fractal value noise in [0, 1]. */
export function fbm(x, y, s, octaves = 3) {
  let amp = 0.5, f = 1, sum = 0, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * _vnoise(x * f, y * f, (s + o * 1013) | 0);
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return sum / norm;
}

function _rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function _wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

// ── hits ─────────────────────────────────────────────────────────────────────

/**
 * A stored hit (the `hullDecals` flag entry) made safe to paint. Old decal
 * entries carry no kind, seed or dir; they paint as torpedo craters with a
 * seed derived from their position, and their decal spin as the direction.
 */
export function normalizeHit(raw, index = 0) {
  const h = raw ?? {};
  const kind = KINDS.includes(h.kind) ? h.kind : "torpedo";
  const sev = SEVERITY[h.sev] ? h.sev : "medium";
  return {
    nx: clamp(num(h.nx), -0.75, 0.75),
    ny: clamp(num(h.ny), -0.75, 0.75),
    sev,
    kind,
    dir: Number.isFinite(h.dir) ? h.dir : num(h.rot),
    seed: Number.isFinite(h.seed) ? (h.seed >>> 0) : hashSeed(h.nx, h.ny, index + 1),
    heat: clamp(num(h.heat), 0, 1),
  };
}

/** Crater: a ragged bowl, a scorch halo, and radial cracks (torpedoes). */
function _craterBrush(R, s, seed, crackCount) {
  const r = _rng(seed ^ 0xc0ffee);
  const cracks = [];
  for (let k = 0; k < crackCount; k++) {
    cracks.push({
      th: (k / crackCount) * Math.PI * 2 + (r() - 0.5) * 1.1,
      len: 1.15 + r() * 1.0,
      w: 0.045 + r() * 0.04,
      k,
    });
  }
  const ns = R * 0.32, hs = R * 0.8;
  return (a, b, same = true) => {
    const rad = Math.hypot(a, b) / R;
    if (rad > 2.4) return 0;
    const th = Math.atan2(b, a);
    const warp = 0.7 + 0.6 * fbm(Math.cos(th) * 1.6 + 3.1, Math.sin(th) * 1.6 + 7.7, seed, 3);
    const n = fbm(a / ns + 11, b / ns + 5, seed ^ 0x5bd1, 3);
    const rr = rad / warp;
    let v = s * 0.75 * Math.exp(-2.2 * rr * rr) * (0.65 + 0.7 * n);
    v += s * 0.25 * Math.exp(-(rad * rad) / 3.6) * (0.55 + 0.9 * fbm(a / hs, b / hs, seed ^ 77, 2));
    // Cracks run through plating, not through a bulkhead: they stop at the
    // edge of the section the hit landed in.
    if (same) for (const c of cracks) {
      if (rad >= c.len) continue;
      const jitter = (fbm(rad * 2.5, c.k * 3.7, seed, 2) - 0.5) * 0.7;
      const dth = _wrapAngle(th - c.th - jitter);
      if (Math.abs(dth) > 1.2) continue;
      const perp = rad * Math.abs(Math.sin(dth));
      const fade = 1 - rad / c.len;
      const wc = c.w * fade + 0.012;
      v += s * 0.55 * fade * Math.exp(-((perp / wc) ** 2));
    }
    return v;
  };
}

/**
 * Gouge: a phaser cut laid along the beam. The cut runs from behind the impact
 * point (a < 0) through it and a little past, deepest just at the impact.
 */
function _gougeBrush(R, s, seed) {
  const a0 = -1.8 * R, a1 = 1.0 * R, len = a1 - a0;
  const tImpact = -a0 / len;
  const ns = R * 0.3;
  return (a, b) => {
    const t = clamp((a - a0) / len, 0, 1);
    const da = a - (a0 + t * len);
    const bb = b + (fbm(a / (R * 1.1), 4.2, seed ^ 9, 2) - 0.5) * R * 0.4;
    const wn = fbm(a / (R * 0.7) + 2, 9.1, seed, 3);
    const wid = R * 0.42 * (0.3 + 0.7 * Math.pow(Math.sin(Math.PI * t), 0.6)) * (0.75 + 0.5 * wn);
    const dist = Math.hypot(da, bb);
    if (dist > R * 2.2) return 0;
    const q = dist / Math.max(wid, 0.5);
    const depth = s * (0.5 + 0.5 * smoothstep(0, tImpact, t)) * (1 - 0.4 * smoothstep(tImpact, 1, t));
    const n = fbm(a / ns, b / ns, seed ^ 0x33, 3);
    let v = depth * Math.exp(-1.4 * q * q) * (0.7 + 0.6 * n);
    const qh = dist / (R * 0.9 + wid);
    v += s * 0.24 * Math.exp(-qh * qh * 1.2) * (0.5 + n);
    return v;
  };
}

/** Splatter: a cluster of small craters (disruptor bolts, cannons). */
function _splatterBrush(R, s, seed) {
  const r = _rng(seed ^ 0xb017);
  const count = 3 + Math.floor(r() * 3);
  const blobs = [];
  for (let k = 0; k < count; k++) {
    const ang = r() * Math.PI * 2, dist = (k === 0 ? 0 : 0.5 + r() * 0.6) * R;
    const br = R * (k === 0 ? 0.6 : 0.3 + r() * 0.22);
    blobs.push({ x: Math.cos(ang) * dist, y: Math.sin(ang) * dist, fn: _craterBrush(br, s * (k === 0 ? 0.88 : 0.66), (seed + k * 7919) >>> 0, 0) });
  }
  const hs = R * 0.7;
  return (a, b) => {
    // MAX, not sum: each blob's own halo is wide, and summing them filled the
    // gaps between the pits into one big hole.
    let v = 0;
    for (const bl of blobs) v = Math.max(v, bl.fn(a - bl.x, b - bl.y));
    const rad = Math.hypot(a, b) / R;
    v += s * 0.16 * Math.exp(-(rad * rad) / 2.2) * (0.5 + fbm(a / hs, b / hs, seed ^ 21, 2));
    return v;
  };
}

/** Section under (or nearest to) a field point; -1 if none within 8 px. */
function _sectionNear(hull, x, y) {
  const { W, H, label } = hull;
  const xi = Math.round(x), yi = Math.round(y);
  for (let r = 0; r <= 8; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const px = xi + dx, py = yi + dy;
        if (px < 0 || py < 0 || px >= W || py >= H) continue;
        const l = label[py * W + px];
        if (l >= 0) return l;
      }
    }
  }
  return -1;
}

function _brushFor(hit, R, strength) {
  if (hit.kind === "beam") return { fn: _gougeBrush(R, strength, hit.seed), reach: R * 3.2 };
  if (hit.kind === "bolt") return { fn: _splatterBrush(R, strength, hit.seed), reach: R * 2.6 };
  return { fn: _craterBrush(R, strength, hit.seed, 4 + (hit.seed % 4)), reach: R * 2.4 };
}

/**
 * Paint every hit into the damage field.
 *
 * @param {object[]} hits      stored hit entries (normalised here)
 * @param {object}   geo
 *   W, H        field size in px (the art, downscaled)
 *   alpha       Uint8Array W*H hull alpha 0..255 (cracks never paint into space)
 *   shipPx      geometric mean of the hull silhouette's size, in field px
 *   boxX, boxY  field px per token-box unit — a hit at nx sits at W/2 + nx*boxX
 *   aniso       (field px per token px on Y) / (on X); 1 unless the art is fit with "fill"
 *   scale       global size multiplier (the Hull Decal Size setting)
 *   hull        optional hull analysis (hull-sections.js) of the same W×H:
 *               cracks stop at the bulkheads between its sections
 * @returns {{d: Float32Array, heat: Float32Array}}
 */
export function buildDamageField(hits, geo) {
  const { W, H, alpha } = geo;
  const d = new Float32Array(W * H);
  const heat = new Float32Array(W * H);
  const shipPx = Math.max(4, num(geo.shipPx, Math.min(W, H)));
  const scale = num(geo.scale, 1) || 1;
  const boxX = num(geo.boxX, W), boxY = num(geo.boxY, H);
  // A hit's `dir` is in token-box pixels; field px per token px may differ by
  // axis under a "fill" fit, so the direction is squashed by that ratio.
  const aniso = num(geo.aniso, 1) || 1;
  const hull = geo.hull && geo.hull.W === W && geo.hull.H === H ? geo.hull : null;

  (hits ?? []).forEach((raw, idx) => {
    const hit = normalizeHit(raw, idx);
    const sev = SEVERITY[hit.sev];
    // 0.2 of the old decal diameter fraction: halved from 0.4 after a look in a
    // real world, where wounds on one-square tokens read twice too large.
    const R = clamp(sev.size * 0.2 * shipPx * scale, 2, 0.25 * Math.min(W, H));
    const { fn, reach } = _brushFor(hit, R, sev.strength);
    const X = W / 2 + hit.nx * boxX;
    const Y = H / 2 + hit.ny * boxY;
    const dir = Math.atan2(Math.sin(hit.dir) * aniso, Math.cos(hit.dir));
    const cs = Math.cos(dir), sn = Math.sin(dir);
    const home = hull ? _sectionNear(hull, X, Y) : -1;
    const x0 = Math.max(0, Math.floor(X - reach)), x1 = Math.min(W - 1, Math.ceil(X + reach));
    const y0 = Math.max(0, Math.floor(Y - reach)), y1 = Math.min(H - 1, Math.ceil(Y + reach));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * W + x;
        if (alpha && alpha[i] < 8) continue;
        const dx = x - X, dy = y - Y;
        const a = dx * cs + dy * sn;
        const b = -dx * sn + dy * cs;
        // Capped just over the hit's strength: noise can lift a crater's
        // centre ~40% above it, which let a light hit hole the hull. Only
        // repeated fire (the field sums) or a heavy hit should do that.
        const same = home < 0 || hull.label[i] === home;
        const v = Math.min(fn(a, b, same), sev.strength * 1.05);
        if (v <= 0.002) continue;
        d[i] += v;
        const hv = hit.heat * smoothstep(0.28, 0.55, v);
        if (hv > heat[i]) heat[i] = hv;
      }
    }
  });
  return { d, heat };
}

// ── composite ────────────────────────────────────────────────────────────────

function _boxBlur(src, W, H, r) {
  const tmp = new Float32Array(W * H), out = new Float32Array(W * H);
  const span = 2 * r + 1;
  for (let y = 0; y < H; y++) {
    let acc = 0;
    for (let x = -r; x <= r; x++) acc += src[y * W + clamp(x, 0, W - 1)];
    for (let x = 0; x < W; x++) {
      tmp[y * W + x] = acc / span;
      acc += src[y * W + clamp(x + r + 1, 0, W - 1)] - src[y * W + clamp(x - r, 0, W - 1)];
    }
  }
  for (let x = 0; x < W; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[clamp(y, 0, H - 1) * W + x];
    for (let y = 0; y < H; y++) {
      out[y * W + x] = acc / span;
      acc += tmp[clamp(y + r + 1, 0, H - 1) * W + x] - tmp[clamp(y - r, 0, H - 1) * W + x];
    }
  }
  return out;
}

// ── the exposed inner hull ───────────────────────────────────────────────────
//
// Every pattern speaks the same small vocabulary — deck panels (a tone per
// panel), seams between them, structural members (ribs, rings, spars, frames),
// conduits, the odd lit room — and differs only in the coordinates it lays
// them out on. With a hull analysis (hull-sections.js) each section picks its
// own: a saucer is polar about its centre, a nacelle runs along its own axis,
// anything else follows its outline. Without one, the old image-aligned grid.

const _frac = (v) => v - Math.floor(v);
const STEEL = [96, 99, 108];
const CONDUIT = [66, 84, 114];
const CORE = [70, 108, 168];
const ROOM = [205, 176, 118];
const BULKHEAD = [118, 114, 104];   // the heavy wall where two sections meet

function _set(out, c, f = 1) { out[0] = c[0] * f; out[1] = c[1] * f; out[2] = c[2] * f; }
function _panel(out, hsh) {
  const base = 76 + (hsh - 0.5) * 28;
  out[0] = base * 0.94; out[1] = base; out[2] = base * 1.12;
}
const _seam = (out) => { out[0] *= 0.5; out[1] *= 0.5; out[2] *= 0.55; };

/** Image-aligned grid: the fallback when there is no hull analysis. */
function _gridStructure(x, y, cell, out) {
  const ch = cell * 0.62;
  const cx = Math.floor(x / cell), cy = Math.floor(y / ch);
  const fx = x / cell - cx, fy = y / ch - cy;
  const hsh = _h2(cx, cy, 431);
  _panel(out, hsh);
  if (fx < 0.08 || fy < 0.1) _seam(out);
  if ((((cx % 4) + 4) % 4) === 0 && fx < 0.34) _set(out, STEEL);
  if ((((cy % 5) + 5) % 5) === 2 && fy > 0.38 && fy < 0.62) _set(out, CONDUIT);
  if (hsh > 0.93 && fx > 0.3 && fx < 0.7 && fy > 0.28 && fy < 0.72) _set(out, ROOM);
}

/**
 * Saucer: concentric decks and radial spars about the section's centre. The
 * spar count doubles outward (8, 16, 32, 64) so the panels stay roughly square
 * at every radius; every fourth ring and every main spar is heavy structure.
 */
function _discStructure(x, y, cell, sec, out) {
  const dx = x - sec.cx, dy = y - sec.cy;
  const r = Math.hypot(dx, dy);
  if (r < cell * 1.6) { _set(out, CORE, 0.8); if (r < cell * 0.7) _set(out, CORE, 1.15); return; }
  const ring = r / (cell * 0.75), ri = Math.floor(ring), fr = ring - ri;
  const level = Math.max(0, Math.min(3, Math.floor(Math.log2(Math.max(1, r / (cell * 3))))));
  const n = 8 << level;
  const u = (Math.atan2(dy, dx) / (Math.PI * 2) + 0.5) * n, ui = Math.floor(u), fu = u - ui;
  const arc = Math.min(fu, 1 - fu) * (Math.PI * 2 * r / n);     // px to the nearest spar
  const mainArc = Math.min(_frac(u / (n / 8)), 1 - _frac(u / (n / 8))) * (Math.PI * 2 * r / 8);
  const hsh = _h2(ri, ui + n * 7, 977);
  _panel(out, hsh);
  if (fr < 0.1 || arc < cell * 0.09) _seam(out);
  if ((ri % 4 === 0 && fr < 0.32) || mainArc < cell * 0.22) _set(out, STEEL);
  else if (ri % 6 === 3 && fr > 0.4 && fr < 0.62) _set(out, CONDUIT);
  else if (hsh > 0.93 && fr > 0.3 && fr < 0.7 && arc > cell * 0.25) _set(out, ROOM);
}

/**
 * Nacelle, pylon or boom: frames across the section's long axis, stringers
 * along it following the taper (contours of distance-to-edge, not straight
 * lines), and a conduit glowing down the core.
 */
function _longStructure(x, y, i, cell, sec, hull, out) {
  const ca = Math.cos(sec.axis), sa = Math.sin(sec.axis);
  const u = (x - sec.cx) * ca + (y - sec.cy) * sa;
  const d = hull.dist[i];
  const fu = _frac(u / (cell * 0.8)), ui = Math.floor(u / (cell * 0.8));
  const q = d / (cell * 0.5), qi = Math.floor(q);
  const hsh = _h2(ui, qi, 613);
  _panel(out, hsh);
  if (_frac(q) < 0.15) _seam(out);
  if (fu < 0.2) _set(out, STEEL, ((ui % 4) + 4) % 4 === 0 ? 1.12 : 0.85);
  if (d > sec.peak * 0.68) {
    const core = (d - sec.peak * 0.68) / Math.max(0.5, sec.peak * 0.32);
    _set(out, CORE, 0.8 + 0.45 * core);
  } else if (hsh > 0.95 && fu > 0.35 && fu < 0.75) _set(out, ROOM);
}

/**
 * Everything else, and the base of the idea: decks as contours of the
 * distance to the hull's edge, so they run parallel to the outline on any
 * shape. Spars are frames across the section's long axis. (Laying them out
 * along the edge instead — projecting each pixel's nearest edge point on the
 * local tangent — was tried: it breaks into confetti wherever the nearest edge
 * switches sides, which is the whole middle of a hull, so it is kept only for
 * a pixel with no section.)
 */
function _contourStructure(x, y, i, cell, hull, sec, out) {
  const d = hull.dist[i];
  let s;
  if (sec) {
    s = (x - sec.cx) * Math.cos(sec.axis) + (y - sec.cy) * Math.sin(sec.axis);
  } else {
    const ex = hull.nearX[i], ey = hull.nearY[i];
    let nx = x - ex, ny = y - ey;
    const nl = Math.hypot(nx, ny) || 1;
    nx /= nl; ny /= nl;
    s = ex * -ny + ey * nx;                             // position along the edge
  }
  const q = d / (cell * 0.62), qi = Math.floor(q), fq = q - qi;
  const sp = s / (cell * 1.4), si = Math.floor(sp), fs = sp - si;
  const hsh = _h2(qi, si, 211);
  _panel(out, hsh);
  if (fq < 0.12) _seam(out);
  if ((qi % 4 === 0 && fq < 0.3) || fs < 0.16) _set(out, STEEL);
  else if (qi % 5 === 2 && fq > 0.38 && fq < 0.62) _set(out, CONDUIT);
  else if (hsh > 0.93 && fq > 0.3 && fq < 0.7 && fs > 0.3 && fs < 0.8) _set(out, ROOM);
}

function _structure(x, y, i, cell, hull, out) {
  if (!hull) return _gridStructure(x, y, cell, out);
  const sec = hull.sections[hull.label[i]];
  if (sec?.kind === "disc") return _discStructure(x, y, cell, sec, out);
  if (sec?.kind === "long") return _longStructure(x, y, i, cell, sec, hull, out);
  return _contourStructure(x, y, i, cell, hull, sec ?? null, out);
}

/** True where a pixel sits within 2 px of another section: a bulkhead. */
function _isBulkhead(hull, x, y, i) {
  const { W, H, label } = hull;
  const l = label[i];
  if (l < 0) return false;
  for (let k = 1; k <= 2; k++) {
    if (x - k >= 0 && label[i - k] >= 0 && label[i - k] !== l) return true;
    if (x + k < W && label[i + k] >= 0 && label[i + k] !== l) return true;
    if (y - k >= 0 && label[i - k * W] >= 0 && label[i - k * W] !== l) return true;
    if (y + k < H && label[i + k * W] >= 0 && label[i + k * W] !== l) return true;
  }
  return false;
}

export const DEFAULT_PALETTE = Object.freeze({
  soot:     [24, 19, 16],
  tint:     [74, 36, 14],     // heat discolouration near the tear
  metal:    [170, 170, 176],  // the torn plating edge
  void:     [5, 6, 9],
  rimCool:  [255, 104, 26],
  rimHot:   [255, 232, 170],
  ember:    [255, 82, 18],
});

/**
 * Turn the field into two RGBA images the size of the field: `base`, drawn
 * normally over the hull, and `glow`, drawn additively. Also returns ember
 * spawn points (field px) inside hot wounds and the hottest heat present.
 */
export function composeDamage(field, geo, { palette = DEFAULT_PALETTE, maxEmbers = 80 } = {}) {
  const { W, H, alpha } = geo;
  const { d, heat } = field;
  // A hull analysis only applies if it was made for this field's size.
  const hull = geo.hull && geo.hull.W === W && geo.hull.H === H ? geo.hull : null;
  const shipPx = Math.max(4, num(geo.shipPx, Math.min(W, H)));
  const base = new Uint8ClampedArray(W * H * 4);
  const glow = new Uint8ClampedArray(W * H * 4);
  const db = _boxBlur(d, W, H, Math.max(1, Math.round(shipPx / 110)));
  const cell = Math.max(3, shipPx / 30);
  const k = shipPx * 0.1;                       // height-map steepness for the lighting
  const L = [-0.45, -0.55, 0.7];
  const Ln = Math.hypot(...L);
  const lx = L[0] / Ln, ly = L[1] / Ln, lz = L[2] / Ln;
  const { scorch: S, peel: P, breach: B } = T;
  const st = [0, 0, 0];
  const rng = _rng(hashSeed(W, H, shipPx));
  const embers = [];
  let seen = 0, maxHeat = 0;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const ha = alpha ? alpha[i] / 255 : 1;
      const v = d[i];
      if (ha < 0.03 || v < S) continue;
      const o = i * 4;

      const gx = (db[y * W + Math.min(W - 1, x + 1)] - db[y * W + Math.max(0, x - 1)]) * 0.5;
      const gy = (db[Math.min(H - 1, y + 1) * W + x] - db[Math.max(0, y - 1) * W + x]) * 0.5;
      // Height = -d, so the surface normal leans along +grad(d).
      const nX = gx * k, nY = gy * k;
      const nl = Math.hypot(nX, nY, 1);
      const lam = Math.max(0, (nX * lx + nY * ly + lz) / nl);
      const shade = lam / lz;                   // 1 on flat plating
      const m = fbm(x / (cell * 0.9), y / (cell * 0.9), 99, 2);

      let r, g, b, a;
      if (v < P - 0.015) {
        const t = smoothstep(S, P - 0.03, v);
        const tint = Math.min(1, heat[i] * 1.4 + 0.25) * smoothstep(P - 0.16, P, v);
        r = palette.soot[0] + (palette.tint[0] - palette.soot[0]) * tint;
        g = palette.soot[1] + (palette.tint[1] - palette.soot[1]) * tint;
        b = palette.soot[2] + (palette.tint[2] - palette.soot[2]) * tint;
        a = 0.9 * t * (0.6 + 0.4 * m);
      } else if (v < P + 0.02) {
        const s = clamp(shade, 0.35, 1.5);
        r = palette.metal[0] * s; g = palette.metal[1] * s; b = palette.metal[2] * s;
        a = 1;
      } else {
        _structure(x, y, i, cell, hull, st);
        if (hull && _isBulkhead(hull, x, y, i)) _set(st, BULKHEAD);
        const depth = 1 - 0.45 * smoothstep(P, B, v);
        const lip = 0.42 + 0.58 * smoothstep(P + 0.02, P + 0.15, v);
        const wall = clamp(shade, 0.45, 1.4);
        const f = depth * lip * wall;
        r = st[0] * f; g = st[1] * f; b = st[2] * f;
        const vo = smoothstep(B - 0.05, B + 0.05, v);
        r += (palette.void[0] - r) * vo; g += (palette.void[1] - g) * vo; b += (palette.void[2] - b) * vo;
        a = 1;
      }
      base[o] = r; base[o + 1] = g; base[o + 2] = b; base[o + 3] = a * ha * 255;

      const h = heat[i];
      if (h > 0.01) {
        if (h > maxHeat) maxHeat = h;
        const rim = h * Math.exp(-(((v - P) / 0.04) ** 2));
        // Embers glow in the exposed decks, fading out where the hull is open to space.
        const deep = h * 0.45 * smoothstep(0.6, 0.85, v) * (1 - smoothstep(B - 0.05, B + 0.15, v)) * m * m * 1.8;
        const inten = clamp(rim * 1.1 + deep, 0, 1);
        if (inten > 0.01) {
          const hot = clamp(rim * 1.2, 0, 1);
          const c0 = rim >= deep ? palette.rimCool : palette.ember;
          glow[o]     = c0[0] + (palette.rimHot[0] - c0[0]) * hot * hot;
          glow[o + 1] = c0[1] + (palette.rimHot[1] - c0[1]) * hot * hot;
          glow[o + 2] = c0[2] + (palette.rimHot[2] - c0[2]) * hot * hot;
          glow[o + 3] = inten * ha * 255;
        }
        if (v > 0.55 && v < B + 0.2 && h > 0.25) {
          seen++;
          if (embers.length < maxEmbers) embers.push({ x, y, h });
          else {
            const j = Math.floor(rng() * seen);
            if (j < maxEmbers) embers[j] = { x, y, h };
          }
        }
      }
    }
  }
  return { base, glow, embers, maxHeat };
}

/** Hull silhouette size in field px: geometric mean of the opaque bbox. */
export function silhouettePx(alpha, W, H) {
  let minx = W, maxx = -1, miny = H, maxy = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (alpha[y * W + x] < 32) continue;
      if (x < minx) minx = x; if (x > maxx) maxx = x;
      if (y < miny) miny = y; if (y > maxy) maxy = y;
    }
  }
  if (maxx < 0) return Math.min(W, H);
  return Math.sqrt((maxx - minx + 1) * (maxy - miny + 1));
}

/**
 * How hot a hit still is. In the combat it was made in, it cools 0.3 a round;
 * otherwise over three minutes of wall clock. Quantised to tenths so the
 * renderer only rebuilds when the look actually changes.
 */
export function hitHeat(hit, { now = Date.now(), combatId = null, round = null } = {}) {
  let h;
  if (hit?.cid && hit.cid === combatId && Number.isFinite(hit.round) && Number.isFinite(round)) {
    h = 1 - 0.3 * Math.max(0, round - hit.round);
  } else if (Number.isFinite(hit?.at)) {
    h = 1 - Math.max(0, now - hit.at) / 180000;
  } else {
    h = 0;
  }
  return Math.round(clamp(h, 0, 1) * 10) / 10;
}
