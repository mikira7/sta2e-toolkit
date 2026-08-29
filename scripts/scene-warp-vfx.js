/**
 * sta2e-toolkit | scene-warp-vfx.js
 * Scene Warp — the top-down travel renderer.
 *
 * Parallel streaks running across the whole scene, so a tactical map can be
 * fought over while the ships are at warp — or while they push through a nebula,
 * an ion storm or an asteroid field, from the table in
 * [viewscreen-environments.js](viewscreen-environments.js). State lives in
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
 * ## How an environment gets in
 *
 * **Bands stay exactly as tuned; only the material they are built from changes.**
 * An environment with a particle spec contributes a second set of bands beside
 * the star ones — same depth definitions, same containers, same thinning — and
 * each band is one of two kinds:
 *
 *  - `streak` — stars, and anything with `stretchMul > 0`. Length and thickness
 *    are constant across the band, so they resolve to one scale pair per band
 *    and the deadband below elides almost every write.
 *  - `tumble` — anything with `tumbleDeg`. Size is constant for a particle's
 *    life so it is written at seed; only rotation moves per frame.
 *
 * ## What it deliberately does not do
 *
 * **No backdrop fill.** Unlike the viewscreen this overlays your existing map
 * art rather than replacing it, so there is no `_syncBackdrop` equivalent — the
 * field is transparent between the stars and simply hides itself when idle. The
 * environment wash is additive and low-alpha for the same reason.
 *
 * **`restAmbient` does not defeat `_sleep` here.** On the viewscreen an ion storm
 * keeps crackling at rest; on a whole tactical map that would mean a scene merely
 * *configured* for a storm never releasing its ticker. Persistence on this
 * surface is what the `drift` switch is for, and the dark gate is unchanged.
 */

import {
  VFX_Z_BASE,
  PALETTE_SIZE,
  addBlend,
  effectLayer,
  parseHexColor,
  buildPalette,
  buildStreakTexture,
  buildRadialTexture,
  buildCloudTexture,
  buildStormCloudTexture,
  buildRockTexture,
  buildMoteTexture,
  buildWispTexture,
  gFillRect,
  lighten,
  strokePolyline,
  buildLightningPath,
} from "./starfield-common.js";
import {
  getSceneWarp,
  hasSceneWarp,
  getSceneWarpTiming,
  getSceneWarpQuality,
  scenePhaseFrom,
} from "./scene-warp.js";
import { getEnvironment, environmentHaze, environmentStrobe } from "./viewscreen-environments.js";

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
//
// Environments scale THIS, they never replace it — see the multiplier rule in
// the header of viewscreen-environments.js, which is exactly why the two
// surfaces can keep different values here.
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

// The `thick` range across BANDS, used to turn a band into a 0..1 depth for
// environment particle sizing. Derived rather than written out so that retuning
// a band cannot silently desync the two.
const BAND_THICK_MIN = 0.72;
const BAND_THICK_MAX = 1.70;

// How fast a course change swings the field round, in radians per ms.
const COURSE_SLEW_RAD_MS = Math.PI / 1400;   // ~1.4s for a 180° reversal

// Share of the field still drawn while 3D dice are on screen. See the
// dice-coordination block near the bottom of this file.
const DICE_THIN_FRAC = 0.25;

// Relative tolerance below which a streak-length change is not worth writing to
// every sprite in the band. See the note at its use in _tick.
const SCALE_DEADBAND = 0.03;

// Hard ceiling on an environment pool. A cloud sprite is orders of magnitude
// more fill than a hairline streak, so the density setting's own limit is far
// too generous once multiplied through `countMul`.
const ENV_POOL_MAX = 320;

// Texture variants per environment, and the flash decay shared by the storm.
const CLOUD_VARIANTS = 4;
const ROCK_VARIANTS  = 5;
const BLOOM_RISE_MS  = 130;
const BLOOM_FALL_MS  = 520;
const BLOOM_PEAK     = 0.55;   // gentler than the viewscreen's — this is over a map

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

/** A band definition as a 0..1 depth, for sizing environment particles. */
function _bandDepth(def) {
  const t = (def.thick - BAND_THICK_MIN) / (BAND_THICK_MAX - BAND_THICK_MIN);
  return Math.min(1, Math.max(0, t));
}

