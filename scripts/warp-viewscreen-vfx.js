/**
 * Warp Viewscreen — the starfield renderer.
 *
 * Draws a TNG/DS9/VOY-style star streak field clipped to a Region outline, so a
 * viewscreen or window painted into the map art can actually show warp.
 *
 * Two things about this file are load-bearing:
 *
 *  1. **It carries no socket action.** The GM changes the behavior document and
 *     Foundry replicates that update to every client itself, exactly the way Q
 *     Flash Move relies on document.update rather than a broadcast. That also
 *     buys correct state on reload and for a player who joins mid-warp, which a
 *     one-shot broadcast cannot give.
 *  2. **Every client derives its own ramp position from `phaseAt`,** a wall-clock
 *     stamp written once when the phase begins. Nobody sends a second update to
 *     end a ramp — `entering` settles into `cruise` locally, and `exiting` into
 *     `idle`, purely from elapsed time.
 *
 * Config is re-read from `behavior.system` on every tick rather than captured at
 * attach time, so a slider drag on the GM panel is live for everyone with no
 * re-attach.
 */

import { regionBounds, regionCentre, regionPolygons } from "./spawn-regions.js";
import {
  VFX_Z_BASE,
  PALETTE_SIZE,
  addBlend           as _addBlend,
  effectLayer        as _effectLayer,
  gFillRect          as _gFillRect,
  parseHexColor      as _parseHexColor,
  mixColor           as _mixColor,
  lighten            as _lighten,
  darken             as _darken,
  buildPalette       as _buildPalette,
  buildStreakTexture as _buildStreakTexture,
  buildRadialTexture as _buildRadialTexture,
  cachedSetting,
  numOrNull,
} from "./starfield-common.js";

// Re-exported because warp-viewscreen-panel.js has always imported it from here,
// and the aliases above keep every call site in this file unchanged.
export { numOrNull };

const MODULE = "sta2e-toolkit";

// ── Projection ───────────────────────────────────────────────────────────────
// A pinhole camera. A star sits at (x, y, z) in camera space and projects to
// `vanishingPoint + (x/z, y/z) * FOCAL`. Driving z is what makes the stretch and
// the forward/rear reversal fall out of the maths instead of being faked.
const Z_FAR  = 1200;
const FOCAL  = 900;

// The near plane is what the Spread setting actually moves.
//
// A star is born at Z_FAR and dies at the near plane, and the seed box is sized
// so the near plane lands exactly on the cull radius. That makes the width of
// the birth area `radius * zNear / Z_FAR` — so a *low* near plane means stars
// converge on a pinpoint at the vanishing point, and raising it opens that up
// into a wide emergence area without wasting any stars off-screen.
//
// Driving spread this way rather than by simply scaling the seed box matters:
// scaling the box widens the birth area but also throws stars past the cull
// radius long before they reach the near plane, so most of the pool would spend
// its life invisible.
const Z_NEAR_MIN = 40;    // spread 0   — stars stream out of a single point
const Z_NEAR_MAX = 420;   // spread 100 — born across a third of the field

// Field traversal times, in ms, at a dead stop and at maximum warp. The warp end
// is interpolated geometrically across warp factor 1 → 9.9.
const SUBLIGHT_TRAVEL_MS = 22000;
const WARP_TRAVEL_MIN_MS = 2400;   // warp 1
const WARP_TRAVEL_MAX_MS = 240;    // warp 9.9

// Warp is stylised, not photographic — past a certain speed the streaks stretch
// further than the physical frame delta would give, which is what reads as
// "warp" rather than merely "fast".
// Tuned by measuring the length distribution against the reference look: at 8,
// warp 6 puts the 90th percentile around a fifth of the viewscreen's width with
// a handful of long ones, which is what the real thing does. Higher values start
// producing full-width streaks that read as rain rather than stars.
const WARP_STRETCH = 8;

// Streaks are hairlines by default. Thickness barely moves with depth: in the
// real thing a near star reads as *brighter and longer*, not fatter. These are
// the far/near ends of the range at a Thickness setting of 100%, which the
// setting then scales.
const STREAK_MIN_THICK = 0.85;
const STREAK_MAX_THICK = 1.7;

