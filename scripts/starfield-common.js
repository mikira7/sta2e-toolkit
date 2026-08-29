/**
 * sta2e-toolkit | starfield-common.js
 * Shared pieces of the module's two star renderers.
 *
 * [warp-viewscreen-vfx.js](warp-viewscreen-vfx.js) draws a forward view — a
 * pinhole projection radiating from a vanishing point, clipped to a Region, for
 * a viewscreen painted into a bridge map. [scene-warp-vfx.js](scene-warp-vfx.js)
 * draws the top-down view — parallel streaks running across the whole scene.
 * The cameras have nothing in common, but the star *material* does: the same
 * generated streak texture, the same palette construction, the same PIXI v7/v8
 * shims. This is that material, and nothing here knows about either camera.
 *
 * Everything is pure apart from the two texture builders, which touch `document`
 * and `PIXI` and so must not be called at module load time.
 */

// Baseline VFX zIndex, matching warp-jump-vfx.js and transporter-vfx.js.
export const VFX_Z_BASE = 900_000;

// How many distinct colours a field is drawn from. Each star takes one at seed
// time and keeps it until it recycles, so tint is never written per frame — the
// setter converts a colour on every write, which across a thousand stars is not
// free.
export const PALETTE_SIZE = 32;

const STREAK_TEX_W = 64;
const STREAK_TEX_H = 8;
const RADIAL_TEX   = 128;

// ── PIXI compatibility shims ─────────────────────────────────────────────────
// Foundry v14 ships PIXI v8: blend modes went number → string, and Graphics
// takes its fill *after* the shape method rather than before.

export function addBlend() {
  if (typeof PIXI?.BLEND_MODES?.ADD === "number") return PIXI.BLEND_MODES.ADD;
  return "add";
}

/**
 * The layer star fields parent into.
 *
 * Deliberately NOT canvas.primary: the PrimaryCanvasGroup sorts and composites
 * its children by elevation/sort, and a bare Container carrying neither renders
 * nothing at all under v14 / PIXI v8. Depth is expressed as a zIndex within the
 * token layer instead, the same way engine-trail-vfx.js does it.
 */
export function effectLayer() {
  const layer = canvas?.tokens ?? canvas?.interface ?? canvas?.primary ?? canvas?.stage ?? null;
  if (layer && !layer.sortableChildren) layer.sortableChildren = true;
  return layer;
}

/** Fill an axis-aligned rect under either Graphics API. */
export function gFillRect(g, x, y, w, h, color, alpha) {
  if (typeof g.beginFill === "function") {
    g.beginFill(color, alpha);
    g.drawRect(x, y, w, h);
    g.endFill();
  } else {
    g.rect(x, y, w, h);
    g.fill({ color, alpha });
  }
}

/**
 * Stroke an open polyline under either Graphics API.
 *
 * v7 sets the line style *before* the path and v8 strokes it *after* — the same
 * inversion `gFillRect` deals with. Round caps and joins matter here rather than
 * being a nicety: a lightning bolt is a chain of short segments meeting at sharp
 * angles, and mitred joins spit visible spikes out of every one of them.
 *
 * Local to this module rather than borrowed from `spawn-picker.js`'s `stroked`,
 * which is the better shim but drags lcars-theme and spawn-patterns in with it —
 * far too much to pull into a per-frame renderer.
 */
export function strokePolyline(g, { width, color, alpha }, pts) {
  if (!pts || pts.length < 2) return;
  const style = { width, color, alpha, cap: "round", join: "round" };
  const legacy = typeof g.lineStyle === "function";
  if (legacy) g.lineStyle(style);
  g.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
  if (legacy) g.lineStyle(0);
  else g.stroke(style);
}

// ── Colour ───────────────────────────────────────────────────────────────────

