/**
 * sta2e-toolkit | warp-jump-vfx.js
 *
 * The flash that sells a warp jump — the ship blows out in a burst of light at
 * the origin and blows back in at the destination, the way it reads on screen.
 *
 * Two rendering paths, picked at call time:
 *
 *   1. Sequencer + a configured JB2A file (Sounds & Animations → Ship Tasks →
 *      "Warp — Depart" / "Warp — Arrive").  Sequencer routes the effect to every
 *      client itself, so we must NOT also broadcast it.
 *   2. Native PIXI, built here.  This one is client-local, so we broadcast a
 *      `warpFlashVfx` socket message alongside it — the warp runners execute
 *      only on the responsible GM, and without the broadcast nobody else would
 *      see anything.  Same problem, same fix, as spawnEngineTrailVfx.
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

const MODULE = "sta2e-toolkit";

// How long each phase occupies in the warp runners' timeline. Exported so the
// movement code and the animation can never drift apart.
export const WARP_DEPART_MS = 700;
export const WARP_ARRIVE_MS = 550;

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

function _gLine(g, width, color, alpha) {
  if (typeof g.lineStyle === "function") g.lineStyle(width, color, alpha);
  else g._sta2eStroke = { width, color, alpha };
}

function _gCircle(g, cx, cy, r) {
  if (typeof g.drawCircle === "function") {
    g.drawCircle(cx, cy, r);
  } else {
    g.circle(cx, cy, r);
    if (g._sta2eFill)   { g.fill(g._sta2eFill);     delete g._sta2eFill; }
    if (g._sta2eStroke) { g.stroke(g._sta2eStroke); delete g._sta2eStroke; }
  }
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

/**
 * Radial white-hot core. Expands and fades; on arrival it runs in reverse
 * (large and dim → tight and bright) so the ship looks like it is condensing
 * out of the flash rather than exploding into it.
 */
function _coreBurst(layer, x, y, radius, phase, zBase) {
  const oc  = document.createElement("canvas");
  oc.width  = 128;
  oc.height = 128;
  const ctx = oc.getContext("2d");
  const rg  = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  rg.addColorStop(0,    "rgba(255,255,255,1)");
  rg.addColorStop(0.18, "rgba(255,255,255,0.9)");
  rg.addColorStop(0.42, `${WARP_COLORS.hex}dd`);
  rg.addColorStop(0.72, `${WARP_COLORS.hex}44`);
  rg.addColorStop(1,    "rgba(0,0,0,0)");
  ctx.fillStyle = rg;
  ctx.fillRect(0, 0, 128, 128);

  const sprite = new PIXI.Sprite(PIXI.Texture.from(oc));
  sprite.anchor.set(0.5);
  sprite.blendMode = _addBlend();
  sprite.width  = radius * 3;
  sprite.height = radius * 3;

  const container  = new PIXI.Container();
  container.x      = x;
  container.y      = y;
  container.zIndex = zBase + 3;
  container.alpha  = 0;
  container.addChild(sprite);
  layer.addChild(container);

  if (phase === "depart") {
    container.scale.set(0.3);
    _tween(container,       { alpha: 1, duration: 70, ease: "outQuad" });
    _tween(container.scale, { x: 2.4, y: 2.4, duration: 420, ease: "outQuad" });
    _tween(container,       { alpha: 0, duration: 380, ease: "inQuad" }, 120);
  } else {
    container.scale.set(2.2);
    _tween(container,       { alpha: 1, duration: 90, ease: "outQuad" });
    _tween(container.scale, { x: 0.45, y: 0.45, duration: 340, ease: "inQuad" });
    _tween(container,       { alpha: 0, duration: 260, ease: "inQuad" }, 200);
  }

  setTimeout(() => {
    try { container.destroy({ children: true }); } catch { /**/ }
  }, 700);
}

/**
 * Shockwave ring. Departure throws it outward; arrival snaps it inward.
 */
function _shockRing(layer, x, y, radius, phase, zBase) {
  const g = new PIXI.Graphics();
  _gLine(g, 3, WARP_COLORS.bright, 0.9);
  _gCircle(g, 0, 0, radius);
  // Set on the Graphics, not the Container — Container.blendMode only exists in
  // PIXI v8, so the parent would silently do nothing under v7.
  g.blendMode = _addBlend();

  const container  = new PIXI.Container();
  container.x      = x;
  container.y      = y;
  container.zIndex = zBase + 2;
  container.alpha  = 0.9;
  container.addChild(g);
  layer.addChild(container);

  if (phase === "depart") {
    container.scale.set(0.35);
    _tween(container.scale, { x: 2.8, y: 2.8, duration: 480, ease: "outCubic" });
    _tween(container,       { alpha: 0, duration: 440, ease: "inQuad" }, 60);
  } else {
    container.scale.set(2.6);
    _tween(container.scale, { x: 0.4, y: 0.4, duration: 320, ease: "inCubic" });
    _tween(container,       { alpha: 0, duration: 300, ease: "inQuad" }, 60);
  }

  setTimeout(() => {
    try { container.destroy({ children: true }); } catch { /**/ }
  }, 700);
}

/**
 * The streak — a soft light bar laid along the heading. This is the piece that
 * gives the flash a direction: on departure it stretches away from the ship, on
 * arrival it comes in from behind and collapses onto it.
 *
 * @param {number} heading  Direction of travel in radians (canvas atan2 space).
 */