// The optional starburst at the moment of entering or dropping out of warp.
const BLOOM_RISE_MS = 130;
const BLOOM_FALL_MS = 520;
const BLOOM_PEAK    = 0.85;

/** behavior.uuid → live instance. */
const _instances = new Map();

/**
 * Fill every polygon of a region into `g`.
 *
 * Each outline is filled on its own rather than as one even-odd path, so a
 * region with a subtracted hole masks as solid. That is the right trade for a
 * viewscreen, and it avoids depending on a fill rule that differs across PIXI
 * majors.
 */
function _gFillPolys(g, polys) {
  for (const verts of polys) {
    const flat = [];
    for (const v of verts) flat.push(v.x, v.y);
    if (typeof g.beginFill === "function") {
      g.beginFill(0xffffff, 1);
      g.drawPolygon(flat);
      g.endFill();
    } else {
      g.poly(flat);
      g.fill({ color: 0xffffff, alpha: 1 });
    }
  }
}

// ── Config ───────────────────────────────────────────────────────────────────

/** Live config off the behavior document, with every value defended. */
function _readConfig(behavior) {
  const s = behavior?.system ?? {};
  const num = (v, d) => numOrNull(v, d);
  return {
    phase:         ["idle", "entering", "cruise", "exiting"].includes(s.phase) ? s.phase : "idle",
    phaseAt:       num(s.phaseAt, 0),
    warpFactor:    Math.min(9.9, Math.max(1, num(s.warpFactor, 6))),
    vanishX:       numOrNull(s.vanishX),
    vanishY:       numOrNull(s.vanishY),
    inbound:       !!s.inbound,
    spread:        Math.min(100, Math.max(0, num(s.spread, 30))) / 100,
    density:       Math.min(1500, Math.max(20, Math.round(num(s.density, 600)))),
    starTint:      _parseHexColor(s.starTint ?? "#cfe6ff", 0xcfe6ff),
    accentTint:    _parseHexColor(s.accentTint ?? "#a855f7", 0xa855f7),
    variety:       Math.min(100, Math.max(0, num(s.variety, 45))) / 100,
    streakMul:     Math.min(400, Math.max(10, num(s.streakMul, 100))) / 100,
    thickness:     Math.min(400, Math.max(50, num(s.thickness, 100))) / 100,
    backdrop:      _parseHexColor(s.backdrop ?? "#05030c", 0x05030c),
    backdropAlpha: Math.min(100, Math.max(0, num(s.backdropAlpha, 85))) / 100,
    nebula:        s.nebula !== false,
    // Opt-in, unlike everything else here: the starburst was removed once for
    // being intrusive, so it stays off until it is asked for.
    flash:         s.flash === true,
    sublightDrift: s.sublightDrift !== false,
    aboveTokens:   !!s.aboveTokens,
  };
}

/**
 * Memoised — `getViewscreenTiming()` below is called from inside `_tick`, so an
 * uncached read here was three `game.settings.get` calls every frame, each one
 * returning what it returned last frame. The shared cache is cleared on any
 * `updateSetting`, so a change on the config menu is still picked up at once.
 */
function _setting(key, fallback) {
  return cachedSetting(MODULE, key, fallback);
}

/** Ramp durations are world settings so the GM can tune the feel once. */
export function getViewscreenTiming() {
  const n = (k, d) => {
    const v = Number(_setting(k, d));
    return Number.isFinite(v) && v > 0 ? v : d;
  };
  return {
    enterMs:  n("warpViewscreenEnterMs", 2000),
    exitMs:   n("warpViewscreenExitMs", 1600),
    speedMul: Math.max(0.1, n("warpViewscreenStarSpeed", 100) / 100),
  };
}

/** The near plane for a spread setting. See the Z_NEAR_MIN/MAX note above. */
function _zNear(cfg) {
  return Z_NEAR_MIN + (Z_NEAR_MAX - Z_NEAR_MIN) * cfg.spread;
}

/**
 * z-units per ms at a given warp factor.
 *
 * Scaled by the depth range so that a traversal takes the same wall-clock time
 * whatever the spread is — otherwise widening the spread would silently slow the
 * stars down, since they would have less distance to cover.
 */
