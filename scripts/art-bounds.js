/**
 * sta2e-toolkit | art-bounds.js
 * Where does a texture's artwork actually stop?
 *
 * Token art is routinely smaller than the image that carries it — a saucer
 * floating in a square PNG, a shuttle with 20% transparent margin on every side.
 * Anything that wants to ring, box or measure the *art* rather than the file
 * needs the opaque bounding box, which PIXI does not expose.
 *
 * `getArtBounds()` returns that box as fractions of the texture (0–1), measured
 * once per source path and cached forever after. The measurement downsamples to
 * at most 64px on the long edge before scanning: a token's silhouette does not
 * need pixel accuracy for layout, and this keeps a per-frame caller honest.
 *
 * Every failure path — video textures, an unloaded resource, a tainted canvas,
 * fully transparent art — caches the *full* box rather than null, so a texture
 * we cannot measure costs exactly one attempt and callers degrade to using the
 * whole frame.
 *
 * `getTokenArtMetrics()` is the token-facing form: it turns those fractions into
 * the artwork's extents and its offset from the token centre, both in
 * token-local pixels. Anything that rings, boxes or wraps a token's hull —
 * the initiative turn marker, the shield bubble — sizes itself off that.
 */

const MODULE = "sta2e-toolkit";

/** Alpha at or below this counts as empty (0–255). Kills stray antialiasing. */
const ALPHA_THRESHOLD = 8;

/** Long edge of the scan buffer. Bigger buys precision nobody can see. */
const SAMPLE_MAX = 64;

/** The box we hand back when measurement is impossible. */
const FULL_BOUNDS = Object.freeze({ x0: 0, y0: 0, x1: 1, y1: 1 });

/** src → {x0,y0,x1,y1} fractions */
const _cache = new Map();

/** src values currently being measured, so a per-frame caller only queues once. */
const _pending = new Set();

/** src → attempts spent waiting for the texture to decode. */
const _attempts = new Map();

/** Give up waiting for a decode after this many refreshes and use the full frame. */
const MAX_ATTEMPTS = 5;

/** True when a measurement landed and callers should re-read the cache. */
let _notify = null;

/**
 * Register a callback fired once after any measurement completes.
 * Callers that may have rendered with FULL_BOUNDS use this to redraw.
 */
export function onArtBoundsMeasured(callback) {
  _notify = callback;
}

/** Drop every cached measurement. Debugging aid; also safe on teardown. */
export function clearArtBoundsCache() {
  _cache.clear();
  _pending.clear();
  _attempts.clear();
}

/**
 * The drawable behind a PIXI texture. PIXI v8 keeps it on
 * `texture.source.resource`; v7 used `baseTexture.resource.source`.
 *
 * @returns {{resource:*, width:number, height:number}|"unmeasurable"|null}
 *   `"unmeasurable"` for something we will never measure (video art), null when
 *   the texture simply has not decoded yet and is worth another look.
 */
function _resourceOf(texture) {
  const resource = texture?.source?.resource ?? texture?.baseTexture?.resource?.source ?? null;
  if (!resource) return null;

  // Videos change every frame and would need re-measuring; not worth it.
  if (typeof HTMLVideoElement !== "undefined" && resource instanceof HTMLVideoElement) return "unmeasurable";

  const width  = resource.width ?? 0;
  const height = resource.height ?? 0;
  if (!width || !height) return null;   // not decoded yet

  return { resource, width, height };
}

/**
 * Scan the alpha channel and return the opaque box as texture fractions.
 * Returns FULL_BOUNDS when the art cannot be measured at all, and null when the
 * texture is not ready yet and the caller should retry.
 */
function _measure(texture) {
  const source = _resourceOf(texture);
  if (source === null) return null;
  if (source === "unmeasurable") return FULL_BOUNDS;

  const { resource, width, height } = source;

  // We scan the whole source image, so a texture that is only a window onto one
  // (an atlas frame) would be measured wrong. Token art is never atlased, but
  // bail rather than lie if it ever is.
  const frame = texture?.frame;
  if (frame && (frame.x || frame.y)) return FULL_BOUNDS;

  const ratio = Math.min(1, SAMPLE_MAX / Math.max(width, height));
  const w = Math.max(1, Math.round(width * ratio));
  const h = Math.max(1, Math.round(height * ratio));

  let data;
  try {
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return FULL_BOUNDS;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(resource, 0, 0, w, h);
    data = ctx.getImageData(0, 0, w, h).data;
  } catch (err) {
    // Cross-origin art taints the canvas; anything else is equally terminal.
    console.debug(`${MODULE} | art bounds: could not sample texture:`, err?.message);
    return FULL_BOUNDS;
  }

  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] <= ALPHA_THRESHOLD) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < 0) return FULL_BOUNDS;   // nothing opaque at all

  // Each sample stands for one cell of the downsampled grid, so the true edge
  // lies somewhere inside that cell — take the outer face of it.
  const bounds = {
    x0: minX / w,
    y0: minY / h,
    x1: (maxX + 1) / w,
    y1: (maxY + 1) / h,
  };

  // A box that fills the frame is the common case for character art; keep the
  // shared frozen object so callers can compare by identity if they care.
  if (bounds.x0 === 0 && bounds.y0 === 0 && bounds.x1 === 1 && bounds.y1 === 1) return FULL_BOUNDS;
  return bounds;
}