/**
 * The textures one environment's pool draws from.
 *
 * The registry names a texture by **string key** rather than handing over a
 * builder, which is what lets it stay a leaf that imports neither PIXI nor this
 * module. Resolving the key is therefore each renderer's own job.
 */
function _buildEnvTextures(key) {
  switch (key) {
    case "cloud":      return Array.from({ length: CLOUD_VARIANTS }, () => buildCloudTexture());
    case "stormCloud": return Array.from({ length: CLOUD_VARIANTS }, () => buildStormCloudTexture());
    case "rock":  return Array.from({ length: ROCK_VARIANTS },  () => buildRockTexture());
    case "wisp":  return Array.from({ length: CLOUD_VARIANTS }, () => buildWispTexture());
    case "mote":  return [buildMoteTexture()];
    case "streak":return [buildStreakTexture()];
    default:      return [buildRadialTexture()];
  }
}

// ── Build ────────────────────────────────────────────────────────────────────

/**
 * One masked outer + rotated inner pair at a given depth relative to tokens.
 *
 * `pre` and `post` sit either side of the rotated inner container, in canvas
 * space: the haze belongs there rather than inside `inner` because a cloud bank
 * has no business swinging round the map when the fleet changes course, and the
 * wash has to be above the bands to tint them at all.
 */
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

  const pre = _inert(new PIXI.Container());
  outer.addChild(pre);

  const inner = _inert(new PIXI.Container());
  inner.position.set(frame.centre.x, frame.centre.y);
  outer.addChild(inner);

  const post = _inert(new PIXI.Container());
  outer.addChild(post);

  layer.addChild(outer);
  return { outer, inner, pre, post, mask };
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
 * The same for one environment particle on a `tumble` band.
 *
 * Size as well as tint and alpha is written here rather than per frame: without
 * a z axis on this surface a particle's depth is its *band*, which does not
 * change, so its scale is fixed for its whole life. Only rotation moves.
 */
