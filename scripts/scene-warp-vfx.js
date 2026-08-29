/**
 * sta2e-toolkit | scene-warp-vfx.js
 * Scene Warp — the top-down streak renderer.
 *
 * Parallel star streaks running across the whole scene, so a tactical map can be
 * fought over while the ships are at warp. State lives in
 * [scene-warp.js](scene-warp.js); this file only draws it, and like the warp
 * viewscreen it carries no socket action and derives its own ramp position from
 * the scene's `phaseAt` stamp.
 *
 * ## The two nested containers
 *
 * This is the whole trick, and everything else follows from it:
 *
 *   outer — canvas space, unrotated, masked to `canvas.dimensions.sceneRect`
 *     inner — rotated to the course; stars live in ITS local space
 *       band — one depth layer of star sprites
 *
 * Stars advance along the inner container's local **+Y only** and wrap by modulo
 * on that one axis. The rotation carries them off in the right canvas direction.
 * That buys three things at once:
 *
 *  - **Wrapping is correct at any angle.** Advancing along a canvas-space vector
 *    instead means wrapping a diagonal band through an axis-aligned rect, which
 *    leaves visible gaps along two edges.
 *  - **No per-star `atan2`.** Every streak points the same way in local space, so
 *    `sprite.rotation` is a constant.
 *  - **A course change is one tween of `inner.rotation`,** which also swings the
 *    star pattern around the scene centre — that sweep is what reads as the ship
 *    banking onto a new heading.
 *
 * And the rotation is simply the compass course in radians. A container rotated
 * by θ maps local (0,1) to canvas (−sin θ, cos θ); setting that equal to
 * `starFlowVector(course)` and reducing gives θ = atan2(sin course, cos course),
 * i.e. θ = course. Sanity check: course 0 (north) → θ 0 → stars run down the
 * screen while the ships point up it.
 *
 * ## What it deliberately does not do
 *
 * **No backdrop fill.** Unlike the viewscreen this overlays your existing map
 * art rather than replacing it, so there is no `_syncBackdrop` equivalent — the
 * field is transparent between the stars and simply hides itself when idle.
 */

import {
  VFX_Z_BASE,
  PALETTE_SIZE,
  addBlend,
  effectLayer,
  parseHexColor,
  buildPalette,
  buildStreakTexture,
} from "./starfield-common.js";
import {
  getSceneWarp,
  hasSceneWarp,
  getSceneWarpTiming,
  getSceneWarpQuality,
  scenePhaseFrom,
} from "./scene-warp.js";

// ── Tuning ───────────────────────────────────────────────────────────────────

// Time in ms for a star to cross the field at a dead stop and at either end of
// the warp range. The warp end is interpolated geometrically across 1 → 9.9,
// the same shape the viewscreen uses.
const DRIFT_TRAVEL_MS     = 26000;
const WARP_TRAVEL_MIN_MS  = 4000;   // warp 1
const WARP_TRAVEL_MAX_MS  = 420;    // warp 9.9

// Streaks stretch further than the physical frame delta would give — that
// exaggeration is what reads as "warp" rather than merely "fast". Lower than the
// viewscreen's 8: a top-down field is seen broadside, where the same multiplier
// produces noticeably longer lines than it does head-on.
const WARP_STRETCH = 6.5;

// Ceiling on one streak, as a fraction of the field span. Loose enough that the
// longest cross a good part of the map, tight enough that none of them span it
// end to end — a length allowed to do that reads as rain, not stars.
const MAX_LEN_FRAC = 0.3;

// Hairline ends of the thickness range at a Thickness setting of 100%. Depth
// shows as brightness and length, barely as width — same rule as the viewscreen.
const BASE_THICK = 1.05;

/**
 * The depth bands, far to near, and the sparse one that draws OVER the tokens.
 *
 * `share` is the slice of the star count each takes; the foreground band is
 * costed separately on top. Its alpha is deliberately low and its share small —
 * it crosses your ships, and anything heavier reads as debris on the lens.
 */
const BANDS = [
  { key: "far",  share: 0.44, speed: 0.42, thick: 0.72, alpha: 0.50, above: false },
  { key: "mid",  share: 0.36, speed: 0.74, thick: 1.00, alpha: 0.78, above: false },
  { key: "near", share: 0.20, speed: 1.00, thick: 1.34, alpha: 1.00, above: false },
  { key: "fore", share: 0.07, speed: 1.85, thick: 1.70, alpha: 0.42, above: true  },
];

