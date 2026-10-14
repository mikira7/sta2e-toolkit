/**
 * sta2e-toolkit | tools/starfleet-ring-atlas.js
 *
 * Generator for the toolkit's dynamic token ring spritesheets
 * (assets/rings/*.webp + *.json). NOT loaded by the module — it is run once in
 * a browser (it needs a 2D canvas) and its output is committed. Re-run it only
 * to change the art; scripts/starfleet-ring.js just registers the result.
 *
 * How core draws a dynamic ring (client/canvas/rendering/shaders/samplers/
 * primary/token-ring.mjs), which is what the art below is shaped around:
 *
 * - Distances are fractions of the token's half-size: 1.0 is the token edge.
 * - WITHOUT a mask frame, the ring colour tints one radial band
 *   (`config.defaultColorBand`): there the colour is multiplied by the art's RED
 *   channel, and outside it the art shows exactly as drawn.
 * - WITH a mask frame (`token-ring-<size>-msk`) the band is switched off and the
 *   colour goes wherever the mask is drawn instead — colour × the mask's red
 *   channel, laid over the art by the mask's alpha. That is what lets the
 *   Starfield Ring tint two separate rings and leave the starfield alone.
 * - A ring frame may carry `ringColor` / `backgroundColor`: the colours a token
 *   gets when it has not chosen its own.
 * - The background frame is OVERLAY-blended with the background colour, so a
 *   mid grey (128) takes the tint exactly.
 * - The subject is drawn OVER the ring. Two config keys of our own (core
 *   ignores them) tell the Token Maker how to shape a subject for each ring:
 *   `subjectRadius` (where the portrait should end), `pips` (where the rank
 *   plate sits: distance and scale) and `emblem` (where the emblem disc sits:
 *   distance and radius). Neither pips nor emblem are drawn in the ring — a
 *   world has ONE ring design, so anything per-token (rank, commbadge, faction
 *   insignia) is stamped by the Token Maker (scripts/token-emblems.js).
 *
 * Layout, 4096²: gargantuan 2048 ring/bkg/mask, large-huge 1024, med 512,
 * tiny 256, each with `gridTarget` 3 / 2 / 1 / 0.5.
 */

export const COLOR_BAND = { startRadius: 0.64, endRadius: 0.715 };

/**
 * The Starfield Ring's layout, in dist units.
 *
 * Sized to FOUNDRY'S proportions, not the frame's: core assumes a ring's
 * subject fills 0.6667 of the token (TokenRing#defaultSubjectThickness) and
 * fits tokens against that, so a ring opening wider than it lets the portrait
 * spill over the ring. The first commbadge rings opened at 0.812 — 1.22× too
 * big — and that is exactly what showed. The opening is therefore 0.6667, and
 * each ring frame declares `ringThickness` (outer edge − opening) so core's
 * grid fit mode scales the ring to the grid square correctly too.
 */
const SF = {
  outer:   [0.776, 0.817],   // tintable
  stars:   [0.718, 0.776],
  inner:   [0.685, 0.718],   // tintable
  keyline: [0.6667, 0.685],
};
const SF_RING_THICKNESS = 0.817 - 0.6667;

export const RING_STYLES = {
  starfleetDelta: {
    label: "STA Toolkit — Starfleet Metal Ring", file: "starfleet-delta",
    config: { defaultColorBand: { ...COLOR_BAND }, subjectRadius: 0.62, pips: { dist: 0.74, scale: 0.8 }, emblem: { dist: 0.74, r: 0.17 } },
  },
  starfieldRing: {
    label: "STA Toolkit — Starfield Ring", file: "starfield-ring", mask: true,
    ringColor: "#9c0000", backgroundColor: "#1a1a1a", ringThickness: SF_RING_THICKNESS,
    config: { defaultColorBand: { startRadius: 0, endRadius: 0 }, subjectRadius: SF.keyline[0], pips: { dist: 0.76, scale: 0.82 }, emblem: { dist: 0.735, r: 0.193 } },
  },
};

const FRAMES = [
  { key: "gargantuan", size: 2048, bkg: [0, 0],       ring: [2048, 0],    msk: [0, 2048],    gridTarget: 3 },
  { key: "large-huge", size: 1024, bkg: [2048, 2048], ring: [3072, 2048], msk: [2048, 3072], gridTarget: 2 },
  { key: "med",        size: 512,  bkg: [3072, 3072], ring: [3584, 3072], msk: [3072, 3584], gridTarget: 1 },
  { key: "tiny",       size: 256,  bkg: [3584, 3584], ring: [3840, 3584], msk: [3584, 3840], gridTarget: 0.5 },
];

// ── Helpers (all geometry in "dist" units, scaled by the frame's half-size) ──

function annulus(ctx, c, r0, r1, a0 = 0, a1 = Math.PI * 2) {
  ctx.beginPath();
  ctx.arc(c, c, r1, a0, a1);
  ctx.arc(c, c, r0, a1, a0, true);
  ctx.closePath();
}

