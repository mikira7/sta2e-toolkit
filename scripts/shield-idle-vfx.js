/**
 * sta2e-toolkit | shield-idle-vfx.js
 *
 * Shields *up* — the standing envelope, as opposed to the one-shot flash a
 * weapon hit produces.
 *
 * A ship with shields raised wears a dim coloured bubble with static crawling
 * over its surface and small sparks popping at random points on the boundary:
 * the look of a hull sitting inside a nebula or an ion storm that is
 * continuously battering the shields. It stays until it is switched off.
 *
 * This is the standing counterpart to shield-bubble-vfx.js, and it borrows that
 * module's geometry wholesale — `getShieldEnvelopeGeometry` / `seatShieldEnvelope`
 * / `drawShieldRim` / `drawShieldEnvelopeFill`. Two effects on one hull deriving
 * their own radii would visibly disagree the moment a shot landed on a ship that
 * already had its shields up, so there is exactly one source of that maths.
 *
 * State, not an event
 * -------------------
 * The impact bubble fires from whichever client applied the damage and has to
 * broadcast itself over a socket. This one is *state*, so it lives on the token
 * document as `flags.sta2e-toolkit.shieldsUp = { level }` and Foundry replicates
 * it. Every client's `updateToken` hook fires and each starts its own PIXI
 * effect — no socket action, and the envelope restores itself across a reload
 * and a scene change for free. Same arrangement as the persistent tractor beam
 * in tractor-beam-vfx.js.
 *
 * Cost
 * ----
 * A standing effect runs forever, possibly on several ships at once, so the
 * expensive parts are shared and the cheap parts are throttled: the noise frames
 * and the spark gradient are baked once for the whole session and tinted per
 * ship, the rim is drawn once and only its alpha moves, and the grain advances
 * at its own 8–18 fps rather than once per rendered frame — static reads better
 * under-sampled anyway.
 *
 * Public API:
 *   raiseShields(token, level) / lowerShields(token) / cycleShieldLevel(token)
 *   getShieldIdleState(token) → { level } | null
 *   refreshShieldIdleVfx() / rebuildShieldIdleVfx() / stopAllShieldIdleVfx()
 *   registerShieldIdleVfxHooks()
 *   testShieldIdle(level)                                  // console helper
 */

import {
  RIM_WIDTH,
  getShieldEnvelopeGeometry,
  seatShieldEnvelope,
  drawShieldRim,
  drawShieldEnvelopeFill,
} from "./shield-bubble-vfx.js";
import {
  resolveShieldImpactColorHex,
  resolveShieldStandoffFactor,
} from "./ship-vfx-anchors.js";

const MODULE   = "sta2e-toolkit";
const FLAG_KEY = "shieldsUp";

/**
 * Baseline zIndex. Deliberately below shield-bubble-vfx.js's 900_000: when a
 * shot lands on a ship that already has its shields up, the impact has to read
 * over the standing field rather than through it.
 */
const VFX_Z_BASE = 890_000;

/** Concurrent standing envelopes. A fleet scene must not bury the frame budget. */
const MAX_LIVE = 8;

// ── The noise texture ────────────────────────────────────────────────────────

/** Pre-baked static frames, cycled to make the grain boil. */
const GRAIN_FRAMES = 5;

/** Edge of each square noise frame, in texture px. */
const GRAIN_SIZE = 192;

/**
 * How far past the envelope the grain sprite is drawn. The sprite drifts, and
 * the mask clips at the envelope, so it has to be big enough that a drifted
 * sprite never shows its own edge inside the bubble.
 */
const GRAIN_OVERSCAN = 1.3;

/** Fraction of pixels left dark in each frame. Below this it stops reading as static. */
const GRAIN_SPARSITY = 0.55;

/** Sparks alive at once per ship. Recycled, never reallocated. */
const SPARK_POOL = 6;

/**
 * The three intensity levels.
 *
 * Kept as a table here rather than as settings: this is a per-ship staging
 * choice the GM makes on the HUD, not a world preference, and three named
 * points along one axis are easier to pick from than seven sliders.
 */