function _warpSpeed(warpFactor, zNear) {
  const t = (Math.min(9.9, Math.max(1, warpFactor)) - 1) / 8.9;
  const travelMs = WARP_TRAVEL_MIN_MS * Math.pow(WARP_TRAVEL_MAX_MS / WARP_TRAVEL_MIN_MS, t);
  return (Z_FAR - zNear) / travelMs;
}

function _sublightSpeed(cfg, zNear) {
  if (!cfg.sublightDrift) return 0;
  return (Z_FAR - zNear) / SUBLIGHT_TRAVEL_MS;
}

function _easeInOut(t) {
  const c = Math.min(1, Math.max(0, t));
  return c < 0.5 ? 2 * c * c : 1 - Math.pow(-2 * c + 2, 2) / 2;
}

/**
 * How far along the warp ramp this client is, 0 (sublight) → 1 (full warp).
 *
 * Derived from wall-clock elapsed time since `phaseAt`, never from a counter, so
 * a client that joins or reloads mid-sequence resolves to the same value as
 * everyone else. `entering` past its ramp reads as cruise and `exiting` past its
 * ramp reads as idle without anyone having to write a second update.
 */
function _rampFactor(cfg, timing) {
  const elapsed = cfg.phaseAt > 0 ? Date.now() - cfg.phaseAt : Infinity;
  switch (cfg.phase) {
    case "cruise":   return 1;
    case "entering": return _easeInOut(elapsed / timing.enterMs);
    case "exiting":  return 1 - _easeInOut(elapsed / timing.exitMs);
    default:         return 0;
  }
}

// ── Star pool ────────────────────────────────────────────────────────────────

/**
 * Seed one star.
 *
 * `x`/`y` are drawn from a box sized so a star reaching the near plane has
 * travelled to the edge of the bounding circle. Combined with a uniform z that
 * gives the classic distribution: stars emerge near the vanishing point and
 * accelerate outward as they approach.
 */
function _seedStar(inst, star, z) {
  const spread = inst.spread;
  star.x  = (Math.random() * 2 - 1) * spread;
  star.y  = (Math.random() * 2 - 1) * spread;
  star.z  = z;
  star.px = null;      // no previous projection yet — first frame draws a dot
  star.py = null;
  // A fresh colour on every recycle, so the mix keeps churning rather than the
  // field settling into a fixed arrangement of hues.
  star.tint = inst.palette[(Math.random() * inst.palette.length) | 0];
}

function _resizePool(inst, count) {
  const { stars, sprites, container, texture } = inst;
  while (stars.length > count) {
    stars.pop();
    const sp = sprites.pop();
    try { sp.destroy(); } catch { /**/ }
  }
  while (stars.length < count) {
    const star = { x: 0, y: 0, z: 0, px: null, py: null, tint: 0xffffff };
    _seedStar(inst, star, inst.zNear + Math.random() * (Z_FAR - inst.zNear));
    stars.push(star);
    const sp = new PIXI.Sprite(texture);
    sp.anchor.set(1, 0.5);          // head of the streak pins to the star
    sp.blendMode = _addBlend();
    sp.alpha = 0;
    // Tint is written at seed time only — the setter converts a colour on every
    // write, which across a thousand stars a frame is not free.
    sp.tint = star.tint;
    container.addChild(sp);
    sprites.push(sp);
  }
}

/** Re-roll the palette and repaint the pool after a colour change. */
function _applyPalette(inst, cfg) {
  inst.palette = _buildPalette(cfg.starTint, cfg.accentTint, cfg.variety);
  for (let i = 0; i < inst.stars.length; i++) {
    const tint = inst.palette[(Math.random() * inst.palette.length) | 0];
    inst.stars[i].tint = tint;
    inst.sprites[i].tint = tint;
  }
}

// ── Geometry ─────────────────────────────────────────────────────────────────