function _seedTumbler(inst, star, sp, band, y) {
  const half = inst.frame.span / 2;
  star.x = (Math.random() * 2 - 1) * half;
  star.y = y;
  if (!sp) return;
  const { spec, def, depth } = band;
  const size = (spec.sizeMin + (spec.sizeMax - spec.sizeMin) * depth * spec.growMul)
             * (0.6 + Math.random() * 0.8);
  // Eccentricity, area-preserving, rolled once and kept. A pool of identically
  // circular sprites reads as a set of discs however good the texture inside
  // them is — this is the cheapest fix for that, and it costs nothing per frame.
  //
  // The viewscreen also billows its clouds per frame; this surface deliberately
  // does not. Scale here is written at seed precisely because there is no z axis
  // to change it, and that is what keeps the tumble band down to a position and
  // a rotation write. A top-down cloud is also carried across the map by its
  // band, which supplies the motion a head-on one has to fake.
  const e = spec.aspect > 1 ? Math.pow(spec.aspect, Math.random() * 2 - 1) : 1;
  sp.scale.set((size * e) / band.texW, (size / e) / band.texH);
  sp.rotation = Math.random() * Math.PI * 2;
  // Signed, so a field of rocks does not all turn the same way.
  star.spin = ((Math.random() * 2 - 1) * spec.tumbleDeg * Math.PI) / 180 / 1000;
  // Rock is lit, not luminous, so it takes the flat accent; anything additive
  // takes a palette colour so a cloud bank is not one uniform hue.
  sp.tint  = spec.blend === "normal"
    ? inst.accentTint
    : inst.palette[(Math.random() * PALETTE_SIZE) | 0];
  sp.alpha = def.alpha
           * (spec.alphaFar + (spec.alphaNear - spec.alphaFar) * depth)
           * (0.7 + Math.random() * 0.6);
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
 * (Re)build the star and environment pools. Called on attach and whenever the
 * pool signature changes — density, palette, band layout or environment. Slider
 * drags never come through here; those are read live in the tick.
 */
function _buildPools(inst, cfg) {
  const quality = getSceneWarpQuality();
  const bands   = _bandsFor(cfg, quality);
  const env     = getEnvironment(cfg.environment);
  const spec    = env.particle;

  // Drop the previous pools. Sprites are destroyed but the shared textures are
  // not — they are owned by the instance and released in _destroy().
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

  // Star Mix thins the ordinary field behind whatever is being flown through;
  // the environment's own budget is the density scaled by its `countMul` and by
  // Intensity, then capped, because a cloud costs far more fill than a streak.
  const starBudget = cfg.density * quality.densityMul * cfg.starMix;
  const envBudget  = spec
    ? Math.min(ENV_POOL_MAX, cfg.density * quality.densityMul * spec.countMul * cfg.intensity)
    : 0;

  const texW = inst.texture.width  || 64;
  const texH = inst.texture.height || 8;

  for (const def of bands) {
    const host  = def.above ? inst.above : inst.below;
    const share = def.above ? def.share : def.share / depthShare;

    if (starBudget > 0) {
      const band = _makeBand(inst, {
        def, host, kind: "streak", spec: null,
        texture: inst.texture, texW, texH,
        count: Math.max(1, Math.round(starBudget * share)),
        blend: addBlend(),
        // Every streak runs along local +Y, so the rotation is a constant.
        rotation: Math.PI / 2, anchorX: 1,
      });
      for (let i = 0; i < band.stars.length; i++) {
        _seedStar(inst, band.stars[i], band.sprites[i], def.alpha, (Math.random() * 2 - 1) * half);
      }
      inst.bands.push(band);
    }

    if (spec && envBudget > 0) {
      // A smearing particle is a streak with different material, so it takes the
      // same path and the same per-band scale caching. A tumbling one cannot —
      // a sprite has one rotation and the tumble wants it.
      const smears = spec.stretchMul > 0;
      const etex   = inst.envTextures[0];
      const band = _makeBand(inst, {
        def, host, kind: smears ? "streak" : "tumble", spec,
        texture: etex,
        texW: etex?.width || 64, texH: etex?.height || 8,
        count: Math.max(1, Math.round(envBudget * share)),
        blend: spec.blend === "normal" ? null : addBlend(),
        rotation: smears ? Math.PI / 2 : 0,
        anchorX: smears ? 1 : 0.5,
        variants: inst.envTextures,
      });
      band.depth = _bandDepth(def);
      for (let i = 0; i < band.stars.length; i++) {
        const y = (Math.random() * 2 - 1) * half;
        if (smears) {
          const sp = band.sprites[i];
          _seedStar(inst, band.stars[i], sp, def.alpha, y);
          // Smearing env particles take the environment's own alpha curve rather
          // than the star one, and its colour rule.
          sp.alpha = def.alpha
                   * (spec.alphaFar + (spec.alphaNear - spec.alphaFar) * band.depth)
                   * (0.6 + Math.random() * 0.7);
          if (spec.blend === "normal") sp.tint = inst.accentTint;
        } else {
          _seedTumbler(inst, band.stars[i], band.sprites[i], band, y);
        }
      }
      inst.bands.push(band);
    }
  }
  _applyThinning(inst);
}

/** One band's container and sprite pool. */
function _makeBand(inst, opts) {
  const { def, host, kind, spec, texture, texW, texH, count, blend, rotation, anchorX, variants } = opts;
  const container = _inert(new PIXI.Container());
  host.inner.addChild(container);

  const stars   = [];
  const sprites = [];
  for (let i = 0; i < count; i++) {
    // Variants are picked at build time and kept: swapping a sprite's texture
    // per frame would break batching for no visual gain.
    const tex = variants?.length
      ? variants[(Math.random() * variants.length) | 0]
      : texture;
    const sp = new PIXI.Sprite(tex);
    // Head pins to the position for a streak; a tumbling particle spins about
    // its own centre.
    sp.anchor.set(anchorX, 0.5);
    sp.rotation = rotation;
    if (blend !== null && blend !== undefined) sp.blendMode = blend;
    container.addChild(sp);
    stars.push({ x: 0, y: 0, spin: 0 });
    sprites.push(sp);
  }

  return {
    def, kind, spec, container, stars, sprites,
    texW, texH,
    depth: _bandDepth(def),
    // How many of this band's particles are currently animated and drawn. Dice
    // thinning moves this rather than rebuilding the pool.
    active: stars.length,
    // Last scale written to every sprite in the band, so an unchanged frame
    // can skip ~750 transform writes. NaN forces the first frame to write.
    lastSx: NaN, lastSy: NaN,
  };
}

/** What a pool rebuild depends on. Anything else is live in the tick. */
function _poolSignature(cfg) {
  const q = getSceneWarpQuality();
  return [
    cfg.density, cfg.starTint, cfg.accentTint,
    Math.round(cfg.variety * 100), cfg.parallax, cfg.foreground,
    // The environment decides which textures, blend modes and band kinds exist,
    // and the two mix controls decide how many of each — all structural.
    cfg.environment,
    Math.round(cfg.intensity * 100), Math.round(cfg.starMix * 100),
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

// ── Ambient layers ───────────────────────────────────────────────────────────

/**
 * Grow or shrink the haze pool, and place it.
 *
 * Lives in the unrotated `pre` container: a bank of gas has no business swinging
 * round the map when the fleet changes course. Positions are spread across the
 * scene rect rather than anchored to a vanishing point, which is the one place
 * this differs from the viewscreen's haze — there is no vanishing point on a
 * top-down view to sit away from.
 */
function _syncHaze(inst, cfg, env) {
  const spec = environmentHaze(env, "scene");
  const want = spec ? spec.count : 0;

  while (inst.hazeSprites.length > want) {
    inst.hazeState.pop();
    const sp = inst.hazeSprites.pop();
    try { sp.destroy(); } catch { /* already gone */ }
  }
  while (inst.hazeSprites.length < want) {
    const sp = new PIXI.Sprite(inst.radialTex);
    sp.anchor.set(0.5);
    sp.blendMode = addBlend();
    inst.below.pre.addChild(sp);
    inst.hazeSprites.push(sp);
    inst.hazeState.push({
      fx: Math.random(), fy: Math.random(),
      sizeVar: Math.random(), alphaVar: Math.random(),
      phase: Math.random() * Math.PI * 2,
      rate:  0.6 + Math.random() * 0.8,
      baseX: 0, baseY: 0, size: 0,
    });
  }
  if (!spec) return;

  const r    = inst.frame.rect;
  const long = Math.max(r.width, r.height);
  for (let i = 0; i < inst.hazeSprites.length; i++) {
    const sp = inst.hazeSprites[i];
    const st = inst.hazeState[i];
    st.baseX = r.x + st.fx * r.width;
    st.baseY = r.y + st.fy * r.height;
    st.size  = long * spec.scale * (0.35 + st.sizeVar * 0.5);
    sp.position.set(st.baseX, st.baseY);
    sp.width  = st.size;
    sp.height = st.size;
    sp.tint   = inst.accentTint;
    sp.alpha  = spec.alpha * cfg.intensity * (0.55 + st.alphaVar * 0.9);
  }
}

/**
 * The ambient colour over the scene rect.
 *
 * **Additive and low-alpha, unlike the viewscreen's.** There the wash sits over
 * a backdrop this renderer deliberately does not paint; here it lies directly on
 * the GM's map art, and a normal-blend tint at any useful strength washes the
 * terrain out. Additive lifts the colour without hiding what is underneath.
 */
function _syncWash(inst, cfg, env) {
  const g = inst.wash;
  if (!g) return;
  const spec = env.wash;
  g.visible = !!spec && cfg.intensity > 0;
  if (!g.visible) return;
  const r = inst.frame.rect;
  g.clear();
  gFillRect(g, r.x, r.y, r.width, r.height, inst.accentTint, 1);
  g.alpha = spec.alpha * cfg.intensity * 0.5;
}

/**
 * The lightning pool.
 *
 * Built only for an environment that strikes, and redrawn per *strike* rather
 * than per frame — between strikes the Graphics are simply hidden, and the
 * flicker moves the container's alpha rather than re-tracing any path. On this
 * surface that discipline matters more than on the viewscreen: the tick here is
 * on the critical path for the whole tactical map.
 */
function _buildBoltPool(inst, spec) {
  if (inst.bolts.length || !spec || !inst.boltLayer) return;
  for (let i = 0; i < Math.max(1, spec.max); i++) {
    const g = _inert(new PIXI.Graphics());
    g.blendMode = addBlend();
    g.visible = false;
    inst.boltLayer.addChild(g);
    inst.bolts.push(g);
  }
}

/**
 * Create the discharge glow and the bolt layer, if this field needs them.
 *
 * Built on demand rather than at attach: the ion storm owns its lightning, but
 * the Lightning field can switch the same discharge on over any environment at
 * any time, and that is an ordinary look field — it must not cost a reattach.
 * Both go in the unrotated `post` container, above the field and still under the
 * tokens, with the bolts above the glow so their bright cores read against it.
 *
 * Nothing here is toggled once made: an environment without lightning never
 * calls this, so a plain warp scene keeps the sprite tree it has always had.
 */
function _ensureStrobeLayers(inst, spec) {
  if (!spec || inst.bloom) return;
  inst.bloom = new PIXI.Sprite(inst.radialTex);
  inst.bloom.anchor.set(0.5);
  inst.bloom.blendMode = addBlend();
  inst.bloom.alpha = 0;
  inst.bloom.visible = false;
  inst.below.post.addChild(inst.bloom);

  inst.boltLayer = _inert(new PIXI.Container());
  inst.boltLayer.visible = false;
  inst.below.post.addChild(inst.boltLayer);
  _buildBoltPool(inst, spec.bolt);
}

/**
 * Draw one bolt: a wide soft pass, then a thin bright core over it.
 *
 * The same two-pass construction the engine trails use. One stroke at a single
 * width reads as a drawn line; the pair reads as something incandescent.
 */
function _drawBolt(g, spec, core, glow, path) {
  g.clear();
  strokePolyline(g, { width: spec.glowWidth, color: glow, alpha: 0.28 }, path.main);
  for (const b of path.branches) {
    strokePolyline(g, { width: spec.glowWidth * 0.55, color: glow, alpha: 0.20 }, b);
  }
  strokePolyline(g, { width: spec.width, color: core, alpha: 1 }, path.main);
  for (const b of path.branches) {
    strokePolyline(g, { width: spec.width * 0.6, color: core, alpha: 0.85 }, b);
  }
}

/**
 * One lightning discharge somewhere on the map: a glow, and bolts struck through
 * the same point so the two agree.
 *
 * The bolts are drawn in the **unrotated** `post` container, in canvas space —
 * not in `inner`. A bolt has nothing to do with the fleet's course, and putting
 * it in the rotated space would swing every strike round the map when the GM
 * changes heading.
 */
function _fireStrobe(inst, cfg, spec, strength) {
  const r = inst.frame.rect;
  const at = { x: r.x + Math.random() * r.width, y: r.y + Math.random() * r.height };

  const sp = inst.bloom;
  if (sp) {
    const size = Math.min(r.width, r.height) * spec.scale * 0.5;
    sp.position.set(at.x, at.y);
    sp.width   = size;
    sp.height  = size;
    sp.tint    = Math.random() < 0.3 ? 0xffffff : lighten(inst.accentTint, 0.35);
    sp.alpha   = 0;
    sp.visible = true;
    inst.bloomAge = 1;
  }

  const bolt = spec.bolt;
  if (!bolt || !inst.bolts.length) return;
  // Shorter chords than the viewscreen's, relative to the frame: a scene rect is
  // far larger than a viewscreen, and a bolt scaled to its diagonal reads as a
  // crack across the whole map rather than as weather somewhere in it.
  const reach = Math.hypot(r.width, r.height) * 0.28;
  const core  = lighten(inst.accentTint, 0.72);
  const n = bolt.min + ((Math.random() * (bolt.max - bolt.min + 1)) | 0);

  for (let i = 0; i < inst.bolts.length; i++) {
    const g = inst.bolts[i];
    if (i >= n) { g.visible = false; continue; }
    const ang = Math.random() * Math.PI * 2;
    const dx  = Math.cos(ang) * reach;
    const dy  = Math.sin(ang) * reach;
    const f   = 0.3 + Math.random() * 0.4;
    const path = buildLightningPath(
      at.x - dx * f, at.y - dy * f,
      at.x + dx * (1 - f), at.y + dy * (1 - f),
      bolt,
    );
    _drawBolt(g, bolt, core, inst.accentTint, path);
    g.visible = true;
    g.alpha = 1;
  }
  inst.boltLayer.visible = true;
  inst.boltAge = 1;
}

/**
 * Fade and flicker the bolts currently in the air. Alpha only — the paths are
 * not re-traced, and the flutter never reaches zero, because a bolt that blinks
 * fully out and back reads as a dropped frame.
 */
function _tickBolts(inst, cfg, env, dt) {
  const spec = environmentStrobe(env, cfg.lightning, cfg.intensity)?.spec?.bolt;
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
//     visibly jump the whole field, twice per roll. Environment bands are
//     ordinary bands here, so they thin on exactly the same terms.

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
  const env = getEnvironment(cfg.environment);

  const inst = {
    sceneId: scene.id,
    frame,
    texture: buildStreakTexture(),
    radialTex: buildRadialTexture(),
    envTextures: env.particle ? _buildEnvTextures(env.particle.texture) : [],
    palette: _makePalette(cfg),
    accentTint: parseHexColor(cfg.accentTint, 0x7dd3fc),
    envId: cfg.environment,
    bands: [],
    hazeSprites: [],
    hazeState: [],
    wash: null,
    bloom: null,
    bloomAge: 0,
    boltLayer: null,
    bolts: [],
    boltAge: 0,
    strobeIn: 0,
    washAge: 0,
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

  // Both ambient pieces sit in the below half's unrotated `post` container, so
  // they lie over the field but still under the tokens.
  //
  // Built ONLY for an environment that uses them, unlike the viewscreen's, where
  // the same sprite also serves the enter/exit starburst and so always exists.
  // Nothing here is toggled by a config change — a change of environment forces
  // a full reattach — so conditional construction is safe, and it is what keeps
  // plain warp on this surface byte-identical to the field that predates
  // environments: no wash, no flash sprite, nothing extra in the tree.
  if (env.wash) {
    inst.wash = new PIXI.Graphics();
    inst.wash.visible = false;
    inst.below.post.addChild(inst.wash);
  }
  _ensureStrobeLayers(inst, environmentStrobe(env, cfg.lightning, cfg.intensity)?.spec);

  _inst = inst;
  _buildPools(inst, cfg);
  _syncHaze(inst, cfg, env);
  _syncWash(inst, cfg, env);
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
  // The generated textures are this instance's own; nothing else shares them.
  try { inst.texture?.destroy(true); } catch { /* already gone */ }
  try { inst.radialTex?.destroy(true); } catch { /* already gone */ }
  for (const t of inst.envTextures ?? []) {
    try { t?.destroy(true); } catch { /* already gone */ }
  }
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

  // A change of environment swaps which textures exist, so it cannot be absorbed
  // by a pool rebuild alone — it takes the full reattach. `attachSceneWarp` is
  // idempotent, which is what makes that one line rather than a list of which
  // fields are structural.
  if (cfg.environment !== _inst.envId) {
    attachSceneWarp();
    return;
  }

  const env = getEnvironment(cfg.environment);
  _inst.accentTint = parseHexColor(cfg.accentTint, 0x7dd3fc);

  const sig = _poolSignature(cfg);
  if (sig !== _inst.signature) {
    _inst.signature = sig;
    _inst.palette   = _makePalette(cfg);
    _buildPools(_inst, cfg);
  }
  _syncHaze(_inst, cfg, env);
  _syncWash(_inst, cfg, env);
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

/** Drift the haze blobs. A no-op for any environment whose `driftRate` is 0. */
function _tickHaze(inst, cfg, env, dt) {
  const spec = environmentHaze(env, "scene");
  if (!spec || !spec.driftRate || !inst.hazeSprites.length) return;
  for (let i = 0; i < inst.hazeSprites.length; i++) {
    const sp = inst.hazeSprites[i];
    const st = inst.hazeState[i];
    st.phase += (dt / 1000) * spec.driftRate * st.rate;
    const amp = st.size * 0.12;
    sp.position.set(
      st.baseX + Math.cos(st.phase) * amp,
      st.baseY + Math.sin(st.phase * 0.73) * amp,
    );
  }
}

/** Breathe the wash, schedule the lightning, and decay whatever is lit. */
function _tickAmbient(inst, cfg, env, dt) {
  const wash = env.wash;
  if (wash && inst.wash?.visible) {
    const base = wash.alpha * cfg.intensity * 0.5;
    if (!wash.pulseMs) inst.wash.alpha = base;
    else {
      inst.washAge += dt;
      const t = (inst.washAge % wash.pulseMs) / wash.pulseMs;
      inst.wash.alpha = base * (0.75 + 0.25 * (1 + Math.sin(t * Math.PI * 2)));
    }
  }

  // Either the environment owns a discharge or the Lightning field switched one
  // on over it — one resolved answer, so nothing here branches on which.
  const s = environmentStrobe(env, cfg.lightning, cfg.intensity);
  if (s && s.strength > 0) {
    const { spec: strobe, strength } = s;
    inst.strobeIn -= dt;
    if (inst.strobeIn <= 0) {
      // On demand, because Lightning is a look field that must not cost a
      // reattach when it is dragged off zero mid-scene.
      _ensureStrobeLayers(inst, strobe);
      _fireStrobe(inst, cfg, strobe, strength);
      // Violence shortens the gaps as well as raising the flash, so one control
      // is one idea rather than two half-connected ones.
      inst.strobeIn = (strobe.minMs + Math.random() * (strobe.maxMs - strobe.minMs))
                    / Math.max(0.15, strength);
    }
  }

  if (inst.bloomAge > 0 && inst.bloom) {
    inst.bloomAge += dt;
    const a = inst.bloomAge;
    const v = a < BLOOM_RISE_MS
      ? a / BLOOM_RISE_MS
      : 1 - Math.min(1, (a - BLOOM_RISE_MS) / BLOOM_FALL_MS);
    inst.bloom.alpha = Math.max(0, v) * BLOOM_PEAK;
    if (v <= 0) {
      inst.bloomAge = 0;
      inst.bloom.alpha = 0;
      inst.bloom.visible = false;
    }
  }

  _tickBolts(inst, cfg, env, dt);
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

  // Read each of these EXACTLY once per frame and pass them down. All three are
  // memoised now, but the discipline is what keeps the cost flat — see the note
  // on `scenePhaseFrom` in scene-warp.js.
  const scene  = canvas.scene;
  const cfg    = getSceneWarp(scene);     // live: slider drags need no re-attach
  const timing = getSceneWarpTiming();
  const ramp   = _rampFactor(cfg, timing);
  const env    = getEnvironment(cfg.environment);

  // With drift off there is nothing to animate at rest, and a parked field would
  // leave frozen stars lying on the map art rather than the clean scene the
  // option promises. Hide outright and stop ticking.
  //
  // Note this does NOT consult `restAmbient` the way the viewscreen's gate does.
  // A viewscreen is a small masked shape and a persistent storm inside it is
  // cheap; a whole tactical map is not, and honouring it here would mean a scene
  // merely *configured* for a storm never releasing its ticker. On this surface
  // the `drift` switch is how a GM asks for persistence.
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

  for (const band of inst.bands) {
    const { def, stars, sprites, spec } = band;
    // An environment pool may travel slower than the starfield. A particle's
    // life is one crossing of the field, so this is the only lever on how long
    // it stays on screen — clouds at a third speed linger three times as long.
    const step = base * def.speed * (spec?.speedMul ?? 1);
    const n    = band.active;

    // ── Tumbling particles ────────────────────────────────────────────────
    // Scale was written at seed and never changes — without a z axis a
    // particle's depth is its band. Only position and rotation move.
    if (band.kind === "tumble") {
      for (let i = 0; i < n; i++) {
        const star = stars[i];
        const sp   = sprites[i];
        star.y += step;
        if (star.y > half) _seedTumbler(inst, star, sp, band, star.y - span);
        sp.position.set(star.x, star.y);
        if (star.spin) sp.rotation += star.spin * dt;
      }
      continue;
    }

    // ── Streaks: stars, and any environment particle that smears ──────────
    // Length and thickness are the same for every particle in a band, so they
    // are resolved to a scale pair once per band and assigned directly. Going
    // through the `width`/`height` setters instead repeats the divide by the
    // texture size for every sprite, every frame.
    //
    // The environment scales the stretch it inherits rather than replacing it,
    // and a `stretchMul` of 1 is exactly the star behaviour — which is what
    // keeps plain warp identical.
    const stretchMul = spec ? spec.stretchMul : 1;
    const stretch    = 1 + WARP_STRETCH * ramp * stretchMul;
    const len   = Math.min(maxLen, baseLen * def.speed * stretch * cfg.streakMul);
    const thick = spec
      ? (spec.sizeMin + (spec.sizeMax - spec.sizeMin) * band.depth * spec.growMul)
      : BASE_THICK * def.thick * cfg.thickness;
    const sx    = Math.max(thick, len) / band.texW;
    const sy    = thick / band.texH;

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

  _tickHaze(inst, cfg, env, dt);
  _tickAmbient(inst, cfg, env, dt);
}