export const SHIELD_IDLE_LEVELS = {
  calm: {
    label:      "Calm",
    rimAlpha:   0.13,
    rimPulse:   0.05,
    grainAlpha: 0.14,
    grainFps:   8,
    driftPx:    3,
    driftRate:  0.35,
    sparkMinMs: 900,
    sparkMaxMs: 2400,
    sparkScale: 0.13,
    sparkLifeMs: 340,
    glow:       0.45,
  },
  nebula: {
    label:      "Nebula",
    rimAlpha:   0.22,
    rimPulse:   0.10,
    grainAlpha: 0.28,
    grainFps:   12,
    driftPx:    6,
    driftRate:  0.8,
    sparkMinMs: 260,
    sparkMaxMs: 950,
    sparkScale: 0.18,
    sparkLifeMs: 290,
    glow:       0.9,
  },
  ionstorm: {
    label:      "Ion Storm",
    rimAlpha:   0.34,
    rimPulse:   0.17,
    grainAlpha: 0.44,
    grainFps:   18,
    driftPx:    10,
    driftRate:  1.7,
    sparkMinMs: 90,
    sparkMaxMs: 360,
    sparkScale: 0.25,
    sparkLifeMs: 230,
    glow:       1.6,
  },
};

/** Cycle order for the HUD's level button. */
export const SHIELD_IDLE_ORDER = ["calm", "nebula", "ionstorm"];

/** What "Shields: Raise" raises to. */
export const SHIELD_IDLE_DEFAULT = "nebula";

/** tokenId → handle, for every standing envelope on this client. */
const _live = new Map();

// ── PIXI compatibility shims ─────────────────────────────────────────────────
// Foundry v14 ships PIXI v8: blend modes went number → string, and a texture's
// sampler settings moved from `baseTexture` to `source`.

function _addBlend() {
  if (typeof PIXI?.BLEND_MODES?.ADD === "number") return PIXI.BLEND_MODES.ADD;
  return "add";
}

/**
 * Turn off bilinear smoothing so the speckles stay square. A 192px frame
 * stretched over a capital ship is heavily magnified, and smoothed static reads
 * as a smudge rather than as interference.
 */
function _pixelate(texture) {
  try {
    if (texture?.source) texture.source.scaleMode = "nearest";
    else if (texture?.baseTexture) {
      texture.baseTexture.scaleMode = PIXI.SCALE_MODES?.NEAREST ?? 0;
    }
  } catch { /* smoothing is cosmetic */ }
  return texture;
}

/**
 * Make a display object and its whole subtree invisible to hit testing.
 *
 * `eventMode` is the PIXI v8 API; `interactive` / `interactiveChildren` are the
 * v7 spelling and are harmless to set on v8, so both go on.
 */
function _passThrough(displayObject) {
  try {
    displayObject.eventMode = "none";
    displayObject.interactive = false;
    displayObject.interactiveChildren = false;
  } catch { /* older pixi — the defaults are already non-interactive */ }
  return displayObject;
}

function _effectLayer() {
  const layer = canvas?.tokens ?? canvas?.interface ?? canvas?.primary ?? canvas?.stage ?? null;
  if (layer && !layer.sortableChildren) layer.sortableChildren = true;
  return layer;
}

// ── Small numeric helpers ────────────────────────────────────────────────────

function _number(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function _clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function _rand(min, max) {
  return min + Math.random() * (max - min);
}

/** "#9fd8ff" → 0x9fd8ff. Also passes through a number that is already one. */
function _hexToNum(hex, fallback = 0x9fd8ff) {
  if (typeof hex === "number" && Number.isFinite(hex)) return hex;
  const match = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? "").trim());
  return match ? Number.parseInt(match[1], 16) : fallback;
}

// ── Shared textures ──────────────────────────────────────────────────────────
//
// Baked white and tinted per ship, so one set serves every envelope on the
// canvas. Dropped on canvas teardown rather than per effect — an effect that
// destroyed these on stop would pull them out from under every other ship.

let _grainTextures = null;
let _sparkTexture  = null;

/**
 * The static frames.
 *
 * Each pixel gets a random alpha, thinned toward the middle so the grain
 * gathers at the boundary and stays sparse over the hull — a uniform noise
 * field just makes the ship look dirty rather than shielded. The ramp is built
 * in the square texture's own space and stretched with the sprite, so it lands
 * correctly on an ellipse of any aspect.
 */
