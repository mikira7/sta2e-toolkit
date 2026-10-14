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