/** Bounds, bounding-circle radius and the vanishing point, in canvas coords. */
function _resolveFrame(region, cfg) {
  const b = regionBounds(region);
  if (!b || !(b.width > 0) || !(b.height > 0)) return null;
  const centre = regionCentre(region);
  const vp = {
    x: cfg.vanishX ?? centre.x,
    y: cfg.vanishY ?? centre.y,
  };
  // The radius must reach the farthest corner *from the vanishing point*, which
  // may sit well outside the region — that is the whole point of picking it.
  const corners = [
    { x: b.x,           y: b.y },
    { x: b.x + b.width, y: b.y },
    { x: b.x,           y: b.y + b.height },
    { x: b.x + b.width, y: b.y + b.height },
  ];
  const radius = Math.max(...corners.map(c => Math.hypot(c.x - vp.x, c.y - vp.y)));
  return { bounds: b, vp, radius: Math.max(32, radius) };
}

function _buildMask(region) {
  const polys = regionPolygons(region);
  if (!polys.length) return null;
  const g = new PIXI.Graphics();
  _gFillPolys(g, polys);
  return g;
}

/**
 * The near-black space behind the stars.
 *
 * Drawn as a rect over the bounds and clipped by the same mask, so it takes the
 * region's shape. Without it the starfield floats over whatever the map art has
 * underneath, which reads as sparkles on a wall rather than a view of space.
 * `backdropAlpha` of 0 turns it off for art that already paints its own screen.
 */
function _syncBackdrop(inst, cfg) {
  const g = inst.backdrop;
  if (!g) return;
  g.visible = cfg.backdropAlpha > 0;
  if (!g.visible) return;
  const b = inst.frame.bounds;
  g.clear();
  // Overshoot so a reshape never exposes an unpainted edge before the next sync.
  _gFillRect(g, b.x - 8, b.y - 8, b.width + 16, b.height + 16, cfg.backdrop, cfg.backdropAlpha);
}

/**
 * A soft coloured haze sitting off to one side, in the accent hue.
 *
 * Anchored away from the vanishing point, so it sits behind the oncoming flow
 * rather than washing out the point the streaks emerge from.
 */
function _syncNebula(inst, cfg) {
  const sp = inst.nebula;
  if (!sp) return;
  sp.visible = !!cfg.nebula;
  if (!sp.visible) return;

  const b  = inst.frame.bounds;
  const vp = inst.frame.vp;
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  let dx = cx - vp.x;
  let dy = cy - vp.y;
  // A vanishing point dead centre leaves no "away" direction — fall back to the
  // lower left, which is where the haze sits in the look this is modelled on.
  const m = Math.hypot(dx, dy);
  if (m < 1) { dx = -0.6; dy = 0.8; }
  else       { dx /= m;   dy /= m;  }

  sp.position.set(cx + dx * b.width * 0.3, cy + dy * b.height * 0.3);
  sp.width  = Math.max(b.width, b.height) * 1.7;
  sp.height = sp.width;
  sp.tint   = cfg.accentTint;
  sp.alpha  = 0.2;
}

/**
 * Build the fixed layers once, bottom to top: mask, backdrop, nebula. Star
 * sprites append above them.
 *
 * They are created unconditionally and toggled with `visible` rather than being
 * created and destroyed as the options change — otherwise turning the backdrop
 * back on would re-append it *over* the stars, and correcting that needs child
 * index juggling that differs across PIXI majors.
 */
function _buildLayers(inst) {
  inst.backdrop = new PIXI.Graphics();
  inst.container.addChild(inst.backdrop);

  inst.radialTex = _buildRadialTexture();
  inst.nebula = new PIXI.Sprite(inst.radialTex);
  inst.nebula.anchor.set(0.5);
  inst.nebula.blendMode = _addBlend();
  inst.container.addChild(inst.nebula);

  // The enter/exit starburst, built here rather than lazily on first flash. The
  // old lazy version landed above whatever stars existed at the time, so raising
  // the star count afterwards silently appended new sprites over it. Blend mode
  // is additive, so sitting under the stars costs nothing visually.
  inst.bloom = new PIXI.Sprite(inst.radialTex);
  inst.bloom.anchor.set(0.5);
  inst.bloom.blendMode = _addBlend();
  inst.bloom.alpha = 0;
  inst.bloom.visible = false;
  inst.container.addChild(inst.bloom);
}