function _grainFrames() {
  if (_grainTextures) return _grainTextures;

  const half   = GRAIN_SIZE / 2;
  // Where the envelope mask cuts the oversized sprite, in texture space.
  const maskAt = 1 / GRAIN_OVERSCAN;
  const frames = [];

  for (let f = 0; f < GRAIN_FRAMES; f++) {
    const oc  = document.createElement("canvas");
    oc.width  = GRAIN_SIZE;
    oc.height = GRAIN_SIZE;
    const ctx = oc.getContext("2d");
    const img = ctx.createImageData(GRAIN_SIZE, GRAIN_SIZE);
    const data = img.data;

    for (let y = 0; y < GRAIN_SIZE; y++) {
      for (let x = 0; x < GRAIN_SIZE; x++) {
        const nx = (x - half) / half;
        const ny = (y - half) / half;
        const r  = Math.hypot(nx, ny);

        // 0 at the centre, 1 where the mask will cut, with a floor so the hull
        // is not completely bare.
        const ramp = 0.18 + 0.82 * Math.pow(_clamp(r / maskAt, 0, 1), 2);

        const n = Math.random();
        const v = n < GRAIN_SPARSITY ? 0 : (n - GRAIN_SPARSITY) / (1 - GRAIN_SPARSITY);

        const i = (y * GRAIN_SIZE + x) * 4;
        data[i]     = 255;
        data[i + 1] = 255;
        data[i + 2] = 255;
        data[i + 3] = Math.round(255 * v * ramp);
      }
    }

    ctx.putImageData(img, 0, 0);
    frames.push(_pixelate(PIXI.Texture.from(oc)));
  }

  _grainTextures = frames;
  return _grainTextures;
}

/** One soft white dot, tinted per ship and reused by every spark. */
function _sparkGradient() {
  if (_sparkTexture) return _sparkTexture;

  const oc  = document.createElement("canvas");
  oc.width  = 64;
  oc.height = 64;
  const ctx = oc.getContext("2d");
  const rg  = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  rg.addColorStop(0,    "rgba(255,255,255,0.95)");
  rg.addColorStop(0.3,  "rgba(255,255,255,0.55)");
  rg.addColorStop(0.65, "rgba(255,255,255,0.14)");
  rg.addColorStop(1,    "rgba(255,255,255,0)");
  ctx.fillStyle = rg;
  ctx.fillRect(0, 0, 64, 64);

  _sparkTexture = PIXI.Texture.from(oc);
  return _sparkTexture;
}

/** Drop the shared textures — canvas teardown only. They rebuild lazily. */
function _releaseSharedTextures() {
  for (const texture of _grainTextures ?? []) {
    try { texture.destroy(true); } catch { /* already gone */ }
  }
  try { _sparkTexture?.destroy(true); } catch { /* already gone */ }
  _grainTextures = null;
  _sparkTexture  = null;
}

// ── Flag state ───────────────────────────────────────────────────────────────

/** The token's shields-up state, or null when they are down. */
export function getShieldIdleState(token) {
  const raw = token?.document?.getFlag?.(MODULE, FLAG_KEY) ?? null;
  if (!raw) return null;
  const level = SHIELD_IDLE_ORDER.includes(raw.level) ? raw.level : SHIELD_IDLE_DEFAULT;
  return { level };
}

/** The level a cycle click moves to. */
export function nextShieldLevel(level) {
  const index = SHIELD_IDLE_ORDER.indexOf(level);
  return SHIELD_IDLE_ORDER[(index + 1) % SHIELD_IDLE_ORDER.length];
}

export async function raiseShields(token, level = SHIELD_IDLE_DEFAULT) {
  const wanted = SHIELD_IDLE_ORDER.includes(level) ? level : SHIELD_IDLE_DEFAULT;
  try {
    await token?.document?.setFlag(MODULE, FLAG_KEY, { level: wanted });
  } catch (err) {
    console.error("STA2e Toolkit | Raising shields failed:", err);
    ui.notifications.error("Could not raise shields — see console.");
  }
}

export async function lowerShields(token) {
  try {
    await token?.document?.unsetFlag(MODULE, FLAG_KEY);
  } catch (err) {
    console.error("STA2e Toolkit | Lowering shields failed:", err);
    ui.notifications.error("Could not lower shields — see console.");
  }
}

export async function cycleShieldLevel(token) {
  const state = getShieldIdleState(token);
  if (!state) return raiseShields(token, SHIELD_IDLE_DEFAULT);
  return raiseShields(token, nextShieldLevel(state.level));
}

function _featureEnabled() {
  try { return game.settings.get(MODULE, "shieldIdleVFX") !== false; }
  catch { return true; }
}

// ── The effect ───────────────────────────────────────────────────────────────

/**
 * Build and start one standing envelope.
 *
 * @returns {{token: Token, level: string, container: PIXI.Container, stop: Function}|null}
 */
