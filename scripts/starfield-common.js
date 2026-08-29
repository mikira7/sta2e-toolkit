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
