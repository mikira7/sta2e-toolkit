/**
 * Warp Viewscreen — the travel renderer.
 *
 * Draws what is outside the ship, clipped to a Region outline, so a viewscreen
 * or window painted into the map art can actually show it. Originally that meant
 * a TNG/DS9/VOY-style star streak field and nothing else; it now draws whichever
 * environment the behavior selects — warp, a nebula, an ion storm, an asteroid
 * field, or the static of a dead screen — from the table in
 * [viewscreen-environments.js](viewscreen-environments.js).
 *
 * **The camera did not change to make that possible, and that is the point.** A
 * particle at `(x, y, z)` marching toward the near plane and projecting to
 * `vp + (x/z, y/z) * FOCAL` describes flying through a cloud bank or a rock
 * field exactly as well as it describes warp. Every environment shares this one
 * projection; what differs is the *material* drawn at each projected point.
 *
 * Three things about this file are load-bearing:
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
 *  3. **Layers are built once and toggled with `visible`.** See `_buildLayers`.
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
  buildCloudTexture  as _buildCloudTexture,
  buildStormCloudTexture as _buildStormCloudTexture,
  buildRockTexture   as _buildRockTexture,
  buildMoteTexture   as _buildMoteTexture,
  buildWispTexture   as _buildWispTexture,
  buildGrainFrames   as _buildGrainFrames,
  buildScanlineTexture as _buildScanlineTexture,
  buildLightningPath as _buildLightningPath,
  strokePolyline     as _strokePolyline,
  passThrough        as _passThrough,
  cachedSetting,
  numOrNull,
} from "./starfield-common.js";
import {
  getEnvironment,
  isEnvironmentId,
  environmentGrain as _envGrain,
  environmentStrobe as _envStrobe,
  DEFAULT_ENVIRONMENT,
} from "./viewscreen-environments.js";

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
//
// Environments scale THIS, they never replace it — see the multiplier rule in
// the header of viewscreen-environments.js.
const WARP_STRETCH = 8;

// Streaks are hairlines by default. Thickness barely moves with depth: in the
// real thing a near star reads as *brighter and longer*, not fatter. These are
// the far/near ends of the range at a Thickness setting of 100%, which the
// setting then scales.
const STREAK_MIN_THICK = 0.85;
const STREAK_MAX_THICK = 1.7;

// The optional starburst at the moment of entering or dropping out of warp, and
// the ion storm's lightning, which shares the same sprite and decay.
const BLOOM_RISE_MS = 130;
const BLOOM_FALL_MS = 520;
const BLOOM_PEAK    = 0.85;

// How many distinct textures a variant-bearing environment pool draws from. Four
// clouds and five rocks is enough that the eye stops finding the repeat; going
// higher costs real texture memory for no visible gain.
const CLOUD_VARIANTS = 4;
const ROCK_VARIANTS  = 5;

// Hard ceiling on an environment pool. A cloud sprite is two orders of magnitude
// more fill than a hairline streak, so the density setting's own 1500 limit is
// far too generous once it is multiplied through `countMul`.
const ENV_POOL_MAX = 400;

// How closed a tunnel's aperture gets at ramp 0. Never zero: at a true zero the
// whole pool projects onto a single pixel and a few hundred additive sprites
// stack into a blinding dot.
const APERTURE_MIN = 0.08;

// Shake decays with this time constant, in ms. Frame-rate independent, so a
// client at 30fps sees the same settle as one at 144.
const SHAKE_DECAY_MS = 90;

// Noise frames in the static loop. Stepped by 2 each tick so a short loop does
// not read as a cycle — the same trick shield-idle-vfx.js uses.
const GRAIN_FRAME_COUNT = 6;

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
    // An unknown id keeps drawing as warp rather than throwing from inside a
    // ticker — a scene saved by a newer version must still open.
    environment:   isEnvironmentId(s.environment) ? s.environment : DEFAULT_ENVIRONMENT,
    intensity:     Math.min(100, Math.max(0, num(s.intensity, 100))) / 100,
    interference:  Math.min(100, Math.max(0, num(s.interference, 0))) / 100,
    lightning:     Math.min(100, Math.max(0, num(s.lightning, 0))) / 100,
    starMix:       Math.min(100, Math.max(0, num(s.starMix, 100))) / 100,
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
    // The backdrop image. `imageSrc` is read as a plain string so an entry the
    // library no longer has cannot crash a ticker; an unknown fit falls back to
    // cover for the same reason `environment` falls back to warp above.
    imageSrc:      _imagePath(s.imageSrc),
    imageFit:      IMAGE_FITS.includes(s.imageFit) ? s.imageFit : "cover",
    imageScale:    Math.min(400, Math.max(10, num(s.imageScale, 100))) / 100,
    imageOffsetX:  Math.min(100, Math.max(-100, num(s.imageOffsetX, 0))) / 100,
    imageOffsetY:  Math.min(100, Math.max(-100, num(s.imageOffsetY, 0))) / 100,
    imageAlpha:    Math.min(100, Math.max(0, num(s.imageAlpha, 100))) / 100,
    imageAbove:    !!s.imageAbove,
  };
}

/** How many stars this config wants. `starMix` is what thins them behind gas. */
function _starCount(cfg) {
  return Math.max(0, Math.round(cfg.density * cfg.starMix));
}

