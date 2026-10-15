/**
 * sta2e-toolkit | token-frames.js
 *
 * Built-in BAKED ring frames for the Token Maker — drawn at the token's output
 * size in any colour and painted into the token image, unlike the dynamic
 * rings (starfleet-ring.js), which Foundry draws and tints at runtime with one
 * design per world. A baked frame is per token, so two tokens can wear
 * different frames and colours.
 *
 * Every frame is drawn from fractions of the token's half-size (1.0 = the token
 * edge) and declares:
 *   opening  where the portrait should end (the maker sizes the mask to it)
 *   pips     {dist, scale} for the rank plate
 *   emblem   {dist, r} for the emblem disc
 *   color    optional — the colour the maker switches to when it is picked,
 *            for a frame whose look depends on one (the citizen navy)
 * Colour arrives as one hex value; the bevel shading is derived from it, so any
 * colour keeps the same lit-from-above look.
 */

import { drawStarfield } from "./token-emblems.js";

export const BAKED_FRAMES = {
  solid:     { name: "Solid Band",  opening: 0.85, pips: { dist: 0.92, scale: 0.9 },  emblem: { dist: 0.9, r: 0.18 } },
  double:    { name: "Double Band", opening: 0.85, pips: { dist: 0.92, scale: 0.85 }, emblem: { dist: 0.9, r: 0.18 } },
  starfield: { name: "Starfield",   opening: 0.85, pips: { dist: 0.92, scale: 0.85 }, emblem: { dist: 0.9, r: 0.18 } },
  metal:     { name: "Metal Rim",   opening: 0.85, pips: { dist: 0.93, scale: 0.85 }, emblem: { dist: 0.9, r: 0.18 } },
  stone:     { name: "Stone",       opening: 0.875, pips: { dist: 0.955, scale: 0.8 }, emblem: { dist: 0.91, r: 0.17 } },
  marble:    { name: "Marble",      opening: 0.875, pips: { dist: 0.955, scale: 0.8 }, emblem: { dist: 0.91, r: 0.17 } },
  citizen:   { name: "Federation Citizen", opening: 0.885, pips: { dist: 0.94, scale: 0.8 }, emblem: { dist: 0.91, r: 0.17 }, color: "#2b4c70" },
  lcars:     { name: "LCARS",           opening: 0.86, pips: { dist: 0.925, scale: 0.85 }, emblem: { dist: 0.9, r: 0.18 }, color: "#f29b38" },
  uniform:   { name: "Duty Uniform",    opening: 0.85, pips: { dist: 0.92, scale: 0.85 }, emblem: { dist: 0.9, r: 0.18 } },
  klingon:   { name: "Klingon Carved Stone", opening: 0.8, pips: { dist: 0.875, scale: 0.75 }, emblem: { dist: 0.865, r: 0.15 }, color: "#5c4740" },
  romulan:   { name: "Romulan Crescent",     opening: 0.905, pips: { dist: 0.955, scale: 0.7 }, emblem: { dist: 0.93, r: 0.16 }, color: "#2c6e4f" },
};

// ── Colour ───────────────────────────────────────────────────────────────────

function rgb(hex) {
  const h = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? ""))?.[1] ?? "9c0000";
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
}