/** With parallax off the whole pool is one band at face value. */
const FLAT_BAND = { key: "flat", share: 1, speed: 1, thick: 1, alpha: 1, above: false };

// How fast a course change swings the field round, in radians per ms.
const COURSE_SLEW_RAD_MS = Math.PI / 1400;   // ~1.4s for a 180° reversal

// Share of the field still drawn while 3D dice are on screen. See the
// dice-coordination block near the bottom of this file.
const DICE_THIN_FRAC = 0.25;

// Relative tolerance below which a streak-length change is not worth writing to
// every sprite in the band. See the note at its use in _tick.
const SCALE_DEADBAND = 0.03;

/** The single live instance — one scene is viewed at a time. */
let _inst = null;

// ── Small helpers ────────────────────────────────────────────────────────────

function _inert(container) {
  // v8 uses eventMode; v7 uses the interactive flags. Set both so the field can
  // never swallow a click meant for a token underneath it.
  try { container.eventMode = "none"; } catch { /* v7 */ }
  container.interactive = false;
  container.interactiveChildren = false;
  return container;
}

/** Shortest signed angular difference from `a` to `b`, in radians. */
function _angleDelta(a, b) {
  return Math.atan2(Math.sin(b - a), Math.cos(b - a));
}

/** Field travel speed in local units per ms. */
function _travelMs(warpFactor, ramp) {
  // Geometric across the warp range so each whole factor is a real step up.
  const t    = Math.min(1, Math.max(0, (warpFactor - 1) / 8.9));
  const warp = WARP_TRAVEL_MIN_MS * Math.pow(WARP_TRAVEL_MAX_MS / WARP_TRAVEL_MIN_MS, t);
  // Interpolate the *rate*, not the duration: blending durations spends most of
  // the ramp still crawling and then lurches at the end.
  const rDrift = 1 / DRIFT_TRAVEL_MS;
  const rWarp  = 1 / warp;
  return 1 / (rDrift + (rWarp - rDrift) * ramp);
}

function _easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

/**
 * 0 at sublight, 1 at full warp, eased through the enter and exit ramps.
 *
 * Takes the cfg and timing the caller already read rather than fetching its own.
 * It used to take a `scene` and re-derive both, then call `effectiveScenePhase`
 * which derived them a third time — three flag reads and nine settings lookups
 * per frame, all of it above the early-return that skips a dark field.
 */
function _rampFactor(cfg, timing) {
  const phase = scenePhaseFrom(cfg, timing);
  if (phase === "cruise") return 1;
  if (phase === "idle")   return 0;
  const elapsed = Date.now() - cfg.phaseAt;
  if (phase === "entering") {
    return _easeInOut(Math.min(1, Math.max(0, elapsed / timing.enterMs)));
  }
  return 1 - _easeInOut(Math.min(1, Math.max(0, elapsed / timing.exitMs)));
}

/** The scene rect, and the square field that covers it at any rotation. */
function _resolveFrame() {
  const rect = canvas?.dimensions?.sceneRect;
  if (!rect || !(rect.width > 0) || !(rect.height > 0)) return null;
  const centre = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  // The field is a square of the scene's diagonal, so a rotated inner container
  // still covers every corner. Padded so a streak's tail is never cut at wrap.
  const span = Math.hypot(rect.width, rect.height) * 1.08;
  return { rect, centre, span };
}

// ── Build ────────────────────────────────────────────────────────────────────

/** One masked outer + rotated inner pair at a given depth relative to tokens. */
function _makeLayer(layer, frame, zIndex) {
  const outer = _inert(new PIXI.Container());
  outer.zIndex = zIndex;

  const mask = new PIXI.Graphics();
  const { x, y, width, height } = frame.rect;
  if (typeof mask.beginFill === "function") {
    mask.beginFill(0xffffff, 1);
    mask.drawRect(x, y, width, height);
    mask.endFill();
  } else {
    mask.rect(x, y, width, height);
    mask.fill({ color: 0xffffff, alpha: 1 });
  }
  outer.addChild(mask);
  outer.mask = mask;

  const inner = _inert(new PIXI.Container());
  inner.position.set(frame.centre.x, frame.centre.y);
  outer.addChild(inner);

  layer.addChild(outer);
  return { outer, inner, mask };
}