/** How many environment particles this config wants. 0 when it has no pool. */
function _envCount(cfg, env) {
  const p = env.particle;
  if (!p) return 0;
  return Math.max(0, Math.min(ENV_POOL_MAX,
    Math.round(cfg.density * p.countMul * cfg.intensity)));
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
  const { stars, sprites, starLayer, texture } = inst;
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
    starLayer.addChild(sp);
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

// ── Environment pool ─────────────────────────────────────────────────────────

/**
 * Build the textures one environment's pool draws from.
 *
 * The registry names a texture by **string key** rather than handing over a
 * builder, which is what lets it stay a leaf that imports neither PIXI nor this
 * module. Resolving the key is therefore each renderer's own job.
 */
function _buildEnvTextures(key) {
  switch (key) {
    case "cloud":      return Array.from({ length: CLOUD_VARIANTS }, () => _buildCloudTexture());
    case "stormCloud": return Array.from({ length: CLOUD_VARIANTS }, () => _buildStormCloudTexture());
    case "rock":  return Array.from({ length: ROCK_VARIANTS },  () => _buildRockTexture());
    case "wisp":  return Array.from({ length: CLOUD_VARIANTS }, () => _buildWispTexture());
    case "mote":  return [_buildMoteTexture()];
    case "streak":return [_buildStreakTexture()];
    default:      return [_buildRadialTexture()];
  }
}

/**
 * Seed one environment particle.
 *
 * Shares the star pool's seed box and z range — the two pools are the same
 * camera, so a cloud and a star at the same depth project to the same place.
 * `sizeVar` and `spin` are rolled once per life so neither is recomputed per
 * frame, the same reasoning that keeps star tint out of the tick.
 */
function _seedEnvParticle(inst, p, z, spec) {
  const spread = inst.spread;
  if (spec.shape === "tube") {
    // A tunnel is a seeding shape, not a camera. On a ring of fixed radius the
    // same z-march projects to `r * FOCAL / z`, which grows as z falls — so the
    // wall rushes outward past the viewer and the untouched centre is the hole
    // you are looking down. Nothing below this branch knows or cares.
    const th = Math.random() * Math.PI * 2;
    const r  = spread * spec.radius * (1 + spec.wall * (Math.random() * 2 - 1));
    p.x = Math.cos(th) * r;
    p.y = Math.sin(th) * r;
  } else {
    p.x = (Math.random() * 2 - 1) * spread;
    p.y = (Math.random() * 2 - 1) * spread;
  }
  p.z  = z;
  p.px = null;
  p.py = null;
  p.sizeVar = 0.6 + Math.random() * 0.8;
  p.rot     = Math.random() * Math.PI * 2;
  // Signed, so a field of rocks does not all turn the same way.
  p.spin    = spec.tumbleDeg
    ? ((Math.random() * 2 - 1) * spec.tumbleDeg * Math.PI) / 180 / 1000
    : 0;
  // Eccentricity, area-preserving so a squashed particle is not also a smaller
  // one. Rolled once and kept: a pool of identically circular sprites is most of
  // what made these read as discs, however good the texture inside them was.
  const e = spec.aspect > 1
    ? Math.pow(spec.aspect, Math.random() * 2 - 1)
    : 1;
  p.ax = e;
  p.ay = 1 / e;
  // Phase and rate for the billow, so no two particles breathe together.
  p.churnPhase = Math.random() * Math.PI * 2;
  p.churnRate  = 0.00035 + Math.random() * 0.0005;
  p.tint = inst.palette[(Math.random() * inst.palette.length) | 0];
}

function _resizeEnvPool(inst, count, env) {
  const { envParticles, envSprites, envLayer } = inst;
  const spec = env.particle;

  while (envParticles.length > count) {
    envParticles.pop();
    const sp = envSprites.pop();
    try { sp.destroy(); } catch { /**/ }
  }
  if (!spec || !inst.envTextures.length) return;

  const blend = spec.blend === "normal" ? undefined : _addBlend();
  while (envParticles.length < count) {
    const p = {};
    _seedEnvParticle(inst, p, inst.zNear + Math.random() * (Z_FAR - inst.zNear), spec);
    envParticles.push(p);

    // Variants are picked at build time and kept: swapping a sprite's texture
    // per frame would break batching for no visual gain.
    const tex = inst.envTextures[(Math.random() * inst.envTextures.length) | 0];
    const sp  = new PIXI.Sprite(tex);
    sp.anchor.set(0.5);
    if (blend !== undefined) sp.blendMode = blend;
    sp.alpha = 0;
    // Rock takes the accent directly; anything additive takes a palette colour
    // so a cloud bank is not one flat hue.
    sp.tint = spec.blend === "normal" ? inst.accentTint : p.tint;
    envLayer.addChild(sp);
    envSprites.push(sp);
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
 * The near-black space behind everything else.
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

// ── Backdrop images ──────────────────────────────────────────────────────────

/** The fit modes the schema offers. Duplicated rather than imported from
 *  warp-viewscreen-behavior.js, which imports *this* module — that would close
 *  a cycle. Four strings are a cheaper price than the cycle. */
const IMAGE_FITS = ["cover", "contain", "stretch", "native"];

/** A trimmed path, or null. `FilePathField` stores null when cleared. */
function _imagePath(v) {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s : null;
}

/**
 * Is this path a video?
 *
 * A local three-line test rather than `_isVideoTextureSrc` from
 * ship-vfx-anchors.js: that module is far too heavy to pull into this one's
 * import graph for an extension check.
 */
function _isVideoPath(src) {
  const ext = String(src ?? "").split("?")[0].split("#")[0].split(".").pop()?.toLowerCase() ?? "";
  const known = CONST?.VIDEO_FILE_EXTENSIONS;
  if (known) return ext in known || Object.values(known).includes(ext);
  return /^(webm|mp4|m4v|ogv|ogg|mov)$/.test(ext);
}

/**
 * Path to texture, with the three-tier fallback and the negative cache from
 * hull-decals.js — a 404 is resolved once and never re-fetched.
 *
 * **Video is deliberately not cached.** A texture backed by a `<video>` carries
 * one playhead, so two regions sharing a cached one would share their playback;
 * each instance loads and owns its own, and destroys it on teardown.
 */
const _imageTextureCache = new Map();

async function _loadImageTexture(src) {
  const cacheable = !_isVideoPath(src);
  if (cacheable && _imageTextureCache.has(src)) return _imageTextureCache.get(src);

  let tex = null;
  try {
    if (foundry?.canvas?.loadTexture) tex = await foundry.canvas.loadTexture(src);
    else if (typeof loadTexture === "function") tex = await loadTexture(src);
  } catch { tex = null; }
  if (!tex && globalThis.PIXI?.Assets?.load) {
    try { tex = await PIXI.Assets.load(src); } catch { tex = null; }
  }
  if (cacheable) _imageTextureCache.set(src, tex || null);
  return tex || null;
}

/**
 * The GM's backdrop picture, drawn inside the region outline.
 *
 * Sized against `inst.frame.bounds` like every other fixed layer, and clipped by
 * the container's region mask for free — which is what makes `cover` plus an
 * off-centre offset a framing tool rather than a mess. Offsets are fractions of
 * the region's own bounds, so a saved backdrop keeps its framing when the GM
 * later moves or reshapes the region.
 *
 * Async, so it is guarded the way every deferred path here has to be: after the
 * await, the instance may be gone or the GM may have picked a different file.
 */
function _syncImage(inst, cfg) {
  // Called from three sync paths and never awaited, so an unhandled rejection is
  // the one failure mode that could escape into the console every frame.
  _syncImageAsync(inst, cfg).catch(err => {
    console.warn("STA2e Toolkit | warp viewscreen: backdrop image failed:", err);
  });
}

async function _syncImageAsync(inst, cfg) {
  const below = inst.imgBelow;
  const above = inst.imgAbove;
  if (!below || !above) return;

  if (!cfg.imageSrc) {
    _releaseImage(inst);
    below.visible = above.visible = false;
    return;
  }

  if (cfg.imageSrc !== inst.imgSrcLoaded) {
    const src = cfg.imageSrc;
    inst.imgSrcLoaded = src;                 // claim it before awaiting
    const tex = await _loadImageTexture(src);
    // The instance may have been torn down, or the GM may have moved on to a
    // different file, while that was in flight.
    if (inst.finished || inst.imgSrcLoaded !== src) return;
    if (!tex) {
      _releaseImage(inst);
      below.visible = above.visible = false;
      return;
    }
    _releaseImage(inst, { keepSrc: true });
    const sp = new PIXI.Sprite(tex);
    sp.anchor.set(0.5);
    inst.imgSprite = sp;
    inst.imgTexture = tex;
    inst.imgOwnsTexture = _isVideoPath(src);
    below.addChild(sp);
    if (inst.imgOwnsTexture) {
      try {
        const source = game?.video?.getVideoSource?.(sp);
        if (source) game.video.play(source, { loop: true, volume: 0 });
      } catch { /**/ }
    }
    // The document may have moved on between the read and the load landing.
    cfg = _readConfig(inst.behavior);
  }

  const sp = inst.imgSprite;
  if (!sp || sp.destroyed) return;

  // One sprite, two possible parents — `addChild` reparents, so the toggle costs
  // no reload and no child-index maths that differs across PIXI majors.
  const want = cfg.imageAbove ? above : below;
  if (sp.parent !== want) want.addChild(sp);
  below.visible = !cfg.imageAbove;
  above.visible = !!cfg.imageAbove;

  const b  = inst.frame.bounds;
  const tw = Math.max(1, sp.texture?.width  || 1);
  const th = Math.max(1, sp.texture?.height || 1);
  const sx = b.width / tw;
  const sy = b.height / th;
  const s  = cfg.imageFit === "cover"   ? Math.max(sx, sy)
           : cfg.imageFit === "contain" ? Math.min(sx, sy)
           : cfg.imageFit === "stretch" ? null
           : 1;
  sp.width  = (s === null ? b.width  : tw * s) * cfg.imageScale;
  sp.height = (s === null ? b.height : th * s) * cfg.imageScale;
  sp.position.set(b.x + b.width  / 2 + b.width  * cfg.imageOffsetX,
                  b.y + b.height / 2 + b.height * cfg.imageOffsetY);
  sp.alpha = cfg.imageAlpha;
}

/**
 * Drop the current image sprite.
 *
 * A *cached* texture is shared with every other viewscreen on the same file and
 * must survive — only a video texture, which this instance owns outright, is
 * paused and destroyed.
 */
function _releaseImage(inst, { keepSrc = false } = {}) {
  const sp = inst.imgSprite;
  if (sp) {
    if (inst.imgOwnsTexture) {
      try { game?.video?.getVideoSource?.(sp)?.pause?.(); } catch { /**/ }
    }
    try { sp.destroy({ texture: !!inst.imgOwnsTexture, baseTexture: !!inst.imgOwnsTexture }); }
    catch { /**/ }
  }
  inst.imgSprite = null;
  inst.imgTexture = null;
  inst.imgOwnsTexture = false;
  if (!keepSrc) inst.imgSrcLoaded = null;
}

/**
 * Turn the *animated* layers off or on without touching the container.
 *
 * The dark gate used to hide the whole container, which is no longer an option:
 * a backdrop image has to keep showing through it.
 *
 * **Every layer switched off here must have an owner that switches it back on**,
 * or the `false` is permanent and the effect never returns. That is not a
 * guideline — it is the bug this function shipped with: nothing owned
 * `envLayer.visible`, so turning off "Drift When Idle" once emptied the
 * environment pool for good, which for a tunnel is the entire effect. The owners:
 *
 *   starLayer   this function                  envLayer    _syncEnvLayer
 *   hazeLayer   _syncHaze                      grainLayer  _syncGrain
 *   wash        _syncWash                      coreLayer   _tickCore, per frame
 *   bloom       flashViewscreen  (transient)   boltLayer   _strikeBolts (transient)
 *
 * The four `_sync*` owners are re-run on the way back rather than second-guessed;
 * they are idempotent, which is what `refreshViewscreen` already relies on. The
 * two transient layers are deliberately left off — a burst and a lightning bolt
 * should reappear when something fires them, not because the lights came back.
 *
 * The backdrop colour and the two image layers are deliberately not touched.
 */
function _setFieldVisible(inst, on, cfg, env) {
  if (inst.starLayer) inst.starLayer.visible = on;
  if (on) {
    _syncEnvLayer(inst, env);
    _syncHaze(inst, cfg, env);
    _syncWash(inst, cfg, env);
    _syncGrain(inst, cfg, env);
    return;
  }
  if (inst.envLayer)   inst.envLayer.visible   = false;
  if (inst.hazeLayer)  inst.hazeLayer.visible  = false;
  if (inst.coreLayer)  inst.coreLayer.visible  = false;
  if (inst.grainLayer) inst.grainLayer.visible = false;
  if (inst.wash)       inst.wash.visible       = false;
  if (inst.bloom)      inst.bloom.visible      = false;
  if (inst.boltLayer)  inst.boltLayer.visible  = false;
}

/**
 * Soft coloured haze in the accent hue, anchored away from the vanishing point
 * so it sits behind the oncoming flow rather than washing out the point the
 * streaks emerge from.
 *
 * **Warp's descriptor is `count: 1, driftRate: 0`, and that is deliberate** —
 * those values reproduce the single static sprite this used to be, exactly, down
 * to the 0.2 alpha and the 1.7x scale. Environments with more than one blob fan
 * them either side of the same "away" direction and drift them in `_tickHaze`.
 */
function _syncHaze(inst, cfg, env) {
  const spec = env.haze;
  const on   = !!spec && cfg.nebula;
  inst.hazeLayer.visible = on;
  if (!on) return;

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

  const long = Math.max(b.width, b.height);
  const base = Math.atan2(dy, dx);

  for (let i = 0; i < inst.hazeSprites.length; i++) {
    const sp = inst.hazeSprites[i];
    const st = inst.hazeState[i];
    // A single blob sits exactly on the away vector, which is what keeps warp
    // identical; several fan out across a third of a turn either side of it.
    const spreadAng = spec.count > 1 ? (i / (spec.count - 1) - 0.5) * 2.1 : 0;
    const ang  = base + spreadAng;
    const dist = spec.count > 1 ? spec.offset * (0.6 + st.dist * 0.9) : spec.offset;

    st.baseX = cx + Math.cos(ang) * b.width  * dist;
    st.baseY = cy + Math.sin(ang) * b.height * dist;
    st.size  = long * spec.scale * (spec.count > 1 ? 0.55 + st.sizeVar * 0.8 : 1);

    sp.position.set(st.baseX, st.baseY);
    sp.width  = st.size;
    sp.height = st.size;
    sp.tint   = cfg.accentTint;
    sp.alpha  = spec.alpha * cfg.intensity * (spec.count > 1 ? 0.55 + st.alphaVar * 0.9 : 1);
  }
}

/** Grow or shrink the haze pool to the environment's blob count. */
function _resizeHaze(inst, env) {
  const want = env.haze?.count ?? 0;
  while (inst.hazeSprites.length > want) {
    inst.hazeState.pop();
    const sp = inst.hazeSprites.pop();
    try { sp.destroy(); } catch { /**/ }
  }
  while (inst.hazeSprites.length < want) {
    const sp = new PIXI.Sprite(inst.radialTex);
    sp.anchor.set(0.5);
    sp.blendMode = _addBlend();
    inst.hazeLayer.addChild(sp);
    inst.hazeSprites.push(sp);
    inst.hazeState.push({
      baseX: 0, baseY: 0, size: 0,
      // Rolled once so a drifting haze keeps its own identity rather than every
      // blob tracing the same circle.
      dist: Math.random(), sizeVar: Math.random(), alphaVar: Math.random(),
      phase: Math.random() * Math.PI * 2,
      rate:  0.6 + Math.random() * 0.8,
    });
  }
}

/**
 * The ambient colour over the whole region.
 *
 * Sits ABOVE the two particle pools rather than behind them, which is the only
 * position that actually washes the scene: painted underneath, it would tint the
 * backdrop and nothing else, which is indistinguishable from changing the
 * backdrop colour. Normal blend, not additive — an additive wash over a bright
 * field blows the whole viewscreen out.
 */
function _syncWash(inst, cfg, env) {
  const g = inst.wash;
  if (!g) return;
  const spec = env.wash;
  g.visible = !!spec && cfg.intensity > 0;
  if (!g.visible) return;
  const b = inst.frame.bounds;
  g.clear();
  _gFillRect(g, b.x - 8, b.y - 8, b.width + 16, b.height + 16, cfg.accentTint, 1);
  g.alpha = spec.alpha * cfg.intensity;
}

/**
 * Position the static layers over the region.
 *
 * The grain is TWO sprites, one directly above the other, so the rolling tear
 * can travel down the screen without leaving a gap at the top. A `TilingSprite`
 * would do the same in one object, but its constructor signature changed between
 * PIXI v7 and v8 and this file would need a shim for it; two plain sprites need
 * none. The scanline texture is built at the region's own height (see
 * `buildScanlineTexture`) so a plain horizontal stretch is exact.
 */
function _syncGrain(inst, cfg, env) {
  // Either the environment IS static, or the Interference field is laying it
  // over whatever else is being drawn. One resolved answer rather than a branch
  // here, so the overlay cannot drift from the environment it is made of.
  const g = _envGrain(env, cfg.interference, cfg.intensity);
  inst.grainLayer.visible = !!g;
  if (!g) return;

  // Built on first need rather than at attach, because Interference is an
  // ordinary look field: it can be dragged off zero at any time without the
  // reattach an environment change forces. Safe against the create-once rule
  // because the sprites go inside `grainLayer`, which was created up front and
  // never moves — appending to it can reorder nothing else.
  _buildGrainLayer(inst);
  if (!inst.grainSprites.length) return;

  const { spec, strength } = g;
  const b = inst.frame.bounds;
  for (const sp of inst.grainSprites) {
    sp.width  = b.width  + 16;
    sp.height = b.height + 16;
    sp.x      = b.x - 8;
    sp.alpha  = spec.alpha * strength;
    sp.tint   = cfg.accentTint;
  }
  inst.grainSprites[0].y = b.y - 8;
  inst.grainSprites[1].y = b.y - 8 - (b.height + 16);

  if (inst.scanSprite) {
    inst.scanSprite.visible = !!spec.scanlines;
    inst.scanSprite.position.set(b.x - 8, b.y - 8);
    inst.scanSprite.width  = b.width  + 16;
    inst.scanSprite.height = b.height + 16;
    inst.scanSprite.alpha  = 0.5 * strength;
  }
}

/**
 * Build the fixed layers once, bottom to top.
 *
 * They are created unconditionally and toggled with `visible` rather than being
 * created and destroyed as the options change — otherwise turning the backdrop
 * back on would re-append it *over* the stars, and correcting that needs child
 * index juggling that differs across PIXI majors.
 *
 * **The two particle pools live in their own sub-containers.** Before that, star
 * sprites were appended straight onto the root and only landed above the fixed
 * layers by accident of call order; with a container each, a pool can resize
 * without any re-append ever reordering anything. The order below is the whole
 * z-story:
 *
 *   backdrop → image → haze → stars → environment → wash → image → grain → bloom
 *
 * The image appears twice because it is one sprite with two possible parents:
 * `imageAbove` reparents it between them, so a picture can sit behind the stars
 * or cover them without anything else in the tree being reordered.
 *
 * The wash is above both pools because that is the only place it can actually
 * tint them, and the bloom is above everything because a flash is the brightest
 * thing on screen by definition.
 */
function _buildLayers(inst) {
  inst.backdrop = new PIXI.Graphics();
  inst.container.addChild(inst.backdrop);

  // The GM's backdrop picture, on the backdrop colour and under everything that
  // moves — a planet you are flying past. Its twin is below the wash.
  inst.imgBelow = _passThrough(new PIXI.Container());
  inst.imgBelow.visible = false;
  inst.container.addChild(inst.imgBelow);

  inst.radialTex = _buildRadialTexture();

  // The light at the end of a tunnel, below everything else because it sits at
  // the far end of one. Empty and free unless a tube environment asks for it.
  inst.coreLayer = _passThrough(new PIXI.Container());
  inst.coreLayer.visible = false;
  inst.container.addChild(inst.coreLayer);

  inst.hazeLayer = _passThrough(new PIXI.Container());
  inst.container.addChild(inst.hazeLayer);

  inst.starLayer = _passThrough(new PIXI.Container());
  inst.container.addChild(inst.starLayer);

  inst.envLayer = _passThrough(new PIXI.Container());
  inst.container.addChild(inst.envLayer);

  inst.wash = new PIXI.Graphics();
  inst.wash.visible = false;
  inst.container.addChild(inst.wash);

  // The other half of the backdrop-image pair, above the wash so an image drawn
  // over the field is not tinted by it, but below the grain and the bloom — a
  // screen breaking up should break up *over* the picture, and a flash is the
  // brightest thing on screen by definition. Both containers exist from the
  // start and never move; `imageAbove` reparents the one sprite between them.
  inst.imgAbove = _passThrough(new PIXI.Container());
  inst.imgAbove.visible = false;
  inst.container.addChild(inst.imgAbove);

  inst.grainLayer = _passThrough(new PIXI.Container());
  inst.grainLayer.visible = false;
  inst.container.addChild(inst.grainLayer);

  // The enter/exit starburst, built here rather than lazily on first flash. The
  // old lazy version landed above whatever stars existed at the time, so raising
  // the star count afterwards silently appended new sprites over it. Blend mode
  // is additive, so sitting above the field costs nothing when it is dark.
  inst.bloom = new PIXI.Sprite(inst.radialTex);
  inst.bloom.anchor.set(0.5);
  inst.bloom.blendMode = _addBlend();
  inst.bloom.alpha = 0;
  inst.bloom.visible = false;
  inst.container.addChild(inst.bloom);

  // Above the bloom, so the bolt's bright core reads against the discharge glow
  // rather than being washed out by it. Empty and free unless the environment
  // actually strikes — `_buildBoltPool` fills it on attach.
  inst.boltLayer = _passThrough(new PIXI.Container());
  inst.boltLayer.visible = false;
  inst.container.addChild(inst.boltLayer);
}

/**
 * The lightning pool.
 *
 * Built only for an environment that strikes, and sized to the largest strike it
 * can throw. Graphics are redrawn per *strike*, not per frame — between strikes
 * they are simply hidden, and the flicker moves alpha rather than re-tracing the
 * path, so a storm costs a redraw a second or two rather than sixty.
 */
function _buildBoltPool(inst, spec) {
  if (inst.bolts.length || !spec) return;
  for (let i = 0; i < Math.max(1, spec.max); i++) {
    const g = new PIXI.Graphics();
    g.blendMode = _addBlend();
    g.visible = false;
    inst.boltLayer.addChild(g);
    inst.bolts.push(g);
  }
}

/**
 * Draw one bolt: a wide soft pass, then a thin bright core over it.
 *
 * The same two-pass construction the engine trails use. One stroke at a single
 * width reads as a drawn line; the pair reads as something incandescent, because
 * that is roughly what an overexposed bright line actually does to a sensor.
 */
function _drawBolt(g, spec, core, glow, path) {
  g.clear();
  _strokePolyline(g, { width: spec.glowWidth, color: glow, alpha: 0.30 }, path.main);
  for (const b of path.branches) {
    _strokePolyline(g, { width: spec.glowWidth * 0.55, color: glow, alpha: 0.22 }, b);
  }
  _strokePolyline(g, { width: spec.width, color: core, alpha: 1 }, path.main);
  for (const b of path.branches) {
    _strokePolyline(g, { width: spec.width * 0.6, color: core, alpha: 0.85 }, b);
  }
}

/**
 * Throw one strike's worth of bolts through the point the flash lit.
 *
 * Each bolt is a full chord *through* the strike point rather than a line ending
 * at it, so it enters and leaves the frame like something arcing past the ship
 * instead of terminating politely inside the viewscreen. The mask clips the
 * overshoot for free, which is why the chord is simply made longer than the
 * region's diagonal and left alone.
 */
function _strikeBolts(inst, cfg, spec, at) {
  if (!inst.bolts.length) return;
  const b = inst.frame.bounds;
  const reach = Math.hypot(b.width, b.height) * 0.75;
  const core = _lighten(cfg.accentTint, 0.72);
  const glow = cfg.accentTint;
  const n = spec.min + ((Math.random() * (spec.max - spec.min + 1)) | 0);

  for (let i = 0; i < inst.bolts.length; i++) {
    const g = inst.bolts[i];
    if (i >= n) { g.visible = false; continue; }
    const ang = Math.random() * Math.PI * 2;
    const dx  = Math.cos(ang) * reach;
    const dy  = Math.sin(ang) * reach;
    // Struck through `at`, with the split between the two halves randomised so
    // the strike point is not always the midpoint of the bolt.
    const f = 0.3 + Math.random() * 0.4;
    const path = _buildLightningPath(
      at.x - dx * f, at.y - dy * f,
      at.x + dx * (1 - f), at.y + dy * (1 - f),
      spec,
    );
    _drawBolt(g, spec, core, glow, path);
    g.visible = true;
    g.alpha = 1;
  }
  inst.boltLayer.visible = true;
  inst.boltAge = 1;   // non-zero starts the flicker on the next tick
}

/** Build the static layers' sprites. Only ever called for a grain environment. */
function _buildGrainLayer(inst) {
  if (inst.grainSprites.length) return;
  inst.grainFrames = _buildGrainFrames(GRAIN_FRAME_COUNT);
  for (let i = 0; i < 2; i++) {
    const sp = new PIXI.Sprite(inst.grainFrames[0]);
    sp.blendMode = _addBlend();
    inst.grainLayer.addChild(sp);
    inst.grainSprites.push(sp);
  }
  const h = Math.max(8, Math.round(inst.frame.bounds.height + 16));
  inst.scanTex    = _buildScanlineTexture(h);
  inst.scanSprite = new PIXI.Sprite(inst.scanTex);
  inst.grainLayer.addChild(inst.scanSprite);
}

/** A GlowFilter on one layer, or none. Cosmetic, so every failure is swallowed. */
function _applyGlow(layer, strength, color) {
  try {
    for (const f of layer.filters ?? []) f?.destroy?.();
    layer.filters = [];
    if (!(strength > 0)) return;
    const GF = PIXI.filters?.GlowFilter ?? globalThis.PIXI?.filters?.GlowFilter;
    if (!GF) return;
    layer.filters = [new GF({
      distance: 5, outerStrength: strength, innerStrength: 0.15,
      color, quality: 0.2,
    })];
  } catch { /* cosmetic */ }
}

/**
 * Park the environment layer's transform for the shape it is drawing.
 *
 * A tube pivots on the vanishing point so `swirl` rolls the wall about the axis
 * of travel rather than about the canvas origin. Setting pivot equal to position
 * is the identity transform, so children stay exactly where the projection put
 * them and only the rotation does anything.
 *
 * Called on attach and on refresh rather than per frame: the vanishing point only
 * moves when the GM moves it, and a box environment resets the transform so a
 * switch away from a tunnel cannot leave the pool rolled over.
 */
function _syncEnvLayer(inst, env) {
  const layer = inst.envLayer;
  if (!layer) return;
  // **This function owns `envLayer.visible`**, exactly as `_syncHaze`,
  // `_syncWash` and `_syncGrain` own theirs. It has to: the dark gate switches
  // the animated layers off individually now that a backdrop image can outlive
  // it, and it puts them back by re-running each layer's own sync. While nothing
  // here claimed `visible`, that `false` was never undone — so turning off
  // "Drift When Idle" permanently emptied the environment pool, which for a
  // tunnel is the entire effect. Always true: an environment with no pool leaves
  // the container empty, and an empty container costs nothing.
  layer.visible = true;
  if (env.particle?.shape === "tube") {
    const vp = inst.frame.vp;
    layer.pivot.set(vp.x, vp.y);
    layer.position.set(vp.x, vp.y);
  } else {
    layer.pivot.set(0, 0);
    layer.position.set(0, 0);
    layer.rotation = 0;
    layer.alpha = 1;
  }
}

/** The core sprite, built on first need for a tube that asks for one. */
function _buildCoreSprite(inst) {
  if (inst.core) return;
  inst.core = new PIXI.Sprite(inst.radialTex);
  inst.core.anchor.set(0.5);
  inst.core.blendMode = _addBlend();
  inst.core.visible = false;
  inst.coreLayer.addChild(inst.core);
}

/**
 * The light at the far end of the tunnel.
 *
 * Pinned to the (shaken) vanishing point and driven by the same ramp as the
 * aperture, so it brightens and swells as the tunnel opens. Its own slow pulse
 * keeps it from reading as a static decal on the backdrop.
 */
function _tickCore(inst, cfg, env, ramp, vpx, vpy) {
  const spec = env.particle?.core;
  if (!spec) {
    if (inst.coreLayer) inst.coreLayer.visible = false;
    return;
  }
  _buildCoreSprite(inst);
  inst.coreLayer.visible = true;

  const b     = inst.frame.bounds;
  const open  = APERTURE_MIN + (1 - APERTURE_MIN) * ramp;
  const pulse = spec.pulseMs
    ? 1 + 0.12 * Math.sin((inst.envAge / spec.pulseMs) * Math.PI * 2)
    : 1;
  const size  = Math.min(b.width, b.height) * spec.size * (0.4 + 0.6 * open) * pulse;

  inst.core.position.set(vpx, vpy);
  inst.core.width  = size;
  inst.core.height = size;
  inst.core.tint   = cfg.accentTint;
  inst.core.alpha  = spec.alpha * cfg.intensity * (0.25 + 0.75 * ramp);
  // Built hidden, like every other lazily-created sprite here; showing the
  // container is not enough.
  inst.core.visible = true;
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
  const env   = getEnvironment(cfg.environment);
  const frame = _resolveFrame(region, cfg);
  if (!frame) return;

  const mask = _buildMask(region);
  if (!mask) return;

  const zNear = _zNear(cfg);

  const container = _passThrough(new PIXI.Container());
  container.zIndex = cfg.aboveTokens ? VFX_Z_BASE : -VFX_Z_BASE;
  container.addChild(mask);
  container.mask = mask;
  layer.addChild(container);

  const inst = {
    uuid:        behavior.uuid,
    behavior,
    region,
    container,
    mask,
    backdrop:    null,
    wash:        null,
    hazeLayer:   null,
    starLayer:   null,
    envLayer:    null,
    grainLayer:  null,
    texture:     _buildStreakTexture(),
    radialTex:   null,
    envTextures: [],
    grainFrames: [],
    scanTex:     null,
    scanSprite:  null,
    bloom:       null,
    bloomAge:    0,
    stars:       [],
    sprites:     [],
    envParticles: [],
    envSprites:   [],
    hazeSprites:  [],
    hazeState:    [],
    grainSprites: [],
    coreLayer:    null,
    core:         null,
    boltLayer:    null,
    bolts:        [],
    boltAge:      0,
    palette:        _buildPalette(cfg.starTint, cfg.accentTint, cfg.variety),
    paletteBase:    cfg.starTint,
    paletteAccent:  cfg.accentTint,
    paletteVariety: cfg.variety,
    accentTint:  cfg.accentTint,
    envId:       cfg.environment,
    zNear:       zNear,
    spread:      (frame.radius * zNear) / FOCAL,
    frame,
    aboveTokens: cfg.aboveTokens,
    last:        performance.now(),
    dark:        false,
    imgBelow:       null,
    imgAbove:       null,
    imgSprite:      null,
    imgTexture:     null,
    imgSrcLoaded:   null,
    // True only for a video, which this instance owns outright. An image texture
    // comes from the shared cache and must outlive the instance.
    imgOwnsTexture: false,
    darkKeepsImage: false,
    finished:    false,
    tick:        null,
    // Ambient state. All of it decays or advances on its own; none of it is
    // replicated, because every client derives the same look from `phaseAt`.
    shakeX:      0,
    shakeY:      0,
    strobeIn:    0,
    grainIn:     0,
    grainIdx:    0,
    grainRoll:   0,
    washAge:     0,
    envAge:      0,
  };

  _buildLayers(inst);

  // One soft glow pass over the field rather than a filter per star — the same
  // reasoning as the transporter mote rain. Kept weak: the filter carries a
  // single colour, so leaning on it would flatten the per-star hues back out.
  //
  // It is on the STAR layer, not the root. An asteroid field draws on normal
  // blend and must not be glowed at all, and a root filter would catch it.
  _applyGlow(inst.starLayer, 0.7, cfg.starTint);
  if (env.particle?.glow > 0) _applyGlow(inst.envLayer, env.particle.glow, cfg.accentTint);

  if (env.particle) inst.envTextures = _buildEnvTextures(env.particle.texture);
  if (env.grain || cfg.interference > 0) _buildGrainLayer(inst);
  const attachStrobe = _envStrobe(env, cfg.lightning, cfg.intensity);
  if (attachStrobe?.spec?.bolt) _buildBoltPool(inst, attachStrobe.spec.bolt);

  _syncEnvLayer(inst, env);
  _syncBackdrop(inst, cfg);
  _syncImage(inst, cfg);
  _resizeHaze(inst, env);
  _syncHaze(inst, cfg, env);
  _syncWash(inst, cfg, env);
  _syncGrain(inst, cfg, env);
  _resizePool(inst, _starCount(cfg));
  _resizeEnvPool(inst, _envCount(cfg, env), env);
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
  // Before the container goes: a video texture is this instance's own and has to
  // be paused and released, while an *image* texture is shared through
  // `_imageTextureCache` and must outlive it.
  _releaseImage(inst);
  try { inst.container.mask = null; } catch { /**/ }
  // Filters survive destroy({children:true}) — they have to go explicitly, and
  // there is now one per particle layer rather than one on the root.
  for (const layer of [inst.container, inst.starLayer, inst.envLayer]) {
    try {
      for (const f of layer?.filters ?? []) f?.destroy?.();
      if (layer) layer.filters = [];
    } catch { /**/ }
  }
  try { inst.container.destroy({ children: true }); } catch { /**/ }
  try { inst.texture?.destroy?.(true); } catch { /**/ }
  try { inst.radialTex?.destroy?.(true); } catch { /**/ }
  try { inst.scanTex?.destroy?.(true); } catch { /**/ }
  for (const t of inst.envTextures ?? []) { try { t?.destroy?.(true); } catch { /**/ } }
  for (const t of inst.grainFrames ?? []) { try { t?.destroy?.(true); } catch { /**/ } }
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
  // The bounds moved, so everything positioned against them has to follow.
  const cfg = _readConfig(inst.behavior);
  const env = getEnvironment(cfg.environment);
  _syncEnvLayer(inst, env);
  _syncBackdrop(inst, cfg);
  _syncImage(inst, cfg);
  _syncHaze(inst, cfg, env);
  _syncWash(inst, cfg, env);
  // The scanline texture is baked at the region's height, so a reshape needs a
  // new one rather than a stretch of the old.
  if (env.grain && inst.scanSprite) {
    const h = Math.max(8, Math.round(inst.frame.bounds.height + 16));
    const old = inst.scanTex;
    inst.scanTex = _buildScanlineTexture(h);
    inst.scanSprite.texture = inst.scanTex;
    try { old?.destroy?.(true); } catch { /**/ }
  }
  _syncGrain(inst, cfg, env);
  // Every sync above sets its own layer's visibility, which would quietly undo
  // the dark gate for a viewscreen only still alive because it is showing a
  // backdrop image. Re-assert it.
  if (inst.dark) _setFieldVisible(inst, false, cfg, env);
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
 * only handles the ones needing structural work: pool sizes, glow colour,
 * z-order side, and the vanishing point moving.
 *
 * A change of *environment* is structural in a way none of the others are — it
 * swaps textures, blend modes and which layers exist at all — so it takes the
 * one branch that reattaches wholesale. `attachViewscreen` is idempotent, which
 * is what makes that a single line rather than a list of which fields matter.
 */
export function refreshViewscreen(behavior) {
  const inst = _instances.get(behavior?.uuid);
  if (!inst || inst.finished) return;
  inst.behavior = behavior;
  const cfg = _readConfig(behavior);

  if (cfg.environment !== inst.envId) {
    attachViewscreen({ behavior, region: inst.region });
    return;
  }
  const env = getEnvironment(cfg.environment);

  _refreshFrame(inst);
  if (cfg.starTint !== inst.paletteBase || cfg.accentTint !== inst.paletteAccent
      || cfg.variety !== inst.paletteVariety) {
    inst.paletteBase    = cfg.starTint;
    inst.paletteAccent  = cfg.accentTint;
    inst.paletteVariety = cfg.variety;
    _applyPalette(inst, cfg);
  }
  inst.accentTint = cfg.accentTint;

  _syncEnvLayer(inst, env);
  _syncBackdrop(inst, cfg);
  _syncImage(inst, cfg);
  _resizeHaze(inst, env);
  _syncHaze(inst, cfg, env);
  _syncWash(inst, cfg, env);
  _syncGrain(inst, cfg, env);
  _resizePool(inst, _starCount(cfg));
  _resizeEnvPool(inst, _envCount(cfg, env), env);

  const wantZ = cfg.aboveTokens ? VFX_Z_BASE : -VFX_Z_BASE;
  if (inst.container.zIndex !== wantZ) inst.container.zIndex = wantZ;
  inst.aboveTokens = cfg.aboveTokens;

  try {
    const f = inst.starLayer.filters?.[0];
    if (f && "color" in f) f.color = cfg.starTint;
    const ef = inst.envLayer.filters?.[0];
    if (ef && "color" in ef) ef.color = cfg.accentTint;
  } catch { /**/ }

  // Every sync above sets its own layer's visibility, which would quietly undo
  // the dark gate for a viewscreen only still alive because it is showing a
  // backdrop image. Re-assert it.
  if (inst.dark) _setFieldVisible(inst, false, cfg, env);
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

/** The environment id this behavior is configured for, for the sound layer. */
export function viewscreenEnvironmentId(behavior) {
  const s = behavior?.system ?? {};
  return isEnvironmentId(s.environment) ? s.environment : DEFAULT_ENVIRONMENT;
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
  inst.bloom.tint    = 0xffffff;
  inst.bloom.alpha   = 0;
  inst.bloom.visible = true;
  inst.bloomAge      = 1;   // non-zero starts the rise on the next tick
}

/**
 * One lightning discharge, somewhere in the region.
 *
 * Shares the starburst's sprite and decay: both are "a bright flash inside the
 * mask", and the only differences are where, how big and what colour. Sharing
 * means a storm never has two flash sprites fighting over the same frames, and
 * it costs nothing — a strobe simply repositions the sprite the starburst is
 * not currently using.
 */
function _fireStrobe(inst, cfg, spec, strength) {
  if (!inst.bloom) return;
  const b = inst.frame.bounds;
  const size = Math.min(b.width, b.height) * spec.scale;
  // One point drives both halves of the strike, so the discharge glow sits on
  // the bolt rather than somewhere else on the screen.
  const at = { x: b.x + Math.random() * b.width, y: b.y + Math.random() * b.height };
  inst.bloom.position.set(at.x, at.y);
  inst.bloom.width   = size;
  inst.bloom.height  = size;
  // Mostly the charge colour, occasionally a white core, so the storm is not one
  // repeating note.
  inst.bloom.tint    = Math.random() < 0.3 ? 0xffffff : _lighten(cfg.accentTint, 0.35);
  inst.bloom.alpha   = 0;
  inst.bloom.visible = true;
  inst.bloomAge      = 1;

  if (spec.bolt) _strikeBolts(inst, cfg, spec.bolt, at);

  // The kick this flash gives the camera. Peak amplitude only — it decays from
  // here and is never added to, so repeated strobes cannot accumulate into an
  // ever-worsening shake.
  const kick = spec.shakePx * strength;
  inst.shakeX = (Math.random() * 2 - 1) * kick;
  inst.shakeY = (Math.random() * 2 - 1) * kick;
}

/**
 * Fade and flicker the bolts currently in the air.
 *
 * Alpha only — the paths are not re-traced. A real bolt does not fade smoothly;
 * it stutters as the channel re-strikes, so the linear decay carries a cosine
 * flutter on top of it. The flutter never reaches zero, because a bolt that
 * blinks fully out and back reads as a dropped frame.
 */
function _tickBolts(inst, cfg, env, dt) {
  const spec = _envStrobe(env, cfg.lightning, cfg.intensity)?.spec?.bolt;
  if (!spec || inst.boltAge <= 0) return;
  inst.boltAge += dt;
  const t = inst.boltAge / spec.lifeMs;
  if (t >= 1) {
    inst.boltAge = 0;
    inst.boltLayer.visible = false;
    for (const g of inst.bolts) g.visible = false;
    return;
  }
  const flutter = 0.62 + 0.38 * Math.abs(Math.cos(t * Math.PI * spec.flickers));
  inst.boltLayer.alpha = (1 - t) * flutter;
}

/** Hide any bolt in flight — the counterpart to `_clearBloom`. */
function _clearBolts(inst) {
  inst.boltAge = 0;
  if (!inst.boltLayer) return;
  inst.boltLayer.visible = false;
  for (const g of inst.bolts) g.visible = false;
}

// ── The frame ────────────────────────────────────────────────────────────────

/** The star field. Unchanged from the single-environment version but for `env`. */
function _tickStars(inst, cfg, env, dt, ramp, speed, vpx, vpy) {
  const { stars, sprites } = inst;
  if (!stars.length) return;

  const zNear   = inst.zNear;
  const radius  = inst.frame.radius;
  const dir     = cfg.inbound ? 1 : -1;   // outbound drives z toward the near plane
  const cull    = radius * 1.35;
  // Ceiling on a single streak. Loose enough that the longest cross most of the
  // viewscreen, tight enough that none of them span it end to end.
  const maxLen  = radius * 1.5;
  // Stretch only climbs with the ramp, so sublight stays a field of points.
  const stretch = 1 + WARP_STRETCH * ramp;

  for (let i = 0; i < stars.length; i++) {
    const star = stars[i];
    const sp   = sprites[i];

    star.z += dir * speed * dt;

    // Recycle at whichever plane this direction of travel exits through.
    if (dir < 0 && star.z <= zNear)      { _seedStar(inst, star, Z_FAR); sp.tint = star.tint; }
    else if (dir > 0 && star.z >= Z_FAR) { _seedStar(inst, star, zNear); sp.tint = star.tint; }

    const k  = FOCAL / star.z;
    const sx = vpx + star.x * k;
    const sy = vpy + star.y * k;
    const rd = Math.hypot(sx - vpx, sy - vpy);

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
}

/**
 * The environment's own pool, through the same camera as the stars.
 *
 * Two things differ from `_tickStars`, and both come straight off the
 * descriptor. Size follows depth scaled by `growMul`, which is what makes a
 * cloud loom and a star not; and rotation goes to **either** the direction of
 * travel (when the particle smears) **or** its own tumble — never both, because
 * a sprite has one rotation. See the note on the ParticleSpec typedef.
 *
 * Scale is written through `sprite.scale` rather than `width`/`height` because
 * the latter repeats a divide by the texture size on every sprite every frame,
 * which is the optimisation scene-warp-vfx.js already documents.
 */
function _tickEnv(inst, cfg, env, dt, ramp, speed, vpx, vpy) {
  const spec = env.particle;
  const { envParticles: parts, envSprites: sprites } = inst;
  if (!spec || !parts.length) return;

  const zNear  = inst.zNear;
  const radius = inst.frame.radius;
  const dir    = cfg.inbound ? 1 : -1;
  const cull   = radius * 1.35;
  const maxLen = radius * 1.5;
  const smears = spec.stretchMul > 0;
  const stretch = 1 + WARP_STRETCH * ramp * spec.stretchMul;
  const range  = spec.sizeMax - spec.sizeMin;
  // A particle's whole life is one traversal of the depth range, so this is the
  // only lever on how long it stays on screen. Clouds run at a third of the star
  // speed and therefore last three times as long.
  const envSpeed = speed * (spec.speedMul ?? 1);
  const churn = spec.churn ?? 0;

  // ── The tunnel, if this is one ───────────────────────────────────────────
  // `open` is the aperture: the tube's whole radius scaled by the phase ramp, so
  // entering blooms it out of a point and dropping out collapses it back. That
  // beat costs no new document field, no timer and no socket — it rides the ramp
  // every client already derives from `phaseAt`, so someone joining mid-transit
  // lands at the right dilation like everything else here.
  //
  // The floor is not cosmetic: at a true zero every particle in the pool lands on
  // one pixel and a few hundred additive sprites stack into a blinding dot.
  const tube  = spec.shape === "tube";
  const open  = tube ? APERTURE_MIN + (1 - APERTURE_MIN) * ramp : 1;
  const flare = tube ? (spec.flare ?? 0) : 0;
  if (tube) {
    // Fade with the aperture too, for the same reason the floor exists.
    inst.envLayer.alpha = Math.min(1, 0.12 + ramp * 0.88);
    // The roll goes on the CONTAINER, never the sprites: their one rotation is
    // already claimed by the smear. See the `swirl` note in the registry for why
    // this keeps every streak radially aligned rather than skewing it.
    if (spec.swirl) {
      inst.envLayer.rotation +=
        ((spec.swirl * Math.PI) / 180 / 1000) * dt * cfg.intensity;
    }
  } else if (inst.envLayer.alpha !== 1) {
    inst.envLayer.alpha = 1;
  }

  for (let i = 0; i < parts.length; i++) {
    const p  = parts[i];
    const sp = sprites[i];

    p.z += dir * envSpeed * dt;

    if (dir < 0 && p.z <= zNear)      { _seedEnvParticle(inst, p, Z_FAR, spec); sp.tint = _envTint(inst, spec, p); }
    else if (dir > 0 && p.z >= Z_FAR) { _seedEnvParticle(inst, p, zNear, spec); sp.tint = _envTint(inst, spec, p); }

    // Depth is resolved before the projection rather than after it, because the
    // flare needs it: a tube widens toward the viewer, which is a scalar on
    // (x, y) that varies with depth. For a box environment `f` is exactly 1 and
    // the projection is unchanged.
    const depth = 1 - (p.z - zNear) / (Z_FAR - zNear);
    const f  = tube ? (1 + flare * depth) * open : 1;
    const k  = FOCAL / p.z;
    const sx = vpx + p.x * f * k;
    const sy = vpy + p.y * f * k;

    if (Math.hypot(sx - vpx, sy - vpy) > cull) {
      _seedEnvParticle(inst, p, dir < 0 ? Z_FAR : zNear, spec);
      sp.tint  = _envTint(inst, spec, p);
      sp.alpha = 0;
      continue;
    }

    // `growMul` is how much of the far-to-near size range the particle actually
    // uses. At 1 a cloud swells across the whole of it; at 0.35 a storm mote
    // grows only slightly and reads as small and fast rather than as looming.
    const size  = (spec.sizeMin + range * depth * spec.growMul) * p.sizeVar;
    const texW  = sp.texture?.width  || 1;
    const texH  = sp.texture?.height || 1;

    sp.position.set(sx, sy);
    sp.alpha = spec.alphaFar + (spec.alphaNear - spec.alphaFar) * depth;

    // Billow. Alpha here is already a per-frame write, so the wobble is free,
    // and it is what stops a slow-turning cloud reading as an inert cut-out —
    // the sprite has no internal animation of its own.
    let billow = 1;
    if (churn) {
      const w = Math.sin(p.churnPhase + inst.envAge * p.churnRate);
      sp.alpha *= 1 + churn * w;
      billow = 1 + churn * 0.8 * w;
    }

    if (smears) {
      let len = 0;
      if (p.px !== null) {
        len = Math.hypot(sx - p.px, sy - p.py) * stretch * cfg.streakMul;
        if (len > maxLen) len = maxLen;
      }
      // Anchored centrally, so the smear grows both ways from the particle — on
      // a symmetric glow that is indistinguishable from a trailing one and needs
      // no second anchor mode.
      sp.scale.set(Math.max(size, len) / texW, size / texH);
      sp.rotation = (p.px !== null && len > size)
        ? Math.atan2(sy - p.py, sx - p.px)
        : 0;
    } else {
      // Eccentric and billowing on one axis only, so the shape shifts rather
      // than merely pulsing in size.
      sp.scale.set((size * p.ax) / texW, (size * p.ay * billow) / texH);
      if (p.spin) { p.rot += p.spin * dt; sp.rotation = p.rot; }
    }

    p.px = sx;
    p.py = sy;
  }
}

/** Rock takes the flat accent; anything additive takes a palette colour. */
function _envTint(inst, spec, p) {
  return spec.blend === "normal" ? inst.accentTint : p.tint;
}

/**
 * Drift the haze blobs.
 *
 * A no-op for warp, whose descriptor sets `driftRate: 0` — that is what keeps
 * the old static sprite bit-identical. Motion is a slow Lissajous around the
 * position `_syncHaze` computed, never a re-derivation of it, so a drifting blob
 * still sits where the geometry says it should.
 */
function _tickHaze(inst, cfg, env, dt) {
  const spec = env.haze;
  if (!spec || !spec.driftRate || !inst.hazeLayer.visible) return;
  for (let i = 0; i < inst.hazeSprites.length; i++) {
    const sp = inst.hazeSprites[i];
    const st = inst.hazeState[i];
    st.phase += (dt / 1000) * spec.driftRate * st.rate;
    const amp = st.size * 0.16;
    sp.position.set(
      st.baseX + Math.cos(st.phase) * amp,
      st.baseY + Math.sin(st.phase * 0.73) * amp,
    );
  }
}

/** Breathe the ambient wash. `pulseMs` of 0 holds it flat, as static wants. */
function _tickWash(inst, cfg, env, dt) {
  const spec = env.wash;
  if (!spec || !inst.wash?.visible) return;
  const base = spec.alpha * cfg.intensity;
  if (!spec.pulseMs) { inst.wash.alpha = base; return; }
  inst.washAge += dt;
  const t = (inst.washAge % spec.pulseMs) / spec.pulseMs;
  // ±25% around the configured alpha — enough to read as alive, not as flicker.
  inst.wash.alpha = base * (0.75 + 0.25 * (1 + Math.sin(t * Math.PI * 2)));
}

/**
 * Schedule and fire the lightning.
 *
 * Either the environment owns a discharge (the ion storm) or the Lightning field
 * has switched one on over it — one resolved answer, so nothing here branches on
 * which. The bolt pool is built on first need for the same reason the grain is:
 * Lightning is an ordinary look field that can be dragged off zero at any time,
 * and `boltLayer` was created up front so appending to it reorders nothing.
 */
function _tickStrobe(inst, cfg, env, dt) {
  const s = _envStrobe(env, cfg.lightning, cfg.intensity);
  if (!s || s.strength <= 0) return;
  const { spec, strength } = s;
  inst.strobeIn -= dt;
  if (inst.strobeIn > 0) return;
  if (spec.bolt) _buildBoltPool(inst, spec.bolt);
  _fireStrobe(inst, cfg, spec, strength);
  // Violence shortens the gaps as well as raising the kick, so one control is
  // one idea rather than two half-connected ones.
  inst.strobeIn = (spec.minMs + Math.random() * (spec.maxMs - spec.minMs))
                / Math.max(0.15, strength);
}

/** Advance the static: step the noise frame, roll the tear down the screen. */
function _tickGrain(inst, cfg, env, dt) {
  const spec = _envGrain(env, cfg.interference, cfg.intensity)?.spec;
  if (!spec || !inst.grainLayer.visible || !inst.grainSprites.length) return;

  inst.grainIn -= dt;
  if (inst.grainIn <= 0) {
    // Stepping by 2 rather than 1 means a six-frame loop takes three cycles to
    // repeat, which is long enough that the eye stops finding the pattern.
    inst.grainIdx = (inst.grainIdx + 2) % inst.grainFrames.length;
    const tex = inst.grainFrames[inst.grainIdx];
    for (const sp of inst.grainSprites) sp.texture = tex;
    inst.grainIn = 1000 / Math.max(1, spec.fps);
  }

  if (spec.rollRate) {
    const h = inst.frame.bounds.height + 16;
    inst.grainRoll = (inst.grainRoll + (dt / 1000) * spec.rollRate * h) % h;
    const top = inst.frame.bounds.y - 8;
    inst.grainSprites[0].y = top + inst.grainRoll;
    inst.grainSprites[1].y = top + inst.grainRoll - h;
  }
}

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

  // Read each of these exactly once per frame and pass them down, rather than
  // letting each layer fetch its own.
  const cfg    = _readConfig(inst.behavior);
  const env    = getEnvironment(cfg.environment);
  const timing = getViewscreenTiming();
  const ramp   = _rampFactor(cfg, timing);

  const zNear = inst.zNear;
  const sub   = _sublightSpeed(cfg, zNear);
  const warp  = _warpSpeed(cfg.warpFactor, zNear);
  let speed   = (sub + (warp - sub) * ramp) * timing.speedMul;

  // An environment that persists at rest still needs its particles moving: a
  // storm with a frozen field of motes reads as a paused game, not as a ship
  // holding station in bad weather.
  if (env.restAmbient && speed <= 0) {
    speed = ((Z_FAR - zNear) / SUBLIGHT_TRAVEL_MS) * 0.6 * timing.speedMul;
  }

  // With drift switched off there is nothing to animate at rest, and leaving the
  // field parked would show a frozen starfield rather than the dark viewscreen
  // the option promises. Hide it outright and skip the whole loop.
  //
  // `restAmbient` is the exception, and the reason the term is here rather than
  // in the caller: an ion storm or a dead screen is not something the ship stops
  // being in when it stops moving. Interference is the same argument from the
  // other direction — a GM who has deliberately broken the screen wants to see
  // it break, not to see it switched off because the ship happens to be parked.
  const dark = !cfg.sublightDrift && ramp <= 0
            && !env.restAmbient && cfg.interference <= 0;
  // A backdrop image is the one thing that survives going dark: a GM who has set
  // the viewscreen to show a planet with drift switched off wants to see the
  // planet, not a black rectangle. The field still stops — only the image and
  // the backdrop colour behind it stay lit, so the container cannot simply be
  // hidden and the animated layers go off individually instead.
  const keepImage = dark && !!cfg.imageSrc;
  if (dark !== inst.dark || keepImage !== inst.darkKeepsImage) {
    inst.dark = dark;
    inst.darkKeepsImage = keepImage;
    inst.container.visible = !dark || keepImage;
    _setFieldVisible(inst, !dark, cfg, env);
    // Coming back from dark, drop the stale previous projections — otherwise
    // every star draws one clamped full-length streak on the first frame.
    if (!dark) {
      for (const star of inst.stars) { star.px = null; star.py = null; }
      for (const p of inst.envParticles) { p.px = null; p.py = null; }
    }
    // Going dark mid-burst would freeze it half-lit and show it again on the way
    // back, since the loop below stops running.
    if (dark) { _clearBloom(inst); _clearBolts(inst); }
  }
  if (dark) return;

  // The shake decays toward zero on its own and is only ever *set* by a strobe,
  // never added to. Exponential in dt so the settle looks the same at any frame
  // rate.
  if (inst.shakeX || inst.shakeY) {
    const decay = Math.exp(-dt / SHAKE_DECAY_MS);
    inst.shakeX *= decay;
    inst.shakeY *= decay;
    if (Math.abs(inst.shakeX) < 0.05) inst.shakeX = 0;
    if (Math.abs(inst.shakeY) < 0.05) inst.shakeY = 0;
  }
  const vpx = inst.frame.vp.x + inst.shakeX;
  const vpy = inst.frame.vp.y + inst.shakeY;

  inst.envAge += dt;
  _tickStars(inst, cfg, env, dt, ramp, speed, vpx, vpy);
  _tickEnv(inst, cfg, env, dt, ramp, speed, vpx, vpy);
  _tickCore(inst, cfg, env, ramp, vpx, vpy);
  _tickHaze(inst, cfg, env, dt);
  _tickWash(inst, cfg, env, dt);
  _tickStrobe(inst, cfg, env, dt);
  _tickBolts(inst, cfg, env, dt);
  _tickGrain(inst, cfg, env, dt);

  // Starburst rise and decay — shared by the enter/exit flash and the storm.
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
