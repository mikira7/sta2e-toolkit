/**
 * sta2e-toolkit | warp-jump-vfx.js
 *
 * The flash that sells a warp jump — the ship blows out in a burst of light at
 * the origin and blows back in at the destination, the way it reads on screen.
 *
 * The depart/arrive flashes are always native PIXI (streak + shock ring + core
 * burst) — client-local, so a `warpFlashVfx` socket message is broadcast
 * alongside them; the warp runners execute only on the responsible GM, and
 * without the broadcast nobody else would see anything. Same problem, same
 * fix, as spawnEngineTrailVfx. Only the corridor still goes through Sequencer
 * + JB2A when available (Sequencer routes that one to every client itself).
 *
 * This file also owns the pre-warp nacelle charge glow, which sweeps the warp
 * splines drawn in the Ship VFX Anchors editor (see playWarpChargeGlow below).
 *
 * The socket payload carries explicit canvas coordinates rather than a tokenId:
 * the arrival flash fires immediately after a teleport, and a remote client
 * resolving the token could still read its pre-teleport position.
 *
 * Sound is played outside Sequencer entirely (AudioHelper with the broadcast
 * flag) so warp is audible in worlds that do not have Sequencer installed —
 * which was the old behaviour's silent failure mode.
 *
 * Public API:
 *   await playWarpFlash(token, "depart" | "arrive", { heading, soundKey })
 *   playNativeWarpFlash({ x, y, radius, heading, phase })   // socket receiver
 */

import {
  getShipWarpCurves,
  getShipEngineTrailSettings,
  resolveEngineTrailColorHex,
  sampleShipArrayCurve,
  tokenArrayCurveToCanvasCurve,
  warpCurveAftIsEnd,
} from "./ship-vfx-anchors.js";
import {
  getWarpEffectStyle,
  normalizeWarpEffectStyleId,
  resolveWarpSoundKey,
} from "./warp-effect-styles.js";

const MODULE = "sta2e-toolkit";

// How long each phase occupies in the warp runners' timeline. Exported so the
// movement code and the animation can never drift apart. The flash is the
// Warp-Flash.webm clip: ~1s long with its biggest frame ~3/4 in — the runners
// vanish/reveal the ship at WARP_FLASH_PEAK_MS, not at the clip start.
//
// These are the *standard* style's numbers, still used directly by the in-scene
// warp jump. Anything that can play a non-standard style must read its timing
// from getWarpFlashTiming(styleId) in warp-effect-styles.js instead.
export const WARP_DEPART_MS = 1000;
export const WARP_ARRIVE_MS = 1000;
export const WARP_FLASH_PEAK_MS = 750;

// Warp light is cold and very bright — white core, blue-white falloff.
const WARP_COLORS = {
  primary: 0x66bbff,
  bright:  0xcceeff,
  hex:     "#66bbff",
};

// Baseline VFX zIndex, matching transporter-vfx.js. The effective value is
// computed per call against the token's live elevation-derived zIndex.
const VFX_Z_BASE = 900_000;

// ── PIXI compatibility shims ─────────────────────────────────────────────────
// Foundry v14 ships PIXI v8, which changed blend modes (number → string) and
// the Graphics API (fill comes AFTER the shape method, not before).

function _addBlend() {
  if (typeof PIXI?.BLEND_MODES?.ADD === "number") return PIXI.BLEND_MODES.ADD;
  return "add";
}

function _gPolyline(g, pts, width, color, alpha) {
  if (pts.length < 2) return;
  if (typeof g.lineStyle === "function") {
    g.lineStyle(width, color, alpha);
    g.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
    g.lineStyle(0);
  } else {
    g.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
    g.stroke({ width, color, alpha });
  }
}