/**
 * A star's starting state, and the only place its sprite's tint and alpha are
 * written.
 *
 * Both are constant for the life of a star: brightness is its depth within the
 * band, and the band's own alpha only moves when the pools rebuild. Writing
 * either per frame is pure waste — and the tint setter in particular converts a
 * colour on every write, which across a thousand stars is not free. `y` is
 * seeded by the caller so a fresh pool spreads across the field instead of
 * marching in from one edge.
 */
function _seedStar(inst, star, sp, bandAlpha, y) {
  const half = inst.frame.span / 2;
  star.x = (Math.random() * 2 - 1) * half;
  star.y = y;
  if (sp) {
    sp.tint  = inst.palette[(Math.random() * PALETTE_SIZE) | 0];
    sp.alpha = bandAlpha * (0.45 + Math.random() * 0.55);
  }
}

/**
 * Which bands this client draws.
 *
 * The scene says what it wants; the client's Quality setting can only ever take
 * away. Low drops to two depth bands and no foreground, which is most of what
 * makes it cheap — the over-tokens band is a second masked container and so
 * costs its own draw pass on top of its sprites.
 */
function _bandsFor(cfg, quality) {
  const foreground = cfg.foreground && quality.foreground;
  if (!cfg.parallax) {
    return foreground ? [FLAT_BAND, BANDS[3]] : [FLAT_BAND];
  }
  // Depth bands, nearest first, so trimming drops the faintest and slowest.
  const depth = BANDS.filter(b => !b.above);
  const kept  = depth.length <= quality.bands
    ? depth
    : [...depth].reverse().slice(0, quality.bands).reverse();
  return foreground ? [...kept, BANDS[3]] : kept;
}

/**
 * (Re)build the star pools. Called on attach and whenever the pool signature
 * changes — density, palette or band layout. Slider drags never come through
 * here; those are read live in the tick.
 */
function _buildPools(inst, cfg) {
  const quality = getSceneWarpQuality();
  const bands   = _bandsFor(cfg, quality);

  // Drop the previous pools. Sprites are destroyed but the shared texture is
  // not — it is owned by the instance and released in _destroy().
  for (const b of inst.bands) {
    for (const sp of b.sprites) sp.destroy();
    b.container.destroy({ children: true });
  }
  inst.bands = [];

  const half = inst.frame.span / 2;

  // Depth-band shares are normalised over whatever bands survived the quality
  // trim, so Star Count keeps meaning the same number of stars at every quality
  // — otherwise dropping a band would cut the count a second time on top of the
  // density multiplier. The foreground band is costed on top, as it always was.
  const depthShare = bands
    .filter(b => !b.above)
    .reduce((sum, b) => sum + b.share, 0) || 1;
  const budget = cfg.density * quality.densityMul;

  for (const def of bands) {
    const host      = def.above ? inst.above : inst.below;
    const container = _inert(new PIXI.Container());
    host.inner.addChild(container);

    const share   = def.above ? def.share : def.share / depthShare;
    const count   = Math.max(1, Math.round(budget * share));
    const stars   = [];
    const sprites = [];
    for (let i = 0; i < count; i++) {
      const star = { x: 0, y: 0 };
      const sp   = new PIXI.Sprite(inst.texture);
      // Head pins to the position, tail trails back along travel; and since
      // every streak runs along local +Y, the rotation is a constant.
      sp.anchor.set(1, 0.5);
      sp.rotation  = Math.PI / 2;
      sp.blendMode = addBlend();
      _seedStar(inst, star, sp, def.alpha, (Math.random() * 2 - 1) * half);
      container.addChild(sp);

      stars.push(star);
      sprites.push(sp);
    }
    inst.bands.push({
      def, container, stars, sprites,
      // How many of this band's stars are currently animated and drawn. Dice
      // thinning moves this rather than rebuilding the pool.
      active: stars.length,
      // Last scale written to every sprite in the band, so an unchanged frame
      // can skip ~750 transform writes. NaN forces the first frame to write.
      lastSx: NaN, lastSy: NaN,
    });
  }
  _applyThinning(inst);
}

/** What a pool rebuild depends on. Anything else is live in the tick. */
function _poolSignature(cfg) {
  const q = getSceneWarpQuality();
  return [
    cfg.density, cfg.starTint, cfg.accentTint,
    Math.round(cfg.variety * 100), cfg.parallax, cfg.foreground,
    // Quality is a client setting, so this is what makes one user's change
    // rebuild their own pools without touching anybody else's.
    q.densityMul, q.bands, q.foreground,
  ].join("|");
}

function _makePalette(cfg) {
  return buildPalette(
    parseHexColor(cfg.starTint, 0xcfe6ff),
    parseHexColor(cfg.accentTint, 0x7dd3fc),
    cfg.variety,
  );
}