/** A metallic rim: a vertical light-to-dark sweep with a bright top edge. */
function metalRim(ctx, c, h, r0, r1) {
  const g = ctx.createLinearGradient(0, c - h, 0, c + h);
  g.addColorStop(0, "#e8ecf2");
  g.addColorStop(0.45, "#8a929e");
  g.addColorStop(0.55, "#6b727d");
  g.addColorStop(1, "#c9ced6");
  annulus(ctx, c, r0 * h, r1 * h);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = Math.max(1, h * 0.006);
  ctx.strokeStyle = "rgba(0,0,0,0.55)";
  ctx.stroke();
}

/** The tintable band as a greyscale intensity map (red channel = intensity). */
function bandGradient(ctx, c, h) {
  const g = ctx.createRadialGradient(c, c, COLOR_BAND.startRadius * h, c, c, COLOR_BAND.endRadius * h);
  g.addColorStop(0, "#9a9a9a");
  g.addColorStop(0.35, "#ffffff");
  g.addColorStop(0.7, "#e0e0e0");
  g.addColorStop(1, "#7a7a7a");
  return g;
}


// ── Ring art ─────────────────────────────────────────────────────────────────

function drawStarfleetDelta(ctx, size) {
  const c = size / 2, h = size / 2;
  // Dark inner lip, so the subject edge reads against the band.
  annulus(ctx, c, 0.615 * h, COLOR_BAND.startRadius * h);
  ctx.fillStyle = "#1a1d22";
  ctx.fill();
  // Tintable band.
  annulus(ctx, c, COLOR_BAND.startRadius * h, COLOR_BAND.endRadius * h);
  ctx.fillStyle = bandGradient(ctx, c, h);
  ctx.fill();
  // Fine engraved ticks in the band (still greyscale, so they tint too).
  ctx.save();
  ctx.translate(c, c);
  ctx.strokeStyle = "rgba(60,60,60,0.55)";
  ctx.lineWidth = Math.max(1, h * 0.004);
  for (let i = 0; i < 72; i++) {
    if (i % 18 === 0) continue;
    const t = (i / 72) * Math.PI * 2;
    const r0 = (COLOR_BAND.endRadius - 0.022) * h, r1 = (COLOR_BAND.endRadius - 0.006) * h;
    ctx.beginPath();
    ctx.moveTo(Math.cos(t) * r0, Math.sin(t) * r0);
    ctx.lineTo(Math.cos(t) * r1, Math.sin(t) * r1);
    ctx.stroke();
  }
  ctx.restore();
  // Metallic outer rim, just outside the band (keeps its own colour).
  metalRim(ctx, c, h, COLOR_BAND.endRadius + 0.002, 0.765);
  // Studs at all four quarters — the badge sits between two of them.
  for (const t of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
    ctx.save();
    ctx.translate(c, c);
    ctx.rotate(t);
    ctx.fillStyle = "#d9dde3";
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    ctx.lineWidth = Math.max(1, h * 0.005);
    const w = 0.05 * h, len = 0.07 * h, r = 0.74 * h;
    ctx.beginPath();
    ctx.roundRect(r - len / 2, -w / 2, len, w, w / 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
  // No badge: emblems (commbadges, faction insignia) are stamped per token by
  // the Token Maker — see scripts/token-emblems.js.
}

function drawBackground(ctx, size) {
  const c = size / 2, h = size / 2;
  const g = ctx.createRadialGradient(c, c * 0.8, 0, c, c, 0.66 * h);
  g.addColorStop(0, "#9a9a9a");
  g.addColorStop(0.7, "#808080");
  g.addColorStop(1, "#5c5c5c");
  ctx.beginPath();
  ctx.arc(c, c, 0.655 * h, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  // Faint scan lines — overlay-blended, they read as a display, not a pattern.
  ctx.save();
  ctx.clip();
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  const step = Math.max(2, Math.round(size / 96));
  for (let y = 0; y < size; y += step * 2) ctx.fillRect(0, y, size, step);
  ctx.restore();
}


// ── Commbadge rings ──────────────────────────────────────────────────────────

/** Deterministic PRNG, so a re-run of the generator draws the same stars. */
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** Fill a clipped area with black space: faint haze and scattered stars. */
function starfield(ctx, size, seed) {
  const rand = rng(seed);
  ctx.fillStyle = "#050608";
  ctx.fillRect(0, 0, size, size);
  // Haze: a few large, very faint blobs.
  for (let i = 0; i < 14; i++) {
    const x = rand() * size, y = rand() * size, r = size * (0.08 + rand() * 0.18);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(150,160,180,${0.05 + rand() * 0.05})`);
    g.addColorStop(1, "rgba(150,160,180,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  // Stars: density by area, sizes skewed small, a few bright ones.
  const count = Math.round(size * size * 0.0045);
  for (let i = 0; i < count; i++) {
    const x = rand() * size, y = rand() * size;
    const big = rand() > 0.96;
    const r = Math.max(0.5, (big ? 1.4 : 0.35 + rand() * 0.7) * (size / 1024) * 1.6);
    const a = big ? 0.95 : 0.35 + rand() * 0.6;
    ctx.fillStyle = `rgba(255,255,255,${a})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawStarfieldRing(ctx, size) {
  const c = size / 2, h = size / 2;
  // Starfield stripe.
  ctx.save();
  annulus(ctx, c, SF.stars[0] * h, SF.stars[1] * h);
  ctx.clip();
  starfield(ctx, size, 1701);
  ctx.restore();
  // The two rings. The mask frame tints them; underneath they are drawn dark
  // red so a renderer without the mask still shows the right thing.
  for (const [r0, r1] of [SF.outer, SF.inner]) {
    annulus(ctx, c, r0 * h, r1 * h);
    ctx.fillStyle = "#7d0000";
    ctx.fill();
  }
  // Black keyline the portrait meets.
  annulus(ctx, c, SF.keyline[0] * h, SF.keyline[1] * h);
  ctx.fillStyle = "#000000";
  ctx.fill();
}

/** Tint mask: white where the ring colour goes, shaded across each ring. */
function drawStarfieldMask(ctx, size) {
  const c = size / 2, h = size / 2;
  for (const [r0, r1] of [SF.outer, SF.inner]) {
    const g = ctx.createRadialGradient(c, c, r0 * h, c, c, r1 * h);
    g.addColorStop(0, "#b4b4b4");
    g.addColorStop(0.45, "#ffffff");
    g.addColorStop(1, "#a0a0a0");
    annulus(ctx, c, r0 * h, r1 * h);
    ctx.fillStyle = g;
    ctx.fill();
  }
}

function drawStarfieldBackground(ctx, size) {
  const c = size / 2, h = size / 2;
  ctx.beginPath();
  ctx.arc(c, c, (SF.keyline[0] + 0.004) * h, 0, Math.PI * 2);
  const g = ctx.createRadialGradient(c, c * 0.85, 0, c, c, SF.keyline[0] * h);
  g.addColorStop(0, "#8f8f8f");
  g.addColorStop(1, "#6a6a6a");
  ctx.fillStyle = g;
  ctx.fill();
}

// ── Atlas ────────────────────────────────────────────────────────────────────

function _painters(style) {
  const s = RING_STYLES[style];
  if (!s) throw new Error(`Unknown ring style ${style}`);
  if (style === "starfieldRing") {
    return { ring: drawStarfieldRing, bkg: drawStarfieldBackground, msk: drawStarfieldMask };
  }
  return { ring: drawStarfleetDelta, bkg: drawBackground, msk: null };
}

/**
 * Draw one style's atlas.
 * @param {keyof RING_STYLES} style
 * @param {(w:number,h:number)=>HTMLCanvasElement} makeCanvas
 * @returns {{canvas: HTMLCanvasElement, json: object}}
 */
export function buildRingAtlas(style, makeCanvas) {
  const s = RING_STYLES[style];
  const paint = _painters(style);
  const atlas = makeCanvas(4096, 4096);
  const ctx = atlas.getContext("2d");
  const frames = {};
  for (const f of FRAMES) {
    for (const kind of ["bkg", "ring", "msk"]) {
      if (!paint[kind]) continue;
      const tile = makeCanvas(f.size, f.size);
      paint[kind](tile.getContext("2d"), f.size);
      ctx.drawImage(tile, f[kind][0], f[kind][1]);
      const name = kind === "ring" ? `token-ring-${f.key}` : `token-ring-${f.key}-${kind}`;
      frames[name] = {
        frame: { x: f[kind][0], y: f[kind][1], w: f.size, h: f.size },
        rotated: false,
        trimmed: false,
        spriteSourceSize: { x: 0, y: 0, w: f.size, h: f.size },
        sourceSize: { w: f.size, h: f.size },
        anchor: { x: 0.5, y: 0.5 },
        ...(kind === "ring" ? { gridTarget: f.gridTarget } : {}),
        ...(kind === "ring" && s.ringColor ? { ringColor: s.ringColor } : {}),
        ...(kind === "ring" && s.ringThickness ? { ringThickness: Math.round(s.ringThickness * 10000) / 10000 } : {}),
        ...(kind === "ring" && s.backgroundColor ? { backgroundColor: s.backgroundColor } : {}),
      };
    }
  }
  return {
    canvas: atlas,
    json: {
      config: JSON.parse(JSON.stringify(s.config)),
      frames,
      meta: { app: "sta2e-toolkit tools/starfleet-ring-atlas.js", version: "1.1", image: `${s.file}.webp`, format: "RGBA8888", size: { w: 4096, h: 4096 }, scale: "1" },
    },
  };
}

/** One medium frame — background, ring and mask — for previews. */
export function drawRingPreviewFrames(style, size, makeCanvas) {
  const paint = _painters(style);
  const out = {};
  for (const kind of ["bkg", "ring", "msk"]) {
    if (!paint[kind]) continue;
    out[kind] = makeCanvas(size, size);
    paint[kind](out[kind].getContext("2d"), size);
  }
  return out;
}