function _warpStreak(layer, x, y, radius, heading, phase, zBase) {
  const oc  = document.createElement("canvas");
  oc.width  = 512;
  oc.height = 64;
  const ctx = oc.getContext("2d");
  const lg  = ctx.createLinearGradient(0, 0, 512, 0);
  lg.addColorStop(0,    "rgba(0,0,0,0)");
  lg.addColorStop(0.35, `${WARP_COLORS.hex}66`);
  lg.addColorStop(0.62, "rgba(255,255,255,0.95)");
  lg.addColorStop(0.80, `${WARP_COLORS.hex}88`);
  lg.addColorStop(1,    "rgba(0,0,0,0)");
  ctx.fillStyle = lg;
  ctx.fillRect(0, 0, 512, 64);

  const sprite = new PIXI.Sprite(PIXI.Texture.from(oc));
  sprite.anchor.set(0.5);
  sprite.blendMode = _addBlend();
  sprite.height = Math.max(6, radius * 0.55);

  const container  = new PIXI.Container();
  container.x      = x;
  container.y      = y;
  container.zIndex = zBase + 4;
  container.rotation = heading;
  container.alpha  = 0;
  container.addChild(sprite);
  layer.addChild(container);

  const longLength  = radius * 14;
  const shortLength = radius * 1.5;

  if (phase === "depart") {
    // Grows forward: the far end runs ahead of the ship.
    sprite.width = shortLength;
    sprite.x     = shortLength / 2;
    _tween(container, { alpha: 1, duration: 90,  ease: "outQuad" });
    _tween(sprite,    { width: longLength, x: longLength / 2, duration: 380, ease: "inQuad" });
    _tween(container, { alpha: 0, duration: 260, ease: "inQuad" }, 300);
  } else {
    // Arrives from behind and collapses onto the hull.
    sprite.width = longLength;
    sprite.x     = -longLength / 2;
    _tween(container, { alpha: 1, duration: 70,  ease: "outQuad" });
    _tween(sprite,    { width: shortLength, x: -shortLength / 2, duration: 300, ease: "outQuad" });
    _tween(container, { alpha: 0, duration: 220, ease: "inQuad" }, 180);
  }

  setTimeout(() => {
    try { container.destroy({ children: true }); } catch { /**/ }
  }, 700);
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
 */
export function playNativeWarpFlash({ x, y, x2, y2, radius = 50, heading = 0, phase = "depart" } = {}) {
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
    _warpStreak(layer, x, y, radius, heading, phase, zBase);
    _shockRing(layer, x, y, radius, phase, zBase);
    _coreBurst(layer, x, y, radius, phase, zBase);
  } catch (err) {
    console.warn("STA2e Toolkit | warp flash render failed:", err);
  }
}

// ── Configuration ────────────────────────────────────────────────────────────

const ANIM_KEYS = {
  depart:   "shipTasks.warpDepart.anim",
  arrive:   "shipTasks.warpArrive.anim",
  corridor: "shipTasks.warpCorridor.anim",
};

// An impact burst is the closest stock JB2A asset to an on-screen warp flash;
// its white variant is patron-only, so the free pack falls back to yellow.
// The corridor is a ranged (stretch-to) asset — same key in both tiers.
// All three are overridable in Sounds & Animations → Ship Tasks.
const ANIM_DEFAULTS = {
  depart: {
    patron: "jb2a.impact.007.white",
    free:   "jb2a.impact.007.yellow",
  },
  arrive: {
    patron: "jb2a.impact.007.white",
    free:   "jb2a.impact.007.yellow",
  },
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
  const key = ANIM_KEYS[phase] ?? ANIM_KEYS.depart;
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
  const fallback = ANIM_DEFAULTS[phase] ?? ANIM_DEFAULTS.depart;
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
 */
export async function playWarpFlash(token, phase = "depart", opts = {}) {
  const gridSize = canvas?.grid?.size ?? 100;
  const tokW = (token?.document?.width  ?? 1) * gridSize;
  const tokH = (token?.document?.height ?? 1) * gridSize;
  const x = opts.x ?? token?.center?.x ?? ((token?.x ?? 0) + tokW / 2);
  const y = opts.y ?? token?.center?.y ?? ((token?.y ?? 0) + tokH / 2);
  const radius = Math.max(20, Math.max(tokW, tokH) / 2);
  const heading = Number.isFinite(opts.heading) ? opts.heading : 0;

  playWarpSound(opts.soundKey);

  const path = getWarpAnimPath(phase);
  if (window.Sequence && path) {
    try {
      const seq = new window.Sequence()
        .effect()
        .file(path)
        .atLocation({ x, y })
        .size(radius * 6)
        .rotate(heading * (180 / Math.PI))
        .fadeIn(80)
        .fadeOut(250);
      // Sequencer routes to every client itself — no socket broadcast here.
      await seq.play();
      return;
    } catch (err) {
      console.warn("STA2e Toolkit | Sequencer warp flash failed, using native:", err);
    }
  }

  // Native path is client-local, so tell everyone else to draw it too.
  playNativeWarpFlash({ x, y, radius, heading, phase });
  try {
    game.socket.emit("module.sta2e-toolkit", {
      action: "warpFlashVfx",
      x, y, radius, heading, phase,
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