// ── Coordinating with Dice So Nice ───────────────────────────────────────────
//
// Dice So Nice puts a second WebGL context on screen and renders it every frame
// alongside Foundry's. Both fields fit comfortably on their own; together they
// halve the frame rate for the length of a roll. So while dice are up, the field
// thins right down and gives the budget back.
//
// It keeps *moving* while thinned. Freezing it is cheaper still, but a field of
// stopped streaks reads as a hitch in the client rather than as warp.
//
// Two details this depends on:
//   - **A count, not a flag.** Overlapping rolls are ordinary — a task roll and
//     a damage roll can be in the air together — so a boolean would be cleared
//     by the first one to finish while dice were still on screen.
//   - **Thinning never rebuilds the pool.** It moves each band's `active` count
//     and hides the remainder. A rebuild would reseed every star mid-flight and
//     visibly jump the whole field, twice per roll.

let _diceRolling = 0;
let _diceWatchdog = null;
let _diceHookIds = [];

// A roll whose completion hook never arrives must not strand the field thinned.
const DICE_WATCHDOG_MS = 20_000;

function _applyThinning(inst = _inst) {
  if (!inst) return;
  const thin = _diceRolling > 0;
  for (const band of inst.bands) {
    const want = thin
      ? Math.max(1, Math.round(band.stars.length * DICE_THIN_FRAC))
      : band.stars.length;
    if (want === band.active) continue;
    // Only the sprites crossing the boundary change visibility, so a repeated
    // call costs nothing.
    const from = Math.min(want, band.active);
    const to   = Math.max(want, band.active);
    const vis  = want > band.active;
    for (let i = from; i < to; i++) band.sprites[i].visible = vis;
    band.active = want;
    // The over-tokens band is a whole extra masked container and draw pass;
    // drop it outright rather than merely thinning it.
    if (band.def.above) band.container.visible = !thin;
  }
}

function _diceStart() {
  _diceRolling++;
  _applyThinning();
  if (_diceWatchdog) clearTimeout(_diceWatchdog);
  _diceWatchdog = setTimeout(() => {
    _diceRolling = 0;
    _diceWatchdog = null;
    _applyThinning();
  }, DICE_WATCHDOG_MS);
}

function _diceEnd() {
  _diceRolling = Math.max(0, _diceRolling - 1);
  _applyThinning();
  if (_diceRolling === 0 && _diceWatchdog) {
    clearTimeout(_diceWatchdog);
    _diceWatchdog = null;
  }
}

/**
 * Wire the Dice So Nice hooks. Call once from main.js init.
 *
 * Registering them costs nothing when DsN is absent — the hooks simply never
 * fire — so there is no module-presence check to keep in step with anything.
 */