/**
 * Opaque bounds of a texture, as fractions of its frame.
 *
 * @param {string} src        Cache key — the texture's source path.
 * @param {PIXI.Texture} texture
 * @returns {{x0:number,y0:number,x1:number,y1:number}|null}
 *   null only while a first measurement is queued; callers should use the full
 *   frame for that render and rely on `onArtBoundsMeasured` to come back.
 */
export function getArtBounds(src, texture) {
  if (!src) return FULL_BOUNDS;

  const cached = _cache.get(src);
  if (cached) return cached;
  if (_pending.has(src)) return null;

  if (!texture) return null;   // nothing to measure yet; try again next refresh

  _pending.add(src);

  // Deferred so a measurement never lands inside a render pass — the notify
  // callback typically sets render flags, which is illegal mid-refresh.
  queueMicrotask(() => {
    let bounds = FULL_BOUNDS;
    try { bounds = _measure(texture); }
    catch (err) { console.debug(`${MODULE} | art bounds: measurement failed:`, err?.message); }

    _pending.delete(src);

    // Texture still decoding — leave the cache empty so the next refresh tries
    // again, but do not wait forever on art that will never arrive.
    if (bounds === null) {
      const attempts = (_attempts.get(src) ?? 0) + 1;
      _attempts.set(src, attempts);
      if (attempts < MAX_ATTEMPTS) return;
      bounds = FULL_BOUNDS;
    }

    _attempts.delete(src);
    _cache.set(src, bounds);
    try { _notify?.(src, bounds); } catch { /* ignore */ }
  });

  return null;
}

/**
 * How large the sprite is actually drawn, in token-local pixels.
 *
 * `PrimarySpriteMesh#resize` stores exactly this as the mesh's width/height —
 * `|scale × textureSize|` after the token's `fit` mode, texture scale and any
 * dynamic-ring adjustment — which is why we read it back rather than recompute
 * it. `document.getSize()` gives the grid footprint the art sits inside, so it
 * is only a fallback for a token whose mesh is not up yet.
 */
function _drawnSize(token) {
  const width  = Math.abs(Number(token.mesh?.width));
  const height = Math.abs(Number(token.mesh?.height));
  if (width > 0 && height > 0) return { width, height };

  return token.document.getSize();
}

/**
 * The opaque artwork's extents, plus the vector from the token's centre to the
 * artwork's centre — both in token-local pixels, before token rotation.
 *
 * The sprite hangs off the token centre by its texture anchor, so an anchor that
 * is not 0.5 shifts the art even when the art fills its frame. Falls back to the
 * whole sprite while a measurement is still pending.
 *
 * @returns {{width:number, height:number, offsetX:number, offsetY:number}}
 */
export function getTokenArtMetrics(token) {
  const drawn = _drawnSize(token);

  const data    = token.document.texture ?? {};
  const anchorX = Number.isFinite(Number(data.anchorX)) ? Number(data.anchorX) : 0.5;
  const anchorY = Number.isFinite(Number(data.anchorY)) ? Number(data.anchorY) : 0.5;

  const src = token.document.texture?.src;
  const bounds = src ? getArtBounds(src, token.mesh?.texture ?? token.texture) : null;

  const midX = bounds ? (bounds.x0 + bounds.x1) / 2 : 0.5;
  const midY = bounds ? (bounds.y0 + bounds.y1) / 2 : 0.5;

  return {
    width:  drawn.width  * (bounds ? bounds.x1 - bounds.x0 : 1),
    height: drawn.height * (bounds ? bounds.y1 - bounds.y0 : 1),
    offsetX: drawn.width  * (midX - anchorX),
    offsetY: drawn.height * (midY - anchorY),
  };
}