function _playIdle(token, level) {
  const cfg   = SHIELD_IDLE_LEVELS[level] ?? SHIELD_IDLE_LEVELS[SHIELD_IDLE_DEFAULT];
  const layer = _effectLayer();
  if (!layer) return null;

  const hex   = resolveShieldImpactColorHex(token) ?? "#9fd8ff";
  const color = _hexToNum(hex);
  const geo   = getShieldEnvelopeGeometry(token, resolveShieldStandoffFactor(token));

  const container = new PIXI.Container();
  const tokenZ = typeof token.zIndex === "number" ? token.zIndex : 0;
  container.zIndex = Math.max(VFX_Z_BASE, tokenZ + 9_000);
  // Nothing here may ever be a hit target. The envelope sits on the token layer
  // above the ship it wraps, so hit testing — which walks children back to
  // front — reaches it first and would swallow every click on the hull,
  // including the right-click that opens the Token HUD. The weapon VFX get away
  // without this only because they are gone inside a second; a standing effect
  // does not. Same reason ZoneOverlay does it (zone-layer.js).
  _passThrough(container);
  seatShieldEnvelope(container, token, geo);

  // The boundary. Drawn once; only its alpha moves after this.
  const rim = new PIXI.Graphics();
  rim.blendMode = _addBlend();
  drawShieldRim(rim, geo, color, RIM_WIDTH);
  rim.alpha = cfg.rimAlpha;
  container.addChild(rim);

  // Everything else is clipped to the envelope, so it reads as interference ON
  // the bubble rather than a haze floating over the ship.
  const envelopeMask = new PIXI.Graphics();
  drawShieldEnvelopeFill(envelopeMask, geo);
  container.addChild(envelopeMask);

  const surface = new PIXI.Container();
  // An unmasked surface spills a little past the envelope, which is a far better
  // failure than no shield at all — so this never throws the effect away.
  try { surface.mask = envelopeMask; }
  catch { envelopeMask.visible = false; }
  container.addChild(surface);

  const frames = _grainFrames();
  const grain  = new PIXI.Sprite(frames[0]);
  grain.anchor.set(0.5);
  grain.blendMode = _addBlend();
  grain.tint  = color;
  grain.alpha = cfg.grainAlpha;
  grain.width  = geo.rx * 2 * GRAIN_OVERSCAN;
  grain.height = geo.ry * 2 * GRAIN_OVERSCAN;
  surface.addChild(grain);

  // The grain sprite is scaled unevenly onto the ellipse, so it is never
  // rotated — a turning non-uniform sprite would swing its own radial ramp
  // around and pump the bubble's shape. The crawl comes from drift alone.
  const driftLimit = Math.min(geo.rx, geo.ry) * (GRAIN_OVERSCAN - 1) * 0.85;
  const driftPx    = Math.min(cfg.driftPx, driftLimit);

  const sparkTexture = _sparkGradient();
  const sparks = [];
  for (let i = 0; i < SPARK_POOL; i++) {
    const sprite = new PIXI.Sprite(sparkTexture);
    sprite.anchor.set(0.5);
    sprite.blendMode = _addBlend();
    sprite.tint    = color;
    sprite.visible = false;
    sprite.alpha   = 0;
    surface.addChild(sprite);
    // Staggered so the pool does not fire as one volley on the first frame.
    sparks.push({ sprite, wait: Math.random() * cfg.sparkMaxMs, elapsed: 0, life: 0, base: 0 });
  }

  // One glow pass for the whole container beats one per child.
  try {
    const GlowFilter = PIXI.filters?.GlowFilter ?? globalThis.PIXI?.filters?.GlowFilter;
    if (GlowFilter) {
      container.filters = [new GlowFilter({
        distance:      Math.round(6 + 10 * cfg.glow),
        outerStrength: cfg.glow,
        innerStrength: 0,
        color,
        quality:       0.3,
      })];
    }
  } catch { /* glow is a bonus, never a requirement */ }

  layer.addChild(container);

  const glow      = container.filters?.[0] ?? null;
  const grainStep = 1000 / Math.max(1, cfg.grainFps);
  const sparkBase = Math.min(geo.rx, geo.ry) * cfg.sparkScale * 2;

  let stopped     = false;
  let prevNow     = performance.now();
  let grainAcc    = 0;
  let frameIndex  = 0;
  let driftAngle  = Math.random() * Math.PI * 2;
  // Two incommensurate rates so the breath never settles into an obvious loop.
  let phaseA      = Math.random() * Math.PI * 2;
  let phaseB      = Math.random() * Math.PI * 2;

  const tick = () => {
    if (stopped) return;

    // The placeable is replaced outright when a token is re-drawn, so a stale
    // capture has to retire and let the reconcile start a fresh one.
    const liveToken = canvas?.tokens?.get(token.id) ?? null;
    if (!liveToken || token.destroyed) {
      handle.stop();
      if (liveToken) window.setTimeout(refreshShieldIdleVfx, 0);
      return;
    }
    if (liveToken !== token) {
      handle.stop();
      window.setTimeout(refreshShieldIdleVfx, 0);
      return;
    }

    const now = performance.now();
    // Clamp so a backgrounded tab does not fast-forward the grain.
    const dt = Math.min(now - prevNow, 50);
    prevNow = now;

    // Re-seat first: a ship still gliding from an earlier move must not leave
    // its bubble behind, and everything below is in the container's frame.
    seatShieldEnvelope(container, token, geo);

    // ── Grain ────────────────────────────────────────────────────────────────
    grainAcc += dt;
    if (grainAcc >= grainStep) {
      grainAcc %= grainStep;
      // Step by 2 rather than 1 so a five-frame loop does not read as a cycle.
      frameIndex = (frameIndex + 2) % frames.length;
      grain.texture = frames[frameIndex];
    }

    driftAngle += (dt / 1000) * cfg.driftRate;
    grain.x = Math.cos(driftAngle) * driftPx;
    grain.y = Math.sin(driftAngle * 1.37) * driftPx;

    // ── Rim and glow breathe ─────────────────────────────────────────────────
    phaseA += (dt / 1000) * 1.1;
    phaseB += (dt / 1000) * 0.43;
    const breath = (Math.sin(phaseA) * 0.65 + Math.sin(phaseB) * 0.35);
    rim.alpha = Math.max(0, cfg.rimAlpha + cfg.rimPulse * breath);
    if (glow) glow.outerStrength = Math.max(0, cfg.glow * (1 + 0.25 * breath));

    // ── Sparks ───────────────────────────────────────────────────────────────
    for (const spark of sparks) {
      if (spark.life > 0) {
        spark.elapsed += dt;
        const p = spark.elapsed / spark.life;
        if (p >= 1) {
          spark.sprite.visible = false;
          spark.life = 0;
          spark.wait = _rand(cfg.sparkMinMs, cfg.sparkMaxMs);
          continue;
        }
        // Snap on, ease off — a symmetric fade reads as a pulsing lamp rather
        // than something striking the shield.
        spark.sprite.alpha = p < 0.22
          ? p / 0.22
          : Math.pow(1 - (p - 0.22) / 0.78, 1.6);
        const grow = spark.base * (0.6 + 0.85 * p);
        spark.sprite.width  = grow;
        spark.sprite.height = grow;
        continue;
      }

      spark.wait -= dt;
      if (spark.wait > 0) continue;

      // Arm at a random bearing on the boundary.
      const theta = Math.random() * Math.PI * 2;
      spark.sprite.x = Math.cos(theta) * geo.rx;
      spark.sprite.y = Math.sin(theta) * geo.ry;
      spark.base = sparkBase * _rand(0.7, 1.3);
      spark.sprite.width   = spark.base * 0.6;
      spark.sprite.height  = spark.base * 0.6;
      spark.sprite.alpha   = 0;
      spark.sprite.visible = true;
      spark.life    = cfg.sparkLifeMs * _rand(0.75, 1.25);
      spark.elapsed = 0;
    }
  };

  const handle = {
    token,
    level,
    container,
    stop: () => {
      if (stopped) return;
      stopped = true;
      try { canvas.app.ticker.remove(tick); } catch { /* already gone */ }
      // destroy() does not take the filters with it, and a GlowFilter holds a
      // shader program.
      try { for (const f of container.filters ?? []) f?.destroy?.(); } catch { /* older pixi-filters */ }
      try { container.filters = null; } catch { /* already gone */ }
      try { container.parent?.removeChild(container); } catch { /* already gone */ }
      // The grain and spark textures are shared across every ship, so this must
      // not take them down with it.
      try { container.destroy({ children: true, texture: false }); } catch { /* already gone */ }
      if (_live.get(token.id) === handle) _live.delete(token.id);
    },
  };

  // Paint frame zero now rather than waiting for the ticker's next pass, so
  // raising shields does not blink an empty container for a frame. That pass
  // can also retire the effect outright if the token turned out to be stale, in
  // which case the caller must not file the handle.
  tick();
  if (stopped) return null;
  canvas.app.ticker.add(tick);

  return handle;
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

export function stopAllShieldIdleVfx() {
  for (const handle of [..._live.values()]) {
    try { handle.stop(); } catch { /* already torn down */ }
  }
  _live.clear();
}

/**
 * Bring the canvas in line with the flags.
 *
 * Reconciles rather than restarting everything: an envelope whose token and
 * level are unchanged is left running, so raising shields on one ship does not
 * make every other ship's grain jump back to frame zero.
 */
export function refreshShieldIdleVfx() {
  if (typeof PIXI === "undefined" || !canvas?.ready || !_featureEnabled()) {
    stopAllShieldIdleVfx();
    return;
  }

  const wanted = new Map();
  for (const token of canvas.tokens?.placeables ?? []) {
    const state = getShieldIdleState(token);
    if (state) wanted.set(token.id, { token, level: state.level });
  }

  for (const [id, handle] of [..._live]) {
    const want = wanted.get(id);
    if (!want || want.level !== handle.level || want.token !== handle.token) {
      try { handle.stop(); } catch { /* already torn down */ }
      _live.delete(id);
    }
  }

  let capped = false;
  for (const [id, want] of wanted) {
    if (_live.has(id)) continue;
    if (_live.size >= MAX_LIVE) { capped = true; break; }
    const handle = _playIdle(want.token, want.level);
    if (handle) _live.set(id, handle);
  }

  if (capped) {
    console.warn(`STA2e Toolkit | Standing shield envelopes capped at ${MAX_LIVE}; the rest are not drawn.`);
  }
}

/**
 * Hard restart. Colour and standoff are read once when an envelope is built, so
 * a change to either has to tear the running ones down rather than reconcile.
 */
export function rebuildShieldIdleVfx() {
  stopAllShieldIdleVfx();
  refreshShieldIdleVfx();
}

/**
 * Did this token update touch the shields flag?
 *
 * Both spellings have to be tested: `setFlag` puts the key in the diff, but
 * `unsetFlag` — what lowering shields does — sends Foundry's `-=key` deletion
 * form instead, and checking only the plain key would leave the envelope
 * running on every client after it had been dropped. Same test as the scene
 * flag watcher in token-elevation-display.js.
 */
function _shieldFlagChanged(changes) {
  const get = foundry.utils.getProperty;
  return get(changes, `flags.${MODULE}.${FLAG_KEY}`) !== undefined
      || get(changes, `flags.${MODULE}.-=${FLAG_KEY}`) !== undefined;
}

let _hooksRegistered = false;

/** Call once from main.js init, beside registerShieldBubbleVfxHooks(). */
export function registerShieldIdleVfxHooks() {
  if (_hooksRegistered) return;
  _hooksRegistered = true;

  Hooks.on("canvasReady", () => refreshShieldIdleVfx());
  Hooks.on("canvasTearDown", () => {
    stopAllShieldIdleVfx();
    _releaseSharedTextures();
  });

  Hooks.on("updateToken", (_tokenDoc, changes) => {
    if (_shieldFlagChanged(changes)) {
      refreshShieldIdleVfx();
      return;
    }
    // Art metrics feed the envelope's radii, so a resize or a new image has to
    // rebuild rather than reconcile — the geometry was captured at build time.
    if (changes.width !== undefined || changes.height !== undefined || changes.texture !== undefined) {
      if (_live.has(_tokenDoc?.id)) rebuildShieldIdleVfx();
    }
  });

  Hooks.on("deleteToken", () => refreshShieldIdleVfx());

  // Per-ship shield colour and standoff overrides live on the ship VFX anchors
  // flag, so a live envelope has to be rebuilt when the GM edits them.
  Hooks.on("updateActor", (_actor, changes) => {
    if (changes.flags?.[MODULE]?.shipVfxAnchors !== undefined) rebuildShieldIdleVfx();
  });

  Hooks.on("updateSetting", (setting) => {
    const key = String(setting?.key ?? "");
    if (key.endsWith("shieldIdleVFX") || key.endsWith("shieldBubbleStandoff")) {
      rebuildShieldIdleVfx();
    }
  });
}

/**
 * Console helper: raise shields on the controlled token at the given level, or
 * lower them when passed nothing.
 */
export function testShieldIdle(level = SHIELD_IDLE_DEFAULT) {
  const token = canvas?.tokens?.controlled?.[0] ?? null;
  if (!token) {
    ui.notifications.warn("STA2e Toolkit: select a token first.");
    return;
  }
  return level ? raiseShields(token, level) : lowerShields(token);
}