export function parseHexColor(hex, fallback) {
  const parsed = Number.parseInt(String(hex ?? "").replace(/^#/, ""), 16);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const _chan = c => [(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff];
const _pack = (r, g, b) => (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);

/** Blend two 24-bit colours, `t` = 0 gives `a`, 1 gives `b`. */
export function mixColor(a, b, t) {
  const [ar, ag, ab] = _chan(a);
  const [br, bg, bb] = _chan(b);
  const k = Math.min(1, Math.max(0, t));
  return _pack(ar + (br - ar) * k, ag + (bg - ag) * k, ab + (bb - ab) * k);
}

/** Toward white by `amount` (0..1). */
export function lighten(color, amount) {
  const [r, g, b] = _chan(color);
  const m = c => c + (255 - c) * Math.min(1, Math.max(0, amount));
  return _pack(m(r), m(g), m(b));
}

/** Toward black by `amount` (0..1). */
export function darken(color, amount) {
  const [r, g, b] = _chan(color);
  const m = c => c * (1 - Math.min(1, Math.max(0, amount)));
  return _pack(m(r), m(g), m(b));
}

/**
 * The colours a field is drawn from.
 *
 * A real warp field is not one tint: it is mostly cold white-blue with a
 * scattering of hotter white cores and a minority pulled toward a second hue.
 * `variety` is the share drawn toward the accent. Brightness always varies —
 * that is depth, not decoration — but at variety 0 the hue does not, so the
 * field is genuinely the base colour rather than faintly contaminated by it.
 */
export function buildPalette(base, accent, variety) {
  const out = [];
  for (let i = 0; i < PALETTE_SIZE; i++) {
    const toAccent = Math.random() < variety;
    // Accent stars commit to the hue; the rest carry only a wash of it, scaled
    // by variety, which keeps the field coherent instead of confetti.
    const t = toAccent ? 0.45 + Math.random() * 0.55 : Math.random() * 0.18 * variety;
    let c = mixColor(base, accent, t);
    const roll = Math.random();
    if (roll > 0.74)      c = lighten(c, 0.45 + Math.random() * 0.45);  // hot cores
    else if (roll < 0.28) c = darken(c, 0.2 + Math.random() * 0.35);    // distant, dim
    out.push(c);
  }
  return out;
}

// ── Textures ─────────────────────────────────────────────────────────────────

/**
 * One star: transparent tail on the left, bright head on the right. The sprite
 * anchors at (1, 0.5) so the head pins to the current position and the tail
 * trails back along the direction of travel.
 */
export function buildStreakTexture() {
  const oc  = document.createElement("canvas");
  oc.width  = STREAK_TEX_W;
  oc.height = STREAK_TEX_H;
  const ctx = oc.getContext("2d");

  // Near-uniform along its length with a short fade at the tail and a bright
  // head. A long head-to-tail ramp made every streak look like a comet; real
  // trailed stars are even lines that simply stop.
  const lg = ctx.createLinearGradient(0, 0, STREAK_TEX_W, 0);
  lg.addColorStop(0,    "rgba(255,255,255,0)");
  lg.addColorStop(0.18, "rgba(255,255,255,0.62)");
  lg.addColorStop(0.75, "rgba(255,255,255,0.88)");
  lg.addColorStop(0.96, "rgba(255,255,255,1)");
  lg.addColorStop(1,    "rgba(255,255,255,0.9)");
  ctx.fillStyle = lg;
  ctx.fillRect(0, 0, STREAK_TEX_W, STREAK_TEX_H);

  // Only the outer eighth feathers vertically. A gentler falloff cost most of a
  // hairline's brightness once the 8px texture was squeezed into ~1px.
  const vg = ctx.createLinearGradient(0, 0, 0, STREAK_TEX_H);
  vg.addColorStop(0,     "rgba(0,0,0,1)");
  vg.addColorStop(0.22,  "rgba(0,0,0,0)");
  vg.addColorStop(0.78,  "rgba(0,0,0,0)");
  vg.addColorStop(1,     "rgba(0,0,0,1)");
  ctx.globalCompositeOperation = "destination-out";
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, STREAK_TEX_W, STREAK_TEX_H);

  return PIXI.Texture.from(oc);
}

/** A soft radial blob — used for the nebula haze. */
export function buildRadialTexture() {
  const oc  = document.createElement("canvas");
  oc.width  = RADIAL_TEX;
  oc.height = RADIAL_TEX;
  const ctx = oc.getContext("2d");
  const h   = RADIAL_TEX / 2;
  const rg  = ctx.createRadialGradient(h, h, 0, h, h, h);
  rg.addColorStop(0,    "rgba(255,255,255,1)");
  rg.addColorStop(0.3,  "rgba(255,255,255,0.55)");
  rg.addColorStop(0.62, "rgba(255,255,255,0.18)");
  rg.addColorStop(1,    "rgba(255,255,255,0)");
  ctx.fillStyle = rg;
  ctx.fillRect(0, 0, RADIAL_TEX, RADIAL_TEX);
  return PIXI.Texture.from(oc);
}

// ── Environment textures ─────────────────────────────────────────────────────
//
// The material for the travel environments in viewscreen-environments.js. Every
// one is baked WHITE with shape carried in the alpha (and, for rock, in the
// luminance) because PIXI tint multiplies — a texture with its own hue could
// never be recoloured to the accent the GM picked.
//
// Like the two builders above, these touch `document` and `PIXI` and so must not
// be called at module load time.

const CLOUD_TEX = 192;
const ROCK_TEX  = 128;
const MOTE_TEX  = 64;
// Deliberately not 128 or 192: sharing a size with the rock or cloud textures
// makes them indistinguishable in a debug dump keyed by texture dimensions.
const WISP_TEX  = 160;
const GRAIN_TEX = 256;

/**
 * Turn off bilinear smoothing so speckles stay square.
 *
 * A grain frame stretched over a whole viewscreen is heavily magnified, and
 * smoothed static reads as a smudge rather than as interference. Same shim as
 * the one in shield-idle-vfx.js, which is where the technique came from: the
 * sampler moved from `baseTexture` to `source` in PIXI v8.
 */
export function pixelate(texture) {
  try {
    if (texture?.source) texture.source.scaleMode = "nearest";
    else if (texture?.baseTexture) {
      texture.baseTexture.scaleMode = PIXI.SCALE_MODES?.NEAREST ?? 0;
    }
  } catch { /* smoothing is cosmetic */ }
  return texture;
}

/**
 * Make a display object and its whole subtree invisible to hit testing, so a
 * field can never swallow a click meant for a token underneath it.
 *
 * `eventMode` is the v8 API; `interactive` / `interactiveChildren` are the v7
 * spelling and are harmless to set on v8, so both go on.
 */
export function passThrough(displayObject) {
  try {
    displayObject.eventMode = "none";
    displayObject.interactive = false;
    displayObject.interactiveChildren = false;
  } catch { /* older pixi is non-interactive by default anyway */ }
  return displayObject;
}

/**
 * One soft lobe, **elliptical and freely rotated**.
 *
 * Circular lobes were the first mistake behind clouds reading as discs: however
 * irregular their arrangement, a pile of circles still has a roughly circular
 * hull. Squashing each one on a random axis gives the silhouette a direction, so
 * the union of a handful of them is genuinely lumpy.
 */
function _blob(ctx, cx, cy, r, a, ecc, ang) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(ang);
  ctx.scale(1, ecc);
  const rg = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
  rg.addColorStop(0,    `rgba(255,255,255,${a})`);
  rg.addColorStop(0.45, `rgba(255,255,255,${a * 0.45})`);
  rg.addColorStop(0.78, `rgba(255,255,255,${a * 0.12})`);
  rg.addColorStop(1,    "rgba(255,255,255,0)");
  ctx.fillStyle = rg;
  // In the rotated/scaled frame, so it has to overshoot the canvas generously.
  ctx.fillRect(-CLOUD_TEX, -CLOUD_TEX, CLOUD_TEX * 2, CLOUD_TEX * 2);
  ctx.restore();
}

// Side of the value-noise lattice the cloud's structure is built from. Smaller
// than the texture on purpose: it is sampled with smoothstep interpolation, so
// this is the size of the *largest* feature, and the octaves below add the rest.
const NOISE_GRID = 64;

/** Smoothstep-interpolated value noise, sampled in [0,1) and wrapping. */
function _sampleNoise(grid, size, u, v) {
  const x  = u * size;
  const y  = v * size;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const sx = (x - x0) * (x - x0) * (3 - 2 * (x - x0));
  const sy = (y - y0) * (y - y0) * (3 - 2 * (y - y0));
  const at = (xx, yy) =>
    grid[(((yy % size) + size) % size) * size + (((xx % size) + size) % size)];
  const a = at(x0, y0), b = at(x0 + 1, y0);
  const c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
  const top = a + (b - a) * sx;
  return top + ((c + (d - c) * sx) - top) * sy;
}

/**
 * Fractal Brownian motion over one lattice, normalised to 0..1.
 *
 * Octaves are read off the *same* grid at increasing frequency rather than from
 * one grid each. Four separate lattices is the textbook construction and buys
 * nothing visible here — the wrap makes repeats land in different places at each
 * frequency — while costing four allocations per texture.
 *
 * **`features` is the number of largest-scale blobs across the sprite, and it is
 * the single most important number in the cloud.** It is expressed in lattice
 * cells consumed at octave 0, NOT as a plain frequency multiplier, because the
 * lattice is 64 cells wide and a multiplier of 1 therefore spans all of them:
 * that put the coarsest feature at 192/64 = **three pixels**, with every
 * subsequent octave below the pixel grid contributing nothing but grey. The
 * result was fine speckle — noise, not cloud. At `features: 3` the octaves run
 * 64px, 32px, 16px, 8px, which is an actual fractal spread.
 */
function _fbm(grid, u, v, octaves, features = 3) {
  let sum = 0, amp = 0.5, norm = 0, cells = features;
  for (let o = 0; o < octaves; o++) {
    // `_sampleNoise` multiplies by the lattice size, so dividing here is what
    // makes `cells` mean "cells across the sprite" rather than "across the grid".
    const k = cells / NOISE_GRID;
    sum  += _sampleNoise(grid, NOISE_GRID, u * k, v * k) * amp;
    norm += amp;
    amp  *= 0.5;
    cells *= 2;
  }
  return sum / norm;
}

/**
 * One gas cloud.
 *
 * Two stages, and the second is what makes it a cloud rather than a smudge:
 *
 *  1. **Overlapping soft lobes**, not one radial gradient. A lone gradient reads
 *     as a glowing ball — a light source, not a volume of gas — and the lobes
 *     give it an irregular silhouette.
 *  2. **fBm noise carved through the alpha.** The lobes alone are smooth, and a
 *     smooth blob scaled up to a couple of hundred pixels looks like a thumbprint
 *     on the lens. Multiplying the alpha by fractal noise cuts filaments and
 *     density variation into it, which is what the eye actually reads as gas.
 *     `contrast` is the exponent on that noise: raising it thins the sparse
 *     regions faster and leaves ragged wisps, which is the difference between a
 *     nebula bank and a storm cell.
 *
 * The radial edge fade happens in the same pixel pass rather than as a second
 * `destination-out` gradient — it is one multiply once the buffer is already
 * open, and doing it after the noise guarantees the rim reaches zero however
 * ragged the noise left it.
 *
 * Every call randomises both stages, so a caller building four textures gets
 * four distinguishable clouds and the field never shows a repeating shape.
 */
export function buildCloudTexture({
  octaves = 4, contrast = 1.4, floor = 0.12, warp = 0.30, features = 3,
  lobes = 7, spread = 0.50, lobeMin = 0.32, lobeMax = 0.58, ecc = 0.7,
} = {}) {
  const oc  = document.createElement("canvas");
  oc.width  = CLOUD_TEX;
  oc.height = CLOUD_TEX;
  const ctx = oc.getContext("2d");
  const h   = CLOUD_TEX / 2;

  // Lobe layout is the whole silhouette, and it is a genuine tug-of-war measured
  // rather than eyeballed. `spread` scatters the lobes: too little and they pile
  // into a circular union (the disc problem), too much and the cloud breaks into
  // separate puffs and stops covering its own texture. `lobeMin/Max` set how much
  // of the sprite gets used at all — an early version reached only 0.72 of the
  // radius and, once the noise ate the faint outer tail, covered ~15% of the
  // texture, so every cloud rendered at roughly a third of its configured size
  // with the rest paid for as transparent fill. These values hold coverage near
  // a quarter of the sprite while keeping the outline ~20% off round.
  const n = Math.max(3, Math.round(lobes + (Math.random() * 3 - 1)));
  for (let i = 0; i < n; i++) {
    // Angles are stratified rather than uniform, so a handful of lobes cannot
    // all land on one side and leave a crescent.
    const ang = ((i + Math.random()) / n) * Math.PI * 2;
    const rad = h * spread * (0.35 + Math.random() * 0.65);
    _blob(
      ctx,
      h + Math.cos(ang) * rad,
      h + Math.sin(ang) * rad,
      h * (lobeMin + Math.random() * (lobeMax - lobeMin)),
      0.36 + Math.random() * 0.3,
      Math.max(0.28, 1 - ecc * Math.random()),   // eccentricity
      Math.random() * Math.PI,            // and its axis
    );
  }

  const grid = new Float32Array(NOISE_GRID * NOISE_GRID);
  for (let i = 0; i < grid.length; i++) grid[i] = Math.random();

  let img;
  try {
    img = ctx.getImageData(0, 0, CLOUD_TEX, CLOUD_TEX);
  } catch {
    // No pixel access (a tainted or stubbed canvas) — the lobes alone still
    // read as a soft cloud, so fall back rather than failing to build at all.
    return PIXI.Texture.from(oc);
  }
  const d = img.data;
  for (let y = 0; y < CLOUD_TEX; y++) {
    const v  = y / CLOUD_TEX;
    const dy = (y - h) / h;
    for (let x = 0; x < CLOUD_TEX; x++) {
      const i = (y * CLOUD_TEX + x) * 4;
      if (d[i + 3] === 0) continue;
      const dx = (x - h) / h;
      const r  = Math.hypot(dx, dy);
      if (r >= 1) { d[i + 3] = 0; continue; }
      // A guard on the last eighth of the radius only. It used to start at 0.55,
      // which meant the alpha was forced onto a circular falloff whatever the
      // noise did — the single biggest reason these read as discs. The shape now
      // comes from the lobes and the noise; this only stops a square edge.
      const edge = r <= 0.88 ? 1 : 1 - (r - 0.88) / 0.12;

      const u = x / CLOUD_TEX;
      // Domain warp: displace the sample point by a low-frequency noise read of
      // itself. Undistorted fBm is isotropic and reads as television static;
      // warping it shears the field into the curled, stringy structure that
      // actually looks like gas, for two extra samples a pixel.
      //
      // It has to be COARSER than the field it warps — about two blobs across
      // the sprite — or it merely jitters each pixel independently and adds
      // grain instead of shearing anything.
      const wk = 2 / NOISE_GRID;
      const wu = u + warp * (_sampleNoise(grid, NOISE_GRID, u * wk, v * wk) - 0.5);
      const wv = v + warp * (_sampleNoise(grid, NOISE_GRID, u * wk + 0.37, v * wk + 0.37) - 0.5);

      const n = Math.pow(_fbm(grid, wu, wv, octaves, features), contrast);
      d[i + 3] = d[i + 3] * (floor + (1 - floor) * n) * edge * edge;
    }
  }
  ctx.putImageData(img, 0, 0);

  return PIXI.Texture.from(oc);
}

/**
 * A storm cell: the same construction, wound up.
 *
 * More octaves and a much higher contrast with almost no floor, so the noise
 * cuts right through to transparent in places. A nebula bank is a soft volume
 * you fly into; a storm cell is torn, and the lightning has to look like it is
 * happening *inside* something with structure.
 */
export function buildStormCloudTexture() {
  return buildCloudTexture({
    octaves: 5, contrast: 2.0, floor: 0.14, warp: 0.42, features: 4,
    // Fewer, smaller, more scattered lobes than the nebula: measurably more
    // torn (about 30% off round against its 25%) at the cost of some coverage,
    // which is the right trade for a storm cell.
    lobes: 6, spread: 0.52, lobeMin: 0.24, lobeMax: 0.48,
  });
}

/**
 * One asteroid: a lumpy polygon with a lit rim, a shadowed side and a few
 * craters.
 *
 * Painted in greys rather than in colour so the sprite's tint can carry the
 * hue — a rock baked brown would tint to mud. The lit direction is baked in and
 * the sprite tumbles, which is correct for a rock lit by a distant star: the
 * highlight travels round it as it turns.
 */
export function buildRockTexture() {
  const oc  = document.createElement("canvas");
  oc.width  = ROCK_TEX;
  oc.height = ROCK_TEX;
  const ctx = oc.getContext("2d");
  const h   = ROCK_TEX / 2;
  const r0  = h * 0.82;

  const verts = 9 + ((Math.random() * 5) | 0);
  const pts   = [];
  for (let i = 0; i < verts; i++) {
    const a = (i / verts) * Math.PI * 2;
    const r = r0 * (0.68 + Math.random() * 0.32);
    pts.push([h + Math.cos(a) * r, h + Math.sin(a) * r]);
  }

  const trace = () => {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
  };

  // Body, shaded across the lit axis. Mid grey so tint has room to move in both
  // directions.
  const lg = ctx.createLinearGradient(0, 0, ROCK_TEX, ROCK_TEX);
  lg.addColorStop(0,    "#e8e8e8");
  lg.addColorStop(0.45, "#9a9a9a");
  lg.addColorStop(1,    "#3a3a3a");
  trace();
  ctx.fillStyle = lg;
  ctx.fill();

  // Craters, clipped to the body so none of them hang off the silhouette.
  ctx.save();
  trace();
  ctx.clip();
  const craters = 2 + ((Math.random() * 4) | 0);
  for (let i = 0; i < craters; i++) {
    const ca = Math.random() * Math.PI * 2;
    const cd = Math.random() * r0 * 0.6;
    const cr = r0 * (0.08 + Math.random() * 0.16);
    ctx.beginPath();
    ctx.arc(h + Math.cos(ca) * cd, h + Math.sin(ca) * cd, cr, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(0,0,0,${0.16 + Math.random() * 0.2})`;
    ctx.fill();
  }
  ctx.restore();

  // A bright rim on the lit side only, drawn as a stroke clipped to the body so
  // it reads as a terminator rather than as an outline all the way round.
  ctx.save();
  trace();
  ctx.clip();
  ctx.lineWidth   = Math.max(2, ROCK_TEX * 0.035);
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.translate(-ctx.lineWidth * 0.5, -ctx.lineWidth * 0.5);
  trace();
  ctx.stroke();
  ctx.restore();

  return PIXI.Texture.from(oc);
}

/**
 * One plume of luminous vapour: a broad soft body with a bright thread running
 * down its spine, broken into filaments along its length.
 *
 * This is the tunnel-wall material, and it exists because striations alone were
 * wrong. A conduit wall is not a bundle of hairlines against black — it is thick
 * rushing atmosphere with brighter threads *in* it, and a crisp streak texture
 * can only ever give the threads. Smeared along the direction of travel, this
 * gives the plume; the noise gives it the internal structure that stops a soft
 * blob reading as a smudge.
 *
 * Three components, multiplied:
 *
 *  - a **length profile** that fades at both tips. The env pool anchors at 0.5
 *    and smears symmetrically, so a one-ended comet ramp would look wrong here;
 *  - a **cross-section** of a wide gaussian body plus a narrow, much brighter
 *    core — the body is the vapour, the core is the thread;
 *  - **fBm along the length** to break it into filaments.
 *
 * Written straight into an ImageData rather than composited from canvas
 * gradients, so unlike the cloud builder it never needs `getImageData` and
 * cannot be defeated by a tainted canvas.
 */
export function buildWispTexture({
  octaves = 4, features = 3, coreWeight = 0.5, bodyWidth = 0.32, floor = 0.35,
} = {}) {
  const W   = WISP_TEX;
  const oc  = document.createElement("canvas");
  oc.width  = W;
  oc.height = W;
  const ctx = oc.getContext("2d");
  const img = ctx.createImageData(W, W);
  const d   = img.data;

  const grid = new Float32Array(NOISE_GRID * NOISE_GRID);
  for (let i = 0; i < grid.length; i++) grid[i] = Math.random();

  const bodyVar = 2 * bodyWidth * bodyWidth;
  const coreVar = 2 * 0.075 * 0.075;

  for (let y = 0; y < W; y++) {
    const v  = y / W;
    const dy = (v - 0.5) / 0.5;
    const cross = Math.exp(-(dy * dy) / bodyVar) * (1 - coreWeight)
                + Math.exp(-(dy * dy) / coreVar) * coreWeight;
    if (cross < 0.002) continue;              // fully transparent row
    for (let x = 0; x < W; x++) {
      const u  = x / W;
      // `sin^0.65` rather than a plain sine: broad through the middle with a
      // shortish fade, so the plume reads as a length of vapour and not a lens.
      const lp = Math.pow(Math.sin(Math.PI * u), 0.65);
      const n  = _fbm(grid, u, v, octaves, features);
      const a  = lp * cross * (floor + (1 - floor) * n);
      const i  = (y * W + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = 255;
      d[i + 3] = a > 0 ? Math.min(255, a * 255) : 0;
    }
  }

  ctx.putImageData(img, 0, 0);
  return PIXI.Texture.from(oc);
}

/**
 * One charged mote: a hot white core with a tight falloff.
 *
 * Tighter than `buildRadialTexture` on purpose — a storm particle should read as
 * a spark, and the soft haze blob scaled down just looks like a smudge.
 */
export function buildMoteTexture() {
  const oc  = document.createElement("canvas");
  oc.width  = MOTE_TEX;
  oc.height = MOTE_TEX;
  const ctx = oc.getContext("2d");
  const h   = MOTE_TEX / 2;
  const rg  = ctx.createRadialGradient(h, h, 0, h, h, h);
  rg.addColorStop(0,    "rgba(255,255,255,1)");
  rg.addColorStop(0.12, "rgba(255,255,255,0.92)");
  rg.addColorStop(0.34, "rgba(255,255,255,0.34)");
  rg.addColorStop(0.66, "rgba(255,255,255,0.07)");
  rg.addColorStop(1,    "rgba(255,255,255,0)");
  ctx.fillStyle = rg;
  ctx.fillRect(0, 0, MOTE_TEX, MOTE_TEX);
  return PIXI.Texture.from(oc);
}

/**
 * Pre-baked frames of white noise, cycled to make television static.
 *
 * The same construction as `_grainFrames()` in shield-idle-vfx.js, generalised:
 * rectangular, and with no radial density ramp, because this covers a flat
 * screen rather than gathering at the boundary of a shield envelope.
 *
 * Baked rather than regenerated per frame — filling a quarter-million pixels
 * with `Math.random()` is not something to do sixty times a second. A short loop
 * is enough because the renderer steps through the frames out of order.
 */
export function buildGrainFrames(count = 6, sparsity = 0.42) {
  const frames = [];
  for (let f = 0; f < count; f++) {
    const oc  = document.createElement("canvas");
    oc.width  = GRAIN_TEX;
    oc.height = GRAIN_TEX;
    const ctx = oc.getContext("2d");
    const img = ctx.createImageData(GRAIN_TEX, GRAIN_TEX);
    const d   = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = Math.random();
      // Below the sparsity floor a pixel is fully transparent, so the static
      // reads as speckle on a dark screen rather than as uniform fog.
      const v = n < sparsity ? 0 : (n - sparsity) / (1 - sparsity);
      d[i] = d[i + 1] = d[i + 2] = 255;
      d[i + 3] = Math.round(255 * v);
    }
    ctx.putImageData(img, 0, 0);
    frames.push(pixelate(PIXI.Texture.from(oc)));
  }
  return frames;
}

/**
 * Horizontal scanlines, drawn at the height they will be shown at.
 *
 * Two decisions here, both to avoid `TilingSprite` — whose constructor
 * signature changed between PIXI v7 and v8, and which this module would
 * otherwise need a shim for:
 *
 *  - **Full height, four pixels wide.** The lines are uniform across x, so a
 *    plain Sprite stretched horizontally is indistinguishable from a tiled one.
 *    Only the vertical axis has to be 1:1, and that is what `heightPx` buys.
 *  - **Separate from the grain frames.** Scanlines must NOT flicker. Baking them
 *    into the noise would make them crawl with every frame step, which reads as
 *    a fault in the effect rather than as a CRT.
 */
export function buildScanlineTexture(heightPx) {
  const h   = Math.max(8, Math.round(heightPx) || 8);
  const oc  = document.createElement("canvas");
  oc.width  = 4;
  oc.height = h;
  const ctx = oc.getContext("2d");
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  // A 3px pitch: one dark line, two clear. Tighter than that and the lines
  // merge into a flat dimming at any realistic viewscreen size.
  for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, 4, 1);
  return pixelate(PIXI.Texture.from(oc));
}

// ── Lightning ────────────────────────────────────────────────────────────────

/**
 * One forked lightning bolt between two points, as polylines to stroke.
 *
 * Lateral displacement rather than recursive midpoint subdivision: the classic
 * fractal method spends most of its detail at scales too small to see once the
 * bolt is a couple of pixels wide, and it is far harder to keep inside a budget.
 * Sampling `segments` points along the line and pushing each sideways gives the
 * same read for a known, small number of vertices.
 *
 * **The displacement tapers to zero at both ends** (`sin(t·π)`). Without that the
 * endpoints wander off the line they were asked to connect, so a bolt aimed at a
 * strike point visibly misses it — which is exactly the detail that stops it
 * reading as lightning.
 *
 * Returns `{ main, branches }`, all in the caller's coordinate space.
 */
export function buildLightningPath(x0, y0, x1, y1, {
  segments = 9, jitter = 0.16, forks = 2, forkChance = 0.55,
} = {}) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  // Unit normal, so displacement is always perpendicular to the run.
  const nx = -dy / len;
  const ny = dx / len;

  const main = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const taper = Math.sin(t * Math.PI);
    const off = (Math.random() * 2 - 1) * jitter * len * taper;
    main.push({ x: x0 + dx * t + nx * off, y: y0 + dy * t + ny * off });
  }

  const branches = [];
  const baseAngle = Math.atan2(dy, dx);
  for (let f = 0; f < forks; f++) {
    if (Math.random() > forkChance) continue;
    // Never fork off an endpoint — a branch there reads as a kink in the bolt
    // rather than as a fork.
    const at = main[1 + ((Math.random() * Math.max(1, segments - 2)) | 0)];
    const ang = baseAngle + (Math.random() < 0.5 ? -1 : 1) * (0.4 + Math.random() * 0.7);
    const flen = len * (0.14 + Math.random() * 0.24);
    const bdx = Math.cos(ang) * flen;
    const bdy = Math.sin(ang) * flen;
    const bl = Math.hypot(bdx, bdy) || 1;
    const bnx = -bdy / bl;
    const bny = bdx / bl;
    const steps = 4;
    const b = [];
    for (let j = 0; j <= steps; j++) {
      const t = j / steps;
      // Tapered at the root so the branch actually meets the trunk; free at the
      // tip, which is what makes it look torn off rather than drawn to a target.
      const taper = t * (1 - t) * 4;
      const off = (Math.random() * 2 - 1) * jitter * bl * taper;
      b.push({ x: at.x + bdx * t + bnx * off, y: at.y + bdy * t + bny * off });
    }
    branches.push(b);
  }
  return { main, branches };
}

// ── Cached settings ──────────────────────────────────────────────────────────

/**
 * `game.settings.get`, memoised.
 *
 * Both star renderers re-read their timings from inside their per-frame tick so
 * that a slider drag is live with no re-attach. Done naively that is three
 * settings lookups per field per frame — at 60fps with the scene field and a
 * viewscreen both running, over a thousand a second, every one of them returning
 * the same value it returned last frame.
 *
 * The cache is invalidated wholesale by `registerStarfieldSettingsCache()` below
 * on any `updateSetting`, which is rare enough that a blunt clear is the right
 * trade. Reads still fall back to the live lookup on a miss, so a renderer that
 * starts before the hook is registered is still correct.
 */
const _settingsCache = new Map();

export function cachedSetting(namespace, key, fallback) {
  const id = `${namespace}.${key}`;
  if (_settingsCache.has(id)) return _settingsCache.get(id);
  let value;
  try {
    value = game.settings.get(namespace, key);
  } catch {
    // VFX can run before settings register — don't cache that, so the real
    // value is picked up as soon as it exists.
    return fallback;
  }
  if (value === undefined || value === null || value === "") value = fallback;
  _settingsCache.set(id, value);
  return value;
}

/** A cached setting coerced to a positive number, with a fallback. */
export function cachedNumSetting(namespace, key, fallback) {
  const v = Number(cachedSetting(namespace, key, fallback));
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/** Drop the memo. Exported so callers can force a re-read. */
export function invalidateStarfieldSettings() {
  _settingsCache.clear();
}

let _settingsHookId = null;

/** Wire the invalidation. Call once from main.js init. */
export function registerStarfieldSettingsCache() {
  if (_settingsHookId !== null) return;
  _settingsHookId = Hooks.on("updateSetting", () => invalidateStarfieldSettings());
}

// ── Config coercion ──────────────────────────────────────────────────────────

/**
 * Coerce a stored value to a number.
 *
 * `Number(null)` is 0 and `Number.isFinite(0)` is true, so a plain
 * `isFinite(Number(v))` test silently turns an unset nullable field into a real
 * zero — which put the viewscreen's vanishing point at the canvas origin instead
 * of the region centre. Absent values have to be rejected before the coercion.
 */
export function numOrNull(v, fallback = null) {
  if (v === null || v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Clamp a number into a range, with a fallback for anything non-finite. */
export function clampNum(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