/** Stop any starburst in flight and hide it. */
function _clearBloom(inst) {
  inst.bloomAge = 0;
  if (!inst.bloom) return;
  inst.bloom.alpha = 0;
  inst.bloom.visible = false;
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

/**
 * Start rendering for one behavior. Idempotent — an existing instance for the
 * same behavior is torn down first, so a reshape or a re-view never stacks.
 */
export function attachViewscreen(model) {
  const behavior = model?.behavior ?? model ?? null;
  const region   = model?.region ?? behavior?.region ?? null;
  if (!behavior?.uuid || !region) return;

  detachViewscreen(behavior.uuid);

  // The placeable is not drawn on a scene that is not being viewed, and there is
  // no geometry to mask against until it is.
  if (!region.object) return;

  const layer = _effectLayer();
  if (!layer || !canvas?.app?.ticker) return;

  const cfg   = _readConfig(behavior);
  const frame = _resolveFrame(region, cfg);
  if (!frame) return;

  const mask = _buildMask(region);
  if (!mask) return;

  const zNear = _zNear(cfg);

  const container = new PIXI.Container();
  container.zIndex = cfg.aboveTokens ? VFX_Z_BASE : -VFX_Z_BASE;
  container.addChild(mask);
  container.mask = mask;
  layer.addChild(container);

  // One soft glow pass over the whole field rather than a filter per star — the
  // same reasoning as the transporter mote rain. Kept weak: the filter carries a
  // single colour, so leaning on it would flatten the per-star hues back out.
  try {
    const GF = PIXI.filters?.GlowFilter ?? globalThis.PIXI?.filters?.GlowFilter;
    if (GF) {
      container.filters = [new GF({
        distance: 5, outerStrength: 0.7, innerStrength: 0.15,
        color: cfg.starTint, quality: 0.2,
      })];
    }
  } catch { /* cosmetic */ }

  const inst = {
    uuid:        behavior.uuid,
    behavior,
    region,
    container,
    mask,
    backdrop:    null,
    nebula:      null,
    texture:     _buildStreakTexture(),
    radialTex:   null,
    bloom:       null,
    bloomAge:    0,
    stars:       [],
    sprites:     [],
    palette:        _buildPalette(cfg.starTint, cfg.accentTint, cfg.variety),
    paletteBase:    cfg.starTint,
    paletteAccent:  cfg.accentTint,
    paletteVariety: cfg.variety,
    zNear:       zNear,
    spread:      (frame.radius * zNear) / FOCAL,
    frame,
    aboveTokens: cfg.aboveTokens,
    last:        performance.now(),
    dark:        false,
    finished:    false,
    tick:        null,
  };

  _buildLayers(inst);
  _syncBackdrop(inst, cfg);
  _syncNebula(inst, cfg);
  _resizePool(inst, cfg.density);
  _instances.set(behavior.uuid, inst);

  inst.tick = () => _tick(inst);
  canvas.app.ticker.add(inst.tick);
}

/** Stop rendering and release everything. Safe to call on an unknown behavior. */
export function detachViewscreen(modelOrUuid) {
  const uuid = modelOrUuid?.behavior?.uuid ?? modelOrUuid?.uuid ?? modelOrUuid;
  const inst = _instances.get(uuid);
  if (!inst) return;
  _destroyInstance(inst);
  _instances.delete(uuid);
}

function _destroyInstance(inst) {
  if (inst.finished) return;
  inst.finished = true;
  try { canvas?.app?.ticker?.remove(inst.tick); } catch { /**/ }
  try { inst.container.mask = null; } catch { /**/ }
  // Filters survive destroy({children:true}) — they have to go explicitly.
  try {
    for (const f of inst.container.filters ?? []) f?.destroy?.();
    inst.container.filters = [];
  } catch { /**/ }
  try { inst.container.destroy({ children: true }); } catch { /**/ }
  try { inst.texture?.destroy?.(true); } catch { /**/ }
  try { inst.radialTex?.destroy?.(true); } catch { /**/ }
}

/** The region was reshaped — rebuild the mask and the projection frame. */
export function rebuildMask(model) {
  const uuid = model?.behavior?.uuid ?? model?.uuid ?? model;
  const inst = _instances.get(uuid);
  if (!inst || inst.finished) return;
  const mask = _buildMask(inst.region);
  if (!mask) return;
  try { inst.container.mask = null; } catch { /**/ }
  try { inst.mask.destroy(); } catch { /**/ }
  inst.container.addChild(mask);
  inst.container.mask = mask;
  inst.mask = mask;
  _refreshFrame(inst);
  // The bounds moved, so the backdrop rect and the haze have to follow.
  const cfg = _readConfig(inst.behavior);
  _syncBackdrop(inst, cfg);
  _syncNebula(inst, cfg);
}

function _refreshFrame(inst) {
  const cfg   = _readConfig(inst.behavior);
  const frame = _resolveFrame(inst.region, cfg);
  if (!frame) return;
  inst.frame  = frame;
  inst.zNear  = _zNear(cfg);
  inst.spread = (frame.radius * inst.zNear) / FOCAL;
}

/**
 * Config changed on the document. Most fields are read live in the tick, so this
 * only handles the ones needing structural work: pool size, glow colour, z-order
 * side, and the vanishing point moving.
 */
export function refreshViewscreen(behavior) {
  const inst = _instances.get(behavior?.uuid);
  if (!inst || inst.finished) return;
  inst.behavior = behavior;
  const cfg = _readConfig(behavior);

  _refreshFrame(inst);
  if (cfg.starTint !== inst.paletteBase || cfg.accentTint !== inst.paletteAccent
      || cfg.variety !== inst.paletteVariety) {
    inst.paletteBase    = cfg.starTint;
    inst.paletteAccent  = cfg.accentTint;
    inst.paletteVariety = cfg.variety;
    _applyPalette(inst, cfg);
  }
  _syncBackdrop(inst, cfg);
  _syncNebula(inst, cfg);
  _resizePool(inst, cfg.density);

  const wantZ = cfg.aboveTokens ? VFX_Z_BASE : -VFX_Z_BASE;
  if (inst.container.zIndex !== wantZ) inst.container.zIndex = wantZ;
  inst.aboveTokens = cfg.aboveTokens;

  try {
    const f = inst.container.filters?.[0];
    if (f && "color" in f) f.color = cfg.starTint;
  } catch { /**/ }
}

/** Drop every instance — used on canvasReady so nothing survives a scene swap. */
export function sweepViewscreens() {
  for (const inst of _instances.values()) _destroyInstance(inst);
  _instances.clear();
}

/** Is this behavior currently rendering on this client? */
export function isViewscreenActive(uuid) {
  return _instances.has(uuid);
}

// ── The starburst ────────────────────────────────────────────────────────────

/**
 * A short white burst at the centre of the viewscreen, clipped by the same mask.
 * Off unless the behavior opts in.
 *
 * Deliberately a PIXI sprite inside the mask rather than the viewport-wide DOM
 * overlay Q uses: this effect is bounded to a shape on the map, so the reasoning
 * in q-vfx.js about lighting and overhead tiles does not apply here.
 */
export function flashViewscreen(behavior) {
  const inst = _instances.get(behavior?.uuid);
  if (!inst || inst.finished || !inst.bloom) return;
  if (!_readConfig(inst.behavior).flash) return;

  const b = inst.frame.bounds;
  inst.bloom.position.set(b.x + b.width / 2, b.y + b.height / 2);
  // Overshoot the bounds so the falloff never shows a visible circular edge.
  inst.bloom.width   = b.width * 1.9;
  inst.bloom.height  = b.height * 1.9;
  inst.bloom.alpha   = 0;
  inst.bloom.visible = true;
  inst.bloomAge      = 1;   // non-zero starts the rise on the next tick
}

// ── The frame ────────────────────────────────────────────────────────────────

function _tick(inst) {
  if (inst.finished) return;

  // The scene changed under us, or the region went away.
  if (!inst.behavior?.parent || !inst.region?.object || inst.container.destroyed) {
    detachViewscreen(inst.uuid);
    return;
  }

  const now = performance.now();
  // Clamped so a stalled tab does not teleport the whole field on resume.
  const dt  = Math.min(50, Math.max(0, now - inst.last));
  inst.last = now;

  const cfg    = _readConfig(inst.behavior);
  const timing = getViewscreenTiming();
  const ramp   = _rampFactor(cfg, timing);

  const zNear = inst.zNear;
  const sub   = _sublightSpeed(cfg, zNear);
  const warp  = _warpSpeed(cfg.warpFactor, zNear);
  const speed = (sub + (warp - sub) * ramp) * timing.speedMul;

  // With drift switched off there is nothing to animate at rest, and leaving the
  // field parked would show a frozen starfield rather than the dark viewscreen
  // the option promises. Hide it outright and skip the whole loop.
  const dark = !cfg.sublightDrift && ramp <= 0;
  if (dark !== inst.dark) {
    inst.dark = dark;
    inst.container.visible = !dark;
    // Coming back from dark, drop the stale previous projections — otherwise
    // every star draws one clamped full-length streak on the first frame.
    if (!dark) for (const star of inst.stars) { star.px = null; star.py = null; }
    // Going dark mid-burst would freeze it half-lit and show it again on the way
    // back, since the loop below stops running.
    if (dark) _clearBloom(inst);
  }
  if (dark) return;

  const { vp, radius } = inst.frame;
  const dir     = cfg.inbound ? 1 : -1;   // outbound drives z toward the near plane
  const cull    = radius * 1.35;
  // Ceiling on a single streak. Loose enough that the longest cross most of the
  // viewscreen, tight enough that none of them span it end to end.
  const maxLen  = radius * 1.5;
  // Stretch only climbs with the ramp, so sublight stays a field of points.
  const stretch = 1 + WARP_STRETCH * ramp;

  const { stars, sprites } = inst;
  for (let i = 0; i < stars.length; i++) {
    const star = stars[i];
    const sp   = sprites[i];

    star.z += dir * speed * dt;

    // Recycle at whichever plane this direction of travel exits through.
    if (dir < 0 && star.z <= zNear)      { _seedStar(inst, star, Z_FAR); sp.tint = star.tint; }
    else if (dir > 0 && star.z >= Z_FAR) { _seedStar(inst, star, zNear); sp.tint = star.tint; }

    const k  = FOCAL / star.z;
    const sx = vp.x + star.x * k;
    const sy = vp.y + star.y * k;
    const rd = Math.hypot(sx - vp.x, sy - vp.y);

    if (rd > cull) {
      // Left the frame — recycle rather than pay for an off-screen sprite.
      _seedStar(inst, star, dir < 0 ? Z_FAR : zNear);
      sp.tint  = star.tint;
      sp.alpha = 0;
      continue;
    }

    // Depth cue: a star fades up as it nears, so they emerge rather than pop in.
    const depth = 1 - (star.z - zNear) / (Z_FAR - zNear);
    const alpha = Math.min(1, 0.12 + depth * 1.15);
    // Thickness barely moves across the depth range — nearness shows as
    // brightness and length instead. The Thickness setting scales the whole
    // range rather than only the near end, so thin and fat fields both keep the
    // same slight sense of depth.
    const thick = (STREAK_MIN_THICK + depth * (STREAK_MAX_THICK - STREAK_MIN_THICK))
                * cfg.thickness;

    let len = 0;
    if (star.px !== null) {
      len = Math.hypot(sx - star.px, sy - star.py) * stretch * cfg.streakMul;
      if (len > maxLen) len = maxLen;
    }

    sp.position.set(sx, sy);
    // A star that barely moved this frame still draws as a point rather than
    // snapping to a meaningless rotation.
    sp.rotation = (star.px !== null && len > thick)
      ? Math.atan2(sy - star.py, sx - star.px)
      : 0;
    sp.width  = Math.max(thick, len);
    sp.height = thick;
    sp.alpha  = alpha;

    star.px = sx;
    star.py = sy;
  }

  // Starburst rise and decay.
  if (inst.bloomAge > 0 && inst.bloom) {
    inst.bloomAge += dt;
    const a = inst.bloomAge;
    const v = a < BLOOM_RISE_MS
      ? a / BLOOM_RISE_MS
      : 1 - Math.min(1, (a - BLOOM_RISE_MS) / BLOOM_FALL_MS);
    inst.bloom.alpha = Math.max(0, v) * BLOOM_PEAK;
    if (v <= 0) _clearBloom(inst);
  }
}