/** Mix toward white (amt > 0) or black (amt < 0); amt in −1..1. */
export function shade(hex, amt) {
  const [r, g, b] = rgb(hex);
  const t = amt < 0 ? 0 : 255, k = Math.abs(amt);
  const c = (v) => Math.round(v + (t - v) * k).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

// ── Drawing helpers ──────────────────────────────────────────────────────────

function annulus(ctx, c, r0, r1) {
  ctx.beginPath();
  ctx.arc(c, c, r1, 0, Math.PI * 2);
  ctx.arc(c, c, r0, Math.PI * 2, 0, true);
  ctx.closePath();
}

/**
 * A coloured band, bevelled: dark edges, a lit crown, a soft inner shadow.
 * `depth` scales the whole bevel — 1 is fully rounded, lower flattens it.
 */
function band(ctx, c, h, r0, r1, color, depth = 1) {
  const g = ctx.createRadialGradient(c, c, r0 * h, c, c, r1 * h);
  g.addColorStop(0, shade(color, -0.45 * depth));
  g.addColorStop(0.18, shade(color, -0.1 * depth));
  g.addColorStop(0.5, shade(color, 0.28 * depth));
  g.addColorStop(0.82, color);
  g.addColorStop(1, shade(color, -0.5 * depth));
  annulus(ctx, c, r0 * h, r1 * h);
  ctx.fillStyle = g;
  ctx.fill();
  // A faint top-left highlight sells the bevel at small sizes.
  const hl = ctx.createLinearGradient(0, c - r1 * h, 0, c + r1 * h);
  hl.addColorStop(0, `rgba(255,255,255,${0.22 * depth})`);
  hl.addColorStop(0.5, "rgba(255,255,255,0)");
  hl.addColorStop(1, `rgba(0,0,0,${0.18 * depth})`);
  annulus(ctx, c, r0 * h, r1 * h);
  ctx.fillStyle = hl;
  ctx.fill();
}

function keyline(ctx, c, h, r0, r1, color = "#050505") {
  annulus(ctx, c, r0 * h, r1 * h);
  ctx.fillStyle = color;
  ctx.fill();
}

function metal(ctx, c, h, r0, r1) {
  const g = ctx.createLinearGradient(0, c - h, 0, c + h);
  g.addColorStop(0, "#eef1f5");
  g.addColorStop(0.45, "#8d95a1");
  g.addColorStop(0.55, "#6b727d");
  g.addColorStop(1, "#c9ced6");
  annulus(ctx, c, r0 * h, r1 * h);
  ctx.fillStyle = g;
  ctx.fill();
}

// ── Stone texture ────────────────────────────────────────────────────────────
//
// Procedural, so a stone frame needs no image file and still takes any colour.
// Value noise on a hashed lattice, summed over octaves (fBm), sampled in
// coordinates normalised to the token size — so the grain looks the same at
// 256 px and at 1024 px — and seeded, so re-saving a token does not reshuffle
// its stone.

function _hash(x, y, seed) {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function _noise(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = _hash(xi, yi, seed), b = _hash(xi + 1, yi, seed);
  const c = _hash(xi, yi + 1, seed), d = _hash(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function _fbm(x, y, seed, octaves = 5) {
  let sum = 0, amp = 0.5, freq = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * _noise(x * freq, y * freq, seed + o * 17);
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}

/**
 * A textured stone band. `mode` "stone" is mottled granite with fine speckle;
 * "marble" adds flowing veins. Light falls from the top left and the band
 * darkens towards both edges, so it reads as a rounded, carved ring.
 */
function stoneBand(ctx, c, h, r0, r1, color, mode = "stone") {
  const S = Math.round(c * 2);
  const img = ctx.getImageData(0, 0, S, S);
  const px = img.data;
  const dark = rgb(shade(color, -0.72)), mid = rgb(color), light = rgb(shade(color, 0.32));
  const seed = mode === "marble" ? 4711 : 1701;
  const R0 = r0 * h, R1 = r1 * h;
  const y0 = Math.max(0, Math.floor(c - R1 - 1)), y1 = Math.min(S, Math.ceil(c + R1 + 1));
  for (let y = y0; y < y1; y++) {
    for (let x = y0; x < y1; x++) {
      const dx = x + 0.5 - c, dy = y + 0.5 - c;
      const d = Math.hypot(dx, dy);
      if (d < R0 - 1 || d > R1 + 1) continue;
      // Anti-aliased edges.
      const cover = Math.min(1, d - (R0 - 1), (R1 + 1) - d) ;
      if (cover <= 0) continue;
      const nx = x / S * 9, ny = y / S * 9;
      let n = _fbm(nx, ny, seed);
      // Granite: blotches plus fine speckle.
      const speck = _noise(x / S * 140, y / S * 140, seed + 99);
      n = n * 0.75 + (speck > 0.82 ? 0.35 : speck < 0.12 ? -0.25 : 0) * 0.6;
      if (mode === "marble") {
        // Veins: thin dark streaks where a warped sine crosses zero.
        const w = _fbm(nx * 0.6, ny * 0.6, seed + 5, 4);
        const vein = Math.abs(Math.sin((nx + ny * 0.6) * 1.4 + w * 9));
        n = n * 0.7 + 0.25 - Math.pow(1 - vein, 14) * 0.55;
      }
      // Rounded profile across the band, light from the top left.
      const t = (d - R0) / (R1 - R0);
      const profile = Math.sin(Math.max(0, Math.min(1, t)) * Math.PI);
      const lightDir = (-dx - dy) / (Math.SQRT2 * Math.max(1, d));
      let k = n * 0.65 + profile * 0.3 + lightDir * 0.12 - 0.05;
      k = Math.max(0, Math.min(1, k));
      const lo = k < 0.5 ? dark : mid, hi = k < 0.5 ? mid : light, f = k < 0.5 ? k * 2 : (k - 0.5) * 2;
      // Porter-Duff "over" on unpremultiplied pixels, so an anti-aliased edge
      // over transparency keeps its colour instead of fringing dark.
      const i = (y * S + x) * 4;
      const a = cover, ea = px[i + 3] / 255;
      const outA = a + ea * (1 - a);
      for (let ch = 0; ch < 3; ch++) {
        const v = lo[ch] + (hi[ch] - lo[ch]) * f;
        px[i + ch] = outA > 0 ? (v * a + px[i + ch] * ea * (1 - a)) / outA : 0;
      }
      px[i + 3] = Math.round(outA * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
}

// ── Carved stone (Klingon) ───────────────────────────────────────────────────
//
// A ring of rough-hewn stone: its outer edge is a polygon of uneven straight
// chisel cuts with the odd deep chip, its inner edge a gentler polygon that
// only ever bites INWARD past the portrait's opening (outward it would leave a
// gap between the portrait and the stone). Each cut is a bevel lit by its own
// normal, so the edge reads as facets rather than as a wobble; the face between
// carries the granite noise, hairline cracks and a broken engraved channel.

const TAU = Math.PI * 2;
const LIGHT = [-Math.SQRT1_2, -Math.SQRT1_2];   // from the top left, canvas y down

/**
 * An irregular closed polygon round the centre, as an angular lookup table:
 * `at(θ)` → `{r, nx, ny}` — the radius where the ray at θ meets the polygon
 * (straight chords between vertices, not a polar interpolation) and that
 * chord's outward unit normal.
 */
function _jaggedRing(seed, n, rMin, rMax, { chip = 0, chipR = rMin, teeth = null } = {}) {
  let k = 0;
  const rnd = () => _hash(k++, 7, seed);
  const verts = [];
  for (let i = 0; i < n; i++) {
    const a = (i + (rnd() - 0.5) * 0.7) / n * TAU;
    let r = rMin + rnd() * (rMax - rMin);
    // Teeth: every other vertex drawn in to [lo, hi], so the edge is serrated.
    if (teeth && i % 2) r = teeth[0] + rnd() * (teeth[1] - teeth[0]);
    if (rnd() < chip) r = chipR;
    verts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  const BINS = 4096;
  const table = new Array(BINS);
  const angleOf = (p) => (Math.atan2(p[1], p[0]) + TAU) % TAU;
  for (let b = 0; b < BINS; b++) {
    const t = (b + 0.5) / BINS * TAU;
    const u = [Math.cos(t), Math.sin(t)];
    for (let i = 0; i < n; i++) {
      const P1 = verts[i], P2 = verts[(i + 1) % n];
      const a1 = angleOf(P1);
      let span = (angleOf(P2) - a1 + TAU) % TAU;
      if (((t - a1 + TAU) % TAU) > span) continue;
      const D = [P2[0] - P1[0], P2[1] - P1[1]];
      const r = (P1[0] * D[1] - P1[1] * D[0]) / (u[0] * D[1] - u[1] * D[0]);
      const len = Math.hypot(D[0], D[1]) || 1;
      let nx = D[1] / len, ny = -D[0] / len;
      if (nx * (P1[0] + P2[0]) + ny * (P1[1] + P2[1]) < 0) { nx = -nx; ny = -ny; }
      table[b] = { r, nx, ny };
      break;
    }
    table[b] ??= { r: (rMin + rMax) / 2, nx: u[0], ny: u[1] };
  }
  return (t) => table[Math.floor(((t % TAU) + TAU) % TAU / TAU * BINS) % BINS];
}

function carvedStone(ctx, c, h, color, { seed = 2161, opening = 0.86 } = {}) {
  const S = Math.round(c * 2);
  const img = ctx.getImageData(0, 0, S, S);
  const px = img.data;
  const dark = rgb(shade(color, -0.82)), mid = rgb(color), light = rgb(shade(color, 0.38));
  // Outer: uneven cuts, a few deep chips. Inner: never wider than the opening.
  const outer = _jaggedRing(seed, 34, 0.968, 0.998, { teeth: [0.9, 0.945], chip: 0.08, chipR: 0.89 });
  const inner = _jaggedRing(seed + 1, 18, opening - 0.025, opening - 0.002);
  const bevel = 0.032 * h;
  const lo = Math.max(0, Math.floor(c - h)), hi = Math.min(S, Math.ceil(c + h));
  for (let y = lo; y < hi; y++) {
    for (let x = lo; x < hi; x++) {
      const dx = x + 0.5 - c, dy = y + 0.5 - c;
      const d = Math.hypot(dx, dy);
      if (d < (opening - 0.04) * h || d > h) continue;
      const t = Math.atan2(dy, dx);
      const o = outer(t), q = inner(t);
      const eo = o.r * h - d, ei = d - q.r * h;
      const cover = Math.min(1, eo + 0.5, ei + 0.5);
      if (cover <= 0) continue;

      const nx = x / S * 8, ny = y / S * 8;
      const grain = _fbm(nx, ny, seed);
      const speck = _noise(x / S * 150, y / S * 150, seed + 99);
      const n = grain * 0.8 + (speck > 0.84 ? 0.18 : speck < 0.1 ? -0.16 : 0);
      let k;
      if (eo < bevel) {
        // Outer chisel cut, facing out along its chord's normal.
        const lit = o.nx * LIGHT[0] + o.ny * LIGHT[1];
        k = 0.46 + lit * 0.42 + (n - 0.5) * 0.3 - (1 - eo / bevel) * 0.08;
      } else if (ei < bevel * 0.8) {
        // Inner cut slopes down towards the portrait, so it faces inward.
        const lit = -(q.nx * LIGHT[0] + q.ny * LIGHT[1]);
        k = 0.38 + lit * 0.36 + (n - 0.5) * 0.3;
      } else {
        // The face: granite, with a slab-to-slab shift every few degrees.
        const slab = _hash(Math.floor((t + Math.PI) / TAU * 11), 3, seed);
        k = n * 0.85 + 0.08 + (slab - 0.5) * 0.14;
        // Hairline cracks where a second noise field crosses its midline.
        const crack = Math.abs(_fbm(nx * 1.4 + 3, ny * 1.4, seed + 7, 4) - 0.5);
        if (crack < 0.007) k *= 0.35 + crack * 45;
        // An engraved channel round the middle of the face, broken into
        // glyph-length runs: dark on the wall facing the light, lit on the other.
        const mid = (opening + 0.07) * h, cw = 0.008 * h;
        const off = d - mid;
        if (Math.abs(off) < cw) {
          // Nine long carved strokes with uneven gaps between them.
          const pos = (t + Math.PI) / TAU * 9, run = Math.floor(pos);
          const from = _hash(run, 11, seed) * 0.25, to = 0.7 + _hash(run, 12, seed) * 0.25;
          if (pos % 1 > from && pos % 1 < to) {
            const wall = off / cw;                       // −1 inner wall … +1 outer wall
            const facing = (dx * LIGHT[0] + dy * LIGHT[1]) / Math.max(1, d);
            k = 0.14 + Math.max(0, -wall * facing) * 0.35 + (n - 0.5) * 0.12;
          }
        }
      }
      k = Math.max(0, Math.min(1, k));
      const a0 = k < 0.5 ? dark : mid, a1 = k < 0.5 ? mid : light, f = k < 0.5 ? k * 2 : (k - 0.5) * 2;
      const i = (y * S + x) * 4;
      const ea = px[i + 3] / 255;
      const outA = cover + ea * (1 - cover);
      for (let ch = 0; ch < 3; ch++) {
        const v = a0[ch] + (a1[ch] - a0[ch]) * f;
        px[i + ch] = outA > 0 ? (v * cover + px[i + ch] * ea * (1 - cover)) / outA : 0;
      }
      px[i + 3] = Math.round(outA * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** A four-point sparkle: a star with pinched concave sides, long axis vertical. */
function sparkle(ctx, x, y, r) {
  const k = r * 0.12;
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.quadraticCurveTo(x + k, y - k, x + r * 0.78, y);
  ctx.quadraticCurveTo(x + k, y + k, x, y + r);
  ctx.quadraticCurveTo(x - k, y + k, x - r * 0.78, y);
  ctx.quadraticCurveTo(x - k, y - k, x, y - r);
  ctx.closePath();
  ctx.fill();
}

// ── Frames ───────────────────────────────────────────────────────────────────

/** The stone frames: a carved outer band and two fine inlaid rings inside it. */
function _stoneFrame(mode) {
  return (ctx, c, h, color) => {
    keyline(ctx, c, h, 0.872, 0.997, shade(color, -0.85));
    stoneBand(ctx, c, h, 0.925, 0.993, color, mode);
    // Two thin inlaid rings, lighter than the stone, with dark grooves between.
    band(ctx, c, h, 0.904, 0.914, shade(color, 0.1));
    band(ctx, c, h, 0.882, 0.891, shade(color, 0.05));
  };
}

const DRAW = {
  stone:  _stoneFrame("stone"),
  marble: _stoneFrame("marble"),
  /** Rough-hewn Klingon stone — jagged chisel-cut edges, cracks, an engraved channel. */
  klingon(ctx, c, h, color) {
    carvedStone(ctx, c, h, color, { opening: BAKED_FRAMES.klingon.opening });
  },
  /**
   * Romulan: one bevelled outer ring between fine silver rims, and inside it a
   * hairline crescent — thickest at the crown, its horns tapering away just
   * below 3 and 9 o'clock. The crescent lies over the portrait's edge rather
   * than in a gap of its own, so the bottom of the ring has no dead black band.
   */
  romulan(ctx, c, h, color) {
    keyline(ctx, c, h, 0.898, 0.993, "#05090a");
    metal(ctx, c, h, 0.92, 0.928);
    band(ctx, c, h, 0.928, 0.982, color, 0.85);
    metal(ctx, c, h, 0.982, 0.99);
    // The crescent: an outer circle less the same circle dropped by `off`.
    const R = 0.905 * h, off = 0.04 * h;
    const x0 = Math.sqrt(R * R - (off / 2) ** 2);
    const aR = Math.atan2(off / 2, x0), aL = Math.PI - aR;
    const bR = Math.atan2(-off / 2, x0), bL = Math.PI - bR;
    ctx.save();
    ctx.beginPath();
    ctx.arc(c, c, R, aL, aR, false);           // over the crown
    ctx.arc(c, c + off, R, bR, bL, true);      // back along the inner edge
    ctx.closePath();
    const g = ctx.createLinearGradient(0, c - R, 0, c + off / 2);
    g.addColorStop(0, shade(color, 0.62));
    g.addColorStop(0.5, shade(color, 0.3));
    g.addColorStop(1, shade(color, -0.1));
    ctx.fillStyle = g;
    // A dark shadow, not a glow: it is what parts the crescent from the
    // portrait it lies over.
    ctx.shadowColor = "rgba(0,0,0,0.85)";
    ctx.shadowBlur = h * 0.014;
    ctx.shadowOffsetY = h * 0.004;
    ctx.fill();
    ctx.restore();
    // A bright edge along the crown, so the crescent reads as polished metal.
    ctx.save();
    ctx.beginPath();
    ctx.arc(c, c, R - h * 0.003, aL + 0.12, aR - 0.12 + TAU, false);
    ctx.lineWidth = Math.max(1, h * 0.005);
    ctx.lineCap = "round";
    ctx.strokeStyle = shade(color, 0.85);
    ctx.globalAlpha = 0.85;
    ctx.stroke();
    ctx.restore();
  },
  /**
   * LCARS: flat, unshaded segments of the one colour family with black gaps,
   * a thin rail inside them. Every segment end is cut square.
   */
  lcars(ctx, c, h, color) {
    keyline(ctx, c, h, 0.85, 0.99, "#000000");
    annulus(ctx, c, 0.862 * h, 0.872 * h);
    ctx.fillStyle = shade(color, 0.25);
    ctx.fill();
    // Degrees, clockwise from 12 o'clock; [length, tone].
    const tones = [color, shade(color, 0.42), shade(color, -0.28), shade(color, 0.2)];
    const segs = [[62, 0], [18, 1], [40, 2], [8, 3], [76, 0], [30, 1], [12, 3], [50, 2], [24, 1]];
    const gap = 3.2;
    const total = segs.reduce((s, [len]) => s + len, 0) + gap * segs.length;
    let at = -90 - 6;
    const rMid = 0.93 * h, w = 0.085 * h;
    ctx.save();
    ctx.lineWidth = w;
    ctx.lineCap = "butt";
    for (const [len, tone] of segs) {
      const span = len * (360 - gap * segs.length) / (total - gap * segs.length);
      const a0 = at * Math.PI / 180, a1 = (at + span) * Math.PI / 180;
      ctx.beginPath();
      ctx.arc(c, c, rMid, a0, a1);
      ctx.strokeStyle = tones[tone];
      ctx.stroke();
      at += span + gap;
    }
    ctx.restore();
  },
  /**
   * TNG duty uniform: black shoulders across the top of the ring, the
   * division colour below a level seam, as the jumpsuit is cut.
   */
  uniform(ctx, c, h, color) {
    keyline(ctx, c, h, 0.845, 0.99, "#050505");
    const seam = c - 0.32 * h;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, seam, c * 2, c * 2);
    ctx.clip();
    band(ctx, c, h, 0.86, 0.975, color);
    ctx.restore();
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, c * 2, seam);
    ctx.clip();
    band(ctx, c, h, 0.86, 0.975, "#1b1c20", 0.8);
    ctx.restore();
    // The seam itself, a fine dark line.
    ctx.save();
    annulus(ctx, c, 0.86 * h, 0.975 * h);
    ctx.clip();
    ctx.fillStyle = "rgba(0,0,0,0.85)";
    ctx.fillRect(0, seam - h * 0.004, c * 2, h * 0.008);
    ctx.restore();
  },
  solid(ctx, c, h, color) {
    keyline(ctx, c, h, 0.845, 0.86);
    band(ctx, c, h, 0.86, 0.975, color);
    keyline(ctx, c, h, 0.975, 0.99);
  },
  double(ctx, c, h, color) {
    keyline(ctx, c, h, 0.845, 0.99, "#0b0c10");
    band(ctx, c, h, 0.86, 0.9, color);
    band(ctx, c, h, 0.935, 0.978, color);
  },
  starfield(ctx, c, h, color) {
    keyline(ctx, c, h, 0.845, 0.86);
    band(ctx, c, h, 0.86, 0.89, color, 0.35);
    ctx.save();
    annulus(ctx, c, 0.89 * h, 0.945 * h);
    ctx.clip();
    drawStarfield(ctx, c * 2, 1701);
    ctx.restore();
    band(ctx, c, h, 0.945, 0.985, color, 0.35);
    keyline(ctx, c, h, 0.985, 0.995);
  },
  /**
   * Federation Citizen: a band fading from deep navy at the crown to steel blue
   * at the foot, between two fine silver rims, with white sparkles strung round
   * the lower half from 3 o'clock to 9 o'clock.
   */
  citizen(ctx, c, h, color) {
    // Soft pale halo outside the outer rim.
    annulus(ctx, c, 0.975 * h, 0.997 * h);
    ctx.fillStyle = shade(color, 0.72);
    ctx.globalAlpha = 0.55;
    ctx.fill();
    ctx.globalAlpha = 1;
    keyline(ctx, c, h, 0.88, 0.987, "rgba(20,26,34,0.9)");
    // The band: dark at the top, light at the bottom.
    const g = ctx.createLinearGradient(0, c - h, 0, c + h);
    g.addColorStop(0, shade(color, -0.6));
    g.addColorStop(0.35, shade(color, -0.45));
    g.addColorStop(1, shade(color, 0.22));
    annulus(ctx, c, 0.896 * h, 0.976 * h);
    ctx.fillStyle = g;
    ctx.fill();
    // Fine silver rims either side of the band.
    metal(ctx, c, h, 0.884, 0.896);
    metal(ctx, c, h, 0.976, 0.984);
    // Sparkles every 15° across the lower half.
    ctx.save();
    ctx.fillStyle = "#ffffff";
    ctx.shadowColor = "rgba(255,255,255,0.6)";
    ctx.shadowBlur = h * 0.012;
    const rMid = 0.936 * h, sz = 0.036 * h;
    for (let i = 0; i <= 12; i++) {
      const a = (i * 15) * Math.PI / 180;   // 0 = 3 o'clock, sweeping down to 9
      sparkle(ctx, c + Math.cos(a) * rMid, c + Math.sin(a) * rMid, sz);
    }
    ctx.restore();
  },
  metal(ctx, c, h, color) {
    keyline(ctx, c, h, 0.845, 0.86);
    band(ctx, c, h, 0.86, 0.915, color);
    metal(ctx, c, h, 0.915, 0.985);
    keyline(ctx, c, h, 0.985, 0.995, "rgba(0,0,0,0.6)");
    // Studs at the quarters.
    for (const t of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
      ctx.save();
      ctx.translate(c, c);
      ctx.rotate(t);
      const w = 0.045 * h, len = 0.06 * h, r = 0.95 * h;
      ctx.beginPath();
      ctx.roundRect(r - len / 2, -w / 2, len, w, w / 2);
      ctx.fillStyle = "#e3e7ec";
      ctx.fill();
      ctx.lineWidth = Math.max(1, h * 0.005);
      ctx.strokeStyle = "rgba(0,0,0,0.55)";
      ctx.stroke();
      ctx.restore();
    }
  },
};

/**
 * Paint a built-in frame over the whole `S`-square token.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} S
 * @param {keyof BAKED_FRAMES} style
 * @param {string} color  "#rrggbb"
 */
export function drawBakedFrame(ctx, S, style, color) {
  const layer = _frameLayer(S, style, color || "#9c0000");
  if (layer) ctx.drawImage(layer, 0, 0, S, S);
}

// The textured frames cost tens of milliseconds, and the maker's preview redraws
// on every pointer move while the portrait is dragged — so each frame is drawn
// once per size, style and colour onto its own transparent layer and reused.
const _layers = new Map();
const LAYER_CACHE_MAX = 8;

function _frameLayer(S, style, color) {
  const draw = DRAW[style];
  if (!draw) return null;
  const key = `${S}|${style}|${color}`;
  let layer = _layers.get(key);
  if (!layer) {
    layer = document.createElement("canvas");
    layer.width = layer.height = Math.round(S);
    const c = S / 2;
    draw(layer.getContext("2d", { willReadFrequently: true }), c, c, color);
    _layers.set(key, layer);
    if (_layers.size > LAYER_CACHE_MAX) _layers.delete(_layers.keys().next().value);
  } else {
    // Refresh recency, so the colour being dragged stays cached.
    _layers.delete(key);
    _layers.set(key, layer);
  }
  return layer;
}