function _parseHexColor(hex, fallback) {
  const parsed = Number.parseInt(String(hex ?? "").replace(/^#/, ""), 16);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// Mix a 24-bit color toward white by `amount` (0..1) for the bright core pass.
function _lighten(color, amount) {
  const r = (color >> 16) & 0xff;
  const gch = (color >> 8) & 0xff;
  const b = color & 0xff;
  const mix = c => Math.min(255, Math.round(c + (255 - c) * amount));
  return (mix(r) << 16) | (mix(gch) << 8) | mix(b);
}

// ── animejs ──────────────────────────────────────────────────────────────────

function _tween(target, params, delayMs = 0) {
  const aj = globalThis.animejs ?? null;
  if (aj?.animate) {
    const p = delayMs > 0 ? { ...params, delay: delayMs } : params;
    try { aj.animate(target, p); return; } catch { /* fall through */ }
  }
  setTimeout(() => {
    for (const [k, v] of Object.entries(params)) {
      if (k === "duration" || k === "ease" || k === "delay") continue;
      try { target[k] = Array.isArray(v) ? v[v.length - 1] : v; } catch { /**/ }
    }
  }, delayMs);
}

function _effectLayer() {
  const layer = canvas?.tokens ?? canvas?.interface ?? canvas?.primary ?? canvas?.stage ?? null;
  if (layer && !layer.sortableChildren) layer.sortableChildren = true;
  return layer;
}

// ── Native flash pieces ──────────────────────────────────────────────────────

// The clip, its size multiplier and the moment of its decisive frame all live
// on the style now — see warp-effect-styles.js. The standard style is the
// hand-made Warp-Flash.webm; timeships can swap in the Temporal Rift.

// One warning per style per session if a flash video turns out to be
// origin-tainted — repeated jumps would otherwise spam the console. Keyed by
// style so a failure on one clip never silences the other. See _webmFlash.
const _taintWarned = new Set();

// GM-tunable size multiplier (Sounds & Animations → Ship Tasks), stored as a
// percent. Each style names its own setting key, so sizing the rift never
// resizes the standard flash. World scope, so every client scales alike.
function _styleScale(style) {
  const key = style?.scaleSettingKey;
  if (!key) return 1;
  try {
    const pct = Number(game.settings.get(MODULE, key));
    if (!Number.isFinite(pct) || pct <= 0) return 1;
    return Math.min(5, Math.max(0.1, pct / 100));
  } catch { return 1; }   // setting not registered yet
}

/**
 * Play a style's webm as a PIXI video sprite at a canvas point. The same clip
 * serves depart and arrive; the runners time the token fade against the style's
 * peak instead of the clip playing differently per phase.
 * Additive blend keeps any black background reading as pure light.
 */
/**
 * Drain the colour out of a style's clip, for `whiten` styles.
 *
 * A sprite tint multiplies, so it can only ever darken or shift a colour — it
 * cannot turn the blue-white warp clip into Q's white-hot snap. A colour matrix
 * can: desaturate to grey, then push the brightness back up past what the
 * desaturation cost. Silently skipped when the filter is unavailable, so the
 * flash degrades to its normal blue rather than disappearing.
 */
function _applyWhiten(sprite, style) {
  if (!style?.whiten) return;
  try {
    const CMF = PIXI.ColorMatrixFilter ?? PIXI.filters?.ColorMatrixFilter;
    if (!CMF) return;
    const cmf = new CMF();
    cmf.desaturate();
    cmf.brightness(1.35, true);   // multiply=true, so it stacks on the desaturate
    sprite.filters = [cmf];
  } catch (err) {
    console.warn("STA2e Toolkit | whiten filter unavailable:", err);
  }
}

function _webmFlash(layer, x, y, radius, zBase, style, heading = 0) {
  const video = document.createElement("video");
  // Must precede the src assignment to take effect. Hosted games (The Forge)
  // redirect module assets to a CDN on another origin; without this the element
  // is origin-tainted and the first WebGL upload of it kills the canvas.
  video.crossOrigin = "anonymous";
  video.muted = true;
  video.playsInline = true;
  video.loop = false;
  video.preload = "auto";
  video.src = style.src;

  let container = null;
  let done = false;
  // Armed before load() so a decode that never fires "loadeddata" is still
  // reaped. Deliberately generous: styles differ in length by 5x, so this is
  // only a ceiling — it gets re-armed from the real duration once known.
  let backstop = setTimeout(() => cleanup(), 15000);
  const cleanup = () => {
    if (done) return;
    done = true;
    clearTimeout(backstop);
    try { container?.destroy({ children: true }); } catch { /**/ }
    container = null;
    // Release the media element so the browser drops the decoder right away.
    try { video.pause(); video.removeAttribute("src"); video.load(); } catch { /**/ }
  };

  video.addEventListener("loadeddata", () => {
    if (done || !layer || layer.destroyed) return;

    // Confirm the frame is readable before PIXI ever sees it. A tainted video
    // throws here, synchronously and catchably; the equivalent WebGL failure
    // throws on a later render tick, outside any try/catch, and leaves the
    // batch renderer corrupt — a black canvas until reload.
    try {
      const probe = document.createElement("canvas");
      probe.width = probe.height = 1;
      const pctx = probe.getContext("2d", { willReadFrequently: true });
      pctx.drawImage(video, 0, 0, 1, 1);
      pctx.getImageData(0, 0, 1, 1);
    } catch (err) {
      if (!_taintWarned.has(style.id)) {
        _taintWarned.add(style.id);
        console.warn(`STA2e Toolkit | warp flash video (${style.id}) is cross-origin and cannot be rendered; skipping the flash:`, err);
      }
      cleanup();
      return;
    }

    let sprite;
    try {
      sprite = new PIXI.Sprite(PIXI.Texture.from(video));
    } catch (err) {
      console.warn("STA2e Toolkit | warp flash video texture failed:", err);
      cleanup();
      return;
    }
    sprite.anchor.set(0.5);
    sprite.blendMode = _addBlend();
    _applyWhiten(sprite, style);
    const vw = video.videoWidth || 1;
    const vh = video.videoHeight || 1;
    const scale = (radius * style.scaleMul * _styleScale(style)) / Math.max(vw, vh);
    sprite.width  = vw * scale;
    sprite.height = vh * scale;

    container = new PIXI.Container();
    container.x      = x;
    container.y      = y;
    container.zIndex = zBase + 2;
    // Rotation belongs on the container, not the sprite: the sprite carries the
    // anchor and the width/height sizing above, and spinning it would fight
    // both. A style that does not orient stays pinned upright at 0.
    container.rotation = style.orientToHeading
      ? heading + (style.rotationOffsetDeg ?? 0) * (Math.PI / 180)
      : 0;
    container.addChild(sprite);
    layer.addChild(container);
    video.play().catch(() => { /* autoplay policy — muted, should not happen */ });

    // Re-arm the backstop against the clip's real length, now that it is known.
    // Number.isFinite is load-bearing, not defensive padding: some webm muxes
    // report Infinity until "durationchange", and setTimeout(fn, Infinity)
    // coerces to 1ms — the sprite would vanish the instant it appeared.
    const durMs = (Number.isFinite(video.duration) && video.duration > 0)
      ? video.duration * 1000
      : 0;
    clearTimeout(backstop);
    // The slack covers decode jitter, so the backstop never beats a real "ended".
    backstop = setTimeout(() => cleanup(), (durMs || 5000) + 1000);
  }, { once: true });

  video.addEventListener("ended", cleanup, { once: true });
  video.addEventListener("error", cleanup, { once: true });
  video.load();
}

/**
 * The corridor — one bar of light spanning the entire jump, from where the ship
 * warped out to where it warped in. Unlike the streak this is anchored at both
 * ends, so its length is the jump distance rather than a multiple of the hull.
 */
function _warpCorridor(layer, from, to, width, zBase) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length < 1) return;

  const oc  = document.createElement("canvas");
  oc.width  = 512;
  oc.height = 64;
  const ctx = oc.getContext("2d");
  const lg  = ctx.createLinearGradient(0, 0, 512, 0);
  lg.addColorStop(0,    "rgba(0,0,0,0)");
  lg.addColorStop(0.12, `${WARP_COLORS.hex}99`);
  lg.addColorStop(0.5,  "rgba(255,255,255,0.9)");
  lg.addColorStop(0.88, `${WARP_COLORS.hex}99`);
  lg.addColorStop(1,    "rgba(0,0,0,0)");
  ctx.fillStyle = lg;
  ctx.fillRect(0, 0, 512, 64);

  const sprite = new PIXI.Sprite(PIXI.Texture.from(oc));
  sprite.anchor.set(0, 0.5);        // left edge pins to the departure point
  sprite.blendMode = _addBlend();
  sprite.width  = length;
  sprite.height = Math.max(4, width);

  const container    = new PIXI.Container();
  container.x        = from.x;
  container.y        = from.y;
  container.rotation = Math.atan2(dy, dx);
  container.zIndex   = zBase + 1;   // under the flashes at either end
  container.alpha    = 0;
  container.addChild(sprite);
  layer.addChild(container);

  _tween(container, { alpha: 1, duration: 110, ease: "outQuad" });
  _tween(container, { alpha: 0, duration: 420, ease: "inQuad" }, 200);
  _tween(sprite,    { height: Math.max(2, width * 0.25), duration: 520, ease: "inQuad" }, 120);

  setTimeout(() => {
    try { container.destroy({ children: true }); } catch { /**/ }
  }, 800);
}

/**
 * Render a native warp effect. Fire-and-forget; every piece self-destructs.
 * Safe to call on any client — it touches no documents.
 *
 * @param {object}  opts
 * @param {number}  opts.x        Canvas x of the effect origin
 * @param {number}  opts.y        Canvas y of the effect origin
 * @param {number}  [opts.x2]     Far end, "corridor" phase only
 * @param {number}  [opts.y2]     Far end, "corridor" phase only
 * @param {number}  opts.radius   Token radius in pixels (drives every dimension)
 * @param {number}  opts.heading  Direction of travel, radians
 * @param {"depart"|"arrive"|"corridor"} opts.phase
 * @param {string}  [opts.styleId] Warp effect style; defaults to the standard
 *                                 flash, which is also what an older client's
 *                                 socket payload resolves to.
 */
export function playNativeWarpFlash({ x, y, x2, y2, radius = 50, heading = 0, phase = "depart", styleId = "standard" } = {}) {
  if (typeof PIXI === "undefined") return;
  const layer = _effectLayer();
  if (!layer) return;

  // Beat the token's own elevation-derived zIndex, which is small but live.
  const zBase = VFX_Z_BASE;

  try {
    if (phase === "corridor") {
      _warpCorridor(layer, { x, y }, { x: x2, y: y2 }, radius * 0.5, zBase);
      return;
    }
    _webmFlash(layer, x, y, radius, zBase, getWarpEffectStyle(styleId), heading);
  } catch (err) {
    console.warn("STA2e Toolkit | warp flash render failed:", err);
  }
}

// ── Configuration ────────────────────────────────────────────────────────────

// The depart/arrive flashes are always native PIXI now (the old JB2A impact
// burst never read as a warp flash); only the corridor still uses a JB2A
// ranged asset, overridable in Sounds & Animations → Ship Tasks.
const ANIM_KEYS = {
  corridor: "shipTasks.warpCorridor.anim",
};

// The corridor is a ranged (stretch-to) asset — same key in both tiers.
const ANIM_DEFAULTS = {
  corridor: {
    patron: "jb2a.energy_strands.range.standard.blue.04.90ft",
    free:   "jb2a.energy_strands.range.standard.purple.04.90ft",
  },
};

// The free pack only ships the purple strand, so it gets pulled toward the blue
// the patron asset already is. Sequencer's tint multiplies, so this can only
// darken channels the source already has — purple lands on a deep warp blue
// rather than the lighter cyan, which is as close as a multiply gets.
//
// Only applied to the built-in default: a GM who names their own corridor file
// gets it exactly as authored.
const WARP_CORRIDOR_FREE_TINT = 0x66ccff;

function _isPatron() {
  try { return game.settings.get(MODULE, "jb2aTier") === "patron"; }
  catch { return false; }
}

/** The GM's configured path for a phase, or "" when they have not set one. */
function _animOverride(phase) {
  const key = ANIM_KEYS[phase] ?? ANIM_KEYS.corridor;
  try {
    return foundry.utils.getProperty(
      game.settings.get(MODULE, "animationOverrides") ?? {}, key
    ) ?? "";
  } catch { return ""; }   // setting not registered yet
}

/** Configured JB2A path for a phase, or the built-in default for this tier. */
export function getWarpAnimPath(phase) {
  const override = _animOverride(phase);
  if (override) return override;
  const fallback = ANIM_DEFAULTS[phase] ?? ANIM_DEFAULTS.corridor;
  return _isPatron() ? fallback.patron : fallback.free;
}

/** Tint to apply to the corridor, or null to leave the asset's own colour. */
export function getWarpCorridorTint() {
  if (_animOverride("corridor")) return null;   // GM's own file, GM's own colour
  return _isPatron() ? null : WARP_CORRIDOR_FREE_TINT;
}

/**
 * Ceiling on how long the ship waits hidden at the far end for the corridor to
 * finish. The wait itself is driven by the effect's real duration; this only
 * caps it, so a missing or hung asset can never strand the ship invisible —
 * and so a GM who finds the arrival too slow can cut it short.
 */
export function getWarpCorridorMaxWaitMs() {
  try {
    const ms = Number(game.settings.get(MODULE, "timingWarpCorridor"));
    return Number.isFinite(ms) ? Math.max(0, ms) : 2000;
  } catch { return 2000; }
}

/**
 * Play a configured sound on every client. Deliberately not routed through
 * Sequencer so warp stays audible without it.
 */
export function playWarpSound(settingKey, volume = 0.8) {
  if (!settingKey) return;
  let src = "";
  try { src = game.settings.get(MODULE, settingKey) ?? ""; } catch { return; }
  if (!src) return;
  try {
    const AudioHelper = foundry.audio?.AudioHelper ?? globalThis.AudioHelper;
    AudioHelper?.play({ src, volume, autoplay: true, loop: false }, true);
  } catch (err) {
    console.warn("STA2e Toolkit | warp sound failed:", err);
  }
}

// ── Public entry point ───────────────────────────────────────────────────────

/**
 * Play the warp flash for one phase, plus its sound.
 *
 * @param {Token}  token           Canvas token (used for position and size)
 * @param {"depart"|"arrive"} phase
 * @param {object} [opts]
 * @param {number} [opts.heading]  Direction of travel in radians
 * @param {number} [opts.x]        Override centre x (defaults to token centre)
 * @param {number} [opts.y]        Override centre y
 * @param {string} [opts.soundKey] Settings key of the sound to play
 * @param {string} [opts.styleId]  Warp effect style id. Deliberately NOT
 *   resolved from the token here: a caller that has not opted in must keep the
 *   standard clip, because it is also timing its token fades against the
 *   standard WARP_FLASH_PEAK_MS. Only callers that read getWarpFlashTiming()
 *   for the same style may pass this.
 */
export async function playWarpFlash(token, phase = "depart", opts = {}) {
  const gridSize = canvas?.grid?.size ?? 100;
  const tokW = (token?.document?.width  ?? 1) * gridSize;
  const tokH = (token?.document?.height ?? 1) * gridSize;
  const x = opts.x ?? token?.center?.x ?? ((token?.x ?? 0) + tokW / 2);
  const y = opts.y ?? token?.center?.y ?? ((token?.y ?? 0) + tokH / 2);
  const radius = Math.max(20, Math.max(tokW, tokH) / 2);
  const heading = Number.isFinite(opts.heading) ? opts.heading : 0;
  const styleId = normalizeWarpEffectStyleId(opts.styleId);
  const style = getWarpEffectStyle(styleId);

  // A style-specific sound only wins once the GM points it at a file; otherwise
  // the caller's normal warp sound plays.
  playWarpSound(resolveWarpSoundKey(style, phase, opts.soundKey));

  // Depart/arrive are always native PIXI. Client-local, so tell everyone else
  // to draw it too. The style travels as an id rather than a path, so each
  // client resolves its own settings (and an unknown id degrades to standard).
  playNativeWarpFlash({ x, y, radius, heading, phase, styleId });
  try {
    game.socket.emit("module.sta2e-toolkit", {
      action: "warpFlashVfx",
      x, y, radius, heading, phase, styleId,
    });
  } catch { /* cosmetic — never block the jump */ }
}

/**
 * Play the warp corridor — a single ranged effect spanning the whole jump, from
 * the point the ship warped out to the point it warped in.
 *
 * Fire this at the moment of the teleport, alongside the two end flashes.
 *
 * @param {{x:number, y:number}} from   Departure point (canvas centre coords)
 * @param {{x:number, y:number}} to     Arrival point
 * @param {object} [opts]
 * @param {number} [opts.width]         Corridor thickness in pixels
 */
export async function playWarpCorridor(from, to, opts = {}) {
  if (!from || !to) return;
  const gridSize = canvas?.grid?.size ?? 100;
  const width = opts.width ?? gridSize * 0.5;

  const path = getWarpAnimPath("corridor");
  if (window.Sequence && path) {
    try {
      // stretchTo pins the asset between both points and scales it to the gap,
      // which is what the ".90ft" ranged variants are built for.
      //
      // waitUntilFinished is what makes the returned promise mean anything:
      // without it Sequencer resolves play() as soon as the section is queued,
      // so the caller would race ahead while the asset was still loading — the
      // ship would reappear before the strand had started drawing.
      const effect = new window.Sequence()
        .effect()
        .file(path)
        .atLocation(from)
        .stretchTo(to)
        .fadeIn(120)
        .fadeOut(350)
        .waitUntilFinished();
      const tint = getWarpCorridorTint();
      if (tint !== null) effect.tint(tint);
      await effect.play();
      return;
    } catch (err) {
      console.warn("STA2e Toolkit | Sequencer warp corridor failed, using native:", err);
    }
  }

  playNativeWarpFlash({
    x: from.x, y: from.y, x2: to.x, y2: to.y,
    radius: width * 2, phase: "corridor",
  });
  try {
    game.socket.emit("module.sta2e-toolkit", {
      action: "warpFlashVfx",
      x: from.x, y: from.y, x2: to.x, y2: to.y,
      radius: width * 2, phase: "corridor",
    });
  } catch { /* cosmetic */ }
}

// ── Warp charge glow ─────────────────────────────────────────────────────────
// The nacelle power-up: a light sweeps fore-to-aft along each warp spline drawn
// in the Ship VFX Anchors editor, leaves the whole spline lit, and builds to
// peak brightness until stop() cuts it — timed by the warp runner so the peak
// lands on the depart flash. The curves are re-mapped from the token every
// frame, so the glow rides the ship through its pre-warp rotation and run-up.

const _warpChargeInstances = new Map();   // token document id → { stop }

function _resolveChargeToken(tokenOrDoc) {
  if (!tokenOrDoc) return null;
  if (tokenOrDoc.object) return tokenOrDoc.object;            // TokenDocument
  if (tokenOrDoc.document) return tokenOrDoc;                 // Token
  return canvas?.tokens?.get?.(String(tokenOrDoc)) ?? null;   // id
}

/**
 * Client-local. Returns { stop() }; stop pops the glow bright then fades it.
 *
 * @param {Token|TokenDocument|string} tokenOrDoc
 * @param {object} [opts]
 * @param {number} [opts.sweepMs]    Fore-to-aft sweep time
 * @param {number} [opts.peakHoldMs] Self-expiry cap after the sweep, so a
 *                                   remote client can never keep a stuck glow
 * @param {number} [opts.fadeMs]     Fade-out after stop()
 */
export function playWarpChargeGlow(tokenOrDoc, opts = {}) {
  const inert = { stop() { /* no curves, nothing to do */ } };
  if (typeof PIXI === "undefined" || !canvas?.app?.ticker) return inert;
  const token = _resolveChargeToken(tokenOrDoc);
  if (!token) return inert;
  const curves = getShipWarpCurves(token);
  if (!curves.length) return inert;
  const layer = _effectLayer();
  if (!layer) return inert;

  const sweepMs = Math.max(120, Number(opts.sweepMs) || 500);
  const peakHoldMs = Math.max(200, Number(opts.peakHoldMs) || 4000);
  const fadeMs = Math.max(60, Number(opts.fadeMs) || 180);

  const mode = getShipEngineTrailSettings(token)?.warp ?? null;
  const color = _parseHexColor(resolveEngineTrailColorHex(token, "warp", mode), WARP_COLORS.primary);
  const coreColor = _lighten(color, 0.65);
  const blend = _addBlend();
  const baseWidth = Math.max(2, Number(mode?.width) || 9);
  // Ship VFX Anchors → Warp tab → "Glow Size"; 0 turns the filter off.
  const glowSize = Math.max(0, Number(mode?.glowSize ?? 18));

  // Replace any glow already running on this token (restart, double engage).
  const tokenId = token.document?.id ?? token.id;
  try { _warpChargeInstances.get(tokenId)?.stop?.({ immediate: true }); } catch { /**/ }

  // One GlowFilter per strand does the actual "glow" — bare additive strokes
  // alone read as flat lines. Filters are NOT destroyed by container.destroy,
  // so cleanup() releases them explicitly (same etiquette as shield-bubble).
  const GlowFilterClass = glowSize > 0
    ? (PIXI.filters?.GlowFilter ?? globalThis.PIXI?.filters?.GlowFilter ?? null)
    : null;

  const strands = curves.map(curve => {
    const container = new PIXI.Container();
    container.zIndex = curve.layer === "below" ? -VFX_Z_BASE : VFX_Z_BASE + 5;
    const g = new PIXI.Graphics();
    g.blendMode = blend;
    container.addChild(g);
    let glowFilter = null;
    if (GlowFilterClass) {
      try {
        glowFilter = new GlowFilterClass({
          distance: glowSize,
          outerStrength: 2.6,
          innerStrength: 0.4,
          color,
          quality: 0.3,
        });
        container.filters = [glowFilter];
      } catch { glowFilter = null; }
    }
    layer.addChild(container);
    // The sweep always travels fore → aft; the curve's direction setting (or
    // the auto image-space fallback) decides which end that is.
    const reversed = !warpCurveAftIsEnd(curve);
    return { curve, container, g, glowFilter, reversed };
  });

  const startedAt = performance.now();
  let stoppingAt = 0;
  let finished = false;

  const cleanup = () => {
    if (finished) return;
    finished = true;
    try { canvas.app.ticker.remove(tick); } catch { /**/ }
    for (const strand of strands) {
      try {
        strand.container.filters = [];
        strand.glowFilter?.destroy?.();
      } catch { /**/ }
      try { strand.container.destroy({ children: true }); } catch { /**/ }
    }
    if (_warpChargeInstances.get(tokenId) === instance) _warpChargeInstances.delete(tokenId);
  };

  function tick() {
    if (finished) return;
    const now = performance.now();
    const elapsed = now - startedAt;

    // Sweep head position (0..1 fore→aft), then brightness build to the peak.
    const headT = Math.min(1, elapsed / sweepMs);
    const build = Math.min(1, Math.max(0, (elapsed - sweepMs) / Math.max(1, peakHoldMs * 0.55)));
    let intensity = 0.55 + 0.45 * build;
    let containerAlpha = 1;

    if (stoppingAt) {
      const sinceStop = now - stoppingAt;
      // Quick bright pop, then fade out.
      intensity = sinceStop < 80 ? 1.5 : 1.2;
      containerAlpha = Math.max(0, 1 - Math.max(0, sinceStop - 80) / fadeMs);
      if (sinceStop > 80 + fadeMs) { cleanup(); return; }
    } else if (elapsed > sweepMs + peakHoldMs) {
      instance.stop();   // self-expire so nobody keeps a stuck glow
    }

    for (const strand of strands) {
      const g = strand.g;
      g.clear();
      strand.container.alpha = containerAlpha;
      // The filter carries the actual glow; ramp it with the charge so the
      // strand blooms as it builds and pops at the stop flash.
      if (strand.glowFilter) strand.glowFilter.outerStrength = 1.6 + 1.8 * intensity;
      const canvasCurve = tokenArrayCurveToCanvasCurve(token, strand.curve);
      const samples = canvasCurve ? sampleShipArrayCurve(canvasCurve) : [];
      if (samples.length < 2) continue;
      const n = samples.length - 1;
      const litFrom = strand.reversed ? Math.round((1 - headT) * n) : 0;
      const litTo = strand.reversed ? n : Math.round(headT * n);
      const lit = samples.slice(litFrom, litTo + 1);
      if (lit.length >= 2) {
        _gPolyline(g, lit, baseWidth * 4.2, color, 0.10 * intensity);
        _gPolyline(g, lit, baseWidth * 2.4, color, 0.22 * intensity);
        _gPolyline(g, lit, baseWidth * 1.2, color, 0.50 * intensity);
        _gPolyline(g, lit, Math.max(1.5, baseWidth * 0.45), coreColor, 0.95 * Math.min(1, intensity));
      }
    }
  }

  const instance = {
    stop({ immediate = false } = {}) {
      if (finished) return;
      if (immediate) { cleanup(); return; }
      if (!stoppingAt) stoppingAt = performance.now();
    },
  };
  _warpChargeInstances.set(tokenId, instance);
  canvas.app.ticker.add(tick);
  // Backstop in case the ticker dies mid-effect (scene teardown mid-jump).
  setTimeout(cleanup, sweepMs + peakHoldMs + fadeMs + 2000);
  return instance;
}

/** Socket receiver: stop (with the usual pop-fade) whatever glow a token has. */
export function stopWarpChargeGlow(tokenId) {
  try { _warpChargeInstances.get(tokenId)?.stop?.(); } catch { /**/ }
}

/**
 * Draw the glow locally and tell every other client to draw it too. Returns a
 * handle whose stop() also broadcasts the stop, so the pop-fade lands at the
 * same moment (the depart flash) everywhere.
 */
export function broadcastWarpChargeGlow(token, opts = {}) {
  const local = playWarpChargeGlow(token, opts);
  const tokenId = token?.document?.id ?? token?.id ?? null;
  const sceneId = canvas?.scene?.id ?? null;
  if (tokenId) {
    try {
      game.socket.emit("module.sta2e-toolkit", {
        action: "warpChargeVfx",
        tokenId, sceneId,
        sweepMs: opts.sweepMs, peakHoldMs: opts.peakHoldMs, fadeMs: opts.fadeMs,
      });
    } catch { /* cosmetic — never block the jump */ }
  }
  return {
    stop() {
      try { local.stop(); } catch { /**/ }
      if (!tokenId) return;
      try {
        game.socket.emit("module.sta2e-toolkit", {
          action: "stopWarpChargeVfx",
          tokenId, sceneId,
        });
      } catch { /* cosmetic */ }
    },
  };
}