export function registerSceneWarpDiceCoordination() {
  if (_diceHookIds.length) return;
  _diceHookIds = [
    ["diceSoNiceRollStart",    Hooks.on("diceSoNiceRollStart",    _diceStart)],
    ["diceSoNiceRollComplete", Hooks.on("diceSoNiceRollComplete", _diceEnd)],
  ];
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

/** Attach the field to the scene being viewed. Safe to call repeatedly. */
export function attachSceneWarp() {
  detachSceneWarp();

  if (!canvas?.ready || typeof PIXI === "undefined") return;
  const scene = canvas.scene;
  if (!scene || !hasSceneWarp(scene)) return;

  const layer = effectLayer();
  if (!layer) return;
  const frame = _resolveFrame();
  if (!frame) return;

  const cfg = getSceneWarp(scene);

  const inst = {
    sceneId: scene.id,
    frame,
    texture: buildStreakTexture(),
    palette: _makePalette(cfg),
    bands: [],
    signature: _poolSignature(cfg),
    // Start already on course rather than slewing from north on attach.
    rotation: (cfg.course * Math.PI) / 180,
    last: performance.now(),
    // EMA of frame time, driving streak length only. 0 means "not seeded yet".
    dtSmooth: 0,
    dark: false,
    ticker: null,
    asleep: false,
  };

  // Below every token — and below the engine trails, which sit at
  // `-VFX_Z_BASE + tokenZ`, so this needs a little more headroom than that.
  inst.below = _makeLayer(layer, frame, -VFX_Z_BASE - 1000);
  inst.above = _makeLayer(layer, frame, VFX_Z_BASE + 20);

  _inst = inst;
  _buildPools(inst, cfg);
  _applyRotation(inst);

  inst.ticker = () => _tick(inst);
  canvas.app.ticker.add(inst.ticker);
}

/**
 * Stop ticking, keeping the (hidden) containers and star pools intact.
 *
 * The field costs literally nothing per frame while asleep, which is the whole
 * point: before this, any scene that had ever been configured for warp kept
 * paying the full per-frame read cost forever, even parked at sublight showing
 * nothing at all.
 */
function _sleep(inst) {
  if (inst.asleep) return;
  inst.asleep = true;
  try { canvas?.app?.ticker?.remove(inst.ticker); } catch { /* torn down */ }
}

/** Resume ticking after `_sleep`. */
function _wake(inst) {
  if (!inst.asleep) return;
  inst.asleep = false;
  // Stale by however long it slept; without this the first frame sees a huge dt
  // (clamped, but still a visible jump) and a meaningless smoothed value.
  inst.last = performance.now();
  inst.dtSmooth = 0;
  try { canvas?.app?.ticker?.add(inst.ticker); } catch { /* torn down */ }
}

export function detachSceneWarp() {
  if (!_inst) return;
  const inst = _inst;
  _inst = null;
  try { canvas?.app?.ticker?.remove(inst.ticker); } catch { /* torn down */ }
  _destroy(inst);
}

function _destroy(inst) {
  for (const b of inst.bands) {
    try { b.container.destroy({ children: true }); } catch { /* already gone */ }
  }
  for (const half of [inst.below, inst.above]) {
    if (!half) continue;
    try {
      half.outer.mask = null;
      half.outer.destroy({ children: true });
    } catch { /* already gone */ }
  }
  // The generated texture is this instance's own; nothing else shares it.
  try { inst.texture?.destroy(true); } catch { /* already gone */ }
}

/**
 * Reconcile the field with the scene's current state.
 *
 * The single entry point every hook uses: attaches when a scene gains warp
 * config, detaches when it loses it or the canvas changes underneath, and
 * rebuilds the pools only when the signature actually moved. Slider drags reach
 * the tick without passing through here.
 */
export function syncSceneWarp() {
  const scene = canvas?.scene;
  if (!canvas?.ready || !scene || !hasSceneWarp(scene)) {
    detachSceneWarp();
    return;
  }
  if (!_inst || _inst.sceneId !== scene.id) {
    attachSceneWarp();
    return;
  }
  const cfg = getSceneWarp(scene);
  const sig = _poolSignature(cfg);
  if (sig !== _inst.signature) {
    _inst.signature = sig;
    _inst.palette   = _makePalette(cfg);
    _buildPools(_inst, cfg);
  }
  // Anything that reaches this function is a reason to re-evaluate, and the
  // sleeping instance cannot decide for itself — it is not running.
  _wake(_inst);
}

/** Scene dimensions changed under us — rebuild the frame, mask and pools. */
export function rebuildSceneWarpFrame() {
  if (!_inst) return;
  attachSceneWarp();
}

/** True while a field is live on this canvas. */
export function isSceneWarpActive() {
  return !!_inst;
}

// ── Frame ────────────────────────────────────────────────────────────────────

function _applyRotation(inst) {
  if (inst.below) inst.below.inner.rotation = inst.rotation;
  if (inst.above) inst.above.inner.rotation = inst.rotation;
}

function _tick(inst) {
  if (_inst !== inst) return;

  // The scene changed under us, or the layers went away. Tested as an explicit
  // truthy `destroyed` rather than `!== false`, because PIXI v7 does not always
  // define the flag until the object is torn down — and an undefined there would
  // detach a perfectly healthy field on its first frame.
  if (!canvas?.ready || canvas.scene?.id !== inst.sceneId
      || !inst.below?.outer || inst.below.outer.destroyed) {
    detachSceneWarp();
    return;
  }

  const now = performance.now();
  // Clamped so a stalled tab does not teleport the whole field on resume.
  const dt  = Math.min(50, Math.max(0, now - inst.last));
  inst.last = now;

  // Read each of these EXACTLY once per frame and pass them down. Both are
  // memoised now, but the discipline is what keeps the cost flat — see the note
  // on `scenePhaseFrom` in scene-warp.js.
  const scene  = canvas.scene;
  const cfg    = getSceneWarp(scene);     // live: slider drags need no re-attach
  const timing = getSceneWarpTiming();
  const ramp   = _rampFactor(cfg, timing);

  // With drift off there is nothing to animate at rest, and a parked field would
  // leave frozen stars lying on the map art rather than the clean scene the
  // option promises. Hide outright and stop ticking.
  const dark = !cfg.drift && ramp <= 0;
  if (dark !== inst.dark) {
    inst.dark = dark;
    if (inst.below) inst.below.outer.visible = !dark;
    if (inst.above) inst.above.outer.visible = !dark;
  }
  if (dark) {
    // Unhook entirely rather than returning early every frame. A scene merely
    // *configured* for warp was paying the full read cost forever while showing
    // nothing. `syncSceneWarp()` runs on every updateScene and re-arms us, and
    // the phase only ever leaves idle through a flag write — so nothing can
    // strand the field asleep. The exit ramp still finishes first: this only
    // fires once `ramp` has actually reached 0, which is derived locally.
    _sleep(inst);
    return;
  }

  // Ease onto a new course rather than snapping — the swing is the look.
  const target = (cfg.course * Math.PI) / 180;
  const delta  = _angleDelta(inst.rotation, target);
  if (Math.abs(delta) > 1e-4) {
    const step = Math.min(Math.abs(delta), COURSE_SLEW_RAD_MS * dt) * Math.sign(delta);
    inst.rotation += step;
    _applyRotation(inst);
  }

  const span    = inst.frame.span;
  const half    = span / 2;
  const maxLen  = span * MAX_LEN_FRAC;
  const speed   = (span / _travelMs(cfg.warpFactor, ramp)) * timing.speedMul;
  // Motion uses the REAL dt — smoothing position would let the field drift out
  // of step with wall-clock time.
  const base    = speed * dt;
  // Length uses a smoothed dt instead. A streak's length is a look, not a
  // position, and driving it from raw frame time makes every streak in the field
  // pulse in sympathy with frame-rate jitter — which is exactly what a 3D dice
  // roll produces. Smoothing holds the lengths steady and, because the value
  // then stops changing frame to frame, lets the scale writes below be skipped.
  inst.dtSmooth = inst.dtSmooth > 0 ? inst.dtSmooth * 0.96 + dt * 0.04 : dt;
  const baseLen = speed * inst.dtSmooth;
  // Stretch only climbs with the ramp, so sublight drift stays a field of points.
  const stretch = 1 + WARP_STRETCH * ramp;

  // Length and thickness are the same for every star in a band, so they are
  // resolved to a scale pair once per band and assigned directly. Going through
  // the `width`/`height` setters instead repeats the divide-by-texture-size for
  // every sprite, every frame.
  const texW = inst.texture.width  || 64;
  const texH = inst.texture.height || 8;

  for (const band of inst.bands) {
    const { def, stars, sprites } = band;
    const step  = base * def.speed;
    const len   = Math.min(maxLen, baseLen * def.speed * stretch * cfg.streakMul);
    const thick = BASE_THICK * def.thick * cfg.thickness;
    const sx    = Math.max(thick, len) / texW;
    const sy    = thick / texH;

    // Deadband, so ~750 transform writes disappear on almost every frame.
    //
    // It has to be RELATIVE. `sx` is a texture multiple, so at warp 6 a near-band
    // streak sits around 6 and a drifting one near 0.02 — an absolute epsilon
    // tight enough to matter at the bottom of that range never triggers at the
    // top, which put every write straight back the moment frame time jittered.
    // 0.75% of a 400px streak is 3px: invisible, and it holds under jitter
    // because the comparison is against the last value actually *written*, so
    // wobble has to accumulate past the band rather than merely change sign.
    const scaleMoved = !(Math.abs(sx - band.lastSx) <= Math.abs(band.lastSx) * SCALE_DEADBAND
                      && Math.abs(sy - band.lastSy) <= Math.abs(band.lastSy) * SCALE_DEADBAND);
    if (scaleMoved) { band.lastSx = sx; band.lastSy = sy; }

    // `active` is the whole pool normally, and a fraction of it while 3D dice
    // are on screen. The hidden remainder is skipped rather than moved.
    const n = band.active;
    for (let i = 0; i < n; i++) {
      const star = stars[i];
      const sp   = sprites[i];

      star.y += step;
      // Wrap to the far edge with a fresh x, colour and brightness, so the
      // field never settles into a visibly repeating pattern.
      if (star.y > half) _seedStar(inst, star, sp, def.alpha, star.y - span);

      sp.position.set(star.x, star.y);
      if (scaleMoved) sp.scale.set(sx, sy);
    }
  }
}
